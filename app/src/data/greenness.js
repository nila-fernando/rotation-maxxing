// Last season's greenness (NDVI) for each field from NASA HLS (Harmonized Landsat Sentinel-2,
// 30 m), via Microsoft Planetary Computer's keyless STAC search and data API (CORS open).
//
//   fillNdvi(fields)  ->  Promise<{ [fieldId]: [{ date, value }] }>   fields that already have one are skipped
//
// Season: April-October of the latest finished season (this year from November on, else last year).
// Clear passes only (scene cloud cover under 20%), the clearest one per ~3 weeks: up to 9 dates.
// Per field and pass, the data API's mean red and near-infrared over the outline (HLS S30: B04 and
// B8A; L30: B04 and B05), then NDVI = (nir - red) / (nir + red) of those means. The data API takes
// one field per request and ~10 s each, several side by side; the loading screen waits for it.
import { Unreachable, assertAnswered, fetchRetry } from './net.js';

export const PC = 'https://planetarycomputer.microsoft.com/api';
const COLLECTIONS = { 'hls2-s30': 'B8A', 'hls2-l30': 'B05' };
const MAX_CLOUD = 20;
const BIN_DAYS = 21;
const CONCURRENCY = 6;
const ATTEMPTS = 2;
const STATS_TIMEOUT_MS = 30000; // about 10 s each is normal
const SEARCH_TIMEOUT_MS = 20000;
const CACHE_PREFIX = 'ndvi:v1:';

/** The latest finished April-October season. */
export function lastSeason(now = new Date()) {
  const year = now.getMonth() >= 10 ? now.getFullYear() : now.getFullYear() - 1;
  return { year, start: `${year}-04-01T00:00:00Z`, end: `${year}-10-31T23:59:59Z` };
}

/** The clearest pass per BIN_DAYS window, oldest first. */
export function pickPasses(items, seasonStart) {
  const t0 = Date.parse(seasonStart);
  const best = new Map();
  for (const it of items) {
    const t = Date.parse(it.properties?.datetime);
    const cloud = it.properties?.['eo:cloud_cover'];
    if (!Number.isFinite(t) || !Number.isFinite(cloud) || !COLLECTIONS[it.collection]) continue;
    const bin = Math.floor((t - t0) / (BIN_DAYS * 86400000));
    const cur = best.get(bin);
    if (!cur || cloud < cur.properties['eo:cloud_cover']) best.set(bin, it);
  }
  return [...best.values()].sort((a, b) => Date.parse(a.properties.datetime) - Date.parse(b.properties.datetime));
}

/** NDVI from the data API's statistics response, or null. */
export function ndviFromStats(json, nirBand) {
  const st = json?.properties?.statistics;
  const red = st?.B04_b1, nir = st?.[`${nirBand}_b1`];
  if (!red?.count || !nir?.count || !Number.isFinite(red.mean) || !Number.isFinite(nir.mean) || red.mean + nir.mean <= 0) return null;
  const v = (nir.mean - red.mean) / (nir.mean + red.mean);
  return v >= -0.2 && v <= 1 ? Math.round(v * 100) / 100 : null;
}

