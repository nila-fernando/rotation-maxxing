// The sea animals' paths on real islands of 1, 5 and 15 fields: open water only, clear of the
// beach, the dock, the boat and every route the swimming sheep can take, clear of each other, and
// never past the sea the camera shows. Then the whale's timing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planIsland } from './plan.js';
import { makeHeightField } from './terrain.js';
import { rng } from './props.js';
import {
  DOLPHIN_SPEED, DOLPHIN_WIDTH, FISH_LENGTH, ORCA_SPEED, POD, SCHOOL, SEA, SWIMMERS, WHALE_SHOW, WHALE_TIMING, showPath, whaleKeepOut, createTapCounter, dockKeepOuts, createWhaleClock, fishRefuge, isWhaleDay, planSea, seaGeometry, segDistance, whaleSpot,
} from './seaPaths.js';

const demo = JSON.parse(readFileSync(new URL('../../data/demo-farm.json', import.meta.url), 'utf8'));
const lastCrop = (f) => (f.cropHistory?.length ? f.cropHistory[f.cropHistory.length - 1].crop : null);
const demoFields = demo.fields.map((f) => ({ id: f.id, name: f.name, geometry: f.geometry, elevationM: f.elevationM, crop: lastCrop(f) }));
const M_PER_DEG = (Math.PI / 180) * 6371008.8;
function shift(g, east, north) {
  const dLng = east / (M_PER_DEG * Math.cos((42 * Math.PI) / 180)), dLat = north / M_PER_DEG;
  const mv = (rings) => rings.map((r) => r.map(([x, y]) => [x + dLng, y + dLat]));
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: mv(g.coordinates) } : { type: 'MultiPolygon', coordinates: g.coordinates.map(mv) };
}
const fifteen = () => [[0, 0, ''], [3000, 3000, 'b'], [-3000, -3000, 'c']]
  .flatMap(([e, n, tag]) => demoFields.map((f) => ({ ...f, id: f.id + tag, geometry: shift(f.geometry, e, n) })));

/** The island's sea, with the dock and the boat where the reveal puts them (the camera's side). */
function island(fields) {
  const plan = planIsland(fields, { seed: demo.farm.name, home: demo.farm.center });
  const field = makeHeightField(plan, { seed: demo.farm.name });
  const sea = seaGeometry({ center: field.center, shoreR: field.shoreR, heightAt: field });
  // the reveal's dock and rowboat (src/screens/reveal.js): on the shore facing the camera
  const th = Math.atan2(Math.cos(-0.2), Math.sin(-0.2));
  const [cx, cz] = field.center, nx = Math.cos(th), nz = Math.sin(th), sr = field.shoreR(th), S = 0.9;
  const dockAt = [cx + nx * (sr - 0.35 * S), cz + nz * (sr - 0.35 * S)];
  const boatAt = [cx + nx * (sr + 1.3 * S) - nz * 0.95 * S, cz + nz * (sr + 1.3 * S) + nx * 0.95 * S];
  const keepOuts = dockKeepOuts(dockAt, [nx, nz], boatAt);
  const lanes = planSea(sea, { keepOuts, rnd: rng(7) });
  return { field, sea, keepOuts, lanes };
}

test('the fish in a school never touch, and stay inside the school', () => {
  for (let i = 0; i < SCHOOL.length; i++) {
    assert.ok(Math.hypot(...SCHOOL[i]) + FISH_LENGTH / 2 <= SEA.fish.radius, `fish ${i} pokes out of its school`);
    for (let j = i + 1; j < SCHOOL.length; j++) {
      const d = Math.hypot(SCHOOL[i][0] - SCHOOL[j][0], SCHOOL[i][1] - SCHOOL[j][1]);
      assert.ok(d >= FISH_LENGTH + 0.01, `fish ${i} and ${j} touch (${d.toFixed(3)})`);
    }
  }
});

test('the pod never bumps into itself', () => {
  for (let i = 0; i < POD.length; i++) for (let j = i + 1; j < POD.length; j++) {
    const along = Math.abs(POD[i][0] - POD[j][0]), across = Math.abs(POD[i][1] - POD[j][1]) * SEA.dolphin.spread;
    assert.ok(across >= DOLPHIN_WIDTH + 0.05 || along >= 2 * SEA.dolphin.radius + 0.05, `dolphins ${i} and ${j} touch`);
    assert.ok(Math.abs(POD[i][1]) <= 1 && Math.abs(POD[j][1]) <= 1);
  }
});

