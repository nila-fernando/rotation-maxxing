// Ready-made field outlines the farmer can click instead of drawing:
//   usda  USDA NASS Crop Sequence Boundaries (public domain)
//   ai    Fields of The World, a machine-learning model on Sentinel-2 imagery
// The demo county (Story County, Iowa) ships as static GeoJSON with 8 years of crop history
// (2018-2025); everywhere else the outlines are read live from public tiles (liveOutlines.js),
// which carry only the 2023 crop (USDA) or none (AI).
//
// Every layer has the same shape: { key, live, items, byId, bbox, attribution?, ensure(), subscribe() }
import { bboxOf, labelPoint } from './geometry.js';
import { liveLayer } from './liveOutlines.js';
import { asset } from '../ui/asset.js';

export const OUTLINE_LAYERS = {
  usda: { label: 'USDA', url: asset('/data/fields/story-ia-usda.geojson'), long: 'USDA crop field outlines' },
  ai: { label: 'AI', url: asset('/data/fields/story-ia-ai.geojson'), long: 'AI-detected fields (Fields of The World)' },
};
const SOURCES_URL = asset('/data/fields/sources.json');
/** Extent of the bundled demo-county files, so we only download them for a farm inside it. */
const BUNDLED_EXTENT = [-93.6986, 41.8589, -93.2297, 42.2099];

const cache = new Map();
let sourcesPromise = null;

/**
 * Loads one outline layer (once). Resolves to null when the layer isn't available.
 * @returns {Promise<null | {key, items: {id, geometry, acres, crops, label: [number, number], bbox}[], bbox: number[], byId: Map}>}
 */
export function loadOutlines(key) {
  if (!OUTLINE_LAYERS[key]) return Promise.resolve(null);
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      try {
        const res = await fetch(OUTLINE_LAYERS[key].url);
        if (!res.ok) return null;
        const json = await res.json();
        const items = [];
        const all = [Infinity, Infinity, -Infinity, -Infinity];
        for (const f of json.features || []) {
          const g = f.geometry;
          if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
          const p = f.properties || {};
          const bbox = bboxOf(g);
          all[0] = Math.min(all[0], bbox[0]); all[1] = Math.min(all[1], bbox[1]);
          all[2] = Math.max(all[2], bbox[2]); all[3] = Math.max(all[3], bbox[3]);
          items.push({
            id: String(p.id ?? `${key}-${items.length}`),
            geometry: g,
            acres: typeof p.acres === 'number' ? p.acres : null,
            crops: p.crops || null,
            label: labelPoint(g),
            bbox,
          });
        }
        if (!items.length) return null;
        return {
          key, live: false, items, bbox: all, byId: new Map(items.map((it) => [it.id, it])),
          ensure: async () => ({ tooFar: false }), // all loaded already
          subscribe: () => () => {},
        };
      } catch {
        return null;
      }
    })());
  }
  return cache.get(key);
}

/** Attribution lines and details for the outline layers, from sources.json (if it's there). */
export function loadSources() {
  sourcesPromise ||= fetch(SOURCES_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return sourcesPromise;
}

/**
 * The outlines to use around a place: the bundled demo-county layer when the place is in it
 * (better: 8 years of crop history), otherwise the live layer for anywhere.
 */
export async function outlinesFor(key, place) {
  const here = [place.lon, place.lat];
  if (covers({ bbox: BUNDLED_EXTENT }, here)) {
    const bundled = await loadOutlines(key);
    if (bundled && covers(bundled, here)) return bundled;
  }
  return liveLayer(key);
}

/** True when the point is inside the area a layer covers. */
export function covers(layer, [lng, lat]) {
  if (!layer) return false;
  const [w, s, e, n] = layer.bbox;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

/** "Corn → Soybeans → Corn" for the last few years, newest last. */
export function cropSummary(crops, years = 3) {
  if (!crops) return '';
  const ys = Object.keys(crops).sort().slice(-years);
  if (!ys.length) return '';
  const short = (c) => String(c).replace(/\s*\/.*$/, '').replace(/^Other /, '');
  if (ys.length === 1) return `${short(crops[ys[0]])} (${ys[0]})`;
  return `${ys.map((y) => short(crops[y])).join(' → ')} (${ys[0]}–${ys[ys.length - 1].slice(-2)})`;
}

/** The crop in the newest year, e.g. "Corn 2025". */
export function latestCrop(crops) {
  if (!crops) return '';
  const y = Object.keys(crops).sort().pop();
  return y ? `${crops[y]} ${y}` : '';
}
