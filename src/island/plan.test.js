import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planIsland, PLAN, coastRadiusAt, insideCoast, coastRing } from './plan.js';
import { pointInRing } from './layout.js';

const demo = JSON.parse(readFileSync(new URL('../../data/demo-farm.json', import.meta.url), 'utf8'));
const lastCrop = (f) => (f.cropHistory && f.cropHistory.length ? f.cropHistory[f.cropHistory.length - 1].crop : null);
const demoFields = demo.fields.map((f) => ({ id: f.id, name: f.name, geometry: f.geometry, elevationM: f.elevationM, crop: lastCrop(f) }));
const HOME = demo.farm.center;
const SEED = demo.farm.name;

// ---------------------------------------------------------------------------
// Helpers

const M_PER_DEG = (Math.PI / 180) * 6371008.8;

function shiftGeometry(g, east, north) {
  const lat = 42;
  const dLng = east / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  const dLat = north / M_PER_DEG;
  const mv = (rings) => rings.map((r) => r.map(([x, y]) => [x + dLng, y + dLat]));
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: mv(g.coordinates) } : { type: 'MultiPolygon', coordinates: g.coordinates.map(mv) };
}

/** 15 fields: the 5 demo fields plus two copies about 3 km away (north-east and south-west). */
function fifteenFields() {
  const copies = [[0, 0, ''], [3000, 3000, 'b'], [-3000, -3000, 'c']];
  return copies.flatMap(([e, n, tag]) => demoFields.map((f) => ({ ...f, id: f.id + tag, geometry: shiftGeometry(f.geometry, e, n) })));
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Distance from a point to a ring's edge (open or closed ring). */
function ringEdgeDist(p, ring) {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, segDist(p, ring[j], ring[i]));
  return d;
}

/** Distance between two rings; 0 when they cross or one holds the other. */
function ringDist(A, B) {
  for (let i = 0, j = A.length - 1; i < A.length; j = i++) {
    for (let k = 0, l = B.length - 1; k < B.length; l = k++) if (segsCross(A[j], A[i], B[l], B[k])) return 0;
  }
  if (pointInRing(A[0], B) || pointInRing(B[0], A)) return 0;
  let d = Infinity;
  for (const p of A) d = Math.min(d, ringEdgeDist(p, B));
  for (const p of B) d = Math.min(d, ringEdgeDist(p, A));
  return d;
}

const outers = (f) => f.polygons.map((rings) => rings[0]);
const fieldDist = (a, b) => Math.min(...outers(a).flatMap((ra) => outers(b).map((rb) => ringDist(ra, rb))));
/** Signed distance from a point to a field: negative inside. */
function pointFieldDist(p, f) {
  let d = Infinity, inside = false;
  for (const r of outers(f)) {
    d = Math.min(d, ringEdgeDist(p, r));
    if (pointInRing(p, r)) inside = true;
  }
  return inside ? -d : d;
}

/** Wanted walkway between two plan fields, in units. */
const wanted = (plan, a, b) => plan.walk + PLAN.walkPerLevel * Math.abs(a.level - b.level);