/** Every spot a dolphin in the pod can be: the lane, and across it by the formation's spread. */
function podPoints(lane) {
  const out = [];
  for (let s = 0; s < lane.length; s += 0.1) {
    const p = lane.at(s);
    const px = -Math.sin(p.dir), pz = Math.cos(p.dir);
    for (const k of [-1, 0, 1]) out.push([p.x + px * k * SEA.dolphin.spread, p.z + pz * k * SEA.dolphin.spread]);
  }
  return out;
}
const lanePoints = (lane) => { const out = []; for (let s = 0; s < lane.length; s += 0.1) { const p = lane.at(s); out.push([p.x, p.z]); } return out; };
const least = (pts, others) => {
  let best = Infinity;
  for (const [x, z] of pts) for (const [ox, oz] of others) { const d = Math.hypot(x - ox, z - oz); if (d < best) best = d; }
  return best;
};
const deepAround = (sea, x, z, r, depth) => {
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI * 2, rr = k === 8 ? 0 : r;
    if (sea.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr) > -depth) return false;
  }
  return true;
};

for (const [name, fields] of [['1 field', demoFields.slice(0, 1)], ['5 fields', demoFields], ['15 fields', fifteen()]]) {
  describe(`the sea round a ${name} island`, () => {
    const { sea, keepOuts, lanes } = island(fields);
    const { dolphin, orca, fish, swimmers } = lanes;
    const pod = podPoints(dolphin);
    const orcaPts = lanePoints(orca);

    test('the swimmers have somewhere to swim (the routes the lanes keep clear of)', () => {
      assert.ok(swimmers.length > 200, `only ${swimmers.length} swimmer points`);
    });

    test('the dolphins swim in open, deep water, clear of the beach, swimmers, dock and boat', () => {
      for (const [x, z] of pod) {
        assert.ok(deepAround(sea, x, z, SEA.dolphin.radius, SEA.minDepth), `shallow at ${x.toFixed(2)},${z.toFixed(2)}`);
        assert.ok(sea.distToShore(x, z) >= SEA.dolphin.radius + 1, 'too near the shore');
        assert.ok(sea.distToShore(x, z) <= SEA.outerLimit, 'past the sea the camera shows');
        for (const k of keepOuts) assert.ok(Math.hypot(x - k.x, z - k.z) >= k.r + SEA.dolphin.radius, 'through the dock or boat');
      }
      assert.ok(least(pod, swimmers) >= SWIMMERS.body + SEA.dolphin.radius, `a dolphin meets a swimmer (${least(pod, swimmers).toFixed(2)})`);
    });

    test('the orca keeps to deep water past the dolphins, and inside the visible sea', () => {
      for (const [x, z] of orcaPts) {
        assert.ok(deepAround(sea, x, z, SEA.orca.radius, SEA.minDepth));
        assert.ok(sea.distToShore(x, z) <= SEA.outerLimit);
        for (const k of keepOuts) assert.ok(Math.hypot(x - k.x, z - k.z) >= k.r + SEA.orca.radius);
      }
      assert.ok(least(orcaPts, pod) >= SEA.orca.radius + SEA.dolphin.radius, `the orca meets the dolphins (${least(orcaPts, pod).toFixed(2)})`);
      assert.ok(least(orcaPts, swimmers) >= SEA.orca.radius + SWIMMERS.body);
    });

    test('the lanes are smooth loops all the way round', () => {
      for (const lane of [dolphin, orca]) {
        let prev = lane.at(0);
        for (let s = 0.1; s <= lane.length; s += 0.1) {
          const p = lane.at(s);
          assert.ok(Math.hypot(p.x - prev.x, p.z - prev.z) < 0.15, 'a jump along the lane');
          const turn = Math.abs(Math.atan2(Math.sin(p.dir - prev.dir), Math.cos(p.dir - prev.dir)));
          assert.ok(turn < 0.35, `a sharp turn (${turn.toFixed(2)})`);
          prev = p;
        }
      }
    });

    test('fish schools stay in the shallows, clear of the dock, the boat and each other', () => {
      assert.ok(fish.length >= 1, 'no school found room');
      const R = SEA.fish.radius;
      fish.forEach((school, i) => {
        assert.ok(school.range.length >= 1);
        school.range.forEach((p, j) => {
          assert.ok(deepAround(sea, p.x, p.z, R, SEA.fish.minDepth), 'a school on the sand');
          assert.ok(sea.distToShore(p.x, p.z) >= R, 'a school on the beach');
          assert.ok(sea.distToShore(p.x, p.z) < 1.4, 'not in the shallows');
          for (const k of keepOuts) assert.ok(Math.hypot(p.x - k.x, p.z - k.z) >= k.r + R);
          if (j) { const q = school.range[j - 1]; assert.ok(Math.hypot(p.x - q.x, p.z - q.z) <= 0.45, 'a gap in its stretch'); }
        });
        assert.ok(least(school.range.map((p) => [p.x, p.z]), pod) > 1);
        for (const other of fish.slice(i + 1)) {
          assert.ok(least(school.range.map((p) => [p.x, p.z]), other.range.map((p) => [p.x, p.z])) >= 2 * R, 'two schools meet');
        }
      });
    });

    test('a school always darts out of a swimmer’s way, or dives when there is nowhere to go', () => {
      const need = SWIMMERS.body + SEA.fish.radius + SEA.fish.gap;
      const rnd = rng(11);
      // every swimmer route near each school, in turn, and the two together
      const near = [];
      for (let i = 0; i + 8 < swimmers.length; i += 9) {
        const [ax, az] = swimmers[i], [bx, bz] = swimmers[i + 8];
        if (fish.some((f) => f.range.some((p) => Math.hypot(p.x - ax, p.z - az) < 2.5))) near.push({ ax, az, bx, bz });
      }
      assert.ok(near.length > 0, 'no swimmer ever comes near a school');
      let moved = 0, dove = 0;
      for (let n = 0; n < 300; n++) {
        const routes = [near[Math.floor(rnd() * near.length)], near[Math.floor(rnd() * near.length)]];
        for (const school of fish) {
          const at = Math.floor(rnd() * school.range.length);
          const i = fishRefuge(school, at, routes);
          if (i < 0) { dove++; continue; }
          if (i !== at) moved++;
          const p = school.range[i];
          for (const r of routes) assert.ok(segDistance(p.x, p.z, r.ax, r.az, r.bx, r.bz) >= need - 1e-9, 'a school left under a swimmer');
        }
      }
      assert.ok(moved > 0, 'no school ever had to move');
      // with no swimmer about, a school stays where it is
      for (const school of fish) assert.equal(fishRefuge(school, school.home, []), school.home);
      void dove;
    });

    test('the whale comes up in deep water clear of the swimmers, inside the visible sea, where the orca and dolphins won’t pass', () => {
      const rnd = rng(3);
      for (let n = 0; n < 25; n++) {
        const now = { orcaAt: rnd() * orca.length, podAt: rnd() * dolphin.length };
        const busy = showPath(lanes, now);
        for (const school of fish) for (const p of school.range) busy.push({ x: p.x, z: p.z, r: SEA.fish.radius }); // (as seaLife.js does)
        // the two swimmers on routes of their own just now
        const route = () => { const i = Math.floor(rnd() * (swimmers.length - 8)); return { ax: swimmers[i][0], az: swimmers[i][1], bx: swimmers[i + 7][0], bz: swimmers[i + 7][1] }; };
        const swimming = [route(), route()];
        const w = whaleSpot(sea, lanes, { rnd, keepOuts, busy, swimmers: swimming });
        assert.ok(w, 'nowhere for the whale');
        assert.ok(deepAround(sea, w.x, w.z, SEA.whale.radius, SEA.minDepth));
        assert.ok(sea.distToShore(w.x, w.z) + SEA.whale.radius <= SEA.outerLimit + 0.35, 'past the visible sea');
        for (const r of swimming) assert.ok(segDistance(w.x, w.z, r.ax, r.az, r.bx, r.bz) >= SEA.whale.radius + SWIMMERS.body, 'the whale meets a swimmer');
        // and a route a swimmer picks next keeps out of its way (makeSwimmers asks whaleKeepOut)
        assert.equal(whaleKeepOut(w, w.x + SEA.whale.radius + SWIMMERS.body - 0.01, w.z), true);
        assert.equal(whaleKeepOut(w, w.x, w.z - SEA.whale.radius - SWIMMERS.body - SEA.whale.gap - 0.01), false);
        assert.equal(whaleKeepOut(null, w.x, w.z), false);
        for (const k of keepOuts) assert.ok(Math.hypot(w.x - k.x, w.z - k.z) >= k.r + SEA.whale.radius, 'the whale meets the dock or boat');
        for (const school of fish) assert.ok(least([[w.x, w.z]], school.range.map((p) => [p.x, p.z])) >= SEA.whale.radius + SEA.fish.radius, 'the whale meets a school');
        // the orca and every dolphin, all through the show, a quarter second at a time and in between
        for (let t = 0; t <= WHALE_SHOW + 1; t += 0.05) {
          const o = orca.at(now.orcaAt + ORCA_SPEED * t);
          assert.ok(Math.hypot(o.x - w.x, o.z - w.z) >= SEA.whale.radius + SEA.orca.radius, `the whale meets the orca at ${t.toFixed(2)} s`);
          for (const [along, across] of POD) {
            const p = dolphin.at(now.podAt + DOLPHIN_SPEED * t + along), k = across * SEA.dolphin.spread;
            const x = p.x - Math.sin(p.dir) * k, z = p.z + Math.cos(p.dir) * k;
            assert.ok(Math.hypot(x - w.x, z - w.z) >= SEA.whale.radius + SEA.dolphin.radius, `the whale meets a dolphin at ${t.toFixed(2)} s`);
          }
        }
      }
    });

    test('the whale comes up near where it is asked to (the camera), when it can', () => {
      const [cx, cz] = sea.center;
      const target = [cx, cz + 30]; // a camera out in front
      const near = whaleSpot(sea, lanes, { rnd: rng(9), keepOuts, score: (x, z) => Math.hypot(x - target[0], z - target[1]) });
      const any = whaleSpot(sea, lanes, { rnd: rng(9), keepOuts });
      assert.ok(near && any);
      assert.ok(near.z > cz, 'not on the camera’s side');
    });

    test('the whale only comes up where the farmer can see it', () => {
      const [cx, cz] = sea.center;
      const front = (x, z) => z - cz > 0; // e.g. only the camera's half
      const w = whaleSpot(sea, lanes, { rnd: rng(5), visible: front });
      assert.ok(w && w.z > cz);
      assert.equal(whaleSpot(sea, lanes, { rnd: rng(5), visible: () => false }), null);
      void cx;
    });
  });
}

