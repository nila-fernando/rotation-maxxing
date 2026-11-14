import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHeightField, levelHeight, BASE_HEIGHT, SEA_LEVEL, COAST_CLEAR } from './terrain.js';

// ---------- sample plans (the planner's output shape) ----------

const field = (polygon, level, pad = 0.3) => ({ type: 'polygon', polygon, level, pad });

// 5 real-shaped fields over 2 levels, a crag, a pond and a round building slot
const FIVE = {
  seed: 11, radius: 7.3,
  coast: { center: [0, 0], radii: [7.5, 7.2, 7.0, 7.1, 7.3, 6.9, 7.0, 7.3, 7.4, 7.6, 7.6, 7.4, 7.5] },
  terraces: [
    { level: 1, height: levelHeight(1), polygon: [[-3.4, -0.2], [3.8, -0.2], [4.9, -2.4], [4.6, -5.2], [2.2, -6.4], [-1.6, -6.5], [-3.2, -5.0]] },
  ],
  flats: [
    field([[-4.3, 0.9], [-1.9, 0.6], [-1.6, 3.0], [-3.2, 3.9], [-4.4, 3.1]], 0),
    field([[-1.2, 0.7], [1.4, 0.9], [1.2, 3.6], [-1.0, 3.8]], 0),
    field([[1.9, 1.0], [3.4, 0.7], [3.6, 2.3], [2.9, 3.8], [1.9, 3.4]], 0),
    field([[-2.4, -1.0], [0.2, -0.8], [0.0, -3.4], [-2.0, -3.7], [-2.7, -2.4]], 1),
    field([[0.8, -0.9], [3.4, -1.1], [3.1, -3.2], [1.0, -3.6]], 1),
    { type: 'circle', x: -0.6, z: -5.0, r: 0.9, level: 1, pad: 0.2 },
  ],
  features: [
    { type: 'crag', at: [-5.0, -3.4], r: 1.4 },
    { type: 'pond', at: [2.6, -4.9], r: 0.6 },
  ],
};

// a field with a many-vertex wiggly outline and a hole, a field pushed against the coast,
// a level-2 field, a hill and an offset island centre
function wiggly(cx, cz, rx, rz, n, seed) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + 0.12 * Math.sin(a * 5 + seed) + 0.06 * Math.sin(a * 13 + seed * 2);
    pts.push([cx + Math.cos(a) * rx * w, cz + Math.sin(a) * rz * w]);
  }
  return pts;
}
const ODD = {
  seed: 5, radius: 6,
  coast: { center: [30, -12], radii: [6, 5.5, 5.8, 6.2, 5.6, 6] },
  terraces: [{ level: 2, height: levelHeight(2), polygon: wiggly(30, -14, 3.2, 2.2, 40, 1) }],
  flats: [
    field([wiggly(30, -14, 2.0, 1.3, 300, 3), wiggly(30.4, -14, 0.4, 0.3, 12, 1)], 2),
    field([[33.5, -10.5], [37.2, -10.8], [37.0, -8.4], [33.8, -8.9]], 0, 0.25), // near the east coast
    { type: 'circle', x: 25.5, z: -9.5, r: 0.7, level: 0, pad: 0.2 },
  ],
  features: [{ type: 'hill', at: [26, -15], r: 1.3 }],
};

const PLANS = { FIVE, ODD };

// ---------- helpers that do not use terrain.js internals ----------

function rings(polygon) {
  return Array.isArray(polygon[0][0]) ? polygon : [polygon];
}
function inside(x, z, rs) {
  let c = false;
  for (const ring of rs) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[j], [bx, bz] = ring[i];
      if ((bz > z) !== (az > z) && x < ((ax - bx) * (z - bz)) / (az - bz) + bx) c = !c;
    }
  }
  return c;
}
function edgeDist(x, z, rs) {
  let best = Infinity;
  for (const ring of rs) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[j], [bx, bz] = ring[i];
      const vx = bx - ax, vz = bz - az, l = vx * vx + vz * vz;
      const t = l ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l)) : 0;
      best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
    }
  }
  return best;
}
// points on a grid over the flat's padded shape (inside the polygon, or within pad of its edge)
function samplesIn(f, step = 0.05) {
  const pts = [];
  if (f.type === 'circle') {
    const R = f.r + (f.pad || 0);
    for (let x = -R; x <= R; x += step) for (let z = -R; z <= R; z += step) {
      if (Math.hypot(x, z) <= R * 0.99999) pts.push([f.x + x, f.z + z]);
    }
    return pts;
  }
  const rs = rings(f.polygon), pad = f.pad || 0;
  const xs = rs[0].map((p) => p[0]), zs = rs[0].map((p) => p[1]);
  for (let x = Math.min(...xs) - pad; x <= Math.max(...xs) + pad; x += step) {
    for (let z = Math.min(...zs) - pad; z <= Math.max(...zs) + pad; z += step) {
      if (inside(x, z, rs) || edgeDist(x, z, rs) <= pad * 0.9999) pts.push([x, z]);
    }
  }
  return pts;
}
function outline(f) {
  if (f.type === 'circle') {
    const R = f.r + (f.pad || 0);
    return Array.from({ length: 64 }, (_, i) => [f.x + Math.cos((i / 64) * Math.PI * 2) * R, f.z + Math.sin((i / 64) * Math.PI * 2) * R]);
  }
  return rings(f.polygon)[0];
}

