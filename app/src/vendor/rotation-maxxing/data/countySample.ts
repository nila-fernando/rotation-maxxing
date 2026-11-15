/**
 * Sample the soils under a county's cropland, for the backtest.
 *
 * Seeded uniform random points inside the county outline (US Census TIGERweb,
 * keyless) are kept when the Cropland Data Layer shows one of the target crops
 * there. Uniform sampling makes each SSURGO map unit's chance of being picked
 * proportional to its cropland area, so averaging over the points is an
 * area-weighted average.
 */
import { createRng } from '../algorithm/rng';
import type { LngLat } from '../algorithm/types';
import { cdlCategoryAt } from './cdl';
import type { FetchFn } from './power';
import { fetchSoilAtPoint, type SoilAtPoint } from './ssurgo';

export interface CountyOutline {
  geoid: string;
  name: string;
  centroid: LngLat;
  rings: LngLat[][];
}

export function countyOutlineUrl(geoid: string): string {
  const q = new URLSearchParams({ where: `GEOID='${geoid}'`, outFields: 'GEOID,NAME,CENTLAT,CENTLON', returnGeometry: 'true', outSR: '4326', f: 'json' });
  return `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query?${q}`;
}

export function parseCountyOutline(json: unknown): CountyOutline {
  const f = (json as { features?: { attributes: Record<string, string>; geometry: { rings: LngLat[][] } }[] }).features?.[0];
  if (!f) throw new Error('County not found in TIGERweb.');
  return {
    geoid: f.attributes['GEOID']!,
    name: f.attributes['NAME']!,
    centroid: [Number(f.attributes['CENTLON']), Number(f.attributes['CENTLAT'])],
    rings: f.geometry.rings,
  };
}

export async function fetchCountyOutline(geoid: string, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<CountyOutline> {
  const res = await fetchFn(countyOutlineUrl(geoid));
  if (!res.ok) throw new Error(`TIGERweb request failed (HTTP ${res.status}).`);
  return parseCountyOutline(await res.json());
}

/** Even-odd point-in-polygon over all rings (handles holes). */
export function pointInRings([x, y]: LngLat, rings: LngLat[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export interface SampledPoint {
  lngLat: LngLat;
  cdlCategory: string;
  soil: SoilAtPoint;
}

export interface SampleOptions {
  /** Points to collect. Default 15. */
  n?: number;
  /** Give up after this many random draws. Default 150. */
  maxDraws?: number;
  seed?: number;
  /** CDL year used to find cropland. */
  year: number;
  /** CDL categories that count as target cropland. */
  categories: string[];
}

export async function sampleCroplandSoils(
  county: CountyOutline,
  o: SampleOptions,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<{ points: SampledPoint[]; draws: number; gaps: string[] }> {
  const rng = createRng(o.seed ?? 1);
  const all = county.rings.flat();
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const n = o.n ?? 15;
  const maxDraws = o.maxDraws ?? 150;
  const points: SampledPoint[] = [];
  const gaps: string[] = [];
  let draws = 0;
  while (points.length < n && draws < maxDraws) {
    draws++;
    const pt: LngLat = [minX + rng.next() * (maxX - minX), minY + rng.next() * (maxY - minY)];
    if (!pointInRings(pt, county.rings)) continue;
    const cat = await cdlCategoryAt(pt, o.year, fetchFn);
    if (!cat || !o.categories.includes(cat)) continue;
    try {
      points.push({ lngLat: pt, cdlCategory: cat, soil: await fetchSoilAtPoint(pt[0], pt[1], fetchFn) });
    } catch {
      gaps.push(`No SSURGO soil at a sampled cropland point (${pt[0].toFixed(4)}, ${pt[1].toFixed(4)}); skipped.`);
    }
  }
  if (points.length < n) gaps.push(`Only ${points.length} of ${n} cropland points found in ${draws} draws.`);
  return { points, draws, gaps };
}
