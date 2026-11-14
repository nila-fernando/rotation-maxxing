// Keeps a scripted camera (the "See them on the farm" tour) out of the windmill, the barn and the
// hills, in plain maths: no three.js and no DOM, so node:test can import it.
//
// The idea is one flat floor a little above the tallest solid thing on the island (the windmill and
// the sweep of its sails, the barn, the silo, the trees, the coin stacks, the highest ground). A
// camera that never tips lower than maxPolar from straight down, and stays at least
// safeMinDistance(target.y) back from what it looks at, is always above that floor:
//
//   camY = ty + d·cos(φ) ≥ ty + d·cos(maxPolar) ≥ ty + (floor − ty) = floor
//
// Why a flight between two safe poses stays safe (so a flight needs no sampling at run time):
// - a flight eases target, distance and polar angle by the same eased k (lerpPose), so the
//   distance d(k) and the look-at height ty(k) are both affine in k;
// - safeMinDistance is affine in ty, so safeMin(ty(k)) is affine in k too, and an affine function
//   that is below d at both ends is below d everywhere in between: d(k) ≥ safeMin(ty(k));
// - the same goes for the plain lower limit baseMin (a constant), and φ(k) is a plain lerp of two
//   angles ≤ maxPolar, so it stays ≤ maxPolar;
// - so every in-between frame has camY ≥ floor, at least `margin` above everything solid.
// Free orbit is kept to the same limits every frame by the rig (cameraRig.js: enforce) and by
// OrbitControls, which clamps the polar angle and the distance on every update.
//
// Poses are spherical, the way OrbitControls measures them:
//   pos = target + d·(sinφ·sinθ, cosφ, sinφ·cosθ)    θ = atan2(dx, dz), φ measured from straight up
//   { target: [x, y, z], dist, polar: φ, azimuth: θ }
//
// "Boxes" below are placed props as the reveal records them (src/screens/reveal.js, measured with
// src/island/clearance.js), or plain boxes { min, max } (arrays or {x, y, z}); "sails" are balls
// { x, y, z, r } round the windmill sails, already padded by whoever made them.

import { pointInPropBox } from './clearance.js';

/** The tour's limits and its one camera angle (spec: the measured overview angle is 0.84). */
export const TOUR = {
  maxPolar: 0.95, // never lower than this from straight down while the tour runs
  polar: 0.84,    // every tour shot looks from this angle
  margin: 0.6,    // the floor sits this far above the tallest solid thing
};

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** An angle folded into (−π, π]. */
export function wrapAngle(a) {
  const t = ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return t === -Math.PI ? Math.PI : t;
}

/** (x, z) pulled back inside a disc round (cx, cz). */
export function clampToDisc(x, z, cx, cz, r) {
  const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
  if (d <= r || d === 0) return [x, z];
  return [cx + (dx / d) * r, cz + (dz / d) * r];
}

const xyz = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);
const xz = (p) => (Array.isArray(p) ? p : [p.x, p.z]);

// ---------------------------------------------------------------------------------------------
// The floor and the distance it asks for

/**
 * The flat floor the tour camera stays above: the highest of `tops` (the solid things: props, sail
 * tops, the highest coin column) and of the ground (heightAt on a grid × grid net inside the coast),
 * plus `margin`.
 * @param {object} o
 * @param {number[]} o.tops
 * @param {(x: number, z: number) => number} [o.heightAt]
 * @param {[number, number]|{x: number, z: number}} [o.center]  the island's middle
 * @param {number} [o.maxCoast]  the island's largest radius
 */
export function floorY({ tops = [], heightAt = null, center = [0, 0], maxCoast = 0, margin = TOUR.margin, grid = 48 }) {
  let top = -Infinity;
  for (const t of tops) if (Number.isFinite(t)) top = Math.max(top, t);
  if (heightAt && maxCoast > 0 && grid > 1) {
    const [cx, cz] = xz(center);
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        const dx = -maxCoast + (2 * maxCoast * i) / (grid - 1), dz = -maxCoast + (2 * maxCoast * j) / (grid - 1);
        if (Math.hypot(dx, dz) > maxCoast) continue;
        const h = heightAt(cx + dx, cz + dz);
        if (Number.isFinite(h)) top = Math.max(top, h);
      }
    }
  }
  return (Number.isFinite(top) ? top : 0) + margin;
}

/** How far back a camera looking at height targetY must stay so that, at maxPolar, it is on the floor. */
export function safeMinDistance(targetY, maxPolar, floor) {
  return (floor - targetY) / Math.cos(maxPolar);
}

/**
 * The floor for the tour, with a guard: if the solid things would push the camera further back than
 * 1.2 × the overview distance at the island's middle (some silly prop), fall back to the props'
 * own tops. Returns { floor, fellBack } (log a warning when it fell back).
 */
export function tourFloor({ tops, propTops = [], heightAt, center, maxCoast, overviewDist, maxPolar = TOUR.maxPolar, margin = TOUR.margin }) {
  const [x, y, z] = xyz(center); // the island's middle, [x, y, z] or a Vector3
  const floor = floorY({ tops, heightAt, center: [x, z], maxCoast, margin });
  if (!(safeMinDistance(y, maxPolar, floor) > 1.2 * overviewDist)) return { floor, fellBack: false };
  return { floor: floorY({ tops: propTops, heightAt, center: [x, z], maxCoast, margin }), fellBack: true };
}

