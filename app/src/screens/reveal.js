// Step 4 · The island reveal (2–3 s), after Manami's check-in.
//
//   1. The flat satellite map tilts to about 45° (the same tiles, redrawn in 3D, so it's seamless).
//   2. The chosen fields rise up as soil beds in their real shapes; the rest of the map fades away.
//   3. The camera pulls back, the fields glide together onto the farm's own island (packed close,
//      each on its contour step) while the island rises out of the lavender sea.
//   4. Fences and low-poly crops pop in (each field's most recent crop), then the farmstead,
//      trees and sheep. The upgrade slots stay empty for later.
//   5. Manami: "Here's your farm! …"
//
// Works for 1 to 15 fields. Click anywhere to skip to the end. With prefers-reduced-motion the map
// simply crossfades into the finished island.
//
// Units: the plan (src/island/plan.js) packs the real shapes in metres and converts to "island
// units" like the prototype diorama: X east, Z south (north is away from the camera, up on screen,
// as on the map). Real (map) positions use the same scale, so the first frame matches the map.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TILE_URL } from '../config.js';
import { findFieldBySourceId, getFarm } from '../data/farmData.js';
import { acresOf } from '../fields/geometry.js';
import { cropKeyFor } from '../island/crops.js';
import { makeFieldPaddock } from '../island/paddocks.js';
import { planIsland } from '../island/plan.js';
import {
  addIslandFog, addIslandLights, configureRenderer, FOOTPRINT, loadSheepTemplate, makeBarn, makeDock, makeHayBale,
  makeRowboat, makeSheep, makeSilo, makeTree, makeWindmill, mergeStatic, rng,
} from '../island/props.js';
import { BUILDING_FOOTPRINT, makeChickenCoop, makeFarmhouse, makeGrainBins, makeGreenhouse, makeMachineShed, makeWell } from '../island/buildings.js';
import { LAMP_FOOTPRINT, makeFarmLamp } from '../island/lamps.js';
import { buildIslandTerrain } from '../island/terrain.js';
import { attachSeasons } from '../island/seasons.js';
import { createFlock } from '../island/wander.js';
import { asset } from '../ui/asset.js';

const DURATION = 2.8; // seconds, start to still island
const FOV = 30;
const PITCH_END = 42; // degrees above the horizon at the end
const YAW_END = -0.2; // a slight turn so the island reads in 3D
const PROP_SCALE = 0.75; // the prototype's props, a little smaller next to real-shaped fields
const SHORE_SCALE = 0.9; // the dock and rowboat
const SINK = 3.2; // how far below the sea the island starts
const SHEEP_URL = asset('/models/manami.glb');

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const phase = (t, a, b) => clamp01((t - a) / (b - a));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const lerp = (a, b, t) => a + (b - a) * t;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} o
 * @param {import('leaflet').Map} o.map
 * @param {{say: Function}} o.manami
 * @param {(state: object) => void} [o.onDone]
 */
