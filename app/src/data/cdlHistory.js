// Crop history for any US field from the USDA NASS Cropland Data Layer (CDL), via CropScape.
//
// The live USDA outlines carry one crop (2023) and the AI outlines none, so outside the bundled
// Story County layer most years are missing. CDL maps the crop on every 30 m pixel of the lower 48,
// every year; CSB (the bundled history) is built from it, so the category names match.
//
//   fillCropHistory(fields, { years })  ->  Promise<{ [fieldId]: { [year]: categoryName } }>
//     only the years a field doesn't already have; a field's own (CSB) years are never replaced
//
// Per field and year: up to 3 points inside the outline, one CropScape lookup each, majority vote.
// CropScape sends no CORS header, so the browser goes through a proxy: VITE_CDL_PROXY, set at build
// time. vite.config.js gives the dev server and the local build (npm run preview) '/cropscape', its
// own proxy; the GitHub Pages build gets '' (off) unless VITE_CDL_PROXY is set, since a static host
// can't proxy. With no proxy, fillCropHistory asks nothing and the check-up says those years are
// out of reach (cdlAvailable). Answers are cached in localStorage by point and year, so a reload or
// the same field picked again costs nothing. A year CropScape doesn't answer is left missing, and
// the field is reported 'failed' (onField) so the check-up can offer to ask again.
import { booleanPointInPolygon, pointOnFeature } from '@turf/turf';
import { parseCdlValue, samplePoints, toAlbers5070 } from '../vendor/rotation-maxxing/data/cdl.ts';
import { Unreachable, assertAnswered, fetchRetry, pool } from './net.js';

const envProxy = import.meta.env?.VITE_CDL_PROXY; // undefined under node:test
/** The CropScape proxy path or origin; '' when this build has none. */
export const CDL_PROXY = typeof envProxy === 'string' ? envProxy.trim().replace(/\/+$/, '') : '/cropscape';
/** Whether crop history beyond the outline's own years can be looked up from this site. */
export const cdlAvailable = (base = CDL_PROXY) => !!base;
const CONCURRENCY = 10;
const POINTS = 3;
const ATTEMPTS = 3;
const TIMEOUT_MS = 12000; // per try; most answers take well under a second
const BACKOFF_MS = 500;
const BREAKER = 12;
const CACHE_PREFIX = 'cdl:v1:';

/** The outer ring of the field's biggest part (by vertex count; good enough to pick sample points). */
function outerRing(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates[0];
  return geometry.coordinates.reduce((a, p) => (p[0].length > a.length ? p[0] : a), []);
}

/** Up to 3 points inside the field (the vendor's centroid-and-halfway points, kept if inside). */
export function fieldPoints(geometry) {
  const ring = outerRing(geometry).slice(0, -1); // GeoJSON repeats the first vertex
  const inside = samplePoints(ring).filter((p) => booleanPointInPolygon(p, geometry)).slice(0, POINTS);
  return inside.length ? inside : [pointOnFeature(geometry).geometry.coordinates];
}

/** Majority category; a tie goes to the first point's answer (the most central one). */
export function majority(categories) {
  const votes = new Map();
  for (const c of categories) if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
  let best = null;
  for (const [c, n] of votes) if (!best || n > votes.get(best)) best = c;
  return best;
}

const cache = {
  get(k) { try { return localStorage.getItem(CACHE_PREFIX + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(CACHE_PREFIX + k, v); } catch { /* full or blocked: fine */ } },
};

/** One CropScape lookup: the category, or null when CropScape has none there. Throws Unreachable
 * when it doesn't answer (it has intermittent 5xx errors and slow spells: each try times out, and
 * is tried again with backoff). */
async function lookup(fetchFn, base, year, [x, y], { signal, clock } = {}) {
  const key = `${year}:${Math.round(x)},${Math.round(y)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = `${base}/axis2/services/CDLService/GetCDLValue?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`;
  const res = assertAnswered(await fetchRetry(fetchFn, url, {}, { timeoutMs: TIMEOUT_MS, attempts: ATTEMPTS, backoffMs: BACKOFF_MS, signal, clock }), 'CropScape');
  if (!res.ok) return null;
  const cat = parseCdlValue(await res.text());
  if (cat) cache.set(key, cat);
  return cat;
}

/**
 * @param {object[]} fields  app fields ({ id, geometry, crops })
 * @param {object} o
 * @param {number[]} o.years            the years wanted (e.g. HISTORY_YEARS)
 * @param {(field) => object} [o.known] years already known per field from elsewhere (demo data)
 * @param {Function} [o.fetchFn]        fetch (tests pass a fake)
 * @param {string} [o.base]             CropScape origin or proxy path ('': no proxy, nothing is asked)
 * @param {(id, state, found, reason) => void} [o.onField]  as each field settles: 'done' (it has
 *        crop years), 'none' (CropScape has none for it) or 'failed' (some years couldn't be asked)
 * @param {AbortSignal} [o.signal]      stops every lookup still waiting (the source's budget ran out)
 * @returns {Promise<Record<string, Record<string, string>>>} new years per field id
 */
export async function fillCropHistory(fields, { years, known = () => ({}), fetchFn = globalThis.fetch, base = CDL_PROXY, onField = () => {}, signal = null, clock } = {}) {
  const run = pool(CONCURRENCY);
  const out = {};
  // CropScape down altogether: after BREAKER failures with no answer at all, stop asking
  let answered = 0, failures = 0;
  const ask = (year, p) => run(async () => {
    if (!answered && failures >= BREAKER) throw new Unreachable('CropScape is not answering');
    try {
      const cat = await lookup(fetchFn, base, year, p, { signal, clock });
      answered++;
      return cat;
    } catch (e) {
      failures++;
      throw e;
    }
  });
  await Promise.all(fields.map(async (f) => {
    if (!f?.geometry) { onField(f?.id, 'none', null, null); return; }
    const have = { ...known(f), ...(f.crops || {}) };
    const missing = years.filter((y) => have[y] == null);
    const any = () => Object.values(have).some((c) => c != null);
    if (!missing.length) { onField(f.id, 'done', null, null); return; }
    if (!cdlAvailable(base)) { // no proxy on this site (GitHub Pages): no lookups that can only fail
      onField(f.id, 'failed', null, 'CropScape can’t be reached from this site');
      return;
    }
    const pts = fieldPoints(f.geometry).map(toAlbers5070);
    const found = {};
    let failed = false;
    await Promise.all(missing.map(async (year) => {
      const got = await Promise.allSettled(pts.map((p) => ask(year, p)));
      const cats = got.map((g) => (g.status === 'fulfilled' ? g.value : null));
      // a year counts as failed only when no point answered (one answer is enough to vote on)
      if (got.every((g) => g.status === 'rejected')) failed = true;
      const cat = majority(cats);
      if (cat) found[year] = cat;
    }));
    if (Object.keys(found).length) out[f.id] = found;
    Object.assign(have, found);
    onField(f.id, failed ? 'failed' : any() ? 'done' : 'none', Object.keys(found).length ? found : null, failed ? 'CropScape did not answer for some years' : null);
  }));
  return out;
}

/** Fields with the CDL years merged in (their own years win); unchanged fields are returned as is. */
export function withCdlYears(fields, filled) {
  return fields.map((f) => {
    const add = filled[f.id];
    if (!add) return f;
    const crops = { ...add, ...(f.crops || {}) };
    const cdlYears = Object.keys(add).filter((y) => f.crops?.[y] == null).map(Number);
    return { ...f, crops, cdlYears: [...new Set([...(f.cdlYears || []), ...cdlYears])].sort() };
  });
}
