// Where the coin stacks float (src/island/stackSpots.js), on real island layouts of 1, 5 and 15
// fields with stand-in props round them: the barn and silo, a tree beside a field, windmill sails
// hanging over a field's edge, a lamp, and a centre-pivot field. Every column must sit well inside
// its field, high enough over the crops, and clear of everything.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { boxHitsProp, sphereHitsBox } from './clearance.js';
import { distanceToEdges, footprint, pointInPolygons } from './picking.js';
import { planIsland } from './plan.js';
import { COLUMN_HALF, EDGE_ROOM, LAMP_H, LAMP_R, MAX_COINS, COIN_PITCH, DROP_ROOM, PIVOT_ROOM, columnBox, pivotCentre, stackSpot, stackSpots } from './stackSpots.js';
import { levelHeight } from './terrain.js';

const demo = JSON.parse(readFileSync(new URL('../../data/demo-farm.json', import.meta.url), 'utf8'));
const demoFields = demo.fields.map((f) => ({ id: f.id, name: f.name, geometry: f.geometry, elevationM: f.elevationM }));

const M_PER_DEG = (Math.PI / 180) * 6371008.8;
function shiftGeometry(g, east, north) {
  const dLng = east / (M_PER_DEG * Math.cos((42 * Math.PI) / 180)), dLat = north / M_PER_DEG;
  const mv = (rings) => rings.map((r) => r.map(([x, y]) => [x + dLng, y + dLat]));
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: mv(g.coordinates) } : { type: 'MultiPolygon', coordinates: g.coordinates.map(mv) };
}
/** 15 fields: the 5 demo fields plus two copies about 3 km away (as plan.test.js does). */
const fifteen = () => [[0, 0, ''], [3000, 3000, 'b'], [-3000, -3000, 'c']].flatMap(([e, n, tag]) => demoFields.map((f) => ({ ...f, id: f.id + tag, geometry: shiftGeometry(f.geometry, e, n) })));

// the reveal's way of recording a prop: its own unrotated, unscaled box, scaled and stood at (x, y, z)
const BOX = {
  barn: [[-1, 0, -0.8], [1, 2.27, 0.8]],
  silo: [[-0.45, 0, -0.45], [0.45, 2.4, 0.45]],
  tree: [[-0.4, 0, -0.4], [0.4, 2.13, 0.4]],
  windmill: [[-0.6, 0, -0.6], [0.6, 3.47, 0.6]],
};
const prop = (key, x, z, y, ry = 0, scale = 0.75) => ({ key, x, z, r: 0.5, ry, scale, height: BOX[key][1][1] * scale, y, box: { min: BOX[key][0], max: BOX[key][1] } });

/** A farm island and its fields as the stacks see them, plus the stand-in props round them. */
function farm(input) {
  const plan = planIsland(input, { seed: demo.farm.name, home: demo.farm.center });
  const fields = plan.fields.map((f, i) => {
    const fp = footprint(f.polygons);
    return { id: f.id, polygons: f.polygons, topY: levelHeight(f.level) + 0.18, ground: levelHeight(f.level), isPivot: false, ...fp, i };
  });
  // a point just outside a field's edge, on the far side from its middle (the edge's middle, pushed out)
  const outside = (f, by) => {
    const ring = f.polygons[0][0];
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az);
      if (!best || len > best.len) best = { mx, mz, len };
    }
    const dx = best.mx - f.center[0], dz = best.mz - f.center[1], d = Math.hypot(dx, dz) || 1;
    return [best.mx + (dx / d) * by, best.mz + (dz / d) * by];
  };
  const [ya, yb] = plan.farmstead?.at || [0, 0];
  const props = [prop('barn', ya, yb, plan.farmstead ? levelHeight(plan.farmstead.level) : 0.55, 0.6), prop('silo', ya + 1.3, yb - 0.4, 0.55)];
  const sails = [];
  const lamps = [];
  const a = fields[0];
  props.push(prop('tree', ...outside(a, 0.25), a.ground)); // a tree whose crown overhangs the field
  if (fields[1]) {
    const b = fields[1];
    const [sx, sz] = outside(b, 0.2);
    sails.push({ x: sx, y: b.topY + 1.6, z: sz, r: 1.1 }); // windmill sails high over the field's edge
  }
  // the biggest field gets a centre pivot (a small one would have no room off the tower at all:
  // it gets no stack, and its chip carries the money)
  if (fields.length >= 3) fields.reduce((m, f) => (f.radius > m.radius ? f : m)).isPivot = true;
  // a lamp right where a (pivot-less) field's stack would go (no lamp stands in a field, but if one did)
  const lampField = fields.slice(2).filter((f) => !f.isPivot).sort((p, q) => q.radius - p.radius)[0] || null; // (a roomy one)
  if (lampField) { const s = stackSpot(lampField, {}); lamps.push({ at: [s.x + 0.1, s.z] }); }
  const heightAt = (x, z) => fields.find((f) => pointInPolygons(x, z, f.polygons))?.ground ?? 0.55;
  return { plan, fields, lampField, env: { props, sails, lamps, heightAt } };
}