// ---------------------------------------------------------------------------------------------
// Poses

/** A pose kept to the limits: no lower than maxPolar, and no closer than baseMin or the floor allows. */
export function enforce(pose, { maxPolar, floor, baseMin = 0 }) {
  const t = xyz(pose.target);
  return {
    target: [t[0], t[1], t[2]],
    dist: Math.max(pose.dist, baseMin, safeMinDistance(t[1], maxPolar, floor)),
    polar: Math.min(pose.polar, maxPolar),
    azimuth: pose.azimuth,
  };
}

/** Where the camera stands for a pose: [x, y, z]. */
export function poseToPos({ target, dist, polar, azimuth }) {
  const [x, y, z] = xyz(target);
  const s = Math.sin(polar);
  return [x + dist * s * Math.sin(azimuth), y + dist * Math.cos(polar), z + dist * s * Math.cos(azimuth)];
}

/** The pose of a camera standing at pos and looking at target. */
export function poseFrom(target, pos) {
  const t = xyz(target), p = xyz(pos);
  const dx = p[0] - t[0], dy = p[1] - t[1], dz = p[2] - t[2];
  const dist = Math.hypot(dx, dy, dz);
  return { target: [t[0], t[1], t[2]], dist, polar: dist > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, dy / dist))) : 0, azimuth: Math.atan2(dx, dz) };
}

/** The pose k of the way from a to b: target, distance and polar angle in a straight line, θ the short way round. */
export function lerpPose(a, b, k) {
  const ta = xyz(a.target), tb = xyz(b.target);
  return {
    target: [ta[0] + (tb[0] - ta[0]) * k, ta[1] + (tb[1] - ta[1]) * k, ta[2] + (tb[2] - ta[2]) * k],
    dist: a.dist + (b.dist - a.dist) * k,
    polar: a.polar + (b.polar - a.polar) * k,
    azimuth: a.azimuth + wrapAngle(b.azimuth - a.azimuth) * k,
  };
}

/** n + 1 poses along a flight from a to b (both ends included), eased the way the rig eases a shot. */
export function flightSamples(a, b, n = 32) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(lerpPose(a, b, easeInOut(i / n)));
  return out;
}

// ---------------------------------------------------------------------------------------------
// What a point runs into

function inPlainBox([x, y, z], b, pad) {
  const lo = xyz(b.min), hi = xyz(b.max);
  return x >= lo[0] - pad && x <= hi[0] + pad && y >= lo[1] - pad && y <= hi[1] + pad && z >= lo[2] - pad && z <= hi[2] + pad;
}

/**
 * What a point [x, y, z] runs into, or null: 'ground' (closer than `ground` above heightAt), a prop's
 * key (inside its own rotated box padded by `pad`), 'box' (a plain box, padded) or 'sail' (inside a
 * sail ball).
 */
export function pointHits(pt, { boxes = [], sails = [], heightAt = null, pad = 0, ground = TOUR.margin } = {}) {
  const p = xyz(pt);
  if (heightAt && p[1] < heightAt(p[0], p[2]) + ground) return 'ground';
  for (const b of boxes) {
    if (b.min && b.max) { if (inPlainBox(p, b, pad)) return 'box'; }
    else if (pointInPropBox(p, b, pad)) return b.key || 'prop';
  }
  for (const s of sails) if (Math.hypot(p[0] - s.x, p[1] - s.y, p[2] - s.z) < s.r) return 'sail';
  return null;
}

/** Is the camera at this pose clear of everything (props padded by `pad`, the sails, the ground)? */
export function poseIsClear(pose, boxes, sails, heightAt, { pad = 0.3, ground = TOUR.margin } = {}) {
  return !pointHits(poseToPos(pose), { boxes, sails, heightAt, pad, ground });
}

/**
 * The tour's first move rises from wherever the farmer left the camera; it is only flown (rather than
 * jumped) if every one of its eased steps is clear of the props padded by `pad`, the sails and the
 * ground. It looks at n + 1 steps at least, and more on a long flight: never more than half of `pad`
 * between two steps, so the camera can't slip through a prop's padding between two of them.
 */
export function riseIsClear(fromPose, toPose, boxes, sails, heightAt, n = 32, { pad = 0.3, ground = TOUR.margin } = {}) {
  const most = Math.max(0.05, pad / 2);
  let poses = flightSamples(fromPose, toPose, n);
  for (let tries = 0; tries < 6 && longestStep(poses) > most; tries++) poses = flightSamples(fromPose, toPose, poses.length * 2);
  return poses.every((p) => poseIsClear(p, boxes, sails, heightAt, { pad, ground }));
}

/** The longest straight step the camera takes between two of these poses. */
function longestStep(poses) {
  let most = 0, last = poseToPos(poses[0]);
  for (let i = 1; i < poses.length; i++) {
    const at = poseToPos(poses[i]);
    most = Math.max(most, Math.hypot(at[0] - last[0], at[1] - last[1], at[2] - last[2]));
    last = at;
  }
  return most;
}

