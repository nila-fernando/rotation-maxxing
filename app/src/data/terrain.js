// Each field's mean slope from elevation tiles: AWS Terrain Tiles (terrarium PNGs, keyless, CORS
// open). In the US the tiles are USGS 3DEP (about 10 m); elsewhere NASA SRTM.
//
//   fillSlope(fields)  ->  Promise<{ [fieldId]: slopePct }>   fields that already have one are skipped
//
// Zoom 14 (about 7 m pixels at 42° N). Slope per pixel by Horn's method over its 3x3 neighbours,
// averaged over the pixels whose centres fall inside the field. Pixels on a tile's edge are left out
// (no neighbours there), which is a thin strip and doesn't bias the mean.
import { bbox as bboxOf, booleanPointInPolygon } from '@turf/turf';
import { assertAnswered, fetchRetry, pool } from './net.js';

export const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const Z = 14;
const SIZE = 256;
const EARTH_M = 40075016.686;
const MAX_TILES = 16; // a field bigger than this many tiles (about 30 km²) isn't a field
const TILE_CONCURRENCY = 6;
const TIMEOUT_MS = 10000;
const ATTEMPTS = 3;

const tileX = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
const pxLng = (x, z) => (x / (SIZE * 2 ** z)) * 360 - 180;
const pxLat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / (SIZE * 2 ** z); return (180 / Math.PI) * Math.atan(Math.sinh(n)); };

/** Terrarium RGBA -> metres: R*256 + G + B/256 - 32768. */
export function decodeTerrarium(rgba) {
  const out = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  return out;
}

/** Browser PNG decode to RGBA. */
async function decodePng(blob) {
  const bmp = await createImageBitmap(blob);
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(SIZE, SIZE) : Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

/**
 * One tile's elevations (metres, row-major 256x256), or null when there's no tile there (a 4xx).
 * Throws Unreachable when the tile server doesn't answer (each try times out; tried again).
 */
async function fetchTile(z, x, y, fetchFn, decode, { signal = null, clock } = {}) {
  const res = assertAnswered(await fetchRetry(fetchFn, TILE_URL(z, x, y), {}, { timeoutMs: TIMEOUT_MS, attempts: ATTEMPTS, backoffMs: 400, signal, clock }), 'The elevation tiles');
  if (!res.ok) return null;
  try {
    return decodeTerrarium(await decode(await res.blob()));
  } catch {
    return null; // not a readable tile
  }
}

/**
 * Mean slope (%) over a field, or null (no tiles there, or the field covers no full pixel). Throws
 * Unreachable when any of its tiles couldn't be fetched (rather than a slope from part of the field).
 * @param {object} geometry  GeoJSON Polygon/MultiPolygon
 * @param {object} [o] { fetchFn, decode, tiles, run, signal }  tiles: a Map cache shared across
 *   fields; run: a pool (net.js) the tile requests go through
 */
export async function fieldSlope(geometry, { fetchFn = globalThis.fetch, decode = decodePng, tiles = new Map(), run = (fn) => fn(), signal = null, clock } = {}) {
  const [w, s, e, n] = bboxOf(geometry);
  const x0 = tileX(w, Z), x1 = tileX(e, Z), y0 = tileY(n, Z), y1 = tileY(s, Z);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return null;
  // ask for every tile first (they come in side by side through the pool), then read them
  const want = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const key = `${tx}/${ty}`;
      if (!tiles.has(key)) {
        const job = run(() => fetchTile(Z, tx, ty, fetchFn, decode, { signal, clock }));
        job.catch(() => {}); // (read below; a field that doesn't need it any more mustn't warn)
        tiles.set(key, job);
      }
      want.push({ tx, ty, job: tiles.get(key) });
    }
  }
  let sum = 0, count = 0;
  for (const { tx, ty, job } of want) {
    const elev = await job;
    if (!elev) continue;
    for (let py = 1; py < SIZE - 1; py++) {
      const gy = ty * SIZE + py + 0.5;
      const lat = pxLat(gy, Z);
      if (lat > n || lat < s) continue;
      const cell = (EARTH_M * Math.cos((lat * Math.PI) / 180)) / (SIZE * 2 ** Z); // metres per pixel
      for (let px = 1; px < SIZE - 1; px++) {
        const lng = pxLng(tx * SIZE + px + 0.5, Z);
        if (lng < w || lng > e || !booleanPointInPolygon([lng, lat], geometry)) continue;
        const at = (dx, dy) => elev[(py + dy) * SIZE + (px + dx)];
        const dzdx = ((at(1, -1) + 2 * at(1, 0) + at(1, 1)) - (at(-1, -1) + 2 * at(-1, 0) + at(-1, 1))) / (8 * cell);
        const dzdy = ((at(-1, 1) + 2 * at(0, 1) + at(1, 1)) - (at(-1, -1) + 2 * at(0, -1) + at(1, -1))) / (8 * cell);
        sum += Math.hypot(dzdx, dzdy) * 100;
        count++;
      }
    }
  }
  return count ? Math.round((sum / count) * 10) / 10 : null;
}

/**
 * Mean slope for every field without one. The tiles are fetched once each, a few side by side
 * (one slow tile doesn't hold up the rest), and shared between fields. onField(id, state, pct,
 * reason) as each field settles: 'done', 'none' (no elevation there) or 'failed'.
 */
export async function fillSlope(fields, { onField = () => {}, ...o } = {}) {
  const tiles = new Map();
  const run = pool(TILE_CONCURRENCY);
  const out = {};
  await Promise.all(fields.map(async (f) => {
    if (!f?.geometry) { onField(f?.id, 'none', null, null); return; }
    if (Number.isFinite(f.slopePct)) { onField(f.id, 'done', null, null); return; }
    try {
      const pct = await fieldSlope(f.geometry, { ...o, tiles, run });
      if (pct != null) out[f.id] = pct;
      onField(f.id, pct != null ? 'done' : 'none', pct, pct != null ? null : 'no elevation data here');
    } catch (e) {
      onField(f.id, 'failed', null, e?.message || 'the elevation tiles did not answer');
    }
  }));
  return out;
}

export const withSlope = (fields, filled) => fields.map((f) => (filled[f.id] != null ? { ...f, slopePct: filled[f.id] } : f));