const SIZES = { 1: demoFields.slice(0, 1), 5: demoFields, 15: fifteen() };

function lampHits(l, box, heightAt) {
  const [x, z] = l.at, g = heightAt(x, z);
  if (box.max.y < g || box.min.y > g + LAMP_H) return false;
  const nx = Math.max(box.min.x, Math.min(x, box.max.x)), nz = Math.max(box.min.z, Math.min(z, box.max.z));
  return Math.hypot(nx - x, nz - z) < LAMP_R;
}

describe('coin stack spots', () => {
  for (const [n, input] of Object.entries(SIZES)) {
    describe(`${n} field${n === '1' ? '' : 's'}`, () => {
      const { fields, env, lampField } = farm(input);
      const spots = stackSpots(fields, env);

      it('finds a spot on every field', () => {
        assert.equal(spots.size, fields.length);
        for (const f of fields) assert.ok(spots.get(f.id), `${f.id} has a stack`);
      });

      it("keeps the column's four corners well inside its field", () => {
        // the middle keeps EDGE_ROOM from every edge, so a corner (half the column's diagonal out)
        // keeps at least EDGE_ROOM - COLUMN_HALF * sqrt 2
        const least = EDGE_ROOM - COLUMN_HALF * Math.SQRT2;
        for (const f of fields) {
          const s = spots.get(f.id);
          assert.ok(distanceToEdges(s.x, s.z, f.polygons) >= EDGE_ROOM - 1e-9, `${f.id} middle`);
          for (const dx of [-COLUMN_HALF, COLUMN_HALF]) for (const dz of [-COLUMN_HALF, COLUMN_HALF]) {
            const x = s.x + dx, z = s.z + dz;
            assert.ok(pointInPolygons(x, z, f.polygons), `${f.id} corner (${x.toFixed(2)}, ${z.toFixed(2)}) is inside`);
            assert.ok(distanceToEdges(x, z, f.polygons) >= least - 1e-9, `${f.id} corner keeps ${least.toFixed(2)} from the edge`);
          }
        }
      });

      it('floats high enough over the crops, and off the pivot', () => {
        for (const f of fields) {
          const s = spots.get(f.id);
          assert.ok(s.baseY >= f.topY + (f.isPivot ? 1.25 : 1.05) - 1e-9, `${f.id} baseY ${s.baseY} over topY ${f.topY}`);
          assert.ok(Math.abs(s.top - (s.baseY + MAX_COINS * COIN_PITCH + DROP_ROOM)) < 1e-9, 'the column reaches over a full stack and its drop-in');
          if (f.isPivot) { const [px, pz] = pivotCentre(f.polygons); assert.ok(Math.hypot(s.x - px, s.z - pz) >= PIVOT_ROOM - 1e-9, `${f.id} keeps off the pivot tower`); }
        }
      });

      it('runs into no prop (by its real box), sail or lamp', () => {
        for (const f of fields) {
          const { box } = spots.get(f.id);
          for (const p of env.props) assert.ok(!boxHitsProp(box, p, { shrink: 0, pad: 0.1 }), `${f.id} clear of the ${p.key}`);
          for (const s of env.sails) assert.ok(!sphereHitsBox({ ...s, r: s.r + 0.1 }, box), `${f.id} clear of the sails`);
          for (const l of env.lamps) assert.ok(!lampHits(l, box, env.heightAt), `${f.id} clear of the lamp`);
        }
      });

      it('actually had to move for the lamp and the sails', () => {
        const bare = stackSpots(fields, {});
        if (lampField) {
          const s = spots.get(lampField.id), b = bare.get(lampField.id);
          assert.ok(lampHits(env.lamps[0], b.box, env.heightAt), 'with nothing round it, the stack would be on the lamp');
          assert.ok(s.x !== b.x || s.z !== b.z, 'so it moved');
        }
        // the sails reach over the second field's edge: somewhere on it they'd be in the way
        if (fields[1]) {
          const sail = env.sails[0], f = fields[1];
          const reached = [...Array(49).keys()].some((n) => {
            const [x0, z0, x1, z1] = f.bbox;
            const x = x0 + ((n % 7) + 0.5) / 7 * (x1 - x0), z = z0 + (Math.floor(n / 7) + 0.5) / 7 * (z1 - z0);
            return pointInPolygons(x, z, f.polygons) && sphereHitsBox({ ...sail, r: sail.r + 0.1 }, columnBox(x, z, f.topY + 1.05));
          });
          assert.ok(reached, 'the sails do hang over part of the field');
        }
        assert.ok(fields.every((f) => bare.get(f.id)), 'a bare field always has room');
      });
    });
  }

  it('puts the demo stacks where the spec measured them (Home place: 2.48 to 3.54)', () => {
    const { fields } = farm(demoFields);
    const f1 = stackSpot(fields.find((f) => f.id === 'f1'), {});
    assert.ok(Math.abs(f1.baseY - 2.48) < 0.01 && Math.abs(f1.top - 3.54) < 0.01, `${f1.baseY} to ${f1.top}`);
    assert.ok(Math.abs(f1.box.min.y - (f1.baseY - 0.03)) < 1e-9);
  });

  it('gives null when a prop covers the field', () => {
    const { fields } = farm(demoFields);
    const f = fields[0];
    const [x0, z0, x1, z1] = f.bbox;
    const big = { key: 'barn', x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: 3, ry: 0, scale: 1, height: 10, y: 0, box: { min: [-(x1 - x0), 0, -(z1 - z0)], max: [x1 - x0, 10, z1 - z0] } };
    assert.equal(stackSpot(f, { props: [big] }), null);
    // and a festival box over it does the same
    assert.equal(stackSpot(f, { keepOuts: [{ min: { x: x0 - 1, y: 0, z: z0 - 1 }, max: { x: x1 + 1, y: 9, z: z1 + 1 } }] }), null);
  });

  it('a low thing under the column (a prop below its bottom) is no bother', () => {
    const { fields } = farm(demoFields);
    const f = fields[0];
    const bare = stackSpot(f, {});
    const low = { key: 'barn', x: bare.x, z: bare.z, r: 0.3, ry: 0, scale: 1, height: 0.5, y: f.topY, box: { min: [-0.3, 0, -0.3], max: [0.3, 0.5, 0.3] } };
    const s = stackSpot(f, { props: [low] });
    assert.equal(s.x, bare.x);
    assert.equal(s.z, bare.z);
  });

  it('columnBox spans the coins and their drop-in room', () => {
    const b = columnBox(1, 2, 3);
    assert.deepEqual([b.min.x, b.max.x, b.min.z, b.max.z].map((v) => +v.toFixed(3)), [0.83, 1.17, 1.83, 2.17]);
    assert.ok(Math.abs(b.min.y - 2.97) < 1e-9 && Math.abs(b.max.y - 4.06) < 1e-9);
  });

  it("keeps off the pivot tower where the paddock puts it: the biggest part's middle", () => {
    // a round field (radius 1.6 round the origin) with a small strip off to one side: the whole
    // field's middle shifts toward the strip, but the tower stays in the round part's middle
    const circle = Array.from({ length: 32 }, (_, k) => [1.6 * Math.cos((k / 32) * Math.PI * 2), 1.6 * Math.sin((k / 32) * Math.PI * 2)]);
    const strip = [[2.0, -0.9], [3.6, -0.9], [3.6, 0.9], [2.0, 0.9]];
    const field = { polygons: [[circle], [strip]], topY: 1, isPivot: true };
    const [px, pz] = pivotCentre(field.polygons);
    assert.ok(Math.hypot(px, pz) < 1e-6, `the tower is at the round part's middle (${px}, ${pz})`);
    const whole = footprint(field.polygons).center;
    assert.ok(whole[0] > 0.5, 'while the whole field is centred well off it (measuring from there would put the stack on the tower)');
    const s = stackSpot(field, {});
    assert.ok(s && Math.hypot(s.x - px, s.z - pz) >= PIVOT_ROOM - 1e-9, `the stack keeps off the tower (${s?.x}, ${s?.z})`);
    assert.ok(Math.abs(s.baseY - 2.25) < 1e-9, 'and floats high enough over the pivot');
    // a pivot placed by hand wins
    const moved = stackSpot({ ...field, pivotAt: [0.6, 0] }, {});
    assert.ok(Math.hypot(moved.x - 0.6, moved.z) >= PIVOT_ROOM - 1e-9);
  });

  it('copes with a field with no shape', () => {
    assert.equal(stackSpot({ id: 'x', polygons: [], topY: 1 }), null);
    assert.equal(stackSpot(null), null);
  });
});
