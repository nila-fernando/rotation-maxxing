import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as turf from '@turf/turf';
import { layoutIsland, pointInRing } from './layout.js';

const demo = JSON.parse(readFileSync(new URL('../../data/demo-farm.json', import.meta.url), 'utf8'));
const demoFields = demo.fields.map((f) => ({ id: f.id, geometry: f.geometry, elevationM: f.elevationM }));

// ---------------------------------------------------------------------------
// Helpers

const M_PER_DEG = (Math.PI / 180) * 6371008.8;

/** Shift a lng/lat geometry by metres east / north. */
function shiftGeometry(g, east, north) {
  const lat = 42; // one fixed latitude so every field of a copy moves by exactly the same amount
  const dLng = east / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  const dLat = north / M_PER_DEG;
  const mv = (rings) => rings.map((r) => r.map(([x, y]) => [x + dLng, y + dLat]));
  return g.type === 'Polygon'
    ? { type: 'Polygon', coordinates: mv(g.coordinates) }
    : { type: 'MultiPolygon', coordinates: g.coordinates.map(mv) };
}

/** 15 fields: the 5 demo fields plus two copies about 3 km away (north-east and south-west). */
function fifteenFields() {
  const copies = [[0, 0, ''], [3000, 3000, 'b'], [-3000, -3000, 'c']];
  return copies.flatMap(([e, n, tag]) =>
    demoFields.map((f) => ({ ...f, id: f.id + tag, geometry: shiftGeometry(f.geometry, e, n) })));
}

/** A field's outer rings at their island positions (or at their real positions). */
const islandRings = (f, real = false) =>
  f.polygons.map((rings) => rings[0].map(([x, y]) => (real ? [x, y] : [x + f.offset[0], y + f.offset[1]])));

function shoelace(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/** Overlap area (m^2) between two placed fields, computed in the flat metre plane. */
function overlapArea(a, b, real = false) {
  const pa = turf.multiPolygon(islandRings(a, real).map((r) => [r]));
  const pb = turf.multiPolygon(islandRings(b, real).map((r) => [r]));
  const hit = turf.intersect(turf.featureCollection([pa, pb]));
  if (!hit) return 0;
  const parts = hit.geometry.type === 'Polygon' ? [hit.geometry.coordinates] : hit.geometry.coordinates;
  return parts.reduce((s, rings) => s + Math.abs(shoelace(rings[0])), 0);
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

/** Smallest distance from any point of the rings to the outline edge. */
function minDistToOutline(rings, outline) {
  let best = Infinity;
  for (const r of rings) for (const p of r) for (let i = 1; i < outline.length; i++) best = Math.min(best, segDist(p, outline[i - 1], outline[i]));
  return best;
}

/**
 * No two placed fields overlap. With `allowReal`, slivers that already overlap in the real input
 * (hand-drawn neighbours a metre or two over each other's edge) are allowed to stay.
 */
function assertNoOverlaps(result, allowReal = false) {
  const fs = result.fields;
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const a = overlapArea(fs[i], fs[j]);
      const allowed = allowReal ? overlapArea(fs[i], fs[j], true) + 1 : 1;
      assert.ok(a < allowed, `${fs[i].id} and ${fs[j].id} overlap by ${a.toFixed(1)} m^2`);
    }
  }
}

function assertInsideOutline(result) {
  for (const f of result.fields) {
    for (const r of islandRings(f)) for (const p of r) assert.ok(pointInRing(p, result.outline), `${f.id} point outside outline`);
  }
}

function assertOneClosedRing(outline) {
  assert.ok(Array.isArray(outline) && outline.length >= 8);
  assert.ok(outline.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])));
  assert.deepEqual(outline[0], outline[outline.length - 1], 'ring is closed');
  assert.ok(shoelace(outline) > 0, 'ring is counter-clockwise');
}

