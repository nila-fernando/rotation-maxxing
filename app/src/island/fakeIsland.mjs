// Stand-in farms for the island tests (no browser). Not a test itself: the .mjs name keeps it out
// of the *.test.js run.
//
//   fakeView()          the festival themes' small farm (src/island/themes/themes.test.js): four
//                       square fields round a farmyard, a barn, a farmhouse, a shed, trees, lamps
//                       and a sheep, plus each prop's own box, the windmill's sails, a scene and a
//                       renderer stub
//   plannedView(input)  a real island the way the reveal builds it (src/screens/reveal.js): the
//                       plan (planIsland), the terrain with its grass tufts, every field's real
//                       paddock and gate, the barn, silo, farmhouse, lighthouse, windmill (and its sails), the
//                       trees, a lamp by each gate, the upgrade pads and a few sheep
//   demoFields, fifteenFields()   the demo farm's 5 fields, and 15 (two copies 3 km away)
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

// a canvas that draws nothing (some shared makers paint a little texture)
globalThis.document ??= {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) }) }),
};
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { makeFarmLamp, LAMP_FOOTPRINT } = await import('./lamps.js');
const { makeBarn, makeSilo, makeWindmill, makeTree, FOOTPRINT } = await import('./props.js');
const { makeFarmhouse, BUILDING_FOOTPRINT } = await import('./buildings.js');
const { makeLighthouse } = await import('./lighthouse.js');
const { openGround, placeLighthouse, placeWindmill } = await import('./landmarks.js');
const { planIsland } = await import('./plan.js');
const { buildIslandTerrain, levelHeight } = await import('./terrain.js');
const { makeFieldPaddock } = await import('./paddocks.js');
const { createFlock } = await import('./wander.js');
const { pointInPolygons, distanceToEdges } = await import('./picking.js');

const PROP_SCALE = 0.75; // as the reveal places them

/** A renderer that only counts what it was asked to compile. */
const fakeRenderer = () => ({ compiled: 0, compileAsync(obj) { this.compiled++; this.last = obj; return Promise.resolve(); } });

// the props' own boxes (unscaled, as src/island/clearance.js reads them), as the coin stacks' test has them
const BOX = {
  barn: [[-1, 0, -0.8], [1, 2.27, 0.8]],
  farmhouse: [[-0.7, 0, -0.6], [0.7, 1.6, 0.6]],
  machineShed: [[-0.9, 0, -0.7], [0.9, 1.3, 0.7]],
  windmill: [[-0.6, 0, -0.6], [0.6, 3.47, 0.6]],
  silo: [[-0.45, 0, -0.45], [0.45, 2.4, 0.45]],
  tree: [[-0.4, 0, -0.4], [0.4, 2.13, 0.4]],
  pine: [[-0.4, 0, -0.4], [0.4, 2.4, 0.4]],
};

/** A small farm: four square fields round a farmyard, a barn, a farmhouse, a shed, trees, lamps, sheep. */
export function fakeView() {
  const island = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(island);
  const square = (cx, cz, h = 1.1) => [[[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]]];
  const fields = [[-3.2, -2.6], [3.2, -2.6], [-3.4, 2.8], [3.4, 2.9]].map(([x, z], i) => ({
    id: `f${i}`, polygons: [square(x, z)], topY: 0.75, paddock: { userData: { gate: { x: x + (x < 0 ? 1.1 : -1.1), z, nx: x < 0 ? 1 : -1, nz: 0 } } },
  }));
  const barn = new THREE.Group();
  const lamps = [[-1.4, 1.8], [1.6, 1.7], [0.2, 4.6]].map(([x, z]) => {
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
  ].map((p) => ({ ...p, box: { min: BOX[p.key][0], max: BOX[p.key][1] } })); // (each with its own box, as the reveal records it)
  // the windmill's sails: a cross of two blades round a hub over the windmill
  const sails = new THREE.Group();
  sails.position.set(0.4, 3.3, -4.75);
  for (const r of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 0.05));
    blade.rotation.z = r;
    sails.add(blade);
  }
  island.add(sails);
  const obstacles = props.map((p) => ({ x: p.x, z: p.z, r: p.r }));
  const sheep = [{ g: { position: { x: 2.3, z: 1.9 } }, size: 0.6 }];
  return {
    island, scene, barn, lamps, props, obstacles, spinners: [sails],
    heightAt: () => 0.6,
    center: new THREE.Vector3(0, 0.4, 0), radius: 7.5, barnScale: 0.75,
    farmstead: { at: [0, -0.4], facing: 0, yard: { at: [0, 0], r: 1.6 } },
    fields, slots: [{ kind: 'building', at: [-2.4, -0.6], r: 0.7 }],
    flock: { sheep, walkable: (x, z) => Math.hypot(x, z) < 7 },
    terrainField: { pathMask: (x, z) => (Math.abs(Math.hypot(x, z) - 2.1) < 0.25 ? 0.3 : 0), maxCoast: 7.5 },
    camera: new THREE.PerspectiveCamera(30, 1.6, 0.05, 5000),
    renderer: fakeRenderer(),
  };
}

