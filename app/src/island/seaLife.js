// Sea life round the island, in the farm's low-poly style, all built from three.js primitives:
//
//   orca      one, cruising a slow loop well out from the shore with its fin up, now and then
//             surfacing in a gentle arc with a blow
//   dolphins  a pod of three travelling together on their own lane, leaping in arcs now and then
//   fish      small schools shimmering at the surface in the shallows (one instanced mesh); a school
//             darts away along the shore as a group, out of a swimming sheep's way
//   whale     the easter egg: now and then (rarely), on World Whale Day (the third Sunday in
//             February), or when the farmer taps the open sea three times in a row, a humpback
//             rises far out, blows, breaches, slaps its tail with a big splash and sinks away.
//             Manami says a line the first time. Dev: __sheep.whale() or ?whale=1.
//
// Where they may go is worked out in src/island/seaPaths.js (each animal keeps to its own lane, so
// nothing meets anything, and the lanes keep clear of the beach, the dock, the boat and the
// swimmers). An animal swims under (out of sight) wherever its lane leaves the screen, so it is
// never seen leaving the visible sea, and the whale only comes up where the camera can see it.
//
// No lights of their own: lit, matte materials that take the sun, the dusk and the moonlight like
// the rest of the farm, opted out of the season patch (no snow on a swimming orca). Nothing casts a
// shadow (the sea doesn't need them, and it keeps the draw calls down: about six while a whale's
// out). With reduced motion the animals hold still at the surface and the whale stays away.
//
//   const life = createSeaLife(view, { manami, date, whaleNow })
//   life.whale()      bring the whale now (where it can be seen)
//   life.dispose()
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from './props.js';
import {
  DOLPHIN_SPEED, ORCA_SPEED, POD, SCHOOL, SEA, WHALE_SHOW, createTapCounter, createWhaleClock, dockKeepOuts, fishRefuge, planSea,
  seaGeometry, showPath, whaleKeepOut, whaleSpot,
} from './seaPaths.js';

export const WHALE_LINE = 'Was that a whale? I’ve only seen one out here once before.';
const WHALE_SEEN_KEY = 'rotationMaxxing.whaleSeen';
const reducedMotionQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null);

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- the models

/** A part of a model: geometry painted one colour, placed by a matrix. */
function part(geo, color, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g === geo) g = geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')),
    new THREE.Vector3(...scale),
  ));
  const c = new THREE.Color(color);
  const cols = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < cols.length; i += 3) { cols[i] = c.r; cols[i + 1] = c.g; cols[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.dispose();
  return g;
}

function merged(parts) {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** One shared look: matte, faceted, painted by vertex colour, no snow. */
function seaMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0 });
  m.userData.noSeason = true;
  return m;
}

/** The orca, facing +z, its middle at the origin: 1.5 long, nose to flukes. */
export function orcaGeometry() {
  const BLACK = 0x23252f, WHITE = 0xf2f1f6, GREY = 0x8d8fa3;
  const g = merged([
    part(new THREE.SphereGeometry(1, 12, 8), BLACK, { scale: [0.27, 0.25, 0.6] }),
    part(new THREE.SphereGeometry(1, 10, 6), WHITE, { at: [0, -0.07, 0.08], scale: [0.21, 0.19, 0.47] }), // the belly
    part(new THREE.SphereGeometry(1, 8, 5), WHITE, { at: [0.2, 0.07, 0.3], scale: [0.07, 0.06, 0.12] }), // eye patches
    part(new THREE.SphereGeometry(1, 8, 5), WHITE, { at: [-0.2, 0.07, 0.3], scale: [0.07, 0.06, 0.12] }),
    part(new THREE.SphereGeometry(1, 8, 5), GREY, { at: [0, 0.17, -0.18], scale: [0.16, 0.08, 0.16] }), // the saddle
    part(new THREE.ConeGeometry(0.13, 0.5, 4), BLACK, { at: [0, 0.42, -0.04], rot: [0, Math.PI / 4, -0.22], scale: [0.35, 1, 1] }), // dorsal fin
    part(new THREE.ConeGeometry(0.1, 0.3, 4), BLACK, { at: [0.25, -0.1, 0.15], rot: [0, 0, -1.1], scale: [1, 1, 0.3] }), // flippers
    part(new THREE.ConeGeometry(0.1, 0.3, 4), BLACK, { at: [-0.25, -0.1, 0.15], rot: [0, 0, 1.1], scale: [1, 1, 0.3] }),
    part(new THREE.ConeGeometry(0.1, 0.32, 4), BLACK, { at: [0, 0.02, -0.66], rot: [-Math.PI / 2, 0, 0], scale: [1, 1, 0.5] }), // tail stock
    part(new THREE.BoxGeometry(0.46, 0.03, 0.14), BLACK, { at: [0, 0.02, -0.8], rot: [0, 0, 0] }), // flukes
  ]);
  g.translate(0, 0, 0.13); // centred between nose and flukes (0.74 each way: SEA.orca.radius)
  g.computeBoundingSphere();
  return g;
}
const ORCA_BLOWHOLE = new THREE.Vector3(0, 0.25, 0.43);

