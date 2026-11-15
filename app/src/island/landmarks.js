// The island's two landmarks: the lighthouse on its highest point (the crag's flat top, a hill, or
// the farmyard if that's highest) and the windmill on other open, fairly high ground. Plain maths
// over the plan and the terrain (no three.js), so node:test can check the spots; the reveal
// (src/screens/reveal.js) hands in addProp to build them.
//
// Both:
//   - stand on open, level grass: off the fields (with room for the fence), the upgrade pads, the
//     props and the tree pads (openGround);
//   - can be seen from the camera's side (+z): nothing big in front of them, and they don't stand
//     in front of a building;
//   - turn their fronts toward the camera;
//   - join the obstacles (addProp pushes their footprints), so the sheep walk round them.
// The lighthouse's beam sweeps a disc at lantern height: nothing standing within its reach may come
// up into it (trees on their pads, props, the windmill and its sails). The windmill's sails sweep a
// disc in front of its tower: nothing may stand in it, not the lighthouse nor the ground at a cliff
// edge, and the space under it is kept clear for what's placed later.
import { FOOTPRINT } from './props.js';
import { beamFloorAt, beamReach } from './lighthouse.js';

/** How tall a tree on a tree pad grows, at most (a pine at 1.05 × 0.75 scale is 1.9). */
const TREE_TOP = 2.05;
/** The windmill: hub 2.2 up and 0.62 in front of the tower, sails 1.3 long, 3.47 to the top blade. */
export const MILL = { hubY: 2.2, hubOut: 0.62, sail: 1.3, top: 3.47 };

/** Point in polygon (ray casting) for one ring of [x, z]. */
export function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a ring's edges. */
export function ringDistance([x, z], ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

/**
 * Open grass: off fields, pads, props and paths, level, on the island. Returns open(x, z, r).
 * (Reads `obstacles` live, so what's placed after is taken into account.)
 */
export function openGround({ terrain, plan, obstacles }) {
  const level = (x, z, r) => {
    const h = terrain.heightAt(x, z);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (Math.abs(terrain.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - h) > 0.11) return false;
    }
    return true;
  };
  return (x, z, r) => terrain.field.isFree?.(x, z, r, { strict: true }) !== false
    && !obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.15)
    && !plan.slots.some((sl) => Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + r + 0.15)
    && !plan.fields.some((pf) => pf.polygons.some((rings) => inRing([x, z], rings[0]) || ringDistance([x, z], rings[0]) < r + 0.25))
    && level(x, z, r);
}

/** The shared view of the island the two placements look over. */
function survey({ terrain, plan, obstacles }) {
  const f = terrain.field;
  const [cx, cz] = f.center;
  const R = f.maxCoast || plan.radius || 7;
  // higher first; on the same shelf, the front (toward the camera) and the middle win
  const score = (x, z) => terrain.heightAt(x, z) + (z - cz) * 0.012 - Math.hypot(x - cx, z - cz) * 0.004;
  const grid = [];
  for (let x = cx - R; x <= cx + R; x += 0.25) for (let z = cz - R; z <= cz + R; z += 0.25) grid.push({ x, z, score: score(x, z) });
  const trees = plan.slots.filter((sl) => sl.kind === 'tree');
  // the camera looks from +z: nothing big in front of it, and it isn't standing in front of a building
  const hidden = (x, z) => obstacles.some((o) => o.r > 0.4 && o.z > z && o.z - z < 3 && Math.abs(o.x - x) < o.r + 0.55)
    || trees.some((t) => t.at[1] > z && t.at[1] - z < 2.2 && Math.abs(t.at[0] - x) < 0.8);
  const blocking = (x, z) => obstacles.some((o) => o.r > 0.6 && o.z < z && z - o.z < 2.4 && Math.abs(o.x - x) < o.r * 0.8);
  const ryAt = (x, z) => Math.atan2(cx - x, cz + 12 - z);
  const candidates = (open, r, yardSpots) => [
    ...grid.filter((p) => open(p.x, p.z, r)),
    // the farmyard's free spots (clear of the buildings put up since)
    ...yardSpots(r).filter(([x, z]) => !obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.12))
      .map(([x, z]) => ({ x, z, score: score(x, z) })),
  ].sort((a, b) => b.score - a.score);
  return { score, trees, hidden, blocking, ryAt, candidates };
}

/**
 * Whether something standing at (x, z), `r` round and `top` high (world y), stays under the beam of
 * a lighthouse at `lh` ({ x, z, base, scale }).
 */
export function underBeam(lh, x, z, r, top) {
  if (!lh) return true;
  const d = Math.hypot(x - lh.x, z - lh.z) - r;
  return top < lh.base + beamFloorAt(d, lh.scale) - 0.08;
}

/**
 * The lighthouse on the island's highest open ground, turned to the camera. Tries a slightly smaller
 * one before giving up, then lets go of the "seen from the front" rule. Returns { x, z, ry, scale,
 * base, reach } or null.
 * @param {object} o
 * @param {object[]} [o.props]   what's placed already ({ x, z, r, y, height }): kept under the beam
 * @param {(r: number) => [number, number][]} [o.yardSpots]   free spots in the farmyard
 */