/** Everything a plan must satisfy, for any input. */
function checkPlan(plan, input) {
  const n = input.length;
  assert.equal(plan.fields.length, n);
  assert.deepEqual(plan.fields.map((f) => f.id), input.map((f) => f.id));

  // Scale: s = radiusUnits / layout.radiusM, toScene centres the layout on (0, 0).
  const km2 = plan.layout.totalAreaM2 / 1e6;
  const ru = Math.max(5.5, Math.min(11, 4.5 + 2.4 * Math.sqrt(km2)));
  assert.ok(Math.abs(plan.radiusUnits - ru) / ru < 0.02, `radiusUnits ${plan.radiusUnits} vs ${ru}`);
  assert.ok(Math.abs(plan.s - plan.radiusUnits / plan.layout.radiusM) < 1e-12);
  assert.deepEqual(plan.toScene(plan.layout.center).map((v) => Math.abs(v) < 1e-9), [true, true]);
  const [px, pz] = plan.toScene([plan.layout.center[0] + 100, plan.layout.center[1] + 200]);
  assert.ok(Math.abs(px - 100 * plan.s) < 1e-9 && Math.abs(pz + 200 * plan.s) < 1e-9, 'x east, z south');

  // Fields: real shapes at island positions (area in units^2 matches the metres area).
  for (const [i, f] of plan.fields.entries()) {
    const lf = plan.layout.fields[i];
    assert.ok(Math.abs(f.areaUnits - lf.areaM2 * plan.s * plan.s) < 1e-9);
    assert.ok([0, 1, 2].includes(f.level));
    const p0 = lf.polygons[0][0][0];
    const q0 = plan.toScene([p0[0] + lf.offset[0], p0[1] + lf.offset[1]]);
    assert.ok(Math.hypot(q0[0] - f.polygons[0][0][0][0], q0[1] - f.polygons[0][0][0][1]) < 1e-9, 'polygons are the layout shapes');
    assert.ok(f.centroid.every(Number.isFinite) && f.labelAt.every(Number.isFinite));
    if (lf.label) {
      assert.equal(f.label, lf.label.text);
      const at = plan.toScene(lf.label.at);
      assert.ok(Math.hypot(at[0] - f.labelAt[0], at[1] - f.labelAt[1]) < 1e-9);
    } else assert.equal(f.label, null);
  }

  // Packed: every field within ~2 walkways of a neighbour, and all of them chained together
  // that way (nothing left far away; the farmyard kept beside the home field counts as a link).
  // No overlaps: every pair at least half a walkway apart.
  if (n > 1) {
    const D = plan.fields.map((a) => plan.fields.map((b) => (a === b ? 0 : fieldDist(a, b))));
    const near = (i, j) => D[i][j] <= 2 * wanted(plan, plan.fields[i], plan.fields[j]);
    // The farmyard kept beside the home field counts as a neighbour too.
    const yard = plan.farmstead.yard;
    const yardNear = (j) => pointFieldDist(yard.at, plan.fields[j]) - yard.r <= 2 * (plan.walk + 2 * PLAN.walkPerLevel);
    for (let i = 0; i < n; i++) {
      const ok = yardNear(i) || plan.fields.some((_, j) => j !== i && near(i, j));
      assert.ok(ok, `${plan.fields[i].id} is not close to any other field`);
      for (let j = i + 1; j < n; j++) {
        assert.ok(D[i][j] > 0.5 * plan.walk, `${plan.fields[i].id} and ${plan.fields[j].id} are ${D[i][j].toFixed(3)} apart`);
      }
    }
    // Graph nodes: the fields (0..n-1) and the farmyard (n).
    const linked = (i, j) => (i === n ? yardNear(j) : j === n ? yardNear(i) : near(i, j));
    const seen = new Set([0]), stack = [0];
    while (stack.length) {
      const i = stack.pop();
      for (let j = 0; j <= n; j++) if (!seen.has(j) && linked(i, j)) { seen.add(j); stack.push(j); }
    }
    seen.delete(n);
    assert.equal(seen.size, n, 'all fields chain together');
    // The same in metres, against the layout's own gaps (gapM, wider between levels).
    const gapMBetween = (i, j) => (plan.gapM * wanted(plan, plan.fields[i], plan.fields[j])) / plan.walk;
    const yardM = plan.layout.yard;
    for (let i = 0; i < n; i++) {
      const f = plan.layout.fields[i];
      const ringsM = f.polygons.map((rings) => rings[0].map(([x, y]) => [x + f.offset[0], y + f.offset[1]]));
      let ok = Math.min(...ringsM.map((r) => ringEdgeDist(yardM.center, r))) - yardM.radiusM <= 2 * (plan.gapM + 2 * PLAN.walkPerLevel / plan.walk * plan.gapM);
      for (let j = 0; j < n && !ok; j++) if (j !== i && D[i][j] / plan.s <= 2 * gapMBetween(i, j)) ok = true;
      assert.ok(ok, `${f.id} is more than two gaps (metres) from every neighbour`);
    }
  }

  // Farmstead: beside the home field (its nearest field), flat, clear of every field.
  const home = plan.fields.find((f) => f.id === plan.homeId);
  assert.ok(home && home.home);
  const fs = plan.farmstead;
  assert.equal(fs.r, 1.0);
  assert.equal(fs.level, home.level);
  assert.ok(Number.isFinite(fs.facing));
  assert.ok(Math.hypot(fs.at[0] - fs.yard.at[0], fs.at[1] - fs.yard.at[1]) + fs.r <= fs.yard.r + 0.05, 'farmstead inside its yard');
  const farmGaps = plan.fields.map((f) => pointFieldDist(fs.at, f) - fs.r);
  for (const [i, g] of farmGaps.entries()) assert.ok(g >= PLAN.fieldPad + 0.1, `farmstead overlaps ${plan.fields[i].id} (${g.toFixed(2)})`);
  const homeGap = pointFieldDist(fs.at, home) - fs.r;
  assert.ok(homeGap < 0.8, `farmstead is ${homeGap.toFixed(2)} from the home field`);
  assert.ok(homeGap <= Math.min(...farmGaps) + 1e-9, 'the home field is the nearest field');
  // facing points the barn's +z front at the home field (rotation.y convention).
  const ahead = [fs.at[0] + Math.sin(fs.facing) * (fs.r + homeGap + 0.05), fs.at[1] + Math.cos(fs.facing) * (fs.r + homeGap + 0.05)];
  assert.ok(pointFieldDist(ahead, home) < 0.1, 'facing points at the home field');

  // Slots: 6-10 buildings + vehicles, some trees; unique ids; clear of fields, the farmstead and
  // each other. Features clear of everything too.
  const bv = plan.slots.filter((s) => s.kind !== 'tree');
  assert.ok(bv.length >= 6 && bv.length <= 10, `${bv.length} building/vehicle slots`);
  assert.ok(plan.slots.filter((s) => s.kind === 'tree').length >= 3);
  assert.equal(new Set(plan.slots.map((s) => s.id)).size, plan.slots.length);
  const pads = [{ id: 'farmstead', at: fs.at, r: fs.r }, ...plan.slots];
  for (const p of plan.slots) {
    assert.ok(['building', 'vehicle', 'tree'].includes(p.kind));
    assert.ok(p.r > 0 && [0, 1, 2].includes(p.level));
    for (const f of plan.fields) assert.ok(pointFieldDist(p.at, f) - p.r >= 0.15, `${p.id} overlaps ${f.id}`);
  }
  for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
    const d = Math.hypot(pads[i].at[0] - pads[j].at[0], pads[i].at[1] - pads[j].at[1]) - pads[i].r - pads[j].r;
    assert.ok(d >= 0.1, `${pads[i].id} and ${pads[j].id} overlap`);
  }
  assert.ok(plan.features.length <= 2);
  for (const ft of plan.features) {
    assert.ok(['crag', 'hill', 'pond'].includes(ft.type));
    for (const f of plan.fields) assert.ok(pointFieldDist(ft.at, f) - ft.r >= 0.3, `${ft.type} under ${f.id}`);
    for (const p of pads) assert.ok(Math.hypot(ft.at[0] - p.at[0], ft.at[1] - p.at[1]) - ft.r - p.r >= 0.2, `${ft.type} under ${p.id}`);
  }

  // Coast: 96 radii around (0, 0), everything inside with a beach margin.
  assert.deepEqual(plan.coast.center, [0, 0]);
  assert.equal(plan.coast.radii.length, 96);
  assert.ok(plan.coast.radii.every((r) => Number.isFinite(r) && r > 0));
  assert.equal(plan.radius, Math.max(...plan.coast.radii));
  for (const f of plan.fields) for (const r of outers(f)) for (const p of r) assert.ok(insideCoast(plan.coast, p[0], p[1], 1.15), `${f.id} too near the water`);
  for (const p of pads) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    assert.ok(insideCoast(plan.coast, p.at[0] + p.r * Math.cos(a), p.at[1] + p.r * Math.sin(a), 0.5), `${p.id} too near the water`);
  }
  for (const ft of plan.features) assert.ok(insideCoast(plan.coast, ft.at[0], ft.at[1], ft.r), `${ft.type} in the sea`);
  for (const t of plan.terraces) for (const p of t.polygon) assert.ok(insideCoast(plan.coast, p[0], p[1], 0.5));

  // Terraces: lift exactly the raised fields.
  for (const t of plan.terraces) {
    assert.ok(t.level === 1 || t.level === 2);
    assert.equal(t.height, undefined, 'the terrain gives each level its shelf height');
    assert.ok(t.polygon.length >= 3);
  }
  // (A vertex may sit a hair outside its shelf: the field's own flat keeps it level there.)
  const TOL = 0.1;
  for (const f of plan.fields) for (const r of outers(f)) for (const p of r) {
    const top = plan.terraces.reduce((m, t) => (pointInRing(p, t.polygon) ? Math.max(m, t.level) : m), 0);
    if (top === f.level) continue;
    const edge = Math.min(...plan.terraces.map((t) => ringEdgeDist(p, t.polygon)));
    assert.ok(edge < TOL, `${f.id} vertex on terrace level ${top}, field level ${f.level} (${edge.toFixed(3)} from an edge)`);
  }
  // Each raised field's middle is on its own shelf.
  for (const f of plan.fields) if (f.level > 0) {
    const top = plan.terraces.reduce((m, t) => (pointInRing(f.centroid, t.polygon) ? Math.max(m, t.level) : m), 0);
    if (pointFieldDist(f.centroid, f) < 0) assert.equal(top, f.level, `${f.id} centre`);
  }

  // Flats: every field outline, the farmstead, the farmyard (when the farmstead sits in it) and every slot.
  const polyFlats = plan.flats.filter((x) => x.type === 'polygon');
  assert.equal(polyFlats.length, plan.fields.reduce((a, f) => a + f.polygons.length, 0));
  for (const x of polyFlats) assert.equal(x.pad, 0.15);
  const circleFlats = plan.flats.filter((x) => x.type === 'circle');
  const yardFlats = circleFlats.filter((x) => x.id === 'yard');
  assert.ok(yardFlats.length <= 1);
  assert.equal(circleFlats.length, 1 + yardFlats.length + plan.slots.length);
  for (const sl of plan.flats.filter((x) => plan.slots.some((s2) => s2.id === x.id))) assert.equal(sl.quiet, true, 'upgrade pads are quiet');
  for (const x of circleFlats) assert.ok(Number.isFinite(x.x) && Number.isFinite(x.z) && x.r > 0 && x.pad >= 0 && [0, 1, 2].includes(x.level));
}

