// Farm paddocks with the fields' REAL shapes, in the prototype island's paddock style
// (team-sheeeep-assets/team-sheeeep-3d/index.html, makePaddock / rail / sprouts).
//
// Every field keeps its true outline and orientation. makeFieldPaddock() turns one field's
// polygons (already in scene units at their island position) into:
//   - a raised bed of tilled soil following the outline: extruded, with a softened (bevelled)
//     top edge, the top in the crop's soil colour and the sides in its darker side colour;
//   - furrow ridges under the plant rows (the prototype's half-buried cylinders) for row crops,
//     and a few dark furrow lines for fallow ground;
//   - a wooden rail fence along the outline (posts about every 0.6 units, two rails) with one
//     gate gap facing `gateToward` (normally the island's middle), or the south side;
//   - the crop itself, planted with crops.js plantField on the bed inset 0.12 from the fence.
// Round fields (isRound) get a centre-pivot irrigator instead of a fence.
//
// Units are the prototype's: its island had a radius of about 7 and its paddocks were 2.4 x 2.2.
// Coordinates: x east, z south, y up. The paddock's base is y = 0 (the bed sinks 0.03 below it
// so it sits on gentle slopes); the caller lifts the group onto the terrain.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ISLAND_COLORS, rng, mat, mesh } from './props.js';
import { CROP_KEYS, CROP_STYLE, ROW_GAP, cropKeyFor, plantField } from './crops.js';

// ---------------------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------------------

const BED_SINK = 0.03; // the bed reaches this far below y = 0
const BED_BEVEL = 0.035; // softened top edge
const BED_SIMPLIFY = 0.03; // drop pixel stair-steps from the bed outline (the real shape is kept)
const FENCE_SIMPLIFY = 0.06; // Douglas-Peucker tolerance for the fence line, so posts do not crowd
const FENCE_INSET = 0.03; // the fence stands just inside the bed edge, as in the prototype
// The polygon handed to plantField sits this far inside the fence; plantField keeps its plants
// another 0.07-0.13 (per crop) inside that, so plants end up about 0.12 from the fence.
const PLANT_INSET = 0.02;
const RIDGE_END = 0.1; // ridges stop this far inside the planted polygon (about 0.12 from the fence)
const POST_STEP = 0.6; // prototype post spacing
const POST_MIN_GAP = 0.22; // a corner post this close to the previous post is skipped
const GATE_HALF = 0.32; // half the gate opening, as in the prototype
const GATE_MIN_EDGE = 0.9; // an edge this long holds a full gate; failing that, the longest
const GATE_MIN_HALF = 0.18; // edge holds a narrower one, down to this half width
const RIDGE_RADIUS = 0.075; // furrow ridges: the prototype's half-buried cylinders
const RIDGE_LIFT = 0.005; // ridge axis above the bed top (ridge top about bed + 0.065)
const CROP_LIFT = 0.045; // row crops stand on the ridges
const PLANTS_PER_UNIT2 = 120;
const MAX_PLANTS = 900;
const FENCE_POP = 0.3; // the fence pops in during growth t = 0 .. 0.3

// Crops grown in tilled rows get ridges under every row: ROW_GAP from crops.js (the crops marked
// ridges: true, with their rowGap).

// Round-field test (isRound).
const ROUND_COMPACTNESS = 0.8; // 4 pi A / P^2 of the simplified outline: circle 1, square 0.785
const ROUND_CIRCLE_FILL = 0.78; // A / smallest enclosing circle: circle 1, octagon 0.9, square 0.64
const ROUND_MAX_ASPECT = 1.3; // long / short side of the smallest rotated rectangle

// Centre pivot.
const PIVOT_H = [0.5, 0.85]; // water pipe height above the bed top: min, max (0.38 x the arm length)
const PIVOT_TOWER_STEP = 0.8; // about one wheeled tower per 0.8 units of arm
const PIVOT_CENTRE_BARE = 0.24; // bare soil around the pivot point
const PIVOT_TRACK_HALF = 0.045; // half width of a wheel track
const PIVOT_EDGE_INSET = 0.1; // planted area inset from the bed edge (no fence)
const GALV = 0xc4c9cd;
const GALV_DARK = 0xa3aab0;

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------
// Ring and polygon helpers (rings are [[x, z], ...] in scene units)
// ---------------------------------------------------------------------------------------------

function openRing(ring) {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, n - 1);
  return ring.slice();
}

// Signed area in the x-z plane (shoelace on [x, z]).
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
function ringLength(ring) {
  let l = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) l += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
  return l;
}
function ringCentroid(ring) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, z0] = ring[j], [x1, z1] = ring[i];
    const c = x0 * z1 - x1 * z0;
    a += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c;
  }
  if (Math.abs(a) < 1e-12) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + t * dx - px, az + t * dz - pz);
}

