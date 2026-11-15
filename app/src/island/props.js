// Island props: the low-poly farm pieces from the 3D prototype, as standalone building blocks.
//
// Ported from team-sheeeep-assets/team-sheeeep-3d/index.html. The shapes, colours, materials and
// sizes are the prototype's own; the only changes are the ones needed to make each piece standalone:
//   - the prototype placed things straight onto its island (placeOn / island.add) using one shared
//     random stream. Here every maker returns a THREE.Group and draws its randomness from its own
//     seeded generator, so the same seed always gives the same tree, rock or barn.
//   - every group has its base at y = 0 and is centred on its footprint, with no rotation, so the
//     caller can position, turn and scale it freely.
//   - lit windows and lamps are set to the prototype's daytime brightness (10:00); setNightGlow()
//     can turn them up again for evening scenes using the prototype's own formula.
//
// Units: the prototype island has a radius of about 7 units. The barn is 2.3 units to its ridge
// (2.56 to the chimney top), a tree is 1.35 to 2.9 units tall and a grown sheep is 0.62 units tall.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { asset } from '../ui/asset.js';

// ---------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------

// The prototype's colours (its const C, GR, TREE_PAL and STONE), gathered in one place.
export const ISLAND_COLORS = {
  // Daytime sky, top to bottom, and the matching CSS background for the page behind the canvas.
  sky: { top: 0xb6c4d3, middle: 0xd9dde7, bottom: 0xece5ec },
  skyCss: 'linear-gradient(180deg,#b6c4d3 0%,#d9dde7 48%,#ece5ec 100%)',
  fog: 0xe6e2ee,
  // Flat grass greens used on solid surfaces such as the display discs (C.grass, C.grass2, C.grass3).
  grass: [0xbabd68, 0xaab25b, 0xc8c776],
  // The terrain's vertex-colour greens: base, light, dark, sunny yellow, and the darker slope green (GR).
  grassTerrain: [0xb6be63, 0xcaca7a, 0x9fae55, 0xd6ce80],
  grassSlope: 0x86994a,
  // Cliff sides: light and shaded sandstone, then the darker underside of a floating island.
  cliff: [0xd2b993, 0xbfa27f],
  under: 0xb09379,
  earth: [0xbf9e74, 0xa98a66],       // bare earth on steep slopes
  sand: 0xecdfc0,
  soil: [0x9a7656, 0x8a6a4c],        // paddock bed
  furrow: [0x9b7657, 0x8c6a4c],      // alternating furrow ridges
  path: [0xe8dfcf, 0xe7dcc6, 0xd6c6a6],
  wood: 0xa6815f,
  woodDark: 0x7d5e45,
  cream: 0xece4d4,
  roof: [0x8ccab3, 0x6faa94],
  water: [0x9f9ae0, 0xb9b5ef],
  foam: 0xf5f2ff,
  glow: 0xffd88a,
  stone: [0xb9b3a6, 0xa9a396, 0xc7c1b4, 0x9d978a, 0xb3ab9b],
  rock: [0xc4beb2, 0xb2ac9f, 0xd2ccc0, 0xa9a397],
  hay: 0xe3c46f,
};

// Tree leaf gradients, bottom colour then top colour (the prototype's TREE_PAL plus its two round-tree palettes).
export const TREE_PALETTES = {
  green: [0x6c963a, 0xcbd96a],
  yellow: [0x9aae40, 0xefdc70],
  lime: [0x7fa53b, 0xdfe47c],
  deep: [0x5f8a39, 0xb3cc5e],
  round: [0x6e9a3e, 0xc4d667],
  blossom: [0xd98fa6, 0xfbd3dd],
};

// Sheep wool colours from the 2D designs. Black is Manami herself and keeps the model's own wool.
export const SHEEP_WOOL = {
  black: 0x1d1b20,
  cream: 0xe9e5dd,
  oat: 0xcdbfa1,
  beige: 0xd1b8a6,
  cocoa: 0xa37758,
  grey: 0x847468,
  pink: 0xe595ac,
};

// Rough footprint radius of each prop in units at its default size, for spacing things out.
// Measured from the built groups (half the larger of width and depth, rounded up a little).
export const FOOTPRINT = {
  barn: 1.45,       // the building plus its stone apron, bench and awning
  dock: 0.65,       // half its width; it runs 1.9 units out from the shore
  boat: 0.85,
  silo: 0.6,
  windmill: 0.7,    // the base; the sails sweep a 1.3 unit radius higher up
  tree: 0.45,       // tulip and round trees
  pine: 0.4,
  bush: 0.35,
  rock: 0.3,
  hayBale: 0.3,
  hayStack: 0.4,
  scarecrow: 0.4,
  fencePerUnit: 0.07, // a fence run is a thin line: half its thickness
  barrel: 0.2,
  crate: 0.25,
  bench: 0.32,
  lampPost: 0.15,
  mailbox: 0.15,
  signpost: 0.3,
  wheelbarrow: 0.45,
  firewood: 0.3,
  sheep: 0.32,      // a grown sheep at 0.62 scale
  manami: 0.4,      // Manami at 0.8 scale
};

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

// Seeded random numbers (the prototype's mulberry32). Returns r() plus range and pick helpers.
export function rng(seed = 1) {
  let s = seed | 0;
  const r = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.pick = (list) => list[Math.floor(r() * list.length)];
  return r;
}

// A stable pseudo-random number from three coordinates; used to wobble vertices the same way every time.
function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

// Nudge each vertex by a small amount based on where it sits, so shared corners move together and
// the shape stays closed. Gives rocks, stones and tree blobs their hand-made look.
export function jitter(geo, [ax, ay, az], filter = () => true) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (!filter(v)) continue;
    const k = [v.x, v.y, v.z].map((n) => Math.round(n * 1000) / 1000);
    p.setXYZ(
      i,
      v.x + (hash3(k[0], k[1], k[2]) - 0.5) * ax,
      v.y + (hash3(k[1], k[2], k[0]) - 0.5) * ay,
      v.z + (hash3(k[2], k[0], k[1]) - 0.5) * az,
    );
  }
  geo.computeVertexNormals();
  return geo;
}

// Materials are shared between every prop that uses the same colour and settings.
const matCache = new Map();

// The prototype's standard look: matte, flat-shaded facets.
export function mat(color, options = {}) {
  const key = color + JSON.stringify(options);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...options }));
  }
  return matCache.get(key);
}

// Same, but smooth-shaded, for round things (trunks, barrels, the silo).
export function soft(color, options = {}) {
  return mat(color, { flatShading: false, ...options });
}

// A mesh that casts and receives shadows unless told otherwise.
export function mesh(geo, material, cast = true, receive = true) {
  const o = new THREE.Mesh(geo, material);
  o.castShadow = cast;
  o.receiveShadow = receive;
  return o;
}

// Paint a geometry with a bottom-to-top colour fade (stored as vertex colours).
export function gradientColors(geo, bottom, top) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * 3);
  const a = new THREE.Color(bottom);
  const b = new THREE.Color(top);
  const t = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const f = (p.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
    t.copy(a).lerp(b, f);
    c.set([t.r, t.g, t.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.computeVertexNormals();
  return geo;
}

// One shared vertex-colour material per shading style (the prototype made a new identical one each time).
const gradMats = {};
// The leaf materials: the seasons colour these (autumn reds, winter greys); see src/island/seasons.js.
// Pines use their own (evergreen) one.
function gradMat(flat, roughness = 0.85, season = 'foliage') {
  const key = `${flat}-${roughness}-${season}`;
  if (!gradMats[key]) {
    gradMats[key] = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: flat, roughness });
    gradMats[key].userData.season = season;
  }
  return gradMats[key];
}

