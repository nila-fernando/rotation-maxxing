// Pure geometry helpers for the farm-field editor.
//
// All geometry is GeoJSON Polygon / MultiPolygon geometry objects in WGS84
// ([lng, lat] positions, closed rings). No function mutates its inputs.
//
// Planar work (splitting, label points, lasso tests) is done directly in
// lng/lat degrees. Topology is invariant under the affine scaling between
// degrees and local metres, so this is exact for topology; metric quantities
// (distances, tolerances) use a local equirectangular approximation.

import * as turf from '@turf/turf';
import Flatbush from 'flatbush';

const SQ_M_PER_ACRE = 4046.8564224;
const EARTH_RADIUS_M = 6371008.8;
const M_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M; // ~111195 m per degree of latitude
const RAD = Math.PI / 180;
const SLIVER_ACRES = 0.05;

// ---------------------------------------------------------------------------
// Small internal helpers

const isPolygonal = (g) =>
  !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && Array.isArray(g.coordinates);

const clonePos = (p) => [p[0], p[1]];
const cloneRings = (rings) => rings.map((r) => r.map(clonePos));
const cloneGeometry = (g) =>
  g.type === 'Polygon'
    ? { type: 'Polygon', coordinates: cloneRings(g.coordinates) }
    : { type: 'MultiPolygon', coordinates: g.coordinates.map(cloneRings) };

/** Array of polygons (each an array of rings) regardless of geometry type. */
const partsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

const samePos = (a, b) => a[0] === b[0] && a[1] === b[1];

function closeRing(ring) {
  const r = ring.map(clonePos);
  if (r.length && !samePos(r[0], r[r.length - 1])) r.push(clonePos(r[0]));
  return r;
}

function ringsBbox(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Even-odd point-in-polygon over all rings (outer + holes). */
function pointInRings(pt, rings) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function signedArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function distToSegmentSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return { d2: cx * cx + cy * cy, t };
}

/**
 * A point strictly inside a polygon (rings = outer + holes), chosen as the
 * scanline-interval midpoint with the largest clearance from the boundary.
 */
function interiorPoint(rings) {
  const [minX, minY, maxX, maxY] = ringsBbox(rings);
  const kx = Math.cos(((minY + maxY) / 2) * RAD);
  const N = 24;
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < N; i++) {
    const y = minY + ((i + 0.5) / N) * (maxY - minY);
    const xs = [];
    for (const ring of rings) {
      for (let k = 0; k + 1 < ring.length; k++) {
        const a = ring[k], b = ring[k + 1];
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const halfW = ((xs[k + 1] - xs[k]) / 2) * kx;
      if (!(halfW > 0) || halfW <= bestScore) continue;
      const mx = (xs[k] + xs[k + 1]) / 2;
      let d2 = Infinity;
      for (const ring of rings) {
        for (let j = 0; j + 1 < ring.length; j++) {
          const a = ring[j], b = ring[j + 1];
          const r = distToSegmentSq(mx * kx, y, a[0] * kx, a[1], b[0] * kx, b[1]).d2;
          if (r < d2) d2 = r;
        }
      }
      const score = Math.sqrt(d2);
      if (score > bestScore) {
        bestScore = score;
        best = [mx, y];
      }
    }
  }
  return best;
}

