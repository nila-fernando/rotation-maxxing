// Where the soil jars stand (src/island/jarSpots.js), on the festival themes' small farm and on
// real islands of 1, 5 and 15 fields (src/island/fakeIsland.mjs): by the gate, never in a field,
// a fence, a prop, the sails, a lamp, a pad, a sheep, a tuft, a coin stack's column, another jar or
// a festival's things, on level ground, and the same spot every time.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

const { fakeView, plannedView, demoFields, fifteenFields } = await import('./fakeIsland.mjs');
const { JAR, FENCE_CLEAR, GATE_SIDE, GATE_OUT, OB_PAD, JAR_OB_R, jarBox, jarCandidates, jarBlocked, jarSpot, rayHitsBall } = await import('./jarSpots.js');
const { jarField, jarEnv, jarKeepOuts, createJars, JAR_SETTLE } = await import('./jarProps.js');
const { columnBlocked, stackSpots, columnBox } = await import('./stackSpots.js');
const { pointInPolygons, distanceToEdges } = await import('./picking.js');
const { makeThemeContext, clearClipping, THEMES } = await import('./themes/index.js');
const { themeKeepOuts } = await import('./coinStacks.js');

const meets = (a, b) => !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y || a.max.z < b.min.z || a.min.z > b.max.z);
const meetsXZ = (a, b) => !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.z < b.min.z || a.min.z > b.max.z);

/** Places a jar for every field in turn (each one keeps off the ones before): Map id -> spot | null. */
function placeAll(view, keepOuts = []) {
  const jars = [];
  const out = new Map();
  for (const vf of view.fields) {
    const s = jarSpot(jarField(vf, view), jarEnv(view, { keepOuts, jars }));
    out.set(vf.id, s);
    if (s) jars.push({ fieldId: vf.id, x: s.x, z: s.z });
  }
  return out;
}

/** Everything a placed jar must be clear of, checked from scratch. */
function checkJar(id, spot, env, view) {
  const { R } = JAR;
  const at = `${id} at (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)})`;
  for (const f of view.fields) {
    assert.ok(!pointInPolygons(spot.x, spot.z, f.polygons), `${at} is in ${f.id}`);
    const d = distanceToEdges(spot.x, spot.z, f.polygons);
    assert.ok(d >= R + FENCE_CLEAR - 1e-9, `${at} is ${d.toFixed(3)} from ${f.id}'s fence`);
  }
  assert.ok(!columnBlocked(spot.box, env), `${at} meets a prop, the sails, a lamp or a keep-out`);
  for (const o of env.obstacles) if (!(o.x === spot.x && o.z === spot.z && o.r === JAR_OB_R)) assert.ok(Math.hypot(o.x - spot.x, o.z - spot.z) >= o.r + R + OB_PAD - 1e-9, `${at} is on an obstacle`);
  for (const sl of view.slots || []) assert.ok(Math.hypot(sl.at[0] - spot.x, sl.at[1] - spot.z) >= sl.r + R + 0.1 - 1e-9, `${at} is on a pad`);
  for (const s of env.sheep) assert.ok(Math.hypot(s.x - spot.x, s.z - spot.z) >= R + 0.25 + s.size * 0.6 - 1e-9, `${at} is on a sheep`);
  for (const t of env.tufts) assert.ok(Math.hypot(t.x - spot.x, t.z - spot.z) >= t.r + R + 0.02 - 1e-9, `${at} is on a tuft`);
  // level: the middle and 8 points round the rim within 0.05, and it stands on the lowest
  const hs = [view.heightAt(spot.x, spot.z)];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; hs.push(view.heightAt(spot.x + Math.cos(a) * (R + 0.02), spot.z + Math.sin(a) * (R + 0.02))); }
  assert.ok(Math.max(...hs) - Math.min(...hs) <= 0.05 + 1e-9, `${at} is not level`);
  assert.ok(Math.abs(spot.ground - Math.min(...hs)) < 1e-9, `${at} stands on the lowest point`);
  assert.deepEqual(spot.box, jarBox(spot.x, spot.z, spot.ground));
  assert.ok(spot.box.max.y - spot.box.min.y >= JAR.TOP, 'the box holds the lid');
}

