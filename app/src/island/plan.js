// Island planner (pure maths, no three.js).
//
// Turns the farmer's real fields (1 to 15) into the plan for one cozy low-poly island in the style
// of the prototype (team-sheeeep-assets/team-sheeeep-3d/index.html). Every field keeps its REAL
// shape and orientation; only the distances between fields are made up:
//
//   1. Levels: fields are ranked by elevation and put on terrace level 0, 1 or 2.
//   2. layout.js packs the real shapes tightly (tight mode): every field ends up one walkway from a
//      neighbour (a wider walkway between fields on different levels, room for the slope), far
//      groups slide in and get a "3.5 mi south-east" label. Nothing is left far away. A farmyard
//      disc rides along as an extra part of the home field, so the packing keeps room for the
//      farmstead right beside it (the disc is taken out of the result again).
//   3. Metres become island units: s = radiusUnits / layout.radiusM, with
//      radiusUnits = clamp(4.5 + 2.4 * sqrt(total km^2), 5.5, 11). The layout's middle is (0, 0).
//   4. On a fine grid over the island: the farmstead pad in the farmyard, terraces (rounded blobs
//      lifting level-1 / level-2 fields), empty slots for future buildings, vehicles and trees,
//      and 0-2 landscape features (crag, hill, pond), all in free grass.
//   5. An organic coastline (radii at evenly spaced angles, like the prototype's COAST) with a
//      seeded 1.2 - 1.8 unit beach and grass margin around everything.
//
// Coordinates are island units: X east, Z SOUTH (three.js: north is -z), y up. All randomness
// comes from the seed (mulberry32), so the same farm always gets the same island.
//
// planIsland(fields, { seed, home }) returns
//   {
//     seed, s, radius, radiusUnits,      s = units per metre; radius = largest coast radius
//     walk, gapM,                         same-level walkway in units / in metres (layout's gapM)
//     layout,                             layoutIsland result (metres) + layout.yard {center, radiusM};
//                                         the home field's layout entry carries the yard as `reserved`
//     toScene([x, y]) -> [X, Z],          island-positioned metres -> units
//     homeId,
//     fields: [{ id, name, crop, polygons (units, [[ring [[X, Z]...] open, holes...]...]),
//                centroid, areaUnits, level 0..2, height, label|null, labelAt, home }],
//     farmstead: { at, facing, level, height, r: 1, homeId, yard: { at, r } },
//                facing = rotation.y that turns a +z-facing front (barn door) to the home field
//     slots: [{ id ('b1', 'v1', 't1'...), kind: 'building'|'vehicle'|'tree', at, r, level }],
//     terraces: [{ level: 1|2, height: 0.4 * level, polygon: [[X, Z]...] }],   level-2 inside level-1
//     coast: { center: [0, 0], radii: [96] },   angles k/96 * 2pi, atan2(z, x) like the prototype
//     flats: [{ type: 'polygon', polygon, holes, level, pad: 0.15, id } |
//             { type: 'circle', x, z, r, level, pad, id }],   fields, farmstead, every slot
//     features: [{ type: 'crag'|'hill'|'pond', at, r }],      0-2, level-0 free grass
//   }

import {
  layoutIsland,
  pointInRing,
  rasterise,
  distanceTransform,
  components,
  traceContour,
  simplifyRing,
  chaikin,
} from './layout.js';

// ---------------------------------------------------------------------------------------------
// Sizes (island units unless noted)

export const PLAN = {
  walk: 0.45,           // walkway between neighbouring fields on the same level (at most) ...
  walkMin: 0.25,        // ... and at least,
  walkFrac: 0.15,       // ... otherwise this fraction of a typical field's side
  walkPerLevel: 0.45,   // extra walkway per level of difference (room for the terrace slope)
  layoutMargin: 0.8,    // grass margin of layout.js's own outline (sets layout.radiusM)
  fieldPad: 0.15,       // flat ground kept around every field outline
  levelHeight: 0.4,     // terrace height per level
  terracePad: 0.18,     // a terrace reaches this far past the fields it lifts
  terracePadUp: 0.55,   // the level-1 terrace reaches this far past level-2 fields (stepped shelf)
  terraceRound: 0.5,    // closing radius that rounds terrace blobs and fills notches
  riser: 0.35,          // width of the slope just outside a terrace edge
  farmR: 1.0,           // farmstead pad radius
  yardR: 1.7,           // farmyard kept free beside the home field (farmstead + a few pads)
  yardClear: 0.35,      // between the home field and the farmyard / farmstead circle
  farmPad: 0.2,         // flat pad around the farmstead circle
  clear: 0.3,           // free grass between a pad's circle and any field outline
  slotR: { building: 0.8, vehicle: 0.6, tree: 0.4 },
  slotPad: 0.1,
  slotGap: 0.25,        // between two pads' circles
  beach: 1.2,           // minimum land + beach between fields and the waterline
  beachWobble: 0.6,     // extra, seeded, organic margin on top (so 1.2 - 1.8)
  coastSamples: 96,     // coastline radii
  gridCells: 75,        // planning grid step = radiusUnits / gridCells (about 0.07 - 0.15)
};

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Seeded randomness

