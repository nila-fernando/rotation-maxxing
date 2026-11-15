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
// CropScape sends no CORS header, so the browser goes through the dev/preview proxy at /cropscape
// (vite.config.js). Answers are cached in localStorage by point and year, so a reload or the same
// field picked again costs nothing. A year CropScape doesn't answer is left missing, as before.
import { booleanPointInPolygon, pointOnFeature } from '@turf/turf';
import { parseCdlValue, samplePoints, toAlbers5070 } from '../vendor/rotation-maxxing/data/cdl.ts';

export const CDL_PROXY = '/cropscape';
const CONCURRENCY = 10;
const POINTS = 3;
const ATTEMPTS = 3;
const TIMEOUT_MS = 15000;
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

/** A small pool: at most `n` lookups in flight, so CropScape isn't flooded. */
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve } = queue.shift();
    fn().then(resolve, () => resolve(null)).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve) => { queue.push({ fn, resolve }); next(); });
}

/** One CropScape lookup; null if it doesn't answer (it has intermittent 5xx errors: retried). */
async function lookup(fetchFn, base, year, [x, y]) {
  const key = `${year}:${Math.round(x)},${Math.round(y)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = `${base}/axis2/services/CDLService/GetCDLValue?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`;
  for (let a = 0; a < ATTEMPTS; a++) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (res.ok) {
        const cat = parseCdlValue(await res.text());
        if (cat) cache.set(key, cat);
        return cat;
      }
      if (res.status < 500) return null;
    } catch {
      // network error or timeout: try again
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return null;
}

/**
 * @param {object[]} fields  app fields ({ id, geometry, crops })
 * @param {object} o
 * @param {number[]} o.years            the years wanted (e.g. HISTORY_YEARS)
 * @param {(field) => object} [o.known] years already known per field from elsewhere (demo data)
 * @param {Function} [o.fetchFn]        fetch (tests pass a fake)
 * @param {string} [o.base]             CropScape origin or proxy path
 * @returns {Promise<Record<string, Record<string, string>>>} new years per field id
 */
export async function fillCropHistory(fields, { years, known = () => ({}), fetchFn = globalThis.fetch, base = CDL_PROXY }) {
  const run = limiter(CONCURRENCY);
  const out = {};
  await Promise.all(fields.map(async (f) => {
    if (!f?.geometry) return;
    const have = { ...known(f), ...(f.crops || {}) };
    const missing = years.filter((y) => have[y] == null);
    if (!missing.length) return;
    const pts = fieldPoints(f.geometry).map(toAlbers5070);
    const found = {};
    await Promise.all(missing.map(async (year) => {
      const cats = await Promise.all(pts.map((p) => run(() => lookup(fetchFn, base, year, p))));
      const cat = majority(cats);
      if (cat) found[year] = cat;
    }));
    if (Object.keys(found).length) out[f.id] = found;
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
