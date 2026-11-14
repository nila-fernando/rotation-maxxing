// Live field outlines for any location, read straight from Source Cooperative's public PMTiles
// archives with HTTP range requests (no server of ours, no API key):
//   usda  USDA NASS Crop Sequence Boundaries 2016-2023, whole contiguous US, fiboa edition.
//         One crop per field (2023). Tiles are zoom 10 (~29 km), shapes simplified to ~7 m, and
//         neighbours that grew the same 2023 crop are merged into one shape.
//   ai    Fields of The World (model on Sentinel-2), whole-US file, zoom 13 tiles (~3.6 km). 2025
//         predictions where they exist, else 2024 (each tile keeps its newest year). No crop and no
//         confidence. The model's polygons can have pinholes and the odd sprawling web of field
//         edges; small holes are filled and webs (very low compactness) are left out.
//
// A live layer grows as the map moves: ensure(bbox) fetches the tiles under it that aren't loaded
// yet, nearest first. A field cut by a tile edge arrives in pieces (same id in each tile); pieces are
// joined as they come in, so an item can be replaced by a bigger one. Listeners hear about both.
//
// Layer shape (same as the bundled Story County layers in outlines.js):
//   { key, live: true, items, byId, attribution, ensure(bbox, {zoom}), subscribe(fn) }
//   subscribe(fn): fn({ added, replaced, before }) where before maps a replaced id to its old item
//   item: { id, geometry, acres, crops, label: [lng, lat], bbox, confidence? }
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import { feature as turfFeature, featureCollection, union } from '@turf/turf';
import { acresOf, bboxOf, labelPoint } from './geometry.js';

export const LIVE = {
  usda: {
    url: 'https://data.source.coop/fiboa/us-usda-cropland/us_usda_cropland.pmtiles',
    zoom: 10,
    layer: 'us_usda_cropland',
    maxTiles: 4,
    minViewZoom: 13, // outlines show from zoom 14; fetching starts one level early
    idOf: (props) => (props.id ? `usda23-${props.id}` : null),
    cropsOf: (props) => (props['crop:name'] ? { 2023: props['crop:name'] } : null),
    attribution: 'Field boundaries: USDA NASS Crop Sequence Boundaries 2016–2023 (public domain), via fiboa on Source Cooperative',
  },
  ai: {
    url: 'https://data.source.coop/ftw/global-data/predictions/vectors/alpha/results-by-admin-conf/admin%3Acountry_code%3DUS/US.pmtiles',
    zoom: 13,
    layer: 'features',
    maxTiles: 25,
    minViewZoom: 13,
    newestYearOnly: true,
    tidy: true,
    idOf: (props) => (props.id != null ? `ai-${props.state || 'us'}-${props.year || ''}-${props.id}` : null),
    cropsOf: () => null,
    yearOf: (props) => (props.year ? Number(props.year) : null),
    attribution: 'AI field boundaries: Fields of The World 2024–2025 (Taylor Geospatial Institute & Microsoft AI for Good), CC BY 4.0, via Source Cooperative',
  },
};

const TILE_TIMEOUT_MS = 15000;

/** Like the bundled files: slivers under an acre (road verges, yards, model noise) aren't fields. */
export const MIN_ACRES = 1;
/** Holes smaller than this inside an AI field are pinholes in the model's output, not real gaps. */
export const FILL_HOLES_ACRES = 2;
/**
 * Compactness 4πA/P² is 1 for a circle (a center pivot), about 0.5 for a 1:4 strip and 0.2 for a
 * ragged field, but near 0 for a web of field edges the model sometimes outputs. Below this: not a field.
 */
export const MIN_COMPACTNESS = 0.05;

const M_PER_DEG = 111320;
/** Outer-ring perimeter in metres (local flat approximation; fine at field scale). */
export function perimeterMeters(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const poly of polys) {
    const ring = poly[0];
    const k = Math.cos((ring[0][1] * Math.PI) / 180);
    for (let i = 1; i < ring.length; i++) {
      total += Math.hypot((ring[i][0] - ring[i - 1][0]) * M_PER_DEG * k, (ring[i][1] - ring[i - 1][1]) * M_PER_DEG);
    }
  }
  return total;
}