function hashString(str) {
  // FNV-1a followed by a murmur-style finaliser.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A stable 32-bit integer for any seed (number or string). */
export function seedToInt(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return hashString('n:' + seed);
  return hashString('s:' + String(seed));
}

/** mulberry32: () => float in [0, 1). */
export function mulberry32(a) {
  let s = a | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Small geometry helpers

const partsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (t) => t * t * (3 - 2 * t);

function openRing(ring) {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, n - 1);
  return ring.slice();
}

function segNearest(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + t * dx, az + t * dz];
}

/** Nearest point on any ring edge of a field (polygons = [[ring, holes...]...], open rings). */
function nearestOnPolys(px, pz, polygons) {
  let best = null, bd = Infinity;
  for (const rings of polygons) for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const q = segNearest(px, pz, r[j][0], r[j][1], r[i][0], r[i][1]);
      const d = Math.hypot(q[0] - px, q[1] - pz);
      if (d < bd) { bd = d; best = q; }
    }
  }
  return { point: best, dist: bd };
}

/** Rough planar area (m^2) of a lng/lat geometry, for sizing before the layout runs. */
function roughAreaM2(geometry) {
  const R = 6371008.8, k = Math.PI / 180;
  let total = 0;
  for (const rings of partsOf(geometry)) {
    rings.forEach((ring, idx) => {
      const lat0 = ring[0][1] * k;
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const x0 = ring[j][0] * k * R * Math.cos(lat0), y0 = ring[j][1] * k * R;
        const x1 = ring[i][0] * k * R * Math.cos(lat0), y1 = ring[i][1] * k * R;
        a += x0 * y1 - x1 * y0;
      }
      total += (idx === 0 ? 1 : -1) * Math.abs(a / 2);
    });
  }
  return Math.max(0, total);
}

function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// ---------------------------------------------------------------------------------------------
// Coast helpers (exported for the terrain, the renderer and tests)

/**
 * Radius of a plan's coastline at angle theta (radians, measured like the prototype:
 * atan2(z - cz, x - cx), so 0 = east, PI/2 = south), smoothstep-interpolated between the evenly
 * spaced radii.
 */
export function coastRadiusAt(coast, theta) {
  const R = coast.radii, n = R.length;
  let a = (theta / TAU) % 1;
  if (a < 0) a += 1;
  const f = a * n, i = Math.floor(f) % n, t = f - Math.floor(f);
  return R[i] + (R[(i + 1) % n] - R[i]) * smoothstep(t);
}

/** Is [x, z] inside the coast (optionally at least `inset` units in from the waterline)? */
export function insideCoast(coast, x, z, inset = 0) {
  const dx = x - coast.center[0], dz = z - coast.center[1];
  return Math.hypot(dx, dz) <= coastRadiusAt(coast, Math.atan2(dz, dx)) - inset;
}

