// The coin stacks (src/island/coinStacks.js) on a stand-in farm, no browser: one instanced mesh
// that drops coins in and lifts them away, keeps clear of the props, the sails and a festival's
// things, and leaves the island as it found it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

// a canvas that draws nothing (the festival themes' shared makers paint a little texture)
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) }) }),
};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { createCoinStacks, sailSpheres, themeKeepOuts } = await import('./coinStacks.js');
const { clearClipping, makeThemeContext } = await import('./themes/index.js');
const { COIN_PITCH, MAX_COINS } = await import('./stackSpots.js');
const { boxHitsProp } = await import('./clearance.js');

const BOX = {
  barn: [[-1, 0, -0.8], [1, 2.27, 0.8]],
  farmhouse: [[-0.7, 0, -0.6], [0.7, 1.6, 0.6]],
  windmill: [[-0.6, 0, -0.6], [0.6, 3.47, 0.6]],
  silo: [[-0.45, 0, -0.45], [0.45, 2.4, 0.45]],
  tree: [[-0.4, 0, -0.4], [0.4, 2.13, 0.4]],
};

/** A small farm like the themes test's: four square fields round a farmyard, props with real boxes, windmill sails. */
function fakeView() {
  const island = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(island);
  const square = (cx, cz, h = 1.1) => [[[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]]];
  const fields = [[-3.2, -2.6], [3.2, -2.6], [-3.4, 2.8], [3.4, 2.9]].map(([x, z], i) => ({
    id: `f${i}`, polygons: [square(x, z)], topY: 0.75, paddock: { userData: { gate: { x: x + (x < 0 ? 1.1 : -1.1), z, nx: x < 0 ? 1 : -1, nz: 0 }, isPivot: false } },
  }));
  const props = [
    { key: 'barn', x: 0, z: -0.4, r: 1.1, ry: 0, scale: 0.75, height: 1.7, y: 0.6 },
    { key: 'farmhouse', x: -1.6, z: 0.6, r: 0.75, ry: 0.3, scale: 0.75, height: 1.2, y: 0.6 },
    { key: 'windmill', x: 0.4, z: -5.2, r: 0.5, ry: 0, scale: 0.75, height: 2.6, y: 1.6 },
    { key: 'silo', x: 1.0, z: -1.4, r: 0.45, ry: 0, scale: 0.75, height: 1.8, y: 0.6 },
    // a tree right beside field f2, its crown over the field's edge
    { key: 'tree', x: -2.1, z: 2.8, r: 0.34, ry: 0, scale: 0.75, height: 1.6, y: 0.6 },
  ].map((p) => ({ ...p, box: { min: BOX[p.key][0], max: BOX[p.key][1] } }));
  // the windmill's sails: a cross of two blades round a hub over the windmill
  const sails = new THREE.Group();
  sails.position.set(0.4, 3.3, -4.75);
  for (const r of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 0.05));
    blade.rotation.z = r;
    sails.add(blade);
  }
  island.add(sails);
  const lamps = [{ at: [-1.4, 1.8] }, { at: [1.6, 1.7] }];
  const obstacles = props.map((p) => ({ x: p.x, z: p.z, r: p.r }));
  return {
    island, scene, props, obstacles, lamps, spinners: [sails], fields,
    heightAt: () => 0.6,
    center: new THREE.Vector3(0, 0.4, 0), radius: 7.5, barnScale: 0.75,
    farmstead: { at: [0, -0.4], facing: 0, yard: { at: [0, 0], r: 1.6 } },
    slots: [], flock: { sheep: [], walkable: (x, z) => Math.hypot(x, z) < 7 },
    terrainField: { pathMask: () => 0, maxCoast: 7.5 },
    camera: new THREE.PerspectiveCamera(30, 1.6, 0.05, 5000),
    renderer: { compiled: 0, compileAsync(obj) { this.compiled++; this.last = obj; return Promise.resolve(); } },
  };
}

const COUNTS = { f0: 7, f1: 9, f2: 3, f3: 12 };
const BASE = { f0: 7, f1: 8, f2: 3, f3: 10 };
const settle = (coins, max = 5) => { let t = 0; while (coins.step(1 / 60) && t < max) t += 1 / 60; return t; };