/** 4πA/P² from the outer ring(s): 1 = circle, near 0 = a thin web. */
export function compactness(geometry, acres = acresOf(geometry)) {
  const p = perimeterMeters(geometry);
  return p > 0 ? (4 * Math.PI * acres * 4046.86) / (p * p) : 0;
}

/** Drops inner rings (holes) smaller than `acres`. */
export function fillSmallHoles(geometry, acres) {
  const keep = (poly) => [poly[0], ...poly.slice(1).filter((ring) => acresOf({ type: 'Polygon', coordinates: [ring] }) >= acres)];
  return geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: keep(geometry.coordinates) }
    : { type: 'MultiPolygon', coordinates: geometry.coordinates.map(keep) };
}

// ------------------------------------------------------------------ tiles

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Tiles at zoom z covering bbox [w, s, e, n], nearest to its middle first. */
export function tilesFor([w, s, e, n], z) {
  const n2 = 2 ** z - 1;
  const clamp = (v) => Math.max(0, Math.min(n2, v));
  const x0 = clamp(lonToX(w, z)), x1 = clamp(lonToX(e, z));
  const y0 = clamp(latToY(n, z)), y1 = clamp(latToY(s, z));
  // the real (fractional) centre, measured to each tile's middle
  const fx = (((w + e) / 2 + 180) / 360) * 2 ** z;
  const r = (((s + n) / 2) * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  const d = ([x, y]) => Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
  return out.sort((a, b) => d(a) - d(b));
}

/** A bbox about `km` either side of [lng, lat]. */
export function bboxAround([lng, lat], km) {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

const round6 = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6] : c.map(round6));

/** Decodes one vector tile into polygon pieces: [{ id, geometry, props }]. */
export function decodeTile(cfg, data, x, y, key) {
  const vt = new VectorTile(new PbfReader(new Uint8Array(data)));
  const layer = vt.layers[cfg.layer] || Object.values(vt.layers)[0];
  if (!layer) return [];
  let keepYear = null;
  if (cfg.newestYearOnly && cfg.yearOf) {
    for (let i = 0; i < layer.length; i++) {
      const y = cfg.yearOf(layer.feature(i).properties);
      if (y && (!keepYear || y > keepYear)) keepYear = y;
    }
  }
  const out = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3) continue; // polygons only
    if (keepYear && cfg.yearOf(f.properties) !== keepYear) continue; // both years overlap: keep the newest
    const gj = f.toGeoJSON(x, y, cfg.zoom);
    const g = gj.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    out.push({
      id: cfg.idOf(f.properties, f.id) ?? `${key}-${cfg.zoom}/${x}/${y}/${i}`,
      geometry: { type: g.type, coordinates: round6(g.coordinates) },
      props: f.properties,
    });
  }
  return out;
}

/** Joins the pieces of one field (cut by tile edges) into one shape; falls back to the biggest piece. */
export function joinPieces(geometries) {
  if (geometries.length === 1) return geometries[0];
  try {
    const joined = union(featureCollection(geometries.map((g) => turfFeature(g))));
    if (joined?.geometry) return joined.geometry;
  } catch { /* fall through */ }
  return geometries.reduce((a, b) => (acresOf(b) > acresOf(a) ? b : a));
}

// ------------------------------------------------------------------ the growing layer

/**
 * @param {'usda'|'ai'} key
 * @param {{loadPieces?: (z: number, x: number, y: number) => Promise<{id, geometry, props}[]>}} [opts]
 *   loadPieces replaces the network + decoding (for tests)
 */
