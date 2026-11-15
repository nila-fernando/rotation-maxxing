// The lighthouse and the windmill on real islands (1, 5 and 15 fields), placed the way the reveal
// places them (src/screens/reveal.js): the barn, the silo and the hay round the farmyard, the
// starter buildings on their pads, the greenhouse and the well on open grass, then the lighthouse on
// the highest point and the windmill on other high ground, then the trees on their pads. Nothing
// may clip: the two keep clear of the fields, the pads, every prop and each other, the windmill's
// sails clear of everything (and the ground), and nothing comes up into the lighthouse's beam.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

// a canvas that draws nothing (the lighthouse's halo paints a little texture)
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) }) }),
};
let reducedMotion = false;
globalThis.matchMedia ??= () => ({ get matches() { return reducedMotion; }, addEventListener() {}, removeEventListener() {} });

const { planIsland } = await import('./plan.js');
const { makeHeightField } = await import('./terrain.js');
const { FOOTPRINT, makeBarn, makeSilo, makeHayBale, makeWindmill, makeTree } = await import('./props.js');
const { BUILDING_FOOTPRINT, makeFarmhouse, makeMachineShed, makeGrainBins, makeChickenCoop, makeGreenhouse, makeWell } = await import('./buildings.js');
const { makeLighthouse, LIGHTHOUSE, beamFloorAt } = await import('./lighthouse.js');
const { openGround, placeLighthouse, placeWindmill, sailDisc, underBeam, inRing, ringDistance, MILL } = await import('./landmarks.js');
const { pointInPropBox, propTop } = await import('./clearance.js');
const { demoFields, fifteenFields } = await import('./fakeIsland.mjs');

const PROP_SCALE = 0.75;
const demo = JSON.parse(readFileSync(new URL('../../data/demo-farm.json', import.meta.url), 'utf8'));
const SEED = demo.farm.name;
const HOME = demo.farm.center;