// Polygons in: [[outer, hole...], ...] (or a single [outer, hole...]); rings open or closed.
// Out: open rings, outer counter-clockwise-in-(x,z) (positive ringArea), holes negative,
// degenerate rings dropped.
function normalise(polygons) {
  if (!Array.isArray(polygons) || !polygons.length) return [];
  if (typeof polygons[0]?.[0]?.[0] === 'number') polygons = [polygons];
  const out = [];
  for (const rings of polygons) {
    if (!Array.isArray(rings) || !rings[0]) continue;
    const rs = [];
    rings.forEach((r, k) => {
      const ring = dedupe(openRing(r));
      if (ring.length < 3 || Math.abs(ringArea(ring)) < 1e-6) return;
      const a = ringArea(ring);
      if ((k === 0 && a < 0) || (k > 0 && a > 0)) ring.reverse();
      if (k === 0 || rs.length) rs.push(ring);
    });
    if (rs.length) out.push(rs);
  }
  return out;
}
function dedupe(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push([p[0], p[1]]);
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-6) out.pop();
  return out;
}

// Douglas-Peucker on a closed (open-stored) ring; keeps at least 3 points.
function simplifyRing(ring, tol) {
  const n = ring.length;
  if (n <= 4 || tol <= 0) return ring.slice();
  let far = 0, farD = -1;
  for (let i = 1; i < n; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const pt = (i) => ring[i % n];
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, az] = pt(a), [bx, bz] = pt(b);
    let best = -1, bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pt(i)[0], pt(i)[1], ax, az, bx, bz);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  return out.length >= 3 && Math.abs(ringArea(out)) > Math.abs(ringArea(ring)) * 0.5 ? out : ring.slice();
}

// Inset (d > 0) or outset (d < 0) a ring by a mitred offset; the mitre is capped at 2 |d| so
// sharp spikes do not shoot out.
function insetRing(ring, d) {
  const n = ring.length, s = ringArea(ring) > 0 ? 1 : -1;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // inward normal: for positive area in (x, z) the interior is to the left of (dx, dz) -> (-dz, dx)
    normals.push([(-(b[1] - a[1]) / len) * s, ((b[0] - a[0]) / len) * s]);
  }
  return ring.map((p, i) => {
    const n1 = normals[(i - 1 + n) % n], n2 = normals[i];
    const k = d / Math.max(0.5, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
  });
}

function circleRing(cx, cz, r, n = 40) {
  const ring = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return ring;
}

function polysArea(polys) {
  let a = 0;
  for (const rings of polys) rings.forEach((r, k) => { a += k ? -Math.abs(ringArea(r)) : Math.abs(ringArea(r)); });
  return Math.max(0, a);
}

// Andrew's monotone chain hull.
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Long / short side of the smallest rotated rectangle around a convex hull.
function hullAspect(hull) {
  let best = { area: Infinity, aspect: 1 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uz, v = -p[0] * uz + p[1] * ux;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const du = u1 - u0, dv = v1 - v0;
    if (du * dv < best.area) best = { area: du * dv, aspect: Math.max(du, dv) / Math.max(1e-9, Math.min(du, dv)) };
  }
  return best.aspect;
}

// Radius of the smallest enclosing circle (incremental Welzl).
function minEnclosingRadius(points) {
  const inside = (c, p) => Math.hypot(p[0] - c.x, p[1] - c.y) <= c.r * (1 + 1e-9) + 1e-9;
  const two = (a, b) => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 });
  const three = (a, b, c) => {
    const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1];
    const d = 2 * (bx * cy - by * cx);
    if (Math.abs(d) < 1e-12) return [two(a, b), two(a, c), two(b, c)].reduce((m, k) => (k.r > m.r ? k : m));
    const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (cy * b2 - by * c2) / d, uy = (bx * c2 - cx * b2) / d;
    return { x: a[0] + ux, y: a[1] + uy, r: Math.hypot(ux, uy) };
  };
  let c = null;
  for (let i = 0; i < points.length; i++) {
    if (c && inside(c, points[i])) continue;
    c = { x: points[i][0], y: points[i][1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(c, points[j])) continue;
      c = two(points[i], points[j]);
      for (let k = 0; k < j; k++) if (!inside(c, points[k])) c = three(points[i], points[j], points[k]);
    }
  }
  return c ? c.r : 0;
}

// ---------------------------------------------------------------------------------------------
// Round fields
// ---------------------------------------------------------------------------------------------