// A mesh painted with a bottom-to-top colour fade: leaves, cones, bushes. season: 'foliage' (turns
// with the seasons) or 'evergreen' (pines).
export function gradMesh(geo, bottom, top, flat = true, season = 'foliage') {
  return new THREE.Mesh(gradientColors(geo, bottom, top), gradMat(flat, 0.85, season));
}

// Build a transform matrix from position, rotation and scale (handy for instanced meshes).
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function matrix(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

// Many copies of one shape in one draw call, each with its own transform and (optionally) colour.
export function instanced(geo, material, matrices, colors) {
  const im = new THREE.InstancedMesh(geo, material, matrices.length);
  im.castShadow = true;
  im.receiveShadow = true;
  matrices.forEach((m, i) => {
    im.setMatrixAt(i, m);
    if (colors) im.setColorAt(i, new THREE.Color(colors[i]));
  });
  return im;
}

// Lit windows and lamps. The prototype brightens these at night; their night-time strength is kept
// in userData so setNightGlow() can apply the same curve. They start at daytime brightness.
const glowCache = new Map();
export function glowMat(color, emissive, base, roughness) {
  const key = `${color}-${emissive}-${base}-${roughness}`;
  if (!glowCache.has(key)) {
    const options = { color, emissive, emissiveIntensity: base * 0.45 };
    if (roughness !== undefined) options.roughness = roughness;
    const m = new THREE.MeshStandardMaterial(options);
    m.userData.glowBase = base;
    glowCache.set(key, m);
  }
  return glowCache.get(key);
}
function glowLight(color, base, distance) {
  const l = new THREE.PointLight(color, base * 0.15, distance, 2);
  l.userData.glowBase = base;
  l.userData.glowDistance = distance;
  return l;
}

// Turn the windows and lamps inside `root` up for the evening. night: 0 = full day, 1 = full night.
export function setNightGlow(root, night) {
  root.traverse((o) => {
    if (o.isPointLight && o.userData.glowBase !== undefined) {
      o.intensity = o.userData.glowBase * (0.15 + 2.6 * night);
      o.distance = o.userData.glowDistance * (1 + 0.7 * night);
    }
    const m = o.material;
    if (m && m.userData && m.userData.glowBase !== undefined) {
      m.emissiveIntensity = m.userData.glowBase * (0.45 + 2.4 * night);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Renderer, lights and atmosphere
// ---------------------------------------------------------------------------------------------

// The prototype's renderer settings. Its soft shadows used PCFSoftShadowMap, which three r187 has
// removed; PCFShadowMap with a shadow radius (set on the sun below) gives the same soft edge.
export function configureRenderer(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

// The prototype's fog runs from 24 to 56 units for its 7-unit island; this scales it to any island.
export function addIslandFog(scene, radius = 7) {
  const k = radius / 7;
  scene.fog = new THREE.Fog(ISLAND_COLORS.fog, 24 * k, 56 * k);
  return scene.fog;
}

// Where the sun sits at the prototype's default time of day (10:00), for a 7-unit island.
const SUN_OFFSET = new THREE.Vector3(-7, 12.26, 3.5);
const FILL_OFFSET = new THREE.Vector3(9, 6, -5);

// Hemisphere sky light, a warm sun with soft shadows, and a cool fill from the other side.
// fit(radius, center) moves the sun and sizes its shadow box to cover an island of that radius.
export function addIslandLights(scene, radius = 7) {
  const hemi = new THREE.HemisphereLight(0xf7f3ff, 0xb9aa8a, 1.3);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d6, 2.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0xcdd6ff, 0.6);
  scene.add(fill);
  scene.add(fill.target);

  let k = 1;
  let sunDir = null; // null: the default 10:00 sun
  function fit(r = radius, center = new THREE.Vector3()) {
    k = Math.max(r, 0.5) / 7;
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(SUN_OFFSET, k);
    if (sunDir) aim(sunDir);
    fill.target.position.copy(center);
    fill.position.copy(center).addScaledVector(FILL_OFFSET, k);
    // The prototype's shadow box was +-11 units for a 7-unit island, from 1 to 46 units out.
    const half = 11 * k;
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1 * k, far: 46 * k });
    sun.shadow.camera.updateProjectionMatrix();
  }
  fit(radius);

  /**
   * Points the sun (or the moon: it's the same light) from `dir`, a unit vector from the island
   * toward it, at the usual distance (so the shadow box still covers the island). null: back to 10:00.
   */
  function aim(dir) {
    sunDir = dir ? [dir[0], dir[1], dir[2]] : null;
    if (!sunDir) { sun.position.copy(sun.target.position).addScaledVector(SUN_OFFSET, k); return; }
    const dist = SUN_OFFSET.length() * k;
    sun.position.set(sunDir[0], sunDir[1], sunDir[2]).multiplyScalar(dist).add(sun.target.position);
  }

  return { hemi, sun, fill, fit, aim };
}

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------

// The red-brown barn with a mint shingle roof, chimney, sheep sign, flower boxes, bench and lantern.
// 2.8 units wide (with the roof overhang) by 2.3 deep, 2.56 tall to the chimney top.
// Its door faces +z. The origin is the middle of the building; the bench sits in front of it.
export function makeBarn(seed = 3) {
  const r = rng(seed);
  const R = r.range;
  const pick = r.pick;
  const barn = new THREE.Group();
  barn.name = 'Barn';

  // a ring of flat stones around the base
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2;
    const sx = Math.cos(a) * 1.3;
    const sz = Math.sin(a) * 1.0;
    const st = mesh(jitter(new THREE.DodecahedronGeometry(0.16, 0), [0.05, 0.05, 0.05]), mat(pick([0xc9c3b6, 0xb8b2a5, 0xd4cec2])));
    st.position.set(Math.max(-1.18, Math.min(1.18, sx)), 0.08, Math.max(-0.86, Math.min(0.86, sz)));
    st.scale.y = 0.7;
    barn.add(st);
  }
  const slab = mesh(new THREE.BoxGeometry(2.35, 0.16, 1.7), mat(0xbfb8aa));
  slab.position.y = 0.08;
  barn.add(slab);
  const wall = mesh(new THREE.BoxGeometry(2.2, 1.15, 1.55), mat(0x9f7a5b));
  wall.position.y = 0.74;
  barn.add(wall);
  // vertical planks on every side, in two alternating browns
  for (const zf of [0.785, -0.785]) {
    for (let k = -5; k <= 5; k++) {
      const pl = mesh(new THREE.BoxGeometry(0.19, 1.13, 0.03), mat(k % 2 ? 0xa98363 : 0x9b7556));
      pl.position.set(k * 0.2, 0.74, zf);
      barn.add(pl);
    }
  }
  for (const xs of [-1.105, 1.105]) {
    for (let k = -3; k <= 3; k++) {
      const pl = mesh(new THREE.BoxGeometry(0.03, 1.13, 0.2), mat(k % 2 ? 0xa98363 : 0x9b7556));
      pl.position.set(xs, 0.74, k * 0.21);
      barn.add(pl);
    }
  }
  // corner posts
  for (const [x, z] of [[-1.11, 0.79], [1.11, 0.79], [-1.11, -0.79], [1.11, -0.79]]) {
    const cp = mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), mat(0x7d5e45));
    cp.position.set(x, 0.74, z);
    barn.add(cp);
  }
  // gable ends with a little lit triangular window
  const tri = new THREE.Shape();
  tri.moveTo(-0.79, 0);
  tri.lineTo(0.79, 0);
  tri.lineTo(0, 0.86);
  tri.closePath();
  const gableWin = glowMat(0xffe1a0, 0xffc766, 0.6);
  for (const xs of [-1.1, 1.1]) {
    const gg = new THREE.ExtrudeGeometry(tri, { depth: 0.06, bevelEnabled: false });
    gg.rotateY(Math.PI / 2);
    const gm = mesh(gg, mat(0xa98363));
    gm.position.set(xs - 0.03, 1.31, 0);
    barn.add(gm);
    const aw = mesh(new THREE.CircleGeometry(0.14, 3), gableWin, false, false);
    aw.rotation.set(0, xs > 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI / 2);
    aw.position.set(xs + (xs > 0 ? 0.05 : -0.05), 1.62, 0);
    barn.add(aw);
  }
  // shingled roof: two tilted boards covered in slightly uneven mint tiles
  const roofPal = [0x8ccab3, 0x82c2aa, 0x96d1bb, 0x7cb9a1];
  for (const s of [-1, 1]) {
    const rg = new THREE.Group();
    rg.position.set(0, 1.73, s * 0.47);
    rg.rotation.x = s * 0.74;
    barn.add(rg);
    const under = mesh(new THREE.BoxGeometry(2.62, 0.05, 1.32), mat(0x6faa94));
    rg.add(under);
    for (let row = 0; row < 5; row++) {
      const z = s * (-0.55 + row * 0.27);
      for (let k = 0; k < 9; k++) {
        const sh = mesh(new THREE.BoxGeometry(0.31, 0.045, 0.32), mat(pick(roofPal)));
        sh.position.set(-1.25 + k * 0.31 + (row % 2) * 0.15, 0.04 + row * 0.012, z);
        sh.rotation.set(R(-0.03, 0.03), R(-0.04, 0.04), R(-0.03, 0.03));
        if (Math.abs(sh.position.x) < 1.36) rg.add(sh);
      }
    }
  }
  const ridge = mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.75, 10), soft(0x6faa94));
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(0, 2.27, 0);
  barn.add(ridge);
  const ch = mesh(new THREE.BoxGeometry(0.28, 0.8, 0.28), mat(0xb9b2a6));
  ch.position.set(0.68, 2.1, -0.32);
  barn.add(ch);
  const chc = mesh(new THREE.BoxGeometry(0.36, 0.08, 0.36), mat(0x8f8a80));
  chc.position.set(0.68, 2.52, -0.32);
  barn.add(chc);
  // double door with Z braces, its awning, and the round sheep sign above
  const dfr = mesh(new THREE.BoxGeometry(0.74, 0.92, 0.05), mat(0xe9dfcc));
  dfr.position.set(0, 0.6, 0.8);
  barn.add(dfr);
  for (const s of [-1, 1]) {
    const dd = mesh(new THREE.BoxGeometry(0.31, 0.84, 0.05), mat(0x6e5139));
    dd.position.set(s * 0.16, 0.58, 0.82);
    barn.add(dd);
    const zb = mesh(new THREE.BoxGeometry(0.4, 0.04, 0.02), mat(0x8a6a4d));
    zb.position.set(s * 0.16, 0.58, 0.85);
    zb.rotation.z = s * 0.9;
    barn.add(zb);
  }
  const awning = mesh(new THREE.BoxGeometry(1.0, 0.05, 0.42), mat(0x8ccab3));
  awning.position.set(0, 1.12, 0.98);
  awning.rotation.x = 0.38;
  barn.add(awning);
  const sign = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24), soft(0xf1e7d4));
  sign.scale.set(1.4, 1, 1);
  sign.rotation.x = Math.PI / 2;
  sign.position.set(0, 1.35, 0.81);
  barn.add(sign);
  for (const [x, yy, rad] of [[0, 1.36, 0.07], [-0.07, 1.38, 0.05], [0.07, 1.38, 0.05], [-0.05, 1.32, 0.05], [0.05, 1.32, 0.05]]) {
    const w = mesh(new THREE.SphereGeometry(rad, 12, 10), soft(0xffffff));
    w.position.set(x, yy, 0.84);
    w.scale.z = 0.5;
    barn.add(w);
  }
  const fce = mesh(new THREE.SphereGeometry(0.035, 10, 8), soft(0x3d3734));
  fce.position.set(0.075, 1.35, 0.86);
  fce.scale.z = 0.5;
  barn.add(fce);
  // lit windows with cross bars and flower boxes
  const winM = glowMat(0xffe1a0, 0xffc766, 0.65, 0.6);
  for (const x of [-0.74, 0.74]) {
    const fr = mesh(new THREE.BoxGeometry(0.44, 0.4, 0.05), mat(0xe9dfcc));
    fr.position.set(x, 0.95, 0.8);
    barn.add(fr);
    const pane = mesh(new THREE.BoxGeometry(0.34, 0.3, 0.05), winM);
    pane.position.set(x, 0.95, 0.815);
    barn.add(pane);
    const cb = mesh(new THREE.BoxGeometry(0.34, 0.03, 0.02), mat(0xe9dfcc));
    cb.position.set(x, 0.95, 0.845);
    barn.add(cb);
    const cv = mesh(new THREE.BoxGeometry(0.03, 0.3, 0.02), mat(0xe9dfcc));
    cv.position.set(x, 0.95, 0.845);
    barn.add(cv);
    const box = mesh(new THREE.BoxGeometry(0.48, 0.12, 0.14), mat(0x7d9c4b));
    box.position.set(x, 0.7, 0.88);
    barn.add(box);
    for (let k = 0; k < 6; k++) {
      const fl = mesh(new THREE.IcosahedronGeometry(0.045, 0), mat(pick([0xf3b6c8, 0xf6dc6e, 0xb7a7ec, 0xfaf5ec])));
      fl.position.set(x - 0.18 + k * 0.072, 0.8 + R(0, 0.04), 0.9);
      barn.add(fl);
    }
  }
  // bench by the door, and a lantern
  const bench = makeBench();
  bench.position.set(-0.85, 0, 1.12);
  barn.add(bench);
  const lan = mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), glowMat(0xfff0c8, 0xffcf73, 1.1));
  lan.position.set(0.48, 0.98, 0.86);
  barn.add(lan);
  const ll = glowLight(0xffd38a, 0.7, 2.5);
  ll.position.set(0.48, 0.95, 1.0);
  barn.add(ll);
  return barn;
}

