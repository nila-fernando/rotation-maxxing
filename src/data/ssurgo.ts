/**
 * USDA NRCS SSURGO soil data via Soil Data Access (keyless).
 * https://sdmdataaccess.sc.egov.usda.gov/
 *
 * We query the map unit at the paddock centroid and use its largest major
 * component: surface horizon for K, pH, EC, OM and texture; AWC is weighted
 * over the top 150 cm (the root zone of most field crops).
 */
import type { Drainage, Land, Texture } from '../algorithm/types';
import type { FetchFn } from './power';

const SDA_URL = 'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest';
const ROOT_ZONE_CM = 150;

export function ssurgoPointQuery(lng: number, lat: number): string {
  return (
    'SELECT mu.mukey, mu.muname, c.cokey, c.comppct_r, c.compname, c.drainagecl, c.slope_r, c.tfact, ' +
    'ch.hzdept_r, ch.hzdepb_r, ch.kffact, ch.kwfact, ch.awc_r, ch.ph1to1h2o_r, ch.ec_r, ch.om_r, ch.sandtotal_r, ch.claytotal_r ' +
    'FROM mapunit mu INNER JOIN component c ON c.mukey = mu.mukey INNER JOIN chorizon ch ON ch.cokey = c.cokey ' +
    `WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lng.toFixed(6)} ${lat.toFixed(6)})')) ` +
    "AND c.majcompflag = 'Yes' ORDER BY c.comppct_r DESC, c.cokey, ch.hzdept_r"
  );
}

export interface SoilAtPoint {
  /** Fields ready to drop into Paddock.land. */
  land: Land;
  mapUnit: string;
  component: string;
  gaps: string[];
}

/** SSURGO drainage classes -> our three classes (a design mapping). */
export function mapDrainage(cls: string | null): Drainage {
  const c = (cls ?? '').toLowerCase();
  if (c.includes('poorly')) return 'poor';
  if (c.startsWith('moderately well')) return 'moderate';
  if (c.includes('excessively')) return 'excessive';
  return 'good';
}

/** Sand/clay % -> our four texture buckets (a design mapping, not the full USDA triangle). */
export function mapTexture(sandPct: number | null, clayPct: number | null): Texture {
  const sand = sandPct ?? 40;
  const clay = clayPct ?? 20;
  const silt = 100 - sand - clay;
  if (sand >= 70) return 'sand';
  if (clay >= 40) return 'clay';
  if (silt >= 50) return 'silt';
  return 'loam';
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Parse an SDA JSON+COLUMNNAME response from ssurgoPointQuery(). */
export function parseSsurgo(json: unknown): SoilAtPoint {
  const table = (json as { Table?: unknown[][] }).Table;
  if (!table || table.length < 2) throw new Error('No SSURGO soil data at this location (outside surveyed area?).');
  const head = table[0] as string[];
  const rows = table.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])) as Record<string, unknown>);
  const cokey = rows[0]!['cokey'];
  const hz = rows.filter((r) => r['cokey'] === cokey);
  const first = hz[0]!;
  const surface = hz.find((r) => num(r['hzdept_r']) === 0) ?? first;
  const gaps: string[] = [];

  let awSum = 0;
  let depth = 0;
  for (const h of hz) {
    const top = num(h['hzdept_r']) ?? 0;
    const bot = Math.min(num(h['hzdepb_r']) ?? top, ROOT_ZONE_CM);
    const awc = num(h['awc_r']);
    if (bot <= top || awc === null) continue;
    awSum += awc * (bot - top);
    depth += bot - top;
  }

  const k = num(surface['kffact']) ?? num(surface['kwfact']);
  const t = num(first['tfact']);
  const ec = num(surface['ec_r']);
  const ph = num(surface['ph1to1h2o_r']);
  const om = num(surface['om_r']);
  const slope = num(first['slope_r']);
  if (ec === null) gaps.push('SSURGO reports no EC for this soil; treated as non-saline (0 dS/m).');
  if (ph === null) gaps.push('SSURGO reports no pH for this soil; pH suitability is skipped.');
  if (slope === null) gaps.push('SSURGO reports no slope for this map unit; enter it manually.');
  if (k === null) gaps.push('SSURGO reports no K factor for this soil; erosion is not estimated.');
  if (depth === 0) gaps.push('SSURGO reports no available water capacity; the water balance is skipped.');

  const land: Land = {
    slopePct: slope ?? 0,
    texture: mapTexture(num(surface['sandtotal_r']), num(surface['claytotal_r'])),
    drainage: mapDrainage(first['drainagecl'] as string | null),
    salinityECe: ec ?? 0,
    ...(ph !== null ? { ph } : {}),
    ...(depth > 0 ? { awcInPerIn: awSum / depth } : {}),
    ...(k !== null ? { kFactor: k } : {}),
    ...(t !== null ? { tFactorTonsPerAcre: t } : {}),
    ...(om !== null ? { organicMatterPct: om } : {}),
  };
  return { land, mapUnit: String(first['muname'] ?? ''), component: String(first['compname'] ?? ''), gaps };
}

export async function fetchSoilAtPoint(lng: number, lat: number, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<SoilAtPoint> {
  const res = await fetchFn(SDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ssurgoPointQuery(lng, lat), format: 'JSON+COLUMNNAME' }),
  });
  if (!res.ok) throw new Error(`Soil Data Access request failed (HTTP ${res.status}).`);
  return parseSsurgo(await res.json());
}