function largestPart(geometry) {
  const parts = partsOf(geometry);
  if (parts.length === 1) return parts[0];
  let best = parts[0], bestArea = -1;
  for (const p of parts) {
    const a = turf.area({ type: 'Polygon', coordinates: p });
    if (a > bestArea) {
      bestArea = a;
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Measurement & display

/** Geodesic area in acres. */
export function acresOf(geometry) {
  if (!isPolygonal(geometry)) return 0;
  return turf.area(geometry) / SQ_M_PER_ACRE;
}

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "1,240 ac", "78 ac", "4.5 ac" (under 10), "<1 ac" for any positive area under 1 acre. */
export function formatAcres(acres) {
  if (!Number.isFinite(acres) || acres <= 0) return '0 ac';
  if (acres < 1) return '<1 ac';
  if (acres < 9.95) {
    const s = acres.toFixed(1);
    return `${s.endsWith('.0') ? s.slice(0, -2) : s} ac`;
  }
  return `${intFmt.format(Math.round(acres))} ac`;
}

/** A point guaranteed inside the shape (largest part for MultiPolygon). */
export function labelPoint(geometry) {
  const rings = largestPart(geometry);
  const poly = { type: 'Polygon', coordinates: rings };
  const c = turf.centerOfMass(poly).geometry.coordinates;
  if (Number.isFinite(c[0]) && Number.isFinite(c[1]) && pointInRings(c, rings)) return [c[0], c[1]];
  const p = interiorPoint(rings);
  if (p) return p;
  const f = turf.pointOnFeature(poly).geometry.coordinates;
  return [f[0], f[1]];
}

/** [west, south, east, north] */
export function bboxOf(geometry) {
  const b = turf.bbox(geometry);
  return [b[0], b[1], b[2], b[3]];
}

// ---------------------------------------------------------------------------
// Merge

function polygonsOfUnion(geom) {
  if (!geom) return [];
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
}

/** Drop holes that are gaps between the inputs (not holes of either input) and thin or tiny. */
function dropGapHoles(rings, inputs, gapMeters) {
  const [outer, ...holes] = rings;
  const kept = holes.filter((hole) => {
    const hp = interiorPoint([hole]);
    if (!hp) return false;
    const inInputHole = inputs.some((g) =>
      partsOf(g).some((part) => part.slice(1).some((h) => pointInRings(hp, [h])))
    );
    if (inInputHole) return true;
    const holePoly = turf.polygon([hole]);
    const area = turf.area(holePoly);
    const perim = turf.length(turf.polygonToLine(holePoly), { units: 'meters' });
    const meanWidth = perim > 0 ? (2 * area) / perim : 0;
    return !(area / SQ_M_PER_ACRE < SLIVER_ACRES || meanWidth <= gapMeters);
  });
  return [outer, ...kept];
}

function tidyPolygon(rings) {
  let g = turf.cleanCoords(turf.polygon(rings));
  // ~1 cm in degrees: removes near-duplicate vertices left over from buffering.
  g = turf.simplify(g, { tolerance: 1e-7, highQuality: true, mutate: false });
  return g.geometry;
}

/**
 * Union of two fields. If the union is in several pieces, close gaps up to
 * gapMeters (buffer out then back in, metric via turf.buffer) and retry.
 */
export function mergeGeometries(a, b, { gapMeters = 2 } = {}) {
  if (!isPolygonal(a) || !isPolygonal(b)) return { error: 'invalid' };
  try {
    const fa = turf.feature(a), fb = turf.feature(b);
    const plain = turf.union(turf.featureCollection([fa, fb]));
    if (!plain) return { error: 'invalid' };
    const plainGeom = plain.geometry;
    const plainParts = polygonsOfUnion(plainGeom);
    if (plainParts.length === 0) return { error: 'invalid' };
    if (plainParts.length === 1) {
      return { geometry: tidyPolygon(dropGapHoles(plainParts[0], [a, b], gapMeters)) };
    }
    if (!(gapMeters > 0)) return { error: 'not-touching' };

    const r = gapMeters / 2 + 0.01;
    const out = turf.buffer(plain, r, { units: 'meters', steps: 8 });
    if (!out || polygonsOfUnion(out.geometry).length !== 1) return { error: 'not-touching' };
    const closed = turf.buffer(out, -r, { units: 'meters', steps: 8 });
    if (!closed) return { error: 'not-touching' };
    const joined = turf.union(turf.featureCollection([fa, fb, closed]));
    const parts = polygonsOfUnion(joined && joined.geometry);
    if (parts.length !== 1) return { error: 'not-touching' };
    const geometry = tidyPolygon(dropGapHoles(parts[0], [a, b], gapMeters));

    // Sanity: closing must only add gap slivers, not noticeably grow the field.
    const base = turf.area(plainGeom);
    const perim = Math.min(
      turf.length(turf.polygonToLine(fa), { units: 'meters' }),
      turf.length(turf.polygonToLine(fb), { units: 'meters' })
    );
    if (turf.area(geometry) > base * 1.01 + gapMeters * perim) return { error: 'not-touching' };
    return { geometry };
  } catch {
    return { error: 'invalid' };
  }
}

// ---------------------------------------------------------------------------
// Split

const keyOf = (p) => `${p[0]},${p[1]}`;

/**
 * Split one polygon (rings) by a polyline. Returns { faces, crossings } where
 * faces is an array of polygon ring arrays (holes preserved, outer CCW).
 */
function splitRings(rings, cut) {
  const T_EPS = 1e-9;
  const ringSegs = [];
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      if (!samePos(ring[i], ring[i + 1])) ringSegs.push({ a: ring[i], b: ring[i + 1], splits: [] });
    }
  }
  const cutSegs = [];
  for (let i = 0; i + 1 < cut.length; i++) {
    if (!samePos(cut[i], cut[i + 1])) cutSegs.push({ a: cut[i], b: cut[i + 1], splits: [] });
  }

  const crossingKeys = new Set();
  const intersect = (s, o, isRing) => {
    const d1x = s.b[0] - s.a[0], d1y = s.b[1] - s.a[1];
    const d2x = o.b[0] - o.a[0], d2y = o.b[1] - o.a[1];
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) <= 1e-12 * Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)) return;
    const ex = o.a[0] - s.a[0], ey = o.a[1] - s.a[1];
    const t = (ex * d2y - ey * d2x) / den;
    const u = (ex * d1y - ey * d1x) / den;
    if (t < -T_EPS || t > 1 + T_EPS || u < -T_EPS || u > 1 + T_EPS) return;
    let p;
    if (u <= T_EPS) p = o.a;
    else if (u >= 1 - T_EPS) p = o.b;
    else if (t <= T_EPS) p = s.a;
    else if (t >= 1 - T_EPS) p = s.b;
    else p = [s.a[0] + t * d1x, s.a[1] + t * d1y];
    s.splits.push({ t, p });
    o.splits.push({ t: u, p });
    if (isRing) crossingKeys.add(keyOf(p));
  };
  for (let i = 0; i < cutSegs.length; i++) {
    for (const rs of ringSegs) intersect(cutSegs[i], rs, true);
    for (let j = i + 2; j < cutSegs.length; j++) intersect(cutSegs[i], cutSegs[j], false);
  }
  if (crossingKeys.size < 2) return { faces: [], crossings: crossingKeys.size };

  // Build the planar graph.
  const nodes = new Map(); // key -> { p, adj: Set<key> }
  const node = (p) => {
    const k = keyOf(p);
    let n = nodes.get(k);
    if (!n) nodes.set(k, (n = { k, p, adj: new Set() }));
    return n;
  };
  for (const s of [...ringSegs, ...cutSegs]) {
    const pts = [{ t: 0, p: s.a }, ...s.splits, { t: 1, p: s.b }].sort((x, y) => x.t - y.t);
    for (let i = 0; i + 1 < pts.length; i++) {
      const u = node(pts[i].p), v = node(pts[i + 1].p);
      if (u === v) continue;
      u.adj.add(v.k);
      v.adj.add(u.k);
    }
  }

  const removeEdge = (uk, vk) => {
    nodes.get(uk)?.adj.delete(vk);
    nodes.get(vk)?.adj.delete(uk);
  };
  const pruneDangles = () => {
    const stack = [...nodes.values()].filter((n) => n.adj.size <= 1);
    while (stack.length) {
      const n = stack.pop();
      if (!nodes.has(n.k)) continue;
      for (const vk of [...n.adj]) {
        const v = nodes.get(vk);
        removeEdge(n.k, vk);
        if (v && v.adj.size <= 1) stack.push(v);
      }
      nodes.delete(n.k);
    }
  };

  let cycles;
  for (let guard = 0; guard < 1000; guard++) {
    pruneDangles();
    // Sort neighbours by angle around each node.
    for (const n of nodes.values()) {
      n.sorted = [...n.adj].sort((ak, bk) => {
        const a = nodes.get(ak).p, b = nodes.get(bk).p;
        return Math.atan2(a[1] - n.p[1], a[0] - n.p[0]) - Math.atan2(b[1] - n.p[1], b[0] - n.p[0]);
      });
      n.idx = new Map(n.sorted.map((k, i) => [k, i]));
    }
    // Trace faces (face on the left of each half-edge; bounded faces come out CCW).
    const visited = new Set();
    cycles = [];
    const bridges = [];
    for (const u of nodes.values()) {
      for (const vk of u.sorted) {
        if (visited.has(u.k + '>' + vk)) continue;
        const keys = [];
        const half = new Set();
        let a = u, bk = vk;
        for (let steps = 0; steps < 1e6; steps++) {
          const he = a.k + '>' + bk;
          if (visited.has(he)) break;
          visited.add(he);
          half.add(he);
          keys.push(a.k);
          const b = nodes.get(bk);
          const i = b.idx.get(a.k);
          const nextK = b.sorted[(i - 1 + b.sorted.length) % b.sorted.length];
          a = b;
          bk = nextK;
        }
        for (const he of half) {
          const [x, y] = he.split('>');
          if (x < y && half.has(y + '>' + x)) bridges.push([x, y]);
        }
        cycles.push(keys);
      }
    }
    if (!bridges.length) break;
    for (const [x, y] of bridges) removeEdge(x, y);
  }

  // Connected components.
  const comp = new Map();
  let c = 0;
  for (const n of nodes.values()) {
    if (comp.has(n.k)) continue;
    const stack = [n.k];
    comp.set(n.k, c);
    while (stack.length) {
      const k = stack.pop();
      for (const vk of nodes.get(k).adj) {
        if (!comp.has(vk)) {
          comp.set(vk, c);
          stack.push(vk);
        }
      }
    }
    c++;
  }

  const ringOf = (keys) => {
    const r = keys.map((k) => clonePos(nodes.get(k).p));
    r.push(clonePos(r[0]));
    return r;
  };
  const faces = [];
  const outers = [];
  for (const keys of cycles) {
    if (keys.length < 3) continue;
    const ring = ringOf(keys);
    const area = signedArea(ring);
    if (area > 0) faces.push({ rings: [ring], area, comp: comp.get(keys[0]) });
    else if (area < 0) outers.push({ ring, comp: comp.get(keys[0]) });
  }
  // A component's outer boundary inside another component's face is a hole of that face.
  for (const o of outers) {
    let host = null;
    for (const f of faces) {
      if (f.comp === o.comp) continue;
      if (pointInRings(o.ring[0], [f.rings[0]]) && (!host || f.area < host.area)) host = f;
    }
    if (host) host.rings.push(o.ring);
  }
  const kept = faces
    .map((f) => f.rings)
    .filter((fr) => {
      const ip = interiorPoint(fr);
      return ip && pointInRings(ip, rings);
    });
  return { faces: kept, crossings: crossingKeys.size };
}