/** Closed-loop coastline points [[x, z]...] (no repeated last point), `steps` of them. */
export function coastRing(coast, steps = 256) {
  const out = [];
  for (let k = 0; k < steps; k++) {
    const th = (k / steps) * TAU, r = coastRadiusAt(coast, th);
    out.push([coast.center[0] + r * Math.cos(th), coast.center[1] + r * Math.sin(th)]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Farmyard reservation

const M_PER_DEG = (Math.PI / 180) * 6371008.8;
const YARD_SIDES = 24;

/**
 * A disc of radius rM metres just outside the home field (clearM from its edge), on the side away
 * from the other fields (turned by `turn` radians; any direction `angle` for a lone field).
 * Returns { geometry: the disc as a GeoJSON Polygon, center: [lng, lat], rM }.
 */
function reserveYard(input, homeIdx, rM, clearM, turn, angle) {
  const hf = input[homeIdx];
  const parts = partsOf(hf.geometry);
  const ring0 = openRing(parts[0][0]);
  const lng0 = ring0.reduce((a, p) => a + p[0], 0) / ring0.length;
  const lat0 = ring0.reduce((a, p) => a + p[1], 0) / ring0.length;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const proj = (p) => [(p[0] - lng0) * kx, (p[1] - lat0) * M_PER_DEG];
  const unproj = (p) => [lng0 + p[0] / kx, lat0 + p[1] / M_PER_DEG];
  const homeRings = parts.map((rings) => openRing(rings[0]).map(proj));
  let cx = 0, cy = 0, cn = 0;
  for (const r of homeRings) for (const p of r) { cx += p[0]; cy += p[1]; cn++; }
  cx /= cn; cy /= cn;

  // Away from the other fields (area weighted), or a seeded direction for a lone field.
  let ox = 0, oy = 0, ow = 0;
  input.forEach((f, i) => {
    if (i === homeIdx) return;
    const a = roughAreaM2(f.geometry);
    for (const rings of partsOf(f.geometry)) {
      const r = openRing(rings[0]);
      const c = proj([r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length]);
      ox += c[0] * a; oy += c[1] * a; ow += a;
    }
  });
  let dir = angle;
  if (ow > 0 && Math.hypot(ox / ow - cx, oy / ow - cy) > 1) dir = Math.atan2(cy - oy / ow, cx - ox / ow) + turn;
  const ux = Math.cos(dir), uy = Math.sin(dir);

  // Walk out from the centre until the disc clears the home field.
  const clearOf = (px, py) => {
    let d = Infinity;
    for (const r of homeRings) {
      if (pointInRing([px, py], r)) return -1;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const q = segNearest(px, py, r[j][0], r[j][1], r[i][0], r[i][1]);
        d = Math.min(d, Math.hypot(q[0] - px, q[1] - py));
      }
    }
    return d;
  };
  const need = rM + clearM;
  let t = 0;
  const step = rM / 8;
  for (let k = 0; k < 4000 && clearOf(cx + t * ux, cy + t * uy) < need; k++) t += step;
  // Back in finely, so the disc sits snug against the field.
  let lo = Math.max(0, t - step), hi = t;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    if (clearOf(cx + mid * ux, cy + mid * uy) >= need) hi = mid; else lo = mid;
  }
  const px = cx + hi * ux, py = cy + hi * uy;
  const disc = [];
  for (let k = 0; k < YARD_SIDES; k++) {
    const a = (k / YARD_SIDES) * TAU;
    disc.push(unproj([px + rM * Math.cos(a), py + rM * Math.sin(a)]));
  }
  disc.push(disc[0].slice());
  return {
    geometry: { type: 'Polygon', coordinates: [disc] },
    center: unproj([px, py]),
    rM,
  };
}

// ---------------------------------------------------------------------------------------------
// Levels

/**
 * Terrace level 0..2 per field from its real elevation, in contour steps: equal bands of real
 * elevation (at least 3 m each, wide enough that the farm fits in three steps), so a field that
 * is really higher sits on a higher terrace. Fields with no elevation stay on 0.
 */
export const CONTOUR_MIN_STEP_M = 3;
function assignLevels(fields) {
  const levels = fields.map(() => 0);
  const valid = fields
    .map((f, i) => ({ i, e: f.elevationM }))
    .filter((v) => typeof v.e === 'number' && Number.isFinite(v.e));
  if (valid.length < 2) return levels;
  const es = valid.map((v) => v.e);
  const lo = Math.min(...es);
  const range = Math.max(...es) - lo;
  if (range < 1) return levels; // a flat farm
  const step = Math.max(CONTOUR_MIN_STEP_M, range / 3 + 1e-9);
  for (const v of valid) levels[v.i] = Math.min(2, Math.floor((v.e - lo) / step));
  return levels;
}

// ---------------------------------------------------------------------------------------------
// Main entry point

/**
 * Plan the island for a farm.
 *
 * @param {{id, geometry, elevationM?: number|null, crop?, name?}[]} fields 1 to 15 real fields
 *   (GeoJSON Polygon / MultiPolygon in lng/lat).
 * @param {{seed?: number|string, home?: [number, number]}} [opts] seed: the farm's name (default:
 *   the field ids); home: the farm pin [lng, lat].
 * @returns {object} the plan; its shape is listed in the notes at the top of this file.
 */
export function planIsland(fields, { seed, home } = {}) {
  const input = (fields || []).filter((f) => f && f.geometry && partsOf(f.geometry).length);
  if (!input.length) throw new Error('planIsland needs at least one field with a polygon geometry');
  if (seed === undefined || seed === null || seed === '') seed = input.map((f) => String(f.id)).sort().join('|');
  const rand = mulberry32(seedToInt(seed));
  const n = input.length;

  // --- 1. Levels and the target size. ---------------------------------------------------------
  const levels = assignLevels(input);
  const levelOf = new Map(input.map((f, i) => [f.id, levels[i]]));
  const fieldAreas = input.map((f) => roughAreaM2(f.geometry));
  const areaM2 = fieldAreas.reduce((t, a) => t + a, 0);
  const radiusUnits = clamp(4.5 + 2.4 * Math.sqrt(areaM2 / 1e6), 5.5, 11);

  // Walkways are wanted in island units, but the layout works in metres and the scale is only
  // known after it ran. Estimate it: a packed farm spans about K equal-area radii of its fields,
  // each grown by half a walkway all round (fixed-point iteration, since the walkway in metres
  // depends on the scale). Run the layout again if the estimate was well off.
  // The walkway shrinks a little for many small fields, so gaps stay small next to the fields.
  const K = 1.5 + 0.3 * (1 - 1 / n);
  const medianSide = Math.sqrt(fieldAreas.slice().sort((a, b) => a - b)[Math.floor(n / 2)]);
  const walkFor = (sg) => clamp(PLAN.walkFrac * medianSide * sg, PLAN.walkMin, PLAN.walk);
  let sEst = (radiusUnits - PLAN.layoutMargin) / Math.max(1, K * Math.sqrt(areaM2 / Math.PI));
  for (let it = 0; it < 12; it++) {
    const g = n > 1 ? (walkFor(sEst) + 0.15) / sEst : 0;
    const yard = Math.PI * ((PLAN.yardR + PLAN.yardClear) / sEst) ** 2;
    const grown = fieldAreas.reduce((t, a) => t + (Math.sqrt(a) + g) ** 2, 0) + yard;
    sEst = (radiusUnits - PLAN.layoutMargin) / Math.max(1, K * Math.sqrt(grown / Math.PI));
  }
  let walk = walkFor(sEst);

  // Home field: the one holding the pin, else the largest.
  let homeIdx = -1;
  if (Array.isArray(home) && home.length >= 2 && home.every(Number.isFinite)) {
    homeIdx = input.findIndex((f) => partsOf(f.geometry).some((rings) => pointInRing(home, rings[0]) && !rings.slice(1).some((q) => pointInRing(home, q))));
  }
  if (homeIdx < 0) homeIdx = fieldAreas.reduce((a, v, k) => (v > fieldAreas[a] ? k : a), 0);
  const yardTurn = (rand() - 0.5) * 1.0;
  const yardAngle = rand() * TAU;

  // The farmyard is reserved inside the layout: a disc that moves with the home field (layout.js's
  // per-field `reserve`), so the packing keeps that space free right next to it.
  const runLayout = (sGuess) => {
    const yard = reserveYard(input, homeIdx, PLAN.yardR / sGuess, PLAN.yardClear / sGuess, yardTurn, yardAngle);
    const lay = layoutIsland(
      input.map((f, i) => ({ id: f.id, geometry: f.geometry, elevationM: f.elevationM ?? null, ...(i === homeIdx ? { reserve: yard.geometry } : {}) })),
      {
        tight: true,
        gapM: walk / sGuess,
        marginM: PLAN.layoutMargin / sGuess,
        gapBetween: (a, b) => (walk + PLAN.walkPerLevel * Math.abs(levelOf.get(a) - levelOf.get(b))) / sGuess,
      },
    );
    const c = lay.project(yard.center), off = lay.fields[homeIdx].offset;
    return { ...lay, yard: { center: [c[0] + off[0], c[1] + off[1]], radiusM: yard.rM } }; // island position, metres
  };
  let layout = runLayout(sEst);
  let s = radiusUnits / layout.radiusM;
  // Too tight a walkway (s came out smaller than guessed) matters more than too wide a one.
  if (s / sEst < 0.88 || s / sEst > 1.25) {
    sEst = s;
    walk = walkFor(sEst);
    layout = runLayout(sEst);
    s = radiusUnits / layout.radiusM;
  }
  const gapM = walk / sEst;
  const [cx, cy] = layout.center;
  const toScene = ([x, y]) => [(x - cx) * s, -(y - cy) * s];

  // --- 2. Fields in island units. -------------------------------------------------------------
  const items = layout.fields.map((lf, i) => {
    const [ox, oy] = lf.offset;
    const polygons = lf.polygons.map((rings) => rings.map((r) => openRing(r).map(([x, y]) => toScene([x + ox, y + oy]))));
    const centroid = toScene([lf.centroid[0] + ox, lf.centroid[1] + oy]);
    return {
      f: input[i],
      lf,
      i,
      level: levels[i],
      polygons,
      centroid,
      areaUnits: lf.areaM2 * s * s,
      label: lf.label ? lf.label.text : null,
      labelAt: lf.label ? toScene(lf.label.at) : centroid,
    };
  });

  const homeIt = items[homeIdx];

  // --- 3. Planning grid. ----------------------------------------------------------------------
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const it of items) for (const rings of it.polygons) for (const [x, z] of rings[0]) {
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (z < bz0) bz0 = z;
    if (z > bz1) bz1 = z;
  }
  const EXT = 4;
  const h = radiusUnits / PLAN.gridCells;
  const gx0 = bx0 - EXT, gz0 = bz0 - EXT;
  const W = Math.ceil((bx1 - bx0 + 2 * EXT) / h) + 1, H = Math.ceil((bz1 - bz0 + 2 * EXT) / h) + 1;
  const N = W * H;
  const outerRings = (list) => list.flatMap((it) => it.polygons.map((rings) => rings[0]));
  /** Distance (units) from every grid node to the nearest of these fields (null if none). */
  const distTo = (list) => {
    if (!list.length) return null;
    const d = distanceTransform(rasterise(outerRings(list), gx0, gz0, h, W, H), W, H);
    for (let k = 0; k < N; k++) d[k] = Math.max(0, d[k] * h - 0.5 * h);
    return d;
  };
  const dAny = distTo(items);
  const dLevel = [0, 1, 2].map((L) => distTo(items.filter((it) => it.level === L)));
  const cellX = (k) => gx0 + (k % W) * h;
  const cellZ = (k) => gz0 + Math.floor(k / W) * h;
  // Middle of the fields (area-weighted): slots and features are drawn towards it.
  let mx = 0, mz = 0, mw = 0;
  for (const it of items) { mx += it.centroid[0] * it.areaUnits; mz += it.centroid[1] * it.areaUnits; mw += it.areaUnits; }
  const mid = mw > 0 ? [mx / mw, mz / mw] : [0, 0];

  // --- 4. Farmstead: beside the home field, preferably on the home field's level. ------------
  // A pad on level L needs plain clearance from fields on L, and room for a terrace slope from
  // fields on other levels: a higher field's shelf + slope, or its own shelf + slope down to a
  // lower field.
  const dHome = distTo([homeIt]);
  const farmNeed = PLAN.farmR + PLAN.clear;
  const needUp = PLAN.farmR + PLAN.farmPad + PLAN.terracePad + PLAN.riser + 0.05;
  const needDown = PLAN.farmR + PLAN.farmPad + PLAN.terracePad + PLAN.riser + PLAN.fieldPad + 0.05;
  const usedLevels = [0, 1, 2].filter((L) => dLevel[L]);
  let farmK = -1, farmScore = Infinity, farmLevel = homeIt.level, farmPref = null;
  // First choice: the farmyard the layout kept free, with the farmstead at its home-field side.
  {
    const yc = toScene(layout.yard.center);
    const yr = layout.yard.radiusM * s;
    const q = nearestOnPolys(yc[0], yc[1], homeIt.polygons).point;
    if (q) {
      const d = Math.hypot(q[0] - yc[0], q[1] - yc[1]) || 1;
      const sh = Math.max(0, yr - PLAN.farmR - 0.02);
      const at = [yc[0] + ((q[0] - yc[0]) / d) * sh, yc[1] + ((q[1] - yc[1]) / d) * sh];
      const i = Math.round((at[0] - gx0) / h), j = Math.round((at[1] - gz0) / h);
      const k = j * W + i;
      let ok = i >= 0 && j >= 0 && i < W && j < H;
      if (ok) {
        // Check exactly against every field.
        for (const it of items) {
          const e = nearestOnPolys(at[0], at[1], it.polygons).dist;
          const inside = it.polygons.some((rings) => pointInRing(at, rings[0]));
          const need = it.level === homeIt.level ? farmNeed : it.level > homeIt.level ? needUp : needDown;
          if (inside || e < (it === homeIt ? farmNeed - 0.05 : need)) { ok = false; break; }
        }
      }
      if (ok) { farmK = k; farmScore = -Infinity; farmPref = at; }
    }
  }
  for (let k = 0; k < N && farmScore > -Infinity; k++) {
    if (dAny[k] < farmNeed + h) continue;
    const x = cellX(k), z = cellZ(k);
    // Snug against the home field (and nearer it than any other field), a little towards the
    // middle of the farm, plus a seeded nudge.
    const base = 3 * (dHome[k] - farmNeed) + (dHome[k] > dAny[k] + 0.05 ? 2 : 0) + 0.06 * Math.hypot(x - mid[0], z - mid[1]) + 0.35 * rand();
    for (const L of usedLevels) {
      let ok = true;
      for (const q of usedLevels) if (q !== L && dLevel[q][k] < (q > L ? needUp : needDown) + h) { ok = false; break; }
      if (!ok) continue;
      const sc = base + (L === homeIt.level ? 0 : 0.6 + 0.3 * Math.abs(L - homeIt.level));
      if (sc < farmScore) { farmScore = sc; farmK = k; farmLevel = L; }
    }
  }
  let farmAt;
  if (farmPref) farmAt = farmPref.map(round4);
  else if (farmK >= 0) farmAt = [round4(cellX(farmK)), round4(cellZ(farmK))];
  else {
    // No room anywhere on the grid (cannot really happen: the grid reaches 4 units past the
    // fields). Fall back to just outside the fields' bounding box.
    farmAt = [bx1 + farmNeed + 0.5, homeIt.centroid[1]];
  }
  const near = nearestOnPolys(farmAt[0], farmAt[1], homeIt.polygons).point || homeIt.centroid;
  const farmstead = {
    at: farmAt,
    facing: Math.atan2(near[0] - farmAt[0], near[1] - farmAt[1]), // rotation.y turning a +z front to the home field
    level: farmLevel,
    height: farmLevel * PLAN.levelHeight,
    r: PLAN.farmR,
    homeId: homeIt.f.id,
    yard: { at: toScene(layout.yard.center).map(round4), r: round4(layout.yard.radiusM * s) }, // the space the layout kept free
  };

  // --- 5. Terraces. ---------------------------------------------------------------------------
  const terraces = [];
  const levelMap = new Uint8Array(N);
  let tClear = null; // per node: how far a pad may reach before it meets a terrace edge's slope
  const maxLevel = Math.max(...levels);
  if (maxLevel > 0) {
    tClear = new Float64Array(N).fill(Infinity);
    const fdx = (k) => Math.hypot(cellX(k) - farmAt[0], cellZ(k) - farmAt[1]);
    const excl = PLAN.fieldPad + PLAN.riser + 0.02;
    for (let L = 1; L <= maxLevel; L++) {
      const mask = new Uint8Array(N);
      for (let k = 0; k < N; k++) {
        let inn = false;
        for (let q = L; q <= 2; q++) {
          if (!dLevel[q]) continue;
          if (dLevel[q][k] <= (q > L ? PLAN.terracePadUp : PLAN.terracePad)) { inn = true; break; }
        }
        if (!inn && farmstead.level >= L && fdx(k) <= PLAN.farmR + PLAN.farmPad + (farmstead.level > L ? PLAN.terracePadUp : PLAN.terracePad)) inn = true;
        mask[k] = inn ? 1 : 0;
      }
          // Rounded: close (grow then shrink) by terraceRound.
      const rc = PLAN.terraceRound / h;
      const dOut = distanceTransform(mask, W, H);
      const grown = new Uint8Array(N);
      for (let k = 0; k < N; k++) grown[k] = dOut[k] <= rc ? 0 : 1; // 1 = outside the grown shape
      const dShrink = distanceTransform(grown, W, H);
      for (let k = 0; k < N; k++) {
        let inn = mask[k] || dShrink[k] > rc;
        // Never over lower fields (or a lower farmstead), and leave them room for the slope; but
        // a raised field itself always stays on its shelf.
        let own = false;
        for (let q = L; q <= 2 && !own; q++) if (dLevel[q] && dLevel[q][k] === 0) own = true;
        if (inn && !own) {
          for (let q = 0; q < L; q++) if (dLevel[q] && dLevel[q][k] < excl) { inn = false; break; }
          if (inn && farmstead.level < L && fdx(k) < PLAN.farmR + PLAN.farmPad + PLAN.riser + 0.05) inn = false;
        }
        if (!inn && farmstead.level >= L && fdx(k) <= PLAN.farmR + PLAN.farmPad) inn = true;
        mask[k] = inn ? 1 : 0;
      }
      // Signed distance to the shelf edge, for a smooth contour and for slot clearances.
      const outside = new Uint8Array(N);
      for (let k = 0; k < N; k++) outside[k] = mask[k] ? 0 : 1;
      const dIn = distanceTransform(outside, W, H); // inside nodes: steps to the nearest outside node
      const dO = distanceTransform(mask, W, H);     // outside nodes: steps to the nearest inside node
      const F = new Float64Array(N);
      for (let k = 0; k < N; k++) {
        F[k] = mask[k] ? dIn[k] * h - 0.5 * h : -(dO[k] * h - 0.5 * h);
        if (mask[k]) levelMap[k] = L;
        const c = mask[k] ? F[k] - 0.1 : -F[k] - PLAN.riser - 0.05;
        if (c < tClear[k]) tClear[k] = c;
      }
      const { label, count } = components(F, W, H);
      const Fc = count > 1 ? new Float64Array(N) : F;
      for (let c = 1; c <= count; c++) {
        let cells = 0;
        for (let k = 0; k < N; k++) {
          if (label[k] === c) { Fc[k] = F[k]; cells++; } else if (Fc !== F) Fc[k] = Math.min(F[k], -0.5 * h);
        }
        if (cells * h * h < 0.02) continue; // crumbs
        let ring = traceContour(Fc, gx0, gz0, h, W, H);
        if (!ring || ring.length < 3) continue;
        ring = simplifyRing(ring, 0.25 * h);
        ring = chaikin(ring);
        // no height: the terrain gives each level its own shelf height (levelHeight), so the steps line up with the flats
        terraces.push({ level: L, polygon: ring.map(([x, z]) => [round4(x), round4(z)]) });
      }
    }
  }

  // --- 6. Pads: slots and features. -----------------------------------------------------------
  // dCirc: per node, distance to the edge of the nearest pad circle placed so far.
  const dCirc = new Float64Array(N).fill(Infinity);
  const circles = [];
  const addCircle = (at, r) => {
    circles.push({ at, r });
    const reach = r + 4;
    const i0 = Math.max(0, Math.floor((at[0] - reach - gx0) / h)), i1 = Math.min(W - 1, Math.ceil((at[0] + reach - gx0) / h));
    const j0 = Math.max(0, Math.floor((at[1] - reach - gz0) / h)), j1 = Math.min(H - 1, Math.ceil((at[1] + reach - gz0) / h));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i;
      const d = Math.hypot(gx0 + i * h - at[0], gz0 + j * h - at[1]) - r;
      if (d < dCirc[k]) dCirc[k] = d;
    }
  };
  addCircle(farmstead.at, PLAN.farmR);

  /** Lowest-score node where a pad of radius r fits; null when none does. */
  // Nodes where at least the smallest pad could go (in free grass, not too far out).
  const minPad = Math.min(...Object.values(PLAN.slotR));
  const cand = [];
  for (let k = 0; k < N; k++) {
    if (dAny[k] < minPad + 0.2 + h || dAny[k] > 6) continue;
    if (tClear && tClear[k] < minPad) continue;
    cand.push(k);
  }
  const pick = (r, { clearField = PLAN.clear, gap = PLAN.slotGap, maxFree = Infinity, minFree = 0, levelOk, score }) => {
    let best = -1, bestS = Infinity;
    for (let c = 0; c < cand.length; c++) {
      const k = cand[c];
      const free = dAny[k];
      if (free < r + clearField + h || free > maxFree || free < minFree) continue;
      if (dCirc[k] < r + gap) continue;
      if (tClear && tClear[k] < r) continue;
      if (levelOk && !levelOk(levelMap[k])) continue;
      const x = cellX(k), z = cellZ(k);
      const sc = score(x, z, k);
      if (sc < bestS) { bestS = sc; best = k; }
    }
    return best < 0 ? null : { at: [round4(cellX(best)), round4(cellZ(best))], level: levelMap[best] };
  };

  const slots = [];
  const counters = { building: 0, vehicle: 0, tree: 0 };
  const addSlot = (kind, p) => {
    const r = PLAN.slotR[kind];
    const slot = { id: kind[0] + ++counters[kind], kind, at: p.at, r, level: p.level };
    slots.push(slot);
    addCircle(p.at, r);
    return slot;
  };
  const farmDist = (x, z) => Math.hypot(x - farmAt[0], z - farmAt[1]);
  const midDist = (x, z) => Math.hypot(x - mid[0], z - mid[1]);

  // Buildings and vehicles: 6 to 10, half of them around the farmstead.
  const nBV = clamp(6 + Math.round(((n - 1) * 4) / 14), 6, 10);
  const nVehicle = Math.floor(nBV * 0.4);
  const nBuilding = nBV - nVehicle;
  const nNear = Math.ceil(nBuilding / 2);
  const queue = [];
  for (let q = 0; q < nBuilding; q++) queue.push({ kind: 'building', nearFarm: q < nNear });
  for (let q = 0; q < nVehicle; q++) queue.push({ kind: 'vehicle', nearFarm: true });
  queue.sort((a, b) => Number(b.nearFarm) - Number(a.nearFarm));
  for (const q of queue) {
    const r = PLAN.slotR[q.kind];
    const p = pick(r, {
      maxFree: 3.5,
      score: q.nearFarm
        ? (x, z) => farmDist(x, z) + 0.4 * midDist(x, z) + 0.8 * rand()
        : (x, z, k) => 0.5 * midDist(x, z) + 0.4 * dAny[k] + 1.6 * rand(),
    });
    if (p) addSlot(q.kind, p);
  }

  // Features: 0 to 2, seeded, in free grass on level 0.
  const features = [];
  const fr = rand();
  const nFeat = fr < 0.15 ? 0 : fr < 0.5 ? 1 : 2;
  const pool = [['crag', 0.45], ['hill', 0.35], ['pond', 0.2]];
  for (let q = 0; q < nFeat; q++) {
    const tot = pool.reduce((a, p) => a + p[1], 0);
    let x = rand() * tot, idx = 0;
    while (idx < pool.length - 1 && x > pool[idx][1]) { x -= pool[idx][1]; idx++; }
    const type = pool.splice(idx, 1)[0][0];
    const r = type === 'crag' ? 1.3 + 0.4 * rand() : type === 'hill' ? 1.0 + 0.3 * rand() : 0.7 + 0.3 * rand();
    const p = pick(r, {
      clearField: 0.5,
      gap: 0.4,
      levelOk: (L) => L === 0,
      score: (x2, z2) => {
        const a = Math.atan2(z2 - mid[1], x2 - mid[0]);
        // Spread features around the island rather than side by side.
        for (const f of features) if (Math.abs(angleDiff(a, Math.atan2(f.at[1] - mid[1], f.at[0] - mid[0]))) < Math.PI / 2) return Infinity;
        return midDist(x2, z2) + 2.0 * rand();
      },
    });
    if (p) {
      const f = { type, at: p.at, r: round4(r) };
      features.push(f);
      addCircle(f.at, f.r);
    }
  }

  // Tree spots: in the grass margin and the gaps between fields.
  const nTree = clamp(4 + n, 5, 14);
  for (let q = 0; q < nTree; q++) {
    const p = pick(PLAN.slotR.tree, {
      clearField: 0.2,
      gap: 0.3,
      maxFree: 2.5,
      score: (x, z, k) => Math.abs(dAny[k] - 0.9) * 0.6 + 0.05 * midDist(x, z) + 1.5 * rand(),
    });
    if (p) addSlot('tree', p);
  }

  // --- 7. Coast. ------------------------------------------------------------------------------
  const coast = buildCoast(items, farmstead, slots, features, terraces, rand);
  const radius = Math.max(...coast.radii);

  // --- 8. Flats. ------------------------------------------------------------------------------
  const flats = [];
  for (const it of items) for (const rings of it.polygons) {
    flats.push({ type: 'polygon', polygon: rings[0], holes: rings.slice(1), level: it.level, pad: PLAN.fieldPad, id: it.f.id });
  }
  flats.push({ type: 'circle', x: farmstead.at[0], z: farmstead.at[1], r: farmstead.r, level: farmstead.level, pad: PLAN.farmPad, id: 'farmstead' });
  // the whole farmyard is level too (room for the silo, windmill and hay beside the barn), when the
  // farmstead sits in it
  const yd = farmstead.yard;
  if (yd && Math.hypot(yd.at[0] - farmstead.at[0], yd.at[1] - farmstead.at[1]) <= yd.r) {
    flats.push({ type: 'circle', x: yd.at[0], z: yd.at[1], r: Math.max(farmstead.r, yd.r - 0.1), level: farmstead.level, pad: 0.1, id: 'yard' });
  }
  // slots are level (ready for an upgrade) but 'quiet': no worn-path apron, grass can grow on them
  for (const sl of slots) flats.push({ type: 'circle', x: sl.at[0], z: sl.at[1], r: sl.r, level: sl.level, pad: PLAN.slotPad, id: sl.id, quiet: true });

  return {
    seed,
    s,
    radius,
    radiusUnits,
    gapM,
    walk,
    layout,
    toScene,
    homeId: homeIt.f.id,
    fields: items.map((it) => ({
      id: it.f.id,
      name: it.f.name ?? null,
      crop: it.f.crop ?? null,
      polygons: it.polygons,
      centroid: it.centroid,
      areaUnits: it.areaUnits,
      level: it.level,
      height: it.level * PLAN.levelHeight,
      label: it.label,
      labelAt: it.labelAt,
      home: it === homeIt,
    })),
    farmstead,
    slots,
    terraces,
    coast,
    flats,
    features,
  };
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;

