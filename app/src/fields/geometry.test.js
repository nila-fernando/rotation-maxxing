import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  acresOf,
  formatAcres,
  labelPoint,
  bboxOf,
  mergeGeometries,
  splitGeometry,
  circleGeometry,
  isSimplePolygon,
  createSnapIndex,
  idsInLasso,
  compassWord,
  autoName,
  vertexPaths,
  midpointPaths,
  moveVertex,
  insertVertex,
  removeVertex,
} from './geometry.js';

// Local metric frame near lat 42: x metres east, y metres north of ORIGIN.
const M_PER_DEG = (6371008.8 * Math.PI) / 180;
const LAT0 = 42;
const LNG0 = -93;
const KX = M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180);
const P = (x, y) => [LNG0 + x / KX, LAT0 + y / M_PER_DEG];
const square = (x, y, w, h = w) => ({
  type: 'Polygon',
  coordinates: [[P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h), P(x, y)]],
});
const SQ400_ACRES = 160000 / 4046.8564224; // ~39.54

const near = (actual, expected, relTol, msg) =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * relTol, `${msg ?? ''} ${actual} !~ ${expected}`);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const ringsClosed = (g) =>
  (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).every((rings) =>
    rings.every((r) => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1])
  );
const frozen = (g) => JSON.stringify(g);

describe('measurement', () => {
  test('acresOf a 400 m square is ~39.5 ac', () => {
    near(acresOf(square(0, 0, 400)), SQ400_ACRES, 0.01);
  });

  test('acresOf subtracts holes and handles MultiPolygon', () => {
    const holed = { type: 'Polygon', coordinates: [square(0, 0, 400).coordinates[0], square(100, 100, 100).coordinates[0].slice().reverse()] };
    near(acresOf(holed), SQ400_ACRES * (15 / 16), 0.01);
    const multi = { type: 'MultiPolygon', coordinates: [square(0, 0, 400).coordinates, square(1000, 0, 400).coordinates] };
    near(acresOf(multi), 2 * SQ400_ACRES, 0.01);
  });

  test('formatAcres', () => {
    assert.equal(formatAcres(78.2), '78 ac');
    assert.equal(formatAcres(4.52), '4.5 ac');
    assert.equal(formatAcres(4), '4 ac');
    assert.equal(formatAcres(9.97), '10 ac');
    assert.equal(formatAcres(1240.4), '1,240 ac');
    assert.equal(formatAcres(0.3), '<1 ac');
    assert.equal(formatAcres(0.0001), '<1 ac');
    assert.equal(formatAcres(SQ400_ACRES), '40 ac');
  });

  test('bboxOf', () => {
    const b = bboxOf(square(0, 0, 400));
    const [w, s] = P(0, 0);
    const [e, n] = P(400, 400);
    assert.deepEqual(b.map((v) => +v.toFixed(9)), [w, s, e, n].map((v) => +v.toFixed(9)));
  });
});

describe('labelPoint', () => {
  test('square: centroid', () => {
    const lp = labelPoint(square(0, 0, 400));
    const c = P(200, 200);
    assert.ok(Math.abs(lp[0] - c[0]) < 1e-6 && Math.abs(lp[1] - c[1]) < 1e-6);
  });

  test('U shape: interior point when the centroid falls outside', () => {
    const u = {
      type: 'Polygon',
      coordinates: [[P(0, 0), P(300, 0), P(300, 300), P(200, 300), P(200, 50), P(100, 50), P(100, 300), P(0, 300), P(0, 0)]],
    };
    const lp = labelPoint(u);
    const split = splitGeometry(u, [P(-10, 20), P(310, 20)]); // sanity that the shape works elsewhere
    assert.ok(split.parts);
    // Inside means: inside one of the arms or the base strip.
    const x = (lp[0] - LNG0) * KX, y = (lp[1] - LAT0) * M_PER_DEG;
    const inside = (y > 0 && y < 50 && x > 0 && x < 300) || (y > 0 && y < 300 && ((x > 0 && x < 100) || (x > 200 && x < 300)));
    assert.ok(inside, `label point ${x},${y} not inside the U`);
  });

  test('MultiPolygon uses the largest part', () => {
    const multi = { type: 'MultiPolygon', coordinates: [square(0, 0, 50).coordinates, square(1000, 0, 400).coordinates] };
    const lp = labelPoint(multi);
    const x = (lp[0] - LNG0) * KX;
    assert.ok(x > 1000 && x < 1400);
  });
});