/** An island with everything on it, in the reveal's order. */
function buildFarm(input) {
  const plan = planIsland(input, { seed: SEED, home: HOME });
  const heightAt = makeHeightField(plan, { seed: SEED });
  const terrain = { heightAt, field: heightAt };
  const obstacles = [];
  const props = [];
  const objects = new Map(); // prop -> its object, placed and scaled on the island
  const addProp = (obj, [x, z], scale, ry = 0, key = null) => {
    const r = (FOOTPRINT[key] ?? BUILDING_FOOTPRINT[key] ?? 0.4) * scale;
    obstacles.push({ x, z, r });
    const box = new THREE.Box3();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { if ((o.isMesh || o.isSprite) && !o.userData.noBox) box.expandByObject(o, false); });
    const p = { key, x, z, r, ry, scale, height: Math.max(0, box.max.y) * scale, y: heightAt(x, z), box: { min: box.min.toArray(), max: box.max.toArray() } };
    props.push(p);
    const wrap = new THREE.Group();
    wrap.position.set(x, p.y, z);
    wrap.rotation.y = ry;
    wrap.scale.setScalar(scale);
    wrap.add(obj);
    wrap.updateMatrixWorld(true);
    objects.set(p, obj);
    return wrap;
  };

  // the barn, then the silo and a hay bale beside it, on the level yard
  const { at, facing = 0 } = plan.farmstead;
  addProp(makeBarn(), at, PROP_SCALE, facing, 'barn');
  const baseY = heightAt(at[0], at[1]);
  const placed = [{ at, r: FOOTPRINT.barn * PROP_SCALE }];
  const side = (a, d) => [at[0] + Math.sin(facing + a) * d, at[1] + Math.cos(facing + a) * d];
  const fits = ([x, z], r) => {
    for (let k = 0; k < 8; k++) {
      const px = x + Math.cos((k / 8) * Math.PI * 2) * r, pz = z + Math.sin((k / 8) * Math.PI * 2) * r;
      if (Math.abs(heightAt(px, pz) - baseY) > 0.06) return false;
    }
    if (plan.fields.some((pf) => pf.polygons.some((rings) => inRing([x, z], rings[0])))) return false;
    if (plan.slots.some((sl) => Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + r)) return false;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.12)) return false;
    return placed.every((p) => Math.hypot(p.at[0] - x, p.at[1] - z) > p.r + r + 0.12);
  };
  const yard = plan.farmstead.yard;
  const yardCands = (r, angles) => {
    const cands = [];
    for (const a of angles) for (const extra of [0.15, 0.4, 0.7]) cands.push(side(a, FOOTPRINT.barn * PROP_SCALE + r + extra));
    if (yard) for (let k = 0; k < 16; k++) for (const f of [0.8, 0.55, 0.3]) cands.push([yard.at[0] + Math.cos((k / 16) * Math.PI * 2) * (yard.r - r) * f, yard.at[1] + Math.sin((k / 16) * Math.PI * 2) * (yard.r - r) * f]);
    return cands;
  };
  const tryPlace = (make, key, angles) => {
    const r = (FOOTPRINT[key] ?? 0.5) * PROP_SCALE;
    for (const p of yardCands(r, angles)) if (fits(p, r)) { addProp(make(), p, PROP_SCALE, 0, key); placed.push({ at: p, r }); return; }
  };
  tryPlace(makeSilo, 'silo', [Math.PI / 2, -Math.PI / 2, (Math.PI * 3) / 4, -(Math.PI * 3) / 4]);
  tryPlace(() => makeHayBale(5), 'hayBale', [Math.PI, (Math.PI * 3) / 4, -(Math.PI * 3) / 4]);
  const ALL_ROUND = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k / 8) * Math.PI * 2);
  const yardSpots = (r) => yardCands(r, ALL_ROUND).filter((p) => fits(p, r));

  // the starter buildings on the pads nearest the farmyard (one pad stays free)
  const home = yard?.at || at;
  const faceFrom = ([x, z]) => Math.atan2(home[0] - x, home[1] + 3 - z);
  const starter = [['farmhouse', makeFarmhouse], ['machineShed', makeMachineShed], ['grainBins', makeGrainBins], ['chickenCoop', makeChickenCoop]];
  const pads = plan.slots.filter((sl) => sl.kind === 'building').sort((a, b) => Math.hypot(a.at[0] - home[0], a.at[1] - home[1]) - Math.hypot(b.at[0] - home[0], b.at[1] - home[1]));
  pads.slice(0, Math.min(starter.length, Math.max(0, pads.length - 1))).forEach((sl, i) => {
    const [key, make] = starter[i];
    addProp(make(), sl.at, Math.min(PROP_SCALE, sl.r / BUILDING_FOOTPRINT[key]), faceFrom(sl.at), key);
    sl.filled = key;
  });
  // the lighthouse on the highest point, before anything else takes it
  const open = openGround({ terrain, plan, obstacles });
  const openBefore = openGround({ terrain, plan, obstacles: obstacles.slice() });
  const lighthouse = placeLighthouse({ terrain, plan, obstacles, open, addProp, make: makeLighthouse, props, yardSpots, scale: PROP_SCALE });
  // the greenhouse and the well on open grass near the yard
  const openSpot = (r) => {
    const cands = [];
    for (let d = (yard?.r || 1) + 0.5; d < 7; d += 0.35) {
      const n = Math.round(d * 7);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = home[0] + Math.cos(a) * d, z = home[1] + Math.sin(a) * d;
        cands.push({ x, z, score: d - (z - home[1]) * 0.25 });
      }
    }
    cands.sort((p, q) => p.score - q.score);
    const c = cands.find((p) => open(p.x, p.z, r));
    return c ? [c.x, c.z] : null;
  };
  for (const [key, make] of [['greenhouse', makeGreenhouse], ['well', makeWell]]) {
    for (const scale of [PROP_SCALE, PROP_SCALE * 0.82]) {
      const spot = openSpot(BUILDING_FOOTPRINT[key] * scale);
      if (spot) { addProp(make(), spot, scale, faceFrom(spot), key); break; }
    }
  }

  // the windmill on other high ground
  const windmill = placeWindmill({ terrain, plan, obstacles, open, addProp, make: makeWindmill, lighthouse, yardSpots, scale: PROP_SCALE });

  // then the trees on their pads
  const kinds = ['tulip-green', 'round', 'pine', 'blossom', 'tulip-yellow', 'round'];
  plan.slots.filter((sl) => sl.kind === 'tree').forEach((sl, i) => addProp(makeTree(kinds[i % kinds.length], 20 + i), sl.at, PROP_SCALE * (0.85 + (i % 3) * 0.1), 0, kinds[i % kinds.length] === 'pine' ? 'pine' : 'tree'));

  return { plan, heightAt, terrain, obstacles, props, objects, lighthouse, windmill, openBefore };
}

const FARMS = {
  'one field': buildFarm([demoFields[0]]),
  'the demo farm (5 fields)': buildFarm(demoFields),
  'fifteen fields': buildFarm(fifteenFields()),
};

const propOf = (farm, key) => farm.props.find((p) => p.key === key);