// ---------------------------------------------------------------------------------------------
// Coast

function buildCoast(items, farmstead, slots, features, terraces, rand) {
  // Points of everything that must be on land, each with its margin to the waterline.
  const pts = [];
  const beach = PLAN.beach;
  for (const it of items) for (const rings of it.polygons) {
    const r = rings[0];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [x0, z0] = r[j], [x1, z1] = r[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.3));
      for (let q = 0; q < steps; q++) pts.push([x0 + ((x1 - x0) * q) / steps, z0 + ((z1 - z0) * q) / steps, beach]);
    }
  }
  const disc = (at, r, mg, k = 16) => {
    for (let q = 0; q < k; q++) {
      const a = (q / k) * TAU;
      pts.push([at[0] + r * Math.cos(a), at[1] + r * Math.sin(a), mg]);
    }
  };
  disc(farmstead.at, farmstead.r + PLAN.farmPad, 1.0);
  for (const sl of slots) disc(sl.at, sl.r + PLAN.slotPad, sl.kind === 'tree' ? 0.7 : 1.0, 12);
  for (const f of features) disc(f.at, f.r, f.type === 'crag' ? 0.6 : f.type === 'hill' ? 0.8 : 0.9);
  for (const t of terraces) for (const p of t.polygon) pts.push([p[0], p[1], PLAN.riser + 0.6]);

  // Required radius along a ray: where it leaves the last margin disc. A disc only touches the
  // rays within its angular half-width, so only those are visited.
  const N = PLAN.coastSamples, F = 4 * N;
  const need = new Float64Array(F).fill(2);
  const cosT = new Float64Array(F), sinT = new Float64Array(F);
  for (let k = 0; k < F; k++) { cosT[k] = Math.cos((k / F) * TAU); sinT[k] = Math.sin((k / F) * TAU); }
  for (const [x, z, mg] of pts) {
    const rho = Math.hypot(x, z);
    let k0 = 0, k1 = F - 1;
    if (rho > mg) {
      const phi = Math.atan2(z, x), half = Math.asin(mg / rho);
      k0 = Math.floor(((phi - half) / TAU) * F) - 1;
      k1 = Math.ceil(((phi + half) / TAU) * F) + 1;
    }
    for (let kk = k0; kk <= k1; kk++) {
      const k = ((kk % F) + F) % F;
      const along = x * cosT[k] + z * sinT[k], perp = -x * sinT[k] + z * cosT[k];
      if (Math.abs(perp) >= mg) continue;
      const exit = along + Math.sqrt(mg * mg - perp * perp);
      if (exit > need[k]) need[k] = exit;
    }
  }
  // Each coarse sample covers its neighbourhood (so interpolating in between never cuts in).
  const env = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    let m = 0;
    for (let j = -4; j <= 4; j++) m = Math.max(m, need[(4 * k + j + F) % F]);
    env[k] = m;
  }
  // Closing (dilate then erode) fills narrow notches, then a light blur; never below env.
  const Wd = 4;
  const dil = Array.from(env, (_, k) => { let m = -Infinity; for (let j = -Wd; j <= Wd; j++) m = Math.max(m, env[(k + j + N) % N]); return m; });
  const clo = dil.map((_, k) => { let m = Infinity; for (let j = -Wd; j <= Wd; j++) m = Math.min(m, dil[(k + j + N) % N]); return m; });
  let sm = clo;
  for (let pass = 0; pass < 2; pass++) sm = sm.map((_, k) => 0.25 * sm[(k - 1 + N) % N] + 0.5 * sm[k] + 0.25 * sm[(k + 1) % N]);
  // Organic seeded wobble, outwards only (like the prototype's hand-made COAST).
  const ph = [rand() * TAU, rand() * TAU, rand() * TAU, rand() * TAU];
  const amp = [0.5, 0.3, 0.2, 0.12];
  const freq = [2, 3, 5, 7];
  const radii = [];
  for (let k = 0; k < N; k++) {
    const th = (k / N) * TAU;
    let w = 0;
    for (let q = 0; q < 4; q++) w += amp[q] * Math.sin(freq[q] * th + ph[q]);
    w = clamp(0.5 + 0.5 * (w / 1.12), 0, 1);
    const r = Math.max(sm[k], env[k]) + PLAN.beachWobble * w;
    radii.push(round4(Math.max(r, env[k] + 0.02)));
  }
  return { center: [0, 0], radii };
}
