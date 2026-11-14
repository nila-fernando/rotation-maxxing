// Where a field's coin stack can float without running into anything (a plan view's cash per field:
// src/island/coinStacks.js draws them, src/screens/planFutures.js says what they count).
//
// A stack is a column of up to 12 coins hanging over the field, high enough to clear the tallest
// crop (corn, 0.80 over the soil), the gate posts (0.48) and a centre pivot's cap (0.97). The column
// must sit well inside the field, and its box must miss every prop (the barn, the silo, trees, the
// windmill...) by its real, unshrunk box, the windmill's turning sails, the lamps, and whatever a
// festival has put up (keep-outs). When nowhere on a field is clear, there is no stack (null) and
// the field's chip carries the money instead.
//
// Plain maths on island units (x east, z south, y up); no three.js and no DOM, so node:test can
// import it. Boxes are duck-typed { min: {x, y, z}, max: {x, y, z} } (a THREE.Box3 will do).
//
//   stackSpot(field, env)    -> { x, z, baseY, top, box, edge } | null
//   stackSpots(fields, env)  -> Map id -> spot | null
//   pivotCentre(polygons)    -> [x, z] where a centre pivot's tower stands
import { boxHitsProp, sphereHitsBox } from './clearance.js';
import { distanceToEdges, footprint, pointInPolygons } from './picking.js';

export const MAX_COINS = 12;
export const COIN_PITCH = 0.065; // one coin's height plus a hair of air
export const COLUMN_HALF = 0.17; // the column is 0.34 across (a coin is 0.30)
export const EDGE_ROOM = 0.35; // the column's middle keeps this far in from the field's edge
export const PIVOT_ROOM = 0.5; // and this far from a centre pivot's tower
export const LIFT = 1.05; // the bottom coin over the soil: clears corn, the gate posts and the outline
export const PIVOT_LIFT = 1.25; // over a pivot field: clears the pivot's pipe and cap too
export const DROP_ROOM = 0.28; // room over the top coin for a new one dropping in
export const PROP_PAD = 0.1; // air kept round props (their real boxes, not shrunk) and sail balls
export const LAMP_R = 0.21; // a lamp post's reach round its middle
export const LAMP_H = 1.29; // and its height over the ground
const GRID = 7; // candidate spots across the field's bounding box when its middle won't do

/** The bottom coin's height over a field whose soil top is at topY. */
export const stackBase = (topY, pivot = false) => topY + (pivot ? PIVOT_LIFT : LIFT);

/** The column's box at (x, z): from just under the bottom coin to the drop-in room over a full stack. */
export function columnBox(x, z, baseY) {
  return {
    min: { x: x - COLUMN_HALF, y: baseY - 0.03, z: z - COLUMN_HALF },
    max: { x: x + COLUMN_HALF, y: baseY + MAX_COINS * COIN_PITCH + DROP_ROOM, z: z + COLUMN_HALF },
  };
}

const boxesMeet = (a, b) => !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y || a.max.z < b.min.z || a.min.z > b.max.z);

/** Does a lamp post (a cylinder at lamp.at, from the ground up LAMP_H) reach into the box? */
function lampHitsBox(lamp, box, heightAt) {
  const at = lamp.at || [lamp.x, lamp.z];
  const [x, z] = Array.isArray(at) ? at : [at.x, at.z];
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const ground = Number.isFinite(lamp.ground) ? lamp.ground : heightAt ? heightAt(x, z) : 0;
  if (box.max.y < ground || box.min.y > ground + LAMP_H) return false;
  const nx = Math.max(box.min.x, Math.min(x, box.max.x)), nz = Math.max(box.min.z, Math.min(z, box.max.z));
  return Math.hypot(nx - x, nz - z) < LAMP_R;
}

