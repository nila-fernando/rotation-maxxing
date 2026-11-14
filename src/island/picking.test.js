import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampToDisc, fitDistance } from './cameraRig.js';
import { CROP_KEYS } from './crops.js';
import { distanceToEdges, footprint, pickField, pointInPolygons } from './picking.js';
import { CROP_ICONS, cropIcon } from '../ui/cropIcons.js';
import { SEASON_ICONS, seasonOf } from '../ui/season.js';

const square = (x0, z0, s) => [[[x0, z0], [x0 + s, z0], [x0 + s, z0 + s], [x0, z0 + s]]];
const withHole = [[[0, 0], [10, 0], [10, 10], [0, 10]], [[4, 4], [6, 4], [6, 6], [4, 6]]];

describe('pointInPolygons', () => {
  it('is inside the outer ring and outside holes', () => {
    assert.equal(pointInPolygons(1, 1, [withHole]), true);
    assert.equal(pointInPolygons(5, 5, [withHole]), false);
    assert.equal(pointInPolygons(11, 5, [withHole]), false);
  });
  it('handles a field in two parts', () => {
    const polys = [square(0, 0, 2), square(5, 5, 2)];
    assert.equal(pointInPolygons(6, 6, polys), true);
    assert.equal(pointInPolygons(3.5, 3.5, polys), false);
  });
});

describe('distanceToEdges', () => {
  it('measures to the nearest edge of any ring', () => {
    assert.ok(Math.abs(distanceToEdges(10.5, 5, [withHole]) - 0.5) < 1e-9);
    assert.ok(Math.abs(distanceToEdges(5, 5, [withHole]) - 1) < 1e-9); // middle of the 2×2 hole
  });
});

describe('footprint', () => {
  it('finds the centre, a radius that holds every corner, and the bbox', () => {
    const fp = footprint([square(2, 4, 2)]);
    assert.ok(Math.abs(fp.center[0] - 3) < 1e-9 && Math.abs(fp.center[1] - 5) < 1e-9);
    assert.ok(Math.abs(fp.radius - Math.SQRT2) < 1e-9);
    assert.deepEqual(fp.bbox, [2, 4, 4, 6]);
  });
  it('weights parts by area', () => {
    const fp = footprint([square(0, 0, 4), square(10, 0, 1)]);
    assert.ok(fp.center[0] > 2 && fp.center[0] < 3);
  });
});

describe('pickField', () => {
  const fields = [
    { id: 'low', polygons: [square(0, 0, 4)], topY: 0.5, bbox: [0, 0, 4, 4] },
    { id: 'high', polygons: [square(0, -6, 4)], topY: 1.5, bbox: [0, -6, 4, -2] },
  ];
  it('hits the field straight below', () => {
    const hit = pickField({ x: 2, y: 10, z: 2 }, { x: 0, y: -1, z: 0 }, fields);
    assert.equal(hit.id, 'low');
    assert.deepEqual(hit.point, [2, 0.5, 2]);
  });
  it('misses open ground, and rays looking up or level', () => {
    assert.equal(pickField({ x: 20, y: 10, z: 20 }, { x: 0, y: -1, z: 0 }, fields), null);
    assert.equal(pickField({ x: 2, y: 10, z: 2 }, { x: 0, y: 1, z: 0 }, fields), null);
    assert.equal(pickField({ x: 2, y: 10, z: 2 }, { x: 1, y: 0, z: 0 }, fields), null);
  });
  it('takes the nearest hit along the ray (a higher field in front)', () => {
    // a big low field all round a small high one: the ray meets both planes inside each outline
    const stacked = [
      { id: 'low', polygons: [square(-20, -20, 40)], topY: 0.5 },
      { id: 'high', polygons: [square(0, -6, 4)], topY: 1.5 },
    ];
    const origin = { x: 2, y: 6, z: -12 };
    const dir = { x: 0, y: -4.5, z: 8 }; // reaches y = 1.5 at z = -4 (on the high field), y = 0.5 at z = -2.2
    assert.equal(pickField(origin, dir, stacked).id, 'high');
    assert.equal(pickField(origin, dir, [...stacked].reverse()).id, 'high');
  });
  it('counts the fence line with a tolerance', () => {
    const down = { x: 0, y: -1, z: 0 };
    assert.equal(pickField({ x: 4.05, y: 5, z: 2 }, down, fields), null);
    assert.equal(pickField({ x: 4.05, y: 5, z: 2 }, down, fields, 0.08).id, 'low');
  });
});