/** Plan as plain data, for comparing runs. */
const data = (p) => JSON.stringify({ ...p, layout: { fields: p.layout.fields, outline: p.layout.outline }, toScene: null });

// ---------------------------------------------------------------------------

describe('planIsland: one field', () => {
  const input = [demoFields[0]];
  const plan = planIsland(input, { seed: SEED, home: HOME });

  test('a full, valid plan', () => checkPlan(plan, input));

  test('one field on level 0, no terraces, no label, the farmstead beside it', () => {
    assert.equal(plan.fields[0].level, 0);
    assert.equal(plan.terraces.length, 0);
    assert.equal(plan.fields[0].label, null);
    assert.equal(plan.homeId, 'f1');
  });

  test('the island is about radiusUnits across', () => {
    assert.ok(plan.radius > plan.radiusUnits - 1 && plan.radius < plan.radiusUnits + 4, `${plan.radius} vs ${plan.radiusUnits}`);
  });
});

describe('planIsland: the 5 demo fields', () => {
  const plan = planIsland(demoFields, { seed: SEED, home: HOME });
  const byId = Object.fromEntries(plan.fields.map((f) => [f.id, f]));

  test('a full, valid plan (packed, no overlaps, pads clear, all inside the coast)', () => checkPlan(plan, demoFields));

  test('deterministic for a seed', () => {
    const again = planIsland(demoFields, { seed: SEED, home: HOME });
    assert.equal(data(again), data(plan));
  });

  test('another seed gives another island (same real field shapes)', () => {
    const other = planIsland(demoFields, { seed: 'Another Farm', home: HOME });
    assert.notDeepEqual(other.coast.radii, plan.coast.radii);
    other.layout.fields.forEach((f, i) => assert.ok(Math.abs(f.areaM2 / plan.layout.fields[i].areaM2 - 1) < 1e-5));
    checkPlan(other, demoFields);
  });

  test('levels by contour steps of real elevation (297 | 302 | 308, 309, 311 in bands of ~4.7 m)', () => {
    // f1 308, f2 309, f3 302, f4 311, f5 297: range 14 m in three equal bands
    assert.deepEqual(['f1', 'f2', 'f3', 'f4', 'f5'].map((id) => byId[id].level), [2, 2, 1, 2, 0]);
    assert.ok(plan.terraces.some((t) => t.level === 1) && plan.terraces.some((t) => t.level === 2));
  });

  test('f5 (3.5 miles away) is labelled; the others are not', () => {
    assert.match(byId.f5.label, /^3\.[0-9] mi (east|south-east)$/);
    for (const id of ['f1', 'f2', 'f3', 'f4']) assert.equal(byId[id].label, null);
  });

  test('the home field is f1 (it holds the pin) and the farmstead sits beside it', () => {
    assert.equal(plan.homeId, 'f1');
    assert.ok(byId.f1.home);
    assert.equal(plan.farmstead.homeId, 'f1');
  });

  test('north stays north: f3 (North draw) is north of f4 (South 40)', () => {
    assert.ok(byId.f3.centroid[1] < byId.f4.centroid[1]); // z is south
  });

  test('coast helpers', () => {
    const ring = coastRing(plan.coast, 96);
    assert.equal(ring.length, 96);
    assert.ok(Math.abs(Math.hypot(...ring[0]) - plan.coast.radii[0]) < 1e-9);
    assert.ok(Math.abs(coastRadiusAt(plan.coast, Math.PI * 2) - plan.coast.radii[0]) < 1e-9);
  });

  test('no home pin: the largest field is home', () => {
    const p = planIsland(demoFields, { seed: SEED });
    assert.equal(p.homeId, 'f2'); // 140 acres
    checkPlan(p, demoFields);
  });

  test('no elevations: everything on level 0, no terraces', () => {
    const input = demoFields.map((f) => ({ ...f, elevationM: null }));
    const p = planIsland(input, { seed: 7, home: HOME });
    assert.ok(p.fields.every((f) => f.level === 0));
    assert.equal(p.terraces.length, 0);
    checkPlan(p, input);
  });

  test('seeded only: never calls Math.random', () => {
    const orig = Math.random;
    Math.random = () => { throw new Error('Math.random used'); };
    try { planIsland(demoFields, { seed: 42, home: HOME }); } finally { Math.random = orig; }
  });
});