// The cream silo with hoops, a mint dome and a ladder on its +z side. 1.06 across, 2.57 tall.
export function makeSilo() {
  const silo = new THREE.Group();
  silo.name = 'Silo';
  const body = mesh(new THREE.CylinderGeometry(0.5, 0.53, 1.9, 18), soft(0xeae1cf));
  body.position.y = 0.95;
  silo.add(body);
  for (const h of [0.4, 0.8, 1.2, 1.6]) {
    const b = mesh(new THREE.CylinderGeometry(0.535, 0.535, 0.05, 18), soft(0xcfc3ab));
    b.position.y = h;
    silo.add(b);
  }
  const dome = mesh(new THREE.SphereGeometry(0.52, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), soft(0x8ccab3));
  dome.position.y = 1.9;
  silo.add(dome);
  const top = mesh(new THREE.ConeGeometry(0.12, 0.2, 10), soft(0x6faa94));
  top.position.y = 2.47;
  silo.add(top);
  // ladder: two rails and nine rungs
  for (const s of [-1, 1]) {
    const rl = mesh(new THREE.BoxGeometry(0.03, 1.8, 0.03), mat(0x7d5e45));
    rl.position.set(s * 0.12, 0.95, 0.53);
    silo.add(rl);
  }
  for (let k = 0; k < 9; k++) {
    const rung = mesh(new THREE.BoxGeometry(0.26, 0.025, 0.025), mat(0x7d5e45));
    rung.position.set(0, 0.15 + k * 0.2, 0.53);
    silo.add(rung);
  }
  return silo;
}