export function createLiveLayer(key, { loadPieces } = {}) {
  const cfg = LIVE[key];
  // pmtiles caches a failed header / directory request forever, so after any failure we start a
  // fresh archive; a request that stalls is given up after TILE_TIMEOUT_MS so it can be retried
  let archive = loadPieces ? null : new PMTiles(cfg.url);
  const resetArchive = () => { if (archive) archive = new PMTiles(cfg.url); };
  const getPieces = loadPieces || (async (z, x, y) => {
    try {
      const data = (await archive.getZxy(z, x, y, AbortSignal.timeout(TILE_TIMEOUT_MS)))?.data;
      return data ? decodeTile(cfg, data, x, y, key) : [];
    } catch (e) {
      resetArchive();
      throw e;
    }
  });
  const items = [];
  const byId = new Map();
  const indexOf = new Map(); // id -> position in items
  const pieces = new Map(); // id -> [geometry pieces]
  const tiles = new Map(); // "x/y" -> Promise
  const listeners = new Set();

  function makeItem(id, geometry, props) {
    const shape = cfg.tidy ? fillSmallHoles(geometry, FILL_HOLES_ACRES) : geometry;
    const acres = acresOf(shape);
    const item = {
      id, geometry: shape, acres, crops: cfg.cropsOf(props), label: labelPoint(shape), bbox: bboxOf(shape),
    };
    if (cfg.yearOf) item.year = cfg.yearOf(props);
    if (cfg.tidy) item.compactness = compactness(shape, acres);
    return item;
  }

  /** Fields we list: at least an acre, and (for the AI layer) not a sprawling web of edges. */
  const isField = (item) => item.acres >= MIN_ACRES && (!cfg.tidy || item.compactness >= MIN_COMPACTNESS);

  function apply(found) {
    const changed = new Map(); // id -> true if new to the list in this batch, false if a listed item grew
    const before = new Map(); // id -> the listed item as it was before this batch grew it
    for (const { id, geometry, props } of found) {
      const list = pieces.get(id) || [];
      list.push(geometry);
      pieces.set(id, list);
      const item = makeItem(id, list.length > 1 ? joinPieces(list) : geometry, props);
      // pieces are always kept (another tile may complete the field), but only fields of an acre
      // or more are listed
      if (!isField(item) && !byId.has(id)) continue;
      if (byId.has(id)) {
        if (!changed.has(id)) { changed.set(id, false); before.set(id, byId.get(id)); }
        items[indexOf.get(id)] = item;
      } else {
        indexOf.set(id, items.length);
        items.push(item);
        changed.set(id, true);
      }
      byId.set(id, item);
    }
    if (!changed.size) return;
    const added = [...changed].filter(([, isNew]) => isNew).map(([id]) => byId.get(id));
    const replaced = [...changed].filter(([, isNew]) => !isNew).map(([id]) => byId.get(id));
    listeners.forEach((fn) => fn({ added, replaced, before }));
  }

  function loadTile(x, y) {
    const k = `${x}/${y}`;
    if (!tiles.has(k)) {
      tiles.set(k, (async () => {
        try {
          apply(await getPieces(cfg.zoom, x, y));
          return true;
        } catch (e) {
          tiles.delete(k); // let a later look retry it
          throw e;
        }
      })());
    }
    return tiles.get(k);
  }

  /**
   * Loads the tiles under bbox (nearest first, capped). Resolves { tooFar } when zoomed out too far
   * to be worth it; rejects only if every tile it needed failed (e.g. offline).
   */
  async function ensure(bbox, { zoom } = {}) {
    if (zoom != null && zoom < cfg.minViewZoom) return { tooFar: true };
    const want = tilesFor(bbox, cfg.zoom).slice(0, cfg.maxTiles);
    const results = await Promise.allSettled(want.map(([x, y]) => loadTile(x, y)));
    if (results.length && results.every((r) => r.status === 'rejected')) throw results[0].reason;
    return { tooFar: false };
  }

  /** Opens the archive (header and root directory) ahead of time so the first look is quicker. */
  function warmUp() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    archive?.getHeader().catch(resetArchive);
  }

  return {
    key,
    live: true,
    items,
    byId,
    bbox: [-180, -90, 180, 90],
    attribution: cfg.attribution,
    ensure,
    warmUp,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

const shared = new Map();
/** One live layer per source for the whole visit (tiles stay cached across farms). */
export function liveLayer(key) {
  if (!shared.has(key)) shared.set(key, createLiveLayer(key));
  return shared.get(key);
}

/** Opens both archives early (while the globe spins), so the first farm's outlines arrive sooner. */
export function warmUpLiveOutlines() {
  Object.keys(LIVE).forEach((k) => liveLayer(k).warmUp());
}