/**
 * Is this field round enough for a centre pivot?
 * @param polygons [[outerRing [[x, z], ...], hole...], ...] in scene units (or metres; the
 *                 test is scale-free except for a light de-noising of pixel-traced edges)
 * Measured on the biggest part's outer ring, all three must hold:
 *   compactness 4 pi A / P^2 on the outline simplified by 1.5% of its size (> 0.8; the
 *     simplification irons out the stair-steps of pixel-traced circles),
 *   circle fill A / smallest enclosing circle (> 0.78; a square with chamfered corners can
 *     pass the compactness test but stays near 0.65 here),
 *   the smallest rotated rectangle around it is under 1.3 : 1.
 */
export function isRound(polygons) {
  const polys = normalise(polygons);
  if (!polys.length) return false;
  const big = polys.reduce((a, p) => (Math.abs(ringArea(p[0])) > Math.abs(ringArea(a[0])) ? p : a));
  // A farm whose other parts are a big share of the field is not one round field.
  const total = polys.reduce((s, p) => s + Math.abs(ringArea(p[0])), 0);
  const ring = big[0];
  const area = Math.abs(ringArea(ring));
  if (area <= 0 || area < total * 0.85) return false;
  const simple = simplifyRing(ring, 0.015 * Math.sqrt(area));
  const per = ringLength(simple);
  const compactness = per > 0 ? (4 * Math.PI * Math.abs(ringArea(simple))) / (per * per) : 0;
  const hull = convexHull(ring);
  if (hull.length < 3) return false;
  const r = minEnclosingRadius(hull);
  const circleFill = r > 0 ? area / (Math.PI * r * r) : 0;
  return hullAspect(hull) < ROUND_MAX_ASPECT && compactness > ROUND_COMPACTNESS && circleFill > ROUND_CIRCLE_FILL;
}

// ---------------------------------------------------------------------------------------------
// Geometry batching (one merged mesh per material)
// ---------------------------------------------------------------------------------------------

function batcher() {
  const buckets = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const push = (material, g) => {
    if (!buckets.has(material)) buckets.set(material, []);
    buckets.get(material).push(g);
  };
  const api = {
    add(material, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo) geo.dispose();
      g.deleteAttribute('uv');
      g.applyMatrix4(m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz)));
      push(material, g);
      return api;
    },
    rod(material, a, b, radius, sides = 5) {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      if (len < 1e-4) return api;
      const g = new THREE.CylinderGeometry(radius, radius, len, sides, 1).toNonIndexed();
      g.deleteAttribute('uv');
      q.setFromUnitVectors(UP, dir.clone().normalize());
      g.applyMatrix4(m4.compose(p.copy(a).addScaledVector(dir, 0.5), q, s.set(1, 1, 1)));
      push(material, g);
      return api;
    },
    build(parent, name, cast = true, receive = true) {
      for (const [material, list] of buckets) {
        const merged = mergeGeometries(list);
        list.forEach((g) => g.dispose());
        const m = mesh(merged, material, cast, receive);
        m.name = name;
        parent.add(m);
      }
      buckets.clear();
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------
// Bed, furrows
// ---------------------------------------------------------------------------------------------

// The raised soil bed for one polygon: extruded with a softened top edge; the side walls sit
// exactly on the outline (bevelOffset pulls the bevel inwards), the top cap is in the soil
// colour and the walls in the side colour.
function makeBed(rings, style, bedHeight) {
  const toV = ([x, z]) => new THREE.Vector2(x, -z);
  const shape = new THREE.Shape(rings[0].map(toV));
  for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(toV)));
  const total = bedHeight + BED_SINK;
  const bevel = Math.min(BED_BEVEL, total * 0.3);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: total - bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel,
    bevelSegments: 2, curveSegments: 1,
  });
  // the extrusion runs from -bevel (bottom bevel, below ground) up to total; put its top at bedHeight
  geo.rotateX(-Math.PI / 2).translate(0, bedHeight - total, 0);
  geo.deleteAttribute('uv');
  const bed = mesh(geo, [mat(style.soil), mat(style.sides)], false, true);
  bed.name = 'Paddock bed';
  return bed;
}

// Rows across the polygons at `angle` (u along the rows, v across), mirroring crops.js
// layoutRows: rows centred in the outer rings' v extent. Returns, per row, the inside
// intervals [[u0, u1], ...] (even-odd over every ring).
function rowIntervals(polys, angle, rowSpacing, phase = 0) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const uv = polys.map((rings) => rings.map((r) => r.map(([x, z]) => [x * ca + z * sa, -x * sa + z * ca])));
  let vmin = Infinity, vmax = -Infinity;
  for (const rings of uv) for (const [, v] of rings[0]) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  const nRows = Math.floor((vmax - vmin) / rowSpacing) + 1;
  const v0 = vmin + (vmax - vmin - (nRows - 1) * rowSpacing) / 2 + phase * rowSpacing;
  const rows = [];
  for (let row = 0; row < nRows; row++) {
    const v = v0 + row * rowSpacing;
    if (v - vmin < 0.05 || vmax - v < 0.05) continue;
    const us = [];
    for (const rings of uv) for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [au, av] = ring[j], [bu, bv] = ring[i];
        if ((av > v) !== (bv > v)) us.push(au + ((v - av) * (bu - au)) / (bv - av));
      }
    }
    us.sort((a, b) => a - b);
    const iv = [];
    for (let k = 0; k + 1 < us.length; k += 2) iv.push([us[k], us[k + 1]]);
    rows.push({ row, v, iv });
  }
  return { rows, ca, sa };
}