/** Does the straight line from a to b (both [x, y, z]) pass through a padded prop box or a sail ball? */
export function segmentHits(a, b, { boxes = [], sails = [], pad = 0.15, samples = 24 } = {}) {
  const A = xyz(a), B = xyz(b);
  for (let i = 0; i < samples; i++) {
    const t = samples > 1 ? i / (samples - 1) : 0;
    const p = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    if (pointHits(p, { boxes, sails, pad })) return true;
  }
  return false;
}

const TURNS = [0, 0.26, -0.26, 0.52, -0.52, 0.79, -0.79, 1.05, -1.05];

/**
 * Which way round to look at a field so the barn or the windmill isn't in the way: tries the current
 * θ and up to 1.05 either side (staying within `spread` of the home view), and counts how many of the
 * sight lines (camera to each of `points`) run through a prop box padded by `pad` or a sail ball. The
 * fewest wins; on a tie, the smallest turn.
 */
export function pickAzimuth({ target, dist, polar, current, home = current, points, props = [], sails = [], pad = 0.15, samples = 24, spread = 1.05 }) {
  let cands = TURNS.map((o) => current + o).filter((a) => Math.abs(wrapAngle(a - home)) <= spread + 1e-9);
  if (!cands.length) cands = TURNS.map((o) => home + o); // far round from home: look from near home instead
  let best = null;
  for (const a of cands) {
    const cam = poseToPos({ target, dist, polar, azimuth: a });
    let hits = 0;
    for (const p of points) if (segmentHits(cam, p, { boxes: props, sails, pad, samples })) hits++;
    const turn = Math.abs(wrapAngle(a - current));
    if (!best || hits < best.hits || (hits === best.hits && turn < best.turn - 1e-12)) best = { a, hits, turn };
  }
  return wrapAngle(best.a);
}

// ---------------------------------------------------------------------------------------------
// The tour's poses

/** The whole farm: the island's middle, from the overview distance, at the tour's angle. */
export function overviewPose({ center, overviewDist, azimuth, polar = TOUR.polar }) {
  return { target: [...xyz(center)], dist: overviewDist, polar, azimuth };
}

/**
 * The 5 points a field's sight lines aim at: its coin top (or topY + 0.4 over its middle) and 4
 * points 0.6 of its radius toward the corners of its bounding box.
 * @param {{center: [number, number], radius: number, topY: number, bbox: [number, number, number, number]}} field
 */
export function fieldLookPoints(field, coinTop = null) {
  const [cx, cz] = field.center;
  const y = field.topY + 0.4;
  const [x0, z0, x1, z1] = field.bbox || [cx - field.radius, cz - field.radius, cx + field.radius, cz + field.radius];
  const pts = [[cx, Number.isFinite(coinTop) ? coinTop : y, cz]];
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
    const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
    pts.push([cx + (dx / l) * 0.6 * field.radius, y, cz + (dz / l) * 0.6 * field.radius]);
  }
  return pts;
}

/**
 * The tour's look at one field: just above its soil, the look-at point kept on the island (0.85 of
 * its radius), far enough back for the field to fill the view (focusDist, from rig.focusDistance)
 * and for the floor, from whichever side keeps the barn and the windmill out of the way.
 * @param {object} o
 * @param {{center: [number, number], radius: number, topY: number, bbox?: number[]}} o.field
 * @param {{x: number, z: number}|number[]} o.islandCenter
 * @param {number} o.islandRadius
 * @param {number} o.focusDist
 * @param {{maxPolar: number, floor: number, baseMin?: number}} o.limits
 * @param {number} o.current   the camera's θ now
 * @param {number} [o.home]    the hub's starting θ
 * @param {number} [o.coinTop] the top of the field's coin column, if it has one
 */
export function fieldPose({ field, islandCenter, islandRadius, focusDist, limits, current, home = current, coinTop = null, props = [], sails = [], polar = TOUR.polar }) {
  const c = xyz(islandCenter); // [x, y, z] or a Vector3
  const [cx, cz] = clampToDisc(field.center[0], field.center[1], c[0], c[2], islandRadius * 0.85);
  const ty = field.topY + 0.2;
  const target = [cx, ty, cz];
  const dist = Math.max(limits.baseMin || 0, safeMinDistance(ty, limits.maxPolar, limits.floor), focusDist);
  const azimuth = pickAzimuth({ target, dist, polar, current, home, points: fieldLookPoints(field, coinTop), props, sails });
  return { target, dist, polar, azimuth };
}

/**
 * The tour's first move: keep the look-at point and the direction, only rise: up to the tour's angle
 * (never lower than now) and back to the floor's distance (never closer than now).
 */
export function entryRise(pose, { maxPolar, floor, polar = TOUR.polar }) {
  const t = xyz(pose.target);
  return {
    target: [t[0], t[1], t[2]],
    dist: Math.max(pose.dist, safeMinDistance(t[1], maxPolar, floor)),
    polar: Math.min(pose.polar, polar),
    azimuth: pose.azimuth,
  };
}