/** A dolphin, facing +z, its middle at the origin: 0.7 long. */
export function dolphinGeometry() {
  const BACK = 0x56658f, BELLY = 0xdfe4f1; // slate blue on the back, so they stand out from the lavender sea
  return merged([
    part(new THREE.SphereGeometry(1, 10, 7), BACK, { scale: [0.12, 0.12, 0.33] }),
    part(new THREE.SphereGeometry(1, 8, 5), BELLY, { at: [0, -0.04, 0.04], scale: [0.09, 0.08, 0.26] }),
    part(new THREE.ConeGeometry(0.05, 0.14, 6), BACK, { at: [0, -0.02, 0.38], rot: [Math.PI / 2, 0, 0] }), // the beak
    part(new THREE.ConeGeometry(0.07, 0.17, 4), BACK, { at: [0, 0.16, -0.04], rot: [0, Math.PI / 4, -0.35], scale: [0.35, 1, 1] }), // fin
    part(new THREE.ConeGeometry(0.06, 0.2, 4), BACK, { at: [0, 0.0, -0.36], rot: [-Math.PI / 2, 0, 0], scale: [1, 1, 0.5] }),
    part(new THREE.BoxGeometry(0.24, 0.02, 0.08), BACK, { at: [0, 0.0, -0.46] }), // flukes
    part(new THREE.ConeGeometry(0.04, 0.14, 4), BACK, { at: [0.1, -0.06, 0.1], rot: [0, 0, -1.2], scale: [1, 1, 0.35] }),
    part(new THREE.ConeGeometry(0.04, 0.14, 4), BACK, { at: [-0.1, -0.06, 0.1], rot: [0, 0, 1.2], scale: [1, 1, 0.35] }),
  ]);
}

/** A humpback, facing +z, its middle at the origin: 2.3 long. Blowhole at WHALE_BLOWHOLE, tail at -z. */
export function whaleGeometry() {
  const BACK = 0x4f5a7c, BELLY = 0xd9dceb, FIN = 0xc9cde0;
  const g = merged([
    part(new THREE.SphereGeometry(1, 14, 9), BACK, { scale: [0.48, 0.4, 1.12] }),
    part(new THREE.SphereGeometry(1, 12, 7), BELLY, { at: [0, -0.12, 0.2], scale: [0.38, 0.28, 0.9] }),
    part(new THREE.CylinderGeometry(0.42, 0.2, 0.9, 10), BACK, { at: [0, 0.02, -1.15], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.8] }), // tail stock
    part(new THREE.ConeGeometry(0.1, 0.24, 4), BACK, { at: [0, 0.36, -0.55], rot: [0, Math.PI / 4, -0.4], scale: [0.4, 1, 1] }), // small fin
    // the long humpback flippers, pale underneath
    part(new THREE.BoxGeometry(0.9, 0.05, 0.22), FIN, { at: [0.72, -0.2, 0.35], rot: [0, -0.5, -0.35] }),
    part(new THREE.BoxGeometry(0.9, 0.05, 0.22), FIN, { at: [-0.72, -0.2, 0.35], rot: [0, 0.5, 0.35] }),
    // the flukes, spread wide
    part(new THREE.BoxGeometry(0.6, 0.05, 0.3), BACK, { at: [0.3, 0.02, -1.62], rot: [0, -0.35, 0] }),
    part(new THREE.BoxGeometry(0.6, 0.05, 0.3), BACK, { at: [-0.3, 0.02, -1.62], rot: [0, 0.35, 0] }),
  ]);
  // a little smaller, and centred between nose and flukes (1.15 each way), so it fits its patch of sea
  g.scale(0.8, 0.8, 0.8);
  g.translate(0, 0, 0.26);
  g.computeBoundingSphere();
  return g;
}
const WHALE_BLOWHOLE = new THREE.Vector3(0, 0.3, 0.7);
const WHALE_HALF = 1.2; // nose (or flukes) to the middle, for keeping off the sea floor
const WHALE_THICK = 0.32; // the body's half height
const WHALE_TAIL = new THREE.Vector3(0, 0.04, -1.06);