const cache = {
  get(k) { try { return localStorage.getItem(CACHE_PREFIX + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(CACHE_PREFIX + k, v); } catch { /* fine */ } },
};

function bboxPolygon(fields) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => (typeof c[0] === 'number' ? (w = Math.min(w, c[0]), e = Math.max(e, c[0]), s = Math.min(s, c[1]), n = Math.max(n, c[1])) : c.forEach(walk));
  fields.forEach((f) => walk(f.geometry.coordinates));
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

/** One field, one pass: NDVI, or null (no clear pixels). Throws Unreachable when it doesn't answer. */
async function passNdvi(fetchFn, item, field, { signal, clock }) {
  const nir = COLLECTIONS[item.collection];
  const key = `${item.id}:${field.id}:${JSON.stringify(field.geometry.coordinates).length}`;
  const hit = cache.get(key);
  if (hit != null) return hit === 'null' ? null : Number(hit);
  const url = `${PC}/data/v1/item/statistics?collection=${item.collection}&item=${encodeURIComponent(item.id)}&assets=B04&assets=${nir}`;
  const res = assertAnswered(await fetchRetry(fetchFn, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'Feature', properties: {}, geometry: field.geometry }) },
    { timeoutMs: STATS_TIMEOUT_MS, attempts: ATTEMPTS, backoffMs: 1000, signal, clock }), 'Planetary Computer');
  let v = null;
  if (res.ok) {
    try { v = ndviFromStats(await res.json(), nir); } catch { throw new Unreachable('Planetary Computer sent an unreadable answer'); }
  }
  cache.set(key, String(v)); // (a 4xx is an answer too: nothing to read there)
  return v;
}

/**
 * Last season's NDVI per field. onField(id, state, series, reason) as each field settles: 'done' (a
 * season's curve), 'none' (too few clear passes) or 'failed' (passes that didn't answer). Throws
 * Unreachable when the scene search itself doesn't answer (every field has failed then).
 */
export async function fillNdvi(fields, { fetchFn = globalThis.fetch, now = new Date(), onField = () => {}, signal = null, clock } = {}) {
  const todo = fields.filter((f) => f?.geometry && !f.ndvi);
  for (const f of fields) if (f && !todo.includes(f)) onField(f.id, f.ndvi ? 'done' : 'none', null, null);
  if (!todo.length) return {};
  const season = lastSeason(now);
  const res = assertAnswered(await fetchRetry(fetchFn, `${PC}/stac/v1/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collections: Object.keys(COLLECTIONS), intersects: bboxPolygon(todo), datetime: `${season.start}/${season.end}`, limit: 200, query: { 'eo:cloud_cover': { lt: MAX_CLOUD } } }),
  }, { timeoutMs: SEARCH_TIMEOUT_MS, attempts: 3, backoffMs: 1000, signal, clock }), 'Planetary Computer');
  if (!res.ok) throw new Unreachable(`Planetary Computer answered HTTP ${res.status}`, { status: res.status });
  let search;
  try { search = await res.json(); } catch { throw new Unreachable('Planetary Computer sent an unreadable answer'); }
  const passes = pickPasses(search?.features || [], season.start);
  const out = {};
  if (!passes.length) {
    for (const f of todo) onField(f.id, 'none', null, 'no clear satellite passes last season');
    return out;
  }
  const jobs = todo.flatMap((f) => passes.map((item) => ({ f, item })));
  const values = new Map();
  const left = new Map(todo.map((f) => [f.id, passes.length]));
  const failed = new Map();
  const finish = (f) => {
    const series = passes
      .map((it) => ({ date: it.properties.datetime.slice(0, 10), value: values.get(`${f.id}|${it.properties.datetime.slice(0, 10)}`) }))
      .filter((p) => p.value != null);
    if (series.length >= 4) { // fewer points than that isn't a season's curve
      out[f.id] = series;
      onField(f.id, 'done', series, null);
    } else if (failed.get(f.id)) {
      onField(f.id, 'failed', null, 'Planetary Computer did not answer for some passes');
    } else {
      onField(f.id, 'none', null, 'too few clear passes last season');
    }
  };
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      if (signal?.aborted) return;
      const { f, item } = jobs[i++];
      try {
        const v = await passNdvi(fetchFn, item, f, { signal, clock });
        if (v != null) values.set(`${f.id}|${item.properties.datetime.slice(0, 10)}`, v);
      } catch {
        failed.set(f.id, (failed.get(f.id) || 0) + 1);
      }
      left.set(f.id, left.get(f.id) - 1);
      if (!left.get(f.id)) finish(f);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return out;
}

export const withNdvi = (fields, filled) => fields.map((f) => (filled[f.id] ? { ...f, ndvi: filled[f.id] } : f));
