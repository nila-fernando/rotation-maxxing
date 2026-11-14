// Does this box (or point, or ball) run into a prop? Plain maths on the island's placed props, so the
// festival themes, the coin stacks and the camera all measure clearance the same way.
//
// A prop is what the reveal records for each thing it places (src/screens/reveal.js):
//   { key, x, z, r, ry, scale, height, y, box: { min: [x, y, z], max: [x, y, z] } }
// where box is the prop's own unrotated, unscaled bounding box and (x, y, z) is where it stands.
// Boxes here are duck-typed: anything with min and max that have x, y and z (a THREE.Box3 will do).
// No three.js and no DOM, so node:test can import it.

export const SHRINK = 0.1; // the themes take each box a tenth in from every side first (touching is fine)

const isEmpty = (box) => box.max.x < box.min.x || box.max.y < box.min.y || box.max.z < box.min.z;

/**
 * A copy of a box taken `k / 2` of its size in from every side (a THREE.Box3 stays a Box3). An empty
 * box stays as it is.
 */
export function shrunk(box, k = SHRINK) {
  const b = typeof box.clone === 'function' ? box.clone() : { min: { ...box.min }, max: { ...box.max } };
  if (isEmpty(box)) return b;
  const h = k / 2;
  for (const a of ['x', 'y', 'z']) {
    const s = box.max[a] - box.min[a];
    b.min[a] += s * h;
    b.max[a] += s * -h;
  }
  return b;
}

/**
 * A prop's box in its own frame: x right and z front, measured from where it stands (p.x, p.z), and
 * y in island space. Each side is taken `shrink / 2` of the size in, then `pad` out.
 * Returns { lo: [x, y, z], hi: [x, y, z] }, or null for a prop with no box.
 */
export function propBox(p, { shrink = 0, pad = 0 } = {}) {
  if (!p.box) return null;
  const s = p.scale || 1;
  const pmin = p.box.min, pmax = p.box.max;
  const sx = (pmax[0] - pmin[0]) * s, sy = (pmax[1] - pmin[1]) * s, sz = (pmax[2] - pmin[2]) * s;
  const lo = [pmin[0] * s + sx * shrink / 2 - pad, p.y + pmin[1] * s + sy * shrink / 2 - pad, pmin[2] * s + sz * shrink / 2 - pad];
  const hi = [pmax[0] * s - sx * shrink / 2 + pad, p.y + pmax[1] * s - sy * shrink / 2 + pad, pmax[2] * s - sz * shrink / 2 + pad];
  return { lo, hi };
}

/** A point in island space in the prop's own frame: [x right, z front]. */
function toLocal(x, z, p) {
  const c = Math.cos(p.ry || 0), sn = Math.sin(p.ry || 0);
  const dx = x - p.x, dz = z - p.z;
  return [dx * c - dz * sn, dx * sn + dz * c];
}

/**
 * Does a box in island space overlap a prop's own rotated box? The prop's box is shrunk and padded
 * as propBox does it; the box is taken as it is (its corners are turned into the prop's frame, so a
 * turned prop is measured by a box round those corners: a little generous, never short).
 */
export function boxHitsProp(box, p, { shrink = SHRINK, pad = 0 } = {}) {
  const pb = propBox(p, { shrink, pad });
  if (!pb) return false;
  const { lo, hi } = pb;
  if (box.max.y < lo[1] || box.min.y > hi[1]) return false;
  // the box's corners in the prop's own frame (x right, z front)
  let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
    const [lx, lz] = toLocal(x, z, p);
    ax = Math.min(ax, lx); bx = Math.max(bx, lx); az = Math.min(az, lz); bz = Math.max(bz, lz);
  }
  return !(bx < lo[0] || ax > hi[0] || bz < lo[2] || az > hi[2]);
}

/** Does a box in island space overlap a prop's own rotated box (both shrunk a little)? (the themes' test) */
export function hitsProp(box, p) {
  return boxHitsProp(box, p, { shrink: SHRINK, pad: 0 });
}

/** Is a point ({x, y, z} or [x, y, z]) inside a prop's own rotated box, padded by `pad` all round? */
export function pointInPropBox(pt, p, pad = 0) {
  const pb = propBox(p, { pad });
  if (!pb) return false;
  const [x, y, z] = Array.isArray(pt) ? pt : [pt.x, pt.y, pt.z];
  if (y < pb.lo[1] || y > pb.hi[1]) return false;
  const [lx, lz] = toLocal(x, z, p);
  return lx >= pb.lo[0] && lx <= pb.hi[0] && lz >= pb.lo[2] && lz <= pb.hi[2];
}

/** The height of a prop's top in island space (from its box, or its recorded height without one). */
export function propTop(p) {
  if (p.box) return p.y + p.box.max[1] * (p.scale || 1);
  return p.y + (p.height || 0);
}

/** Does a ball { x, y, z, r } overlap an axis-aligned box? (touching is fine) */
export function sphereHitsBox(s, box) {
  if (isEmpty(box)) return false;
  const nx = Math.max(box.min.x, Math.min(s.x, box.max.x));
  const ny = Math.max(box.min.y, Math.min(s.y, box.max.y));
  const nz = Math.max(box.min.z, Math.min(s.z, box.max.z));
  return Math.hypot(nx - s.x, ny - s.y, nz - s.z) < s.r;
}