describe('mergeGeometries', () => {
  test('two squares sharing an edge merge into one polygon', () => {
    const a = square(0, 0, 400), b = square(400, 0, 400);
    const before = frozen(a) + frozen(b);
    const r = mergeGeometries(a, b);
    assert.equal(r.error, undefined);
    assert.equal(r.geometry.type, 'Polygon');
    near(acresOf(r.geometry), 2 * SQ400_ACRES, 0.005);
    assert.ok(isSimplePolygon(r.geometry));
    assert.equal(frozen(a) + frozen(b), before, 'inputs not mutated');
  });

  test('squares 1 m apart are joined by gap closing without noticeable growth', () => {
    const r = mergeGeometries(square(0, 0, 400), square(401, 0, 400));
    assert.equal(r.error, undefined);
    assert.equal(r.geometry.type, 'Polygon');
    assert.equal(r.geometry.coordinates.length, 1, 'no holes');
    const acres = acresOf(r.geometry);
    assert.ok(acres >= 2 * SQ400_ACRES * 0.999);
    assert.ok(acres <= 2 * SQ400_ACRES * 1.01);
    assert.ok(ringsClosed(r.geometry));
  });

  test('gap larger than gapMeters is refused', () => {
    assert.deepEqual(mergeGeometries(square(0, 0, 400), square(405, 0, 400)), { error: 'not-touching' });
    assert.deepEqual(mergeGeometries(square(0, 0, 400), square(401, 0, 400), { gapMeters: 0 }), { error: 'not-touching' });
  });

  test('far-apart squares are refused', () => {
    assert.deepEqual(mergeGeometries(square(0, 0, 400), square(1000, 0, 400)), { error: 'not-touching' });
  });

  test('invalid input', () => {
    assert.deepEqual(mergeGeometries(square(0, 0, 400), { type: 'Point', coordinates: [0, 0] }), { error: 'invalid' });
    assert.deepEqual(mergeGeometries(null, square(0, 0, 10)), { error: 'invalid' });
  });
});

describe('splitGeometry', () => {
  const field = square(0, 0, 400);

  test('straight line splits into two halves with matching total area', () => {
    const before = frozen(field);
    const r = splitGeometry(field, [P(200, -50), P(200, 450)]);
    assert.equal(r.error, undefined);
    assert.equal(r.parts.length, 2);
    for (const p of r.parts) {
      assert.equal(p.type, 'Polygon');
      assert.ok(isSimplePolygon(p));
      assert.ok(ringsClosed(p));
      near(acresOf(p), SQ400_ACRES / 2, 0.001);
    }
    near(sum(r.parts.map(acresOf)), acresOf(field), 1e-6);
    assert.equal(frozen(field), before, 'input not mutated');
  });

  test('accepts a LineString geometry too', () => {
    const r = splitGeometry(field, { type: 'LineString', coordinates: [P(-10, 100), P(410, 100)] });
    assert.equal(r.parts.length, 2);
  });

  test('zig-zag line splits into 3 parts', () => {
    const r = splitGeometry(field, [P(100, -50), P(200, 450), P(300, -50)]);
    assert.equal(r.error, undefined);
    assert.equal(r.parts.length, 3);
    near(sum(r.parts.map(acresOf)), acresOf(field), 1e-6);
  });

  test('line that does not cross, or only enters once', () => {
    assert.deepEqual(splitGeometry(field, [P(-50, -50), P(-50, 450)]), { error: 'no-cross' });
    assert.deepEqual(splitGeometry(field, [P(-50, 200), P(200, 200)]), { error: 'no-cross' });
  });

  test('sliver cuts are ignored', () => {
    // Clips a corner triangle of 5 m x 5 m (12.5 m², well under 0.05 ac).
    assert.deepEqual(splitGeometry(field, [P(-1, 394), P(6, 401)]), { error: 'no-cross' });
  });

  test('holes are kept in the part that contains them, or cut through', () => {
    const hole = square(50, 50, 50).coordinates[0].slice().reverse();
    const holed = { type: 'Polygon', coordinates: [field.coordinates[0], hole] };
    const r = splitGeometry(holed, [P(200, -50), P(200, 450)]);
    assert.equal(r.parts.length, 2);
    assert.deepEqual(r.parts.map((p) => p.coordinates.length).sort(), [1, 2]);
    near(sum(r.parts.map(acresOf)), acresOf(holed), 1e-6);

    const through = splitGeometry(holed, [P(75, -50), P(75, 450)]);
    assert.equal(through.parts.length, 2);
    near(sum(through.parts.map(acresOf)), acresOf(holed), 1e-6);
  });

  test('MultiPolygon: one part crossed is split, others kept; two crossed is refused', () => {
    const multi = { type: 'MultiPolygon', coordinates: [field.coordinates, square(1000, 0, 400).coordinates] };
    const one = splitGeometry(multi, [P(200, -50), P(200, 450)]);
    assert.equal(one.parts.length, 3);
    near(sum(one.parts.map(acresOf)), acresOf(multi), 1e-6);
    assert.deepEqual(splitGeometry(multi, [P(-50, 200), P(1450, 200)]), { error: 'multi' });
    assert.deepEqual(splitGeometry(multi, [P(600, -50), P(600, 450)]), { error: 'no-cross' });
  });

  test('invalid input', () => {
    assert.deepEqual(splitGeometry(field, [P(0, 0)]), { error: 'invalid' });
    assert.deepEqual(splitGeometry({ type: 'Point', coordinates: [0, 0] }, [P(0, 0), P(1, 1)]), { error: 'invalid' });
  });
});

