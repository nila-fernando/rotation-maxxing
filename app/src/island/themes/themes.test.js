// Builds every festival theme on a stand-in farm (no browser) and runs it for a while: it must
// build, keep to the budget, stay off the fields and buildings, animate without errors, and leave
// nothing behind when disposed.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

// a canvas that draws nothing (some shared makers paint a little texture)
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) }) }),
};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { makeThemeContext, createThemes, THEMES } = await import('./index.js');
const { makeFarmLamp } = await import('../lamps.js');

/** A small farm: four square fields round a farmyard, a barn, a farmhouse, a shed, trees, lamps, sheep. */
function fakeView() {
  const island = new THREE.Group();
  const square = (cx, cz, h = 1.1) => [[[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]]];
  const fields = [[-3.2, -2.6], [3.2, -2.6], [-3.4, 2.8], [3.4, 2.9]].map(([x, z], i) => ({
    id: `f${i}`, polygons: [square(x, z)], topY: 0.75, paddock: { userData: { gate: { x: x + (x < 0 ? 1.1 : -1.1), z, nx: x < 0 ? 1 : -1, nz: 0 } } },
  }));
  const barn = new THREE.Group();
  const lamps = [[-1.4, 1.8], [1.6, 1.7], [0.2, 4.6]].map(([x, z], i) => {
    const l = makeFarmLamp({ light: false });
    l.position.set(x, 0.6, z);
    island.add(l);
    return { ...l.userData.lamp, at: [x, z] };
  });
  const props = [
    { key: 'barn', x: 0, z: -0.4, r: 1.1, ry: 0, scale: 0.75, height: 1.7, y: 0.6 },
    { key: 'farmhouse', x: -1.6, z: 0.6, r: 0.75, ry: 0.3, scale: 0.75, height: 1.2, y: 0.6 },
    { key: 'machineShed', x: 1.8, z: 0.4, r: 0.8, ry: -0.3, scale: 0.75, height: 1.0, y: 0.6 },
    { key: 'windmill', x: 0.4, z: -5.2, r: 0.5, ry: 0, scale: 0.75, height: 2.6, y: 1.6 },
    { key: 'silo', x: 1.0, z: -1.4, r: 0.45, ry: 0, scale: 0.75, height: 1.8, y: 0.6 },
    { key: 'tree', x: -5.6, z: 0.2, r: 0.34, ry: 0, scale: 0.75, height: 1.6, y: 0.6 },
    { key: 'pine', x: 5.5, z: 0.4, r: 0.3, ry: 0, scale: 0.75, height: 1.8, y: 0.6 },
    { key: 'tree', x: 0.3, z: 5.8, r: 0.34, ry: 0, scale: 0.75, height: 1.6, y: 0.6 },
  ];
  const obstacles = props.map((p) => ({ x: p.x, z: p.z, r: p.r }));
  const sheep = [{ g: { position: { x: 2.3, z: 1.9 } }, size: 0.6 }];
  return {
    island, barn, lamps, props, obstacles,
    heightAt: () => 0.6,
    center: new THREE.Vector3(0, 0.4, 0), radius: 7.5, barnScale: 0.75,
    farmstead: { at: [0, -0.4], facing: 0, yard: { at: [0, 0], r: 1.6 } },
    fields, slots: [{ kind: 'building', at: [-2.4, -0.6], r: 0.7 }],
    flock: { sheep, walkable: (x, z) => Math.hypot(x, z) < 7 },
    terrainField: { pathMask: (x, z) => (Math.abs(Math.hypot(x, z) - 2.1) < 0.25 ? 0.3 : 0), maxCoast: 7.5 },
  };
}

const inSquare = (x, z, polys) => polys.some((p) => { const xs = p[0].map((q) => q[0]), zs = p[0].map((q) => q[1]); return x > Math.min(...xs) && x < Math.max(...xs) && z > Math.min(...zs) && z < Math.max(...zs); });
function drawCalls(root) {
  let n = 0;
  root.traverse((o) => { if ((o.isMesh || o.isLine || o.isPoints || o.isSprite) && o.visible !== false) n++; });
  return n;
}