/** A small fish, facing +z, its middle at the origin: FISH_LENGTH (0.14) long. */
function fishGeometry() {
  const g = merged([
    part(new THREE.OctahedronGeometry(1, 0), 0xffffff, { at: [0, 0, 0.015], scale: [0.026, 0.032, 0.055] }),
    part(new THREE.ConeGeometry(0.032, 0.04, 3), 0xffffff, { at: [0, 0, -0.05], rot: [Math.PI / 2, 0, 0], scale: [0.4, 1, 1] }),
  ]);
  g.deleteAttribute('color');
  return g;
}

// ---------------------------------------------------------------- splashes

/** A light splash kit: up to RINGS rings on the water and DROPS droplets, shared by every animal. */
function createSplashes(parent) {
  const RINGS = 6, DROPS = 72;
  const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < RINGS; i++) {
    // lit, so a splash in the moonlight isn't a white glow
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    m.userData.noSeason = true;
    const r = new THREE.Mesh(ringGeo, m);
    r.visible = false;
    r.renderOrder = 2;
    r.name = 'Splash ring';
    parent.add(r);
    rings.push({ mesh: r, t: 0, life: 0, size: 1, x: 0, z: 0 });
  }
  const dropMat = new THREE.MeshStandardMaterial({ color: 0xf6f7ff, roughness: 0.35 });
  dropMat.userData.noSeason = true;
  const drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), dropMat, DROPS);
  drops.name = 'Splash drops';
  drops.frustumCulled = false; // they fly about: the box from the first frame would be wrong
  drops.count = 0;
  parent.add(drops);
  const live = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  let ringNext = 0;
  return {
    /** A splash at (x, z): size ~ the ring's widest (units), n droplets thrown up to `up`. */
    splash(x, z, { size = 0.6, n = 10, up = 1.2, life = 1.4, spread = 0.6 } = {}) {
      const r = rings[ringNext++ % RINGS];
      Object.assign(r, { t: 0, life, size, x, z });
      r.mesh.visible = true;
      for (let k = 0; k < n && live.length < DROPS; k++) {
        const a = Math.random() * TAU, v = (0.3 + Math.random() * 0.7) * spread;
        live.push({ x, y: 0.02, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: up * (0.6 + Math.random() * 0.5), r: 0.025 + Math.random() * 0.03 * Math.min(2, size) });
      }
    },
    /** A blow: a soft column of spray straight up from (x, y, z). */
    blow(x, y, z, { n = 12, up = 1.6, r = 0.035 } = {}) {
      for (let k = 0; k < n && live.length < DROPS; k++) {
        const a = Math.random() * TAU, v = Math.random() * 0.18;
        live.push({ x, y, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: up * (0.7 + Math.random() * 0.45), r: r * (0.7 + Math.random() * 0.8), mist: true });
      }
    },
    update(dt) {
      for (const r of rings) {
        if (!r.mesh.visible) continue;
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) { r.mesh.visible = false; continue; }
        r.mesh.position.set(r.x, 0.025, r.z);
        r.mesh.scale.setScalar(r.size * (0.25 + 0.75 * Math.sqrt(k)));
        r.mesh.material.opacity = 0.7 * (1 - k);
      }
      let n = 0;
      for (let i = live.length - 1; i >= 0; i--) {
        const d = live[i];
        d.vy -= (d.mist ? 2.6 : 5.5) * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        if (d.y < -0.02) { live.splice(i, 1); continue; }
      }
      for (const d of live) {
        const sc = d.r * (d.mist ? Math.min(1.6, 0.8 + d.y * 0.6) : 1);
        drops.setMatrixAt(n++, m4.compose(p.set(d.x, d.y, d.z), q, s.set(sc, sc, sc)));
      }
      drops.count = n;
      drops.visible = n > 0;
      if (n) drops.instanceMatrix.needsUpdate = true;
    },
    get busy() { return live.length > 0 || rings.some((r) => r.mesh.visible); },
    clear() { live.length = 0; rings.forEach((r) => { r.mesh.visible = false; }); drops.count = 0; },
    dispose() {
      ringGeo.dispose();
      rings.forEach((r) => r.mesh.material.dispose());
      drops.geometry.dispose();
      dropMat.dispose();
      drops.dispose?.();
    },
  };
}

// ---------------------------------------------------------------- the sea life

/**
 * @param {object} view   the reveal's island view (scene, camera, canvas, terrainField, sea, onFrame, seed)
 * @param {object} [o]
 * @param {{say: Function}} [o.manami]
 * @param {Date} [o.date]       today (World Whale Day brings the whale)
 * @param {boolean} [o.whaleNow]  bring the whale a few seconds in (?whale=1)
 */