describe('planIsland: 15 fields (demo fields copied twice ~3 km away)', () => {
  const input = fifteenFields();
  const plan = planIsland(input, { seed: SEED, home: HOME });

  test('a full, valid plan (packed, no overlaps, pads clear, all inside the coast)', () => checkPlan(plan, input));

  test('far groups are labelled', () => {
    const labelled = plan.fields.filter((f) => f.label);
    assert.ok(labelled.length >= 3);
    for (const f of labelled) assert.match(f.label, /^\d+\.\d mi [a-z-]+$/);
  });

  test('the island grows with the farm', () => {
    const p1 = planIsland([demoFields[0]], { seed: SEED, home: HOME });
    const p5 = planIsland(demoFields, { seed: SEED, home: HOME });
    assert.ok(p1.radiusUnits < p5.radiusUnits && p5.radiusUnits < plan.radiusUnits);
    assert.ok(p5.radius < plan.radius, `${p5.radius} < ${plan.radius}`);
  });

  // About 40-60 ms on its own; the limit leaves room for the test files running alongside it
  // (node:test runs files in parallel, and the planner's end-to-end test keeps the CPU busy)
  test('fast: under 250 ms', () => {
    planIsland(input, { seed: 'warm up', home: HOME }); // let the JIT settle
    planIsland(input, { seed: 'warm up 2', home: HOME });
    const t0 = performance.now();
    planIsland(input, { seed: 'timed', home: HOME });
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `took ${ms.toFixed(0)} ms`);
  });
});

describe('planIsland: edge cases', () => {
  test('no fields is an error', () => {
    assert.throws(() => planIsland([]));
  });

  test('MultiPolygon field', () => {
    const a = demoFields[0].geometry.coordinates;
    const b = shiftGeometry(demoFields[3].geometry, 0, -200).coordinates;
    const input = [{ id: 'm', geometry: { type: 'MultiPolygon', coordinates: [a, b] }, elevationM: 300 }, demoFields[2]];
    const p = planIsland(input, { seed: 'multi' });
    assert.equal(p.fields[0].polygons.length, 2);
    assert.equal(p.flats.filter((x) => x.type === 'polygon').length, 3);
  });
});
