// The crops: every planner crop and every mapped CDL crop name lands on a real crop key with an
// icon and a name; the newer crops (cotton on) build, grow through the seasons and go away cleanly,
// stay inside the field whatever its shape, and never stand taller than corn.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { CROP_KEYS, CROP_STYLE, ROW_GAP, cropKeyFor, plantField } from './crops.js';
import { makeFieldPaddock } from './paddocks.js';
import { patchMaterial } from './seasons.js';
import { lookAt, SEASONS } from './timeline.js';
import { CROP_ICONS, cropIcon } from '../ui/cropIcons.js';
import { APP_CROP, PLANNER_CROP } from '../plan/farmInput.js';
import { CROP_BY_ID } from '../vendor/rotation-maxxing/algorithm/croptraits.ts';
import { CDL_CATEGORY_TO_CROP } from '../vendor/rotation-maxxing/data/cdl.ts';

const OLD_KEYS = ['corn', 'soybeans', 'wheat', 'barley', 'oats', 'sorghum', 'alfalfa', 'hay', 'pasture', 'fallow', 'other'];
const NEW_KEYS = CROP_KEYS.filter((k) => !OLD_KEYS.includes(k));
const CORN_TOP = 0.8; // over the soil (src/island/stackSpots.js lifts the coin stacks over it)

// USDA Cropland Data Layer / CSB category names and the crop each should show
const CDL_NAMES = {
  // the crops that were there before (unchanged)
  Corn: 'corn', 'Sweet Corn': 'corn', 'Pop or Orn Corn': 'corn', Soybeans: 'soybeans', 'Winter Wheat': 'wheat',
  Triticale: 'wheat', Speltz: 'wheat', Barley: 'barley', Oats: 'oats', Sorghum: 'sorghum', Millet: 'sorghum',
  Alfalfa: 'alfalfa', 'Other Hay/Non Alfalfa': 'hay', 'Grassland/Pasture': 'pasture', 'Clover/Wildflowers': 'pasture',
  'Sod/Grass Seed': 'pasture', Switchgrass: 'pasture', 'Fallow/Idle Cropland': 'fallow', Barren: 'fallow', Buckwheat: 'other',
  'Dbl Crop WinWht/Soybeans': 'soybeans', 'Dbl Crop Soybeans/Oats': 'oats', 'Dbl Crop WinWht/Corn': 'corn',
  // the new ones
  Cotton: 'cotton', 'Dbl Crop WinWht/Cotton': 'cotton', 'Dbl Crop Soybeans/Cotton': 'cotton',
  Sunflower: 'sunflower', Canola: 'canola', 'Rape Seed': 'canola', Mustard: 'canola', Camelina: 'canola',
  Rye: 'rye', 'Dry Beans': 'drybeans', Peas: 'drybeans', Lentils: 'drybeans', 'Chick Peas': 'drybeans',
  'Spring Wheat': 'springwheat', 'Durum Wheat': 'springwheat', 'Dbl Crop Lettuce/Durum Wht': 'springwheat',
  Potatoes: 'potatoes', Sugarbeets: 'sugarbeets', Peanuts: 'peanuts', Rice: 'rice', 'Wild Rice': 'rice',
  'Sweet Potatoes': 'vegetables', 'Misc Vegs & Fruits': 'vegetables', Tomatoes: 'vegetables', Onions: 'vegetables',
  Lettuce: 'vegetables', Watermelons: 'vegetables', 'Honeydew Melons': 'vegetables', Cantaloupes: 'vegetables',
  Pumpkins: 'vegetables', Squash: 'vegetables', Carrots: 'vegetables', Cabbage: 'vegetables', Peppers: 'vegetables',
  Greens: 'vegetables', Garlic: 'vegetables', Herbs: 'vegetables', 'Dbl Crop Lettuce/Cantaloupe': 'vegetables',
  Strawberries: 'strawberries', Blueberries: 'berries', Caneberries: 'berries', Cranberries: 'berries',
  Grapes: 'grapes', Apples: 'orchard', Cherries: 'orchard', Peaches: 'orchard', Pears: 'orchard', Oranges: 'orchard',
  Citrus: 'orchard', Almonds: 'orchard', Walnuts: 'orchard', Pecans: 'orchard', Pistachios: 'orchard',
  'Other Tree Crops': 'orchard', Grapefruit: 'orchard', Sugarcane: 'sugarcane', Tobacco: 'tobacco',
  // land cover that isn't a crop keeps falling where it did
  'Herbaceous Wetlands': 'other', 'Christmas Trees': 'other', Developed: 'other',
};