/** The instances on show: [{ y, x, z, scale, color }] (in the order they're packed). */
function instances(mesh) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    mesh.getColorAt(i, c);
    return { x: p.x, y: p.y, z: p.z, scale: s.x, color: c.getHexString() };
  });
}

describe('coin stacks', () => {
  it('builds, sets and steps to rest', () => {
    const view = fakeView();
    const coins = createCoinStacks(view, { reduced: () => false });
    const spots = coins.place();
    assert.equal(spots.size, 4);
    for (const s of spots.values()) assert.ok(s, 'every field has a stack');
    coins.set(COUNTS, BASE);
    assert.ok(coins.animating, 'the coins drop in');
    const t = settle(coins);
    assert.ok(t > 0.2 && t < 1.2, `and come to rest (${t.toFixed(2)} s)`);
    assert.equal(coins.animating, false);
    const all = instances(coins.mesh);
    assert.equal(all.length, 7 + 9 + 3 + 12);
    for (const c of all) assert.ok(Math.abs(c.scale - 1) < 1e-6, 'full size at rest');
    // f1: the bottom coin sits on the spot's base, one pitch apart, and the ninth is bright gold
    const s1 = spots.get('f1');
    const f1 = all.filter((c) => Math.abs(c.x - s1.x) < 1e-6 && Math.abs(c.z - s1.z) < 1e-6).sort((a, b) => a.y - b.y);
    assert.equal(f1.length, 9);
    f1.forEach((c, k) => assert.ok(Math.abs(c.y - (s1.baseY + k * COIN_PITCH + 0.0275)) < 1e-6, `coin ${k} in its place`));
    assert.deepEqual(f1.map((c) => c.color).slice(6), ['e8c46a', 'dcb25a', 'f2c14e'], 'soft gold up to keeping going, bright over it');
    assert.equal(coins.topOf('f1'), s1.baseY + 9 * COIN_PITCH);
    assert.equal(coins.countOf('f3'), 12);
  });

  it('is one instanced mesh with no shadows and no snow', () => {
    const view = fakeView();
    const before = view.island.children.length;
    const coins = createCoinStacks(view);
    coins.place();
    coins.set(COUNTS, BASE);
    settle(coins);
    assert.equal(view.island.children.length, before + 1, 'adds one thing to the island');
    const { mesh } = coins;
    assert.ok(mesh.isInstancedMesh);
    assert.ok(mesh.count <= view.fields.length * MAX_COINS);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
    assert.equal(mesh.material.userData.noSeason, true);
    assert.ok(mesh.instanceColor, 'coloured per coin');
    assert.ok(mesh.boundingSphere?.radius > 0, 'has a bound, so culling works');
    let meshes = 0;
    mesh.traverse((o) => { if (o.isMesh) meshes++; });
    assert.equal(meshes, 1, 'one draw call');
  });

  it('writes the matrices only while the coins move', () => {
    const view = fakeView();
    const coins = createCoinStacks(view);
    coins.place();
    coins.set(COUNTS, BASE);
    settle(coins);
    const v = coins.mesh.instanceMatrix.version;
    for (let i = 0; i < 30; i++) coins.step(1 / 60);
    assert.equal(coins.mesh.instanceMatrix.version, v, 'nothing written at rest');
    coins.set(COUNTS, BASE);
    settle(coins);
    assert.equal(coins.mesh.instanceMatrix.version, v, 'the same counts again: nothing written');
    coins.set(COUNTS, { ...BASE, f1: 9 });
    assert.equal(coins.mesh.instanceMatrix.version, v + 1, "keeping going's count changed: one write (the colours)");
    assert.equal(coins.animating, false, 'and nothing moves');
  });

  it('a coin taken away while still dropping in lifts away from where it is (no pop to full size)', () => {
    const view = fakeView();
    const coins = createCoinStacks(view, { reduced: () => false });
    coins.place();
    coins.set({ f0: 2 }, {});
    settle(coins);
    coins.set({ f0: 8 }, {});
    coins.step(0.1); // the first new ones are part way down, the top ones still waiting their turn
    const s0 = coins.spotOf('f0');
    const on = (c) => Math.abs(c.x - s0.x) < 1e-6 && Math.abs(c.z - s0.z) < 1e-6;
    const before = instances(coins.mesh).filter(on).map((c) => c.scale);
    coins.set({ f0: 2 }, {});
    const after = instances(coins.mesh).filter(on).map((c) => c.scale);
    assert.ok(after.length < before.length, `the ones not yet dropping just go (${before.length} -> ${after.length})`);
    const biggest = (a) => Math.max(...a.slice(2));
    assert.ok(biggest(after) <= biggest(before) + 1e-6, `none grows on its way out (${biggest(before)} then ${biggest(after)})`);
    let top = -Infinity;
    for (let t = 0; t < 0.5; t += 1 / 60) {
      coins.step(1 / 60);
      for (const c of instances(coins.mesh).filter(on)) top = Math.max(top, c.y + 0.0275);
    }
    assert.ok(top <= s0.box.max.y, `stays inside its column (${top.toFixed(3)} <= ${s0.box.max.y.toFixed(3)})`);
    assert.equal(coins.countOf('f0'), 2);
    assert.equal(coins.mesh.count, 2);
  });

  it('lifts spare coins away and drops new ones in', () => {
    const view = fakeView();
    const coins = createCoinStacks(view);
    coins.place();
    coins.set(COUNTS, BASE);
    settle(coins);
    coins.set({ ...COUNTS, f1: 4, f2: 6 }, BASE);
    assert.equal(coins.countOf('f1'), 4);
    coins.step(0.05);
    const s1 = coins.spotOf('f1');
    const lifting = instances(coins.mesh).filter((c) => Math.abs(c.x - s1.x) < 1e-6 && c.scale < 1);
    assert.equal(lifting.length, 5, 'five coins lift away');
    settle(coins);
    assert.equal(coins.mesh.count, 7 + 4 + 6 + 12);
    // coins over keeping going's count are bright; f2 (base 3) now has 3 bright ones on top
    const s2 = coins.spotOf('f2');
    const f2 = instances(coins.mesh).filter((c) => Math.abs(c.x - s2.x) < 1e-6).sort((a, b) => a.y - b.y);
    // (each coin alternates with the one under it, all the way up)
    assert.deepEqual(f2.map((c) => c.color), ['e8c46a', 'dcb25a', 'e8c46a', 'e3ad35', 'f2c14e', 'e3ad35']);
  });

  it('snaps the counts when motion is reduced', () => {
    const view = fakeView();
    const coins = createCoinStacks(view, { reduced: () => true });
    coins.place();
    coins.set(COUNTS, BASE);
    assert.equal(coins.animating, false);
    assert.equal(coins.mesh.count, 31);
    coins.set({ f0: 0 }, BASE);
    assert.equal(coins.mesh.count, 24);
  });

  it('clamps counts to 0..12', () => {
    const view = fakeView();
    const coins = createCoinStacks(view, { reduced: () => true });
    coins.place();
    coins.set({ f0: 40, f1: -3, f2: 2.6 });
    assert.deepEqual(['f0', 'f1', 'f2'].map(coins.countOf), [12, 0, 3]);
  });

  it("passes the festival themes' own clipping check (clearClipping drops 0)", () => {
    const view = fakeView();
    const coins = createCoinStacks(view);
    const spots = coins.place();
    // each column as a box of its own, the way a theme's things are measured
    const group = new THREE.Group();
    for (const s of spots.values()) {
      const size = new THREE.Vector3(s.box.max.x - s.box.min.x, s.box.max.y - s.box.min.y, s.box.max.z - s.box.min.z);
      const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
      m.position.set(s.x, (s.box.min.y + s.box.max.y) / 2, s.z);
      group.add(m);
    }
    const n = group.children.length;
    assert.equal(clearClipping(group, makeThemeContext(view, { attach: () => {} }), { obstacles: view.obstacles }), 0);
    assert.equal(group.children.length, n);
    // and by the stricter, unshrunk test too
    for (const s of spots.values()) for (const p of view.props) assert.ok(!boxHitsProp(s.box, p, { shrink: 0, pad: 0.1 }));
  });

  it('keeps out of the sails', () => {
    const view = fakeView();
    const [ball] = sailSpheres(view.spinners);
    assert.ok(Math.abs(ball.x - 0.4) < 1e-6 && Math.abs(ball.y - 3.3) < 1e-6 && Math.abs(ball.z + 4.75) < 1e-6, 'round the hub');
    assert.ok(ball.r >= 0.95 + 0.1 && ball.r < 1.5, `reaches past the blade tips (${ball.r.toFixed(2)})`);
    // the same at any angle the sails have turned to
    view.spinners[0].rotation.z = 0.7;
    const [turned] = sailSpheres(view.spinners);
    assert.ok(turned.r >= 0.95 + 0.1, 'still past the tips');
    // sails hung right over a field push its stack off them
    const coins = createCoinStacks(view);
    const before = coins.place().get('f1');
    view.spinners[0].position.set(before.x, before.baseY + 0.5, before.z + 0.6);
    const after = coins.place().get('f1');
    const [over] = sailSpheres(view.spinners);
    assert.ok(!after || Math.hypot(after.x - over.x, after.z - over.z) > 0.3, 'moved off the sails (or no stack)');
  });

  it('a ghost hovering over a field keeps its column away (themeKeepOuts)', () => {
    const view = fakeView();
    const host = new THREE.Group();
    host.name = 'Festival themes';
    view.island.add(host);
    const theme = new THREE.Group();
    host.add(theme);
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.2));
    ghost.position.set(-3.2, 0.75 + 1.5, -2.6); // over the middle of f0, at topY + 1.5
    const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(0.15));
    pumpkin.position.set(0, 0.75, 4); // low on the grass: no stack is that low
    const hidden = new THREE.Mesh(new THREE.SphereGeometry(0.2));
    hidden.position.set(3.2, 2.25, -2.6);
    hidden.visible = false; // (a theme that's not on show)
    const bunting = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial(), 2);
    bunting.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3.4, 2.4, 2.9)); // over f3
    bunting.setMatrixAt(1, new THREE.Matrix4().makeTranslation(-6, 2.4, -6));
    theme.add(ghost, pumpkin, hidden, bunting);
    const outs = themeKeepOuts(view.island.getObjectByName('Festival themes'), { floorY: 0.75 + 1.0 });
    assert.equal(outs.length, 3, 'the ghost and two bunting flags (the pumpkin is low, the hidden one not on show)');
    const coins = createCoinStacks(view);
    const bare = coins.place();
    const spots = coins.place({ keepOuts: outs });
    const meets = (a, b) => !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y || a.max.z < b.min.z || a.min.z > b.max.z);
    assert.ok(meets(bare.get('f0').box, outs[0]), 'without the keep-outs, the column would be in the ghost');
    for (const [id, s] of spots) if (s) for (const b of outs) assert.ok(!meets(s.box, b), `${id} keeps out`);
    assert.ok(!spots.get('f0') || spots.get('f0').x !== bare.get('f0').x || spots.get('f0').z !== bare.get('f0').z, 'f0 moved (or has no stack)');
    assert.deepEqual(spots.get('f1'), bare.get('f1'), 'the hidden one changes nothing');
    // a field with no stack has no coins
    coins.set({ f0: 5 }, {});
    if (!spots.get('f0')) { assert.equal(coins.countOf('f0'), 0); assert.equal(coins.topOf('f0'), null); }
  });

  it('prewarms its material through the renderer', async () => {
    const view = fakeView();
    const coins = createCoinStacks(view);
    await coins.prewarm();
    assert.equal(view.renderer.compiled, 1);
    assert.equal(view.renderer.last, coins.mesh);
  });

  it('dispose leaves the island as it was', () => {
    const view = fakeView();
    const before = [...view.island.children];
    const coins = createCoinStacks(view);
    coins.place();
    coins.set(COUNTS, BASE);
    coins.step(0.1);
    coins.dispose();
    assert.deepEqual(view.island.children, before);
    assert.equal(coins.step(0.1), false, 'nothing moves after');
    coins.dispose(); // twice is fine
  });
});