// ---------------------------------------------------------------- real islands

const demo = JSON.parse(readFileSync(new URL('../../data/demo-farm.json', import.meta.url), 'utf8'));
const lastCrop = (f) => (f.cropHistory && f.cropHistory.length ? f.cropHistory[f.cropHistory.length - 1].crop : null);
export const demoFields = demo.fields.map((f) => ({ id: f.id, name: f.name, geometry: f.geometry, elevationM: f.elevationM, crop: lastCrop(f) }));
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
export const fifteenFields = () => [[0, 0, ''], [3000, 3000, 'b'], [-3000, -3000, 'c']]
  .flatMap(([e, n, tag]) => demoFields.map((f) => ({ ...f, id: f.id + tag, geometry: shiftGeometry(f.geometry, e, n) })));

/**
 * A real island for these fields, built the way the reveal builds it (a little simpler: the
 * starter buildings past the farmhouse, the well, the greenhouse, the dock and the path lamps are
 * left out). Every prop is a real model on the island, so its box is its real box.
 */
export function plannedView(input = demoFields, { seed = SEED, home = HOME } = {}) {
  const plan = planIsland(input, { seed, home });
  const terrain = buildIslandTerrain(plan, { seed });
  const heightAt = terrain.heightAt;
  const scene = new THREE.Scene();
  const island = new THREE.Group();
  island.add(terrain.group);
  scene.add(island);
  const farmAt = plan.farmstead?.at || [0, 0];

  // the fields: each paddock in its own holder in the scene (not the island), as the reveal has them
  const fields = plan.fields.map((pf, i) => {
    const paddock = makeFieldPaddock(pf.polygons, { cropKey: pf.crop || 'corn', seed: 11 + i * 7, gateToward: farmAt });
    const holder = new THREE.Group();
    holder.add(paddock);
    holder.position.set(0, levelHeight(pf.level ?? 0), 0);
    scene.add(holder);
    holder.updateMatrixWorld(true);
    return { id: pf.id, name: input.find((f) => f.id === pf.id)?.name, polygons: pf.polygons, topY: holder.position.y + (paddock.userData.bedHeight ?? 0.18), paddock, holder, gateToward: farmAt };
  });

  const obstacles = [];
  const props = [];
  const spinners = [];
  const addProp = (obj, [x, z], scale, ry = 0, key) => {
    const r = (FOOTPRINT[key] ?? BUILDING_FOOTPRINT[key] ?? (key === 'lampPost' ? LAMP_FOOTPRINT : 0.4)) * scale;
    obstacles.push({ x, z, r });
    if (obj.userData.blades) spinners.push(obj.userData.blades);
    const box = new THREE.Box3();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { if ((o.isMesh || o.isSprite) && !o.userData.noBox) box.expandByObject(o, false); });
    props.push({ key, x, z, r, ry, scale, height: Math.max(0, box.max.y) * scale, y: heightAt(x, z), box: { min: box.min.toArray(), max: box.max.toArray() } });
    const wrap = new THREE.Group();
    wrap.position.set(x, heightAt(x, z), z);
    wrap.rotation.y = ry;
    wrap.scale.setScalar(scale);
    wrap.add(obj);
    island.add(wrap);
    return wrap;
  };
  const inField = (x, z, pad) => plan.fields.some((f) => pointInPolygons(x, z, f.polygons) || distanceToEdges(x, z, f.polygons) < pad);
  const onSlot = (x, z, r) => plan.slots.some((sl) => Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + r);
  const clearOfProps = (x, z, r) => obstacles.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r + 0.12);

  // the barn on the farmstead, the silo beside it, a farmhouse on the nearest building pad
  const { at, facing = 0 } = plan.farmstead;
  const barn = makeBarn();
  addProp(barn, at, PROP_SCALE, facing, 'barn');
  const siloR = FOOTPRINT.silo * PROP_SCALE;
  for (const a of [Math.PI / 2, -Math.PI / 2, (Math.PI * 3) / 4, -(Math.PI * 3) / 4]) {
    const d = FOOTPRINT.barn * PROP_SCALE + siloR + 0.15;
    const x = at[0] + Math.sin(facing + a) * d, z = at[1] + Math.cos(facing + a) * d;
    if (!inField(x, z, 0) && !onSlot(x, z, siloR) && clearOfProps(x, z, siloR)) { addProp(makeSilo(), [x, z], PROP_SCALE, 0, 'silo'); break; }
  }
  const pad = plan.slots.filter((sl) => sl.kind === 'building').sort((a, b) => Math.hypot(a.at[0] - at[0], a.at[1] - at[1]) - Math.hypot(b.at[0] - at[0], b.at[1] - at[1]))[0];
  if (pad) { addProp(makeFarmhouse(), pad.at, Math.min(PROP_SCALE, pad.r / BUILDING_FOOTPRINT.farmhouse), 0, 'farmhouse'); pad.filled = 'farmhouse'; }
  // the lighthouse on the highest point and the windmill on other high ground (src/island/landmarks.js)
  const field = terrain.field;
  const [cx, cz] = field.center;
  const radius = field.maxCoast;
  const open = openGround({ terrain, plan, obstacles });
  const lighthouse = placeLighthouse({ terrain, plan, obstacles, open, addProp: (o, at, sc, ry, key) => addProp(o, at, sc, ry, key), make: makeLighthouse, props, scale: PROP_SCALE });
  placeWindmill({ terrain, plan, obstacles, open, addProp: (o, at, sc, ry, key) => addProp(o, at, sc, ry, key), make: makeWindmill, lighthouse, scale: PROP_SCALE });
  // trees on the tree pads
  const kinds = ['tulip-green', 'round', 'pine', 'blossom', 'tulip-yellow', 'round'];
  plan.slots.filter((sl) => sl.kind === 'tree').forEach((sl, i) => {
    const kind = kinds[i % kinds.length];
    addProp(makeTree(kind, 20 + i), sl.at, PROP_SCALE * (0.85 + (i % 3) * 0.1), 0, kind === 'pine' ? 'pine' : 'tree');
  });

  // a lamp beside each field's gate (the reveal's own candidates), nearest the farmyard first
  const lamps = [];
  const lampR = LAMP_FOOTPRINT * PROP_SCALE;
  const lampOk = (x, z) => {
    const h = heightAt(x, z);
    if (h < levelHeight(0) - 0.1 || Math.hypot(x - cx, z - cz) > field.coastR(Math.atan2(z - cz, x - cx)) - 0.6) return false;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      if (Math.abs(heightAt(x + Math.cos(a) * 0.14, z + Math.sin(a) * 0.14) - h) > 0.09) return false;
    }
    if ((field.pondMask(x, z) ?? 0) > 0.02 || (field.cragMask(x, z) ?? 0) > 0.08) return false;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + lampR + 0.12)) return false;
    if (plan.slots.some((sl) => sl.kind !== 'tree' && Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + lampR + 0.1)) return false;
    if (inField(x, z, lampR + 0.22)) return false;
    return lamps.every((l) => Math.hypot(l.at[0] - x, l.at[1] - z) > 1.3);
  };
  const gates = fields.map((f) => f.paddock.userData.gate).filter(Boolean)
    .sort((a, b) => Math.hypot(a.x - farmAt[0], a.z - farmAt[1]) - Math.hypot(b.x - farmAt[0], b.z - farmAt[1]));
  for (const g of gates.slice(0, 5)) {
    const tx = -g.nz, tz = g.nx;
    let spot = null;
    for (const out of [0.4, 0.6, 0.85, 1.1]) for (const along of [0.5, 0.75, 1.05, 1.35]) for (const side of [1, -1]) {
      const c = [g.x + g.nx * out + tx * side * along, g.z + g.nz * out + tz * side * along];
      if (!spot && lampOk(c[0], c[1])) spot = c;
    }
    if (!spot) continue;
    const lamp = makeFarmLamp({ light: false });
    addProp(lamp, spot, PROP_SCALE, Math.atan2(-(g.z + g.nz * 0.3 - spot[1]), g.x + g.nx * 0.3 - spot[0]), 'lampPost');
    lamps.push({ ...lamp.userData.lamp, at: spot });
  }

  // a few sheep in the farmyard and out on the grass (stand-ins: just where they stand and how big)
  const flock = createFlock({ heightAt, field, fields: plan.fields.map((pf) => pf.polygons), obstacles, minHeight: levelHeight(0) - 0.15, rnd: () => 0.5 });
  const yard = plan.farmstead.yard?.at || at;
  for (const [dx, dz] of [[1.8, 0.6], [-1.6, 1.4], [0.4, 2.6], [3.5, -2], [-3, -3]]) {
    const s = flock.findSpot(yard[0] + dx, yard[1] + dz, 0.6);
    if (s) flock.sheep.push({ g: { position: { x: s[0], z: s[1] } }, size: 0.6 });
  }

  island.updateMatrixWorld(true);
  return {
    plan, island, scene, barn, lamps, props, obstacles, spinners, fields, flock,
    heightAt, terrainField: field,
    center: new THREE.Vector3(cx, levelHeight(0) * 0.6, cz), radius, barnScale: PROP_SCALE,
    farmstead: plan.farmstead, slots: plan.slots,
    camera: new THREE.PerspectiveCamera(30, 1.6, 0.05, 5000),
    renderer: fakeRenderer(),
  };
}
