// Last season's greenness (NDVI) for each field from NASA HLS (Harmonized Landsat Sentinel-2,
// 30 m), via Microsoft Planetary Computer's keyless STAC search and data API (CORS open).
//
//   fillNdvi(fields)  ->  Promise<{ [fieldId]: [{ date, value }] }>   fields that already have one are skipped
//
// Season: April-October of the latest finished season (this year from November on, else last year).
// Clear passes only (scene cloud cover under 20%), the clearest one per ~3 weeks: up to 9 dates.
// Per field and pass, the data API's mean red and near-infrared over the outline (HLS S30: B04 and
// B8A; L30: B04 and B05), then NDVI = (nir - red) / (nir + red) of those means. The data API takes
// one field per request and ~10 s each, so this runs in the background and lands after the reveal.
export const PC = 'https://planetarycomputer.microsoft.com/api';
const COLLECTIONS = { 'hls2-s30': 'B8A', 'hls2-l30': 'B05' };
const MAX_CLOUD = 20;
const BIN_DAYS = 21;
const CONCURRENCY = 6;
const ATTEMPTS = 2;
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

async function retry(fn) {
  for (let a = 0; a < ATTEMPTS; a++) {
    try { const r = await fn(); if (r !== undefined) return r; } catch { /* try again */ }
  }
  return undefined; // never answered: not cached, so a later visit tries again
}

function bboxPolygon(fields) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => (typeof c[0] === 'number' ? (w = Math.min(w, c[0]), e = Math.max(e, c[0]), s = Math.min(s, c[1]), n = Math.max(n, c[1])) : c.forEach(walk));
  fields.forEach((f) => walk(f.geometry.coordinates));
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

/** One field, one pass: NDVI or null. */
async function passNdvi(fetchFn, item, field) {
  const nir = COLLECTIONS[item.collection];
  const key = `${item.id}:${field.id}:${JSON.stringify(field.geometry.coordinates).length}`;
  const hit = cache.get(key);
  if (hit != null) return hit === 'null' ? null : Number(hit);
  const url = `${PC}/data/v1/item/statistics?collection=${item.collection}&item=${encodeURIComponent(item.id)}&assets=B04&assets=${nir}`;
  const v = await retry(async () => {
    const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'Feature', properties: {}, geometry: field.geometry }) });
    if (res.ok) return ndviFromStats(await res.json(), nir);
    if (res.status < 500) return null;
    return undefined; // 5xx: try again
  });
  if (v !== undefined) cache.set(key, String(v));
  return v ?? null;
}

export async function fillNdvi(fields, { fetchFn = globalThis.fetch, now = new Date() } = {}) {
  const todo = fields.filter((f) => f?.geometry && !f.ndvi);
  if (!todo.length) return {};
  const season = lastSeason(now);
  const search = await retry(async () => {
    const res = await fetchFn(`${PC}/stac/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collections: Object.keys(COLLECTIONS), intersects: bboxPolygon(todo), datetime: `${season.start}/${season.end}`, limit: 200, query: { 'eo:cloud_cover': { lt: MAX_CLOUD } } }),
    });
    return res.ok ? res.json() : undefined;
  });
  const passes = pickPasses(search?.features || [], season.start);
  if (!passes.length) return {};
  const jobs = todo.flatMap((f) => passes.map((item) => ({ f, item })));
  const values = new Map();
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const { f, item } = jobs[i++];
      const v = await passNdvi(fetchFn, item, f);
      if (v != null) values.set(`${f.id}|${item.properties.datetime.slice(0, 10)}`, v);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  const out = {};
  for (const f of todo) {
    const series = passes
      .map((it) => ({ date: it.properties.datetime.slice(0, 10), value: values.get(`${f.id}|${it.properties.datetime.slice(0, 10)}`) }))
      .filter((p) => p.value != null);
    if (series.length >= 4) out[f.id] = series; // fewer points than that isn't a season's curve
  }
  return out;
}

export const withNdvi = (fields, filled) => fields.map((f) => (filled[f.id] ? { ...f, ndvi: filled[f.id] } : f));
