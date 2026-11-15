// Where a field's soil jar stands on the island: a glass jar of the field's own soil, on the grass
// just outside the field's gate (src/island/jarProps.js draws it, the jar test in
// src/plan/jarTest.js fills it). It stands beside a gate post, never in the gateway, and keeps clear
// of everything else on the island: the fences, the props by their real boxes, the windmill's
// sails, the lamps, the upgrade pads, the barnyard decorations, a festival's things, the sheep, the
// grass tufts (the glass is see-through, so a tuft inside would show) and the other jars. The
// ground under it must be level (not a riser between two field levels), off the beach, the pond,
// the crag and the middle of a path. When nowhere near the field is clear, there is no jar (null).
//
// Plain maths on island units (x east, z south, y up); no three.js and no DOM, so node:test can
// import it. Boxes are duck-typed { min: {x, y, z}, max: {x, y, z} } (a THREE.Box3 will do).
//
//   jarCandidates(jf)            -> [{ x, z, by }] the spots to try, best first
//   jarBlocked(x, z, env, self)  -> null, or why a spot won't do ('coast', 'ground', ... 'jar')
//   jarSpot(jf, env, self)       -> { x, z, ground, box, by } | null, the first clear spot
//   jarBox(x, z, ground)         -> the box the jar fills, lid and all
//   rayHitsBall(origin, dir, ball) -> how far along the ray it meets the ball, or null
//
// A jar field (jf), in island space:
//   { id, ring: [[x, z], ...], gate: { x, z, nx, nz } | null, pivot: boolean, toward: [x, z] }
// where (nx, nz) is the gate's outward direction (src/island/paddocks.js) and toward is where the
// gate faces (the farmyard), for a field with no gate.
import { columnBlocked } from './stackSpots.js';
import { distanceToEdges, pointInPolygons } from './picking.js';

/** The jar's size: radius, glass height, lid radius and height, and how tall it stands in all. */
export const JAR = { R: 0.085, H: 0.30, LID_R: 0.095, LID_H: 0.035, TOP: 0.34, SHADOW_R: 0.136 }; // (SHADOW_R: its soft shadow on the grass)
export const FENCE_CLEAR = 0.14; // its side keeps this far from any field's edge (fence posts, festival lights)
export const GATE_SIDE = 0.56; // along the fence from the gate's middle: past the gate post (0.32) and the swung bar
export const GATE_OUT = 0.30; // and this far out from the fence
export const OB_PAD = 0.06; // a jar keeps this much further off another thing's spot than its glass
// The jar's own spot on view.obstacles, sized for the sheep's reach: a sheep stops with its middle
// o.r + 0.22 (src/island/wander.js) from the jar, and Manami's face reaches about 0.34 ahead of her
// middle, a little more as she grazes, so: lid 0.095 + 0.34 + 0.05 - 0.22, and a hair.
export const JAR_OB_R = 0.27;
export const PICK_R = 0.24; // a generous ball round the jar for a finger to tap

const LEVEL = 0.05; // the ground under it may differ by this much at most
const SIDE = [0.80, 1.05, 1.30]; // the fan of spots along the fence, either side of the gate
const OUT = [0.30, 0.45, 0.60];
const AHEAD = 0.62; // straight out from the gateway: the way in, so tried last
const RIM = 8;

/** The box the jar fills at (x, z) on ground at `ground`: its side and lid, with a hair of air. */
export function jarBox(x, z, ground) {
  const h = JAR.R + 0.01;
  return {
    min: { x: x - h, y: ground, z: z - h },
    max: { x: x + h, y: ground + JAR.TOP + 0.02, z: z + h },
  };
}

const inRing = (x, z, ring) => pointInPolygons(x, z, [[ring]]);

/**
 * The point on a ring nearest `toward`, with the ring's outward direction there: a gate of sorts
 * for a field that has none (a centre pivot's circle has no fence or gate).
 */