// The windmill: a cream eight-sided tower, mint cap and four sails facing +z. 2.7 tall, sails
// reach 3.45. Spin it with group.userData.blades.rotation.z = seconds * 0.6 (the prototype's speed).
export function makeWindmill() {
  const wm = new THREE.Group();
  wm.name = 'Windmill';
  const tower = mesh(new THREE.CylinderGeometry(0.36, 0.58, 2.1, 8), mat(0xeee5d3));
  tower.position.y = 1.05;
  wm.add(tower);
  for (const h of [0.05, 1.0, 2.05]) {
    const b = mesh(new THREE.CylinderGeometry(0.6 - h * 0.1, 0.6 - h * 0.1, 0.07, 8), mat(0xa6815f));
    b.position.y = h;
    wm.add(b);
  }
  const door = mesh(new THREE.BoxGeometry(0.3, 0.5, 0.05), mat(0x6e5139));
  door.position.set(0, 0.3, 0.55);
  door.rotation.x = -0.1;
  wm.add(door);
  const win = mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), glowMat(0xffe1a0, 0xffc766, 0.5));
  win.position.set(0, 1.35, 0.44);
  win.rotation.x = -0.1;
  wm.add(win);
  const cap = mesh(new THREE.ConeGeometry(0.5, 0.6, 8), mat(0x8ccab3));
  cap.position.y = 2.4;
  wm.add(cap);
  const hub = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.25, 10), soft(0x7d5e45));
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 2.2, 0.48);
  wm.add(hub);
  const blades = new THREE.Group();
  blades.name = 'Windmill blades';
  blades.position.set(0, 2.2, 0.62);
  wm.add(blades);
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Group();
    arm.rotation.z = (k * Math.PI) / 2;
    blades.add(arm);
    const spar = mesh(new THREE.BoxGeometry(0.05, 1.25, 0.04), mat(0x7d5e45));
    spar.position.y = 0.65;
    arm.add(spar);
    const sail = mesh(new THREE.BoxGeometry(0.3, 0.95, 0.02), mat(0xf6f0e4));
    sail.position.set(0.17, 0.75, 0);
    arm.add(sail);
    for (let j = 0; j < 4; j++) {
      const sl = mesh(new THREE.BoxGeometry(0.3, 0.02, 0.03), mat(0xa6815f));
      sl.position.set(0.17, 0.35 + j * 0.27, 0.01);
      arm.add(sl);
    }
  }
  wm.userData.blades = blades;
  return wm;
}

// ---------------------------------------------------------------------------------------------
// Trees and bushes
// ---------------------------------------------------------------------------------------------