// The prototype's furrow ridges (alternating soil tones) under every plant row.
function addRidges(parent, polys, angle, rowSpacing, style, bedHeight) {
  const { rows, ca, sa } = rowIntervals(polys, angle, rowSpacing);
  const radius = Math.min(RIDGE_RADIUS, rowSpacing * 0.42);
  const light = new THREE.Color(style.soil).lerp(new THREE.Color(0xffffff), 0.04).getHex();
  const dark = new THREE.Color(style.soil).lerp(new THREE.Color(style.sides), 0.55).getHex();
  const b = batcher();
  let count = 0;
  for (const { row, v, iv } of rows) {
    for (const [ua, ub] of iv) {
      const a = ua + RIDGE_END, c = ub - RIDGE_END;
      if (c - a < 0.15) continue;
      const um = (a + c) / 2;
      const x = um * ca - v * sa, z = um * sa + v * ca;
      b.add(mat(row % 2 ? dark : light), new THREE.CylinderGeometry(radius, radius, c - a, 7, 1),
        x, bedHeight + RIDGE_LIFT, z, 0, -angle, Math.PI / 2, 1, 1, 0.8);
      count++;
    }
  }
  if (count) b.build(parent, 'Furrow ridges', false, true);
}

// A few dark furrow lines in the troughs between fallow ridges (visible before anything grows).
function addFurrowLines(parent, polys, angle, rowSpacing, style, bedHeight) {
  const step = rowSpacing * Math.max(1, Math.round(0.3 / rowSpacing));
  const { rows, ca, sa } = rowIntervals(polys, angle, step, 0.5);
  const dark = new THREE.Color(style.sides).lerp(new THREE.Color(style.soil), 0.35).getHex();
  const b = batcher();
  let count = 0;
  for (const { v, iv } of rows) {
    for (const [ua, ub] of iv) {
      const a = ua + RIDGE_END, c = ub - RIDGE_END;
      if (c - a < 0.12) continue;
      const um = (a + c) / 2;
      b.add(mat(dark), new THREE.BoxGeometry(c - a, 0.012, 0.035), um * ca - v * sa, bedHeight + 0.002, um * sa + v * ca, 0, -angle, 0);
      count++;
    }
  }
  if (count) b.build(parent, 'Furrow lines', false, true);
}

// ---------------------------------------------------------------------------------------------
// Fence (instanced posts and rails so it can pop in cheaply)
// ---------------------------------------------------------------------------------------------

// Pick the fence edge for the gate: its outward side faces `toward` best; long edges win ties.
function pickGateEdge(ring, toward) {
  const n = ring.length;
  let best = -1, bestScore = -Infinity, longest = 0, longestI = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > longest) { longest = len; longestI = i; }
    if (len < GATE_MIN_EDGE) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    // outward normal of a positive-area ring: right of (dx, dz) -> (dz, -dx)
    const ox = uz, oz = -ux;
    let dx = 0, dz = 1;
    if (toward) {
      dx = toward[0] - (a[0] + b[0]) / 2; dz = toward[1] - (a[1] + b[1]) / 2;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    }
    const score = ox * dx + oz * dz + 0.04 * Math.min(len, 3);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best < 0 && longest >= 2 * GATE_MIN_HALF + 0.24) best = longestI;
  return best;
}

