// The tour camera must never go through the lighthouse, the windmill, the barn, the silo, a tree or
// a hill. These build real islands (planIsland and the terrain's height field, on 1, 5 and 15
// fields), put the real props on them the way the reveal does (src/screens/reveal.js: the barn on
// the farmstead, the silo beside it, a farmhouse on the nearest building pad, the lighthouse on the
// highest point and the windmill on other high ground (src/island/landmarks.js), trees on the tree
// pads), and fly the tour's shots and the farmer's wildest poses through them.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

// a canvas that draws nothing (some prop makers paint a little texture)
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) }) }),
};

const { makeBarn, makeSilo, makeWindmill, makeTree, FOOTPRINT } = await import('./props.js');
const { makeFarmhouse, BUILDING_FOOTPRINT } = await import('./buildings.js');
const { planIsland, mulberry32 } = await import('./plan.js');
const { makeHeightField, levelHeight } = await import('./terrain.js');
const { footprint, pointInPolygons, distanceToEdges } = await import('./picking.js');
const { pointInPropBox, propTop } = await import('./clearance.js');
const { makeLighthouse } = await import('./lighthouse.js');
const { openGround, placeLighthouse, placeWindmill } = await import('./landmarks.js');
const { fitDistance } = await import('./cameraRig.js');
const S = await import('./cameraSafety.js');

const PROP_SCALE = 0.75; // as the reveal places them

// ---------------------------------------------------------------------------------------------
// Farms

const demo = JSON.parse(readFileSync(new URL('../../data/demo-farm.json', import.meta.url), 'utf8'));
const lastCrop = (f) => (f.cropHistory && f.cropHistory.length ? f.cropHistory[f.cropHistory.length - 1].crop : null);
const demoFields = demo.fields.map((f) => ({ id: f.id, name: f.name, geometry: f.geometry, elevationM: f.elevationM, crop: lastCrop(f) }));
const HOME = demo.farm.center;
const SEED = demo.farm.name;

const M_PER_DEG = (Math.PI / 180) * 6371008.8;
function shiftGeometry(g, east, north) {
  const dLng = east / (M_PER_DEG * Math.cos((42 * Math.PI) / 180));
  const dLat = north / M_PER_DEG;
  const mv = (rings) => rings.map((r) => r.map(([x, y]) => [x + dLng, y + dLat]));
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: mv(g.coordinates) } : { type: 'MultiPolygon', coordinates: g.coordinates.map(mv) };
}
/** 15 fields: the 5 demo fields plus two copies about 3 km away (as plan.test.js does). */
const fifteen = () => [[0, 0, ''], [3000, 3000, 'b'], [-3000, -3000, 'c']]
  .flatMap(([e, n, tag]) => demoFields.map((f) => ({ ...f, id: f.id + tag, geometry: shiftGeometry(f.geometry, e, n) })));

// each prop's own box, measured once from the real makers (as the reveal measures it)
const boxCache = new Map();
function ownBox(key, make) {
  if (!boxCache.has(key)) {
    const obj = make();
    const box = new THREE.Box3();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { if ((o.isMesh || o.isSprite) && !o.userData.noBox) box.expandByObject(o, false); });
    boxCache.set(key, { min: box.min.toArray(), max: box.max.toArray() });
  }
  return boxCache.get(key);
}

/** The windmill's sail ball, as the tour measures it: a box round the turning blades, r = half its diagonal + 0.1. */
function sailBall(p) {
  const wrap = new THREE.Group();
  const mill = makeWindmill();
  wrap.position.set(p.x, p.y, p.z);
  wrap.rotation.y = p.ry;
  wrap.scale.setScalar(p.scale);
  wrap.add(mill);
  wrap.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(mill.userData.blades);
  const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  return { x: c.x, y: c.y, z: c.z, r: 0.5 * Math.hypot(s.x, s.y, s.z) + 0.1 };
}