/** Points round the windmill's sails, in island space: the hub, and the blade tips and middles all the way round. */
function sailPoints(farm) {
  const w = farm.windmill;
  const d = sailDisc(farm.terrain, w.x, w.z, w.ry, w.scale);
  const pts = [[d.x, d.y, d.z]];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    for (const f of [0.35, 0.7, 1]) {
      const l = Math.sin(a) * d.R * f, up = Math.cos(a) * d.R * f;
      for (const out of [-0.03, 0.03]) pts.push([d.x + d.px * l + d.fx * out, d.y + up, d.z + d.pz * l + d.fz * out]);
    }
  }
  return pts;
}

describe('the lighthouse and the windmill on real islands', () => {
  for (const [name, farm] of Object.entries(FARMS)) {
    describe(name, () => {
      const lh = propOf(farm, 'lighthouse');
      const mill = propOf(farm, 'windmill');

      it('has both, placed by the high-ground search (not a fallback)', () => {
        assert.ok(farm.lighthouse && lh, 'a lighthouse');
        assert.ok(farm.windmill && mill, 'a windmill');
        assert.equal(lh.scale, PROP_SCALE, 'the lighthouse at full size');
      });

      it('the lighthouse stands on the highest open ground, the windmill lower and well away', () => {
        // the highest open spot, as open() saw it when the lighthouse went up
        const f = farm.heightAt;
        const [cx, cz] = f.center;
        let top = -Infinity;
        for (let x = cx - f.maxCoast; x <= cx + f.maxCoast; x += 0.25) {
          for (let z = cz - f.maxCoast; z <= cz + f.maxCoast; z += 0.25) if (farm.openBefore(x, z, lh.r)) top = Math.max(top, f(x, z));
        }
        assert.ok(lh.y > top - 0.05, `lighthouse at ${lh.y.toFixed(2)}, highest open ground ${top.toFixed(2)}`);
        assert.ok(mill.y <= lh.y + 1e-6, `windmill at ${mill.y.toFixed(2)} not above the lighthouse at ${lh.y.toFixed(2)}`);
        const apart = Math.hypot(mill.x - lh.x, mill.z - lh.z);
        assert.ok(apart > farm.lighthouse.reach + 1.0, `${apart.toFixed(2)} apart`);
      });

      it('both keep clear of the fields, the pads and every other prop', () => {
        for (const p of [lh, mill]) {
          for (const pf of farm.plan.fields) {
            for (const rings of pf.polygons) {
              assert.ok(!inRing([p.x, p.z], rings[0]), `${p.key} in field ${pf.id}`);
              assert.ok(ringDistance([p.x, p.z], rings[0]) > p.r + 0.2, `${p.key} on field ${pf.id}'s fence`);
            }
          }
          for (const sl of farm.plan.slots) {
            if (sl.filled) continue;
            assert.ok(Math.hypot(sl.at[0] - p.x, sl.at[1] - p.z) > sl.r + p.r, `${p.key} on a ${sl.kind} pad`);
          }
          for (const q of farm.props) {
            if (q === p) continue;
            const d = Math.hypot(q.x - p.x, q.z - p.z);
            assert.ok(d > q.r + p.r + 0.1, `${p.key} and ${q.key} ${d.toFixed(2)} apart (footprints ${(q.r + p.r).toFixed(2)})`);
          }
        }
      });

      it('the windmill\'s sails turn clear of everything and above the ground', () => {
        const pts = sailPoints(farm);
        for (const q of farm.props) {
          if (q === mill) continue;
          for (const pt of pts) assert.ok(!pointInPropBox(pt, q, 0.05), `a sail runs into the ${q.key}`);
        }
        for (const [x, y, z] of pts) assert.ok(y > farm.heightAt(x, z) + 0.04, `a sail in the ground at ${x.toFixed(2)}, ${z.toFixed(2)}`);
      });

      it('nothing comes up into the lighthouse\'s beam', () => {
        const L = farm.lighthouse;
        for (const q of farm.props) {
          if (q === lh) continue;
          assert.ok(underBeam(L, q.x, q.z, q.r, propTop(q)), `the ${q.key} reaches into the beam`);
        }
        // and the sails, wherever they are in their turn
        for (const [x, y, z] of sailPoints(farm)) {
          assert.ok(underBeam(L, x, z, 0, y), 'a windmill sail reaches into the beam');
        }
      });

      it('both can be seen from the camera\'s side: nothing big stands in front of them', () => {
        for (const p of [lh, mill]) {
          for (const q of farm.props) {
            if (q === p || q.r <= 0.4) continue;
            // (in front, toward the camera, and tall enough to cover half of it)
            const inFront = q.z > p.z && q.z - p.z < 3 && Math.abs(q.x - p.x) < q.r + 0.55 && propTop(q) > p.y + p.height * 0.5;
            assert.ok(!inFront, `the ${q.key} hides the ${p.key}`);
          }
        }
        assert.ok(!(mill.z > lh.z && mill.z - lh.z < 3.2 && Math.abs(mill.x - lh.x) < 1.3), 'the windmill stands in front of the lighthouse');
      });

      it('the sheep walk round both (their footprints are obstacles, and the space under the sails)', () => {
        for (const p of [lh, mill]) assert.ok(farm.obstacles.some((o) => o.x === p.x && o.z === p.z && o.r >= p.r), `${p.key} is an obstacle`);
        const d = sailDisc(farm.terrain, farm.windmill.x, farm.windmill.z, farm.windmill.ry, farm.windmill.scale);
        assert.ok(farm.obstacles.some((o) => Math.hypot(o.x - d.x, o.z - d.z) < 0.01), 'the space under the sails');
      });
    });
  }
});