// A tulip-shaped tree: seven leaf petals around a centre spire on a thin trunk.
function tulipTree(r, s, pal) {
  const R = r.range;
  const g = new THREE.Group();
  g.name = 'Tulip tree';
  const tr = mesh(new THREE.CylinderGeometry(0.06 * s, 0.1 * s, 1.15 * s, 8), soft(0x8a6a4f));
  tr.position.y = 0.55 * s;
  tr.rotation.z = R(-0.05, 0.05);
  g.add(tr);
  const prof = [[0, 0], [0.16, 0.1], [0.28, 0.42], [0.32, 0.85], [0.27, 1.25], [0.16, 1.6], [0.06, 1.85], [0, 1.93]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const [lo, hi] = pal;
  const can = new THREE.Group();
  can.position.y = 0.95 * s;
  can.scale.setScalar(s);
  g.add(can);
  const n = 7;
  for (let k = 0; k < n; k++) {
    const pv = new THREE.Group();
    pv.rotation.y = (k / n) * Math.PI * 2 + R(-0.2, 0.2);
    can.add(pv);
    const pg = new THREE.LatheGeometry(prof, 6);
    pg.scale(1, 1, 0.55);
    const pm = gradMesh(pg, lo, hi);
    pm.castShadow = pm.receiveShadow = true;
    pm.position.z = 0.18;
    pm.rotation.x = R(0.22, 0.36);
    pm.scale.setScalar(R(0.85, 1.05));
    pv.add(pm);
  }
  const mid = gradMesh(new THREE.LatheGeometry(prof, 7), lo, hi);
  mid.castShadow = true;
  mid.scale.set(1.25, 1.18, 1.25);
  can.add(mid);
  return g;
}

// A round tree: six lumpy leaf balls on a trunk. Also used for the pink blossom tree.
function roundTree(r, s, pal, name) {
  const g = new THREE.Group();
  g.name = name;
  const tr = mesh(new THREE.CylinderGeometry(0.06 * s, 0.1 * s, 0.9 * s, 8), soft(0x8a6a4f));
  tr.position.y = 0.45 * s;
  g.add(tr);
  for (const [bx, by, bz, br] of [[0, 1.05, 0, 0.55], [0.32, 0.9, 0.12, 0.4], [-0.3, 0.92, -0.1, 0.42], [0.05, 1.38, -0.05, 0.42], [-0.1, 0.85, 0.32, 0.36], [0.18, 1.15, -0.3, 0.35]]) {
    const b = gradMesh(jitter(new THREE.IcosahedronGeometry(br * s, 1), [0.06 * s, 0.06 * s, 0.06 * s]), pal[0], pal[1]);
    b.castShadow = b.receiveShadow = true;
    b.position.set(bx * s, by * s, bz * s);
    b.rotation.set(r() * 3, r() * 3, 0);
    g.add(b);
  }
  return g;
}

// A pine: four stacked cones on a short trunk.
function pineTree(r, s) {
  const g = new THREE.Group();
  g.name = 'Pine';
  const tr = mesh(new THREE.CylinderGeometry(0.05 * s, 0.08 * s, 0.6 * s, 7), soft(0x7a5b43));
  tr.position.y = 0.3 * s;
  g.add(tr);
  for (let k = 0; k < 4; k++) {
    const c = gradMesh(new THREE.ConeGeometry((0.62 - k * 0.13) * s, 0.75 * s, 8), 0x4f7d3e, 0x93b55c, true, 'evergreen');
    c.castShadow = true;
    c.position.y = (0.65 + k * 0.38) * s;
    c.rotation.y = r() * 3;
    g.add(c);
  }
  return g;
}

// The prototype's usual size for each tree kind (it varied them between about 0.6 and 0.95).
const TREE_SIZE = { 'tulip-green': 0.9, 'tulip-yellow': 0.9, round: 0.75, pine: 0.7, blossom: 0.7 };

// kind: 'tulip-green' | 'tulip-yellow' | 'round' | 'pine' | 'blossom'. Heights at the default
// size: tulip about 2.9 (1.5 to 1.75 across), round 1.55, pine 1.5, blossom 1.35. Pass size to grow or shrink it
// (1 = the prototype's unit tree).
export function makeTree(kind = 'round', seed = 1, size = TREE_SIZE[kind] ?? 0.75) {
  const r = rng(seed * 7919 + 17);
  switch (kind) {
    case 'tulip-green': return tulipTree(r, size, TREE_PALETTES.green);
    case 'tulip-yellow': return tulipTree(r, size, TREE_PALETTES.yellow);
    case 'pine': return pineTree(r, size);
    case 'blossom': return roundTree(r, size, TREE_PALETTES.blossom, 'Blossom tree');
    default: return roundTree(r, size, TREE_PALETTES.round, 'Round tree');
  }
}

// kind: 'spiky' (a tuft of grass blades) | 'round' (green blobs) | 'flowering' (blobs with
// pink, white and yellow flowers). About 0.65 to 0.75 units across and 0.5 to 0.7 tall.
export function makeBush(kind = 'round', seed = 1, size = kind === 'spiky' ? 0.9 : 0.8) {
  const r = rng(seed * 7919 + 29);
  const R = r.range;
  const s = size;
  const g = new THREE.Group();
  if (kind === 'spiky') {
    g.name = 'Grass bush';
    const geo = gradientColors(new THREE.ConeGeometry(0.09, 0.62, 4), 0x6f9a37, 0xbfd86a);
    const m = gradMat(true, 0.9);
    const n = 8 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const b = mesh(geo, m);
      const a = (k / n) * Math.PI * 2 + R(-0.2, 0.2);
      const lean = R(0.3, 0.75);
      b.position.set(Math.cos(a) * 0.12 * s, 0.24 * s, Math.sin(a) * 0.12 * s);
      b.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
      b.scale.setScalar(s * R(0.75, 1.2));
      g.add(b);
    }
    return g;
  }
  g.name = kind === 'flowering' ? 'Flowering bush' : 'Round bush';
  const pal = [0x7aa244, 0xbfd66c];
  for (const [bx, by, bz, br] of [[0, 0.22, 0, 0.3], [0.24, 0.18, 0.08, 0.22], [-0.22, 0.18, -0.06, 0.24], [0.04, 0.36, -0.04, 0.2]]) {
    const b = gradMesh(new THREE.IcosahedronGeometry(br * s, 1), pal[0], pal[1]);
    b.castShadow = b.receiveShadow = true;
    b.position.set(bx * s, by * s, bz * s);
    g.add(b);
  }
  const flowers = kind === 'flowering' ? 5 : 0;
  for (let k = 0; k < flowers; k++) {
    const f = mesh(new THREE.IcosahedronGeometry(0.045 * s, 0), mat(r.pick([0xf3b6c8, 0xfaf5ec, 0xf6dc6e])));
    const a = r() * 6.28;
    const e = R(0.2, 1.1);
    f.position.set(Math.cos(a) * 0.3 * s * Math.cos(e * 0.6), 0.2 * s + Math.sin(e) * 0.25 * s, Math.sin(a) * 0.3 * s);
    g.add(f);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Rocks, hay and farm bits
// ---------------------------------------------------------------------------------------------

// A lumpy grey boulder, sunk into the ground a little like the prototype's (its centre sits
// 0.2 x size below y = 0). size is roughly its radius; the prototype used 0.1 to 0.3.
export function makeRock(seed = 1, size = 0.22) {
  const r = rng(seed * 7919 + 41);
  const R = r.range;
  const g = new THREE.Group();
  g.name = 'Rock';
  const geo = jitter(new THREE.DodecahedronGeometry(1, 1), [0.35, 0.35, 0.35]);
  const m = mesh(geo, mat(r.pick(ISLAND_COLORS.rock)));
  m.scale.set(size * R(0.9, 1.3), size * R(0.55, 0.8), size * R(0.8, 1.1));
  m.rotation.y = r() * 6;
  m.position.y = -size * 0.2;
  g.add(m);
  return g;
}

// A round hay bale lying on its side (axis along z). 0.5 across, 0.5 tall.
export function makeHayBale(seed = 1) {
  const r = rng(seed * 7919 + 53);
  const g = new THREE.Group();
  g.name = 'Hay bale';
  const h = new THREE.Group();
  h.position.y = 0.25;
  h.rotation.y = (r() - 0.5) * 0.6;
  g.add(h);
  const b = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.38, 16), soft(0xe3c46f));
  b.rotation.set(Math.PI / 2, 0, 0);
  h.add(b);
  for (const s of [-1, 1]) {
    const f = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 16), soft(0xd7b55c));
    f.rotation.x = Math.PI / 2;
    f.position.z = s * 0.192;
    h.add(f);
  }
  return g;
}

// Three square bales stacked two-and-one, with twine. 0.82 wide, 0.5 tall.
export function makeHayStack(seed = 1) {
  const r = rng(seed * 7919 + 67);
  const g = new THREE.Group();
  g.name = 'Hay stack';
  const sq = new THREE.Group();
  sq.rotation.y = (r() - 0.5) * 0.4;
  g.add(sq);
  for (const [x, y, z] of [[0, 0.13, 0], [0.42, 0.13, 0], [0.21, 0.38, 0]]) {
    const b = mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3), mat(0xe3c46f));
    b.position.set(x - 0.21, y, z);
    sq.add(b);
    const tw = mesh(new THREE.BoxGeometry(0.41, 0.255, 0.02), mat(0xc9a64f));
    tw.position.set(x - 0.21, y, z + 0.08);
    sq.add(tw);
  }
  return g;
}

// The scarecrow: a pole, a blue shirt, straw hands and a straw hat. 0.8 wide, 1.26 tall.
export function makeScarecrow() {
  const g = new THREE.Group();
  g.name = 'Scarecrow';
  const pole = mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), mat(0x7d5e45));
  pole.position.y = 0.5;
  g.add(pole);
  const arms = mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), mat(0x7d5e45));
  arms.position.y = 0.75;
  g.add(arms);
  const shirt = mesh(new THREE.BoxGeometry(0.32, 0.34, 0.16), mat(0x8fb7c9));
  shirt.position.y = 0.68;
  g.add(shirt);
  for (const s of [-1, 1]) {
    const sl = mesh(new THREE.BoxGeometry(0.2, 0.1, 0.12), mat(0x8fb7c9));
    sl.position.set(s * 0.24, 0.75, 0);
    g.add(sl);
    const st = mesh(new THREE.ConeGeometry(0.04, 0.12, 5), mat(0xe3c46f));
    st.rotation.z = (s * Math.PI) / 2;
    st.position.set(s * 0.38, 0.75, 0);
    g.add(st);
  }
  const head = mesh(new THREE.SphereGeometry(0.12, 14, 10), soft(0xe9dcc0));
  head.position.y = 0.98;
  g.add(head);
  const brim = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 16), soft(0xd9b86a));
  brim.position.y = 1.06;
  g.add(brim);
  const crown = mesh(new THREE.ConeGeometry(0.12, 0.2, 12), soft(0xd9b86a));
  crown.position.y = 1.16;
  g.add(crown);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Fences
// ---------------------------------------------------------------------------------------------