/** A real island with its props, the tour's floor and the hub's zoom limits (a 1440×900 laptop). */
function buildFarm(input) {
  const plan = planIsland(input, { seed: SEED, home: HOME });
  const heightAt = makeHeightField(plan, { seed: SEED });
  const radius = heightAt.maxCoast;
  const center = { x: heightAt.center[0], y: levelHeight(0) * 0.6, z: heightAt.center[1] };
  const fields = plan.fields.map((pf) => ({ id: pf.id, polygons: pf.polygons, topY: levelHeight(pf.level) + 0.18, ...footprint(pf.polygons) }));
  const props = [];
  const add = (key, make, [x, z], scale, ry = 0) => {
    const box = ownBox(key, make);
    const p = { key, x, z, r: (FOOTPRINT[key] ?? BUILDING_FOOTPRINT[key] ?? 0.4) * scale, ry, scale, height: Math.max(0, box.max[1]) * scale, y: heightAt(x, z), box };
    props.push(p);
    return p;
  };
  const inField = (x, z, pad) => fields.some((f) => pointInPolygons(x, z, f.polygons) || distanceToEdges(x, z, f.polygons) < pad);
  const clearOfProps = (x, z, r) => props.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r + 0.12);
  const onSlot = (x, z, r) => plan.slots.some((sl) => Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + r);

  // the barn on the farmstead, the silo beside it
  const { at, facing = 0 } = plan.farmstead;
  add('barn', makeBarn, at, PROP_SCALE, facing);
  const siloR = FOOTPRINT.silo * PROP_SCALE;
  for (const a of [Math.PI / 2, -Math.PI / 2, (Math.PI * 3) / 4, -(Math.PI * 3) / 4]) {
    const d = FOOTPRINT.barn * PROP_SCALE + siloR + 0.15;
    const x = at[0] + Math.sin(facing + a) * d, z = at[1] + Math.cos(facing + a) * d;
    if (!inField(x, z, 0) && !onSlot(x, z, siloR) && clearOfProps(x, z, siloR)) { add('silo', makeSilo, [x, z], PROP_SCALE); break; }
  }
  // a farmhouse on the building pad nearest the farmstead
  const pad = plan.slots.filter((sl) => sl.kind === 'building').sort((a, b) => Math.hypot(a.at[0] - at[0], a.at[1] - at[1]) - Math.hypot(b.at[0] - at[0], b.at[1] - at[1]))[0];
  if (pad) add('farmhouse', makeFarmhouse, pad.at, Math.min(PROP_SCALE, pad.r / BUILDING_FOOTPRINT.farmhouse), 0);
  // the lighthouse on the highest point and the windmill on other high ground, as the reveal places them
  const obstacles = props.map((p) => ({ x: p.x, z: p.z, r: p.r }));
  const terrain = { heightAt, field: heightAt };
  const open = openGround({ terrain, plan, obstacles });
  const placed = {};
  const addProp = (obj, [x, z], scale, ry, key) => {
    placed[key] = add(key, () => obj, [x, z], scale, ry);
    obstacles.push({ x, z, r: placed[key].r });
  };
  const lighthouse = placeLighthouse({ terrain, plan, obstacles, open, addProp, make: makeLighthouse, props, scale: PROP_SCALE });
  placeWindmill({ terrain, plan, obstacles, open, addProp, make: makeWindmill, lighthouse, scale: PROP_SCALE });
  const sails = [];
  if (placed.windmill) sails.push(sailBall(placed.windmill));
  // trees on the tree pads
  const kinds = ['tulip-green', 'round', 'pine', 'blossom', 'tulip-yellow', 'round'];
  plan.slots.filter((sl) => sl.kind === 'tree').forEach((sl, i) => {
    const kind = kinds[i % kinds.length];
    add(`tree:${kind}`, () => makeTree(kind, 20 + i), sl.at, PROP_SCALE * (0.85 + (i % 3) * 0.1));
  });

  // the floor: every prop top, the sail tops, the crops and pivots, the highest coin column, the ground
  const maxTop = Math.max(...fields.map((f) => f.topY));
  const tops = [...props.map(propTop), ...sails.map((s) => s.y + s.r), maxTop + 0.97, maxTop + 1.05 + 1.06];
  const floor = S.floorY({ tops, heightAt, center: heightAt.center, maxCoast: radius });
  // the hub's zoom (cameraRig.layout on a 1440×900 laptop with the sidebar on the left)
  const overviewDist = fitDistance({ radius, fovDeg: 30, height: 900, freeWidth: 1440 - 360, freeHeight: 900 - 24, margin: 0.82 });
  const baseMin = Math.max(radius * 0.3, overviewDist * 0.22);
  const limits = { maxPolar: S.TOUR.maxPolar, floor, baseMin };
  const tanV = Math.tan((30 * Math.PI) / 360);
  const focusDistance = (r) => Math.min(overviewDist * 0.75, (r * 3.2) / (tanV * ((900 - 24 - 220) / 900) * 2)); // the tour's dock below
  return { plan, heightAt, radius, center, fields, props, sails, floor, overviewDist, baseMin, maxDist: overviewDist * 1.3, limits, focusDistance, home: -0.2 };
}

