// The soil jars on the island (src/island/jarProps.js), with three.js and no renderer: one group
// per jar with the field's real layer colours, no shadows, no lights, no snow but on the lid; an
// obstacle the sheep walk round; picking, focus, the pop-in, refresh, and leaving the island as it
// found it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

const { fakeView } = await import('./fakeIsland.mjs');
const { createJars, jarLayers, jarField, JAR_SETTLE } = await import('./jarProps.js');
const { JAR, OB_PAD, jarCandidates, jarBox } = await import('./jarSpots.js');

/** The sample jar's record (src/plan/jarTest.js toRecord), top to bottom. */
const RECORD = {
  v: 1, fieldId: 'f2', at: '2026-11-15T10:00:00.000Z', sample: true, elapsed: 'ok',
  textureClass: 'Clay loam', sandPct: 38, siltPct: 35, clayPct: 27, confidence: 'high', adjusted: false,
  layers: [
    { type: 'air', rgb: [210, 225, 232], share: 0.06 },
    { type: 'foam', rgb: [230, 232, 230], share: 0.02 },
    { type: 'water', rgb: [168, 160, 140], share: 0.2 },
    { type: 'tea', rgb: [190, 140, 70], share: 0.1 },
    { type: 'organic', rgb: [70, 50, 35], share: 0.04 },
    { type: 'clay', rgb: [140, 96, 70], share: 0.16 },
    { type: 'silt', rgb: [178, 150, 100], share: 0.16 },
    { type: 'sand', rgb: [205, 180, 130], share: 0.2 },
    { type: 'gravel', rgb: [10, 10, 12], share: 0.06 },
  ],
  warnings: [],
};
const record = (fieldId, over = {}) => ({ ...RECORD, fieldId, ...over });
const still = { reduced: () => true };

const meshesOf = (o) => { const out = []; o.traverse((m) => { if (m.isMesh) out.push(m); }); return out; };
const lightsIn = (o) => { let n = 0; o.traverse((m) => { if (m.isLight) n++; }); return n; };

