// Soil jars on the island: a little glass jar by a field's gate, holding that field's own soil test
// (src/plan/jarTest.js), its layers in the colours from the farmer's photo. src/island/jarSpots.js
// finds where each one stands, clear of everything else.
//
// A jar is a handful of meshes and no lights: the soil (one merged geometry, the layers stacked
// from the bottom), the water over it, the glass, a wooden lid and a soft shadow under it. Nothing
// casts or takes a shadow. Only the lid takes the seasons' look (snow in winter, a festival's
// tint); the glass and what's in it stay the colours they are. Each jar pushes a round obstacle
// onto view.obstacles, so the sheep walk round it and festival things keep off it.
//
//   const jars = createJars(view, { getKeepOuts })
//   jars.set(records)        JarRecord[] (one per field): adds, rebuilds and removes jars to match
//   jars.refresh()           checks every jar's spot again (a festival came or went): moves or drops it
//   jars.spotOf(fieldId)     { x, z, ground, by } | null
//   jars.pick(origin, dir)   a world-space ray -> { fieldId, tip: { title, note } } | null
//   jars.focusFor(fieldId)   { center, radius, y } for the camera rig's focus
//   jars.step(dt)            every frame (view.onFrame): the pop-ins, and the check once a festival
//                            has grown in (JAR_SETTLE after a set or refresh)
//   await jars.prewarm(camera)   compiles the jar's materials before the first one shows
//   jars.dispose()           takes every jar away and frees what it made
//
// Also: jarField(viewField, view) and jarEnv(view, ...), the view's side of src/island/jarSpots.js;
// jarKeepOuts(root), a festival's boxes measured for a jar; JAR_SETTLE, the late check's wait.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sailSpheres, themeKeepOuts } from './coinStacks.js';
import { attachSeasons } from './seasons.js';
import { JAR, OB_PAD, PICK_R, jarSpot, rayHitsBall } from './jarSpots.js';

const SOIL = new Set(['clay', 'fines', 'silt', 'sand', 'organic', 'gravel', 'other']);
const LIQUID = new Set(['water', 'tea', 'cloudy', 'foam', 'floating']);
const FILL = 0.92; // the contents fill this much of the glass (the rest is the air gap up top)
const BASE = 0.008; // the glass's bottom
const POP_TIME = 0.45;
const FOCUS_R = 1.1;
const PICK_Y = 0.17;
// a festival's things pop in over about 1.1 s (src/island/themes/index.js), some of them from
// nothing, so a check made while they're growing can miss one: the spots are checked once more
// this long after a set or refresh, when they've all grown in
export const JAR_SETTLE = 1.2;
const LID_COLOR = 0xb98a5e;
const GLASS_COLOR = 0xeaf6f8;
const SHADOW_COLOR = 0x3a2a1e;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const defaultReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The biggest outer ring of a field's polygons (the main parcel of a field in several pieces). */
function mainRing(polygons) {
  const area = (ring) => {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    return Math.abs(a / 2);
  };
  const rings = (polygons || []).map((p) => p?.[0]).filter((r) => r?.length >= 3);
  return rings.length ? rings.reduce((a, b) => (area(b) > area(a) ? b : a)) : null;
}

/**
 * A view field as src/island/jarSpots.js wants it, in island space. The paddock's gate is in the
 * paddock's own space (it stands in a holder that may sit anywhere), so it's carried through the
 * world into the island's frame.
 */