describe('when the whale comes by', () => {
  test('World Whale Day is the third Sunday in February', () => {
    assert.equal(isWhaleDay(new Date(2026, 1, 15, 12)), true);
    assert.equal(isWhaleDay(new Date(2027, 1, 21, 12)), true);
    assert.equal(isWhaleDay(new Date(2026, 1, 22, 12)), false);
    assert.equal(isWhaleDay(new Date(2026, 1, 8, 12)), false);
    assert.equal(isWhaleDay(new Date(2026, 11, 24, 12)), false);
    assert.equal(isWhaleDay(new Date('nope')), false);
  });

  const run = (clock, seconds, dt = 0.5) => { const at = []; for (let t = 0; t < seconds; t += dt) if (clock.step(dt)) at.push(t + dt); return at; };

  test('never in the first minutes, then rarely, and never twice close together', () => {
    const lucky = run(createWhaleClock({ rnd: () => 0, date: new Date(2026, 10, 15) }), 600);
    assert.ok(lucky[0] >= WHALE_TIMING.firstAfter);
    for (let i = 1; i < lucky.length; i++) assert.ok(lucky[i] - lucky[i - 1] >= WHALE_TIMING.rest);
    assert.deepEqual(run(createWhaleClock({ rnd: () => 0.99, date: new Date(2026, 10, 15) }), 3600), []);
    // on average about once in 20 minutes
    const r = rng(42);
    const n = run(createWhaleClock({ rnd: r, date: new Date(2026, 10, 15) }), 6 * 3600, 1).length;
    assert.ok(n >= 6 && n <= 40, `${n} whales in six hours`);
  });

  test('on World Whale Day it comes by soon, whatever the dice say', () => {
    const at = run(createWhaleClock({ rnd: () => 0.99, date: new Date(2026, 1, 15, 12) }), 120);
    assert.equal(at.length, 1);
    assert.ok(at[0] >= WHALE_TIMING.whaleDayFirst && at[0] < WHALE_TIMING.whaleDayFirst + 1);
  });

  test('after a tapped-up whale it rests', () => {
    const clock = createWhaleClock({ rnd: () => 0, date: new Date(2026, 10, 15) });
    run(clock, 170);
    clock.after();
    const at = run(clock, 200);
    assert.ok(at[0] >= WHALE_TIMING.rest - 0.5, `came back after ${at[0]} s`);
  });

  test('three taps on the open sea within four seconds call it', () => {
    const taps = createTapCounter();
    assert.equal(taps.tap(0), false);
    assert.equal(taps.tap(1), false);
    assert.equal(taps.tap(2), true);
    assert.equal(taps.tap(3), false); // starts again
    assert.equal(taps.tap(10), false);
    assert.equal(taps.tap(15), false); // too slow
    assert.equal(taps.tap(16), false);
    assert.equal(taps.tap(17), true);
  });
});