// ---------- tests ----------

for (const [name, plan] of Object.entries(PLANS)) {
  test(`${name}: every flat is exactly level at levelHeight(level), pad included`, () => {
    const h = makeHeightField(plan);
    for (const [i, f] of plan.flats.entries()) {
      const want = levelHeight(f.level);
      const pts = samplesIn(f, plan === ODD ? 0.04 : 0.05);
      assert.ok(pts.length > 50, `flat ${i} has samples`);
      for (const [x, z] of pts) assert.equal(h(x, z), want, `flat ${i} at ${x.toFixed(3)},${z.toFixed(3)}`);
    }
  });

  test(`${name}: the coast encloses every flat with room for a beach`, () => {
    const h = makeHeightField(plan);
    const [cx, cz] = plan.coast.center;
    for (const [i, f] of plan.flats.entries()) {
      for (const [x, z] of outline(f)) {
        const r = Math.hypot(x - cx, z - cz), R = h.coastR(Math.atan2(z - cz, x - cx));
        assert.ok(r + (f.type === 'circle' ? 0 : f.pad) + COAST_CLEAR <= R + 0.05, `flat ${i} point ${x},${z}: r ${r.toFixed(2)} coast ${R.toFixed(2)}`);
      }
    }
  });

  test(`${name}: heightAt is below sea level outside the coast, land well inside`, () => {
    const h = makeHeightField(plan);
    const [cx, cz] = plan.coast.center;
    for (let a = 0; a < 360; a += 2) {
      const th = (a * Math.PI) / 180, R = h.coastR(th);
      for (const off of [0.05, 0.3, 1, 2, 4, 10]) {
        const y = h(cx + Math.cos(th) * (R + off), cz + Math.sin(th) * (R + off));
        assert.ok(y < SEA_LEVEL, `sea at ${a} deg, +${off}: ${y}`);
      }
    }
    assert.ok(h(cx, cz) > 0.3);
  });
}

test('flats outside the coast push the coastline out', () => {
  const plan = { seed: 1, radius: 3, coast: { center: [0, 0], radii: [3, 3, 3, 3, 3] }, flats: [field([[2, -1], [4, -1], [4, 1], [2, 1]], 0)] };
  const h = makeHeightField(plan);
  assert.ok(h.coastR(0) >= 4 + 0.3 + COAST_CLEAR - 0.05);
  assert.equal(h(4.2, 0.5), BASE_HEIGHT);
});

test('pond bowl is below its water level, hill and crag are raised, terrace shelf is at its level', () => {
  const h = makeHeightField(FIVE);
  const p = h.ponds[0];
  assert.ok(h(p.cx, p.cz) < h.pondLevel(p) - 0.1);
  assert.ok(h(-5.0, -3.4) > levelHeight(1) + 0.9, 'crag top');
  const o = makeHeightField(ODD);
  assert.ok(o(26, -15) > BASE_HEIGHT + 0.2, 'hill');
  assert.ok(Math.abs(o(30 + 2.8, -14) - levelHeight(2)) < 0.06, 'terrace shelf');
});

test('works with a bare plan (no terraces, flats or features) and an offset centre', () => {
  const h = makeHeightField({ seed: 2, radius: 4, coast: { center: [20, -10], radii: [4, 4.5, 4, 4.2] } });
  assert.ok(Math.abs(h(20, -10) - BASE_HEIGHT) < 0.06);
  assert.ok(h(30, -10) < SEA_LEVEL);
});

test('the same seed gives the same island, another seed a different one', () => {
  const a = makeHeightField(FIVE), b = makeHeightField(FIVE), c = makeHeightField({ ...FIVE, seed: 12 });
  assert.equal(a(5.1, 4.2), b(5.1, 4.2));
  assert.notEqual(a.coastR(1), c.coastR(1));
});