describe('the lighthouse', () => {
  it('is to scale with the barn and the windmill, and its beam and halo are not part of its box', () => {
    const lh = makeLighthouse();
    const solid = new THREE.Box3();
    lh.updateMatrixWorld(true);
    lh.traverse((o) => { if ((o.isMesh || o.isSprite) && !o.userData.noBox) solid.expandByObject(o, false); });
    assert.ok(Math.abs(solid.max.y - LIGHTHOUSE.top) < 0.02, `top at ${solid.max.y.toFixed(2)}`);
    assert.ok(solid.max.y > MILL.top && solid.max.y < MILL.top * 1.15, 'a little taller than the windmill');
    assert.ok(solid.max.x < 0.7 && solid.min.z > -0.7, 'about as wide as the windmill');
    const beams = lh.userData.beacon.beams;
    beams.traverse((o) => { if (o.isMesh) assert.ok(o.userData.noBox, 'the beam is light, not a solid'); });
    assert.ok(lh.userData.beacon.halo.userData.noBox);
    for (const o of [beams, lh.userData.beacon.halo, lh.userData.beacon.glass]) assert.ok(lh.userData.keep.includes(o), 'kept out of the merge');
  });

  it('lights up at night and goes dark by day, with no lights of its own', () => {
    const lh = makeLighthouse();
    lh.traverse((o) => assert.ok(!o.isLight, 'no three.js lights'));
    const b = lh.userData.beacon;
    b.update(-1, 0);
    assert.equal(b.beams.visible, false, 'no beam by day');
    assert.equal(b.halo.visible, false);
    const dayGlow = b.glass.material.emissiveIntensity;
    b.update(-1, 1);
    assert.equal(b.beams.visible, true, 'the beam at night');
    assert.ok(b.glass.material.emissiveIntensity > dayGlow * 5, 'the lantern glows');
    assert.ok(b.beams.children[0].material.blending === THREE.AdditiveBlending && !b.beams.children[0].material.depthWrite, 'a soft additive beam');
    // it eases on and off over a moment, not in one frame
    b.update(-1, 0);
    b.update(1 / 30, 1);
    assert.ok(b.lit > 0 && b.lit < 0.2, `eased (${b.lit.toFixed(2)})`);
    // and snow and the seasons leave the glass and the beam alone
    assert.ok(b.glass.material.userData.noSeason && b.beams.children[0].material.userData.noSeason);
  });

  it('sweeps slowly round, holds still with reduced motion and while paused', () => {
    const b = makeLighthouse().userData.beacon;
    b.update(-1, 1);
    const a0 = b.beams.rotation.y;
    b.update(1, 1);
    const turned = b.beams.rotation.y - a0;
    assert.ok(turned > 0.2 && turned < 0.8, `turned ${turned.toFixed(2)} rad in a second`);
    const a1 = b.beams.rotation.y;
    b.update(0, 1);
    assert.equal(b.beams.rotation.y, a1, 'still while paused');
    reducedMotion = true;
    try {
      b.update(1, 1);
      assert.equal(b.beams.rotation.y, a1, 'still with reduced motion');
      assert.equal(b.beams.visible, true, '(still shining)');
    } finally { reducedMotion = false; }
  });

  it('its beam stays high: it only ever reaches down to about the lantern room\'s foot', () => {
    for (let d = 0; d <= LIGHTHOUSE.beamLength * PROP_SCALE; d += 0.1) {
      assert.ok(beamFloorAt(d, PROP_SCALE) > (LIGHTHOUSE.lanternY - LIGHTHOUSE.beamRadius) * PROP_SCALE - 0.01);
    }
    assert.equal(beamFloorAt(LIGHTHOUSE.beamLength * PROP_SCALE + 0.2, PROP_SCALE), Infinity);
  });
});