const FARMS = {
  'one field': buildFarm([demoFields[0]]),
  'the demo farm': buildFarm(demoFields),
  'fifteen fields': buildFarm(fifteen()),
};
const DEMO = FARMS['the demo farm'];

/** Why a camera pose isn't safe, or null: under the floor, too low or too close for the limits, in a prop (padded 0.3) or a sail ball, or near the ground. */
function trouble(pose, farm) {
  const [x, y, z] = S.poseToPos(pose);
  const ty = pose.target[1];
  if (y < farm.floor - 1e-6) return `camera at y ${y.toFixed(2)} is under the floor ${farm.floor.toFixed(2)}`;
  if (pose.polar > farm.limits.maxPolar + 1e-9) return `polar ${pose.polar.toFixed(3)} is lower than the limit`;
  if (pose.dist < S.safeMinDistance(ty, farm.limits.maxPolar, farm.floor) - 1e-6) return `distance ${pose.dist.toFixed(2)} is closer than the floor allows`;
  for (const p of farm.props) if (pointInPropBox([x, y, z], p, 0.3)) return `camera inside the ${p.key} at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
  for (const s of farm.sails) if (Math.hypot(x - s.x, y - s.y, z - s.z) < s.r) return 'camera inside the windmill sails';
  if (y < farm.heightAt(x, z) + 0.6) return 'camera too near the ground';
  return null;
}

/** The tour: the overview, every field in turn (from the side pickAzimuth likes), and the overview again. */
function tourShots(farm) {
  const shots = [S.overviewPose({ center: farm.center, overviewDist: farm.overviewDist, azimuth: farm.home })];
  for (const f of farm.fields) {
    const current = shots[shots.length - 1].azimuth;
    shots.push(S.fieldPose({
      field: f, islandCenter: farm.center, islandRadius: farm.radius, focusDist: farm.focusDistance(f.radius),
      limits: farm.limits, current, home: farm.home, coinTop: f.topY + 1.05 + 1.06, props: farm.props, sails: farm.sails,
    }));
  }
  shots.push(S.overviewPose({ center: farm.center, overviewDist: farm.overviewDist, azimuth: shots[shots.length - 1].azimuth }));
  return shots;
}

// ---------------------------------------------------------------------------------------------

describe('the floor', () => {
  it('sits above the tallest solid thing and the highest ground', () => {
    for (const [name, farm] of Object.entries(FARMS)) {
      const tallest = Math.max(...farm.props.map(propTop), ...farm.sails.map((s) => s.y + s.r));
      assert.ok(farm.floor >= tallest + 0.6 - 1e-9, `${name}: floor ${farm.floor.toFixed(2)} vs tallest ${tallest.toFixed(2)}`);
      assert.ok(farm.props.some((p) => p.key === 'windmill') && farm.sails.length === 1, `${name}: has a windmill`);
      const lh = farm.props.find((p) => p.key === 'lighthouse');
      assert.ok(lh, `${name}: has a lighthouse`);
      assert.ok(farm.floor >= propTop(lh) + 0.6 - 1e-9, `${name}: the floor is over the lighthouse's cap`);
    }
    assert.equal(S.floorY({ tops: [1, 3, 2], margin: 0.5 }), 3.5);
    assert.equal(S.floorY({ tops: [1], heightAt: () => 2, center: [0, 0], maxCoast: 5 }), 2.6);
  });

  it('leaves the camera room to see a field up close', () => {
    // the demo farm: windmill sails are the top, the floor a little above them, and the closest
    // look at the middle is not much more than the hub's own zoom limit
    const safe = S.safeMinDistance(DEMO.center.y, 0.95, DEMO.floor);
    assert.ok(safe < 1.2 * DEMO.overviewDist, `safe distance ${safe.toFixed(2)}`);
    assert.ok(DEMO.floor > 4 && DEMO.floor < 7.5, `demo floor ${DEMO.floor.toFixed(2)}`);
  });

  it('falls back to the props alone when something silly would push the camera off', () => {
    const base = { propTops: [3], center: [0, 0.33, 0], maxCoast: 0, overviewDist: 36 };
    assert.deepEqual(S.tourFloor({ ...base, tops: [5] }), { floor: 5.6, fellBack: false });
    const silly = S.tourFloor({ ...base, tops: [80] });
    assert.equal(silly.fellBack, true);
    assert.ok(Math.abs(silly.floor - 3.6) < 1e-9);
  });

  it('safeMinDistance falls as the look-at point rises', () => {
    let last = Infinity;
    for (let y = -1; y <= 6; y += 0.25) {
      const d = S.safeMinDistance(y, 0.95, 5.5);
      assert.ok(d < last, `at ${y}`);
      last = d;
    }
    assert.ok(Math.abs(S.safeMinDistance(0.33, 0.95, 5.53) - 8.94) < 0.01, 'the spec\'s worked example');
  });
});