export function jarField(viewField, view) {
  const paddock = viewField?.paddock;
  const g = paddock?.userData?.gate;
  let gate = null;
  if (g && [g.x, g.z, g.nx, g.nz].every(Number.isFinite)) {
    if (paddock.isObject3D && view?.island?.isObject3D) {
      paddock.updateWorldMatrix(true, false);
      view.island.updateWorldMatrix(true, false);
      const p = view.island.worldToLocal(paddock.localToWorld(new THREE.Vector3(g.x, 0, g.z)));
      const q = view.island.worldToLocal(paddock.localToWorld(new THREE.Vector3(g.x + g.nx, 0, g.z + g.nz)));
      const nx = q.x - p.x, nz = q.z - p.z, l = Math.hypot(nx, nz) || 1;
      gate = { x: p.x, z: p.z, nx: nx / l, nz: nz / l };
    } else gate = { x: g.x, z: g.z, nx: g.nx, nz: g.nz };
  }
  const c = view?.center;
  return {
    id: viewField?.id,
    ring: mainRing(viewField?.polygons),
    gate,
    pivot: !!paddock?.userData?.isPivot,
    toward: viewField?.gateToward ?? [c?.x ?? 0, c?.z ?? 0],
  };
}

// the grass tufts and flowers, read once per island (they never move)
const tuftCache = new WeakMap();
function tuftsOf(view) {
  const island = view?.island;
  if (!island?.isObject3D) return [];
  if (tuftCache.has(island)) return tuftCache.get(island);
  const out = [];
  const scatter = island.getObjectByName('Grass and flowers');
  if (scatter) {
    island.updateWorldMatrix(true, true);
    const toIsland = new THREE.Matrix4().copy(island.matrixWorld).invert();
    const m = new THREE.Matrix4(), w = new THREE.Matrix4(), p = new THREE.Vector3();
    scatter.traverse((o) => {
      if (!o.isInstancedMesh) return;
      w.multiplyMatrices(toIsland, o.matrixWorld);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        p.setFromMatrixPosition(m).applyMatrix4(w);
        out.push({ x: p.x, z: p.z, r: 0.06 });
      }
    });
  }
  tuftCache.set(island, out);
  return out;
}

/**
 * Everything a jar keeps clear of, from the view (see jarBlocked in src/island/jarSpots.js).
 * keepOuts: boxes a festival on show fills (coinStacks.themeKeepOuts, with pad 0.12); jars: the
 * other jars [{ fieldId, x, z }].
 */
export function jarEnv(view, { keepOuts = [], jars = [] } = {}) {
  const tf = view?.terrainField || {};
  const centre = Array.isArray(tf.center) ? tf.center : null;
  return {
    heightAt: view?.heightAt,
    coastR: typeof tf.coastR === 'function' ? tf.coastR : null,
    coastCentre: centre ? { x: centre[0], z: centre[1] } : { x: 0, z: 0 },
    minHeight: typeof tf.levelHeight === 'function' ? tf.levelHeight(0) - 0.15 : -Infinity,
    pondMask: tf.pondMask, pathMask: tf.pathMask, cragMask: tf.cragMask,
    fields: (view?.fields || []).map((f) => ({ id: f.id, ring: mainRing(f.polygons), polygons: f.polygons })),
    obstacles: view?.obstacles || [],
    slots: view?.slots || [],
    sheep: (view?.flock?.sheep || []).map((sh) => ({ x: sh.g?.position?.x, z: sh.g?.position?.z, size: sh.size ?? 0.6 })).filter((s) => Number.isFinite(s.x) && Number.isFinite(s.z)),
    tufts: tuftsOf(view),
    jars,
    props: view?.props || [],
    sails: sailSpheres(view?.spinners),
    lamps: view?.lamps || [],
    keepOuts,
  };
}

export const JAR_KEEP_PAD = 0.12; // festival things sway a little (bunting, balloons)
export const JAR_KEEP_SPLIT = 0.3; // a string of lights round a fence is measured in pieces this big

/**
 * The boxes a festival on show fills, measured for a jar: each grown JAR_KEEP_PAD, and the long
 * strings along the fences (lights, tinsel, bunting, cobwebs) in pieces, so they only keep the jar
 * off where they really run. Things that wander (bunnies, turkeys) are kept off by their own spots
 * in view.obstacles. root: the 'Festival themes' group (or the island, which holds it).
 */
