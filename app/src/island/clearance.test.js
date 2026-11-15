// Clearance against the island's props: the themes' test is unchanged by the move, and the new
// unshrunk, padded tests catch what the themes let through on purpose.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { shrunk, hitsProp, boxHitsProp, propBox, pointInPropBox, propTop, sphereHitsBox } from './clearance.js';

// the themes' code before the move (src/island/themes/index.js), kept here to compare against
const OLD_SHRINK = 0.1;
function oldShrunk(box) {
  const b = box.clone(), s = new THREE.Vector3();
  b.getSize(s);
  b.min.addScaledVector(s, OLD_SHRINK / 2);
  b.max.addScaledVector(s, -OLD_SHRINK / 2);
  return b;
}
function oldHitsProp(box, p) {
  if (!p.box) return false;
  const s = p.scale || 1, c = Math.cos(p.ry || 0), sn = Math.sin(p.ry || 0);
  const pmin = p.box.min, pmax = p.box.max;
  const sx = (pmax[0] - pmin[0]) * s, sy = (pmax[1] - pmin[1]) * s, sz = (pmax[2] - pmin[2]) * s;
  const lo = [pmin[0] * s + sx * OLD_SHRINK / 2, p.y + pmin[1] * s + sy * OLD_SHRINK / 2, pmin[2] * s + sz * OLD_SHRINK / 2];
  const hi = [pmax[0] * s - sx * OLD_SHRINK / 2, p.y + pmax[1] * s - sy * OLD_SHRINK / 2, pmax[2] * s - sz * OLD_SHRINK / 2];
  if (box.max.y < lo[1] || box.min.y > hi[1]) return false;
  let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
    const dx = x - p.x, dz = z - p.z;
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    ax = Math.min(ax, lx); bx = Math.max(bx, lx); az = Math.min(az, lz); bz = Math.max(bz, lz);
  }
  return !(bx < lo[0] || ax > hi[0] || bz < lo[2] || az > hi[2]);
}

// the themes test's fake farm props (src/island/themes/themes.test.js), each given an own box the
// way the reveal records it (unrotated, unscaled), plus one with no box at all
const BOX = {
  barn: [[-1, 0, -0.8], [1, 2.27, 0.8]],
  farmhouse: [[-0.7, 0, -0.6], [0.7, 1.6, 0.6]],
  machineShed: [[-0.9, 0, -0.7], [0.9, 1.33, 0.7]],
  windmill: [[-0.6, 0, -0.6], [0.6, 3.47, 0.6]],
  silo: [[-0.45, 0, -0.45], [0.45, 2.4, 0.45]],
  tree: [[-0.4, 0, -0.4], [0.4, 2.13, 0.4]],
  pine: [[-0.35, 0, -0.35], [0.35, 2.4, 0.35]],
};
const PROPS = [
  { key: 'barn', x: 0, z: -0.4, r: 1.1, ry: 0, scale: 0.75, height: 1.7, y: 0.6 },
  { key: 'farmhouse', x: -1.6, z: 0.6, r: 0.75, ry: 0.3, scale: 0.75, height: 1.2, y: 0.6 },
  { key: 'machineShed', x: 1.8, z: 0.4, r: 0.8, ry: -0.3, scale: 0.75, height: 1.0, y: 0.6 },
  { key: 'windmill', x: 0.4, z: -5.2, r: 0.5, ry: 0, scale: 0.75, height: 2.6, y: 1.6 },
  { key: 'silo', x: 1.0, z: -1.4, r: 0.45, ry: 0, scale: 0.75, height: 1.8, y: 0.6 },
  { key: 'tree', x: -5.6, z: 0.2, r: 0.34, ry: 0, scale: 0.75, height: 1.6, y: 0.6 },
  { key: 'pine', x: 5.5, z: 0.4, r: 0.3, ry: 0, scale: 0.75, height: 1.8, y: 0.6 },
  { key: 'tree', x: 0.3, z: 5.8, r: 0.34, ry: 0, scale: 0.75, height: 1.6, y: 0.6 },
].map((p) => ({ ...p, box: { min: BOX[p.key][0], max: BOX[p.key][1] } }))
  .concat([{ key: 'lamp', x: 2, z: 2, r: 0.2, ry: 0, scale: 1, height: 1.3, y: 0.6 }]);

/** A seeded random number in [0, 1) (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random boxes all over the fake farm, from tiny to building-sized. */
function randomBoxes(n, seed) {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * 14, z = (r() - 0.5) * 14, y = r() * 3;
    const w = 0.02 + r() * 1.5, d = 0.02 + r() * 1.5, h = 0.02 + r() * 1.5;
    out.push(new THREE.Box3(new THREE.Vector3(x, y, z), new THREE.Vector3(x + w, y + h, z + d)));
  }
  return out;
}