// Collect posts and rails for one fence line. `ring` is positive-area (or a hole, outset);
// gi = the edge with the gate gap or -1. Pushes { kind, x, z, w, h, d, ry, rx, rz, y, len } items.
function fenceItems(ring, gi, bedHeight, r, items, order0) {
  const R = r.range;
  const n = ring.length;
  const postTop = () => bedHeight + R(0.3, 0.4) + BED_SINK; // the prototype's 0.4-0.5 above its 0.08 bed
  const railYs = [bedHeight + 0.09, bedHeight + 0.24];
  // start at the gate (or vertex 0) so the pop-in runs round from the gate
  const startEdge = gi >= 0 ? gi : 0;
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.hypot(ring[(i + 1) % n][0] - ring[i][0], ring[(i + 1) % n][1] - ring[i][1]);
  let walked = 0;
  let last = null;
  const post = (x, z, w, h, along) => {
    if (last && Math.hypot(x - last[0], z - last[1]) < POST_MIN_GAP) return;
    last = [x, z];
    items.push({ kind: 'post', x, z, y: -BED_SINK, w, h, d: w, rx: R(-0.05, 0.05), ry: R(-0.2, 0.2), rz: R(-0.05, 0.05), order: order0 + along / Math.max(total, 1e-6) });
  };
  const rail = (ax, az, bx, bz, along) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    for (const y of railYs) {
      items.push({ kind: 'rail', x: (ax + bx) / 2, z: (az + bz) / 2, y: y - 0.025, w: len, h: 0.05, d: 0.045, rx: 0, ry: -Math.atan2(bz - az, bx - ax), rz: R(-0.03, 0.03), order: order0 + along / Math.max(total, 1e-6) });
    }
  };
  let gate = null;
  for (let s = 0; s < n; s++) {
    const i = (startEdge + s) % n;
    const a = ring[i], b = ring[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const at = (t) => [a[0] + ux * t, a[1] + uz * t];
    if (i === gi) {
      // gate in the middle of this edge: rails a..g0 and g1..b, taller gate posts, bar swung open
      const half = Math.min(GATE_HALF, (len - 0.24) / 2);
      const m = len / 2, t0 = m - half, t1 = m + half;
      const g0 = at(t0), g1 = at(t1);
      // walk from the far gate post (the run starts at the gate)
      const nB = Math.max(1, Math.round((len - t1) / POST_STEP));
      for (let k = 0; k < nB; k++) { const p = at(t1 + ((len - t1) * k) / nB); post(p[0], p[1], 0.085, postTop(), walked + t1 + ((len - t1) * k) / nB); }
      rail(g1[0], g1[1], b[0], b[1], walked + len);
      gate = { a, ux, uz, len, t0, t1, g0, g1, half };
    } else {
      const k = Math.max(1, Math.round(len / POST_STEP));
      for (let j = 0; j < k; j++) { const p = at((len * j) / k); post(p[0], p[1], 0.085, postTop(), walked + (len * j) / k); }
      rail(a[0], a[1], b[0], b[1], walked + len);
    }
    walked += len;
  }
  if (gate) {
    // the near half of the gate edge, walked last
    const { a, ux, uz, t0, g0, g1, half } = gate;
    const nA = Math.max(1, Math.round(t0 / POST_STEP));
    for (let k = 0; k < nA; k++) { const t = (t0 * k) / nA; post(a[0] + ux * t, a[1] + uz * t, 0.085, postTop(), walked + t); }
    rail(a[0], a[1], g0[0], g0[1], walked + t0);
    const H = bedHeight + 0.48 + BED_SINK; // the prototype's taller gate posts
    const ry = -Math.atan2(uz, ux);
    for (const g of [g0, g1]) {
      items.push({ kind: 'post', x: g[0], z: g[1], y: -BED_SINK, w: 0.11, h: H, d: 0.11, rx: 0, ry, rz: 0, order: order0 + 0.02 });
    }
    // gate bar swung half open, outwards (the prototype's .9 x gap, tilted 0.32)
    const ox = uz, oz = -ux;
    const mx = (g0[0] + g1[0]) / 2, mz = (g0[1] + g1[1]) / 2;
    items.push({ kind: 'rail', x: mx + ux * 0.05 + ox * 0.12, z: mz + uz * 0.05 + oz * 0.12, y: bedHeight + 0.15, w: half * 2 * 0.9, h: 0.04, d: 0.04, rx: 0, ry, rz: 0.32, order: order0 + 1 });
    return { x: mx, z: mz, nx: ox, nz: oz };
  }
  return null;
}

// Builds the posts and rails as two InstancedMeshes. Returns { group, setGrowth(t) }.
function buildFence(items) {
  const group = new THREE.Group();
  group.name = 'Paddock fence';
  const posts = items.filter((i) => i.kind === 'post');
  const rails = items.filter((i) => i.kind === 'rail');
  const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  unit.deleteAttribute('uv');
  const make = (list, material, name) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(unit, material, list.length);
    im.name = name;
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(im);
    return im;
  };
  const postMesh = make(posts, mat(ISLAND_COLORS.woodDark), 'Fence posts');
  const railMesh = make(rails, mat(ISLAND_COLORS.wood, { roughness: 0.8 }), 'Fence rails');
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const ease = (k) => { const c1 = 1.5, c3 = c1 + 1, x = k - 1; return 1 + c3 * x * x * x + c1 * x * x; };
  const POP = 0.25; // share of the fence's time window each piece takes to pop
  const write = (im, list, t, railMode) => {
    if (!im) return;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const start = Math.min(1, it.order) * (1 - POP);
      let k = (t - start) / POP;
      k = k <= 0 ? 0 : k >= 1 ? 1 : ease(k);
      const sy = Math.max(1e-4, k);
      const sxz = railMode ? sy : 1;
      m4.compose(p.set(it.x, it.y, it.z), q.setFromEuler(e.set(it.rx, it.ry, it.rz)), s.set(it.w, it.h * sy, it.d * sxz));
      im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  };
  let last = -1;
  const setGrowth = (t) => {
    t = Math.max(0, Math.min(1, +t || 0));
    if (t === last) return;
    last = t;
    write(postMesh, posts, t, false);
    // rails trail their posts a little
    write(railMesh, rails, Math.max(0, t - 0.08) / 0.92, true);
  };
  setGrowth(1);
  return { group, setGrowth, postCount: posts.length, railCount: rails.length };
}

// ---------------------------------------------------------------------------------------------
// Centre-pivot irrigator (new asset, chunky low-poly, galvanised)
// ---------------------------------------------------------------------------------------------

// A pivot point in the middle and a truss arm (+x) on wheeled A-frame towers at `towers` radii,
// overhanging to `tip`. Base at y = 0. Turn userData.arm.rotation.y to sweep it round.
function makePivotIrrigator(towers, tip) {
  const H = Math.max(PIVOT_H[0], Math.min(PIVOT_H[1], tip * 0.38));
  const g = new THREE.Group();
  g.name = 'Centre pivot';
  const galv = mat(GALV, { roughness: 0.6, metalness: 0.25 });
  const galvDark = mat(GALV_DARK, { roughness: 0.6, metalness: 0.25 });
  const tyre = mat(0x4b4540);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // fixed pivot point: concrete pad, four splayed legs, riser pipe, swivel cap, control box
  const fixed = batcher();
  fixed.add(mat(0xbfb8aa), new THREE.CylinderGeometry(0.2, 0.23, 0.05, 8), 0, 0.025, 0);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) fixed.rod(galvDark, V(x * 0.15, 0.04, z * 0.15), V(x * 0.03, H - 0.06, z * 0.03), 0.018, 4);
  fixed.rod(galv, V(0, 0.04, 0), V(0, H + 0.1, 0), 0.042, 8);
  fixed.add(galvDark, new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8), 0, H + 0.12, 0);
  fixed.add(mat(ISLAND_COLORS.cream), new THREE.BoxGeometry(0.13, 0.17, 0.07), 0, 0.42, 0.09);
  fixed.add(mat(ISLAND_COLORS.roof[0]), new THREE.BoxGeometry(0.15, 0.03, 0.09), 0, 0.52, 0.09);
  fixed.add(mat(0xd0604c), new THREE.BoxGeometry(0.03, 0.03, 0.02), 0.03, 0.44, 0.13);
  fixed.build(g, 'Pivot point');

  const arm = new THREE.Group();
  arm.name = 'Pivot arm';
  g.add(arm);
  const b = batcher();
  const T = towers;
  const lastT = T[T.length - 1];
  // main water pipe to the last tower, a thinner overhang, an end gun pointing down
  b.rod(galv, V(0, H, 0), V(lastT, H, 0), 0.036, 8);
  b.rod(galv, V(lastT, H, 0), V(tip, H - 0.03, 0), 0.022, 6);
  b.add(galvDark, new THREE.ConeGeometry(0.035, 0.08, 6), tip, H - 0.07, 0, Math.PI, 0, 0);
  // trusses under each span: two lower chords bent into a shallow V, struts up to the pipe
  let prev = 0.06;
  for (const t of [...T, tip]) {
    const a = prev + 0.04, c = t - 0.04;
    if (c - a < 0.2) { prev = t; continue; }
    const mid = (a + c) / 2, sag = Math.min(0.2, (c - a) * 0.28) * (t === tip ? 0.5 : 1);
    const low = (x) => H - 0.03 - sag * (1 - Math.abs((x - mid) / ((c - a) / 2)));
    for (const z of [-0.05, 0.05]) {
      b.rod(galvDark, V(a, H - 0.03, z), V(mid, H - 0.03 - sag, z), 0.009, 4);
      b.rod(galvDark, V(mid, H - 0.03 - sag, z), V(c, H - 0.03, z), 0.009, 4);
    }
    const bays = Math.max(3, Math.round((c - a) / 0.16));
    for (let k = 1; k < bays; k++) {
      const x = a + ((c - a) * k) / bays;
      const z = k % 2 ? 0.05 : -0.05;
      b.rod(galvDark, V(x, H, 0), V(x, low(x), z), 0.007, 4);
      b.rod(galvDark, V(x, H, 0), V(x, low(x), -z), 0.007, 4);
    }
    // drop hoses with little nozzles
    for (let x = a + 0.12; x < c - 0.06; x += 0.26) {
      b.rod(galvDark, V(x, H - 0.03, 0), V(x, H * 0.66, 0), 0.006, 4);
      b.add(galv, new THREE.ConeGeometry(0.018, 0.04, 5), x, H * 0.66 - 0.01, 0, Math.PI, 0, 0);
    }
    prev = t;
  }
  // wheeled A-frame towers; the wheels roll round the circle (along z in arm space)
  for (const t of T) {
    for (const z of [-1, 1]) b.rod(galv, V(t, H - 0.02, 0), V(t, 0.17, z * 0.19), 0.02, 5);
    b.rod(galvDark, V(t, H * 0.45, -0.12), V(t, H * 0.45, 0.12), 0.012, 4);
    b.add(galvDark, new THREE.BoxGeometry(0.07, 0.05, 0.44), t, 0.16, 0);
    b.add(mat(0x8f969c), new THREE.BoxGeometry(0.1, 0.08, 0.09), t, 0.21, 0);
    for (const z of [-1, 1]) {
      b.add(tyre, new THREE.CylinderGeometry(0.1, 0.1, 0.065, 10), t, 0.1, z * 0.24, Math.PI / 2, 0, 0);
      b.add(galv, new THREE.CylinderGeometry(0.045, 0.045, 0.075, 8), t, 0.1, z * 0.24, Math.PI / 2, 0, 0);
    }
  }
  b.build(arm, 'Pivot arm');
  g.userData.arm = arm;
  return g;
}

// ---------------------------------------------------------------------------------------------
// The paddock
// ---------------------------------------------------------------------------------------------

/**
 * Build one field's paddock with its real outline.
 * @param polygons [[outerRing [[x, z], ...], hole...], ...] in scene units at the island position
 *                 (x east, z south); rings may be open or closed, any winding.
 * @param {object} o
 * @param {string} o.cropKey      one of CROP_KEYS (other names go through cropKeyFor)
 * @param {number} [o.seed=1]     same seed -> same fence wobble, plants and pivot angle
 * @param {number} [o.bedHeight=0.18] height of the soil bed's top above y = 0
 * @param {[number, number]} [o.gateToward] the gate faces this point (e.g. the island centre);
 *                 default: the south (+z) side
 * @returns {THREE.Group} base at y = 0. userData:
 *   { setGrowth(t), crops, bedHeight, isPivot, cropKey, gate, arm, beds, area, plantCount }
 *   setGrowth(t): t 0..1; the fence pops in during 0..0.3 (pivot too), the crop over 0..1.
 *   gate: { x, z, nx, nz } middle of the (first) gate and its outward direction, or null.
 *   arm: the pivot's rotating arm (null unless isPivot); beds: the soil meshes (for picking).
 */
export function makeFieldPaddock(polygons, { cropKey, seed = 1, bedHeight = 0.18, gateToward = null } = {}) {
  const key = CROP_KEYS.includes(cropKey) ? cropKey : cropKeyFor(cropKey);
  const style = CROP_STYLE[key];
  const r = rng(seed * 7919 + 101);
  const group = new THREE.Group();
  group.name = `Paddock (${style.label})`;

  const raw = normalise(polygons);
  const empty = { setGrowth: () => {}, setSize: () => {}, crops: null, bedHeight, isPivot: false, cropKey: key, gate: null, arm: null, beds: [], area: 0, plantCount: 0 };
  if (!raw.length) { group.userData = empty; return group; }

  // the bed follows the real outline, minus sub-pixel noise
  const polys = raw.map((rings) => rings.map((ring) => simplifyRing(ring, BED_SIMPLIFY)));
  const area = polysArea(polys);
  const pivot = isRound(polys);

  const beds = [];
  for (const rings of polys) {
    const bed = makeBed(rings, style, bedHeight);
    group.add(bed);
    beds.push(bed);
  }

  const maxPlants = Math.max(12, Math.min(MAX_PLANTS, Math.round(area * PLANTS_PER_UNIT2)));
  const furrowed = key in ROW_GAP;
  let plantPolys;
  let pivotInfo = null;

  if (pivot) {
    // centre and radii of the round field (the biggest part)
    const big = polys.reduce((a, p) => (Math.abs(ringArea(p[0])) > Math.abs(ringArea(a[0])) ? p : a));
    const ring = big[0];
    const [cx, cz] = ringCentroid(ring);
    let rmin = Infinity, rsum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      rmin = Math.min(rmin, segDist(cx, cz, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
      rsum += Math.hypot(ring[i][0] - cx, ring[i][1] - cz);
    }
    const rmean = rsum / ring.length;
    const rp = rmin - PIVOT_EDGE_INSET;
    const count = Math.max(1, Math.min(5, Math.round(rp / PIVOT_TOWER_STEP)));
    const towers = [];
    for (let k = 1; k <= count; k++) towers.push((rp * k) / (count + 0.5));
    // planted: the whole circle bar a bare patch round the pivot point (the crop grows across
    // the wheel tracks, as on a real pivot; cutting the tracks out would leave too little room
    // in small fields because plantField keeps its plants clear of every edge)
    plantPolys = [[insetRing(ring, PIVOT_EDGE_INSET), circleRing(cx, cz, PIVOT_CENTRE_BARE, 32).reverse(), ...big.slice(1).map((h) => insetRing(h, -PIVOT_EDGE_INSET))]];
    for (const other of polys) if (other !== big) plantPolys.push(other.map((rg, k) => insetRing(rg, k ? -PIVOT_EDGE_INSET : PIVOT_EDGE_INSET)));
    pivotInfo = { cx, cz, towers, tip: Math.max(towers[towers.length - 1] + 0.2, rmean * 0.97 - 0.04) };
  } else {
    plantPolys = polys.map((rings) => rings.map((rg, k) => {
      const d = FENCE_INSET + PLANT_INSET;
      return insetRing(rg, k ? -d : d);
    }));
  }
  // drop planted rings the inset turned inside out
  plantPolys = plantPolys.filter((p) => p[0].length >= 3 && ringArea(p[0]) > 0.01);

  const crops = plantField(key, plantPolys, { seed, maxPlants });
  crops.position.y = bedHeight + (furrowed ? CROP_LIFT : 0);
  group.add(crops);
  const angle = crops.userData.rowAngle;
  const spacing = crops.userData.spacing;
  if (plantPolys.length && spacing > 0) {
    if (furrowed) addRidges(group, plantPolys, angle, spacing * ROW_GAP[key], style, bedHeight);
    else if (key === 'fallow') addFurrowLines(group, plantPolys, angle, spacing, style, bedHeight);
  }

  let fence = null, gate = null, arm = null, pivotGroup = null;
  if (pivotInfo) {
    const { cx, cz, towers, tip } = pivotInfo;
    const rutM = mat(new THREE.Color(style.sides).lerp(new THREE.Color(0x6e5139), 0.3).getHex());
    const ruts = batcher();
    for (const t of towers) {
      ruts.add(rutM, new THREE.RingGeometry(t - PIVOT_TRACK_HALF, t + PIVOT_TRACK_HALF, 56, 1), cx, bedHeight + 0.003, cz, -Math.PI / 2, 0, 0);
    }
    ruts.add(rutM, new THREE.CircleGeometry(PIVOT_CENTRE_BARE - 0.02, 24), cx, bedHeight + 0.003, cz, -Math.PI / 2, 0, 0);
    ruts.build(group, 'Wheel tracks', false, true);
    pivotGroup = makePivotIrrigator(towers, tip);
    pivotGroup.position.set(cx, bedHeight, cz);
    arm = pivotGroup.userData.arm;
    arm.rotation.y = r.range(0, Math.PI * 2);
    group.add(pivotGroup);
  } else {
    const items = [];
    polys.forEach((rings) => {
      const outer = insetRing(simplifyRing(rings[0], FENCE_SIMPLIFY), FENCE_INSET);
      const gi = pickGateEdge(outer, gateToward);
      const g = fenceItems(outer, gi, bedHeight, r, items, 0);
      if (g && !gate) gate = g;
      // fence round any hole big enough to matter (no gate)
      for (const hole of rings.slice(1)) {
        if (ringLength(hole) < 1.2) continue;
        const h = insetRing(simplifyRing(hole, FENCE_SIMPLIFY), -FENCE_INSET);
        h.reverse(); // positive area, so the fence code's outward side faces the hole
        fenceItems(h, -1, bedHeight, r, items, 0);
      }
    });
    fence = buildFence(items);
    group.add(fence.group);
  }

  const ease = (k) => { const c1 = 1.4, c3 = c1 + 1, x = k - 1; return 1 + c3 * x * x * x + c1 * x * x; };
  const setGrowth = (t) => {
    t = Math.max(0, Math.min(1, +t || 0));
    crops.userData.setGrowth(t);
    const f = Math.min(1, t / FENCE_POP);
    if (fence) fence.setGrowth(f);
    if (pivotGroup) {
      const s = f <= 0 ? 1e-4 : f >= 1 ? 1 : Math.max(1e-4, ease(f));
      pivotGroup.scale.set(1, s, 1);
      pivotGroup.visible = f > 0;
    }
  };

  group.userData = {
    setGrowth,
    /** Every plant at one size (0..1): growing through the season, or stubble after harvest. */
    setSize: (s) => crops.userData.setSize?.(s),
    crops,
    bedHeight,
    isPivot: !!pivotInfo,
    cropKey: key,
    gate,
    arm,
    beds,
    area,
    plantCount: crops.userData.count,
  };
  return group;
}