describe('soil jars', () => {
  it('set([record]) adds one group by the gate and one obstacle', () => {
    const view = fakeView();
    const kids = view.island.children.length, obs = view.obstacles.length;
    const jars = createJars(view, still);
    const spots = jars.set([record('f2')]);
    const g = view.island.getObjectByName('Soil jar f2');
    assert.ok(g, 'a group named for the field');
    assert.equal(view.island.children.length, kids + 1);
    assert.equal(view.obstacles.length, obs + 1);
    const s = spots.get('f2');
    assert.deepEqual(Object.keys(s).sort(), ['by', 'ground', 'x', 'z']);
    assert.equal(s.by, 'gate');
    const o = view.obstacles[view.obstacles.length - 1];
    assert.deepEqual(o, { x: s.x, z: s.z, r: JAR.R + OB_PAD });
    assert.deepEqual([g.position.x, g.position.y, g.position.z], [s.x, s.ground, s.z]);
    // the sheep's own check now walks round it
    assert.ok(view.obstacles.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 1e-9));
    jars.dispose();
  });

  it('glass and water are see-through with no snow; the soil has no snow; only the lid takes the seasons', () => {
    const view = fakeView();
    const jars = createJars(view, still);
    jars.set([record('f2')]);
    const g = jars.groupOf('f2');
    const by = (name) => g.getObjectByName(name);
    for (const name of ['Jar glass', 'Jar water']) {
      const m = by(name).material;
      assert.ok(m.transparent && m.userData.noSeason && m.depthWrite === false, name);
    }
    assert.equal(by('Jar glass').renderOrder, 2);
    assert.ok(by('Jar soil').material.userData.noSeason && by('Jar soil').material.vertexColors);
    assert.ok(by('Jar shadow').material.userData.noSeason && by('Jar shadow').userData.noBox);
    const lid = by('Jar lid').material;
    assert.ok(!lid.userData.noSeason && !lid.transparent, 'the lid takes snow and the festival tint');
    assert.equal(typeof lid.onBeforeCompile, 'function', 'the seasons patch is on the lid');
    assert.equal(lid.color.getHex(), 0xb98a5e);
    jars.dispose();
  });

  it('no shadows and no new lights', () => {
    const view = fakeView();
    const before = lightsIn(view.scene);
    const jars = createJars(view, still);
    jars.set([record('f0'), record('f1'), record('f2'), record('f3')]);
    const ms = view.fields.flatMap((f) => meshesOf(jars.groupOf(f.id)));
    assert.ok(ms.length >= 4 * 4);
    for (const m of ms) assert.ok(m.castShadow === false && m.receiveShadow === false, m.name);
    assert.equal(lightsIn(view.scene), before);
    jars.dispose();
  });

  it("the soil and water heights follow the record's shares, in the photo's colours", () => {
    const { soil, water } = jarLayers(RECORD);
    const full = JAR.H * 0.92;
    // stacked from the bottom: gravel, sand, silt, clay, organic
    assert.deepEqual(soil.map((l) => l.type), ['gravel', 'sand', 'silt', 'clay', 'organic']);
    for (const l of soil) assert.ok(Math.abs(l.h - RECORD.layers.find((x) => x.type === l.type).share * full) < 1e-12, l.type);
    for (let i = 1; i < soil.length; i++) assert.ok(Math.abs(soil[i].y - (soil[i - 1].y + soil[i - 1].h)) < 1e-12, 'no gaps');
    const soilTop = soil[soil.length - 1].y + soil[soil.length - 1].h;
    assert.ok(Math.abs(water.y - soilTop) < 1e-12, 'the water over the soil');
    assert.ok(Math.abs(water.h - (0.02 + 0.2 + 0.1) * full) < 1e-12, 'foam, water and tea (the air gap is left empty)');
    assert.ok(water.y + water.h <= JAR.H, 'inside the glass');
    // the meshes are those heights
    const view = fakeView();
    const jars = createJars(view, still);
    jars.set([record('f2')]);
    const g = jars.groupOf('f2');
    const soilBox = new THREE.Box3().setFromBufferAttribute(g.getObjectByName('Jar soil').geometry.attributes.position);
    assert.ok(Math.abs(soilBox.max.y - soilBox.min.y - (0.06 + 0.2 + 0.16 + 0.16 + 0.04) * full) < 1e-6);
    assert.ok(soilBox.max.x <= JAR.R * 0.9 + 1e-9, 'inside the glass');
    const waterBox = new THREE.Box3().setFromBufferAttribute(g.getObjectByName('Jar water').geometry.attributes.position);
    assert.ok(Math.abs(waterBox.max.y - waterBox.min.y - water.h) < 1e-6);
    // every layer has its own colour; a near-black photo colour (the gravel) is lifted so it reads
    const colors = g.getObjectByName('Jar soil').geometry.attributes.color;
    const seen = new Set();
    const hsl = {};
    for (let i = 0; i < colors.count; i++) {
      const c = new THREE.Color(colors.getX(i), colors.getY(i), colors.getZ(i));
      seen.add(c.getHexString());
      c.getHSL(hsl, THREE.SRGBColorSpace);
      assert.ok(hsl.l >= 0.3 - 1e-3 && hsl.l <= 0.8 + 1e-3, `lightness ${hsl.l.toFixed(2)}`);
    }
    assert.equal(seen.size, 5);
    // the whole jar stands within its box
    const box = new THREE.Box3();
    g.updateMatrixWorld(true);
    g.traverse((m) => { if (m.isMesh && !m.userData.noBox) box.expandByObject(m); });
    const s = jars.spotOf('f2');
    const jb = jarBox(s.x, s.z, s.ground);
    for (const a of ['x', 'y', 'z']) assert.ok(box.min[a] >= jb.min[a] - 1e-6 && box.max[a] <= jb.max[a] + 1e-6, `${a}: ${box.min[a]} .. ${box.max[a]} in ${jb.min[a]} .. ${jb.max[a]}`);
    jars.dispose();
  });

  it('set([]) takes the group and the obstacle away and frees what the jar made', () => {
    const view = fakeView();
    const kids = [...view.island.children], obs = [...view.obstacles];
    const jars = createJars(view, still);
    jars.set([record('f2')]);
    const g = jars.groupOf('f2');
    const disposed = new Set();
    const own = [g.getObjectByName('Jar soil').geometry, g.getObjectByName('Jar water').geometry, g.getObjectByName('Jar water').material];
    const shared = [g.getObjectByName('Jar glass').material, g.getObjectByName('Jar glass').geometry, g.getObjectByName('Jar lid').material];
    for (const o of [...own, ...shared]) { const d = o.dispose.bind(o); o.dispose = () => { disposed.add(o); d(); }; }
    jars.set([]);
    assert.deepEqual(view.island.children, kids);
    assert.deepEqual(view.obstacles, obs);
    for (const o of own) assert.ok(disposed.has(o), 'its own geometries and water');
    for (const o of shared) assert.ok(!disposed.has(o), 'the shared ones stay for the next jar');
    assert.equal(jars.spotOf('f2'), null);
    assert.equal(jars.focusFor('f2'), null);
    jars.dispose();
    for (const o of shared) assert.ok(disposed.has(o), 'dispose frees the shared ones');
  });

  it('set goes by field: keeps, rebuilds changed contents in place, adds and removes', () => {
    const view = fakeView();
    const jars = createJars(view, still);
    const a = jars.set([record('f1'), record('f2')]);
    const g1 = jars.groupOf('f1'), g2 = jars.groupOf('f2');
    const sandy = { layers: [{ type: 'water', rgb: [100, 120, 130], share: 0.5 }, { type: 'sand', rgb: [200, 180, 120], share: 0.5 }], textureClass: 'Sand' };
    const b = jars.set([record('f2', sandy), record('f3')]);
    assert.equal(jars.groupOf('f1'), null, 'f1 is gone');
    assert.notEqual(jars.groupOf('f2'), g2, 'f2 rebuilt');
    assert.deepEqual(b.get('f2'), a.get('f2'), 'in the same spot');
    assert.ok(jars.groupOf('f3'));
    assert.equal(g1.parent, null);
    assert.equal(view.obstacles.filter((o) => o.r === JAR.R + OB_PAD).length, 2);
    // the same records again change nothing
    const g3 = jars.groupOf('f3');
    const g2b = jars.groupOf('f2');
    jars.set([record('f2', sandy), record('f3')]);
    assert.equal(jars.groupOf('f3'), g3);
    assert.equal(jars.groupOf('f2'), g2b);
    // a field that isn't on the island has no jar
    assert.equal(jars.set([record('nowhere')]).get('nowhere'), null);
    jars.dispose();
  });

  it('refresh: moves a jar off a festival box, back once it has gone, and drops it when nowhere is clear', () => {
    const view = fakeView();
    let keepOuts = [];
    const jars = createJars(view, { ...still, getKeepOuts: () => keepOuts });
    const first = jars.set([record('f0')]).get('f0');
    const cands = jarCandidates(jarField(view.fields[0], view));
    assert.deepEqual([first.x, first.z], [cands[0].x, cands[0].z]);
    jars.refresh();
    assert.deepEqual(jars.spotOf('f0'), first, 'nothing changed: it stays put');
    // a festival box right over it
    keepOuts = [{ min: { x: first.x - 0.05, y: 0, z: first.z - 0.05 }, max: { x: first.x + 0.05, y: 2, z: first.z + 0.05 } }];
    jars.refresh();
    const moved = jars.spotOf('f0');
    assert.deepEqual([moved.x, moved.z], [cands[1].x, cands[1].z], 'to the next spot');
    const ob = view.obstacles.filter((o) => o.r === JAR.R + OB_PAD);
    assert.equal(ob.length, 1, 'one obstacle still');
    assert.deepEqual([ob[0].x, ob[0].z], [moved.x, moved.z], 'and it moved with the jar');
    jars.refresh();
    assert.deepEqual(jars.spotOf('f0'), moved, 'refreshing again changes nothing (no flicker)');
    // a sheep grazing beside it is no reason to move
    view.flock.sheep.push({ g: { position: { x: moved.x + 0.4, z: moved.z } }, size: 0.6 });
    jars.refresh();
    assert.deepEqual(jars.spotOf('f0'), moved);
    view.flock.sheep.pop();
    // the festival is over: back by the gate
    keepOuts = [];
    jars.refresh();
    assert.deepEqual(jars.spotOf('f0'), first);
    // nowhere clear: the jar goes (and its obstacle with it), and comes back when it can
    keepOuts = [{ min: { x: -50, y: -5, z: -50 }, max: { x: 50, y: 5, z: 50 } }];
    jars.refresh();
    assert.equal(jars.spotOf('f0'), null);
    assert.equal(jars.groupOf('f0').visible, false);
    assert.equal(view.obstacles.filter((o) => o.r === JAR.R + OB_PAD).length, 0);
    assert.equal(jars.pick(new THREE.Vector3(first.x, 5, first.z), new THREE.Vector3(0, -1, 0)), null, "a jar that's gone can't be tapped");
    keepOuts = [];
    jars.refresh();
    assert.deepEqual(jars.spotOf('f0'), first);
    assert.equal(jars.groupOf('f0').visible, true);
    jars.dispose();
  });

  it('checks once more a moment after a set or refresh (a festival still growing in)', () => {
    const view = fakeView();
    let keepOuts = [];
    const jars = createJars(view, { ...still, getKeepOuts: () => keepOuts });
    const first = jars.set([record('f0')]).get('f0');
    jars.refresh();
    // something grows in over the jar after the refresh looked
    keepOuts = [{ min: { x: first.x - 0.05, y: 0, z: first.z - 0.05 }, max: { x: first.x + 0.05, y: 2, z: first.z + 0.05 } }];
    assert.equal(jars.step(JAR_SETTLE / 2), false);
    assert.deepEqual(jars.spotOf('f0'), first, 'not yet');
    assert.equal(jars.step(JAR_SETTLE / 2 + 0.01), true, 'the late check moved it');
    assert.notDeepEqual(jars.spotOf('f0'), first);
    // just the once
    keepOuts = [];
    const moved = jars.spotOf('f0');
    for (let i = 0; i < 100; i++) jars.step(0.1);
    assert.deepEqual(jars.spotOf('f0'), moved);
    // a set that places a jar arms it too
    const other = createJars(fakeView(), { ...still, getKeepOuts: () => keepOuts });
    const a = other.set([record('f1')]).get('f1');
    keepOuts = [{ min: { x: a.x - 0.05, y: 0, z: a.z - 0.05 }, max: { x: a.x + 0.05, y: 2, z: a.z + 0.05 } }];
    other.step(JAR_SETTLE + 0.01);
    assert.notDeepEqual(other.spotOf('f1'), a);
    jars.dispose();
    other.dispose();
  });

  it('a saved record whose shares add up to more than 1 still fits in the glass', () => {
    const big = { layers: [{ type: 'water', rgb: [120, 140, 150], share: 0.9 }, { type: 'clay', rgb: [150, 100, 80], share: 0.9 }, { type: 'sand', rgb: [190, 170, 130], share: 0.6 }] };
    const { soil, water } = jarLayers(big);
    const top = water.y + water.h;
    assert.ok(top <= JAR.H * 0.92 + 0.008 + 1e-9, `${top.toFixed(3)} inside the glass`);
    assert.ok(Math.abs(soil[0].h / soil[1].h - 0.6 / 0.9) < 1e-9, 'in the same proportions');
    // and junk shares count as nothing
    assert.deepEqual(jarLayers({ layers: [{ type: 'sand', share: NaN }, { type: 'clay', share: -1 }] }), { soil: [], water: null });
  });

  it('pick: a ray through the jar gives its field and a tip; elsewhere, null', () => {
    const view = fakeView();
    view.fields[2].name = 'West 140';
    const jars = createJars(view, still);
    jars.set([record('f2'), record('f0')]);
    const s = jars.spotOf('f2');
    const hit = jars.pick(new THREE.Vector3(s.x, s.ground + 6, s.z + 3), new THREE.Vector3(0, -6 + 0.17, -3));
    assert.deepEqual(hit, { fieldId: 'f2', tip: { title: 'West 140 · jar test', note: 'Clay loam. Tap to see it.' } });
    assert.equal(jars.pick(new THREE.Vector3(s.x + 2, 6, s.z), new THREE.Vector3(0, -1, 0)), null);
    assert.equal(jars.pick(new THREE.Vector3(s.x, s.ground + 6, s.z), new THREE.Vector3(0, 1, 0)), null, 'looking away');
    // the name comes from getName when it's given, else the field id
    const named = createJars(fakeView(), { ...still, getName: (id) => `Field ${id}` });
    named.set([record('f0')]);
    const t = named.spotOf('f0');
    assert.equal(named.pick(new THREE.Vector3(t.x, 5, t.z), new THREE.Vector3(0, -1, 0)).tip.title, 'Field f0 · jar test');
    const plain = jars.pick(new THREE.Vector3(jars.spotOf('f0').x, 5, jars.spotOf('f0').z), new THREE.Vector3(0, -1, 0));
    assert.equal(plain.tip.title, 'f0 · jar test');
    // in island space: the island moved, the ray follows the world
    view.island.position.set(1, 0, 0);
    view.island.updateMatrixWorld(true);
    assert.equal(jars.pick(new THREE.Vector3(s.x + 1, 6, s.z), new THREE.Vector3(0, -1, 0))?.fieldId, 'f2');
    jars.dispose();
    named.dispose();
  });

  it('spotOf and focusFor', () => {
    const view = fakeView();
    const jars = createJars(view, still);
    jars.set([record('f1')]);
    const s = jars.spotOf('f1');
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.ground) && s.by === 'gate');
    assert.deepEqual(jars.focusFor('f1'), { center: [s.x, s.z], radius: 1.1, y: s.ground });
    assert.equal(jars.spotOf('f0'), null);
    assert.equal(jars.focusFor('f0'), null);
    jars.dispose();
  });

  it('pops in over 0.45 s, or at once with reduced motion', () => {
    let reduced = false;
    const view = fakeView();
    const jars = createJars(view, { reduced: () => reduced });
    jars.set([record('f2')]);
    const g = jars.groupOf('f2');
    assert.ok(g.scale.x < 0.01, 'starts at nothing');
    assert.equal(jars.step(0.2), true);
    assert.ok(g.scale.x > 0.01);
    let t = 0.2;
    while (jars.step(1 / 60)) t += 1 / 60;
    assert.ok(Math.abs(t - 0.45) < 0.03, `${t.toFixed(2)} s`);
    assert.equal(g.scale.x, 1);
    assert.equal(jars.step(1 / 60), false, 'nothing to do once in');
    reduced = true;
    jars.set([record('f2'), record('f0')]);
    assert.equal(jars.groupOf('f0').scale.x, 1, 'reduced motion: there at once');
    assert.equal(jars.step(1 / 60), false);
    jars.dispose();
  });

  it('prewarms its materials once, through the renderer, off the island', async () => {
    const view = fakeView();
    const kids = [...view.island.children];
    const jars = createJars(view, still);
    const p = jars.prewarm(view.camera);
    assert.equal(jars.prewarm(view.camera), p, 'once');
    await p;
    assert.equal(view.renderer.compiled, 1);
    const names = [];
    view.renderer.last.traverse((m) => { if (m.isMesh) names.push(m.name); });
    assert.deepEqual(names.sort(), ['Jar glass', 'Jar lid', 'Jar shadow', 'Jar soil', 'Jar water']);
    assert.deepEqual(view.island.children, kids, 'nothing left on the island');
    jars.dispose();
  });

  it('dispose leaves the island as it was', () => {
    const view = fakeView();
    const kids = [...view.island.children], obs = [...view.obstacles];
    const jars = createJars(view, still);
    jars.set([record('f0'), record('f1'), record('f2'), record('f3')]);
    jars.dispose();
    assert.deepEqual(view.island.children, kids);
    assert.deepEqual(view.obstacles, obs);
    assert.equal(jars.step(0.1), false);
    assert.deepEqual([...jars.set([record('f0')])], []);
    jars.refresh();
    assert.equal(jars.pick(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)), null);
    jars.dispose(); // twice is fine
  });
});