describe('camera rig maths', () => {
  it('fits farther back when the free area is narrower', () => {
    const wide = fitDistance({ radius: 10, fovDeg: 30, height: 800, freeWidth: 1200, freeHeight: 800 });
    const narrow = fitDistance({ radius: 10, fovDeg: 30, height: 800, freeWidth: 600, freeHeight: 800 });
    assert.ok(narrow > wide);
    assert.ok(fitDistance({ radius: 20, fovDeg: 30, height: 800, freeWidth: 1200, freeHeight: 800 }) > wide);
  });
  it('clamps a point into a disc', () => {
    assert.deepEqual(clampToDisc(1, 1, 0, 0, 5), [1, 1]);
    const [x, z] = clampToDisc(10, 0, 0, 0, 5);
    assert.ok(Math.abs(x - 5) < 1e-9 && Math.abs(z) < 1e-9);
  });
});

describe('seasonOf', () => {
  it('names the season and year by month', () => {
    assert.equal(seasonOf(new Date(2026, 10, 14)).label, 'Fall 2026');
    assert.equal(seasonOf(new Date(2026, 3, 1)).label, 'Spring 2026');
    assert.equal(seasonOf(new Date(2026, 6, 4)).label, 'Summer 2026');
    assert.equal(seasonOf(new Date(2026, 11, 20)).label, 'Winter 2026–27');
    assert.equal(seasonOf(new Date(2027, 0, 5)).label, 'Winter 2026–27');
    assert.equal(seasonOf(new Date(2027, 1, 28)).key, 'winter');
  });
  it('has an icon for every season', () => {
    for (const k of ['spring', 'summer', 'fall', 'winter']) assert.match(SEASON_ICONS[k], /^<svg/);
  });
});

describe('crop icons', () => {
  it('draws every crop key, and the sprout for anything else', () => {
    for (const k of CROP_KEYS) assert.match(CROP_ICONS[k], /^<svg[^>]*aria-hidden="true"/);
    assert.equal(cropIcon('dragonfruit'), CROP_ICONS.other);
  });
});

describe('simplifyGeometry', async () => {
  const THREE = await import('three');
  const { simplifyGeometry } = await import('./props.js');
  it('makes a dense sphere much lighter and keeps its size and shape', () => {
    const dense = new THREE.SphereGeometry(1, 256, 128);
    const light = simplifyGeometry(dense, 2 / 40);
    const before = dense.index.count / 3, after = light.index.count / 3;
    assert.ok(after < before / 4, `${before} -> ${after}`);
    const bb = light.boundingBox;
    for (const k of ['x', 'y', 'z']) {
      assert.ok(Math.abs(bb.max[k] - 1) < 0.05 && Math.abs(bb.min[k] + 1) < 0.05, `${k}: ${bb.min[k]}..${bb.max[k]}`);
    }
    const p = light.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i), p.getZ(i));
      assert.ok(r > 0.97 && r < 1.001, `vertex ${i} at radius ${r}`);
    }
    assert.ok(light.attributes.normal, 'normals rebuilt');
  });
  it('keepSides keeps the two faces of a thin shell apart', async () => {
    const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    const outer = new THREE.SphereGeometry(1, 96, 48).toNonIndexed();
    const inner = new THREE.SphereGeometry(0.99, 96, 48).toNonIndexed(); // 0.01 thick: well under a cell
    // turn the inner sphere inside out (normals and winding), as the back of a shell would be
    for (const name of ['position', 'normal']) {
      const a = inner.attributes[name];
      for (let t = 0; t < a.count; t += 3) {
        const x = a.getX(t + 1), y = a.getY(t + 1), z = a.getZ(t + 1);
        a.setXYZ(t + 1, a.getX(t + 2), a.getY(t + 2), a.getZ(t + 2));
        a.setXYZ(t + 2, x, y, z);
      }
    }
    const n = inner.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    const shell = mergeGeometries([outer, inner]);
    const inward = (g) => {
      const p = g.attributes.position, q = g.attributes.normal;
      let k = 0;
      for (let i = 0; i < p.count; i++) if (p.getX(i) * q.getX(i) + p.getY(i) * q.getY(i) + p.getZ(i) * q.getZ(i) < -0.5) k++;
      return k;
    };
    const kept = simplifyGeometry(shell, 0.08, { keepSides: true });
    const folded = simplifyGeometry(shell, 0.08);
    assert.ok(kept.attributes.position.count > folded.attributes.position.count * 1.5, 'both sides keep their own vertices');
    // the merged-together version has (nearly) no consistent inner side left to point inward from
    assert.ok(inward(kept) > kept.attributes.position.count * 0.3, `inward ${inward(kept)} of ${kept.attributes.position.count}`);
  });
});