// The paddock fence: square posts about every 0.6 units (0.4 to 0.5 tall, a little crooked)
// with two wooden rails at 0.17 and 0.32.
function fenceRun(group, r, ax, az, bx, bz, endPost) {
  const R = r.range;
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.05) return;
  const postM = mat(0x7d5e45);
  const railM = mat(ISLAND_COLORS.wood, { roughness: 0.8 });
  const n = Math.max(2, Math.round(len / 0.6));
  for (let k = 0; k <= n; k++) {
    if (k === n && !endPost) continue;
    const t = k / n;
    const hh = R(0.4, 0.5);
    const p = mesh(new THREE.BoxGeometry(0.085, hh, 0.085), postM);
    p.position.set(ax + (bx - ax) * t, hh / 2, az + (bz - az) * t);
    p.rotation.set(R(-0.05, 0.05), R(-0.2, 0.2), R(-0.05, 0.05));
    group.add(p);
  }
  for (const y of [0.17, 0.32]) {
    const rail = mesh(new THREE.BoxGeometry(len, 0.05, 0.045), railM);
    rail.position.set((ax + bx) / 2, y, (az + bz) / 2);
    rail.rotation.set(0, -Math.atan2(bz - az, bx - ax), R(-0.03, 0.03));
    group.add(rail);
  }
}

// A short straight run of fence along x, centred on the origin, lengthUnits long.
export function makeFence(lengthUnits = 2.4, seed = 1) {
  const g = new THREE.Group();
  g.name = 'Fence';
  const h = lengthUnits / 2;
  fenceRun(g, rng(seed * 7919 + 79), -h, 0, h, 0, true);
  return g;
}

// A fence that follows a list of {x, z} points (for example a field outline), in the caller's
// coordinates. closed: true joins the last point back to the first. The fence stands at y = 0, so
// for sloped ground place each run yourself with makeFence.
export function makeFenceAlong(points, { closed = false, seed = 1 } = {}) {
  const g = new THREE.Group();
  g.name = 'Fence';
  const r = rng(seed * 7919 + 83);
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    // every run skips its last post (the next run starts there), except the very end of an open fence
    fenceRun(g, r, a.x, a.z, b.x, b.z, !closed && i === count - 1);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Small farmyard props (also from the prototype, for dressing the island)
// ---------------------------------------------------------------------------------------------

// A wooden bench with a back rest, facing +z. 0.6 wide, 0.48 tall.
export function makeBench() {
  const bench = new THREE.Group();
  bench.name = 'Bench';
  const seat = mesh(new THREE.BoxGeometry(0.6, 0.05, 0.2), mat(0xa6815f));
  seat.position.y = 0.24;
  bench.add(seat);
  const back = mesh(new THREE.BoxGeometry(0.6, 0.16, 0.04), mat(0xa6815f));
  back.position.set(0, 0.4, -0.09);
  bench.add(back);
  for (const x of [-0.25, 0.25]) {
    for (const z of [-0.07, 0.07]) {
      const l = mesh(new THREE.BoxGeometry(0.04, 0.24, 0.04), mat(0x7d5e45));
      l.position.set(x, 0.12, z);
      bench.add(l);
    }
  }
  return bench;
}

// A banded wooden barrel. 0.37 across, 0.4 tall at size 1.
export function makeBarrel(size = 1) {
  const s = size;
  const g = new THREE.Group();
  g.name = 'Barrel';
  const b = mesh(new THREE.CylinderGeometry(0.17 * s, 0.15 * s, 0.4 * s, 14), soft(0x9b7556));
  b.position.y = 0.2 * s;
  g.add(b);
  const mid = mesh(new THREE.CylinderGeometry(0.185 * s, 0.185 * s, 0.24 * s, 14), soft(0xa6815f));
  mid.position.y = 0.2 * s;
  g.add(mid);
  for (const yy of [0.06, 0.2, 0.34]) {
    const h = mesh(new THREE.TorusGeometry(0.18 * s, 0.012 * s, 6, 18), soft(0x5e5550));
    h.rotation.x = Math.PI / 2;
    h.position.y = yy * s;
    g.add(h);
  }
  return g;
}

// A slatted crate with a diagonal brace. 0.36 across, 0.3 tall at size 1.
export function makeCrate(size = 1) {
  const s = size;
  const g = new THREE.Group();
  g.name = 'Crate';
  const b = mesh(new THREE.BoxGeometry(0.34 * s, 0.3 * s, 0.34 * s), mat(0xb08a64));
  b.position.y = 0.15 * s;
  g.add(b);
  for (const yy of [0.03, 0.27]) {
    const e = mesh(new THREE.BoxGeometry(0.36 * s, 0.04 * s, 0.36 * s), mat(0x8d6a4b));
    e.position.y = yy * s;
    g.add(e);
  }
  const dg = mesh(new THREE.BoxGeometry(0.4 * s, 0.035 * s, 0.02 * s), mat(0x8d6a4b));
  dg.position.set(0, 0.15 * s, 0.175 * s);
  dg.rotation.z = 0.7;
  g.add(dg);
  return g;
}

// A black lamp post with a glowing lantern and its own small light. 1.64 tall.
export function makeLampPost() {
  const g = new THREE.Group();
  g.name = 'Lamp post';
  const ironM = soft(0x4b4038);
  const base = mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.15, 8), ironM);
  base.position.y = 0.07;
  g.add(base);
  const p = mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.3, 8), ironM);
  p.position.y = 0.72;
  g.add(p);
  const cap = mesh(new THREE.ConeGeometry(0.13, 0.12, 4), ironM);
  cap.position.y = 1.58;
  cap.rotation.y = Math.PI / 4;
  g.add(cap);
  const glass = mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), glowMat(0xfff2cf, 0xffcf73, 1.2), false, false);
  glass.position.y = 1.44;
  g.add(glass);
  for (const [dx, dz] of [[-0.085, -0.085], [0.085, -0.085], [-0.085, 0.085], [0.085, 0.085]]) {
    const f = mesh(new THREE.BoxGeometry(0.025, 0.22, 0.025), ironM);
    f.position.set(dx, 1.44, dz);
    g.add(f);
  }
  const l = glowLight(0xffd38a, 0.9, 3.2);
  l.position.y = 1.4;
  g.add(l);
  return g;
}

// A red mailbox on a post with a yellow flag. 0.8 tall.
export function makeMailbox() {
  const g = new THREE.Group();
  g.name = 'Mailbox';
  const post = mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), mat(0x6e5139));
  post.position.y = 0.3;
  g.add(post);
  const box = mesh(new THREE.BoxGeometry(0.18, 0.14, 0.28), soft(0xd0604c));
  box.position.y = 0.66;
  g.add(box);
  const top = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.28, 14, 1, false, 0, Math.PI), soft(0xd0604c));
  top.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  top.position.y = 0.73;
  g.add(top);
  const flag = mesh(new THREE.BoxGeometry(0.02, 0.14, 0.06), soft(0xf6dc6e));
  flag.position.set(0.1, 0.78, -0.06);
  g.add(flag);
  return g;
}

// A post with two pointing boards. 1.0 tall.
export function makeSignpost() {
  const g = new THREE.Group();
  g.name = 'Signpost';
  const post = mesh(new THREE.BoxGeometry(0.07, 1.0, 0.07), mat(0x7d5e45));
  post.position.y = 0.5;
  g.add(post);
  for (const [y, ry, c] of [[0.85, 0.3, 0xe9dfcc], [0.65, -2.6, 0xd9c7a8]]) {
    const b = mesh(new THREE.BoxGeometry(0.5, 0.13, 0.04), mat(c));
    b.position.set(Math.cos(ry) * 0.2, y, -Math.sin(ry) * 0.2);
    b.rotation.y = ry;
    g.add(b);
  }
  return g;
}