describe('poses', () => {
  it('measure the way OrbitControls does', () => {
    const pose = { target: [1, 2, 3], dist: 10, polar: 0.84, azimuth: -0.2 };
    const pos = S.poseToPos(pose);
    const v = new THREE.Vector3(pos[0] - 1, pos[1] - 2, pos[2] - 3);
    const sph = new THREE.Spherical().setFromVector3(v);
    assert.ok(Math.abs(sph.radius - 10) < 1e-9 && Math.abs(sph.phi - 0.84) < 1e-9 && Math.abs(sph.theta + 0.2) < 1e-9);
    const back = S.poseFrom(pose.target, pos);
    assert.ok(Math.abs(back.dist - 10) < 1e-9 && Math.abs(back.polar - 0.84) < 1e-9 && Math.abs(back.azimuth + 0.2) < 1e-9);
  });

  it('enforce lifts and pulls back, and keeps the turn', () => {
    const lim = { maxPolar: 0.95, floor: 5.5, baseMin: 8 };
    const e = S.enforce({ target: [0, 0.5, 0], dist: 3, polar: 1.2, azimuth: 2 }, lim);
    assert.equal(e.polar, 0.95);
    assert.equal(e.azimuth, 2);
    assert.ok(Math.abs(e.dist - 5 / Math.cos(0.95)) < 1e-9);
    assert.ok(S.poseToPos(e)[1] >= 5.5 - 1e-9);
    const fine = { target: [0, 0.5, 0], dist: 20, polar: 0.6, azimuth: 1 };
    assert.deepEqual(S.enforce(fine, lim), fine);
  });

  it('flights turn the short way round', () => {
    const a = { target: [0, 0, 0], dist: 10, polar: 0.8, azimuth: 3.0 };
    const b = { ...a, azimuth: -3.0 };
    const path = S.flightSamples(a, b, 32);
    assert.equal(path.length, 33);
    assert.deepEqual(path[0], a);
    assert.ok(Math.abs(S.wrapAngle(path[32].azimuth) + 3.0) < 1e-9);
    const mid = path[16];
    assert.ok(Math.abs(Math.abs(S.wrapAngle(mid.azimuth)) - Math.PI) < 0.01, `through the back: ${mid.azimuth}`);
    for (const p of path) assert.ok(p.azimuth >= 3.0 - 1e-9 && p.azimuth <= 2 * Math.PI - 3.0 + 1e-9, 'never the long way');
  });
});