describe('clearance', () => {
  it('hitsProp gives exactly what the themes got before the move', () => {
    let hits = 0, tested = 0;
    for (const raw of randomBoxes(4000, 7)) {
      const box = shrunk(raw);
      const old = oldShrunk(raw);
      assert.ok(box.isBox3, 'a Box3 stays a Box3');
      assert.ok(box.min.equals(old.min) && box.max.equals(old.max), 'shrunk the same');
      for (const p of PROPS) {
        const a = hitsProp(box, p), b = oldHitsProp(old, p);
        assert.equal(a, b, `${p.key} against ${box.min.toArray()} to ${box.max.toArray()}`);
        if (a) hits++;
        tested++;
      }
    }
    assert.ok(hits > 50 && hits < tested, `${hits} of ${tested} hit (the test sees both answers)`);
  });

  it('shrinks plain boxes too, and leaves an empty one alone', () => {
    const b = shrunk({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 2, z: 4 } });
    assert.deepEqual(b, { min: { x: 0.5, y: 0.1, z: 0.2 }, max: { x: 9.5, y: 1.9, z: 3.8 } });
    const empty = new THREE.Box3();
    const s = shrunk(empty);
    assert.ok(s.isEmpty() && s.min.equals(oldShrunk(empty).min));
  });

  it('unshrunk and padded, it catches a box touching a barn corner that the themes let through', () => {
    const barn = PROPS[0]; // spans x -0.75 to 0.75, z -1 to 0.2, y 0.6 to 2.3
    const box = { min: { x: 0.7, y: 0.6, z: 0.15 }, max: { x: 1.0, y: 1.0, z: 0.5 } };
    assert.equal(hitsProp(box, barn), false);
    assert.equal(boxHitsProp(box, barn, { shrink: 0, pad: 0.1 }), true);
    // and one just clear of the pad is clear
    const clear = { min: { x: 0.86, y: 0.6, z: 0.15 }, max: { x: 1.2, y: 1.0, z: 0.5 } };
    assert.equal(boxHitsProp(clear, barn, { shrink: 0, pad: 0.1 }), false);
    // above the roof (with the pad) is clear too
    const over = { min: { x: -0.2, y: 2.45, z: -0.5 }, max: { x: 0.2, y: 2.8, z: 0 } };
    assert.equal(boxHitsProp(over, barn, { shrink: 0, pad: 0.1 }), false);
    assert.equal(boxHitsProp(over, barn, { shrink: 0, pad: 0.2 }), true);
  });

  it('a prop with no box never blocks anything', () => {
    const lamp = PROPS.at(-1);
    assert.equal(propBox(lamp), null);
    assert.equal(boxHitsProp({ min: { x: 1, y: 0, z: 1 }, max: { x: 3, y: 3, z: 3 } }, lamp, { shrink: 0, pad: 1 }), false);
    assert.equal(pointInPropBox([2, 1, 2], lamp, 1), false);
    assert.equal(propTop(lamp), 0.6 + 1.3);
  });

  it('propBox scales, shrinks and pads in the prop’s own frame', () => {
    const { lo, hi } = propBox(PROPS[0]);
    assert.deepEqual(lo.map((v) => +v.toFixed(4)), [-0.75, 0.6, -0.6]);
    assert.deepEqual(hi.map((v) => +v.toFixed(4)), [0.75, 2.3025, 0.6]);
    const padded = propBox(PROPS[0], { pad: 0.1 });
    assert.ok(Math.abs(padded.lo[0] + 0.85) < 1e-9 && Math.abs(padded.hi[1] - 2.4025) < 1e-9);
    const small = propBox(PROPS[0], { shrink: 0.1 });
    assert.ok(Math.abs(small.lo[0] + 0.675) < 1e-9);
  });

  it('points inside a turned prop', () => {
    const house = PROPS[1]; // turned 0.3, 1.05 wide and 0.9 deep, standing at (-1.6, 0.6)
    assert.equal(pointInPropBox({ x: -1.6, y: 1, z: 0.6 }, house), true);
    assert.equal(pointInPropBox([-1.6, 0.5, 0.6], house), false, 'below its floor');
    assert.equal(pointInPropBox([-1.6, 1.85, 0.6], house), false, 'above its roof');
    assert.equal(pointInPropBox([-1.6, 1.85, 0.6], house, 0.1), true, 'within the pad over the roof');
    // the corner of its own frame (x right, z front), turned into island space
    const c = Math.cos(0.3), s = Math.sin(0.3), lx = 0.5, lz = 0.42;
    const wx = -1.6 + lx * c + lz * s, wz = 0.6 - lx * s + lz * c;
    assert.equal(pointInPropBox([wx, 1, wz], house), true);
    const ox = -1.6 + 0.6 * c + lz * s, oz = 0.6 - 0.6 * s + lz * c;
    assert.equal(pointInPropBox([ox, 1, oz], house), false, 'just past its side');
  });

  it('propTop is the top of the scaled box', () => {
    assert.ok(Math.abs(propTop(PROPS[3]) - (1.6 + 3.47 * 0.75)) < 1e-9);
  });

  it('a ball against a box', () => {
    const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    assert.equal(sphereHitsBox({ x: 0.5, y: 0.5, z: 0.5, r: 0.01 }, box), true, 'inside');
    assert.equal(sphereHitsBox({ x: 1.2, y: 0.5, z: 0.5, r: 0.3 }, box), true, 'over a face');
    assert.equal(sphereHitsBox({ x: 1.2, y: 1.2, z: 1.2, r: 0.3 }, box), false, 'off a corner');
    assert.equal(sphereHitsBox({ x: 1.2, y: 1.2, z: 1.2, r: 0.4 }, box), true, 'into a corner');
    assert.equal(sphereHitsBox({ x: 2, y: 0.5, z: 0.5, r: 1 }, box), false, 'touching is fine');
    assert.equal(sphereHitsBox({ x: 0, y: 0, z: 0, r: 5 }, new THREE.Box3()), false, 'an empty box');
  });
});