/** No sharp spikes: every corner of the smoothed outline turns by less than 60 degrees. */
function assertSmooth(outline) {
  const r = outline.slice(0, -1);
  for (let i = 0; i < r.length; i++) {
    const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let turn = Math.abs(t2 - t1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    assert.ok(turn < Math.PI / 3, `sharp corner of ${((turn * 180) / Math.PI).toFixed(0)} deg at ${i}`);
  }
}

const byId = (r) => Object.fromEntries(r.fields.map((f) => [f.id, f]));
const islandCentroid = (f) => [f.centroid[0] + f.offset[0], f.centroid[1] + f.offset[1]];

// ---------------------------------------------------------------------------

describe('layoutIsland: one field', () => {
  const r = layoutIsland([demoFields[0]]);
  const f = r.fields[0];

  test('stays put with zero offset and no label', () => {
    assert.deepEqual(f.offset, [0, 0]);
    assert.equal(f.label, null);
    assert.equal(f.heightM, 0); // the only field is the lowest one
  });

  test('origin is the field centroid, so it sits at about (0, 0)', () => {
    assert.ok(Math.hypot(f.centroid[0], f.centroid[1]) < 1);
    const c = turf.centroid(demoFields[0].geometry).geometry.coordinates;
    assert.ok(Math.abs(r.origin[0] - c[0]) < 0.01 && Math.abs(r.origin[1] - c[1]) < 0.01);
  });

  test('project maps lng/lat to metres east / north of the origin', () => {
    assert.deepEqual(r.project(r.origin).map((v) => Math.round(v)), [0, 0]);
    const [x, y] = r.project([r.origin[0] + 0.01, r.origin[1] + 0.01]);
    assert.ok(Math.abs(x - 0.01 * M_PER_DEG * Math.cos((r.origin[1] * Math.PI) / 180)) < 0.5);
    assert.ok(Math.abs(y - 0.01 * M_PER_DEG) < 0.5);
  });

  test('polygons keep the real shape in metres (area matches turf)', () => {
    assert.ok(Math.abs(f.areaM2 - turf.area(demoFields[0].geometry)) / f.areaM2 < 0.005);
    assert.deepEqual(f.polygons[0][0][0], f.polygons[0][0][f.polygons[0][0].length - 1], 'rings closed');
  });

  test('outline is one smooth ring with roughly marginM of grass all round', () => {
    assertOneClosedRing(r.outline);
    assertSmooth(r.outline);
    assertInsideOutline(r);
    const expected = Math.min(150, Math.max(25, 0.08 * Math.sqrt(f.areaM2)));
    assert.ok(Math.abs(r.marginM - expected) < 1e-9);
    const d = minDistToOutline(f.polygons.map((p) => p[0]), r.outline);
    assert.ok(d > 0.85 * r.marginM && d < 1.15 * r.marginM, `edge gap ${d.toFixed(1)} vs margin ${r.marginM.toFixed(1)}`);
  });

  test('bounds, center and radius describe the outline', () => {
    const { minX, minY, maxX, maxY } = r.bounds;
    for (const [x, y] of r.outline) assert.ok(x >= minX && x <= maxX && y >= minY && y <= maxY);
    assert.deepEqual(r.center, [(minX + maxX) / 2, (minY + maxY) / 2]);
    assert.ok(r.radiusM >= (maxX - minX) / 2 && r.radiusM <= Math.hypot(maxX - minX, maxY - minY) / 2 + 1e-6);
  });

  test('an explicit marginM is used', () => {
    const r2 = layoutIsland([demoFields[0]], { marginM: 60 });
    const d = minDistToOutline(r2.fields[0].polygons.map((p) => p[0]), r2.outline);
    assert.ok(d > 50 && d < 70, `edge gap ${d.toFixed(1)}`);
  });
});

describe('layoutIsland: the 5 demo fields', () => {
  const r = layoutIsland(demoFields);
  const f = byId(r);

  test('f1-f4 (the home group) keep their real positions', () => {
    for (const id of ['f1', 'f2', 'f3', 'f4']) {
      assert.deepEqual(f[id].offset, [0, 0], id);
      assert.equal(f[id].label, null, id);
    }
  });

  test('f5 is pulled in from ~5.8 km away to sit next to them', () => {
    const before = Math.hypot(f.f5.centroid[0] - f.f1.centroid[0], f.f5.centroid[1] - f.f1.centroid[1]);
    const after = Math.hypot(islandCentroid(f.f5)[0] - f.f1.centroid[0], islandCentroid(f.f5)[1] - f.f1.centroid[1]);
    assert.ok(before > 5000);
    assert.ok(after < 1200, `f5 is still ${after.toFixed(0)} m from f1`);
    // It slides straight in: the offset points back the way it came.
    const [dx, dy] = f.f5.offset;
    assert.ok(dx < 0 && dy > 0);
  });

  test('f5 ends up a small path-width gap from its nearest neighbour', () => {
    let gap = Infinity;
    const p5 = islandRings(f.f5);
    for (const id of ['f1', 'f2', 'f3', 'f4']) {
      for (const ring of islandRings(f[id])) gap = Math.min(gap, minDistToOutline(p5, [...ring, ring[0]]));
    }
    assert.ok(gap >= 12 - 2.5 && gap < 30, `gap ${gap.toFixed(1)} m`);
  });

  test('f5 gets a label with the real distance and direction', () => {
    const lab = f.f5.label;
    assert.ok(lab, 'label present');
    // Real centre-to-centre distance to the nearest home field, from the raw lng/lat.
    const c5 = turf.centroid(demoFields[4].geometry);
    const nearestM = Math.min(...demoFields.slice(0, 4).map((g) => turf.distance(c5, turf.centroid(g.geometry), { units: 'meters' })));
    const miles = (nearestM / 1609.344).toFixed(1);
    // Direction: from the home group's centre to f5 (east and somewhat south).
    const east = f.f5.centroid[0] - (f.f1.centroid[0] + f.f2.centroid[0] + f.f3.centroid[0] + f.f4.centroid[0]) / 4;
    const north = f.f5.centroid[1] - (f.f1.centroid[1] + f.f2.centroid[1] + f.f3.centroid[1] + f.f4.centroid[1]) / 4;
    const bearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    const word = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(bearing / 45) % 8];
    assert.ok(['east', 'south-east'].includes(word));
    assert.equal(lab.text, `${miles} mi ${word}`);
    assert.match(lab.text, /^3\.[0-9] mi (east|south-east)$/);
    assert.deepEqual(lab.at, islandCentroid(f.f5));
  });

  test('no two placed fields overlap and all are inside one smooth outline', () => {
    assertNoOverlaps(r);
    assertOneClosedRing(r.outline);
    assertSmooth(r.outline);
    assertInsideOutline(r);
  });

  test('north/south and east/west order of centroids is preserved', () => {
    const ids = Object.keys(f);
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const ra = f[a].centroid, rb = f[b].centroid, ia = islandCentroid(f[a]), ib = islandCentroid(f[b]);
        // Only check pairs whose real separation along that axis is clear (> 100 m).
        if (ra[0] - rb[0] > 100) assert.ok(ia[0] > ib[0], `${a} should stay east of ${b}`);
        if (ra[1] - rb[1] > 100) assert.ok(ia[1] > ib[1], `${a} should stay north of ${b}`);
      }
    }
  });

  test('heights are (elevation - lowest) * 3', () => {
    const minE = Math.min(...demoFields.map((d) => d.elevationM));
    assert.equal(minE, 297);
    for (const d of demoFields) assert.equal(f[d.id].heightM, (d.elevationM - 297) * 3);
  });

  test('custom exaggeration and missing elevation', () => {
    const input = demoFields.map((d, i) => ({ ...d, elevationM: i === 1 ? null : d.elevationM }));
    const r2 = byId(layoutIsland(input, { exaggeration: 2 }));
    assert.equal(r2.f2.heightM, 0);
    assert.equal(r2.f1.heightM, (308 - 297) * 2);
  });
});