describe('the tour camera', () => {
  for (const [name, farm] of Object.entries(FARMS)) {
    it(`every scripted flight stays above everything (${name})`, () => {
      const shots = tourShots(farm);
      assert.equal(shots.length, farm.fields.length + 2);
      for (let i = 1; i < shots.length; i++) {
        for (const pose of S.flightSamples(shots[i - 1], shots[i], 32)) {
          const why = trouble(pose, farm);
          assert.equal(why, null, `${name}, shot ${i - 1} to ${i}: ${why}`);
        }
      }
      // and every field shot looks from near the home view
      for (const s of shots) assert.ok(Math.abs(S.wrapAngle(s.azimuth - farm.home)) <= 1.05 + 1e-9);
    });

    it(`the farmer can't break it (${name})`, () => {
      const rnd = mulberry32(1234);
      const maxTop = Math.max(...farm.fields.map((f) => f.topY));
      for (let i = 0; i < 200; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * farm.radius * 0.85;
        const target = [farm.center.x + Math.cos(a) * r, farm.center.y + rnd() * (maxTop + 0.2 - farm.center.y), farm.center.z + Math.sin(a) * r];
        const pose = { target, dist: farm.baseMin + rnd() * (farm.maxDist - farm.baseMin), polar: 0.3 + rnd() * 0.95, azimuth: (rnd() * 2 - 1) * Math.PI };
        const why = trouble(S.enforce(pose, farm.limits), farm);
        assert.equal(why, null, `${name}, pose ${i}: ${why}`);
      }
    });
  }

  it('the old gap is closed under the tour limits', () => {
    // the exploration report's hub poses: each field's middle and 36 points round the 0.85 r disc,
    // polar 0.9, 1.1 and 1.25, 36 turns, at the hub's closest zoom
    const farm = DEMO;
    const targets = [
      ...farm.fields.map((f) => [f.center[0], f.topY, f.center[1]]),
      ...Array.from({ length: 36 }, (_, k) => [farm.center.x + Math.cos((k / 36) * 2 * Math.PI) * farm.radius * 0.85, farm.center.y, farm.center.z + Math.sin((k / 36) * 2 * Math.PI) * farm.radius * 0.85]),
    ];
    let poses = 0, before = 0, after = 0;
    for (const target of targets) {
      for (const polar of [0.9, 1.1, 1.25]) {
        for (let k = 0; k < 36; k++) {
          const pose = { target, dist: farm.baseMin, polar, azimuth: (k / 36) * 2 * Math.PI - Math.PI };
          poses++;
          const at = S.poseToPos(pose);
          if (farm.props.some((p) => pointInPropBox(at, p, 0)) || farm.sails.some((s) => Math.hypot(at[0] - s.x, at[1] - s.y, at[2] - s.z) < s.r)) before++;
          if (trouble(S.enforce(pose, farm.limits), farm)) after++;
        }
      }
    }
    assert.ok(poses > 4000, `${poses} poses`);
    assert.ok(before > 0, 'the hub limits alone do let the camera into a prop (else this test proves nothing)');
    assert.equal(after, 0, `${after} of ${poses} poses still clip (${before} did before)`);
  });

  it('entry rises safely', () => {
    // from wherever the farmer left the camera (the hub's own limits), the first move only rises:
    // when riseIsClear says it may fly, a much finer look at the same flight finds nothing inside
    for (const [name, farm] of Object.entries(FARMS)) {
      const rnd = mulberry32(99);
      let flown = 0, tried = 0;
      for (let i = 0; i < 150; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * farm.radius * 0.85;
        const f = farm.fields[Math.floor(rnd() * farm.fields.length)];
        const target = rnd() < 0.5 ? [f.center[0], f.topY, f.center[1]] : [farm.center.x + Math.cos(a) * r, farm.center.y, farm.center.z + Math.sin(a) * r];
        const start = { target, dist: farm.baseMin + rnd() * (farm.maxDist - farm.baseMin) * 0.4, polar: 0.3 + rnd() * 0.95, azimuth: (rnd() * 2 - 1) * Math.PI };
        if (!S.poseIsClear(start, farm.props, farm.sails, null, { pad: 1.0, ground: 0 })) continue; // the tour jumps instead
        tried++;
        const rise = S.entryRise(start, farm.limits);
        assert.ok(rise.polar <= start.polar + 1e-12 && rise.dist >= start.dist - 1e-12, 'only rises');
        assert.equal(trouble(rise, farm), null, `${name}: the rise ends inside the limits`);
        if (!S.riseIsClear(start, rise, farm.props, farm.sails, farm.heightAt)) continue;
        flown++;
        for (const p of S.flightSamples(start, rise, 400)) {
          const at = S.poseToPos(p);
          const hit = farm.props.find((q) => pointInPropBox(at, q, 0));
          assert.ok(!hit, `${name}: the rise passes through the ${hit?.key}`);
          assert.ok(!farm.sails.some((s) => Math.hypot(at[0] - s.x, at[1] - s.y, at[2] - s.z) < s.r), `${name}: the rise passes through the sails`);
        }
      }
      assert.ok(tried > 50 && flown > tried / 2, `${name}: ${flown} of ${tried} rises flown`);
    }
  });

  it('pickAzimuth looks round a barn standing between the camera and the field', () => {
    const field = { center: [0, 0], radius: 1, topY: 0.73, bbox: [-0.8, -0.8, 0.8, 0.8] };
    const target = [0, field.topY + 0.2, 0];
    const look = { target, dist: 10, polar: 0.84, current: 0, home: 0, points: S.fieldLookPoints(field) };
    assert.equal(S.pickAzimuth({ ...look, props: [] }), 0, 'nothing in the way: stay put');
    // a barn on the +z side, a little east: in the sight lines from θ = 0, clear from the west
    const barn = { key: 'barn', x: 0.9, z: 2.0, r: 1.09, ry: 0, scale: 0.75, y: 0.6, box: ownBox('barn', makeBarn) };
    const from0 = S.poseToPos({ target, dist: 10, polar: 0.84, azimuth: 0 });
    assert.ok(look.points.some((p) => S.segmentHits(from0, p, { boxes: [barn] })), 'the barn blocks the view from straight in front');
    const a = S.pickAzimuth({ ...look, props: [barn] });
    assert.notEqual(a, 0);
    assert.ok(Math.abs(a) <= 1.05 + 1e-9);
    const cam = S.poseToPos({ target, dist: 10, polar: 0.84, azimuth: a });
    assert.equal(look.points.filter((p) => S.segmentHits(cam, p, { boxes: [barn] })).length, 0, `clear from θ ${a}`);
    // the smallest turn that is clear wins
    for (const t of [0.26, -0.26, 0.52, -0.52, 0.79, -0.79, 1.05, -1.05]) {
      if (Math.abs(t) >= Math.abs(a) - 1e-9) break;
      const c = S.poseToPos({ target, dist: 10, polar: 0.84, azimuth: t });
      assert.ok(look.points.some((p) => S.segmentHits(c, p, { boxes: [barn] })), `θ ${t} is a smaller turn but blocked`);
    }
  });

  it('pickAzimuth keeps near the home view, and stays put when every side is blocked equally', () => {
    const field = { center: [0, 0], radius: 1, topY: 0.73 };
    const look = { target: [0, 0.93, 0], dist: 10, polar: 0.84, points: S.fieldLookPoints(field), props: [] };
    // far round from home: every candidate is within 1.05 of home
    const a = S.pickAzimuth({ ...look, current: 3, home: -0.2 });
    assert.ok(Math.abs(S.wrapAngle(a + 0.2)) <= 1.05 + 1e-9, `${a}`);
    const b = S.pickAzimuth({ ...look, current: 0.5, home: 0 });
    assert.equal(b, 0.5);
  });

  it('riseIsClear looks closer on a long rise, so a small thing between two steps is still seen', () => {
    // a far camera tipping up sweeps a long arc: 33 steps are about 0.75 apart in the middle
    const from = { target: [0, 0.33, 0], dist: 40, polar: 1.25, azimuth: 0 };
    const to = { ...from, polar: 0.84 };
    const coarse = S.flightSamples(from, to, 32).map(S.poseToPos);
    // a little box halfway between the two middle steps
    const mid = S.poseToPos(S.lerpPose(from, to, (S.easeInOut(15 / 32) + S.easeInOut(16 / 32)) / 2));
    const box = { min: mid.map((v) => v - 0.01), max: mid.map((v) => v + 0.01) };
    const pad = 0.3;
    assert.ok(coarse.every((p) => !S.pointHits(p, { boxes: [box], pad })), 'the 33 steps alone miss it');
    assert.equal(S.riseIsClear(from, to, [box], [], null, 32, { pad, ground: 0 }), false);
    assert.equal(S.riseIsClear(from, to, [], [], null, 32, { pad, ground: 0 }), true);
  });
});

