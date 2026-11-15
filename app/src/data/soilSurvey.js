// Real soil for any surveyed US field: USDA NRCS SSURGO via Soil Data Access (keyless, CORS open).
//
//   fillSoil(fields)  ->  Promise<{ [fieldId]: FieldSoil }>   fields that already have .soil are skipped
//
// FieldSoil = {
//   display: { texture, drainage, organicMatterPct, waterHoldingIn }   what the field panel shows
//            (same shape as the demo data's soil; water holding is over the top 60 in, like the demo's)
//   land:    the planner's Land (vendor parseSsurgo: texture bucket, drainage class, pH, EC, AWC,
//            K and T factors, organic matter, restrictive depth, slope)
//   mapUnit, component, gaps
// }
//
// One point per field: inside the outline (its centroid, or a point on it when the centroid falls
// outside), and the map unit's largest major component there. A field spanning several soils gets
// the one at that point. Answers are cached in localStorage by point.
import { booleanPointInPolygon, centroid, pointOnFeature } from '@turf/turf';
import { parseSsurgo, ssurgoPointQuery } from '../vendor/rotation-maxxing/data/ssurgo.ts';
import { Unreachable, assertAnswered, fetchRetry } from './net.js';

export const SDA_URL = 'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest';
const CONCURRENCY = 4;
const ATTEMPTS = 3;
const TIMEOUT_MS = 15000;
const CACHE_PREFIX = 'soil:v1:';
const TOP_60_IN_CM = 152.4;

/** A point inside the field. */
export function soilPoint(geometry) {
  const c = centroid(geometry).geometry.coordinates;
  return booleanPointInPolygon(c, geometry) ? c : pointOnFeature(geometry).geometry.coordinates;
}

/** USDA soil texture class from sand, silt and clay % (the standard texture triangle). */
export function textureClass(sand, silt, clay) {
  if (![sand, silt, clay].every(Number.isFinite)) return null;
  if (silt + 1.5 * clay < 15) return 'sand';
  if (silt + 2 * clay < 30) return 'loamy sand';
  if (clay >= 40 && silt >= 40) return 'silty clay';
  if (clay >= 40 && sand <= 45) return 'clay';
  if (clay >= 35 && sand > 45) return 'sandy clay';
  if (clay >= 27 && sand <= 20) return 'silty clay loam';
  if (clay >= 27 && sand <= 45) return 'clay loam';
  if (clay >= 20 && silt < 28 && sand > 45) return 'sandy clay loam';
  if (silt >= 80 && clay < 12) return 'silt';
  if (silt >= 50) return 'silt loam';
  if (clay >= 7 && silt >= 28 && sand <= 52) return 'loam';
  return 'sandy loam';
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** The field panel's soil from an SDA JSON+COLUMNNAME response (the same rows parseSsurgo reads). */
export function displaySoil(json) {
  const [head, ...data] = json.Table;
  const rows = data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  const hz = rows.filter((r) => r.cokey === rows[0].cokey);
  const surface = hz.find((r) => num(r.hzdept_r) === 0) ?? hz[0];
  const sand = num(surface.sandtotal_r);
  const clay = num(surface.claytotal_r);
  let water = 0, depth = 0;
  for (const h of hz) {
    const top = num(h.hzdept_r) ?? 0;
    const bot = Math.min(num(h.hzdepb_r) ?? top, TOP_60_IN_CM);
    const awc = num(h.awc_r);
    if (bot <= top || awc == null) continue;
    water += awc * (bot - top);
    depth += bot - top;
  }
  return {
    texture: sand != null && clay != null ? textureClass(sand, 100 - sand - clay, clay) : null,
    drainage: hz[0].drainagecl ? String(hz[0].drainagecl).toLowerCase() : null,
    organicMatterPct: round(num(surface.om_r), 1),
    waterHoldingIn: depth > 0 ? round(water / 2.54, 1) : null,
  };
}

const cache = {
  get(k) { try { const v = localStorage.getItem(CACHE_PREFIX + k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(CACHE_PREFIX + k, JSON.stringify(v)); } catch { /* full or blocked: fine */ } },
};

/**
 * The soil at one point, or null when it isn't surveyed there (water, a town, outside the US).
 * Throws Unreachable when Soil Data Access doesn't answer (each try times out; tried again with backoff).
 */
export async function soilAt([lng, lat], fetchFn = globalThis.fetch, { signal = null, clock } = {}) {
  const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const body = JSON.stringify({ query: ssurgoPointQuery(lng, lat), format: 'JSON+COLUMNNAME' });
  const res = assertAnswered(await fetchRetry(fetchFn, SDA_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, { timeoutMs: TIMEOUT_MS, attempts: ATTEMPTS, backoffMs: 600, signal, clock }), 'Soil Data Access');
  if (!res.ok) return null;
  let json;
  try { json = await res.json(); } catch { throw new Unreachable('Soil Data Access sent an unreadable answer'); }
  if (!json?.Table || json.Table.length < 2) return null; // not surveyed here
  const { land, mapUnit, component, gaps } = parseSsurgo(json);
  const soil = { display: displaySoil(json), land, mapUnit, component, gaps };
  cache.set(key, soil);
  return soil;
}

/**
 * Soil for every field that doesn't have it yet, a few at a time. onField(id, state, soil, reason)
 * as each settles: 'done', 'none' (not surveyed) or 'failed' (Soil Data Access didn't answer).
 */
export async function fillSoil(fields, { fetchFn = globalThis.fetch, onField = () => {}, signal = null, clock } = {}) {
  const todo = fields.filter((f) => f?.geometry && !f.soil);
  for (const f of fields) if (f && !todo.includes(f)) onField(f.id, f.soil ? 'done' : 'none', null, null);
  const out = {};
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const f = todo[i++];
      try {
        const soil = await soilAt(soilPoint(f.geometry), fetchFn, { signal, clock });
        if (soil) out[f.id] = soil;
        onField(f.id, soil ? 'done' : 'none', soil, soil ? null : 'no soil survey here');
      } catch (e) {
        onField(f.id, 'failed', null, e?.message || 'Soil Data Access did not answer');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return out;
}

/** Fields with their soil attached; unchanged fields are returned as is. */
export function withSoil(fields, filled) {
  return fields.map((f) => (filled[f.id] ? { ...f, soil: filled[f.id] } : f));
}