export function createSeaLife(view, { manami = null, date = new Date(), whaleNow = false } = {}) {
  const f = view.terrainField;
  if (!f?.shoreR || !view.scene) return { whale: () => false, dispose() {} };
  const seed = typeof view.seed === 'number' ? view.seed : String(view.seed ?? 'sea').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 17);
  const rnd = rng(seed + 977);
  const sea = seaGeometry({ center: f.center, shoreR: f.shoreR, heightAt: view.heightAt || f });
  const info = view.sea || {};
  const keepOuts = dockKeepOuts(info.dockAt, info.dockOut, info.boatAt);
  // the fish gather on the camera's side first (it looks from +z)
  const lanes = planSea(sea, { keepOuts, rnd, prefer: Math.atan2(1, -0.2) });
  const swimmers = info.swimmers || [];

  const group = new THREE.Group();
  group.name = 'Sea life';
  view.scene.add(group);
  const disposables = [];
  const material = seaMaterial();
  disposables.push(material);
  const splashes = createSplashes(group);

  const camera = view.camera;
  const ndc = new THREE.Vector3();
  /** On screen, with a margin (0..1 of the half-screen), in front of the camera. */
  const onScreen = (x, z, margin = 0.1, y = 0) => {
    ndc.set(x, y, z).project(camera);
    return ndc.z < 1 && Math.abs(ndc.x) < 1 - margin && Math.abs(ndc.y) < 1 - margin;
  };
  /** Whether the canvas itself is what's showing at (x, y, z): not a panel, Manami or a button over it. */
  const uncovered = (x, y, z) => {
    if (!view.canvas || typeof document === 'undefined' || !document.elementFromPoint) return true;
    ndc.set(x, y, z).project(camera);
    const rect = view.canvas.getBoundingClientRect();
    const el = document.elementFromPoint(rect.left + ((ndc.x + 1) / 2) * rect.width, rect.top + ((1 - ndc.y) / 2) * rect.height);
    return !el || el === view.canvas;
  };
  // the buildings, trees and windmill, as upright cylinders: as wide as their own box (the windmill's
  // sails and all), as tall as their top
  const solids = (view.props || []).map((p) => {
    const b = p.box ? Math.max(...p.box.min.map(Math.abs), ...p.box.max.map(Math.abs)) * (p.scale || 1) : 0;
    return { x: p.x, z: p.z, r: Math.max(p.r, b, 0.45) + 0.15, top: (p.y || 0) + (p.height || 1) };
  });
  /** Whether the line from the camera to (x, y, z) passes over the ground and clear of the buildings and trees. */
  const clearLine = (x, y, z) => {
    const c = camera.position;
    for (let k = 1; k < 48; k++) {
      const t = k / 48;
      const px = lerp(c.x, x, t), py = lerp(c.y, y, t), pz = lerp(c.z, z, t);
      if (sea.heightAt(px, pz) > py) return false;
      for (const o of solids) if (py < o.top && Math.abs(px - o.x) < o.r && Math.abs(pz - o.z) < o.r && Math.hypot(px - o.x, pz - o.z) < o.r) return false;
    }
    return true;
  };
  /** On screen, clear of the panels over it, and not behind the island or anything on it, at the surface and `up` above it. */
  const inSight = (x, z, margin = 0.15, reach = 0, up = 0.3) => {
    if (!onScreen(x, z, margin)) return false;
    for (const [dx, dz] of [[0, 0], [reach, 0], [-reach, 0], [0, reach], [0, -reach]]) if (!uncovered(x + dx, 0.4, z + dz)) return false;
    return clearLine(x, 0.1, z) && clearLine(x, up, z);
  };

  let reduced = reducedMotionQuery()?.matches ?? false;
  let time = 0;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const tmp = new THREE.Vector3();
  const yawOf = (dir) => Math.atan2(Math.cos(dir), Math.sin(dir)); // a heading (atan2 z, x) as the model's turn

  // ---- the orca
  const orcaGeo = orcaGeometry();
  disposables.push(orcaGeo);
  const orca = new THREE.Mesh(orcaGeo, material);
  orca.name = 'Orca';
  group.add(orca);
  const orcaState = { s: rnd() * lanes.orca.length, up: 0, arcAt: 6 + rnd() * 8, arc: -1, blown: false };

  /** The orca's pose at its lane point; up: 0 under (hidden) .. 1 cruising with its fin up. */
  function placeOrca(dt) {
    const o = orcaState;
    if (!reduced) o.s += ORCA_SPEED * dt;
    const p = lanes.orca.at(o.s);
    const ahead = lanes.orca.at(o.s + 1.2);
    const want = onScreen(p.x, p.z, 0.06) && onScreen(ahead.x, ahead.z, 0.06) ? 1 : 0;
    if (reduced) o.up = want; else o.up += Math.sign(want - o.up) * Math.min(Math.abs(want - o.up), dt * 0.6);
    let y = lerp(-1.05, -0.2, smooth(0, 1, o.up)) + Math.sin(time * 0.9) * 0.02 * o.up; // its back at the surface, fin up
    let pitch = 0;
    if (!reduced && o.up > 0.98) {
      o.arcAt -= dt;
      if (o.arcAt <= 0 && o.arc < 0) { o.arc = 0; o.blown = false; }
    }
    if (o.arc >= 0) {
      o.arc += dt / 3.4;
      const u = clamp01(o.arc);
      y += Math.sin(Math.PI * u) * 0.22; // the back rolls up out of the water and down again
      pitch = -Math.cos(Math.PI * u) * 0.16;
      if (!o.blown && u > 0.18) {
        o.blown = true;
        tmp.copy(ORCA_BLOWHOLE).applyEuler(euler.set(pitch, yawOf(p.dir), 0)).add({ x: p.x, y, z: p.z });
        splashes.blow(tmp.x, Math.max(0.05, tmp.y), tmp.z, { n: 14, up: 1.5 });
      }
      if (o.arc >= 1) { o.arc = -1; o.arcAt = 14 + rnd() * 12; }
    }
    orca.visible = y > -0.95;
    orca.position.set(p.x, y, p.z);
    orca.rotation.set(pitch, yawOf(p.dir), Math.sin(time * 0.7) * 0.03, 'YXZ');
  }

  // ---- the dolphins: three on their lane, in a fixed formation (along, across)
  const dolphinGeo = dolphinGeometry();
  disposables.push(dolphinGeo);
  const FORMATION = POD.map(([along, across]) => [along, across * SEA.dolphin.spread]);
  const dolphins = new THREE.InstancedMesh(dolphinGeo, material, FORMATION.length);
  dolphins.name = 'Dolphins';
  dolphins.frustumCulled = false; // they move every frame
  group.add(dolphins);
  const pod = { s: rnd() * lanes.dolphin.length, up: 0, leapIn: 5 + rnd() * 5, leaps: FORMATION.map(() => ({ t: -1, delay: 0, big: true, wet: [false, false] })) };
  const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), tiny = new THREE.Vector3(1e-4, 1e-4, 1e-4);

  function placeDolphins(dt) {
    if (!reduced) pod.s += DOLPHIN_SPEED * dt;
    const lead = lanes.dolphin.at(pod.s), ahead = lanes.dolphin.at(pod.s + 1.5), back = lanes.dolphin.at(pod.s - 1.2);
    const want = onScreen(lead.x, lead.z, 0.06) && onScreen(ahead.x, ahead.z, 0.06) && onScreen(back.x, back.z, 0.06) ? 1 : 0;
    if (reduced) pod.up = want; else pod.up += Math.sign(want - pod.up) * Math.min(Math.abs(want - pod.up), dt * 0.8);
    if (!reduced && pod.up > 0.98) {
      pod.leapIn -= dt;
      if (pod.leapIn <= 0) {
        pod.leapIn = 6 + rnd() * 7;
        const all = rnd() < 0.45;
        pod.leaps.forEach((l, i) => { if (all || rnd() < 0.5 || i === 0) Object.assign(l, { t: 0, delay: i * 0.28 + rnd() * 0.1, big: rnd() < 0.7, wet: [false, false] }); });
      }
    }
    let shown = false;
    FORMATION.forEach(([along, across], i) => {
      const p = lanes.dolphin.at(pod.s + along);
      const sx = -Math.sin(p.dir), sz = Math.cos(p.dir); // across the lane
      const x = p.x + sx * across, z = p.z + sz * across;
      // porpoising: a gentle roll through the surface every couple of seconds
      const ph = time * 2.4 + i * 1.7;
      let y = lerp(-0.95, -0.07 + Math.sin(ph) * 0.05, smooth(0, 1, pod.up)); // backs and fins out of the water
      let pitch = reduced ? 0 : -Math.cos(ph) * 0.12 * pod.up;
      const l = pod.leaps[i];
      if (l.t >= 0) {
        l.t += dt;
        const dur = l.big ? 1.25 : 0.9, h = l.big ? 0.8 : 0.42;
        const u = (l.t - l.delay) / dur;
        if (u >= 0 && u <= 1) {
          // a parabola from under the surface, up and over, and back in; nose along the path
          y = -0.22 + 4 * (h + 0.1) * u * (1 - u);
          const vy = (4 * (h + 0.1) * (1 - 2 * u)) / dur;
          pitch = -Math.atan2(vy, DOLPHIN_SPEED * 2.2); // nose along the arc (flattened a little: a cozy leap, not a rocket)
          if (!l.wet[0] && u > 0.06) { l.wet[0] = true; splashes.splash(x, z, { size: 0.35, n: 5, up: 1.1, life: 1.1, spread: 0.4 }); }
          if (!l.wet[1] && u > 0.93) { l.wet[1] = true; splashes.splash(x + Math.cos(p.dir) * 0.2, z + Math.sin(p.dir) * 0.2, { size: 0.45, n: 7, up: 1.2, life: 1.2, spread: 0.45 }); }
        }
        if (u > 1) l.t = -1;
      }
      const vis = y > -0.9;
      shown ||= vis;
      quat.setFromEuler(euler.set(pitch, yawOf(p.dir), 0));
      dolphins.setMatrixAt(i, m4.compose(pos.set(x, y, z), quat, vis ? one : tiny));
    });
    dolphins.instanceMatrix.needsUpdate = true;
    dolphins.visible = shown;
  }

  // ---- the fish schools: one instanced mesh for every fish
  const PER_SCHOOL = SCHOOL.length;
  const fishGeo = fishGeometry();
  disposables.push(fishGeo);
  const fishMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.25, flatShading: true });
  fishMat.userData.noSeason = true;
  disposables.push(fishMat);
  const schools = lanes.fish.map((school) => ({
    ...school,
    at: school.home, // where along its stretch (an index; fractions in between)
    goal: school.home,
    dartIn: 4 + rnd() * 8,
    hide: 0, // 0 shown .. 1 dived out of the way
    heading: 0,
    spin: rnd() * TAU, // the school turns slowly as one
    w: (rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.25),
    fish: SCHOOL.map(([fx, fz]) => ({ a: Math.atan2(fz, fx), r: Math.hypot(fx, fz), y: rnd() * TAU })),
  }));
  const fishMesh = new THREE.InstancedMesh(fishGeo, fishMat, Math.max(1, schools.length * PER_SCHOOL));
  fishMesh.name = 'Fish';
  fishMesh.frustumCulled = false;
  fishMesh.count = schools.length * PER_SCHOOL;
  group.add(fishMesh);
  const SILVER = new THREE.Color(0xffffff), BLUE = new THREE.Color(0x6f8cc8), fc = new THREE.Color();
  const spotAt = (school, at) => {
    const n = school.range.length;
    const i = Math.max(0, Math.min(n - 1, Math.floor(at))), j = Math.min(n - 1, i + 1), t = Math.max(0, Math.min(1, at - i));
    const a = school.range[i], b = school.range[j];
    return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) };
  };

  function placeFish(dt) {
    const routes = swimmers.map((s) => s.route?.()).filter(Boolean);
    let k = 0;
    for (const school of schools) {
      // a swimmer's way: dart along to the nearest clear spot, or dive if there's none
      const refuge = fishRefuge(school, school.goal, routes);
      if (refuge < 0) school.hide = Math.min(1, school.hide + dt * 3);
      else {
        school.hide = Math.max(0, school.hide - dt * 0.8);
        if (refuge !== Math.round(school.goal)) school.goal = refuge;
        else if (!reduced) {
          // now and then a dart along the stretch by itself, to a spot that's clear
          school.dartIn -= dt;
          if (school.dartIn <= 0) {
            school.dartIn = 6 + rnd() * 9;
            const want = Math.floor(rnd() * school.range.length);
            const ok = fishRefuge(school, want, routes);
            if (ok >= 0) school.goal = ok;
          }
        }
      }
      const before = spotAt(school, school.at);
      if (!reduced) {
        const step = Math.min(Math.abs(school.goal - school.at), dt * 7); // about 1.7 units a second
        school.at += Math.sign(school.goal - school.at) * step;
      } else school.at = school.goal;
      const c = spotAt(school, school.at);
      const moving = Math.hypot(c.x - before.x, c.z - before.z) > 1e-4;
      if (moving) school.heading = Math.atan2(c.z - before.z, c.x - before.x);
      if (!reduced && !moving) school.spin += school.w * dt;
      for (const fish of school.fish) {
        const a = fish.a + school.spin;
        const x = c.x + Math.cos(a) * fish.r, z = c.z + Math.sin(a) * fish.r;
        // milling round (the middle one turns on the spot), or all one way in a dart
        const dir = moving ? school.heading : a + (Math.sign(school.w) * Math.PI) / 2;
        const y = 0.004 - school.hide * 0.35 + (reduced ? 0 : Math.sin(time * 3 + fish.y) * 0.008); // backs breaking the surface
        const sc = 1 - school.hide;
        quat.setFromEuler(euler.set(0, yawOf(dir), 0));
        fishMesh.setMatrixAt(k, m4.compose(pos.set(x, y, z), quat, tmp.set(sc, sc, sc).addScalar(1e-4)));
        // the shimmer: each fish flashes silver as it turns in the light
        const glint = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(time * 5 + fish.y * 3 + a * 2);
        fishMesh.setColorAt(k, fc.copy(BLUE).lerp(SILVER, glint));
        k++;
      }
    }
    if (k) {
      fishMesh.instanceMatrix.needsUpdate = true;
      if (fishMesh.instanceColor) fishMesh.instanceColor.needsUpdate = true;
    }
    fishMesh.visible = k > 0;
  }

  // ---- the whale (built the first time it comes)
  let whaleMesh = null;
  let whaleRun = null; // { t, x, z, dir, events }
  const clock = createWhaleClock({ rnd, date });
  const taps = createTapCounter();
  let whaleSoon = whaleNow ? 3 : -1; // ?whale=1: a few seconds in

  function bringWhale({ force = false } = {}) {
    if (whaleRun) return false;
    // (the orca and the dolphins carry on as they are: the whale keeps clear of where they'll be)
    const busy = showPath(lanes, { orcaAt: orcaState.s, podAt: pod.s }, reduced ? 0 : WHALE_SHOW + 1);
    for (const school of schools) for (const p of school.range) busy.push({ x: p.x, z: p.z, r: SEA.fish.radius }); // and the fish's shallows
    const swimming = swimmers.map((s) => s.route?.()).filter(Boolean);
    // of the spots it can be seen at, one of the nearer ones (far out, the haze washes it pale)
    const c = camera.position;
    const score = (x, z) => Math.hypot(x - c.x, z - c.z) + rnd() * 4;
    const opts = { rnd, keepOuts, busy, swimmers: swimming, score };
    let spot = whaleSpot(sea, lanes, { ...opts, visible: (x, z) => inSight(x, z, 0.18, SEA.whale.radius, 1.2) && onScreen(x, z, 0.25, 1.2) });
    if (!spot && force) spot = whaleSpot(sea, lanes, { ...opts, visible: (x, z) => onScreen(x, z, 0.05) });
    if (!spot && force) spot = whaleSpot(sea, lanes, opts);
    if (!spot) return false;
    if (!whaleMesh) {
      const g = whaleGeometry();
      disposables.push(g);
      whaleMesh = new THREE.Mesh(g, material);
      whaleMesh.name = 'Whale';
      group.add(whaleMesh);
    }
    whaleRun = { t: 0, ...spot, done: {} };
    // the swimmers pick their next paddles round it while it's up
    if (info.gate) info.gate.keepOut = (x, z) => whaleKeepOut(spot, x, z);
    clock.after();
    return true;
  }

  // the whale's show, over 11 s: [time, centre height, pitch (+ nose down), roll]
  const SHOW = [
    [0, -1.15, 0, 0], [1.4, -0.32, 0.04, 0], [2.0, -0.32, -0.03, 0], [2.6, -0.85, 0.25, 0], // rises, blows, goes under
    [3.2, -0.55, -1.05, 0], [3.9, 0.95, -0.55, 0.7], [4.4, 1.05, 0.1, 1.2], [5.0, -0.2, 0.75, 1.5], // breaches, rolls, falls
    [5.6, -1.0, 0.3, 0.6], [6.6, -0.9, 0, 0], [7.4, -0.5, 0.9, 0], [8.4, -0.45, 1.05, 0], // under; tail up
    [8.75, -0.55, 0.2, 0], [9.6, -0.95, 0.15, 0], [11, -1.25, 0, 0], // slap, and sinks away
  ];
  const sampleShow = (t) => {
    let i = 0;
    while (i < SHOW.length - 2 && SHOW[i + 1][0] <= t) i++;
    const a = SHOW[i], b = SHOW[i + 1];
    const u = smooth(0, 1, (t - a[0]) / (b[0] - a[0]));
    return [lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u)];
  };

  function placeWhale(dt) {
    if (!whaleRun) return;
    const w = whaleRun;
    w.t += dt;
    if (reduced) {
      // held still at the surface for a few seconds, then gone
      whaleMesh.visible = w.t < 6;
      whaleMesh.position.set(w.x, -0.32, w.z);
      whaleMesh.rotation.set(0, yawOf(w.dir), 0, 'YXZ');
      if (w.t >= 6) endWhale();
      return;
    }
    let [y, pitch, roll] = sampleShow(w.t);
    // a touch forward through the show (well inside its own patch of sea: SEA.whale.radius)
    const fwd = Math.min(w.t, WHALE_SHOW) * 0.02;
    const x = w.x + Math.cos(w.dir) * fwd, z = w.z + Math.sin(w.dir) * fwd;
    // never into the sea floor: the lower end of the body stays above it
    const floor = sea.heightAt(x, z) + 0.25;
    const low = y - Math.abs(Math.sin(pitch)) * WHALE_HALF - WHALE_THICK * Math.abs(Math.cos(pitch));
    if (low < floor) y += floor - low;
    whaleMesh.visible = w.t < WHALE_SHOW && y > -1.3;
    whaleMesh.position.set(x, y, z);
    whaleMesh.rotation.set(pitch, yawOf(w.dir), roll, 'YXZ');
    const at = (v) => tmp.copy(v).applyEuler(whaleMesh.rotation).add(whaleMesh.position);
    const once = (key, when, fn) => { if (!w.done[key] && w.t >= when) { w.done[key] = true; fn(); } };
    once('blow', 1.5, () => { at(WHALE_BLOWHOLE); splashes.blow(tmp.x, Math.max(0.1, tmp.y), tmp.z, { n: 22, up: 2.2, r: 0.05 }); });
    once('leap', 3.6, () => splashes.splash(x, z, { size: 0.9, n: 10, up: 1.5, life: 1.3, spread: 0.7 }));
    once('fall', 5.0, () => {
      splashes.splash(x, z, { size: 1.5, n: 26, up: 2.4, life: 2.0, spread: 1.1 });
      splashes.splash(x + Math.cos(w.dir) * 0.5, z + Math.sin(w.dir) * 0.5, { size: 0.9, n: 8, up: 1.6, life: 1.6, spread: 0.8 });
    });
    once('slap', 8.85, () => { at(WHALE_TAIL); splashes.splash(tmp.x, tmp.z, { size: 1.1, n: 18, up: 2.0, life: 1.7, spread: 0.9 }); });
    once('say', 6.2, () => sayOnce());
    if (w.t >= WHALE_SHOW) endWhale();
  }

  function endWhale() {
    whaleMesh.visible = false;
    whaleRun = null;
    if (info.gate) info.gate.keepOut = null;
  }

  function sayOnce() {
    if (!manami) return;
    let seen = false;
    try { seen = localStorage.getItem(WHALE_SEEN_KEY) === '1'; } catch { /* private mode: say it this once */ }
    if (seen) return;
    try { localStorage.setItem(WHALE_SEEN_KEY, '1'); } catch { /* fine */ }
    // only over the plain farm view (not over a plan, the planner or the soil test)
    const b = document.body.classList;
    if (!b.contains('is-hub') || b.contains('plan-futures') || b.contains('isle-planning')) return;
    manami.say(WHALE_LINE);
  }

  // ---- three taps on the open sea call the whale
  const canvas = view.canvas;
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let down = null;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    if (!down || e.button > 0) return;
    const quick = performance.now() - down.t < 350 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
    down = null;
    if (!quick || reduced) return;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera({ x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -((e.clientY - rect.top) / rect.height) * 2 + 1 }, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    // the open sea: past the beach, deep, and not behind the island from here
    const open = sea.outAt(hit.x, hit.z) > 1 && sea.heightAt(hit.x, hit.z) < -0.4 && onScreen(hit.x, hit.z, 0) && clearLine(hit.x, 0.05, hit.z);
    if (!open) { taps.reset(); return; }
    if (taps.tap(time)) bringWhale();
  };
  canvas?.addEventListener('pointerdown', onDown);
  canvas?.addEventListener('pointerup', onUp);

  const mq = reducedMotionQuery();
  const onMotion = () => { reduced = mq.matches; if (reduced) splashes.clear(); };
  mq?.addEventListener?.('change', onMotion);

  // ---- every frame
  const frame = (dt) => {
    if (!Number.isFinite(dt) || dt <= 0) dt = 0;
    time += dt;
    if (!reduced && clock.step(dt)) bringWhale();
    if (whaleSoon >= 0) { whaleSoon -= dt; if (whaleSoon < 0) bringWhale({ force: true }); }
    placeOrca(dt);
    placeDolphins(dt);
    placeFish(dt);
    placeWhale(dt);
    splashes.update(dt);
  };
  frame(0);
  const off = view.onFrame(frame);

  return {
    /** Brings the whale now, where it can be seen (anywhere out there if nowhere can). */
    whale: () => bringWhale({ force: true }),
    /** For checking in the console: moves everything on by `seconds` (as if that much time went by). */
    step(seconds) { for (let t = 0; t < seconds; t += 1 / 30) frame(1 / 30); },
    /** For checking in the console: where everything is. */
    get debug() {
      return { lanes, schools, orca, dolphins, fishMesh, whale: whaleMesh, whaleRun, sea, keepOuts, clock };
    },
    dispose() {
      off?.();
      if (info.gate) info.gate.keepOut = null;
      canvas?.removeEventListener('pointerdown', onDown);
      canvas?.removeEventListener('pointerup', onUp);
      mq?.removeEventListener?.('change', onMotion);
      splashes.dispose();
      dolphins.dispose?.();
      fishMesh.dispose?.();
      disposables.forEach((d) => d.dispose());
      group.removeFromParent();
    },
  };
}