describe('layoutIsland: 15 fields (demo fields copied three times ~3 km apart)', () => {
  const input = fifteenFields();
  const r = layoutIsland(input);

  test('every field is placed', () => {
    assert.equal(r.fields.length, 15);
    assert.deepEqual(r.fields.map((x) => x.id), input.map((x) => x.id));
    for (const x of r.fields) assert.ok(x.offset.every(Number.isFinite));
  });

  test('no overlaps, every field inside one smooth outline ring', () => {
    assertNoOverlaps(r);
    assertOneClosedRing(r.outline);
    assertSmooth(r.outline);
    assertInsideOutline(r);
  });

  test('the island is compact: much smaller than the real spread', () => {
    let realR = 0;
    for (const x of r.fields) realR = Math.max(realR, Math.hypot(x.centroid[0] - r.center[0], x.centroid[1] - r.center[1]));
    assert.ok(r.radiusM < 0.6 * realR, `island ${r.radiusM.toFixed(0)} m vs real ${realR.toFixed(0)} m`);
  });

  test('outlying groups get labels (one per group)', () => {
    const labelled = r.fields.filter((x) => x.label);
    // The home f1-f4 group, two copied f1-f4 groups, three lone f5 copies: 5 outlying groups.
    assert.equal(labelled.length, 5);
    for (const x of labelled) assert.match(x.label.text, /^\d+\.\d mi (north|north-east|east|south-east|south|south-west|west|north-west)$/);
    const bf = byId(r);
    assert.match(bf.f3b.label ? bf.f3b.label.text : bf.f2b.label.text, /north-east$/);
  });

  test('island radius grows with total area', () => {
    const r1 = layoutIsland([demoFields[0]]);
    const r5 = layoutIsland(demoFields);
    assert.ok(r1.radiusM < r5.radiusM && r5.radiusM < r.radiusM, `${r1.radiusM} < ${r5.radiusM} < ${r.radiusM}`);
  });

  test('the same field chosen twice is pushed apart, not stacked', () => {
    const dup = [...demoFields, ...demoFields.map((d) => ({ ...d, id: d.id + 'x' }))];
    const r2 = layoutIsland(dup);
    assertNoOverlaps(r2);
    assertInsideOutline(r2);
  });
});