function toLineCoords(line) {
  if (!line) return null;
  if (line.type === 'Feature') return toLineCoords(line.geometry);
  if (line.type === 'LineString') return line.coordinates;
  return Array.isArray(line) ? line : null;
}

/**
 * Split a field with a user-drawn polyline. Parts are Polygons; slivers under
 * 0.05 ac are dropped. Holes are kept in whichever part contains them.
 */
export function splitGeometry(geometry, line) {
  const cut = toLineCoords(line);
  if (!isPolygonal(geometry) || !Array.isArray(cut) || cut.length < 2) return { error: 'invalid' };
  if (!cut.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
    return { error: 'invalid' };
  }
  try {
    const parts = partsOf(geometry);
    const results = parts.map((rings) => {
      const { faces } = splitRings(rings, cut);
      return faces
        .map((fr) => ({ type: 'Polygon', coordinates: fr }))
        .filter((g) => acresOf(g) >= SLIVER_ACRES);
    });
    const crossed = results.map((r, i) => (r.length >= 2 ? i : -1)).filter((i) => i >= 0);
    if (crossed.length === 0) return { error: 'no-cross' };
    if (crossed.length > 1) return { error: 'multi' };
    const out = [];
    parts.forEach((rings, i) => {
      if (i === crossed[0]) out.push(...results[i]);
      else out.push({ type: 'Polygon', coordinates: cloneRings(rings) });
    });
    return { parts: out };
  } catch {
    return { error: 'invalid' };
  }
}

