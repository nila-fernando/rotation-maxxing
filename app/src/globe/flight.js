// Camera maths for the globe: matching the camera's height to a Leaflet zoom level, the path of
// the dive from orbit to the map, and Web-Mercator tile arithmetic. Pure functions, no Three.js,
// so `node tools/validation/validate-flight.mjs` can check them.

export const EARTH_RADIUS_M = 6371008.8;
export const FOV_DEG = 32; // vertical field of view of the globe camera
const TILE_M = 156543.03392804097; // metres per pixel of a 256 px Web-Mercator tile at zoom 0 on the equator
const RAD = Math.PI / 180;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/** Ground metres per screen pixel of a Leaflet map at `zoom` and latitude `lat`. */
export const metresPerPixel = (zoom, lat) => (TILE_M * Math.cos(lat * RAD)) / 2 ** zoom;

/**
 * Camera height above the surface (in Earth radii) at which the ground straight below the camera
 * is drawn at the same scale as a Leaflet map at `zoom`, in a viewport `viewportH` CSS pixels tall.
 */
export function altitudeForZoom(zoom, lat, viewportH, fovDeg = FOV_DEG) {
  return (metresPerPixel(zoom, lat) * viewportH) / (2 * Math.tan((fovDeg * RAD) / 2) * EARTH_RADIUS_M);
}

/** The inverse: which Leaflet zoom matches a camera `altitude` (Earth radii) above latitude `lat`. */
export function zoomForAltitude(altitude, lat, viewportH, fovDeg = FOV_DEG) {
  const mpp = (altitude * 2 * Math.tan((fovDeg * RAD) / 2) * EARTH_RADIUS_M) / viewportH;
  return Math.log2((TILE_M * Math.cos(lat * RAD)) / mpp);
}

/** Shortest signed difference between two longitudes, in (-180, 180]. */
export function lonDelta(from, to) {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Great-circle angle between two places, in degrees. */
export function angleBetween(a, b) {
  const s = Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return Math.acos(clamp(s, -1, 1)) / RAD;
}

export const distanceKm = (a, b) => (angleBetween(a, b) * RAD * EARTH_RADIUS_M) / 1000;

/**
 * A flight of the camera from one pose to another. A pose is { lat, lon, alt } (alt in Earth radii
 * above the surface). The camera turns towards the target first and descends mostly afterwards;
 * height is blended in log space so the zoom feels even. A long turn rises first (`hop`), like a
 * plane, so the whole journey stays in view.
 *
 * @returns {{ duration: number, at: (t: number) => { lat: number, lon: number, alt: number, turn: number, drop: number } }}
 */
export function planFlight(from, to, { duration, minDuration = 1400, maxDuration = 4200 } = {}) {
  const angle = angleBetween(from, to);
  const dLon = lonDelta(from.lon, to.lon);
  const zoomSpan = Math.abs(Math.log2(from.alt / to.alt));
  const ms = duration ?? clamp(900 + angle * 9 + zoomSpan * 420, minDuration, maxDuration);
  const descending = to.alt < from.alt;
  // how much of the flight the turn takes: a pure zoom needs none, a long way round needs most of it
  const turnShare = clamp(0.25 + angle / 140, 0.3, 0.8);
  // a long turn starting low rises first, so the Earth is seen whole on the way
  const cruise = clamp(0.55 + angle / 60, 0.55, 3.2);
  const hop = Math.max(0, Math.log(cruise / Math.max(from.alt, to.alt)));
  const hopping = hop > 0.3;
  const logA = Math.log(from.alt);
  const logB = Math.log(to.alt);
  return {
    duration: ms,
    angle,
    at(t) {
      const k = clamp(t, 0, 1);
      let turn;
      if (hopping) turn = easeInOutCubic(clamp((k - 0.12) / 0.76, 0, 1)); // turn while high
      else if (descending) turn = easeInOutCubic(clamp(k / turnShare, 0, 1));
      else turn = easeInOutCubic(clamp((k - (1 - turnShare)) / turnShare, 0, 1));
      const drop = descending ? easeInOutSine(clamp((k - turnShare * 0.45) / (1 - turnShare * 0.45), 0, 1)) : easeInOutSine(clamp(k / (1 - turnShare * 0.45), 0, 1));
      const alt = Math.exp(lerp(logA, logB, drop) + hop * Math.sin(Math.PI * easeInOutSine(k)));
      return { lat: lerp(from.lat, to.lat, turn), lon: from.lon + dLon * turn, alt, turn, drop };
    },
  };
}

/**
 * How far the globe has turned into the map: 0 from orbit, 1 at the hand-off height. It ramps over
 * the last stretch of the descent (a factor of `span` in height), whatever the hand-off zoom is.
 */
export function diveAmount(alt, handoffAlt, span = 4.5) {
  return 1 - smoothstep(0, 1, Math.log(alt / handoffAlt) / Math.log(span));
}

// ---------------------------------------------------------------- Web-Mercator tiles
/** Normalised Web-Mercator position of a place: x and y in 0..1, y = 0 at the north edge. */
export function mercator(lat, lon) {
  const phi = clamp(lat, -85.0511, 85.0511) * RAD;
  return { x: (lon + 180) / 360, y: 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI) };
}

/**
 * The block of tiles to paint onto the globe around a place: `size` × `size` tiles at integer zoom
 * `z`, centred on it. Columns may run past the antimeridian (take `x mod 2^z`); rows are kept
 * inside the map.
 *
 * @returns {{ z: number, x0: number, y0: number, size: number, n: number, rect: [number, number, number, number] }}
 *   rect = [west x, north y, width, height] of the block in normalised Mercator units
 */
export function tileBlock(lat, lon, z, size) {
  const n = 2 ** z;
  const span = Math.min(size, n);
  const m = mercator(lat, lon);
  const x0 = Math.round(m.x * n - span / 2);
  const y0 = clamp(Math.round(m.y * n - span / 2), 0, n - span);
  return { z, x0, y0, size: span, n, rect: [((x0 % n) + n) % n / n, y0 / n, span / n, span / n] };
}

/** Leaflet-style zoom at which `bounds` ([[south, west], [north, east]]) fits a `w` × `h` px viewport. */
export function zoomForBounds(bounds, w, h, maxZoom = 16) {
  const [[s, wLon], [nLat, e]] = bounds;
  const a = mercator(nLat, wLon);
  const b = mercator(s, e);
  const dx = Math.max(1e-9, Math.abs(b.x - a.x));
  const dy = Math.max(1e-9, Math.abs(b.y - a.y));
  return clamp(Math.min(Math.log2(w / (256 * dx)), Math.log2(h / (256 * dy))), 0, maxZoom);
}