describe('layoutIsland: speed and edge cases', () => {
  /** Give every edge many extra points with a small wobble, like a traced field boundary. */
  function densify(g, every = 8) {
    const mv = (rings) => rings.map((ring) => {
      const out = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
        const len = Math.hypot((x1 - x0) * 82000, (y1 - y0) * 111000);
        const k = Math.max(1, Math.round(len / every));
        for (let s = 0; s < k; s++) {
          const t = s / k;
          const wob = 0.00003 * Math.sin((i * 7 + s) * 1.3);
          out.push([x0 + (x1 - x0) * t + wob, y0 + (y1 - y0) * t + wob * 0.7]);
        }
      }
      out.push(out[0]);
      return out;
    });
    return { type: 'Polygon', coordinates: mv(g.coordinates) };
  }

  test('15 fields with a few hundred vertices each lay out in well under 200 ms', () => {
    const input = fifteenFields().map((f) => ({ ...f, geometry: densify(f.geometry) }));
    const verts = input.reduce((s, f) => s + f.geometry.coordinates[0].length, 0) / input.length;
    assert.ok(verts > 200, `only ${verts} vertices per field`);
    layoutIsland(input); // warm up the JIT
    const t0 = performance.now();
    const r = layoutIsland(input);
    const ms = performance.now() - t0;
    assert.ok(ms < 200, `took ${ms.toFixed(0)} ms`);
    // The wobble makes touching neighbours overlap by a sliver in the input itself; those stay.
    assertNoOverlaps(r, true);
    assertInsideOutline(r);
  });

  test('MultiPolygon fields work', () => {
    const a = demoFields[0].geometry.coordinates;
    const b = shiftGeometry(demoFields[3].geometry, 0, -200).coordinates;
    const r = layoutIsland([{ id: 'm', geometry: { type: 'MultiPolygon', coordinates: [a, b] }, elevationM: 300 }, demoFields[2]]);
    assert.equal(r.fields[0].polygons.length, 2);
    assertNoOverlaps(r);
    assertInsideOutline(r);
  });

  test('no fields is an error', () => {
    assert.throws(() => layoutIsland([]));
  });
});