// ---------------------------------------------------------------------------
// Construction & validation

/** Circle polygon for center-pivot fields. */
export function circleGeometry(center, radiusMeters, steps = 72) {
  return turf.circle([center[0], center[1]], radiusMeters, { steps, units: 'meters' }).geometry;
}

/** >= 3 distinct vertices per ring, no self-intersections, positive area. */
export function isSimplePolygon(geometry) {
  if (!isPolygonal(geometry)) return false;
  try {
    for (const rings of partsOf(geometry)) {
      if (!rings.length) return false;
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4 || !samePos(ring[0], ring[ring.length - 1])) return false;
        if (!ring.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return false;
        if (new Set(ring.slice(0, -1).map(keyOf)).size < 3) return false;
        if (Math.abs(signedArea(ring)) === 0) return false;
      }
    }
    if (turf.kinks(geometry).features.length > 0) return false;
    return turf.area(geometry) > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Snapping

/**
 * Spatial index over all ring segments of many fields.
 * query([lng, lat], toleranceMeters, { excludeId }) -> { point, kind, id } | null
 */
export function createSnapIndex(items) {
  const segs = []; // flat: ax, ay, bx, by
  const segItem = [];
  const ids = [];
  (items || []).forEach((item, itemIdx) => {
    ids.push(item.id);
    if (!isPolygonal(item.geometry)) return;
    for (const rings of partsOf(item.geometry)) {
      for (const ring of rings) {
        for (let i = 0; i + 1 < ring.length; i++) {
          segs.push(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
          segItem.push(itemIdx);
        }
      }
    }
  });
  const n = segItem.length;
  let index = null;
  if (n > 0) {
    index = new Flatbush(n);
    for (let i = 0; i < n; i++) {
      const ax = segs[4 * i], ay = segs[4 * i + 1], bx = segs[4 * i + 2], by = segs[4 * i + 3];
      index.add(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    }
    index.finish();
  }

  return {
    query(pt, toleranceMeters, { excludeId } = {}) {
      if (!index || !(toleranceMeters > 0)) return null;
      const [qx, qy] = pt;
      const mx = M_PER_DEG * Math.cos(qy * RAD); // metres per degree of longitude
      const my = M_PER_DEG;
      const dLng = toleranceMeters / Math.max(mx, 1e-9);
      const dLat = toleranceMeters / my;
      const hits = index.search(qx - dLng, qy - dLat, qx + dLng, qy + dLat, (i) =>
        excludeId === undefined ? true : ids[segItem[i]] !== excludeId
      );
      const tol2 = toleranceMeters * toleranceMeters;
      let bestV = null, bestVd = Infinity;
      let bestE = null, bestEd = Infinity;
      for (const i of hits) {
        const ax = (segs[4 * i] - qx) * mx, ay = (segs[4 * i + 1] - qy) * my;
        const bx = (segs[4 * i + 2] - qx) * mx, by = (segs[4 * i + 3] - qy) * my;
        const da = ax * ax + ay * ay, db = bx * bx + by * by;
        if (da < bestVd) {
          bestVd = da;
          bestV = { point: [segs[4 * i], segs[4 * i + 1]], kind: 'vertex', id: ids[segItem[i]] };
        }
        if (db < bestVd) {
          bestVd = db;
          bestV = { point: [segs[4 * i + 2], segs[4 * i + 3]], kind: 'vertex', id: ids[segItem[i]] };
        }
        const { d2, t } = distToSegmentSq(0, 0, ax, ay, bx, by);
        if (d2 < bestEd) {
          bestEd = d2;
          const lng = segs[4 * i] + t * (segs[4 * i + 2] - segs[4 * i]);
          const lat = segs[4 * i + 1] + t * (segs[4 * i + 3] - segs[4 * i + 1]);
          bestE = { point: [lng, lat], kind: 'edge', id: ids[segItem[i]] };
        }
      }
      if (bestV && bestVd <= tol2) return bestV;
      if (bestE && bestEd <= tol2) return bestE;
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Lasso

/** Ids of items whose labelPoint lies inside the lasso ring. */
export function idsInLasso(ring, items) {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const lasso = closeRing(ring);
  if (new Set(lasso.slice(0, -1).map(keyOf)).size < 3) return [];
  const [minX, minY, maxX, maxY] = ringsBbox([lasso]);
  const out = [];
  for (const item of items || []) {
    if (!isPolygonal(item.geometry)) continue;
    const [w, s, e, n] = ringsBbox(partsOf(item.geometry).map((p) => p[0]));
    if (e < minX || w > maxX || n < minY || s > maxY) continue;
    const lp = labelPoint(item.geometry);
    if (lp[0] < minX || lp[0] > maxX || lp[1] < minY || lp[1] > maxY) continue;
    if (pointInRings(lp, [lasso])) out.push(item.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Naming

const COMPASS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];

/** Compass direction of point from center; 'Middle' within 150 m. */
export function compassWord(point, center) {
  const east = (point[0] - center[0]) * M_PER_DEG * Math.cos(center[1] * RAD);
  const north = (point[1] - center[1]) * M_PER_DEG;
  if (Math.hypot(east, north) < 150) return 'Middle';
  let deg = Math.atan2(east, north) / RAD;
  if (deg < 0) deg += 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/** "North field", "North field 2", ...; 'Middle' -> "Home field". Case-insensitive collision check. */
export function autoName(point, center, existingNames) {
  const word = compassWord(point, center);
  const base = word === 'Middle' ? 'Home field' : `${word} field`;
  const taken = new Set([...(existingNames || [])].map((s) => String(s).trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

// ---------------------------------------------------------------------------
// Vertex editing

/** Unique vertices (each ring's closing duplicate skipped). */
export function vertexPaths(geometry) {
  const out = [];
  partsOf(geometry).forEach((rings, part) => {
    rings.forEach((ring, r) => {
      for (let i = 0; i < ring.length - 1; i++) {
        out.push({ path: { part, ring: r, index: i }, point: clonePos(ring[i]) });
      }
    });
  });
  return out;
}

/** Midpoint of each edge; path.index is the edge's start vertex (insert after it). */
export function midpointPaths(geometry) {
  const out = [];
  partsOf(geometry).forEach((rings, part) => {
    rings.forEach((ring, r) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        out.push({ path: { part, ring: r, index: i }, point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
      }
    });
  });
  return out;
}

function ringAt(geometry, path) {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates[path.part || 0];
  return rings && rings[path.ring || 0];
}

/** Move one vertex; moving vertex 0 also moves the closing duplicate. */
export function moveVertex(geometry, path, point) {
  const g = cloneGeometry(geometry);
  const ring = ringAt(g, path);
  if (!ring) return g;
  const last = ring.length - 1;
  const i = path.index === last ? 0 : path.index;
  if (i < 0 || i >= last) return g;
  ring[i] = clonePos(point);
  if (i === 0) ring[last] = clonePos(point);
  return g;
}

/** Insert a vertex after path.index. */
export function insertVertex(geometry, path, point) {
  const g = cloneGeometry(geometry);
  const ring = ringAt(g, path);
  if (!ring) return g;
  const i = Math.max(0, Math.min(path.index, ring.length - 2));
  ring.splice(i + 1, 0, clonePos(point));
  return g;
}

/** Remove a vertex; null if the ring would drop below 3 unique vertices. */
export function removeVertex(geometry, path) {
  const g = cloneGeometry(geometry);
  const ring = ringAt(g, path);
  if (!ring) return null;
  const unique = ring.length - 1;
  if (unique - 1 < 3) return null;
  const i = path.index === unique ? 0 : path.index;
  if (i < 0 || i >= unique) return null;
  ring.splice(i, 1);
  if (i === 0) ring[ring.length - 1] = clonePos(ring[0]);
  return g;
}
