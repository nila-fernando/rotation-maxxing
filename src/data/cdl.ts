/**
 * USDA NASS Cropland Data Layer via CropScape (keyless):
 * crop history for each paddock. https://nassgeodata.gmu.edu/CropScape/
 *
 * CropScape takes points in USA Contiguous Albers Equal Area (EPSG:5070), so
 * lng/lat is projected here (Snyder 1987 formulas, GRS80 ellipsoid).
 */
import type { CropId, LngLat } from '../algorithm/types';
import type { FetchFn } from './power';

// EPSG:5070 parameters.
const A = 6378137;
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const E = Math.sqrt(E2);
const DEG = Math.PI / 180;
const LAT0 = 23 * DEG;
const LON0 = -96 * DEG;
const LAT1 = 29.5 * DEG;
const LAT2 = 45.5 * DEG;

function q(phi: number): number {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
}
function m(phi: number): number {
  const s = Math.sin(phi);
  return Math.cos(phi) / Math.sqrt(1 - E2 * s * s);
}
const M1 = m(LAT1);
const M2 = m(LAT2);
const Q1 = q(LAT1);
const Q2 = q(LAT2);
const N = (M1 * M1 - M2 * M2) / (Q2 - Q1);
const C = M1 * M1 + N * Q1;
const RHO0 = (A * Math.sqrt(C - N * q(LAT0))) / N;

/** lng/lat (degrees) -> EPSG:5070 metres. */
export function toAlbers5070([lng, lat]: LngLat): [number, number] {
  const rho = (A * Math.sqrt(C - N * q(lat * DEG))) / N;
  const theta = N * (lng * DEG - LON0);
  return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)];
}

/** CDL category names -> our crop ids. Anything else is "other" (null). */
export const CDL_CATEGORY_TO_CROP: Record<string, CropId> = {
  Corn: 'corn',
  Soybeans: 'soybeans',
  'Winter Wheat': 'winter-wheat',
  'Spring Wheat': 'spring-wheat',
  Sorghum: 'sorghum',
  Cotton: 'cotton',
  Alfalfa: 'alfalfa',
  Oats: 'oats',
  Barley: 'barley',
  Sunflower: 'sunflower',
  Canola: 'canola',
  'Dry Beans': 'dry-beans',
  'Fallow/Idle Cropland': 'fallow',
  // Double crop: the main (first) crop is recorded; the second crop is noted as a gap.
  'Dbl Crop WinWht/Soybeans': 'winter-wheat',
};

export function cdlValueUrl(year: number, x: number, y: number): string {
  return `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`;
}

/** Parse the XML-wrapped GetCDLValue response; returns the category name. */
export function parseCdlValue(text: string): string | null {
  const m = /category:\s*"([^"]*)"/.exec(text);
  return m ? m[1]! : null;
}

/** Up to 5 sample points: the vertex centroid plus points halfway to each of 4 vertices. */
export function samplePoints(ring: LngLat[]): LngLat[] {
  const n = ring.length;
  const cx = ring.reduce((a, p) => a + p[0], 0) / n;
  const cy = ring.reduce((a, p) => a + p[1], 0) / n;
  const pts: LngLat[] = [[cx, cy]];
  const step = Math.max(1, Math.floor(n / 4));
  for (let i = 0; i < n && pts.length < 5; i += step) pts.push([(cx + ring[i]![0]) / 2, (cy + ring[i]![1]) / 2]);
  return pts;
}

/** CDL category at one lng/lat point (null if CropScape doesn't answer). */
export async function cdlCategoryAt(point: LngLat, year: number, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<string | null> {
  const [x, y] = toAlbers5070(point);
  return fetchCategory(fetchFn, cdlValueUrl(year, x, y));
}

/** CropScape returns intermittent 5xx proxy errors: retry a few times, then give up on that point. */
async function fetchCategory(fetchFn: FetchFn, url: string, attempts = 3): Promise<string | null> {
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetchFn(url);
      if (res.ok) return parseCdlValue(await res.text());
      if (res.status < 500) return null;
    } catch {
      // network error: retry
    }
  }
  return null;
}

export interface CdlHistory {
  /** Oldest first; null where CDL shows a crop we don't model. */
  history: (CropId | null)[];
  categories: string[];
  gaps: string[];
}

/** Majority CDL category inside the polygon for each year. */
export async function fetchCdlHistory(
  ring: LngLat[],
  years: number[],
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<CdlHistory> {
  const pts = samplePoints(ring).map(toAlbers5070);
  const history: (CropId | null)[] = [];
  const categories: string[] = [];
  const gaps: string[] = [];
  for (const year of years) {
    const votes = new Map<string, number>();
    for (const [x, y] of pts) {
      const cat = await fetchCategory(fetchFn, cdlValueUrl(year, x, y));
      if (cat) votes.set(cat, (votes.get(cat) ?? 0) + 1);
    }
    if (votes.size === 0) {
      categories.push('Unavailable');
      history.push(null);
      gaps.push(`CropScape didn't answer for ${year}; that year's crop is unknown. Enter it manually.`);
      continue;
    }
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    categories.push(top);
    const crop = CDL_CATEGORY_TO_CROP[top] ?? null;
    if (!crop) gaps.push(`CDL ${year} shows "${top}", which isn't one of the modelled crops.`);
    if (top.startsWith('Dbl Crop')) gaps.push(`CDL ${year} shows a double crop (${top}); only the first crop is recorded.`);
    history.push(crop);
  }
  return { history, categories, gaps };
}