describe('layoutIsland: tight mode, per-pair gaps, reserved space', () => {
  const nearest = (r, a) => {
    let d = Infinity;
    for (const b of r.fields) if (b !== a) for (const ra of islandRings(a)) for (const rb of islandRings(b)) {
      d = Math.min(d, minDistToOutline([ra], [...rb, rb[0]]), minDistToOutline([rb], [...ra, ra[0]]));
    }
    return d;
  };

  test('tight mode packs every field about one gap from a neighbour', () => {
    const r = layoutIsland(demoFields, { tight: true, gapM: 100 });
    assertNoOverlaps(r);
    assertInsideOutline(r);
    for (const a of r.fields) {
      const d = nearest(r, a);
      assert.ok(d >= 100 - 3 && d < 200, `${a.id}: nearest neighbour ${d.toFixed(0)} m`);
    }
    // Still the far field's label.
    assert.match(byId(r).f5.label.text, /^3\.[0-9] mi (east|south-east)$/);
  });

  test('tight mode on 15 fields: nothing left far away', () => {
    const r = layoutIsland(fifteenFields(), { tight: true, gapM: 100 });
    assertNoOverlaps(r);
    for (const a of r.fields) assert.ok(nearest(r, a) < 200, a.id);
  });

  test('gapBetween widens chosen gaps', () => {
    const r = layoutIsland(demoFields, { tight: true, gapM: 50, gapBetween: (a, b) => (a === 'f5' || b === 'f5' ? 300 : 50) });
    const d = nearest(r, byId(r).f5);
    assert.ok(d >= 300 - 3 && d < 600, `f5 is ${d.toFixed(0)} m from the others`);
  });

  test('reserved space moves with its field, stays clear, and is not part of it', () => {
    const plain = byId(layoutIsland(demoFields, { tight: true, gapM: 50 }));
    // A 300 m square west of f1's middle, out where f2 really is.
    const c = turf.centroid(demoFields[0].geometry).geometry.coordinates;
    const dLng = 300 / (M_PER_DEG * Math.cos((c[1] * Math.PI) / 180)), dLat = 150 / M_PER_DEG;
    const x0 = c[0] - 4 * dLng;
    const reserve = { type: 'Polygon', coordinates: [[[x0, c[1] - dLat], [x0 + dLng, c[1] - dLat], [x0 + dLng, c[1] + dLat], [x0, c[1] + dLat], [x0, c[1] - dLat]]] };
    const r = byId(layoutIsland(demoFields.map((f, i) => (i === 0 ? { ...f, reserve } : f)), { tight: true, gapM: 50 }));
    assert.ok(Math.abs(r.f1.areaM2 - plain.f1.areaM2) / plain.f1.areaM2 < 1e-3, 'area excludes the reserve');
    assert.ok(Array.isArray(r.f1.reserved) && r.f1.reserved.length === 1);
    assert.equal(r.f2.reserved, undefined);
    const res = { id: 'reserve', polygons: r.f1.reserved, offset: r.f1.offset };
    for (const id of ['f2', 'f3', 'f4', 'f5']) assert.ok(overlapArea(res, r[id]) < 1, `${id} overlaps the reserved space`);
  });
});