describe('festival themes', () => {
  for (const key of THEMES) {
    describe(key, async () => {
      const view = fakeView();
      const obstaclesBefore = view.obstacles.length;
      const ctx = makeThemeContext(view, { attach: () => {} });
      const build = (await import(`./${key === 'independence' ? 'independence' : key}.js`)).default;
      let api;
      it('builds', () => {
        api = build(ctx);
        assert.ok(api?.root?.isObject3D, 'returns { root }');
        assert.equal(typeof api.update, 'function');
      });
      it('is extensive: plenty of things, all over the farm', () => {
        const kids = api.root.children;
        assert.ok(kids.length >= 12, `${kids.length} placed things (want 12 or more)`);
        let instances = 0;
        api.root.traverse((o) => { if (o.isInstancedMesh) instances += o.count; });
        const spread = kids.filter((o) => !o.userData.noPop).map((o) => Math.hypot(o.position.x, o.position.z));
        assert.ok(Math.max(...spread, 0) > 3.5, 'reaches beyond the farmyard');
        assert.ok(kids.length + instances >= 30, `${kids.length + instances} pieces`);
      });
      it('keeps to the budget (draw calls, no lights, no DOM)', () => {
        const calls = drawCalls(api.root) + (api.barnBits ? drawCalls(api.barnBits) : 0);
        assert.ok(calls <= 140, `${calls} draw calls (budget 140)`);
        api.root.traverse((o) => assert.ok(!o.isLight, `no lights (${o.name})`));
      });
      it('stays off the fields and the buildings', () => {
        for (const o of api.root.children) {
          if (o.userData.noPop || o.userData.onFence || o.userData.onBuilding) continue;
          const { x, z } = o.position;
          assert.ok(!view.fields.some((fl) => inSquare(x, z, fl.polygons)), `${o.name} at ${x.toFixed(2)}, ${z.toFixed(2)} is in a field`);
          for (const p of view.props.filter((q) => q.key !== 'tree' && q.key !== 'pine')) {
            assert.ok(Math.hypot(p.x - x, p.z - z) > p.r * 0.8, `${o.name} is inside the ${p.key}`);
          }
        }
      });
      it('animates by day and night, in and out, without errors', () => {
        for (let i = 0; i < 90; i++) api.update(1 / 30, i / 30, { night: i > 45 ? 1 : 0, k: Math.min(1, i / 30) });
        api.update(0, 0.4, { night: 0.5, k: 1 });
      });
      it('sheep costumes, if any, are small and light', () => {
        if (!api.sheepWear) return;
        for (let i = 0; i < 4; i++) {
          const c = api.sheepWear(i);
          assert.ok(c?.isObject3D, 'a costume is an Object3D');
          let meshes = 0;
          c.traverse((o) => { if (o.isMesh) meshes++; assert.ok(!o.isLight, 'no lights'); });
          assert.ok(meshes >= 1 && meshes <= 16, `${meshes} meshes in a costume`);
          const box = new THREE.Box3().setFromObject(c);
          assert.ok(box.max.x - box.min.x < 0.7 && box.max.y - box.min.y < 0.8, 'sized for a sheep\'s head');
          c.userData.update?.(1.2, 1);
        }
      });
      it('lamp colours, if any, are colours', () => {
        if (api.lampColors) for (const c of api.lampColors) assert.ok(Number.isInteger(c) && c >= 0 && c <= 0xffffff);
      });
      it('lets the spots go again', () => {
        api.dispose?.();
        ctx.release();
        assert.equal(view.obstacles.length, obstaclesBefore);
      });
    });
  }

  it('atFull: what the festival will fill once popped in, measured before it has, and put back', () => {
    const view = fakeView();
    const themes = createThemes(view, { attach: () => {} });
    themes.setTheme('easter');
    const host = view.island.getObjectByName('Festival themes');
    const root = host.getObjectByName('easter theme');
    const scales = () => root.children.map((o) => o.scale.toArray().join());
    const before = scales();
    assert.equal(root.visible, false, 'not shown yet');
    let seen = null;
    const out = themes.atFull(() => { seen = { visible: root.visible, scales: scales() }; return 7; });
    assert.equal(out, 7);
    assert.equal(seen.visible, true);
    assert.notDeepEqual(seen.scales, before, 'at full size while measured');
    assert.equal(root.visible, false, 'and back as it was');
    assert.deepEqual(scales(), before);
    themes.snap();
    const full = scales();
    themes.atFull(() => {});
    assert.deepEqual(scales(), full, 'all popped in: nothing to do');
    themes.dispose();
  });

  it('the manager builds a theme when wanted, pops it in, switches and cleans up', () => {
    const view = fakeView();
    const before = view.obstacles.length;
    const themes = createThemes(view, { attach: () => {} });
    themes.setTheme('christmas');
    for (let i = 0; i < 60; i++) themes.update(1 / 30, i / 30, { night: 0.8 });
    themes.setTheme('halloween');
    for (let i = 0; i < 60; i++) themes.update(1 / 30, 2 + i / 30, { night: 0.2 });
    themes.snap();
    assert.equal(themes.theme, 'halloween');
    themes.setTheme(null);
    themes.update(0.5, 4, {});
    themes.dispose();
    assert.equal(view.obstacles.length, before);
    assert.equal(view.island.children.filter((c) => c.name === 'Festival themes').length, 0);
  });
});