/** Does anything in env stand in this box? */
export function columnBlocked(box, { props = [], sails = [], lamps = [], keepOuts = [], heightAt } = {}) {
  if (props.some((p) => boxHitsProp(box, p, { shrink: 0, pad: PROP_PAD }))) return true;
  if (sails.some((s) => sphereHitsBox({ x: s.x, y: s.y, z: s.z, r: s.r + PROP_PAD }, box))) return true;
  if (lamps.some((l) => lampHitsBox(l, box, heightAt))) return true;
  return keepOuts.some((k) => boxesMeet(box, k));
}

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
};

/**
 * Where a centre pivot's tower stands: the middle of the field's biggest part, as
 * src/island/paddocks.js puts it (for a field in one piece, that's just its middle).
 */
export function pivotCentre(polygons) {
  const parts = (polygons || []).filter((rings) => rings?.[0]?.length >= 3);
  if (!parts.length) return null;
  const big = parts.reduce((a, p) => (Math.abs(ringArea(p[0])) > Math.abs(ringArea(a[0])) ? p : a));
  return footprint([[big[0]]]).center;
}

/**
 * The spots to try on a field, best first: its middle when that's well inside, then a 7 x 7 grid
 * over its bounding box (the points well inside, deepest in first). A pivot field keeps off its
 * tower (field.pivotAt, or the middle of its biggest part).
 */
export function candidates(field) {
  const fp = field.center && field.bbox ? field : footprint(field.polygons);
  const [cx, cz] = fp.center;
  const pivot = !!field.isPivot;
  const [px, pz] = pivot ? field.pivotAt || pivotCentre(field.polygons) || fp.center : [0, 0];
  const ok = (x, z) => pointInPolygons(x, z, field.polygons) && (!pivot || Math.hypot(x - px, z - pz) >= PIVOT_ROOM);
  const out = [];
  const mid = ok(cx, cz) ? distanceToEdges(cx, cz, field.polygons) : -1;
  if (mid >= EDGE_ROOM) out.push({ x: cx, z: cz, edge: mid });
  const [x0, z0, x1, z1] = fp.bbox;
  const grid = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = x0 + ((i + 0.5) / GRID) * (x1 - x0), z = z0 + ((j + 0.5) / GRID) * (z1 - z0);
      if (!ok(x, z)) continue;
      const edge = distanceToEdges(x, z, field.polygons);
      if (edge >= EDGE_ROOM) grid.push({ x, z, edge });
    }
  }
  grid.sort((a, b) => b.edge - a.edge);
  return out.concat(grid);
}

/**
 * Where this field's coin stack floats, or null when nowhere on it is clear.
 * @param {{polygons: Array, topY: number, isPivot?: boolean, pivotAt?: number[], center?: number[], bbox?: number[]}} field
 * @param {object} [env]
 * @param {Array} [env.props]     the island's placed props (view.props)
 * @param {{x, y, z, r}[]} [env.sails]   the windmill sails' reach (coinStacks.sailSpheres)
 * @param {Array} [env.lamps]     view.lamps ({ at: [x, z] })
 * @param {Array} [env.keepOuts]  boxes a festival has filled (coinStacks.themeKeepOuts)
 * @param {(x: number, z: number) => number} [env.heightAt]  the ground's height (for the lamps)
 * @returns {{x: number, z: number, baseY: number, top: number, box: object, edge: number} | null}
 */
export function stackSpot(field, env = {}) {
  if (!field?.polygons?.length || !Number.isFinite(field.topY)) return null;
  const baseY = stackBase(field.topY, !!field.isPivot);
  for (const c of candidates(field)) {
    const box = columnBox(c.x, c.z, baseY);
    if (columnBlocked(box, env)) continue;
    return { x: c.x, z: c.z, baseY, top: box.max.y, box, edge: c.edge };
  }
  return null;
}

/** Every field's spot: Map id -> spot | null. */
export function stackSpots(fields, env = {}) {
  return new Map((fields || []).map((f) => [f.id, stackSpot(f, env)]));
}