/** The checker over every placed jar of a farm, plus every pair apart and the coin stacks' columns. */
function checkFarm(view, spots, keepOuts = []) {
  const env = jarEnv(view, { keepOuts });
  const placed = [...spots.entries()].filter(([, s]) => s);
  for (const [id, s] of placed) checkJar(id, s, env, view);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const [a, b] = [placed[i][1], placed[j][1]];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2 * JAR.R + 0.15, `${placed[i][0]} and ${placed[j][0]} are too close`);
  }
  // the plan view's coin stacks float over the fields: no jar is under one
  const columns = stackSpots(view.fields.map((f) => ({ polygons: f.polygons, topY: f.topY, isPivot: !!f.paddock?.userData?.isPivot, id: f.id })), env);
  for (const [cid, c] of columns) if (c) for (const [id, s] of placed) assert.ok(!meetsXZ(columnBox(c.x, c.z, c.baseY), s.box), `${id}'s jar is under ${cid}'s coins`);
  return placed.length;
}

describe('jar spots', () => {
  it('beside the gate post on the small farm, clear of everything', () => {
    const view = fakeView();
    const spots = placeAll(view);
    assert.equal(checkFarm(view, spots), 4, 'every field has a jar');
    for (const vf of view.fields) {
      const s = spots.get(vf.id);
      const g = jarField(vf, view).gate;
      assert.equal(s.by, 'gate');
      // beside a gate post: GATE_SIDE along the fence and GATE_OUT out (not in the gateway)
      const along = Math.abs((s.x - g.x) * -g.nz + (s.z - g.z) * g.nx), out = (s.x - g.x) * g.nx + (s.z - g.z) * g.nz;
      assert.ok(Math.abs(along - GATE_SIDE) < 1e-9 && Math.abs(out - GATE_OUT) < 1e-9, `${vf.id} beside the post (${along.toFixed(2)}, ${out.toFixed(2)})`);
    }
    // f3's first spot has the sheep on it, so it takes the other side of the gate
    const c = jarCandidates(jarField(view.fields[3], view));
    assert.equal(jarBlocked(c[0].x, c[0].z, jarEnv(view)), 'sheep');
    assert.deepEqual([spots.get('f3').x, spots.get('f3').z], [c[1].x, c[1].z]);
  });

  for (const [name, input, least] of [['one field', [demoFields[0]], 1], ['the demo farm', demoFields, 5], ['fifteen fields', fifteenFields(), 13]]) {
    it(`clear of everything on a real island: ${name}`, () => {
      const view = plannedView(input);
      const spots = placeAll(view);
      const n = checkFarm(view, spots);
      // (a real island is crowded: a raised field's gate often sits at the top of a terrace step,
      // with no level ground near it, so some jars stand further round the field, and now and then
      // one finds no spot at all)
      assert.ok(n >= least, `${n} of ${input.length} fields have a jar (want ${least} or more)`);
      for (const [id, s] of spots) {
        if (!s) continue;
        const own = distanceToEdges(s.x, s.z, view.fields.find((f) => f.id === id).polygons);
        for (const f of view.fields) if (f.id !== id) assert.ok(distanceToEdges(s.x, s.z, f.polygons) >= own, `${id}'s jar is nearer ${f.id}`);
      }
    });
  }

  it('the same spot every time', () => {
    const a = placeAll(plannedView());
    const b = placeAll(plannedView());
    assert.deepEqual([...a.entries()], [...b.entries()]);
    const c = placeAll(fakeView()), d = placeAll(fakeView());
    assert.deepEqual([...c.entries()], [...d.entries()]);
  });

  it('a prop on the first spot moves it to the second; blocking every spot gives null', () => {
    const view = fakeView();
    const vf = view.fields[0];
    const jf = jarField(vf, view);
    const [c1, c2] = jarCandidates(jf);
    assert.deepEqual([jarSpot(jf, jarEnv(view)).x, jarSpot(jf, jarEnv(view)).z], [c1.x, c1.z]);
    view.props.push({ key: 'hayBale', x: c1.x, z: c1.z, r: 0.1, ry: 0, scale: 1, height: 0.3, y: 0.6, box: { min: [-0.1, 0, -0.1], max: [0.1, 0.3, 0.1] } });
    const moved = jarSpot(jf, jarEnv(view));
    assert.deepEqual([moved.x, moved.z, moved.by], [c2.x, c2.z, 'gate']);
    const all = { min: { x: -50, y: -5, z: -50 }, max: { x: 50, y: 5, z: 50 } };
    assert.equal(jarSpot(jf, jarEnv(view, { keepOuts: [all] })), null);
    assert.equal(jarBlocked(c2.x, c2.z, jarEnv(view, { keepOuts: [all] })), 'prop');
  });

  it('each reason', () => {
    const view = fakeView();
    const env = jarEnv(view);
    const withJar = jarEnv(view, { jars: [{ fieldId: 'fx', x: 0, z: 3.2 }] });
    assert.equal(jarBlocked(-3.2, -2.6, env), 'field', 'in a field');
    assert.equal(jarBlocked(-2.1 + 0.15, -2.6, env), 'field', 'by its fence');
    assert.equal(jarBlocked(0, -0.4, env), 'obstacle', 'in the barn');
    assert.equal(jarBlocked(-2.4, -1.25, env), 'slot', 'on a pad');
    assert.equal(jarBlocked(0, 3.2, { ...env, sheep: [{ x: 0.4, z: 3.5, size: 0.6 }] }), 'sheep');
    assert.equal(jarBlocked(0.1, 3.2, withJar), 'jar');
    assert.equal(jarBlocked(0.1, 3.2, withJar, { fieldId: 'fx' }), null, "a jar's own spot doesn't count");
    assert.equal(jarBlocked(0, 3.2, { ...env, tufts: [{ x: 0.1, z: 3.25, r: 0.06 }] }), 'tuft');
    assert.equal(jarBlocked(0.2 + 0.2, 4.6, env), 'prop', 'a lamp post');
    assert.equal(jarBlocked(0, 3.2, { ...env, pathMask: () => 0.6 }), 'path');
    assert.equal(jarBlocked(0, 3.2, { ...env, pondMask: (x) => (x > 0.2 ? 0.5 : 0) }), 'pond', 'at the edge of a pond');
    assert.equal(jarBlocked(0, 3.2, { ...env, heightAt: (x) => 0.6 + x * 0.4 }), 'ground', 'on a slope');
    assert.equal(jarBlocked(0, 3.2, { ...env, cragMask: () => 0.1 }), 'ground', 'on the crag');
    assert.equal(jarBlocked(0, 3.2, { ...env, minHeight: 0.7 }), 'coast', 'down on the beach');
    assert.equal(jarBlocked(0, 3.2, { ...env, coastR: () => 3.5 }), 'coast', 'by the shore');
    assert.equal(jarBlocked(0, 3.2, env), null);
    // a jar's own obstacle doesn't block it
    const own = { x: 0, z: 3.2, r: JAR_OB_R };
    view.obstacles.push(own);
    assert.equal(jarBlocked(0, 3.2, jarEnv(view)), 'obstacle');
    assert.equal(jarBlocked(0, 3.2, jarEnv(view), { obstacle: own }), null);
  });

  it('a centre pivot (no fence, no gate) gets one beside its edge nearest the farmyard', () => {
    const view = fakeView();
    const circle = Array.from({ length: 48 }, (_, i) => [3.4 + Math.cos((i / 48) * Math.PI * 2) * 1.2, 2.9 + Math.sin((i / 48) * Math.PI * 2) * 1.2]);
    view.fields[3] = { id: 'f3', polygons: [[circle]], topY: 0.75, paddock: { userData: { gate: null, isPivot: true } }, gateToward: [0, -0.4] };
    const jf = jarField(view.fields[3], view);
    assert.equal(jf.pivot, true);
    const s = jarSpot(jf, jarEnv(view));
    assert.ok(s, 'has a spot');
    assert.equal(s.by, 'beside');
    // on the farmyard's side of the circle, just outside it
    const d = Math.hypot(s.x - 3.4, s.z - 2.9);
    assert.ok(d > 1.2 + JAR.R + FENCE_CLEAR - 1e-6 && d < 1.2 + 2.1, `${d.toFixed(2)} from the middle`);
    assert.ok(Math.hypot(s.x, s.z + 0.4) < Math.hypot(3.4, 2.9 + 0.4), 'nearer the farmyard than the middle is');
    // a field that has a gate but is a pivot still goes by its edge
    const g = jarField({ ...view.fields[3], paddock: { userData: { gate: { x: 2.2, z: 2.9, nx: -1, nz: 0 }, isPivot: true } } }, view);
    assert.equal(jarCandidates(g)[0].by, 'beside');
  });

  it("carries a paddock's gate into island space", () => {
    const view = fakeView();
    const holder = new THREE.Group();
    holder.position.set(2, 0.5, -1);
    holder.rotation.y = Math.PI / 2;
    const paddock = new THREE.Group();
    paddock.userData = { gate: { x: 1, z: 0, nx: 1, nz: 0 }, isPivot: false };
    holder.add(paddock);
    view.scene.add(holder);
    view.island.position.set(0.5, 0, 0);
    const jf = jarField({ id: 'f9', polygons: view.fields[0].polygons, paddock }, view);
    // turned a quarter: paddock +x is world -z; then less the island's 0.5 shift
    assert.ok(Math.abs(jf.gate.x - 1.5) < 1e-9 && Math.abs(jf.gate.z - -2) < 1e-9, `${jf.gate.x}, ${jf.gate.z}`);
    assert.ok(Math.abs(jf.gate.nx) < 1e-9 && Math.abs(jf.gate.nz + 1) < 1e-9);
    assert.deepEqual(jf.toward, [0, 0], 'faces the view centre when the field has no gateToward');
    assert.equal(jarField({ id: 'x', polygons: [], paddock: { userData: {} } }, view).gate, null);
  });

  describe('festival themes', () => {
    const rec = (id) => ({ v: 1, fieldId: id, textureClass: 'Clay loam', layers: [{ type: 'water', rgb: [120, 140, 150], share: 0.4 }, { type: 'clay', rgb: [150, 100, 80], share: 0.3 }, { type: 'sand', rgb: [190, 170, 130], share: 0.3 }] });
    // a theme built as src/island/themes/index.js builds it; grown: popped all the way in, as it is
    // once it has been on show a second or so (some of its things start at nothing and grow)
    const theme = async (view, key, { grown = true } = {}) => {
      const ctx = makeThemeContext(view, { attach: () => {} });
      const api = (await import(`./themes/${key}.js`)).default(ctx);
      let host = view.island.getObjectByName('Festival themes');
      if (!host) { host = new THREE.Group(); host.name = 'Festival themes'; view.island.add(host); }
      host.add(api.root);
      clearClipping(api.root, ctx, { obstacles: view.obstacles });
      if (grown) api.update?.(0, 0.4, { night: 0, k: 1 });
      return { api, ctx, host };
    };
    // every mesh and instance a theme kept, unpadded, long strings in pieces
    const pieces = (root) => root.children.flatMap((kid) => themeKeepOuts(kid, { pad: 0, split: 0.3 }).map((b) => ({ b, kid })));
    // nothing of the theme in any jar, through a stretch of its animation (bunnies hop, turkeys strut,
    // balloons bob), by day and by night
    const clearThroughTime = (api, view, spotOf, what) => {
      for (const [time, night] of [[0.4, 0], [1.7, 0], [3.1, 1], [5.3, 0], [8.9, 1]]) {
        api.update?.(0.016, time, { night, k: 1 });
        const all = pieces(api.root);
        for (const f of view.fields) {
          const s = spotOf(f.id);
          if (s) for (const { b, kid } of all) assert.ok(!meets(jarBox(s.x, s.z, s.ground), b), `${what}: ${kid.name} is in ${f.id}'s jar at ${time} s`);
        }
      }
    };

    for (const key of THEMES) {
      it(`${key}: built after the jar, it goes round it, and a refresh moves the jar off what hangs on the fences`, async () => {
        const view = fakeView();
        const jars = createJars(view, { reduced: () => true });
        const first = jars.set(view.fields.map((f) => rec(f.id)));
        const { api } = await theme(view, key);
        // what stands free goes round the jar (it's on view.obstacles)
        for (const { b, kid } of pieces(api.root)) {
          const u = kid.userData;
          if (u.noPop || u.onFence || u.onBuilding) continue;
          for (const [id, s] of first) if (s) assert.ok(!meets(jarBox(s.x, s.z, s.ground), b), `${kid.name} is in ${id}'s jar`);
        }
        // what hangs on the fences and gates doesn't know the jar is there: the refresh (when the
        // festival comes) moves the jar off it, or takes it away
        jars.refresh();
        for (const id of first.keys()) {
          const s = jars.spotOf(id);
          if (!s) continue;
          for (const { b, kid } of pieces(api.root)) assert.ok(!meets(jarBox(s.x, s.z, s.ground), b), `${kid.name} is in ${id}'s jar after the refresh`);
        }
        clearThroughTime(api, view, jars.spotOf, key);
        const after = new Map(view.fields.map((f) => [f.id, jars.spotOf(f.id) && { ...jars.spotOf(f.id), box: jarBox(jars.spotOf(f.id).x, jars.spotOf(f.id).z, jars.spotOf(f.id).ground) }]));
        checkFarm(view, after, jarKeepOuts(view.island));
        jars.dispose();
      });

      it(`${key}: built before the jar, the jar keeps off its things`, async () => {
        const view = fakeView();
        const { api } = await theme(view, key);
        const outs = jarKeepOuts(view.island);
        assert.ok(outs.length > 0);
        const spots = placeAll(view, outs);
        const n = checkFarm(view, spots, outs);
        // (grown all the way in, Easter's eggs and bows fill the small farm's fences: 2 of 4)
        assert.ok(n >= 2, `${n} jars find a spot`);
        for (const [id, s] of spots) if (s) for (const b of outs) assert.ok(!meets(s.box, b), `${id}'s jar meets a festival box`);
        clearThroughTime(api, view, (id) => spots.get(id), key);
      });
    }

    it('on the real demo farm, through every festival: nothing of the festival is in a jar after the refresh', async () => {
      const shown = {};
      for (const key of THEMES) {
        const view = plannedView();
        const jars = createJars(view, { reduced: () => true });
        jars.set(view.fields.map((f) => rec(f.id)));
        const { api } = await theme(view, key);
        jars.refresh();
        const all = pieces(api.root);
        const spots = new Map(view.fields.map((f) => [f.id, jars.spotOf(f.id)]));
        for (const [id, s] of spots) if (s) for (const { b, kid } of all) assert.ok(!meets(jarBox(s.x, s.z, s.ground), b), `${key}: ${kid.name} is in ${id}'s jar`);
        clearThroughTime(api, view, jars.spotOf, key);
        shown[key] = [...spots.values()].filter(Boolean).length;
        checkFarm(view, new Map([...spots].map(([id, s]) => [id, s && { ...s, box: jarBox(s.x, s.z, s.ground) }])), jarKeepOuts(view.island));
        jars.dispose();
      }
      // (a festival hangs lights, bunting and bows along most fences, so some jars go while it's on)
      assert.ok(Object.values(shown).some((n) => n > 0), JSON.stringify(shown));
    });

    it('a refresh while a festival is still popping in: the check a moment later moves the jars off what grew', async () => {
      // (Thanksgiving's pumpkins and leaves by the fences start at nothing and grow in with the theme,
      // so a refresh in the middle of that doesn't see them all)
      let moved = 0;
      for (const input of [demoFields, fifteenFields()]) {
        const view = plannedView(input);
        const jars = createJars(view, { reduced: () => false });
        jars.set(view.fields.map((f) => rec(f.id)));
        const { api } = await theme(view, 'thanksgiving', { grown: false });
        api.update?.(0, 0.4, { night: 0, k: 0.3 }); // a third of the way in
        jars.refresh();
        const early = new Map(view.fields.map((f) => [f.id, jars.spotOf(f.id)]));
        api.update?.(0, 0.4, { night: 0, k: 1 }); // and all the way
        for (let t = 0; t < JAR_SETTLE + 0.5; t += 1 / 30) jars.step(1 / 30);
        for (const [id, s] of early) if (JSON.stringify(s) !== JSON.stringify(jars.spotOf(id))) moved++;
        clearThroughTime(api, view, jars.spotOf, `thanksgiving on ${input.length} fields`);
        jars.dispose();
      }
      assert.ok(moved > 0, 'the late check moved a jar (or there was nothing to catch)');
    });

    it('long strings along the fences are measured in pieces, not one box the size of the field', () => {
      const host = new THREE.Group();
      host.name = 'Festival themes';
      // a string of lights round a 2 x 2 field, as one geometry
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const t = (i / 80) * 8, side = Math.floor(t / 2), u = t - side * 2 - 1;
        const [x, z] = [[u, -1], [1, u], [-u, 1], [-1, -u]][Math.min(3, side)];
        pts.push(new THREE.Vector3(x, 1, z));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.02, 4, true));
      host.add(tube);
      const whole = themeKeepOuts(host, { pad: 0.12 });
      assert.equal(whole.length, 1);
      const split = jarKeepOuts(host);
      assert.ok(split.length > 8, `${split.length} pieces`);
      const inside = { min: { x: -0.2, y: 0.9, z: -0.2 }, max: { x: 0.2, y: 1.1, z: 0.2 } }; // the middle of the field, at the lights' height
      assert.ok(meets(whole[0], inside), 'one box fills the whole field');
      assert.ok(!split.some((b) => meets(b, inside)), 'the pieces only follow the string');
      for (const b of split) assert.ok(whole[0].containsBox(b));
    });
  });

  it('rayHitsBall: a hit, a miss and a ball behind the ray', () => {
    const ball = { x: 0, y: 0, z: 0, r: 1 };
    assert.ok(Math.abs(rayHitsBall({ x: 0, y: 5, z: 0 }, { x: 0, y: -2, z: 0 }, ball) - 4) < 1e-9, 'hits at 4 (dir need not be unit length)');
    assert.equal(rayHitsBall({ x: 3, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, ball), null, 'misses');
    assert.equal(rayHitsBall({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 }, ball), null, 'behind');
    assert.equal(rayHitsBall({ x: 0, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 }, ball), 0, 'from inside');
    assert.equal(rayHitsBall({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }, ball), null, 'no direction');
  });

  it('jarBox holds the jar, lid and all', () => {
    const b = jarBox(1, 2, 0.5);
    const want = { min: { x: 1 - JAR.R - 0.01, y: 0.5, z: 2 - JAR.R - 0.01 }, max: { x: 1 + JAR.R + 0.01, y: 0.5 + JAR.TOP + 0.02, z: 2 + JAR.R + 0.01 } };
    for (const e of ['min', 'max']) for (const a of ['x', 'y', 'z']) assert.ok(Math.abs(b[e][a] - want[e][a]) < 1e-12, `${e}.${a}`);
    assert.ok(JAR.H + JAR.LID_H <= JAR.TOP && JAR.LID_R <= JAR.R + 0.01);
  });
});