function nearestEdge(ring, toward) {
  if (!ring || ring.length < 3) return null;
  const [tx, tz] = toward || [0, 0];
  let best = null;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
    if (l2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((tx - ax) * vx + (tz - az) * vz) / l2));
    const x = ax + vx * t, z = az + vz * t, d = Math.hypot(tx - x, tz - z);
    if (!best || d < best.d) best = { x, z, d, vx, vz };
  }
  if (!best) return null;
  const l = Math.hypot(best.vx, best.vz);
  let nx = best.vz / l, nz = -best.vx / l;
  // outward: away from the inside of the ring (whichever way round it runs)
  if (inRing(best.x + nx * 0.02, best.z + nz * 0.02, ring)) { nx = -nx; nz = -nz; }
  return { x: best.x, z: best.z, nx, nz };
}

/**
 * The spots to try for a field's jar, best first. By a gate: beside either gate post, then a fan
 * further along and out from the fence, then straight out from the gateway. A centre pivot or a
 * field with no gate does the same from the edge nearest `toward` (by: 'beside'). Last, rings round
 * that point from 0.6 to 2.0 out, the side facing the camera (+z) first.
 * @returns {{x: number, z: number, by: 'gate'|'beside'}[]}
 */
export function jarCandidates(jf) {
  const useGate = jf?.gate && !jf.pivot && [jf.gate.x, jf.gate.z, jf.gate.nx, jf.gate.nz].every(Number.isFinite);
  const g = useGate ? jf.gate : nearestEdge(jf?.ring, jf?.toward);
  if (!g) return [];
  const by = useGate ? 'gate' : 'beside';
  const nl = Math.hypot(g.nx, g.nz) || 1;
  const nx = g.nx / nl, nz = g.nz / nl;
  const ux = -nz, uz = nx; // along the fence
  const at = (t, d) => ({ x: g.x + ux * t + nx * d, z: g.z + uz * t + nz * d, by });
  const out = [at(GATE_SIDE, GATE_OUT), at(-GATE_SIDE, GATE_OUT)];
  for (const d of OUT) for (const t of SIDE) out.push(at(t, d), at(-t, d));
  out.push(at(0, AHEAD));
  const rings = [];
  for (let k = 0; k <= 7; k++) {
    const d = 0.6 + k * 0.2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
      rings.push({ x, z, by, score: d - 0.2 * (z - g.z) });
    }
  }
  rings.sort((a, b) => a.score - b.score);
  for (const { x, z } of rings) out.push({ x, z, by });
  // still nothing (a festival can fill the grass by the gate): a little further out, then all the
  // way round the outside of the field's fence, nearest the gate first. Every spot still goes
  // through the same checks, so the jar only moves to grass that is clear.
  const far = [];
  for (let k = 8; k <= 12; k++) {
    const d = 0.6 + k * 0.2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      far.push({ x: g.x + Math.cos(a) * d, z: g.z + Math.sin(a) * d, score: d });
    }
  }
  const ring = jf?.ring;
  if (Array.isArray(ring) && ring.length > 2) {
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (!(len > 1e-6)) continue;
      const ex = -(z1 - z0) / len, ez = (x1 - x0) / len; // one side of the edge (the other is tried too)
      for (let s = 0.2; s < len; s += 0.4) {
        const px = x0 + ((x1 - x0) * s) / len, pz = z0 + ((z1 - z0) * s) / len;
        for (const d of [0.3, 0.55]) {
          for (const side of [1, -1]) {
            const x = px + ex * d * side, z = pz + ez * d * side;
            far.push({ x, z, score: 3 + Math.hypot(x - g.x, z - g.z) });
          }
        }
      }
    }
  }
  far.sort((a, b) => a.score - b.score);
  for (const { x, z } of far) out.push({ x, z, by: 'beside' });
  return out;
}

const atOf = (o) => (Array.isArray(o.at) ? o.at : o.at && Number.isFinite(o.at.x) ? [o.at.x, o.at.z] : [o.x, o.z]);
const polygonsOf = (f) => (f.polygons?.length ? f.polygons : f.rings?.length ? f.rings.map((r) => [r]) : f.ring ? [[f.ring]] : []);

/** The ground under a jar at (x, z): the lowest of its middle and 8 points round its rim, and how uneven. */
function groundAt(x, z, heightAt) {
  if (typeof heightAt !== 'function') return { ground: 0, lo: 0, hi: 0, rim: [[x, z]] };
  const r = JAR.R + 0.02;
  const rim = [[x, z]];
  for (let k = 0; k < RIM; k++) {
    const a = (k / RIM) * Math.PI * 2;
    rim.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
  }
  let lo = Infinity, hi = -Infinity;
  for (const [px, pz] of rim) {
    const h = heightAt(px, pz);
    if (!Number.isFinite(h)) return { ground: NaN, lo: NaN, hi: NaN, rim };
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return { ground: lo, lo, hi, rim };
}

/**
 * Why a jar can't stand at (x, z), or null when it can. Checked in this order (the flat checks
 * first: the ground's height is the dear one to work out):
 *   coast     too near the shore, or down on the beach (under env.minHeight)
 *   field     in a field, or too near its fence
 *   obstacle  on a building's, a decoration's or a festival's spot (view.obstacles)
 *   slot      on an upgrade pad, built on or not
 *   ground    not level (a riser between field levels), or on the crag
 *   pond      in or at the edge of a pond
 *   path      in the middle of a trodden path
 *   prop      in a prop's real box, the windmill's sails, a lamp post, or a festival's things
 *   sheep     where a sheep is standing
 *   tuft      on a grass tuft or a flower
 *   jar       too near another field's jar
 * self: { fieldId, obstacle } for a jar that's being moved: its own obstacle and spot don't count.
 * @param {number} x
 * @param {number} z
 * @param {object} env   see jarEnv in src/island/jarProps.js
 * @param {{fieldId?: string, obstacle?: object}|null} [self]
 * @returns {null|'coast'|'ground'|'pond'|'path'|'field'|'obstacle'|'slot'|'prop'|'sheep'|'tuft'|'jar'}
 */
export function jarBlocked(x, z, env = {}, self = null) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 'coast';
  const { R } = JAR;
  const { heightAt, coastR, coastCentre, minHeight = -Infinity, pondMask, pathMask, cragMask } = env;
  if (typeof coastR === 'function') {
    const cx = coastCentre?.x ?? 0, cz = coastCentre?.z ?? 0;
    if (Math.hypot(x - cx, z - cz) > coastR(Math.atan2(z - cz, x - cx)) - 0.55 - R) return 'coast';
  }
  for (const f of env.fields || []) {
    const polys = polygonsOf(f);
    if (!polys.length) continue;
    if (pointInPolygons(x, z, polys) || distanceToEdges(x, z, polys) < R + FENCE_CLEAR) return 'field';
  }
  const own = self?.obstacle || null;
  for (const o of env.obstacles || []) {
    if (o === own) continue;
    if (Math.hypot(o.x - x, o.z - z) < o.r + R + OB_PAD) return 'obstacle';
  }
  for (const sl of env.slots || []) {
    const [sx, sz] = atOf(sl);
    if (Math.hypot(sx - x, sz - z) < sl.r + R + 0.1) return 'slot';
  }
  const g = groundAt(x, z, heightAt);
  if (!Number.isFinite(g.ground)) return 'ground';
  if (g.ground < minHeight) return 'coast';
  if (g.hi - g.lo > LEVEL) return 'ground';
  if (typeof cragMask === 'function' && g.rim.some(([px, pz]) => cragMask(px, pz) > 0.05)) return 'ground';
  if (typeof pondMask === 'function') {
    const r = R + 0.15;
    if (pondMask(x, z) > 0.02) return 'pond';
    for (let k = 0; k < RIM; k++) {
      const a = (k / RIM) * Math.PI * 2;
      if (pondMask(x + Math.cos(a) * r, z + Math.sin(a) * r) > 0.02) return 'pond';
    }
  }
  if (typeof pathMask === 'function' && pathMask(x, z) > 0.55) return 'path';
  const box = jarBox(x, z, g.ground);
  if (columnBlocked(box, { props: env.props || [], sails: env.sails || [], lamps: env.lamps || [], keepOuts: env.keepOuts || [], heightAt })) return 'prop';
  for (const s of env.sheep || []) {
    if (Math.hypot(s.x - x, s.z - z) < R + 0.25 + (s.size ?? 0.6) * 0.6) return 'sheep';
  }
  for (const t of env.tufts || []) {
    const reach = (t.r ?? 0.06) + R + 0.02;
    if (Math.abs(t.x - x) < reach && Math.abs(t.z - z) < reach && Math.hypot(t.x - x, t.z - z) < reach) return 'tuft';
  }
  for (const j of env.jars || []) {
    if (self?.fieldId != null && j.fieldId === self.fieldId) continue;
    if (Math.hypot(j.x - x, j.z - z) < 2 * R + 0.15) return 'jar';
  }
  return null;
}