describe('construction & validation', () => {
  test('circleGeometry', () => {
    const c = circleGeometry(P(0, 0), 400);
    assert.equal(c.type, 'Polygon');
    assert.equal(c.coordinates[0].length, 73);
    near(acresOf(c), (Math.PI * 400 * 400) / 4046.8564224, 0.01);
    assert.ok(isSimplePolygon(c));
    assert.equal(circleGeometry(P(0, 0), 100, 16).coordinates[0].length, 17);
  });

  test('isSimplePolygon', () => {
    assert.ok(isSimplePolygon(square(0, 0, 400)));
    const bowtie = { type: 'Polygon', coordinates: [[P(0, 0), P(100, 100), P(100, 0), P(0, 100), P(0, 0)]] };
    assert.equal(isSimplePolygon(bowtie), false);
    const twoDistinct = { type: 'Polygon', coordinates: [[P(0, 0), P(100, 0), P(0, 0), P(100, 0), P(0, 0)]] };
    assert.equal(isSimplePolygon(twoDistinct), false);
    const flat = { type: 'Polygon', coordinates: [[P(0, 0), P(50, 0), P(100, 0), P(0, 0)]] };
    assert.equal(isSimplePolygon(flat), false);
    assert.equal(isSimplePolygon({ type: 'Point', coordinates: [0, 0] }), false);
  });
});

describe('createSnapIndex', () => {
  const items = [
    { id: 'a', geometry: square(0, 0, 400) },
    { id: 'b', geometry: square(500, 0, 400) },
  ];
  const idx = createSnapIndex(items);

  test('snaps to a nearby vertex', () => {
    const r = idx.query(P(403, 404), 10);
    assert.equal(r.kind, 'vertex');
    assert.equal(r.id, 'a');
    assert.deepEqual(r.point, P(400, 400));
  });

  test('vertex within tolerance wins over a closer edge', () => {
    const r = idx.query(P(1, 8), 10); // 1 m from the west edge, ~8 m from the corner
    assert.equal(r.kind, 'vertex');
    assert.deepEqual(r.point, P(0, 0));
  });

  test('snaps to the closest point on an edge', () => {
    const r = idx.query(P(200, 403), 5);
    assert.equal(r.kind, 'edge');
    assert.equal(r.id, 'a');
    assert.ok(Math.abs((r.point[1] - LAT0) * M_PER_DEG - 400) < 0.01);
    assert.ok(Math.abs((r.point[0] - LNG0) * KX - 200) < 0.01);
  });

  test('nothing within tolerance; excludeId', () => {
    assert.equal(idx.query(P(450, 200), 10), null);
    const r = idx.query(P(403, 200), 5, { excludeId: 'a' });
    assert.equal(r, null);
    const r2 = idx.query(P(497, 200), 5, { excludeId: 'a' });
    assert.equal(r2.id, 'b');
  });

  test('empty index and thousands of items', () => {
    assert.equal(createSnapIndex([]).query(P(0, 0), 10), null);
    const many = [];
    for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) many.push({ id: `${i}-${j}`, geometry: square(i * 100, j * 100, 90) });
    const big = createSnapIndex(many);
    const t0 = performance.now();
    let r;
    for (let k = 0; k < 1000; k++) r = big.query(P(3091, 2050), 3);
    assert.ok(performance.now() - t0 < 1000);
    assert.equal(r.kind, 'edge');
    assert.equal(r.id, '30-20');
  });
});

describe('idsInLasso', () => {
  test('selects items whose label point is inside the ring', () => {
    const items = [
      { id: 'a', geometry: square(0, 0, 100) },
      { id: 'b', geometry: square(200, 0, 100) },
      { id: 'c', geometry: square(1000, 1000, 100) },
    ];
    // Covers the centre of a (50,50) and b (250,50) but not c; open ring.
    const lasso = [P(-10, -10), P(320, -10), P(320, 70), P(-10, 70)];
    assert.deepEqual(idsInLasso(lasso, items).sort(), ['a', 'b']);
    // Covers only part of a, not its label point.
    assert.deepEqual(idsInLasso([P(-10, -10), P(30, -10), P(30, 30), P(-10, 30), P(-10, -10)], items), []);
    assert.deepEqual(idsInLasso([P(0, 0), P(1, 1)], items), []);
  });
});