export function jarKeepOuts(root) {
  const host = root?.name === 'Festival themes' ? root : root?.getObjectByName?.('Festival themes');
  return host ? themeKeepOuts(host, { pad: JAR_KEEP_PAD, split: JAR_KEEP_SPLIT }) : [];
}

/** A photo colour [r, g, b] (0-255) as a THREE colour, lifted into lightness 30-80 so it reads in 3D. */
function layerColor(rgb) {
  const c = new THREE.Color();
  const [r, g, b] = Array.isArray(rgb) && rgb.length >= 3 && rgb.every(Number.isFinite) ? rgb : [150, 120, 90];
  c.setRGB(clamp01(r / 255), clamp01(g / 255), clamp01(b / 255), THREE.SRGBColorSpace);
  const hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, hsl.s, Math.max(0.3, Math.min(0.8, hsl.l)), THREE.SRGBColorSpace);
  return c;
}

/** A cylinder with every vertex the same colour (for the merged soil layers). */
function paintedCylinder(r, h, y, color) {
  const g = new THREE.CylinderGeometry(r, r, h, 18);
  g.deleteAttribute('uv');
  g.translate(0, y + h / 2, 0);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * The jar's soil and water from a record, as heights: the soil layers stacked from the bottom
 * (bottom layer first), then one water column over them. Each layer's height is its share of the
 * jar's contents; the air gap is left empty.
 */
export function jarLayers(record) {
  const layers = Array.isArray(record?.layers) ? record.layers : [];
  // (shares add up to 1; a saved record that adds up to more is scaled down, so it stays in the glass)
  const sum = layers.reduce((s, l) => s + Math.max(0, +l?.share || 0), 0);
  const full = JAR.H * FILL * (sum > 1 ? 1 / sum : 1);
  const soil = [];
  let y = BASE;
  for (const l of [...layers].reverse()) {
    if (!SOIL.has(l?.type)) continue;
    const h = Math.max(0, +l.share || 0) * full;
    if (h <= 1e-4) continue;
    soil.push({ type: l.type, y, h, rgb: l.rgb });
    y += h;
  }
  let lh = 0;
  const mix = [0, 0, 0];
  for (const l of layers) {
    if (!LIQUID.has(l?.type)) continue;
    const h = Math.max(0, +l.share || 0) * full;
    if (h <= 1e-4) continue;
    const c = layerColor(l.rgb);
    mix[0] += c.r * h; mix[1] += c.g * h; mix[2] += c.b * h;
    lh += h;
  }
  const water = lh > 1e-4 ? { y, h: Math.min(lh, JAR.H - 0.004 - y), color: new THREE.Color(mix[0] / lh, mix[1] / lh, mix[2] / lh) } : null;
  return { soil, water };
}

const signature = (r) => JSON.stringify([r?.textureClass ?? null, (r?.layers || []).map((l) => [l.type, l.share, l.rgb])]);

/**
 * @param {object} view   the reveal's view (island, fields, obstacles, props, lamps, spinners, heightAt, terrainField, renderer, scene)
 * @param {object} [o]
 * @param {() => boolean} [o.reduced]   reduced motion: jars appear at once
 * @param {() => Array} [o.getKeepOuts]   the festival's boxes right now, asked on every placement
 *   (default: jarKeepOuts of the island's 'Festival themes', measured there and then)
 * @param {(fieldId: string) => string} [o.getName]   a field's name for the tap tip
 */
export function createJars(view, { reduced = defaultReduced, getKeepOuts = () => jarKeepOuts(view.island), getName = null } = {}) {
  const island = view.island;
  const fieldOf = (id) => (view.fields || []).find((f) => f.id === id) || null;
  const nameOf = (id) => (getName ? getName(id) : null) ?? fieldOf(id)?.name ?? id;

  // shared by every jar (the water is each jar's own colour)
  const soilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({ color: GLASS_COLOR, roughness: 0.08, transparent: true, opacity: 0.32, depthWrite: false });
  const lidMat = new THREE.MeshStandardMaterial({ color: LID_COLOR, roughness: 0.75 });
  const shadowMat = new THREE.MeshBasicMaterial({ color: SHADOW_COLOR, transparent: true, opacity: 0.18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const m of [soilMat, glassMat, shadowMat]) m.userData.noSeason = true; // no snow on the glass or in it
  const glassGeo = mergeGeometries([
    new THREE.CylinderGeometry(JAR.R, JAR.R, JAR.H, 20, 1, true).translate(0, JAR.H / 2, 0),
    new THREE.CircleGeometry(JAR.R, 20).rotateX(-Math.PI / 2).translate(0, BASE, 0),
  ].map((g) => { g.deleteAttribute('uv'); return g; }));
  const lidGeo = new THREE.CylinderGeometry(JAR.LID_R, JAR.LID_R, JAR.LID_H, 20).translate(0, JAR.H + JAR.LID_H / 2, 0);
  const shadowGeo = new THREE.CircleGeometry(JAR.R * 1.6, 20).rotateX(-Math.PI / 2).translate(0, 0.004, 0);
  const shared = [soilMat, glassMat, lidMat, shadowMat, glassGeo, lidGeo, shadowGeo];

  const jars = new Map(); // fieldId -> { record, sig, spot, group, obstacle, own: [geometry/material], k }
  let alive = true;
  let warmed = null;
  let settle = 0; // seconds until the spots are checked again (JAR_SETTLE)

  const mesh = (geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  };

  /** The jar's meshes for a record (its own geometries and water material go in `own`). */
  function buildGroup(record, fieldId) {
    const group = new THREE.Group();
    group.name = `Soil jar ${fieldId}`;
    const own = [];
    const { soil, water } = jarLayers(record);
    if (soil.length) {
      const geo = mergeGeometries(soil.map((l) => paintedCylinder(JAR.R * 0.9, l.h, l.y, layerColor(l.rgb))));
      own.push(geo);
      group.add(mesh(geo, soilMat, 'Jar soil'));
    }
    if (water) {
      const geo = new THREE.CylinderGeometry(JAR.R * 0.9, JAR.R * 0.9, water.h, 18).translate(0, water.y + water.h / 2, 0);
      geo.deleteAttribute('uv');
      const mat = new THREE.MeshStandardMaterial({ color: water.color, roughness: 0.2, transparent: true, opacity: 0.5, depthWrite: false });
      mat.userData.noSeason = true;
      own.push(geo, mat);
      const w = mesh(geo, mat, 'Jar water');
      w.renderOrder = 1;
      group.add(w);
    }
    const glass = mesh(glassGeo, glassMat, 'Jar glass');
    glass.renderOrder = 2; // over the water and the soil behind it
    const lid = mesh(lidGeo, lidMat, 'Jar lid');
    const shadow = mesh(shadowGeo, shadowMat, 'Jar shadow');
    shadow.userData.noBox = true; // not part of its solid shape
    group.add(glass, lid, shadow);
    attachSeasons(lid); // snow on the lid in winter, the festival's tint (the rest is noSeason)
    return { group, own };
  }

  const placedJars = (except = null) => [...jars.entries()].filter(([id, j]) => id !== except && j.spot).map(([fieldId, j]) => ({ fieldId, x: j.spot.x, z: j.spot.z }));
  // (the festival's boxes are measured once per set or refresh: there can be tens of thousands)
  const envFor = (except, keepOuts) => jarEnv(view, { keepOuts, jars: placedJars(except) });
  const measure = () => { try { return getKeepOuts() || []; } catch { return []; } };

  function removeObstacle(j) {
    const list = view.obstacles;
    const i = j.obstacle && list ? list.indexOf(j.obstacle) : -1;
    if (i >= 0) list.splice(i, 1);
    j.obstacle = null;
  }

  function show(j, spot) {
    j.spot = spot;
    if (!spot) {
      if (j.group) j.group.visible = false;
      removeObstacle(j);
      return;
    }
    if (!j.group) {
      const built = buildGroup(j.record, j.fieldId);
      j.group = built.group;
      j.own = built.own;
      island.add(j.group);
      if (j.k == null) j.k = reduced() ? 1 : 0; // (a rebuilt jar keeps how far it had popped in)
    }
    j.group.visible = true;
    j.group.position.set(spot.x, spot.ground, spot.z);
    const s = j.k >= 1 ? 1 : Math.max(0.001, easeOutBack(clamp01(j.k)));
    j.group.scale.setScalar(s);
    if (!j.obstacle) {
      j.obstacle = { x: spot.x, z: spot.z, r: JAR.R + OB_PAD };
      view.obstacles?.push(j.obstacle);
    } else { j.obstacle.x = spot.x; j.obstacle.z = spot.z; }
  }

  function freeGroup(j) {
    if (j.group) j.group.parent?.remove(j.group);
    for (const o of j.own || []) o.dispose();
    j.group = null;
    j.own = [];
  }

  function remove(id) {
    const j = jars.get(id);
    if (!j) return;
    removeObstacle(j);
    freeGroup(j);
    jars.delete(id);
  }

  const publicSpot = (s) => (s ? { x: s.x, z: s.z, ground: s.ground, by: s.by } : null);

  /**
   * The jars to show: one per record, by fieldId. A new one is placed; one whose contents changed
   * is rebuilt where it stands; one no longer in the list is taken away. Returns Map fieldId ->
   * its spot, or null where no spot was clear (or the field isn't on the island).
   */
  function set(records) {
    if (!alive) return new Map();
    const want = new Map();
    for (const r of records || []) if (r?.fieldId != null && !want.has(r.fieldId)) want.set(r.fieldId, r);
    for (const id of [...jars.keys()]) if (!want.has(id)) remove(id);
    const out = new Map();
    let keepOuts = null;
    for (const [id, record] of want) {
      const sig = signature(record);
      let j = jars.get(id);
      if (j && j.sig !== sig) {
        // new contents, same place: rebuild the meshes (no pop-in again)
        freeGroup(j);
        j.record = record;
        j.sig = sig;
        if (j.spot) show(j, j.spot);
      } else if (j) j.record = record;
      if (!j) {
        j = { fieldId: id, record, sig, spot: null, group: null, own: [], obstacle: null, k: null };
        jars.set(id, j);
      }
      if (!j.spot) {
        // a new jar, or one that had nowhere to stand last time
        const vf = fieldOf(id);
        keepOuts ??= measure();
        show(j, vf ? jarSpot(jarField(vf, view), envFor(id, keepOuts), { fieldId: id, obstacle: j.obstacle }) : null);
      }
      out.set(id, publicSpot(j.spot));
    }
    if (keepOuts) settle = JAR_SETTLE; // (a festival may still be popping in)
    return out;
  }

  /**
   * Checks every jar's spot again against what's on the island now (a festival came or went:
   * getKeepOuts and view.obstacles have changed). A jar keeps its spot while that's still clear and
   * still the best one (the sheep grazing round it don't count: they keep off it); otherwise it
   * moves to the best clear spot (back by the gate once a festival is over), or goes until one is
   * clear. Placement is the same every time, so refreshing again changes nothing. The festival's
   * things may still be growing in, so step() checks once more JAR_SETTLE seconds later.
   */
  function refresh() {
    if (!alive || !jars.size) return;
    recheck();
    settle = JAR_SETTLE;
  }

  /** refresh's work: every jar's spot checked again. Returns whether any jar moved, went or came back. */
  function recheck() {
    const keepOuts = measure();
    let changed = false;
    for (const [id, j] of jars) {
      const vf = fieldOf(id);
      if (!vf) { changed ||= !!j.spot; show(j, null); continue; }
      const spot = jarSpot(jarField(vf, view), envFor(id, keepOuts), { fieldId: id, obstacle: j.obstacle }, { stay: j.spot });
      if (spot && j.spot && spot.x === j.spot.x && spot.z === j.spot.z) continue; // stays put
      if (!spot && !j.spot) continue;
      if (spot && j.group) j.k = reduced() ? 1 : 0; // pops up in its new spot
      show(j, spot);
      changed = true;
    }
    return changed;
  }

  const spotOf = (id) => publicSpot(jars.get(id)?.spot || null);

  /** The jar a world-space ray (THREE.Vector3s) points at, nearest first, with its tip. */
  function pick(origin, dir) {
    if (!alive || !origin || !dir) return null;
    island.updateWorldMatrix(true, false);
    const o = island.worldToLocal(origin.clone());
    const d = island.worldToLocal(origin.clone().add(dir)).sub(o);
    let best = null;
    for (const [id, j] of jars) {
      if (!j.spot || !j.group?.visible) continue;
      const t = rayHitsBall(o, d, { x: j.spot.x, y: j.spot.ground + PICK_Y, z: j.spot.z, r: PICK_R });
      if (t != null && (!best || t < best.t)) best = { t, id, j };
    }
    if (!best) return null;
    const cls = best.j.record?.textureClass || 'Soil';
    return { fieldId: best.id, tip: { title: `${nameOf(best.id)} · jar test`, note: `${cls}. Tap to see it.` } };
  }

  /** Where the camera rig looks to show a field's jar (rig.focus), or null with no jar. */
  function focusFor(id) {
    const s = jars.get(id)?.spot;
    return s ? { center: [s.x, s.z], radius: FOCUS_R, y: s.ground } : null;
  }

  /**
   * The pop-ins: a little spring from nothing to full size. And, JAR_SETTLE seconds after a set or
   * refresh, the spots checked once more. Returns whether anything moved.
   */
  function step(dt = 0) {
    if (!alive) return false;
    let moving = false;
    if (settle > 0) {
      settle -= Math.max(0, dt);
      if (settle <= 0) {
        settle = 0;
        if (jars.size) moving = recheck();
      }
    }
    const still = reduced();
    for (const j of jars.values()) {
      if (!j.group || !j.spot || j.k >= 1) continue;
      j.k = still ? 1 : Math.min(1, j.k + Math.max(0, dt) / POP_TIME);
      const s = j.k >= 1 ? 1 : Math.max(0.001, easeOutBack(j.k));
      j.group.scale.setScalar(s);
      moving = true;
    }
    return moving;
  }

  /** Compiles the jar's materials ahead (renderer.compileAsync, once), so the first jar doesn't hitch. */
  function prewarm(camera = view.camera) {
    if (warmed) return warmed;
    const r = view.renderer;
    if (!alive || !r?.compileAsync || !camera) return (warmed = Promise.resolve());
    // a jar of every part (soil, water, glass, lid, shadow), compiled out of sight, then taken away
    const sample = buildGroup({ layers: [{ type: 'water', share: 0.4, rgb: [120, 150, 160] }, { type: 'clay', share: 0.3, rgb: [150, 110, 80] }, { type: 'sand', share: 0.3, rgb: [190, 160, 120] }] }, 'prewarm');
    // (it isn't on the island: compiling needs only the scene's lights and fog, not a place in it)
    sample.group.updateMatrixWorld(true);
    const done = () => { for (const o of sample.own) o.dispose(); };
    warmed = Promise.resolve()
      .then(() => r.compileAsync(sample.group, camera, view.scene || null))
      .catch(() => {})
      .then(done);
    return warmed;
  }

  function dispose() {
    if (!alive) return;
    alive = false;
    for (const id of [...jars.keys()]) remove(id);
    for (const o of shared) o.dispose();
  }

  return {
    set, refresh, spotOf, pick, focusFor, step, prewarm, dispose,
    /** fieldId -> the jar's group (for tests and the dev console). */
    groupOf: (id) => jars.get(id)?.group || null,
  };
}