describe('crop keys, names and icons', () => {
  it('every key has a name, soil colours and a drawn 24x24 icon (no emoji)', () => {
    for (const k of CROP_KEYS) {
      assert.ok(CROP_STYLE[k]?.label, `name for ${k}`);
      assert.ok(Number.isInteger(CROP_STYLE[k].soil) && Number.isInteger(CROP_STYLE[k].sides), `soil for ${k}`);
      const svg = CROP_ICONS[k];
      assert.ok(svg && svg.startsWith('<svg viewBox="0 0 24 24"') && svg.endsWith('</svg>'), `icon for ${k}`);
      assert.equal(cropIcon(k), svg);
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(svg), `no emoji in ${k}`);
      assert.ok(!/NaN|undefined/.test(svg), `${k} icon is well formed`);
    }
    assert.deepEqual(Object.keys(CROP_ICONS).sort(), [...CROP_KEYS].sort(), 'one icon per key, no strays');
    assert.equal(new Set(NEW_KEYS.map((k) => CROP_ICONS[k])).size, NEW_KEYS.length, 'every new crop has its own icon');
  });

  it('keeps the crops that were there, as they were', () => {
    assert.deepEqual(CROP_KEYS.slice(0, OLD_KEYS.length), OLD_KEYS);
    assert.deepEqual(OLD_KEYS.map((k) => CROP_STYLE[k].label), ['Corn', 'Soybeans', 'Wheat', 'Barley', 'Oats', 'Sorghum', 'Alfalfa', 'Hay', 'Pasture', 'Fallow', 'Cover crop']);
    assert.deepEqual(Object.fromEntries(OLD_KEYS.filter((k) => ROW_GAP[k]).map((k) => [k, ROW_GAP[k]])),
      { corn: 1.5, soybeans: 1.9, wheat: 1.05, barley: 1.05, oats: 1.05, sorghum: 1.45 }, 'the same furrowed crops and row gaps');
  });

  it('maps every planner crop id to a real key', () => {
    for (const id of Object.keys(CROP_BY_ID)) {
      const key = APP_CROP[id];
      assert.ok(CROP_KEYS.includes(key), `${id} -> ${key}`);
      assert.ok(CROP_STYLE[key].label && CROP_ICONS[key], `${id} has a name and an icon`);
    }
    // the planner's crops now show as themselves
    assert.deepEqual(['cotton', 'sunflower', 'canola', 'cereal-rye', 'dry-beans', 'spring-wheat'].map((id) => APP_CROP[id]),
      ['cotton', 'sunflower', 'canola', 'rye', 'drybeans', 'springwheat']);
    for (const [key, id] of Object.entries(PLANNER_CROP)) {
      assert.ok(CROP_KEYS.includes(key), `planner mapping from a real key: ${key}`);
      assert.ok(CROP_BY_ID[id], `${key} -> a real planner crop: ${id}`);
    }
  });

  it('maps every CDL category name to the crop it is', () => {
    for (const [name, key] of Object.entries(CDL_NAMES)) assert.equal(cropKeyFor(name), key, name);
    // and the names the planner's own CDL mapping knows go to the same crop as its id does
    for (const [name, id] of Object.entries(CDL_CATEGORY_TO_CROP)) {
      if (name.startsWith('Dbl Crop')) continue; // the island shows the later crop, the planner the first
      assert.equal(cropKeyFor(name), APP_CROP[id], name);
    }
    for (const k of CROP_KEYS) assert.equal(cropKeyFor(k), k, 'a key maps to itself');
    assert.equal(cropKeyFor(null), 'other');
    assert.equal(cropKeyFor('Ryegrass'), 'pasture');
  });
});

// ---------------------------------------------------------------- the new crops in the field

const square = [[[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]];
const circle = (cx, cz, r, n = 40) => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cz + Math.sin((i / n) * Math.PI * 2) * r]);
// a pivot-like circle with the bare middle cut out, an L, and a long thin triangle
const SHAPES = {
  square,
  pivot: [circle(0, 0, 1.7), circle(0, 0, 0.24, 24).reverse()],
  L: [[[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]],
  sliver: [[[0, 0], [4, 0], [0, 1.4]]],
};

function inside(x, z, poly) {
  let ins = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
  }
  return ins;
}

/** Every vertex of every plant, in the crop group's space, at its current size. */
function eachVertex(group, fn) {
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  group.updateMatrixWorld(true);
  for (const mesh of group.children) {
    if (!mesh.isInstancedMesh) continue;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      for (let k = 0; k < p.count; k++) fn(v.fromBufferAttribute(p, k).applyMatrix4(m), mesh.name);
    }
  }
}

function checkMatrices(group) {
  for (const mesh of group.children) {
    if (!mesh.isInstancedMesh) continue;
    for (const x of mesh.instanceMatrix.array) assert.ok(Number.isFinite(x), `${mesh.name}: finite matrices`);
  }
}