export function createReveal({ map, manami, onDone }) {
  const root = document.getElementById('reveal');
  let run = 0;
  let renderer = null;
  let raf = 0;
  let cleanup = [];
  const api = { start, stop };

  /**
   * @param {{fields: object[], farm: object, instant?: boolean}} o  fields from the field step (geometry,
   *   crops, sourceIds, name); instant: skip the animation and fade straight to the still island
   */
  async function start({ fields, farm, instant = false }) {
    stop();
    const id = ++run;
    const alive = () => id === run;

    // ------------------------------------------------------------ data → plan → terrain
    const input = fields.map((f) => {
      const demo = f.sourceIds?.length === 1 ? findFieldBySourceId(f.sourceIds[0]) : null;
      const acres = Number.isFinite(f.acres) ? f.acres : (demo?.acres ?? acresOf(f.geometry));
      return { id: f.id, name: f.name, geometry: f.geometry, acres, elevationM: demo?.elevationM ?? null, crop: latestCrop(f, demo), years: yearsOf(f, demo) };
    });
    const seed = farm?.demo ? getFarm().name : (farm?.label || farm?.id || 'farm');
    const plan = planIsland(input, { seed, home: farm ? [farm.lon, farm.lat] : undefined });
    const { s, layout } = plan;
    const byId = new Map(input.map((f) => [f.id, f]));
    const terrain = buildIslandTerrain(plan, { seed });
    const islandRadius = terrain.field?.maxCoast ?? plan.radius;

    // ------------------------------------------------------------ renderer, scene, camera
    root.replaceChildren();
    root.hidden = false;
    root.style.opacity = '0';
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    configureRenderer(renderer); // the prototype's tone mapping, colour space and shadows
    root.appendChild(renderer.domElement);
    const labelsEl = document.createElement('div');
    labelsEl.className = 'reveal__labels';
    root.appendChild(labelsEl);

    const scene = new THREE.Scene();
    const lights = addIslandLights(scene, islandRadius);
    lights.fit(islandRadius * 1.1, new THREE.Vector3(0, 0, 0));
    const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 5000);

    // where the map is looking right now, in island units
    const mapCenter = map.getCenter();
    const [mcx, mcz] = plan.toScene(layout.project([mapCenter.lng, mapCenter.lat]));
    const metersPerPixel = (40075016.686 * Math.cos((mapCenter.lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
    const startDist = (metersPerPixel * innerHeight * s) / 2 / Math.tan((FOV * Math.PI) / 360);

    // the satellite ground (the map, redrawn) and the island that rises out of the sea later
    const ground = buildGround(map, (lngLat) => plan.toScene(layout.project(lngLat)));
    scene.add(ground.group);
    const island = new THREE.Group();
    island.add(terrain.group);
    island.visible = false;
    scene.add(island);

    // ------------------------------------------------------------ the fields as paddocks
    const farmAt = plan.farmstead?.at || [0, 0];
    const fieldGroups = plan.fields.map((pf, i) => {
      const info = byId.get(pf.id);
      const lf = layout.fields.find((f) => f.id === pf.id);
      const cropKey = cropKeyFor(info.crop || 'other');
      const paddockSeed = 11 + i * 7;
      const paddock = makeFieldPaddock(pf.polygons, { cropKey, seed: paddockSeed, gateToward: farmAt });
      paddock.userData.setGrowth?.(0);
      // the beds start see-through (the first frame is just the map) and take their soil colour as they rise;
      // their materials are cloned so the shared paddock materials aren't touched
      // (everything but the crops, which have their own pop-in: beds, furrow ridges, fence, pivot)
      const beds = [];
      const crops = paddock.userData.crops;
      paddock.traverse((m) => {
        if (!m.isMesh || !m.material) return;
        for (let p = m; p; p = p.parent) if (p === crops) return;
        m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
        beds.push(...(Array.isArray(m.material) ? m.material : [m.material]));
      });
      beds.forEach((mat) => { mat.transparent = true; mat.opacity = 0; });
      const holder = new THREE.Group(); // carries the glide from the real spot to the island spot
      holder.add(paddock);
      scene.add(holder);
      // the real position relative to the island position: real = island − offset (metres; Z is south)
      const start = [-lf.offset[0] * s, lf.offset[1] * s];
      return { pf, holder, paddock, beds, start, cropKey, paddockSeed, finalY: terrain.levelHeight(pf.level ?? 0), delay: (i / Math.max(1, plan.fields.length - 1)) * 0.25 };
    });

    // ------------------------------------------------------------ farmstead, trees, sheep (upgrade slots stay empty)
    const pops = [];
    const obstacles = []; // round footprints the sheep walk around
    const spinners = []; // windmill sails (they turn on the hub: src/screens/timeTravel.js)
    // every prop placed: { key, x, z, r, ry, scale, height, y, box } (the festival themes dress them,
    // and keep clear of their real shapes: box is the prop's own unrotated, unscaled bounding box)
    const props = [];
    const addProp = (obj, [x, z], scale, ry = 0, key = null) => {
      if (key) obstacles.push({ x, z, r: (FOOTPRINT[key] ?? BUILDING_FOOTPRINT[key] ?? 0.4) * scale });
      if (obj.userData.blades) spinners.push(obj.userData.blades);
      if (key) {
        // (its solid parts: not a lamp's glow on the ground or its halo)
        const box = new THREE.Box3();
        obj.updateMatrixWorld(true);
        obj.traverse((o) => { if ((o.isMesh || o.isSprite) && !o.userData.noBox) box.expandByObject(o, false); });
        if (box.isEmpty()) box.setFromObject(obj);
        props.push({
          key, x, z, r: (FOOTPRINT[key] ?? BUILDING_FOOTPRINT[key] ?? 0.4) * scale, ry, scale,
          height: Math.max(0, box.max.y) * scale, y: terrain.heightAt(x, z),
          box: { min: box.min.toArray(), max: box.max.toArray() },
        });
      }
      // one draw call per material (the blades can still turn; a lamp's glass and glow fade by themselves)
      mergeStatic(obj, { keep: [obj.userData.blades, ...(obj.userData.keep || [])] });
      const wrap = new THREE.Group(); // the pop-in scales the wrapper; the prop keeps its own size
      wrap.position.set(x, terrain.heightAt(x, z), z);
      wrap.rotation.y = ry;
      wrap.add(obj);
      wrap.userData.finalScale = scale;
      wrap.scale.setScalar(0.001);
      island.add(wrap);
      pops.push(wrap);
      return wrap;
    };
    let barn = null;
    let placeNearBarn = null; // (the windmill's last resort)
    let windmillYard = () => []; // free spots in the farmyard, for the windmill
    if (plan.farmstead) {
      const { at, facing = 0 } = plan.farmstead;
      barn = makeBarn();
      addProp(barn, at, PROP_SCALE, facing, 'barn');
      // silo, windmill and a hay bale round the barn, each clear of the others (by the props'
      // footprints) and on level grass or yard, trying the sides first, then behind
      const baseY = terrain.heightAt(at[0], at[1]);
      const placed = [{ at, r: FOOTPRINT.barn * PROP_SCALE }];
      const side = (a, d) => [at[0] + Math.sin(facing + a) * d, at[1] + Math.cos(facing + a) * d];
      const fits = ([x, z], r) => {
        for (let k = 0; k < 8; k++) {
          const px = x + Math.cos((k / 8) * Math.PI * 2) * r, pz = z + Math.sin((k / 8) * Math.PI * 2) * r;
          if (Math.abs(terrain.heightAt(px, pz) - baseY) > 0.06) return false; // off the level ground
        }
        if (plan.fields.some((pf) => pf.polygons.some((rings) => inRing([x, z], rings[0])))) return false;
        // keep the reserved upgrade pads free, and the tree spots (the trees go in later)
        if (plan.slots.some((sl) => Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + r)) return false;
        return placed.every((p) => Math.hypot(p.at[0] - x, p.at[1] - z) > p.r + r + 0.12);
      };
      // candidates: beside the barn first, then anywhere round the farmyard
      const yard = plan.farmstead.yard;
      const yardCands = (r, angles) => {
        const cands = [];
        for (const a of angles) for (const extra of [0.15, 0.4, 0.7]) cands.push(side(a, FOOTPRINT.barn * PROP_SCALE + r + extra));
        if (yard) for (let k = 0; k < 16; k++) for (const f of [0.8, 0.55, 0.3]) cands.push([yard.at[0] + Math.cos((k / 16) * Math.PI * 2) * (yard.r - r) * f, yard.at[1] + Math.sin((k / 16) * Math.PI * 2) * (yard.r - r) * f]);
        return cands;
      };
      const tryPlace = (make, key, angles, ry = 0) => {
        const r = (FOOTPRINT[key] ?? 0.5) * PROP_SCALE;
        for (const p of yardCands(r, angles)) {
          if (fits(p, r)) { addProp(make(), p, PROP_SCALE, ry, key); placed.push({ at: p, r }); return; }
        }
      };
      tryPlace(makeSilo, 'silo', [Math.PI / 2, -Math.PI / 2, (Math.PI * 3) / 4, -(Math.PI * 3) / 4]);
      tryPlace(() => makeHayBale(5), 'hayBale', [Math.PI, (Math.PI * 3) / 4, -(Math.PI * 3) / 4]);
      // the farmyard's free spots, for the windmill to weigh against the high ground
      const ALL_ROUND = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k / 8) * Math.PI * 2);
      windmillYard = (r) => yardCands(r, ALL_ROUND).filter((p) => fits(p, r));
      placeNearBarn = () => tryPlace(makeWindmill, 'windmill', [-Math.PI / 2, Math.PI / 2, -(Math.PI * 3) / 4, (Math.PI * 3) / 4, Math.PI], facing);
    }
    // ---- more farm buildings. The building pads nearest the farmstead get a starter set (one pad
    // always stays free for an upgrade later); a well and a greenhouse go on open, level grass near
    // the yard. Each turns to face between the yard and the camera's side (+z).
    if (plan.farmstead) {
      const home = plan.farmstead.yard?.at || plan.farmstead.at;
      const faceFrom = ([x, z]) => Math.atan2(home[0] - x, home[1] + 3 - z);
      const starter = [['farmhouse', makeFarmhouse], ['machineShed', makeMachineShed], ['grainBins', makeGrainBins], ['chickenCoop', makeChickenCoop]];
      const pads = plan.slots.filter((sl) => sl.kind === 'building')
        .sort((a, b) => Math.hypot(a.at[0] - home[0], a.at[1] - home[1]) - Math.hypot(b.at[0] - home[0], b.at[1] - home[1]));
      const fill = Math.min(starter.length, Math.max(0, pads.length - 1)); // one pad always stays free
      pads.slice(0, fill).forEach((sl, i) => {
        const [key, make] = starter[i];
        const scale = Math.min(PROP_SCALE, sl.r / BUILDING_FOOTPRINT[key]); // fits its pad
        addProp(make(), sl.at, scale, faceFrom(sl.at), key);
        sl.filled = key; // taken now (the upgrade pads left are the ones without this)
      });
      // open grass: off fields, pads, props and paths, level, on the island
      const level = (x, z, r) => {
        const h = terrain.heightAt(x, z);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (Math.abs(terrain.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - h) > 0.11) return false;
        }
        return true;
      };
      const open = (x, z, r) => terrain.field.isFree?.(x, z, r, { strict: true }) !== false
        && !obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.15)
        && !plan.slots.some((sl) => Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + r + 0.15)
        && !plan.fields.some((pf) => pf.polygons.some((rings) => inRing([x, z], rings[0]) || ringDistance([x, z], rings[0]) < r + 0.25))
        && level(x, z, r);
      const openSpot = (r) => {
        const cands = [];
        for (let d = (plan.farmstead.yard?.r || 1) + 0.5; d < 7; d += 0.35) {
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
      // (a little smaller if a full-size one doesn't fit anywhere)
      for (const [key, make] of [['greenhouse', makeGreenhouse], ['well', makeWell]]) {
        for (const scale of [PROP_SCALE, PROP_SCALE * 0.82]) {
          const spot = openSpot(BUILDING_FOOTPRINT[key] * scale);
          if (spot) { addProp(make(), spot, scale, faceFrom(spot), key); break; }
        }
      }
      // ---- the windmill on the island's high ground (the crag's flat top, a hill, or the farmyard
      // if that's highest), where it catches the wind and can be seen from the front: never tucked
      // behind a building or a tree. By the barn as a last resort.
      if (!placeWindmillHigh({ terrain, plan, obstacles, open, addProp, makeWindmill, yardSpots: windmillYard })) placeNearBarn?.();
    }

    const kinds = ['tulip-green', 'round', 'pine', 'blossom', 'tulip-yellow', 'round'];
    plan.slots.filter((sl) => sl.kind === 'tree').forEach((sl, i) => addProp(makeTree(kinds[i % kinds.length], 20 + i), sl.at, PROP_SCALE * (0.85 + (i % 3) * 0.1), 0, kinds[i % kinds.length] === 'pine' ? 'pine' : 'tree'));
    // the dock and rowboat on a free stretch of shore (like the prototype's cove)
    const shore = pickShore(plan, terrain);
    let boat = null;
    let dockAt = null;
    let boatAt = null;
    if (shore) {
      const [cx, cz] = terrain.field.center;
      const nx = Math.cos(shore.th), nz = Math.sin(shore.th);
      const atWater = (obj, x, z, y, ry) => {
        mergeStatic(obj);
        const wrap = new THREE.Group();
        wrap.position.set(x, y, z);
        wrap.rotation.y = ry;
        wrap.add(obj);
        wrap.userData.finalScale = SHORE_SCALE;
        wrap.scale.setScalar(0.001);
        island.add(wrap);
        pops.push(wrap);
        return wrap;
      };
      dockAt = [cx + nx * (shore.sr - 0.35 * SHORE_SCALE), cz + nz * (shore.sr - 0.35 * SHORE_SCALE)];
      atWater(makeDock(7), dockAt[0], dockAt[1], 0, Math.atan2(nx, nz));
      boat = makeRowboat();
      boatAt = [cx + nx * (shore.sr + 1.3 * SHORE_SCALE) - nz * 0.95 * SHORE_SCALE, cz + nz * (shore.sr + 1.3 * SHORE_SCALE) + nx * 0.95 * SHORE_SCALE];
      atWater(boat, boatAt[0], boatAt[1], 0.02, -Math.atan2(nz, nx) + 0.4);
    }

    // ---- lamps round the farm (they come on at dusk: src/island/dayNight.js)
    const lamps = placeLamps({ terrain, plan, obstacles, addProp, fieldGroups, shore, dockAt, scale: PROP_SCALE });

    const swimmers = [];
    // the land sheep wander about, never through fields, fences, buildings, trees, rocks or each other
    const flock = createFlock({
      heightAt: terrain.heightAt,
      field: terrain.field,
      fields: plan.fields.map((pf) => pf.polygons),
      obstacles,
      minHeight: terrain.levelHeight(0) - 0.15,
      rnd: rng(seedInt(seed) + 101),
    });
    const sheepReady = loadSheepTemplate(SHEEP_URL).then((tpl) => {
      if (!alive()) return [];
      // a sheep fishing in the boat, and two swimmers out in the sea
      if (boat) {
        const seat = boat.userData.seat;
        const fisher = makeSheep(tpl, { wool: 'cream', pose: 'sit', scale: 0.42 });
        fisher.position.set(seat.x, seat.y, seat.z);
        fisher.rotation.y = seat.ry;
        boat.add(fisher);
      }
      swimmers.push(...makeSwimmers(island, tpl, terrain, seed, dockAt ? [dockAt, boatAt] : []));
      return placeSheep(island, tpl, plan, terrain, flock);
    }).catch(() => []);

    // distance labels for far-away fields, shown at the end
    const labels = plan.fields.filter((pf) => pf.label).map((pf) => {
      const el = document.createElement('span');
      el.className = 'reveal__label';
      el.textContent = pf.label;
      labelsEl.appendChild(el);
      const [x, z] = pf.labelAt || pf.centroid;
      return { el, pos: new THREE.Vector3(x, terrain.levelHeight(pf.level ?? 0) + 0.9, z) };
    });

    // ------------------------------------------------------------ camera path
    const finalTarget = new THREE.Vector3(0, terrain.levelHeight(0) * 0.6, 0);
    const halfV = (FOV * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * (innerWidth / innerHeight));
    const finalDist = (islandRadius * 1.02) / Math.sin(Math.min(halfV, halfH)) * (innerWidth < 900 ? 0.95 : 0.8);
    const startTarget = new THREE.Vector3(mcx, 0, mcz);
    function placeCamera(target, dist, pitchDeg, yaw) {
      const p = (pitchDeg * Math.PI) / 180;
      camera.position.set(target.x + Math.sin(yaw) * Math.cos(p) * dist, target.y + Math.sin(p) * dist, target.z + Math.cos(yaw) * Math.cos(p) * dist);
      camera.up.set(0, 1, 0);
      if (pitchDeg > 89.9) camera.up.set(-Math.sin(yaw), 0, -Math.cos(yaw)); // straight down: keep north up
      camera.lookAt(target);
    }
    let fogOn = false;

    // ------------------------------------------------------------ the timeline
    let finished = false;
    const sheep = [];
    sheepReady.then((list) => { sheep.push(...list); if (finished) list.forEach((o) => o.scale.setScalar(o.userData.finalScale || 1)); });

    function apply(time) {
      const tilt = easeInOut(phase(time, 0, 0.6));
      const rise = phase(time, 0.25, 0.95);
      const fade = phase(time, 0.45, 1.15);
      const glide = easeInOut(phase(time, 0.95, 2.0));
      const pull = easeInOut(phase(time, 0.85, 2.0));
      const emerge = easeInOut(phase(time, 1.0, 2.0));
      const grow = phase(time, 1.9, 2.6);

      const target = startTarget.clone().lerp(finalTarget, pull);
      placeCamera(target, lerp(startDist, finalDist, pull), lerp(90, PITCH_END, tilt), YAW_END * pull);

      ground.setOpacity(1 - fade);
      island.visible = emerge > 0;
      const islandY = lerp(-SINK, 0, emerge);
      island.position.y = islandY;
      if (emerge > 0.5 && !fogOn) { fogOn = true; addIslandFog(scene, islandRadius); }

      for (const fg of fieldGroups) {
        const r = easeInOut(clamp01((rise - fg.delay * 0.4) / 0.75));
        // rise from the map as a bed, then glide to the island spot and settle on its contour step
        fg.paddock.scale.y = Math.max(0.02, r);
        fg.beds.forEach((m) => { m.opacity = Math.min(1, r * 1.6); m.transparent = m.opacity < 1; });
        fg.holder.position.set(fg.start[0] * (1 - glide), lerp(0.02, islandY + fg.finalY, glide), fg.start[1] * (1 - glide));
        fg.paddock.userData.setGrowth?.(clamp01((grow - fg.delay) / 0.75));
      }
      const popT = phase(time, 2.3, 2.8);
      pops.forEach((o, i) => o.scale.setScalar(Math.max(0.001, easeOutBack(clamp01(popT * 1.4 - (i % 12) * 0.03)) * (o.userData.finalScale || 1))));
      sheep.forEach((o) => o.scale.setScalar(Math.max(0.001, easeOutBack(clamp01(popT * 1.3)) * (o.userData.finalScale || 1))));
      labels.forEach((l) => { l.el.style.opacity = String(phase(time, 2.4, 2.8)); });
    }

    const clock = performance.now();
    const v = new THREE.Vector3();
    let swimFrom = null; // swimmers start once the island has risen
    let lastNow = null; // the land sheep start walking once the island is still
    function renderOnce() {
      const now = (performance.now() - clock) / 1000;
      terrain.update?.(now);
      if (island.visible && island.position.y > -0.05) {
        if (swimFrom === null) swimFrom = now;
        swimmers.forEach((sw) => sw.update(now - swimFrom));
      }
      if (finished) {
        flock.update(lastNow === null ? 0 : now - lastNow, now);
        lastNow = now;
      }
      renderer.render(scene, camera);
      for (const l of labels) {
        v.copy(l.pos).project(camera);
        l.el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px)`;
      }
    }

    // wait (briefly) for the satellite tiles so the tilt starts from the real imagery
    await Promise.race([ground.ready, new Promise((r) => setTimeout(r, 1500))]);
    if (!alive()) return null;
    // build every shader before the first visible frame (show the end state once to compile it all)
    apply(DURATION);
    attachSeasons(scene); // the hub's seasons patch, added now so these shaders are built once (looks the same until a season is set)
    await renderer.compileAsync?.(scene, camera);
    renderer.render(scene, camera);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!alive()) return null;

    const resizeHooks = new Set(); // the hub re-centres the island when the window changes
    const onResize = () => {
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      resizeHooks.forEach((fn) => fn());
      if (finished) renderOnce();
    };
    addEventListener('resize', onResize);
    cleanup.push(() => removeEventListener('resize', onResize));

    const result = {
      plan, // fields, farmstead, empty upgrade slots, terraces, coast: what later steps build on
      fields: plan.fields.map((pf) => {
        const info = byId.get(pf.id);
        return { id: pf.id, name: info.name, acres: info.acres, crop: info.crop, cropKey: cropKeyFor(info.crop || 'other'), level: pf.level };
      }),
      view: null, // set once the island is still (see finish)
    };
    const frameHooks = new Set();
    const afterHooks = new Set(); // run after each frame is drawn (see onAfterFrame)
    const finish = () => {
      if (finished || !alive()) return;
      finished = true;
      apply(DURATION);
      ground.group.visible = false;
      renderOnce();
      // a gentle look-around once it's still (drag to turn, scroll to zoom a little); the sea keeps moving
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(finalTarget);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.minDistance = finalDist * 0.5;
      controls.maxDistance = finalDist * 1.35;
      controls.minPolarAngle = 0.35;
      controls.maxPolarAngle = 1.3;
      controls.update();
      cleanup.push(() => controls.dispose());
      let prev = performance.now();
      const idle = (nowMs) => {
        if (!alive()) return;
        const dt = Math.min(0.1, Math.max(0, (nowMs - prev) / 1000));
        prev = nowMs;
        frameHooks.forEach((fn) => fn(dt));
        controls.update();
        renderOnce();
        afterHooks.forEach((fn) => fn(dt));
        raf = requestAnimationFrame(idle);
      };
      raf = requestAnimationFrame(idle);
      // what the hub (Part 3.4) needs to drive the still island
      result.view = {
        root,
        renderer,
        scene,
        camera,
        controls,
        canvas: renderer.domElement,
        center: finalTarget.clone(),
        radius: islandRadius,
        overviewDist: finalDist,
        // each field's real outline (island units) and the height of its soil top, for picking
        fields: fieldGroups.map((fg) => ({
          id: fg.pf.id,
          polygons: fg.pf.polygons,
          topY: fg.holder.position.y + (fg.paddock.userData.bedHeight ?? 0.18),
          paddock: fg.paddock,
          // for building the same paddock with another year's crop (src/island/cropYears.js)
          holder: fg.holder,
          seed: fg.paddockSeed,
          gateToward: farmAt,
          cropKey: fg.cropKey,
        })),
        // for the seasons and decorations (src/island/seasons.js)
        island,
        lights,
        heightAt: terrain.heightAt,
        terrainField: terrain.field,
        farmstead: plan.farmstead || null,
        barn,
        barnScale: PROP_SCALE,
        flock,
        obstacles,
        slots: plan.slots, // reserved upgrade pads: decorations keep off them too
        lamps, // [{ glass, halo, pool, light, at }] for the day-night cycle
        spinners, // windmill sails: turn them with .rotation.z
        props, // the placed props, for the festival themes: [{ key, x, z, r, ry, scale, height, y }]
        seed,
        /** Runs fn(dt) every frame before the island is drawn; returns a remover. */
        onFrame(fn) { frameHooks.add(fn); return () => frameHooks.delete(fn); },
        /**
         * Runs fn(dt) every frame after the island is drawn; returns a remover. Project HTML here,
         * not in onFrame (one-frame lag): by now the camera's matrices are this frame's.
         */
        onAfterFrame(fn) { afterHooks.add(fn); return () => afterHooks.delete(fn); },
        /** Runs fn() after the canvas is resized; returns a remover. */
        onResize(fn) { resizeHooks.add(fn); return () => resizeHooks.delete(fn); },
      };
      manami.say(introLine(input));
      onDone?.(result);
    };

    // click anywhere to skip to the end (the running frame loop sees `finished` and stops)
    const skip = () => { if (!finished) finish(); };
    root.addEventListener('pointerdown', skip, { once: true });
    cleanup.push(() => root.removeEventListener('pointerdown', skip));
    if (import.meta.env.DEV) {
      // in the console: __sheep.reveal.seek(1.2) shows the frame at 1.2 s (stops the animation)
      api.seek = (time) => { finished = true; cancelAnimationFrame(raf); ground.group.visible = true; apply(time); renderOnce(); return time; };
      api.debug = { flock, swimmers, terrain, plan, obstacles };
    }

    if (reducedMotion() || instant) {
      // a simple crossfade: the finished island fades in over the map
      apply(DURATION);
      ground.group.visible = false;
      renderOnce();
      await fadeIn(root, 450);
      finish();
      return result;
    }

    // show the 3D copy of the map, then run the timeline
    apply(0);
    renderOnce();
    await fadeIn(root, 180);
    if (!alive()) return null;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = (now) => {
        if (!alive() || finished) return resolve();
        const t = Math.min(DURATION, (now - t0) / 1000);
        apply(t);
        renderOnce();
        if (t >= DURATION) { finish(); return resolve(); }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    });
    return result;
  }

  function stop() {
    run++;
    cancelAnimationFrame(raf);
    cleanup.forEach((fn) => fn());
    cleanup = [];
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer = null;
    }
    root.replaceChildren();
    root.hidden = true;
  }

  return api;
}

// ---------------------------------------------------------------- helpers

/** Point in polygon (ray casting) for one ring of [x, z]. */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a ring's edges. */
function ringDistance([x, z], ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const vx = bx - ax, vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

/** The newest crop we know for a field: its outline's crop years, else the demo data's history. */
function latestCrop(field, demo) {
  if (field.crops && Object.keys(field.crops).length) {
    const y = Object.keys(field.crops).sort().pop();
    return field.crops[y];
  }
  if (demo?.cropHistory?.length) return demo.cropHistory[demo.cropHistory.length - 1].crop;
  return null;
}

function yearsOf(field, demo) {
  const a = field.crops ? Object.keys(field.crops).length : 0;
  const b = demo?.cropHistory?.length || 0;
  return Math.max(a, b);
}

function introLine(fields) {
  const years = Math.min(...fields.map((f) => f.years));
  const tip = ' Tap any field for a closer look.';
  if (years >= 8) return `Here’s your farm! I’ve checked 8 years of crop history on every field.${tip}`;
  if (fields.some((f) => f.years > 0)) return `Here’s your farm! I’ve checked the crop history I could find for every field.${tip}`;
  return `Here’s your farm! I don’t have crop history for these fields yet, so I’ve planted a cover crop for now.${tip}`;
}

function fadeIn(el, ms) {
  return new Promise((resolve) => {
    // the clock starts on the first painted frame, so a slow first frame doesn't use the fade up
    let t0 = null;
    const step = (now) => {
      if (t0 === null) t0 = now;
      const k = clamp01((now - t0) / ms);
      el.style.opacity = String(k);
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

/**
 * A stretch of shore for the dock: nothing built within reach of it (fields, farmyard, pads), no
 * crag, and preferably on the side facing the camera so it's seen. Returns { th, sr } or null.
 */
function pickShore(plan, terrain) {
  const f = terrain.field;
  if (!f?.shoreR) return null;
  const [cx, cz] = f.center;
  const facing = Math.atan2(Math.cos(YAW_END), Math.sin(YAW_END)); // the camera's side of the island
  let best = null;
  for (let k = 0; k < 96; k++) {
    const th = (k / 96) * Math.PI * 2;
    const sr = f.shoreR(th);
    const nx = Math.cos(th), nz = Math.sin(th);
    let clear = true;
    // the dock's landward end and the beach behind it must be free of flats and the crag
    for (let d = 0.2; d <= 1.6 && clear; d += 0.35) {
      for (const side of [-0.7, 0, 0.7]) {
        const x = cx + nx * (sr - d) - nz * side, z = cz + nz * (sr - d) + nx * side;
        if (f.flatAt?.(x, z) || (f.cragMask?.(x, z) ?? 0) > 0.05 || (f.pondMask?.(x, z) ?? 0) > 0.05) clear = false;
      }
    }
    if (!clear) continue;
    const off = Math.abs(Math.atan2(Math.sin(th - facing), Math.cos(th - facing)));
    const score = off + (k % 2) * 0.001;
    if (!best || score < best.score) best = { th, sr, score };
  }
  return best;
}

/**
 * The windmill on the highest open ground of the island (a hill's the place for one), turned to
 * the camera's side, and not hidden behind a building, a big prop or a tree from there (the
 * camera looks from +z). Tries a slightly smaller windmill before giving up. Returns whether it did.
 */
function placeWindmillHigh({ terrain, plan, obstacles, open, addProp, makeWindmill, yardSpots = () => [] }) {
  const f = terrain.field;
  if (!f?.center) return false;
  const [cx, cz] = f.center;
  const R = f.maxCoast || plan.radius || 7;
  // higher first; on the same shelf, the front (toward the camera) and the middle win
  const score = (x, z) => terrain.heightAt(x, z) + (z - cz) * 0.012 - Math.hypot(x - cx, z - cz) * 0.004;
  const grid = [];
  for (let x = cx - R; x <= cx + R; x += 0.25) for (let z = cz - R; z <= cz + R; z += 0.25) grid.push({ x, z, score: score(x, z) });
  const trees = plan.slots.filter((sl) => sl.kind === 'tree');
  // the camera looks from +z: nothing big in front of it, and it isn't standing in front of a building
  const hidden = (x, z) => obstacles.some((o) => o.r > 0.4 && o.z > z && o.z - z < 3 && Math.abs(o.x - x) < o.r + 0.55)
    || trees.some((t) => t.at[1] > z && t.at[1] - z < 2.2 && Math.abs(t.at[0] - x) < 0.8);
  const blocking = (x, z) => obstacles.some((o) => o.r > 0.6 && o.z < z && z - o.z < 2.4 && Math.abs(o.x - x) < o.r * 0.8);
  const ryAt = (x, z) => Math.atan2(cx - x, cz + 12 - z);
  // the sails sweep a circle 1.3 across (makeWindmill: hub 2.2 up, 0.62 in front of the tower):
  // nothing may stand in it, a tree or a building or the ground itself (at a cliff edge)
  const sailsClear = (x, z, scale) => {
    const ry = ryAt(x, z), fx = Math.sin(ry), fz = Math.cos(ry), px = fz, pz = -fx; // facing, and across it
    const base = terrain.heightAt(x, z);
    const R = 1.3 * scale, hubY = base + 2.2 * scale, sx = x + fx * 0.62 * scale, sz = z + fz * 0.62 * scale;
    const inDisc = (ox, oz, or) => {
      const dx = ox - sx, dz = oz - sz;
      return Math.abs(dx * fx + dz * fz) < or + 0.15 && Math.abs(dx * px + dz * pz) < R + or;
    };
    if (obstacles.some((o) => inDisc(o.x, o.z, o.r))) return false;
    if (trees.some((t) => inDisc(t.at[0], t.at[1], t.r))) return false;
    for (let a = -Math.PI / 2; a <= Math.PI / 2 + 1e-6; a += Math.PI / 10) { // the lower half of the circle
      const l = Math.sin(a) * R, y = hubY - Math.cos(a) * R;
      if (terrain.heightAt(sx + px * l, sz + pz * l) > y - 0.05) return false;
    }
    return true;
  };
  for (const scale of [PROP_SCALE, PROP_SCALE * 0.85]) {
    const r = FOOTPRINT.windmill * scale;
    // open ground anywhere (the crag's flat top too), and the farmyard's free spots (clear of the
    // buildings put up since)
    const cands = [
      ...grid.filter((p) => open(p.x, p.z, r)),
      ...yardSpots(r).filter(([x, z]) => !obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.12))
        .map(([x, z]) => ({ x, z, score: score(x, z) })),
    ].sort((a, b) => b.score - a.score);
    const c = cands.find((p) => !hidden(p.x, p.z) && !blocking(p.x, p.z) && sailsClear(p.x, p.z, scale));
    if (c) {
      addProp(makeWindmill(), [c.x, c.z], scale, ryAt(c.x, c.z), 'windmill');
      // keep the space under the sails clear for what's placed after (lamps, decorations, festivals)
      const ry = ryAt(c.x, c.z), R = 1.3 * scale, sx = c.x + Math.sin(ry) * 0.62 * scale, sz = c.z + Math.cos(ry) * 0.62 * scale;
      for (const l of [-0.66, 0, 0.66]) obstacles.push({ x: sx + Math.cos(ry) * l * R, z: sz - Math.sin(ry) * l * R, r: R * 0.42 });
      return true;
    }
  }
  return false;
}

/**
 * Lamps round the farm: two by the farmyard, one beside the gate of each field nearest it, and one
 * at the landward end of the dock, each on firm, fairly level ground clear of fields, pads,
 * buildings and each other, with its lantern turned toward what it lights. The four nearest the
 * farmyard carry a real light; the rest only look lit (src/island/lamps.js). Returns their handles
 * ({ glass, halo, pool, light, at }); the lamps join the obstacles, so the sheep walk round them.
 */
function placeLamps({ terrain, plan, obstacles, addProp, fieldGroups, shore, dockAt, scale }) {
  const f = terrain.field;
  if (!f?.center) return [];
  const [cx, cz] = f.center;
  const home = plan.farmstead ? (plan.farmstead.yard?.at || plan.farmstead.at) : [cx, cz];
  const r = LAMP_FOOTPRINT * scale;
  const MAX = 9, REAL_LIGHTS = 4;
  const placed = [];
  // the post only needs a small level footing (not the top of a terrace step)
  const firm = (x, z, minY) => {
    const h = terrain.heightAt(x, z);
    if (h < minY) return false;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      if (Math.abs(terrain.heightAt(x + Math.cos(a) * 0.14, z + Math.sin(a) * 0.14) - h) > 0.09) return false;
    }
    return true;
  };
  const ok = (x, z, { beach = false } = {}) => {
    const th = Math.atan2(z - cz, x - cx);
    if (f.coastR && Math.hypot(x - cx, z - cz) > f.coastR(th) - (beach ? 0.25 : 0.6)) return false;
    if (!firm(x, z, beach ? terrain.seaLevel + 0.12 : terrain.levelHeight(0) - 0.1)) return false;
    if ((f.pondMask?.(x, z) ?? 0) > 0.02 || (f.cragMask?.(x, z) ?? 0) > 0.08) return false;
    if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.12)) return false;
    if (plan.slots.some((sl) => sl.kind !== 'tree' && Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + r + 0.1)) return false;
    if (plan.fields.some((pf) => pf.polygons.some((rings) => inRing([x, z], rings[0]) || ringDistance([x, z], rings[0]) < r + 0.22))) return false;
    return placed.every((l) => Math.hypot(l.at[0] - x, l.at[1] - z) > 1.3);
  };
  // its arm (the lamp's +x) reaches toward (tx, tz)
  const add = ([x, z], [tx, tz]) => {
    const lamp = makeFarmLamp({ light: placed.length < REAL_LIGHTS });
    addProp(lamp, [x, z], scale, Math.atan2(-(tz - z), tx - x), 'lampPost');
    placed.push({ ...lamp.userData.lamp, at: [x, z] });
  };
  const tryAt = (cands, target, opts) => {
    if (placed.length >= MAX) return false;
    const c = cands.find(([x, z]) => ok(x, z, opts));
    if (c) add(c, target);
    return !!c;
  };

  // the farmyard: two on its edge, either side, the front (the camera's side) first
  if (plan.farmstead) {
    const yr = (plan.farmstead.yard?.r || 1) + 0.2;
    for (const side of [1, -1]) {
      const cands = [];
      for (const d of [0, 0.25, 0.5, 0.8]) {
        for (let k = 0; k < 12; k++) {
          const a = Math.PI / 2 + side * (0.35 + k * 0.2); // from the front, round toward the back
          cands.push([home[0] + Math.cos(a) * (yr + d), home[1] + Math.sin(a) * (yr + d)]);
        }
      }
      tryAt(cands, home);
    }
  }
  // a lamp beside each field gate, nearest the farmyard first
  const gates = fieldGroups.map((fg) => fg.paddock.userData.gate).filter(Boolean)
    .sort((a, b) => Math.hypot(a.x - home[0], a.z - home[1]) - Math.hypot(b.x - home[0], b.z - home[1]));
  for (const g of gates.slice(0, 5)) {
    const tx = -g.nz, tz = g.nx; // along the fence
    const cands = [];
    for (const out of [0.4, 0.6, 0.85, 1.1]) for (const along of [0.5, 0.75, 1.05, 1.35]) for (const side of [1, -1]) {
      cands.push([g.x + g.nx * out + tx * side * along, g.z + g.nz * out + tz * side * along]);
    }
    tryAt(cands, [g.x + g.nx * 0.3, g.z + g.nz * 0.3]);
  }
  // then along the trodden paths round the flats (their edges, not on them), nearest the farmyard
  // first, until there are enough to light the way about
  if (placed.length < 7 && f.pathMask) {
    const R = f.maxCoast || plan.radius || 7;
    const along = [];
    for (let x = cx - R; x <= cx + R; x += 0.3) for (let z = cz - R; z <= cz + R; z += 0.3) {
      const p = f.pathMask(x, z);
      if (p > 0.12 && p < 0.5) along.push([x, z, Math.hypot(x - home[0], z - home[1])]);
    }
    along.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of along) {
      if (placed.length >= 7) break;
      if (ok(x, z) && placed.every((l) => Math.hypot(l.at[0] - x, l.at[1] - z) > 1.9)) add([x, z], home);
    }
  }
  // the dock: at its landward end, to one side
  if (shore && dockAt) {
    const nx = Math.cos(shore.th), nz = Math.sin(shore.th);
    const cands = [];
    for (const back of [0.15, 0.4, 0.7, 1.0]) for (const side of [0.62, -0.62, 0.85, -0.85]) {
      cands.push([dockAt[0] - nx * back - nz * side, dockAt[1] - nz * back + nx * side]);
    }
    tryAt(cands, dockAt, { beach: true });
  }
  return placed;
}

/**
 * Two sheep swimming in the sea, like the prototype: each pops up at a spot a little offshore,
 * paddles along, dives with a ripple ring, then turns up somewhere else. update(t) moves them.
 */
function makeSwimmers(island, template, terrain, seed, avoid = []) {
  const f = terrain.field;
  if (!f?.shoreR) return [];
  const [cx, cz] = f.center;
  const rnd = rng(seedInt(seed));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const out = [];
  for (let k = 0; k < 2; k++) {
    const g = makeSheep(template, { wool: k ? 'cream' : 'oat', pose: 'stand', scale: 0.5 }); // the prototype's swimmer size
    g.visible = false;
    island.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    island.add(ring);
    const st = { t0: -k * 5.2, x: 0, z: 0, dir: 0, dur: 7 };
    // a route is fine if every point along it is in deep water and clear of the dock, the boat
    // and the other swimmer, so a swimmer never paddles onto the beach or through the boat
    const routeOk = () => {
      const len = st.dur * 0.13;
      for (let d = 0; d <= len + 0.01; d += 0.15) {
        const x = st.x + Math.cos(st.dir) * d, z = st.z + Math.sin(st.dir) * d;
        if (terrain.heightAt(x, z) > -0.3) return false;
        if (avoid.some(([ax, az]) => Math.hypot(x - ax, z - az) < 2.2)) return false;
        if (out.some((o) => o !== self && o.near?.(x, z, 1.0))) return false;
      }
      return true;
    };
    let self = null;
    const choose = () => {
      for (let tries = 0; tries < 40; tries++) {
        // mostly on the camera's side of the island, where they won't be hidden behind it
        const facing = Math.atan2(Math.cos(YAW_END), Math.sin(YAW_END));
        const th = facing + (rnd() - 0.5) * 3.6;
        const r = f.shoreR(th) + 0.8 + rnd() * 1.4;
        st.x = cx + Math.cos(th) * r;
        st.z = cz + Math.sin(th) * r;
        st.dir = th + (rnd() < 0.5 ? 1 : -1) * Math.PI / 2;
        st.dur = 6 + rnd() * 3;
        if (routeOk()) return;
      }
      st.dur = 0; // nowhere good this time: stay under and try again next round
    };
    choose();
    self = {
      g,
      near: (x, z, r) => g.visible && Math.hypot(g.position.x - x, g.position.z - z) < r,
      update(t) {
        let lt = t - st.t0;
        if (lt > st.dur + 1.8) { st.t0 = t; choose(); lt = 0; }
        const up = smooth(0, 0.55, lt) * smooth(st.dur, st.dur - 0.55, lt);
        const sw = Math.min(Math.max(lt, 0), st.dur) * 0.13;
        const x = st.x + Math.cos(st.dir) * sw, z = st.z + Math.sin(st.dir) * sw;
        g.visible = up > 0.01;
        g.position.set(x, -0.44 + up * 0.36 + Math.sin(t * 3.2 + k) * 0.025 * up, z); // the prototype's bob: head and back above the water
        g.rotation.y = Math.atan2(Math.cos(st.dir), Math.sin(st.dir));
        const a = smooth(0, 0.15, lt) * smooth(1.5, 0.3, lt);
        const b = smooth(st.dur - 0.6, st.dur - 0.45, lt) * smooth(st.dur + 1.1, st.dur - 0.1, lt);
        const age = lt < 1.6 ? lt : lt - (st.dur - 0.55);
        ring.position.set(x, 0.02, z);
        ring.scale.setScalar(1 + Math.max(0, age) * 1.3);
        ring.material.opacity = 0.75 * Math.max(a, b);
      },
    };
    out.push(self);
  }
  return out;
}

/** A number from a seed that may be text (the farm's name). */
function seedInt(seed) {
  return typeof seed === 'number' ? seed : String(seed).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
}

/** Manami (black) and three friends near the farmstead; they join the flock and wander about. */
function placeSheep(island, template, plan, terrain, flock) {
  const at = plan.farmstead?.yard?.at || plan.farmstead?.at || [0, 0];
  const looks = [{ wool: 'black', graze: false }, { wool: 'cream', graze: true }, { wool: 'cocoa', graze: false }, { wool: 'pink', graze: true }];
  const out = [];
  looks.forEach((look, i) => {
    const a = i * 1.9 + 0.6, d = 1.8 + (i % 2) * 0.6;
    const sheep = makeSheep(template, { wool: look.wool, pose: 'stand' });
    const wrap = new THREE.Group(); // the pop-in scales the wrapper; the sheep keeps its own size
    wrap.add(sheep);
    wrap.position.set(at[0] + Math.cos(a) * d, 0, at[1] + Math.sin(a) * d);
    wrap.rotation.y = (i * 1.7) % (Math.PI * 2);
    wrap.userData.finalScale = PROP_SCALE;
    wrap.scale.setScalar(0.001);
    island.add(wrap);
    const height = (look.wool === 'black' ? 0.8 : 0.62) * PROP_SCALE; // makeSheep's sizes, times the wrapper
    flock.add(wrap, { size: height, graze: look.graze, body: sheep.userData.body || null });
    out.push(wrap);
  });
  return out;
}

/**
 * The satellite tiles under the current map view, as textured planes, so the first frame of the
 * reveal looks exactly like the map. toScene maps [lng, lat] to island units.
 */
function buildGround(map, toScene) {
  const group = new THREE.Group();
  const b = map.getBounds().pad(0.6); // extra round the edges: the tilt shows more ground
  const MAX = 48;
  // the map's own zoom if the view fits in MAX tiles, otherwise a step coarser until it does
  let z = Math.max(1, Math.min(19, Math.round(map.getZoom())));
  let n, x0, x1, y0, y1;
  const lonToX = (lon) => Math.floor(((lon + 180) / 360) * n);
  const latToY = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
  const xToLon = (x) => (x / n) * 360 - 180;
  const yToLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  for (;; z--) {
    n = 2 ** z;
    x0 = lonToX(b.getWest()); x1 = lonToX(b.getEast());
    y0 = latToY(b.getNorth()); y1 = latToY(b.getSouth());
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX || z <= 1) break;
  }
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const materials = [];
  const loads = [];
  const c = map.getCenter();
  const cx = ((c.lng + 180) / 360) * n, cy = latToY(c.lat);
  const tiles = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  tiles.sort((p, q) => Math.hypot(p[0] + 0.5 - cx, p[1] + 0.5 - cy) - Math.hypot(q[0] + 0.5 - cx, q[1] + 0.5 - cy)); // middle first
  for (const [x, y] of tiles.slice(0, MAX)) {
    const [ax, az] = toScene([xToLon(x), yToLat(y)]); // north-west corner
    const [bx, bz] = toScene([xToLon(x + 1), yToLat(y + 1)]); // south-east corner
    const w = bx - ax, h = bz - az;
    const mat = new THREE.MeshBasicMaterial({ color: 0x9aa58a, transparent: true, opacity: 1, depthWrite: false, fog: false });
    const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    loads.push(new Promise((resolve) => {
      loader.load(url, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true; resolve(); }, undefined, () => resolve());
    }));
    materials.push(mat);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(ax + w / 2, 0, az + h / 2);
    plane.renderOrder = -1;
    group.add(plane);
  }
  return {
    group,
    ready: Promise.all(loads),
    setOpacity(o) { materials.forEach((m) => { m.opacity = o; }); group.visible = o > 0.001; },
  };
}