// A wheelbarrow full of hay, wheel towards +x. About 0.95 long, 0.5 tall.
export function makeWheelbarrow() {
  const g = new THREE.Group();
  g.name = 'Wheelbarrow';
  const tray = mesh(new THREE.BoxGeometry(0.5, 0.18, 0.36), mat(0xa6815f));
  tray.position.y = 0.3;
  tray.rotation.z = 0.08;
  g.add(tray);
  const hay = mesh(new THREE.IcosahedronGeometry(0.2, 1), mat(0xe3c46f));
  hay.scale.set(1.2, 0.6, 0.8);
  hay.position.y = 0.42;
  g.add(hay);
  const wheel = mesh(new THREE.TorusGeometry(0.11, 0.035, 8, 16), soft(0x5e5550));
  wheel.position.set(0.32, 0.12, 0);
  g.add(wheel);
  for (const s of [-1, 1]) {
    const h = mesh(new THREE.BoxGeometry(0.5, 0.035, 0.035), mat(0x7d5e45));
    h.position.set(-0.35, 0.32, s * 0.15);
    h.rotation.z = -0.25;
    g.add(h);
    const leg = mesh(new THREE.BoxGeometry(0.035, 0.25, 0.035), mat(0x7d5e45));
    leg.position.set(-0.15, 0.12, s * 0.14);
    g.add(leg);
  }
  return g;
}