describe('the new crops', () => {
  it('stay inside every field shape, including a pivot circle with its bare middle', () => {
    const bad = [];
    for (const key of NEW_KEYS) {
      for (const [shape, poly] of Object.entries(SHAPES)) {
        const g = plantField(key, poly, { seed: 3, maxPlants: 300 });
        assert.ok(g.userData.count > 0, `${key} in the ${shape}: planted`);
        let out = null;
        eachVertex(g, (v, name) => { if (!out && !inside(v.x, v.z, poly)) out = `${name} at ${v.x.toFixed(3)}, ${v.z.toFixed(3)}`; });
        if (out) bad.push(`${key} in the ${shape}: ${out}`);
        g.traverse((o) => o.isInstancedMesh && o.dispose());
      }
    }
    assert.deepEqual(bad, [], 'nothing pokes out of its field');
  });

  it('stay as low as corn or lower, on their ridges too', () => {
    for (const key of NEW_KEYS) {
      for (const shape of ['square', 'pivot']) {
        const p = makeFieldPaddock(SHAPES[shape], { cropKey: key, seed: 5 });
        assert.equal(p.userData.cropKey, key);
        assert.equal(p.userData.isPivot, shape === 'pivot', `${key}: the ${shape} is${shape === 'pivot' ? '' : ' not'} a pivot`);
        const crops = p.userData.crops;
        let top = -Infinity;
        eachVertex(crops, (v) => { top = Math.max(top, v.y); });
        top += crops.position.y - p.userData.bedHeight;
        assert.ok(top <= CORN_TOP, `${key}: ${top.toFixed(3)} over the soil is taller than corn`);
        assert.ok(top > 0.05, `${key}: something stands up (${top.toFixed(3)})`);
        assert.equal(crops.position.y > p.userData.bedHeight, key in ROW_GAP, `${key}: on ridges only if furrowed`);
      }
    }
  });

  it('grow, ripen, get cut and go away through the seasons without errors', () => {
    for (const key of NEW_KEYS) {
      const p = makeFieldPaddock(SHAPES.L, { cropKey: key, seed: 7 });
      const crops = p.userData.crops;
      assert.ok(p.userData.plantCount > 0, `${key} planted`);
      for (let t = 0; t <= 1; t += 0.25) { p.userData.setGrowth(t); checkMatrices(crops); }
      for (const season of SEASONS) {
        for (let t = 0; t <= 1; t += 0.1) {
          const look = lookAt(season, t);
          p.userData.setSize(look.growth);
          checkMatrices(crops);
          const shown = crops.children.some((m) => m.visible);
          assert.equal(shown, look.growth > 0, `${key} in ${season} ${t.toFixed(1)}: shown only while growing`);
        }
      }
      // every material gets its season look, with the shader bits it needs
      const kinds = new Set();
      crops.traverse((o) => { if (o.isInstancedMesh) { patchMaterial(o.material); kinds.add(o.material.userData.season); } });
      for (const kind of kinds) assert.ok(['crop', 'boll', 'paddy'].includes(kind), `${key}: known season look ${kind}`);
      crops.traverse((o) => {
        if (!o.isInstancedMesh) return;
        const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <defaultnormal_vertex>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
        o.material.onBeforeCompile(shader);
        assert.ok(shader.uniforms.uRipe && shader.fragmentShader.includes('uRipe'), `${key}: ${o.name} ripens with the season`);
        assert.match(o.material.customProgramCacheKey(), new RegExp(`season-${o.material.userData.season}`));
      });
      p.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    }
  });

  it('cotton bolls burst white and a rice paddy drains as they ripen; the paddy water keeps its size', () => {
    const cotton = plantField('cotton', square, { seed: 2 });
    assert.equal(cotton.children.find((m) => m.name === 'cotton boll').material.userData.season, 'boll');
    assert.equal(cotton.children.find((m) => m.name === 'cotton leaf').material.userData.season, 'crop');
    const rice = plantField('rice', square, { seed: 2 });
    const water = rice.children.find((m) => m.name === 'rice water');
    assert.equal(water.material.userData.season, 'paddy');
    const width = () => { const m = new THREE.Matrix4(); water.getMatrixAt(0, m); return new THREE.Vector3().setFromMatrixColumn(m, 0).length(); };
    const full = width();
    rice.userData.setSize(0.1);
    assert.ok(Math.abs(width() - full) < 1e-6, 'a young paddy is still flooded');
    rice.userData.setSize(0);
    assert.equal(water.visible, false, 'no water once the field is bare');
    for (const g of [cotton, rice]) g.traverse((o) => o.isInstancedMesh && o.dispose());
  });

  it('builds the same field every time (seeded)', () => {
    for (const key of NEW_KEYS) {
      const a = plantField(key, SHAPES.square, { seed: 9 }), b = plantField(key, SHAPES.square, { seed: 9 });
      assert.equal(a.userData.count, b.userData.count);
      assert.deepEqual(Array.from(a.children[0].instanceMatrix.array), Array.from(b.children[0].instanceMatrix.array), key);
      for (const g of [a, b]) g.traverse((o) => o.isInstancedMesh && o.dispose());
    }
  });
});