/**
 * Where this field's jar stands: the first candidate (jarCandidates) that nothing blocks and that
 * is nearer this field than any other (so it reads as this field's jar). It's the same spot every
 * time for the same island. null when none is clear.
 *
 * stay: the spot a jar stands on now. Reaching it in the list, it is kept if it's still clear
 * leaving out the sheep (they walk round a jar that's there, so one grazing near it is no reason
 * to move). A better spot that has come clear still wins, so a jar pushed aside by a festival
 * goes back once the festival is over.
 * @returns {{x: number, z: number, ground: number, box: object, by: 'gate'|'beside'} | null}
 */
export function jarSpot(jf, env = {}, self = null, { stay = null } = {}) {
  const cands = jarCandidates(jf);
  if (!cands.length) return null;
  const near = nearOnly(env, cands);
  const calm = stay ? { ...near, sheep: [] } : null;
  const fields = env.fields || [];
  const mine = fields.find((f) => f.id === jf?.id);
  const minePolys = mine ? polygonsOf(mine) : jf?.ring ? [[jf.ring]] : [];
  const others = fields.filter((f) => f !== mine).map(polygonsOf).filter((p) => p.length);
  for (const c of cands) {
    const here = stay && Math.abs(c.x - stay.x) < 1e-9 && Math.abs(c.z - stay.z) < 1e-9;
    if (jarBlocked(c.x, c.z, here ? calm : near, self)) continue;
    // it reads as this field's jar: no other field is nearer
    if (minePolys.length) {
      const own = distanceToEdges(c.x, c.z, minePolys);
      if (others.some((p) => distanceToEdges(c.x, c.z, p) < own)) continue;
    }
    const { ground } = groundAt(c.x, c.z, env.heightAt);
    return { x: c.x, z: c.z, ground, box: jarBox(c.x, c.z, ground), by: c.by };
  }
  return null;
}

// env with only the festival boxes and tufts near these candidates (a festival can fill tens of
// thousands of boxes; a field's candidates all lie within a couple of units of its gate)
function nearOnly(env, cands) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const c of cands) { x0 = Math.min(x0, c.x); z0 = Math.min(z0, c.z); x1 = Math.max(x1, c.x); z1 = Math.max(z1, c.z); }
  const m = JAR.R + 0.3;
  x0 -= m; z0 -= m; x1 += m; z1 += m;
  const out = { ...env };
  if (env.keepOuts?.length) out.keepOuts = env.keepOuts.filter((b) => !(b.max.x < x0 || b.min.x > x1 || b.max.z < z0 || b.min.z > z1));
  if (env.tufts?.length) out.tufts = env.tufts.filter((t) => t.x > x0 && t.x < x1 && t.z > z0 && t.z < z1);
  return out;
}

/**
 * How far along a ray (from origin, the way dir points; dir need not be unit length) it first meets
 * a ball { x, y, z, r }: 0 when it starts inside, null when it misses or the ball is behind it.
 */
export function rayHitsBall(origin, dir, ball) {
  const l = Math.hypot(dir.x, dir.y, dir.z);
  if (!(l > 0) || !ball) return null;
  const dx = dir.x / l, dy = dir.y / l, dz = dir.z / l;
  const ox = origin.x - ball.x, oy = origin.y - ball.y, oz = origin.z - ball.z;
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - ball.r * ball.r;
  if (c <= 0) return 0; // inside
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}