describe('naming', () => {
  const center = P(0, 0);
  test('compassWord', () => {
    assert.equal(compassWord(P(0, 1000), center), 'North');
    assert.equal(compassWord(P(1000, 1000), center), 'North-east');
    assert.equal(compassWord(P(1000, 0), center), 'East');
    assert.equal(compassWord(P(1000, -1000), center), 'South-east');
    assert.equal(compassWord(P(0, -1000), center), 'South');
    assert.equal(compassWord(P(-1000, -1000), center), 'South-west');
    assert.equal(compassWord(P(-1000, 0), center), 'West');
    assert.equal(compassWord(P(-1000, 1000), center), 'North-west');
    assert.equal(compassWord(P(100, 100), center), 'Middle');
    assert.equal(compassWord(P(0, 160), center), 'North');
  });

  test('autoName with collisions', () => {
    assert.equal(autoName(P(0, 1000), center, []), 'North field');
    assert.equal(autoName(P(0, 1000), center, ['North field']), 'North field 2');
    assert.equal(autoName(P(0, 1000), center, ['north field', 'North field 2']), 'North field 3');
    assert.equal(autoName(P(10, 10), center, ['North field']), 'Home field');
    assert.equal(autoName(P(10, 10), center, new Set(['Home field'])), 'Home field 2');
  });
});

describe('vertex editing', () => {
  const sq = square(0, 0, 100);
  const multi = { type: 'MultiPolygon', coordinates: [square(0, 0, 100).coordinates, square(500, 0, 100).coordinates] };

  test('vertexPaths skips closing duplicates', () => {
    const v = vertexPaths(sq);
    assert.equal(v.length, 4);
    assert.deepEqual(v[0], { path: { part: 0, ring: 0, index: 0 }, point: P(0, 0) });
    const vm = vertexPaths(multi);
    assert.equal(vm.length, 8);
    assert.deepEqual(vm[5].path, { part: 1, ring: 0, index: 1 });
  });

  test('midpointPaths', () => {
    const m = midpointPaths(sq);
    assert.equal(m.length, 4);
    assert.deepEqual(m[0].path, { part: 0, ring: 0, index: 0 });
    const [x, y] = [(m[0].point[0] - LNG0) * KX, (m[0].point[1] - LAT0) * M_PER_DEG];
    assert.ok(Math.abs(x - 50) < 1e-6 && Math.abs(y) < 1e-6);
  });

  test('moveVertex keeps the ring closed and does not mutate', () => {
    const before = frozen(sq);
    const g = moveVertex(sq, { part: 0, ring: 0, index: 0 }, P(-10, -10));
    assert.deepEqual(g.coordinates[0][0], P(-10, -10));
    assert.deepEqual(g.coordinates[0][4], P(-10, -10));
    assert.ok(ringsClosed(g));
    assert.equal(frozen(sq), before);
    const g2 = moveVertex(multi, { part: 1, ring: 0, index: 2 }, P(650, 150));
    assert.deepEqual(g2.coordinates[1][0][2], P(650, 150));
    assert.ok(ringsClosed(g2));
  });

  test('insertVertex after path.index', () => {
    const mid = midpointPaths(sq)[3]; // last edge, before the closing vertex
    const g = insertVertex(sq, mid.path, mid.point);
    assert.equal(g.coordinates[0].length, 6);
    assert.deepEqual(g.coordinates[0][4], mid.point);
    assert.ok(ringsClosed(g));
    near(acresOf(g), acresOf(sq), 1e-9);
    const g0 = insertVertex(sq, { part: 0, ring: 0, index: 0 }, P(50, -20));
    assert.deepEqual(g0.coordinates[0][1], P(50, -20));
    assert.equal(sq.coordinates[0].length, 5);
  });

  test('removeVertex keeps rings closed and refuses a triangle', () => {
    const g = removeVertex(sq, { part: 0, ring: 0, index: 0 });
    assert.equal(g.coordinates[0].length, 4);
    assert.ok(ringsClosed(g));
    assert.deepEqual(g.coordinates[0][0], P(100, 0));
    assert.equal(sq.coordinates[0].length, 5);
    assert.equal(removeVertex(g, { part: 0, ring: 0, index: 1 }), null);
    const g2 = removeVertex(sq, { part: 0, ring: 0, index: 2 });
    assert.equal(g2.coordinates[0].length, 4);
    assert.ok(isSimplePolygon(g2));
  });
});