// ---------------------------------------------------------------------------------------------
// The plain hub: its own lower angle (1.25) and closer zoom, with a floor shaped over the farm

/** The hub's floor for a farm, as the hub measures it (src/screens/hub.js). */
function hubTents(farm) {
  const minY = Math.min(farm.center.y, ...farm.fields.map((f) => f.topY)) + farm.radius * 0.3 * Math.cos(1.25) - 0.25;
  return S.makeTents({ props: farm.props, sails: farm.sails, heightAt: farm.heightAt, minY });
}
const HUB_TENTS = Object.fromEntries(Object.entries(FARMS).map(([name, farm]) => [name, hubTents(farm)]));

/** Why a hub camera pose clips, or null: inside a prop (padded 0.3), the windmill's sails or near the ground. */
function clips(pose, farm) {
  const [x, y, z] = S.poseToPos(pose);
  for (const p of farm.props) if (pointInPropBox([x, y, z], p, 0.3)) return `camera inside the ${p.key} at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
  for (const s of farm.sails) if (Math.hypot(x - s.x, y - s.y, z - s.z) < s.r) return 'camera inside the windmill sails';
  if (y < farm.heightAt(x, z) + 0.6 - 1e-9) return 'camera too near the ground';
  return null;
}

/** A pose anywhere the hub's own limits allow: a look-at point on the island, any zoom, polar 0.3 to 1.25, any turn. */
function hubPose(farm, rnd) {
  const maxTop = Math.max(...farm.fields.map((f) => f.topY));
  const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * farm.radius * 0.85;
  const target = [farm.center.x + Math.cos(a) * r, farm.center.y + rnd() * (maxTop - farm.center.y), farm.center.z + Math.sin(a) * r];
  // (mostly zoomed in: that's where the camera meets things)
  return { target, dist: farm.baseMin + rnd() * rnd() * (farm.maxDist - farm.baseMin), polar: 0.3 + rnd() * 0.95, azimuth: (rnd() * 2 - 1) * Math.PI };
}

describe('the hub camera', () => {
  it('the hub limits alone let the camera into the props; with its floor on, never', (t) => {
    // the exploration report's poses (each field's middle and 36 points round the 0.85 r disc, polar
    // 0.9, 1.1 and 1.25, 36 turns, at the closest zoom), and 2,000 anywhere on each farm
    let poses = 0, before = 0, after = 0;
    const worst = [];
    const check = (pose, farm, tents) => {
      poses++;
      if (clips(pose, farm)) before++;
      const out = S.liftClear(pose, tents);
      const why = clips(out, farm);
      if (why) { after++; worst.push(why); }
      assert.ok(S.clearOfTents(out, tents), 'lands on or over the floor');
    };
    const farm = DEMO, tents = HUB_TENTS['the demo farm'];
    const targets = [
      ...farm.fields.map((f) => [f.center[0], f.topY, f.center[1]]),
      ...Array.from({ length: 36 }, (_, k) => [farm.center.x + Math.cos((k / 36) * 2 * Math.PI) * farm.radius * 0.85, farm.center.y, farm.center.z + Math.sin((k / 36) * 2 * Math.PI) * farm.radius * 0.85]),
    ];
    for (const target of targets) for (const polar of [0.9, 1.1, 1.25]) for (let k = 0; k < 36; k++) {
      check({ target, dist: farm.baseMin, polar, azimuth: (k / 36) * 2 * Math.PI - Math.PI }, farm, tents);
    }
    const grid = { poses, before };
    for (const [name, f] of Object.entries(FARMS)) {
      const rnd = mulberry32(7);
      for (let i = 0; i < 2000; i++) check(hubPose(f, rnd), f, HUB_TENTS[name]);
    }
    assert.ok(grid.before > 0, 'the hub limits alone do let the camera into a prop (else this test proves nothing)');
    // (with the lighthouse on the top and the windmill on other high ground, the random poses can
    // all clear them; the grid still finds the clips)
    assert.ok(poses > 10000 && before >= grid.before, `${before} of ${poses} clip with the hub limits alone`);
    assert.equal(after, 0, `${after} of ${poses} poses still clip (${before} did before): ${worst.slice(0, 3).join('; ')}`);
    t.diagnostic(`${before} of ${poses} poses clipped with the hub limits alone (${grid.before} of ${grid.poses} on the grid); ${after} with its floor`);
  });

  it('keeps a drag on the windmill side out of it all the way round', () => {
    // a low look past the windmill, turned right round in small steps (the farmer's drag)
    const farm = DEMO, tents = HUB_TENTS['the demo farm'];
    const mill = farm.props.find((p) => p.key === 'windmill');
    for (const target of [[mill.x, farm.center.y, mill.z - 3], [mill.x + 2, farm.center.y, mill.z - 4], [farm.center.x, farm.center.y, farm.center.z]]) {
      for (const dist of [farm.baseMin, farm.baseMin + 2, farm.baseMin + 5]) {
        for (let k = 0; k <= 720; k++) {
          const out = S.liftClear({ target, dist, polar: 1.25, azimuth: (k / 720) * 2 * Math.PI - Math.PI }, tents);
          assert.equal(clips(out, farm), null, `turn ${k}, dist ${dist}`);
        }
      }
    }
  });

  for (const [name, farm] of Object.entries(FARMS)) {
    it(`leaves the camera as it was wherever nothing is in the way (${name})`, () => {
      const tents = HUB_TENTS[name];
      // the whole farm from the home view, and a look at every field from the hub's usual angles
      const ov = { target: [farm.center.x, farm.center.y, farm.center.z], dist: farm.overviewDist, polar: 0.84, azimuth: farm.home };
      assert.equal(S.liftClear(ov, tents), ov, 'the overview');
      let looks = 0, moved = 0;
      for (const f of farm.fields) {
        for (const azimuth of [-1.2, -0.8, -0.4, farm.home, 0, 0.4, 0.8]) {
          const look = { target: [f.center[0], f.topY, f.center[1]], dist: Math.max(farm.baseMin, farm.focusDistance(f.radius)), polar: 0.84, azimuth };
          looks++;
          const out = S.liftClear(look, tents);
          if (out !== look) { moved++; assert.ok(look.polar - out.polar < 0.02, `${f.id}: tipped up only a hair (${look.polar - out.polar})`); }
        }
      }
      assert.ok(moved <= Math.max(1, looks * 0.02), `${moved} of ${looks} field looks moved`);
      // and anywhere: a pose that is moved only tips up (same look-at point, distance and turn), by
      // as little as it can, and only a few poses are moved at all
      const rnd = mulberry32(31);
      let n = 0, changed = 0;
      for (let i = 0; i < 2000; i++) {
        const pose = hubPose(farm, rnd);
        n++;
        const out = S.liftClear(pose, tents);
        if (out === pose) { assert.ok(S.clearOfTents(pose, tents)); continue; }
        changed++;
        assert.deepEqual(out.target, pose.target);
        assert.equal(out.azimuth, pose.azimuth);
        assert.equal(out.dist, pose.dist);
        assert.ok(out.polar < pose.polar && out.polar >= 0.3 - 1e-12, 'only tips up');
        assert.ok(!S.clearOfTents({ ...out, polar: out.polar + 2e-4 }, tents), 'no further than it needs');
      }
      assert.ok(changed < n * 0.03, `${changed} of ${n} poses moved`);
    });

    it(`its floor is never higher than the tour's flat one (${name})`, () => {
      // so tipping up always finds a clear spot by the angle where the flat floor would hold it
      const tents = HUB_TENTS[name];
      let top = -Infinity;
      for (let x = -farm.radius * 1.3; x <= farm.radius * 1.3; x += 0.1) {
        for (let z = -farm.radius * 1.3; z <= farm.radius * 1.3; z += 0.1) top = Math.max(top, S.clearanceAt(tents, farm.center.x + x, farm.center.z + z));
      }
      assert.ok(top <= farm.floor + 1e-9, `${top.toFixed(2)} vs ${farm.floor.toFixed(2)}`);
      // and over the windmill's sails it is at least their top plus the pad
      const s = farm.sails[0];
      assert.ok(S.clearanceAt(tents, s.x, s.z) >= s.y + s.r + 0.3 - 1e-9);
    });
  }

  it('tents: a rotated box, its slope, the sails and the ground', () => {
    const barn = { key: 'barn', x: 2, z: -1, ry: Math.PI / 2, scale: 1, y: 0.5, box: { min: [-1, 0, -0.5], max: [1, 2, 0.5] } };
    const tents = S.makeTents({ props: [barn], sails: [{ x: 10, y: 4, z: 0, r: 1 }], heightAt: () => 0.2 });
    assert.equal(tents.list.length, 2);
    // turned a quarter: its long side runs along z
    assert.ok(near(S.clearanceAt(tents, 2, -1.9), 2.5 + 0.3), 'on the roof (along z, inside)');
    assert.ok(near(S.clearanceAt(tents, 2.6, -1), 2.5 + 0.3), 'within the pad of its short side');
    assert.ok(near(S.clearanceAt(tents, 3.3, -1), 2.8 - 0.5), 'down the slope: 0.8 out, 0.5 past the pad');
    assert.ok(near(S.clearanceAt(tents, 20, 20), 0.8), 'far off: the ground plus 0.6');
    assert.ok(near(S.clearanceAt(tents, 10, 0), 5.3), 'over the sails');
    // left out when it can't reach as high as the camera ever comes
    assert.equal(S.makeTents({ props: [barn], minY: 3 }).list.length, 0);
    assert.equal(S.makeTents({ boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }] }).list.length, 1);
    // with no tents at all a pose is left alone
    const pose = { target: [0, 0, 0], dist: 1, polar: 1.2, azimuth: 0 };
    assert.equal(S.liftClear(pose, null), pose);
    // and a broken one (NaN from somewhere else) comes straight back rather than looping
    const tall = S.makeTents({ boxes: [{ min: [-1, 0, -1], max: [1, 9, 1] }] });
    for (const bad of [{ ...pose, dist: NaN }, { ...pose, polar: NaN }, { ...pose, target: [NaN, 0, 0] }, { ...pose, dist: Infinity, polar: 0.5 }]) assert.equal(S.liftClear(bad, tall), bad);
  });

  it('backs off when even looking straight down is too close', () => {
    const tents = S.makeTents({ boxes: [{ min: [-1, 0, -1], max: [1, 9, 1] }] });
    const out = S.liftClear({ target: [0, 0, 0], dist: 4, polar: 1.0, azimuth: 0 }, tents, { minPolar: 0.3 });
    assert.ok(near(out.polar, 0.3));
    assert.ok(S.clearOfTents(out, tents) && out.dist > 4);
    const [x, y, z] = S.poseToPos(out);
    assert.ok(y > 9.3 || Math.abs(x) > 1.3 || Math.abs(z) > 1.3, 'out of the box and its pad');
  });
});

function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }
