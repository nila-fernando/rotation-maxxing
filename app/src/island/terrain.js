// Island terrain: the prototype island's ground, beach, sea and foam, generalised to any island plan.
//
// Ported from team-sheeeep-assets/team-sheeeep-3d/index.html (heightAt, COAST, FEAT, FLAT, slab,
// groundColor, shoreR, the ground ring, the sea ring and the foam bands, the stone cliff and the
// grass / flower scatter). The prototype hard-coded one island; here every part is driven by a plan:
//
//   plan = {
//     seed, radius,
//     coast:    { center: [x, z], radii: [r0, r1, ... rN] }   // evenly spaced angles from 0 to 2*pi
//                                                            // (closed: rN repeats r0; an open list wraps)
//     terraces: [{ level, height, polygon: [[x, z], ...] }]   // raised shelves
//     flats:    [{ type: 'polygon', polygon, level, pad } | { type: 'circle', x, z, r, level, pad }]
//     features: [{ type: 'crag' | 'hill' | 'pond', at: [x, z], r }]
//   }
//
// Units and axes are the prototype's: x east, z south, y up; the prototype island was about 7 units
// in radius. Coast angles are measured like the prototype's, atan2(z - cz, x - cx).
//
// Levels: levelHeight(level) = 0.55 + 0.35 * level (the prototype's H0 and SLAB). Level 0 is the
// ordinary grass.
//
// Terraces: the polygon is lifted to `height` (default levelHeight(level)) and a soft rounded riser,
// TERRACE_SLOPE (0.35) units wide, runs outward from its edge. Lower levels are applied first, so a
// level-2 polygon should sit inside (or next to) a level-1 one.
//
// Flats: real-shaped field polygons (and round slots for buildings / tools) that must be exactly
// level. Everything inside the polygon, grown outward by `pad`, is exactly levelHeight(level);
// outside it the ground eases back to the natural terrain over FLAT_BLEND (0.6) units. A polygon may
// be a plain ring [[x, z], ...] or a list of rings [outer, ...holes]; holes are kept level too.
// A flat with no level takes the shelf it stands on (terrace plus crag / hill steps).
//
// Coast: radii give the coastline by angle (smoothly interpolated, plus a gentle seeded wobble).
// Wherever a flat would come closer than COAST_CLEAR to the coast, the nearby radii are pushed out,
// so the coast always encloses every flat with grass and beach to spare.
//
// Features: crag = the prototype's stepped rocky block with a sheer stone face looking towards the
// island centre; hill = a soft stepped mound (the prototype's windmill hill); pond = a sunken bowl
// holding a disc of water with a sandy rim. `r` is the feature's radius in units.

import * as THREE from 'three';
import { ISLAND_COLORS, rng, jitter, mat, mesh, matrix, instanced, makeRock, mergeStatic } from './props.js';

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

export const SEA_LEVEL = 0;          // the prototype's WATER
export const BASE_HEIGHT = 0.55;     // the prototype's H0: level-0 grass
export const LEVEL_STEP = 0.35;      // the prototype's SLAB: one shelf
const CRAG_PLATEAU = 0.64;            // a crag's flat top reaches this far out (of its radius)
export const TERRACE_SLOPE = 0.35;   // width of a terrace riser
export const FLAT_BLEND = 0.6;       // how far a flat eases back into the natural ground
export const COAST_CLEAR = 1.6;      // least distance from a padded flat to the coastline
const RISE = 0.2;                    // fraction of a slab that is riser (the prototype's RISE)
const BEACH = -0.32;                 // the beach shelf the coast sinks to
const SEABED = -1.7;                 // deep sea floor
const GROUND_RES = 0.12;             // ground mesh spacing along the coast (finer inland)

export function levelHeight(level = 0) {
  return BASE_HEIGHT + LEVEL_STEP * level;
}

// ---------------------------------------------------------------------------------------------
// Noise and small maths (the prototype's own)
// ---------------------------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => hash3(a * 1.31, b * 1.17, 7.7);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
const fbm = (x, y) => vnoise(x, y) * 0.5 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 3.7) * 0.2;

// The prototype's slab(), relative: rounds a height change into shelves with short rounded risers.
// slabRel(0) = 0 and slabRel(k * LEVEL_STEP) = k * LEVEL_STEP exactly.
function slabRel(dh) {
  const v = dh / LEVEL_STEP;
  const f = v - Math.floor(v);
  return LEVEL_STEP * (Math.floor(v) + smooth(1 - RISE, 1, f));
}

function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// Signed distance to a set of rings (even-odd, so holes work): positive inside, negative outside.
function ringsSignedDist(x, z, rings) {
  let inside = false;
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
      if ((bz > z) !== (az > z) && x < ((ax - bx) * (z - bz)) / (az - bz) + bx) inside = !inside;
      const vx = bx - ax, vz = bz - az;
      const len2 = vx * vx + vz * vz;
      const t = len2 > 0 ? clamp01(((x - ax) * vx + (z - az) * vz) / len2) : 0;
      const ex = x - ax - vx * t, ez = z - az - vz * t;
      const d = ex * ex + ez * ez;
      if (d < best) best = d;
    }
  }
  best = Math.sqrt(best);
  return inside ? best : -best;
}

// A plan polygon as a list of open rings: accepts [[x, z], ...] or [[[x, z], ...], ...holes].
function toRings(polygon) {
  if (!polygon || !polygon.length) return [];
  const rings = Array.isArray(polygon[0][0]) ? polygon : [polygon];
  return rings
    .map((ring) => {
      const r = ring.map((p) => [+p[0], +p[1]]);
      const a = r[0], b = r[r.length - 1];
      if (r.length > 1 && a[0] === b[0] && a[1] === b[1]) r.pop();
      return r;
    })
    .filter((r) => r.length >= 3);
}

// ---------------------------------------------------------------------------------------------
// The height field (pure: no three.js objects are made here)
// ---------------------------------------------------------------------------------------------

// Builds heightAt(x, z) for a plan. The returned function also carries the helpers the meshes use
// (coastR, shoreR, flatMask, pathMask, pondMask, cragMask, isFree, flatAt, ...) and the resolved
// flats (heightAt.flats[i]: { index, source, type, level, y, pad, rings | x, z, r, ... }).
export function makeHeightField(plan, { seed } = {}) {
  const sd = (seed ?? plan.seed ?? 1) | 0;
  const so = ((sd * 0.6180339887) % 1) * 97; // noise offset per seed
  const coast = plan.coast || {};
  const [cx, cz] = coast.center || [0, 0];
  let radii = coast.radii && coast.radii.length ? coast.radii.slice() : [plan.radius || 7];
  if (radii.length === 1) radii = [radii[0], radii[0]];
  const closed = radii.length > 2 && Math.abs(radii[0] - radii[radii.length - 1]) < 1e-6;
  const segs = closed ? radii.length - 1 : radii.length;
  const node = (i) => (closed ? (i === segs ? 0 : i) : i % segs);

  // irregular coastline: radius by angle, smoothly interpolated plus a gentle wobble
  function coastR(th) {
    const a = ((((th % TAU) + TAU) % TAU) / TAU) * segs;
    const i = Math.min(segs - 1, Math.floor(a));
    const t = a - i;
    const s = t * t * (3 - 2 * t);
    return lerp(radii[node(i)], radii[node(i + 1)], s) + (vnoise(Math.cos(th) * 2.4 + 7 + so, Math.sin(th) * 2.4 + 7 + so) - 0.5) * 0.5;
  }

  // ---- terraces ----
  const terraces = (plan.terraces || [])
    .map((t) => ({ t, rings: toRings(t.polygon) }))
    .filter(({ rings }) => rings.length)
    .map(({ t, rings }) => {
      const pts = rings[0];
      const m = TERRACE_SLOPE + 0.1;
      return {
        level: t.level ?? 1,
        height: t.height ?? levelHeight(t.level ?? 1),
        rings,
        x0: Math.min(...pts.map((p) => p[0])) - m, x1: Math.max(...pts.map((p) => p[0])) + m,
        z0: Math.min(...pts.map((p) => p[1])) - m, z1: Math.max(...pts.map((p) => p[1])) + m,
      };
    })
    .sort((a, b) => a.level - b.level);

  // shelf surface: each terrace lifts its polygon to its height; its riser runs outward from the edge
  function terraceSurface(x, z) {
    let h = BASE_HEIGHT;
    for (const t of terraces) {
      if (x < t.x0 || x > t.x1 || z < t.z0 || z > t.z1) continue;
      const d = ringsSignedDist(x, z, t.rings);
      if (d >= 0) { h = t.height; continue; }
      const w = d + (vnoise(x * 1.4 + so, z * 1.4 + 3) - 0.5) * 0.12;
      h = lerp(h, t.height, smooth(-TERRACE_SLOPE, 0, w));
    }
    return h;
  }
  // the height of the shelf a point stands on, without risers
  function terraceAt(x, z) {
    let h = BASE_HEIGHT;
    for (const t of terraces) {
      if (x < t.x0 || x > t.x1 || z < t.z0 || z > t.z1) continue;
      if (ringsSignedDist(x, z, t.rings) >= 0) h = t.height;
    }
    return h;
  }

  // ---- features ----
  const fr = rng(sd * 131 + 7);
  const feats = [];
  const ponds = [];
  for (const f of plan.features || []) {
    const [fx, fz] = f.at;
    const r = Math.max(0.3, f.r || 1);
    if (f.type === 'pond') {
      ponds.push({ type: 'pond', cx: fx, cz: fz, r, rx: r, rz: r, p: 2, depth: 0.38, ew: 0.22, wob: 0.12, rot: fr() * TAU });
    } else if (f.type === 'crag') {
      const steps = Math.max(3, Math.min(6, Math.round(r * 2.6)));
      feats.push({
        type: 'crag', cx: fx, cz: fz, r, rx: r * 1.08, rz: r * 0.92, dh: LEVEL_STEP * steps, ew: 0.55, p: 2,
        rot: fr() * TAU, wob: 0.1,
        // the sheer stone face looks towards the island centre (the prototype's faced the paddocks)
        face: Math.atan2(cz - fz, cx - fx),
      });
    } else {
      const steps = Math.max(1, Math.min(4, Math.round(r * 1.15)));
      feats.push({
        type: 'hill', cx: fx, cz: fz, r, rx: r * 1.05, rz: r * 0.85, dh: LEVEL_STEP * steps, ew: 0.55, p: 2,
        rot: fr() * TAU, wob: 0.14,
      });
    }
  }
  for (const f of [...feats, ...ponds]) f.reach = (Math.max(f.rx, f.rz) * (1 + f.ew)) / (1 - f.wob) + 0.1;

  function featD(f, x, z) {
    const dx = x - f.cx, dz = z - f.cz, c = Math.cos(f.rot), s = Math.sin(f.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ax = Math.abs(lx) / f.rx, az = Math.abs(lz) / f.rz;
    let d = f.p === 4 ? Math.pow(ax ** 4 + az ** 4, 0.25) : Math.hypot(ax, az);
    const ph = Math.atan2(lz, lx);
    d *= 1 + f.wob * (vnoise(Math.cos(ph) * 1.6 + f.cx + 9 + so, Math.sin(ph) * 1.6 + f.cz + 9) - 0.5) * 2;
    return { d, phi: Math.atan2(dz, dx) };
  }
  // the crag has a sheer face towards the island centre and slopes gently everywhere else
  const cragSteep = (f, phi) => smooth(69 * D2R, 41 * D2R, Math.abs(angleDiff(phi, f.face)));
  function featVal(f, x, z) {
    if (Math.abs(x - f.cx) > f.reach || Math.abs(z - f.cz) > f.reach) return 0;
    const { d, phi } = featD(f, x, z);
    if (f.type === 'crag') {
      // a flat-topped crag: one broad level plateau (room for the windmill) behind the sheer face,
      // stepping down the gentle sides; as tall as before (its slope plus one more shelf)
      const ew = lerp(f.ew, 0.07, cragSteep(f, phi));
      return (f.dh + LEVEL_STEP) * smooth(1 + ew, Math.max(CRAG_PLATEAU, 1 - ew), d);
    }
    return f.dh * smooth(1 + f.ew, 1 - f.ew, d);
  }
  function featureSum(x, z) {
    let v = 0;
    for (const f of feats) v += featVal(f, x, z);
    return v;
  }
  function pondMask(x, z) {
    let m = 0;
    for (const p of ponds) {
      if (Math.abs(x - p.cx) > p.reach || Math.abs(z - p.cz) > p.reach) continue;
      m = Math.max(m, smooth(1 + p.ew, 1 - p.ew, featD(p, x, z).d));
    }
    return m;
  }
  function cragMask(x, z) {
    let m = 0;
    for (const f of feats) {
      if (f.type !== 'crag' || Math.abs(x - f.cx) > f.reach || Math.abs(z - f.cz) > f.reach) continue;
      m = Math.max(m, smooth(1.4, 0.9, featD(f, x, z).d));
    }
    return m;
  }
  const shelfAt = (x, z) => terraceAt(x, z) + (feats.length ? slabRel(featureSum(x, z)) : 0);

  // ---- flats ----
  // A polygon flat keeps a small signed-distance raster so that heightAt stays fast for real field
  // outlines with hundreds of vertices; the exact distance is used wherever the raster is too close
  // to the padded edge to be sure, so the inside of every flat is still exactly level.
  const flats = [];
  for (const [i, f] of (plan.flats || []).entries()) {
    const pad = Math.max(0, f.pad ?? 0);
    const level = Number.isFinite(f.level) ? f.level : null;
    if (f.type === 'circle') {
      const r = Math.max(0.05, f.r ?? 1);
      const out = { index: i, source: f, type: 'circle', level, pad, x: f.x, z: f.z, r, R: r + pad };
      const m = out.R + FLAT_BLEND + 0.4;
      Object.assign(out, { x0: f.x - m, x1: f.x + m, z0: f.z - m, z1: f.z + m });
      flats.push(out);
      continue;
    }
    const all = toRings(f.polygon);
    const rings = all.slice(0, 1); // holes stay level too, so only the outer ring shapes the flat
    if (!rings.length) continue;
    const outer = rings[0];
    let ax = 0, az = 0, a2 = 0;
    for (let k = 0, j = outer.length - 1; k < outer.length; j = k++) {
      const cr = outer[j][0] * outer[k][1] - outer[k][0] * outer[j][1];
      a2 += cr;
      ax += (outer[j][0] + outer[k][0]) * cr;
      az += (outer[j][1] + outer[k][1]) * cr;
    }
    const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1]);
    const m = pad + FLAT_BLEND + 0.4;
    const out = {
      index: i, source: f, type: 'polygon', level, pad, rings, holes: all.slice(1),
      area: Math.abs(a2) / 2,
      x: Math.abs(a2) > 1e-9 ? ax / (3 * a2) : xs.reduce((s, v) => s + v, 0) / xs.length,
      z: Math.abs(a2) > 1e-9 ? az / (3 * a2) : zs.reduce((s, v) => s + v, 0) / zs.length,
      x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, z0: Math.min(...zs) - m, z1: Math.max(...zs) + m,
    };
    // the raster: signed distance on a grid, at most ~90k samples per flat
    const W = out.x1 - out.x0, D = out.z1 - out.z0;
    const cell = Math.max(0.04, Math.sqrt((W * D) / 90000));
    const nx = Math.ceil(W / cell) + 1, nz = Math.ceil(D / cell) + 1;
    const grid = new Float32Array(nx * nz);
    for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
      grid[gz * nx + gx] = ringsSignedDist(out.x0 + gx * cell, out.z0 + gz * cell, rings);
    }
    Object.assign(out, { cell, nx, nz, grid, tol: cell * 1.5 + 1e-4 });
    flats.push(out);
  }
  for (const f of flats) {
    f.y = f.level !== null ? levelHeight(f.level) : shelfAt(f.x, f.z);
    if (f.level === null) f.level = Math.round((f.y - BASE_HEIGHT) / LEVEL_STEP);
  }

  // approximate signed distance to the flat's own shape (positive inside), from the raster
  function flatSd(f, x, z) {
    if (f.type === 'circle') return f.r - Math.hypot(x - f.x, z - f.z);
    const u = Math.max(0, Math.min(f.nx - 1.0001, (x - f.x0) / f.cell));
    const v = Math.max(0, Math.min(f.nz - 1.0001, (z - f.z0) / f.cell));
    const i = Math.floor(u), j = Math.floor(v), s = u - i, t = v - j, g = f.grid, n = f.nx;
    const k = j * n + i;
    return lerp(lerp(g[k], g[k + 1], s), lerp(g[k + n], g[k + n + 1], s), t);
  }
  // distance outside the flat's padded shape, 0 inside; exact near the padded edge
  function flatOut(f, x, z) {
    if (f.type === 'circle') return Math.max(0, Math.hypot(x - f.x, z - f.z) - f.R);
    const e = -f.pad - flatSd(f, x, z);
    if (e < -f.tol) return 0;
    if (e > f.tol) return e;
    return Math.max(0, -f.pad - ringsSignedDist(x, z, f.rings));
  }
  const near = (f, x, z, g = 0) => x >= f.x0 - g && x <= f.x1 + g && z >= f.z0 - g && z <= f.z1 + g;

  // 1 inside a padded flat, easing to 0 over FLAT_BLEND outside it
  function flatMask(x, z) {
    let m = 0;
    for (const f of flats) {
      if (!near(f, x, z)) continue;
      m = Math.max(m, 1 - smooth(0, FLAT_BLEND, flatOut(f, x, z)));
    }
    return m;
  }
  // the flat whose padded shape holds (x, z), or null
  function flatAt(x, z) {
    for (const f of flats) if (near(f, x, z) && flatOut(f, x, z) <= 0) return f;
    return null;
  }

  // ---- coast: push the radii out wherever a flat comes too close ----
  {
    const raise = new Float64Array(segs);
    const need = (x, z, extra) => {
      const dx = x - cx, dz = z - cz, th = Math.atan2(dz, dx);
      const deficit = Math.hypot(dx, dz) + extra + COAST_CLEAR - coastR(th);
      if (deficit <= 0) return;
      const a = ((((th % TAU) + TAU) % TAU) / TAU) * segs;
      const i = Math.min(segs - 1, Math.floor(a));
      const j = (i + 1) % segs;
      raise[i] = Math.max(raise[i], deficit + 0.02);
      raise[j] = Math.max(raise[j], deficit + 0.02);
    };
    for (const f of flats) {
      if (f.type === 'circle') {
        for (let k = 0; k < 48; k++) {
          const a = (k / 48) * TAU;
          need(f.x + Math.cos(a) * f.R, f.z + Math.sin(a) * f.R, 0);
        }
        continue;
      }
      for (const [p, q] of f.rings[0].map((p, k, r) => [p, r[(k + 1) % r.length]])) {
        const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.15));
        for (let k = 0; k < n; k++) need(lerp(p[0], q[0], k / n), lerp(p[1], q[1], k / n), f.pad);
      }
    }
    for (let i = 0; i < segs; i++) radii[i] += raise[i];
    if (closed) radii[segs] = radii[0];
  }
  let maxCoast = 0, minCoast = Infinity;
  for (let i = 0; i < 720; i++) {
    const r = coastR((i / 720) * TAU);
    maxCoast = Math.max(maxCoast, r);
    minCoast = Math.min(minCoast, r);
  }
  minCoast -= 0.05; // the wobble between samples
  const radius = Math.max(plan.radius || 0, ...radii);

  // ---- paths: an apron of trodden earth around every flat, plus any optional plan.paths polylines ----
  const paths = (plan.paths || []).map((p) => (Array.isArray(p) ? p : p.points || [])).filter((p) => p.length >= 2);
  function segDist(x, z, a, b) {
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const t = clamp01(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1));
    return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
  }
  function pathMask(x, z) {
    let m = 0;
    for (const p of paths) for (let i = 1; i < p.length; i++) m = Math.max(m, smooth(0.3, 0.18, segDist(x, z, p[i - 1], p[i])));
    for (const f of flats) {
      if (f.source?.quiet || !near(f, x, z)) continue; // quiet flats (empty upgrade pads) stay plain grass
      // the pad ring (between the shape and its pad) and a little beyond it reads as a path
      const inner = -flatSd(f, x, z);
      if (inner <= 0) continue;
      const outer = inner - f.pad;
      m = Math.max(m, 0.75 * smooth(0, 0.08, inner) * smooth(0.22, 0.02, outer));
    }
    return m;
  }

  // ---- the height ----
  function heightAt(x, z) {
    // flats first: inside a padded flat the ground is exactly its level
    let m = 0, wsum = 0, wh = 0;
    for (const f of flats) {
      if (!near(f, x, z)) continue;
      const d = flatOut(f, x, z);
      if (d <= 0) return f.y;
      if (d < FLAT_BLEND) {
        const w = 1 - smooth(0, FLAT_BLEND, d);
        if (w > m) m = w;
        wsum += w;
        wh += w * f.y;
      }
    }
    let h = terraceSurface(x, z);
    if (feats.length) h += slabRel(featureSum(x, z));
    // gentle grass undulation, not on flats or the crag
    h += (fbm(x * 0.28 + 10 + so, z * 0.28 + 4) - 0.5) * 0.08 * (1 - m) * (feats.length ? 1 - cragMask(x, z) : 1);
    // ponds: a smooth sunken bowl
    for (const p of ponds) {
      if (Math.abs(x - p.cx) > p.reach || Math.abs(z - p.cz) > p.reach) continue;
      h -= p.depth * smooth(1 + p.ew, 1 - p.ew, featD(p, x, z).d);
    }
    // the coast: sink to the beach shelf and then the sea floor, in rounded steps like the prototype
    const dx = x - cx, dz = z - cz, r = Math.hypot(dx, dz);
    if (r > minCoast - 1.1) {
      const R = coastR(Math.atan2(dz, dx));
      const c = smooth(R - 1.05, R + 0.05, r);
      if (c > 0) {
        const target = r > R ? lerp(BEACH, SEABED, smooth(R, R + 1.4, r)) : BEACH;
        h += slabRel(lerp(h, target, r > R ? 1 : c) - h);
      }
    }
    if (m > 0) h = lerp(h, wh / wsum, m);
    return h;
  }

  // where the ground meets the sea, by angle (distance from the coast centre)
  function shoreR(th) {
    const R = coastR(th), ct = Math.cos(th), st = Math.sin(th);
    let r = R - 2.2;
    for (; r < R + 0.6; r += 0.03) if (heightAt(cx + ct * r, cz + st * r) < SEA_LEVEL) break;
    return r;
  }

  // free grass: inside the coast, above the beach, off flats, paths, ponds and steep slopes
  // opts.strict: also keep off quiet flats (empty upgrade pads), e.g. when placing something new
  function isFree(x, z, pad = 0, opts = {}) {
    const dx = x - cx, dz = z - cz;
    if (Math.hypot(dx, dz) > coastR(Math.atan2(dz, dx)) - 0.55 - pad) return false;
    const h = heightAt(x, z);
    if (h < 0.3) return false;
    for (const f of flats) {
      if (f.source?.quiet && !opts.strict) continue; // grass may grow on an empty upgrade pad
      if (!near(f, x, z, pad)) continue;
      if (flatOut(f, x, z) < 0.12 + pad) return false;
    }
    if (pathMask(x, z) > 0.3) return false;
    if (ponds.length && pondMask(x, z) > 0.02) return false;
    const s = Math.hypot(heightAt(x + 0.08, z) - h, heightAt(x, z + 0.08) - h) / 0.08;
    if (s > 1.4) return false;
    return true;
  }

  Object.assign(heightAt, {
    center: [cx, cz], radius, maxCoast, radii, seed: sd, noiseOffset: so,
    coastR, shoreR, flatMask, flatAt, pathMask, pondMask, cragMask, isFree, terraceSurface, levelHeight,
    flats, terraces, features: feats, ponds,
    pondLevel: (p) => shelfAt(p.cx, p.cz) - 0.1,
    cragSteep, featD, vnoise, fbm,
  });
  return heightAt;
}

// ---------------------------------------------------------------------------------------------
// Ground colour (the prototype's groundColor, with ponds added)
// ---------------------------------------------------------------------------------------------

const col = (hex) => new THREE.Color(hex);
const [TG0, TG1, TG2, TG3] = ISLAND_COLORS.grassTerrain;
const GR = {
  a: col(TG0), b: col(TG1), c: col(TG2), y: col(TG3), slope: col(ISLAND_COLORS.grassSlope),
  path1: col(ISLAND_COLORS.path[1]), path2: col(ISLAND_COLORS.path[2]),
  sand: col(ISLAND_COLORS.sand), wet: col(0xcfc2a2), deep: col(0xa9a3cf),
  earth: col(ISLAND_COLORS.earth[0]), earth2: col(ISLAND_COLORS.earth[1]),
  pond: col(0xb3aee6),
};
const _e = new THREE.Color();
const _p = new THREE.Color();

function groundColor(field, x, z, h, out) {
  const { vnoise: vn, fbm: fb, noiseOffset: so } = field;
  const n1 = fb(x * 0.5 + so, z * 0.5), n2 = vn(x * 1.7 + 3, z * 1.7 + 8 + so);
  out.copy(GR.a).lerp(GR.b, n1);
  out.lerp(GR.c, smooth(0.6, 0.8, n2) * 0.7);
  out.lerp(GR.y, smooth(0.7, 0.9, vn(x * 0.8 + 20, z * 0.8 + so)) * 0.35 + smooth(1.2, 2.4, h) * 0.2);
  const s = Math.hypot(field(x + 0.08, z) - h, field(x, z + 0.08) - h) / 0.08;
  out.lerp(GR.slope, smooth(0.3, 1.3, s) * 0.35);
  _e.copy(GR.earth).lerp(GR.earth2, smooth(0.4, 0.6, vn(x * 2 + h * 3, z * 2)));
  out.lerp(_e, smooth(1.2, 2.4, s) * 0.9);
  const pm = field.pathMask(x, z);
  if (pm > 0) {
    _p.copy(GR.path1).lerp(GR.path2, n2);
    out.lerp(_p, pm);
  }
  if (field.ponds.length) {
    const q = field.pondMask(x, z);
    if (q > 0) {
      out.lerp(GR.sand, smooth(0, 0.25, q) * 0.85);
      out.lerp(GR.wet, smooth(0.25, 0.5, q));
      out.lerp(GR.pond, smooth(0.5, 0.9, q));
    }
  }
  out.lerp(GR.sand, smooth(0.32, 0.08, h));
  out.lerp(GR.wet, smooth(0.02, -0.1, h));
  out.lerp(GR.deep, smooth(-0.35, -1.2, h));
  return out;
}

// ---------------------------------------------------------------------------------------------
// The meshes
// ---------------------------------------------------------------------------------------------

// A rough stone block for the crag face (the prototype's stoneBlock).
function stoneBlock(r, w, h, d) {
  const g = jitter(new THREE.BoxGeometry(w, h, d, 2, 2, 2), [0.07, 0.05, 0.07]);
  return mesh(g, mat(r.pick(ISLAND_COLORS.stone)));
}

// Builds the island's ground, sea, foam, crag stone faces, ponds, shore rocks and grass / flowers.
// Returns { group, heightAt, levelHeight, seaLevel, update(timeSeconds), field }.
// group is in plan units (no transform); update(t) animates the foam and the wave line.
export function buildIslandTerrain(plan, { seed } = {}) {
  const heightAt = makeHeightField(plan, { seed });
  const field = heightAt;
  const [cx, cz] = field.center;
  const sd = field.seed;
  const rand = rng(sd * 7919 + 3);
  const R = rand.range;
  const pick = rand.pick;
  const group = new THREE.Group();
  group.name = 'Island terrain';
  const maxCoast = field.maxCoast;
  const k = Math.max(1, maxCoast / 7);

  // ---------- ground: a polar ring mesh that runs from the centre out under the shallows ----------
  {
    const thetaSegs = Math.max(360, Math.min(1100, Math.ceil((TAU * maxCoast) / GROUND_RES)));
    const radialSegs = Math.max(150, Math.min(340, Math.ceil((1.5 * maxCoast) / 0.1)));
    const ring = new THREE.RingGeometry(0.0001, 1, thetaSegs, radialSegs);
    const p = ring.attributes.position;
    const cols = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), u = Math.hypot(px, py), th = Math.atan2(-py, px);
      const r = Math.pow(u, 1.15) * field.coastR(th) * 1.3;
      const x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r, h = heightAt(x, z);
      p.setXYZ(i, x, h, z);
      groundColor(field, x, z, h, c);
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    ring.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    ring.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, side: THREE.DoubleSide });
    groundMat.userData.season = 'grass'; // the seasons tint its greens and lay snow on it (src/island/seasons.js)
    const ground = mesh(ring, groundMat, false, true);
    ground.name = 'Ground';
    group.add(ground);
  }

  // ---------- sea: a big lavender disc, shallow near the shore and deeper further out ----------
  {
    const g = new THREE.RingGeometry(0.0001, 1, 180, 48);
    const p = g.attributes.position;
    const cs = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const shallow = col(0xd3cff8), mid = col(0xaaa4ea), deep = col(0x8f88dc), far = col(0xcfcbe8), glint = col(0xe2dffb);
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), u = Math.hypot(px, py), th = Math.atan2(-py, px);
      const r = Math.pow(u, 2.2) * 70 * k;
      p.setXYZ(i, cx + Math.cos(th) * r, SEA_LEVEL, cz + Math.sin(th) * r);
      const dd = r - field.coastR(th);
      c.copy(shallow).lerp(mid, smooth(-0.6, 1.2, dd)).lerp(deep, smooth(1.2, 5, dd)).lerp(far, smooth(14 * k, 40 * k, dd));
      c.lerp(glint, smooth(0.82, 0.95, field.vnoise(Math.cos(th) * 6 + r * 0.4, Math.sin(th) * 6)) * 0.25 * smooth(8, 1, dd));
      cs[i * 3] = c.r;
      cs[i * 3 + 1] = c.g;
      cs[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cs, 3));
    g.computeVertexNormals();
    const sea = mesh(g, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.18, metalness: 0.08, transparent: true, opacity: 0.86, side: THREE.DoubleSide,
    }), false, true);
    sea.name = 'Sea';
    group.add(sea);
  }

  // ---------- foam along the shore and two softer wave lines further out ----------
  const foams = [];
  {
    const N = Math.round(240 * Math.sqrt(k));
    const shore = [];
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      shore.push([th, field.shoreR(th)]);
    }
    const band = (off, w, y, opacity) => {
      const pos = [];
      for (let i = 0; i < N; i++) {
        const [a0, r0] = shore[i], [a1, r1] = shore[i + 1];
        const q = (a, r) => [Math.cos(a) * r, 0, Math.sin(a) * r];
        const A = q(a0, r0 + off - w), B = q(a0, r0 + off + w), C = q(a1, r1 + off - w), D = q(a1, r1 + off + w);
        pos.push(...A, ...B, ...C, ...C, ...B, ...D);
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      bg.computeVertexNormals();
      const m = new THREE.MeshBasicMaterial({ color: ISLAND_COLORS.foam, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
      const me = new THREE.Mesh(bg, m);
      me.name = 'Foam';
      me.position.set(cx, y, cz); // built around the centre so the wave can swell outward
      me.renderOrder = 1;
      me.userData.baseOpacity = opacity;
      group.add(me);
      foams.push(me);
      return me;
    };
    band(0.04, 0.07, SEA_LEVEL + 0.012, 0.85);
    band(0.42, 0.05, SEA_LEVEL + 0.01, 0.35);
    band(0.95, 0.035, SEA_LEVEL + 0.008, 0.18);
  }

  // ---------- ponds: a disc of water in each bowl ----------
  for (const [pi, p] of field.ponds.entries()) {
    const y = field.pondLevel(p);
    const g = new THREE.CircleGeometry(1, 40);
    g.rotateX(-Math.PI / 2);
    const water = mesh(g, new THREE.MeshStandardMaterial({
      color: ISLAND_COLORS.water[0], roughness: 0.15, metalness: 0.08, transparent: true, opacity: 0.88,
    }), false, true);
    water.name = 'Pond';
    water.position.set(p.cx, y, p.cz);
    water.rotation.y = p.rot;
    water.scale.set(p.rx * (1 + p.ew * 0.55), 1, p.rz * (1 + p.ew * 0.55));
    group.add(water);
    // a few pebbles on the rim
    for (let i = 0; i < 6; i++) {
      const a = rand() * TAU;
      const x = p.cx + Math.cos(a) * p.r * 1.12, z = p.cz + Math.sin(a) * p.r * 1.12;
      if (field.flatMask(x, z) > 0) continue;
      const rock = makeRock(sd * 31 + pi * 7 + i, R(0.07, 0.13));
      rock.position.set(x, heightAt(x, z), z);
      group.add(rock);
    }
  }

  // ---------- crags: the sheer stone face, block by block, fading into the slope at both ends ----------
  for (const [fi, f] of field.features.entries()) {
    if (f.type !== 'crag') continue;
    const wall = new THREE.Group();
    wall.name = 'Stone cliff';
    group.add(wall);
    const fr = rng(sd * 977 + fi * 13 + 5);
    const span = 75;
    for (let a = -span; a <= span; a += fr.range(3.6, 4.6)) {
      const phi = f.face + a * D2R, st = field.cragSteep(f, phi), nx = Math.cos(phi), nz = Math.sin(phi);
      let px = f.cx, pz = f.cz;
      for (let t = 0.2; t < 4 * Math.max(f.rx, f.rz); t += 0.02) {
        px = f.cx + nx * t;
        pz = f.cz + nz * t;
        if (field.featD(f, px, pz).d >= 1) break;
      }
      if (Math.hypot(px - cx, pz - cz) > field.coastR(Math.atan2(pz - cz, px - cx)) - 0.5) continue;
      if (field.flatMask(px, pz) > 0.5) continue;
      const top = heightAt(px - nx * 0.32, pz - nz * 0.32) - 0.03, low = heightAt(px + nx * 0.55, pz + nz * 0.55) - 0.2;
      if (st < 0.08) {
        if (fr() < 0.55) {
          const rock = makeRock(sd + fi * 100 + Math.round(a), fr.range(0.12, 0.22));
          rock.position.set(px + nx * 0.1, heightAt(px + nx * 0.1, pz + nz * 0.1), pz + nz * 0.1);
          wall.add(rock);
        }
        continue;
      }
      const inset = (1 - st) * 0.42, bx = px - nx * inset, bz = pz - nz * inset;
      let y = low;
      const w = fr.range(0.42, 0.58) * (0.65 + 0.35 * st);
      while (y < top - 0.04) {
        const h = Math.min(top - y, fr.range(0.38, 0.7));
        const b = stoneBlock(fr, w, h + 0.06, 0.56);
        b.position.set(bx + fr.range(-0.03, 0.03), y + h / 2, bz + fr.range(-0.03, 0.03));
        b.rotation.y = -phi + Math.PI / 2 + fr.range(-0.07, 0.07);
        wall.add(b);
        y += h;
      }
      if (st < 0.75 && fr() < 0.6) {
        const x = px + nx * 0.42, z = pz + nz * 0.42;
        const rock = makeRock(sd + fi * 100 + Math.round(a) + 50, fr.range(0.1, 0.2));
        rock.position.set(x, heightAt(x, z), z);
        wall.add(rock);
      }
    }
  }

  // ---------- rocks on the shore, some in the shallows ----------
  {
    const rocks = new THREE.Group();
    rocks.name = 'Shore rocks';
    group.add(rocks);
    const n = Math.round(22 * k);
    for (let i = 0; i < n; i++) {
      const th = rand() * TAU, r = field.shoreR(th) + R(-0.25, 0.35);
      const x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r;
      if (field.flatMask(x, z) > 0) continue;
      const rock = makeRock(sd * 53 + i, R(0.1, 0.26));
      rock.position.set(x, heightAt(x, z), z);
      rocks.add(rock);
    }
    mergeStatic(rocks); // a few draw calls for all of them
  }

  // ---------- scatter: grass tufts and flower clusters on free grass ----------
  {
    const area = k * k;
    const tufts = [], tuftCols = [], flowers = [], flowerCols = [], stems = [], bells = [], bellCols = [];
    const reach = maxCoast;
    let guard = 0;
    const target = Math.round(900 * area);
    while (tufts.length < target && guard++ < 20000 * area) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * reach, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const dens = field.vnoise(x * 0.9 + 40, z * 0.9 + 12);
      if (rand() > dens * 1.4) continue;
      if (!field.isFree(x, z, 0.04)) continue;
      const y = heightAt(x, z);
      for (let i = 0; i < 3; i++) {
        tufts.push(matrix(x + R(-0.07, 0.07), y + 0.08, z + R(-0.07, 0.07), R(-0.35, 0.35), rand() * 3, R(-0.35, 0.35), R(0.7, 1.3)));
        tuftCols.push(pick([0x95b04a, 0xa6bd55, 0x86a33f, 0xb5c763, 0x9cb84e]));
      }
    }
    const clusters = Math.round(26 * area);
    for (let ci = 0; ci < clusters; ci++) {
      let fx, fz, ok = false;
      for (let tries = 0; tries < 50 && !ok; tries++) {
        const a = rand() * TAU, r = Math.sqrt(rand()) * reach * 0.95;
        fx = cx + Math.cos(a) * r;
        fz = cz + Math.sin(a) * r;
        ok = field.isFree(fx, fz, 0.2);
      }
      if (!ok) continue;
      const kind = pick(['bell', 'bell', 'daisy', 'yellow', 'pink']);
      const n = 6 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) {
        const x = fx + R(-0.35, 0.35), z = fz + R(-0.35, 0.35);
        if (!field.isFree(x, z, 0.02)) continue;
        const y = heightAt(x, z);
        if (kind === 'bell') {
          const h = R(0.18, 0.3);
          stems.push(matrix(x, y + h / 2, z, R(-0.15, 0.15), 0, R(-0.15, 0.15), 1, h / 0.25, 1));
          bells.push(matrix(x, y + h + 0.02, z, Math.PI + R(-0.3, 0.3), 0, R(-0.3, 0.3)));
          bellCols.push(pick([0x8b82d8, 0x9f8fe0, 0x7f86d6, 0xb19be4]));
        } else {
          flowers.push(matrix(x, y + 0.07, z, 0, rand() * 3, 0, R(0.8, 1.3), 0.6, R(0.8, 1.3)));
          flowerCols.push(kind === 'daisy' ? 0xfbf8f0 : kind === 'yellow' ? pick([0xf6dc6e, 0xf2d250]) : pick([0xf3b6c8, 0xf0a9bf]));
        }
      }
    }
    const scatter = new THREE.Group();
    scatter.name = 'Grass and flowers';
    group.add(scatter);
    if (tufts.length) {
      const tuftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 });
      tuftMat.userData.season = 'tuft'; // dries in fall, frosts over in winter (src/island/seasons.js)
      const im = instanced(new THREE.ConeGeometry(0.045, 0.26, 4), tuftMat, tufts, tuftCols);
      im.name = 'Grass tufts';
      scatter.add(im);
    }
    // wildflowers fade in fall and are under the snow in winter (src/island/seasons.js)
    const flowerMat = (o) => { const m = new THREE.MeshStandardMaterial(o); m.userData.season = 'flower'; return m; };
    if (flowers.length) scatter.add(instanced(new THREE.IcosahedronGeometry(0.05, 0), flowerMat({ color: 0xffffff, flatShading: true, roughness: 0.7 }), flowers, flowerCols));
    if (stems.length) scatter.add(instanced(new THREE.CylinderGeometry(0.008, 0.01, 0.25, 4), flowerMat({ color: 0x6f9a3a }), stems));
    if (bells.length) scatter.add(instanced(new THREE.ConeGeometry(0.045, 0.08, 6, 1, true), flowerMat({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.6 }), bells, bellCols));
  }

  // ---------- animation: the shore foam shimmers, the outer wave lines breathe in and out ----------
  // Only material opacity and mesh scale change: no geometry is touched per frame.
  function update(t) {
    const [shoreFoam, wave, swell] = foams;
    shoreFoam.material.opacity = shoreFoam.userData.baseOpacity * (0.88 + 0.12 * Math.sin(t * 1.3));
    const s = 0.5 + 0.5 * Math.sin(t * 0.9);
    wave.material.opacity = 0.15 + 0.3 * s;
    wave.scale.setScalar(1 + 0.012 * s);
    const s2 = 0.5 + 0.5 * Math.sin(t * 0.9 - 1.6);
    swell.material.opacity = 0.05 + 0.17 * s2;
    swell.scale.setScalar(1 + 0.018 * s2);
  }
  update(0);

  return { group, heightAt, levelHeight, seaLevel: SEA_LEVEL, update, field };
}