// A little pyramid of split logs. 0.5 long, 0.38 tall.
export function makeFirewood(seed = 1) {
  const r = rng(seed * 7919 + 97);
  const g = new THREE.Group();
  g.name = 'Firewood';
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 4 - row; k++) {
      const z = (k - (3 - row) / 2) * 0.14;
      const lg = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), soft(r.pick([0x9b7556, 0x8a6a4f, 0xa98363])));
      lg.rotation.z = Math.PI / 2;
      lg.position.set(0, 0.07 + row * 0.12, z);
      g.add(lg);
      const end = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 8), soft(0xe0c79e));
      end.rotation.z = Math.PI / 2;
      end.position.set(0.255, 0.07 + row * 0.12, z);
      g.add(end);
    }
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Sheep (Manami's Blender model, recoloured for the flock)
// ---------------------------------------------------------------------------------------------

const templateCache = new Map();

// Load manami.glb once and normalise it like the prototype: centred over the origin, feet at
// y = 0, exactly 1 unit tall, every mesh casting and receiving shadows. Resolves to a Group to
// pass to makeSheep(). Repeat calls with the same url share one download.
const SHEEP_DETAIL = 64; // grid cells across the sheep's height when simplifying it

const triangleCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/**
 * A lighter copy of a smooth, untextured mesh (position and normal only), by vertex clustering:
 * vertices in the same grid cell that face the same way are merged into one (their average), and
 * triangles that collapse are dropped. With keepSides, the facing direction is part of the key
 * too, so the front and back of a thin shell (the face mask) don't fold together; leave it off for
 * thick, bumpy parts (the wool), which then merge much further. Normals are rebuilt, smooth.
 * @param {THREE.BufferGeometry} geometry
 * @param {number} cell  grid size, in the geometry's own units
 * @param {{ keepSides?: boolean }} [opts]
 */
export function simplifyGeometry(geometry, cell, { keepSides = false } = {}) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const n = pos.count;
  const remap = new Uint32Array(n);
  const keys = new Map();
  const sums = []; // x, y, z, count per new vertex
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let face = 0;
    if (nor && keepSides) {
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      face = ax >= ay && ax >= az ? (nx > 0 ? 1 : 2) : ay >= az ? (ny > 0 ? 3 : 4) : (nz > 0 ? 5 : 6);
    }
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)},${face}`;
    let k = keys.get(key);
    if (k === undefined) {
      k = sums.length / 4;
      keys.set(key, k);
      sums.push(0, 0, 0, 0);
    }
    sums[k * 4] += x; sums[k * 4 + 1] += y; sums[k * 4 + 2] += z; sums[k * 4 + 3]++;
    remap[i] = k;
  }
  const m = sums.length / 4;
  const out = new Float32Array(m * 3);
  for (let k = 0; k < m; k++) {
    const c = sums[k * 4 + 3];
    out[k * 3] = sums[k * 4] / c; out[k * 3 + 1] = sums[k * 4 + 1] / c; out[k * 3 + 2] = sums[k * 4 + 2] / c;
  }
  const src = geometry.index;
  const tris = src ? src.count / 3 : n / 3;
  const idx = [];
  const seen = new Set();
  for (let t = 0; t < tris; t++) {
    const a = remap[src ? src.getX(t * 3) : t * 3];
    const b = remap[src ? src.getX(t * 3 + 1) : t * 3 + 1];
    const c = remap[src ? src.getX(t * 3 + 2) : t * 3 + 2];
    if (a === b || b === c || a === c) continue; // collapsed
    // the same triangle twice (two cells' worth of small triangles folding together)
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
    const key = (lo * m + mid) * m + hi; // exact while m³ < 2^53 (m is at most a few hundred thousand)
    if (seen.has(key)) continue;
    seen.add(key);
    idx.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setIndex(m > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function loadSheepTemplate(url = asset('/models/manami.glb')) {
  if (!templateCache.has(url)) {
    const job = new GLTFLoader().loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const tpl = new THREE.Group();
      tpl.name = 'Sheep template';
      const inner = new THREE.Group();
      tpl.add(inner);
      inner.add(root);
      root.position.set(-c.x, -box.min.y, -c.z);
      inner.scale.setScalar(1 / size.y);
      // The model is sculpted at about 195k triangles; on the island a sheep is a few dozen pixels
      // tall, so it's simplified once here (to about a third; the curly wool keeps the most) so a
      // 15-field farm with seven sheep stays at 60 fps.
      const cell = size.y / SHEEP_DETAIL;
      root.traverse((o) => {
        if (o.isMesh) {
          // the grid in the mesh's own units (the model's nodes carry their own scale)
          if (triangleCount(o.geometry) > 2500) o.geometry = simplifyGeometry(o.geometry, cell / o.matrixWorld.getMaxScaleOnAxis(), { keepSides: !/wool/i.test(o.name) });
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      return tpl;
    });
    // forget a failed load so a later call can try again
    job.catch(() => templateCache.delete(url));
    templateCache.set(url, job);
  }
  return templateCache.get(url);
}

const woolMats = new Map();

// A sheep cloned from the template. wool: a SHEEP_WOOL name ('black' is Manami and keeps her own
// wool) or any colour number. pose: 'stand' | 'graze' (head down) | 'sit' | 'sleep' (sitting,
// eyes squashed shut). The wool material also colours the ears, as in the prototype.
// Size: Manami (black) is 0.8 units tall and the others 0.62, the prototype's sizes next to its
// 2.3-unit barn; pass scale to change it (the prototype's lambs were 0.42).
// userData.body is the part to tilt for grazing, as the prototype's walking code did:
// body.rotation.x = 0.32 * t; body.position.set(0, -0.06 * t, 0.05 * t) for t from 0 to 1.
export function makeSheep(template, { wool = 'black', pose = 'stand', scale } = {}) {
  const manami = wool === 'black';
  const color = typeof wool === 'number' ? wool : SHEEP_WOOL[wool] ?? SHEEP_WOOL.cream;
  const size = scale ?? (manami ? 0.8 : 0.62);

  const g = new THREE.Group();
  g.name = manami ? 'Manami' : 'Sheep';
  const sized = new THREE.Group();
  sized.scale.setScalar(size);
  g.add(sized);
  const body = template.clone(true);
  sized.add(body);

  body.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m && m.name === 'Manami wool' && !manami) {
      if (!woolMats.has(color)) {
        const w = m.clone();
        w.color.set(color);
        w.roughness = 0.75;
        woolMats.set(color, w);
      }
      o.material = woolMats.get(color);
    }
    if (pose === 'sleep' && /Eye/.test(o.name)) o.scale.y *= 0.14;
  });
  if (pose === 'graze') {
    body.rotation.x = 0.22;
    body.position.set(0, -0.04, 0.04);
  }
  if (pose === 'sit' || pose === 'sleep') body.position.y = -0.06;

  g.userData.body = body;
  g.userData.pose = pose;
  g.userData.scale = size;
  return g;
}

// ---------------------------------------------------------------------------------------------
// Dock and rowboat (ported from the prototype's "dock and boat in the cove")

/**
 * A little wooden jetty. Its landward end is at the origin and it runs out along +z (about 1.9
 * units); y = 0 is the water line. Planks, two stringers, posts down into the water, a mooring
 * post with a coil of rope, and a blue bucket.
 */
export function makeDock(seed = 3) {
  const r = rng(seed);
  const R = (a, b) => a + (b - a) * r();
  const pick = (list) => list[Math.floor(r() * list.length)];
  const dock = new THREE.Group();
  dock.name = 'Dock';
  for (let k = 0; k < 9; k++) {
    const p = mesh(new THREE.BoxGeometry(1.15, 0.07, 0.2), mat(pick([0xa8876b, 0x9c7c61, 0xb18f72])));
    p.position.set(R(-0.03, 0.03), 0.2, k * 0.215);
    p.rotation.y = R(-0.03, 0.03);
    dock.add(p);
  }
  for (const x of [-0.52, 0.52]) {
    const b = mesh(new THREE.BoxGeometry(0.08, 0.06, 1.95), mat(0x7d5e45));
    b.position.set(x, 0.14, 0.86);
    dock.add(b);
  }
  for (const [x, z] of [[-0.55, 0.05], [0.55, 0.05], [-0.55, 0.95], [0.55, 0.95], [-0.55, 1.75], [0.55, 1.75]]) {
    const p = mesh(new THREE.CylinderGeometry(0.065, 0.07, 1.0, 8), soft(0x7d5e45));
    p.position.set(x, -0.25, z);
    dock.add(p);
  }
  const moor = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.35, 10), soft(0x6e5139));
  moor.position.set(0.5, 0.38, 1.7);
  dock.add(moor);
  const rope = mesh(new THREE.TorusGeometry(0.09, 0.018, 6, 14), soft(0xe0cfa8));
  rope.rotation.x = Math.PI / 2;
  rope.position.set(0.5, 0.5, 1.7);
  dock.add(rope);
  const bucket = mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.14, 12), soft(0x8fb7c9));
  bucket.position.set(-0.35, 0.31, 0.4);
  dock.add(bucket);
  dock.userData.length = 1.9;
  return dock;
}

/**
 * The rowboat: an oval hull, seat, two oars and a fishing rod. y = 0 is the water line; it sits
 * a touch above it. userData.seat = where a sheep sits ({ x, y, z, ry }).
 */
export function makeRowboat() {
  const boat = new THREE.Group();
  boat.name = 'Boat';
  const hull = mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.24, 12, 1), soft(0x8f6c51));
  hull.scale.set(1.9, 1, 1);
  hull.position.y = 0.08;
  boat.add(hull);
  const inner = mesh(new THREE.CylinderGeometry(0.36, 0.26, 0.05, 12), soft(0x6e5139));
  inner.scale.set(1.85, 1, 1);
  inner.position.y = 0.18;
  boat.add(inner);
  const rim = mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 24), soft(0xa98363));
  rim.scale.set(1.9, 1, 1);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.2;
  boat.add(rim);
  const seat = mesh(new THREE.BoxGeometry(0.12, 0.04, 0.62), mat(0xc6a27f));
  seat.position.set(0.1, 0.2, 0);
  boat.add(seat);
  for (const sgn of [-1, 1]) {
    const oar = mesh(new THREE.BoxGeometry(0.9, 0.025, 0.04), mat(0xa98363));
    oar.position.set(0, 0.22, sgn * 0.45);
    oar.rotation.set(0, sgn * 0.25, 0.12);
    boat.add(oar);
    const blade = mesh(new THREE.BoxGeometry(0.2, 0.02, 0.1), mat(0xa98363));
    blade.position.set(-0.45, 0.17, sgn * 0.56);
    blade.rotation.y = sgn * 0.25;
    boat.add(blade);
  }
  const rod = mesh(new THREE.CylinderGeometry(0.008, 0.01, 1.0, 5), soft(0x7d5e45));
  rod.position.set(0.5, 0.5, 0.15);
  rod.rotation.z = -0.9;
  boat.add(rod);
  boat.userData.seat = { x: -0.15, y: 0.12, z: 0, ry: 1.9 };
  return boat;
}

// ---------------------------------------------------------------------------------------------
// Draw-call budget

/**
 * Merges a finished, static prop into one mesh per material (in place). The props are built from
 * many small parts (the barn's roof alone is ~200 shingles), and every part is a draw call, twice
 * with shadows; merged, a 15-field island draws in a few hundred calls instead of over a thousand.
 * Parts in `keep` (and everything under them) stay as they are, for things that move (windmill
 * blades). InstancedMeshes, skinned or morphing meshes, mirrored parts and hidden parts are left
 * alone. Shared geometries are copied, never changed. Returns root.
 * @param {THREE.Object3D} root
 * @param {{ keep?: THREE.Object3D[] }} [opts]
 */
export function mergeStatic(root, { keep = [] } = {}) {
  const kept = new Set(keep.filter(Boolean));
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const buckets = new Map(); // material + shadow flags -> parts
  const walk = (o) => {
    if (kept.has(o) || !o.visible) return;
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && !Object.keys(o.geometry.morphAttributes || {}).length) {
      m.multiplyMatrices(toRoot, o.matrixWorld);
      if (m.determinant() > 0) {
        const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ o, matrix: m.clone() });
      }
    }
    o.children.forEach(walk);
  };
  walk(root);
  for (const parts of buckets.values()) {
    if (parts.length < 2) continue;
    const mat = parts[0].o.material;
    const want = ['position', 'normal'];
    if (mat.map || mat.normalMap || mat.roughnessMap || mat.aoMap) want.push('uv');
    if (mat.vertexColors) want.push('color');
    const geos = [];
    const used = [];
    for (const { o, matrix } of parts) {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!want.every((k) => g.attributes[k])) { g.dispose(); continue; }
      for (const k of Object.keys(g.attributes)) if (!want.includes(k)) g.deleteAttribute(k);
      g.morphAttributes = {};
      g.clearGroups();
      g.applyMatrix4(matrix);
      geos.push(g);
      used.push(o);
    }
    if (geos.length < 2) { geos.forEach((g) => g.dispose()); continue; }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const one = new THREE.Mesh(merged, mat);
    one.name = `${root.name || 'prop'} (merged)`;
    one.castShadow = used[0].castShadow;
    one.receiveShadow = used[0].receiveShadow;
    one.renderOrder = used[0].renderOrder;
    used.forEach((o) => o.parent?.remove(o));
    root.add(one);
  }
  // drop the groups the merge emptied
  const prune = (o) => {
    [...o.children].forEach(prune);
    if (o !== root && !kept.has(o) && !o.isMesh && o.type === 'Group' && o.children.length === 0) o.parent?.remove(o);
  };
  prune(root);
  return root;
}