export function placeLighthouse({ terrain, plan, obstacles, open, addProp, make, props = [], yardSpots = () => [], scale = 0.75 }) {
  if (!terrain.field?.center) return null;
  const { trees, hidden, blocking, ryAt, candidates } = survey({ terrain, plan, obstacles });
  const beamClear = (x, z, s) => {
    const lh = { x, z, scale: s, base: terrain.heightAt(x, z) };
    if (trees.some((t) => !underBeam(lh, t.at[0], t.at[1], t.r, terrain.heightAt(t.at[0], t.at[1]) + TREE_TOP))) return false;
    return props.every((p) => !Number.isFinite(p.height) || underBeam(lh, p.x, p.z, p.r, (p.y ?? terrain.heightAt(p.x, p.z)) + p.height));
  };
  for (const strict of [true, false]) {
    for (const s of [scale, scale * 0.85]) {
      const r = FOOTPRINT.lighthouse * s;
      const c = candidates(open, r, yardSpots).find((p) => (!strict || (!hidden(p.x, p.z) && !blocking(p.x, p.z))) && beamClear(p.x, p.z, s));
      if (globalThis.__dbgLH) { const cs = candidates(open, r, yardSpots).slice(0, 400); const why = {}; for (const p of cs) { const k = hidden(p.x, p.z) ? 'hidden' : blocking(p.x, p.z) ? 'blocking' : !beamClear(p.x, p.z, s) ? 'beam' : 'ok'; why[k] = (why[k] || 0) + 1; } console.log('LH', strict, s, cs[0] && terrain.heightAt(cs[0].x, cs[0].z).toFixed(2), JSON.stringify(why), c && terrain.heightAt(c.x, c.z).toFixed(2)); }
      if (!c) continue;
      const ry = ryAt(c.x, c.z);
      addProp(make(), [c.x, c.z], s, ry, 'lighthouse');
      return { x: c.x, z: c.z, ry, scale: s, base: terrain.heightAt(c.x, c.z), reach: beamReach(s) };
    }
  }
  return null;
}

/**
 * Where the windmill's sails turn, for a windmill at (x, z) turned ry at `scale`: the hub, the
 * facing and across directions, and the sails' reach.
 */
export function sailDisc(terrain, x, z, ry, scale) {
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const base = terrain.heightAt(x, z);
  return {
    x: x + fx * MILL.hubOut * scale, z: z + fz * MILL.hubOut * scale, y: base + MILL.hubY * scale,
    R: MILL.sail * scale, fx, fz, px: fz, pz: -fx, base,
  };
}

/**
 * The windmill on open, fairly high ground away from the lighthouse (the next best hill, a shelf,
 * the farmyard), turned to the camera's side, seen from the front, its sails clear of everything
 * and under the lighthouse's beam. Tries a slightly smaller windmill, then lets it come closer to
 * the lighthouse, before giving up. Returns { x, z, ry, scale } or null.
 * @param {object} o
 * @param {object|null} [o.lighthouse]   placeLighthouse's answer
 */
export function placeWindmill({ terrain, plan, obstacles, open, addProp, make, lighthouse = null, yardSpots = () => [], scale = 0.75 }) {
  if (!terrain.field?.center) return null;
  const { trees, hidden, blocking, ryAt, candidates } = survey({ terrain, plan, obstacles });
  // the sails sweep a circle 2.6 across: nothing may stand in it, a tree or a building or the
  // ground itself (at a cliff edge)
  const sailsClear = (x, z, s) => {
    const d = sailDisc(terrain, x, z, ryAt(x, z), s);
    const inDisc = (ox, oz, or) => {
      const dx = ox - d.x, dz = oz - d.z;
      return Math.abs(dx * d.fx + dz * d.fz) < or + 0.15 && Math.abs(dx * d.px + dz * d.pz) < d.R + or;
    };
    if (obstacles.some((o) => inDisc(o.x, o.z, o.r))) return false;
    if (trees.some((t) => inDisc(t.at[0], t.at[1], t.r))) return false;
    for (let a = -Math.PI / 2; a <= Math.PI / 2 + 1e-6; a += Math.PI / 10) { // the lower half of the circle
      const l = Math.sin(a) * d.R, y = d.y - Math.cos(a) * d.R;
      if (terrain.heightAt(d.x + d.px * l, d.z + d.pz * l) > y - 0.05) return false;
    }
    return true;
  };
  // it mustn't stand in front of the lighthouse (hiding it), and its top and sails stay under the beam
  const byLighthouse = (x, z, s, apart) => {
    const lh = lighthouse;
    if (!lh) return true;
    if (Math.hypot(x - lh.x, z - lh.z) < apart) return false;
    if (z > lh.z && z - lh.z < 3.2 && Math.abs(x - lh.x) < 1.3) return false;
    const reach = (MILL.sail + MILL.hubOut) * s; // round the tower, as far as a sail tip can be
    return underBeam(lh, x, z, reach, terrain.heightAt(x, z) + MILL.top * s);
  };
  const passes = lighthouse ? [lighthouse.reach + 1.4, 0] : [0];
  for (const apart of passes) {
    for (const s of [scale, scale * 0.85]) {
      const r = FOOTPRINT.windmill * s;
      const c = candidates(open, r, yardSpots).find((p) => !hidden(p.x, p.z) && !blocking(p.x, p.z) && byLighthouse(p.x, p.z, s, apart) && sailsClear(p.x, p.z, s));
      if (!c) continue;
      const ry = ryAt(c.x, c.z);
      addProp(make(), [c.x, c.z], s, ry, 'windmill');
      // keep the space under the sails clear for what's placed after (lamps, decorations, festivals)
      const d = sailDisc(terrain, c.x, c.z, ry, s);
      for (const l of [-0.66, 0, 0.66]) obstacles.push({ x: d.x + d.px * l * d.R, z: d.z + d.pz * l * d.R, r: d.R * 0.42 });
      return { x: c.x, z: c.z, ry, scale: s };
    }
  }
  return null;
}
