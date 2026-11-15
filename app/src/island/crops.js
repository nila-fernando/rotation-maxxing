// Low-poly US crops for the farm island.
//
// Built in the same style as the prototype island (team-sheeeep-assets/team-sheeeep-3d):
// flat-shaded MeshStandardMaterial, a few colour variants per part, chunky proportions.
// Scene units match the prototype: the barn is about 1.2 units tall, corn about 0.65.
//
// plantField() fills field polygons with plants in straight rows. Each plant part (stalk,
// leaf, tassel, ...) is one InstancedMesh for the whole field, so a 15-field farm stays at
// a few dozen draw calls. The geometries and materials are shared between fields (cached
// below), so do not dispose them when removing one field; calling mesh.dispose() on the
// InstancedMeshes is enough.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------- crop keys and names ----------

export const CROP_KEYS = [
  'corn', 'soybeans', 'wheat', 'barley', 'oats', 'sorghum',
  'alfalfa', 'hay', 'pasture', 'fallow', 'other',
];

// soil = colour of the field's top surface under the plants; sides = the slab's side faces.
export const CROP_STYLE = {
  corn:     { label: 'Corn',          soil: 0x9a7656, sides: 0x7d5e45 },
  soybeans: { label: 'Soybeans',      soil: 0x977352, sides: 0x7a5b43 },
  wheat:    { label: 'Wheat',         soil: 0xb39561, sides: 0x8f7249 },
  barley:   { label: 'Barley',        soil: 0xb79d66, sides: 0x92784d },
  oats:     { label: 'Oats',          soil: 0xad9d6c, sides: 0x8a7a52 },
  sorghum:  { label: 'Sorghum',       soil: 0x9d7756, sides: 0x7f5f45 },
  alfalfa:  { label: 'Alfalfa',       soil: 0x8ea750, sides: 0x7d6a4c },
  hay:      { label: 'Hay',           soil: 0xbfb170, sides: 0x8f7b52 },
  pasture:  { label: 'Pasture',       soil: 0xaab25b, sides: 0x8a7a55 },
  fallow:   { label: 'Fallow',        soil: 0x9c7a58, sides: 0x7d5e45 },
  other:    { label: 'Cover crop',    soil: 0x8c9f50, sides: 0x7b6a4b },
};

// Words to look for in a crop name, checked in this order (first match wins). The order
// matters: "Other Hay/Non Alfalfa" must hit 'hay' before 'alfalfa', "Buckwheat" must not
// become wheat.
const NAME_RULES = [
  ['other',    /buckwheat/],
  ['fallow',   /fallow|idle|barren|tilled|bare/],
  ['hay',      /\bhay\b/],
  ['alfalfa',  /alfalfa/],
  ['sorghum',  /sorghum|milo|millet/],
  ['corn',     /corn|maize/],
  ['soybeans', /soy|\bbeans?\b|\bpeas?\b|lentil|chick ?peas/],
  ['barley',   /barley/],
  ['oats',     /\boats?\b/],
  ['wheat',    /wheat|\bwht\b|winwht|rye|triticale|durum|spelt/],
  ['pasture',  /pasture|grass|clover|wildflower|\bsod\b|meadow|range/],
];

/**
 * Map a crop name to one of CROP_KEYS. Accepts USDA Cropland Data Layer names
 * ("Winter Wheat", "Other Hay/Non Alfalfa", "Dbl Crop WinWht/Soybeans", ...) and the app's
 * simple keys ('corn', 'soybeans', 'hay', ...), any case. Unknown -> 'other'.
 */
export function cropKeyFor(name) {
  if (name == null) return 'other';
  let s = String(name).trim().toLowerCase();
  if (CROP_KEYS.includes(s)) return s;
  // A double crop ("Dbl Crop WinWht/Soybeans") lists the earlier crop first; show the later one.
  if (s.startsWith('dbl crop')) s = s.slice(8).split('/').pop().trim();
  for (const [key, re] of NAME_RULES) if (re.test(s)) return key;
  return 'other';
}

// ---------- small helpers ----------

// Seeded random numbers (same generator as the prototype), so a field always looks the same.
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Paint a geometry with grey vertex colours, darker at the bottom and full white at the top.
// The material multiplies this with each instance's colour, so plants get a soft
// dark-to-light gradient like the prototype's trees.
function shade(geo, bottom = 0.72) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const f = (p.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
    c.fill(bottom + (1 - bottom) * f, i * 3, i * 3 + 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// Merge several geometries into one (all made non-indexed so the attributes match).
function merge(list) {
  const flat = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    return n;
  });
  const out = mergeGeometries(flat);
  out.computeVertexNormals();
  return out;
}

const _v = new THREE.Vector3();
const _e = new THREE.Euler();
// Where the top of a leaning stalk ends up: (0, len, 0) rotated by (rx, 0, rz).
function tip(len, rx, rz) {
  return _v.set(0, len, 0).applyEuler(_e.set(rx, 0, rz));
}

// ---------- part geometries (base of each part sits at the origin) ----------

// A flat leaf blade that widens then tapers, with a bend in the middle so it arches.
function archedLeaf(len = 0.34, width = 0.04, bend = 0.75) {
  const h = len / 2;
  const a = new THREE.CylinderGeometry(width * 0.8, width * 0.3, h, 3, 1).translate(0, h / 2, 0);
  const b = new THREE.ConeGeometry(width * 0.8, h, 3, 1).translate(0, h / 2, 0)
    .rotateZ(-bend).translate(0, h, 0);
  return merge([a, b]).scale(1, 1, 0.32);
}
// A straight flat blade (cone squashed flat).
function blade(len, width) {
  return new THREE.ConeGeometry(width, len, 3, 1).translate(0, len / 2, 0).scale(1, 1, 0.35);
}
// A small fan of thin cones, like a tassel, awns or a grass tuft.
function fan(n, len, radius, spread, jitter = 0) {
  const r = rng(n * 97 + 3);
  const parts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const l = len * (1 - jitter * r());
    const g = new THREE.ConeGeometry(radius, l, 4, 1).translate(0, l / 2, 0);
    const lean = k === 0 && n > 3 ? 0 : spread;
    g.rotateX(Math.sin(a) * lean).rotateZ(-Math.cos(a) * lean);
    parts.push(g);
  }
  return merge(parts);
}
// An oat panicle: a short stem with little spikelets hanging off it.
function oatPanicle() {
  const parts = [new THREE.CylinderGeometry(0.004, 0.006, 0.15, 3, 1).translate(0, 0.075, 0)];
  for (let i = 0; i < 6; i++) {
    const y = 0.035 + i * 0.02;
    const side = i % 2 ? 1 : -1;
    const s = new THREE.OctahedronGeometry(0.017, 0).scale(1, 1.9, 1)
      .translate(0, -0.026, 0).rotateZ(side * (0.5 + i * 0.05)).rotateY(i * 1.3)
      .translate(0, y, 0);
    parts.push(s);
  }
  return merge(parts);
}
// A sorghum seed head: a lumpy upright cluster.
function sorghumHead() {
  const g = new THREE.IcosahedronGeometry(0.05, 1);
  const p = g.attributes.position;
  const r = rng(77);
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (r() - 0.5) * 0.25;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.scale(0.85, 1.55, 0.85).translate(0, 0.07, 0);
  return merge([g]);
}
// A tilled ridge: a low triangular prism, 1 unit long along x (stretched per plant).
function ridge() {
  const shape = new THREE.Shape([
    new THREE.Vector2(-0.075, 0), new THREE.Vector2(0.075, 0), new THREE.Vector2(0, 0.055),
  ]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5).rotateY(Math.PI / 2);
  return merge([g]);
}

// ---------- crop designs ----------
//
// Each crop says how its plants are laid out and how one plant is built:
//   spacing  distance between plants along a row (scene units)
//   rowGap   distance between rows, as a multiple of spacing
//   jitter   [along, across] random nudge, as a fraction of the spacing
//   stagger  shift every other row by half a plant (looks broadcast-sown instead of drilled)
//   inset    keep plants this far inside the field edge
//   yaw      'random' = each plant turned randomly, 'row' = plants follow the row
//   parts    part name -> { geo, shade } (shade = how dark the bottom of the part is)
//   plant(r, add, info)  calls add(part, x, y, z, rx, ry, rz, sx, sy, sz, colour) for each
//                        piece of one plant, in plant space (base at the origin, y up).
//                        r() is a seeded random in 0..1, info = { row, col, spacing }.

const pick = (r, a) => a[Math.floor(r() * a.length)];
const R = (r, a, b) => a + (b - a) * r();

const CROPS = {
  corn: {
    spacing: 0.24, rowGap: 1.5, jitter: [0.12, 0.08], inset: 0.12, yaw: 'random',
    parts: {
      stalk: { geo: () => new THREE.CylinderGeometry(0.014, 0.026, 0.6, 5, 1).translate(0, 0.3, 0), shade: 0.65 },
      leaf: { geo: () => archedLeaf(0.34, 0.042, 0.8), shade: 0.75 },
      tassel: { geo: () => fan(5, 0.11, 0.009, 0.5, 0.3), shade: 0.85 },
      ear: { geo: () => new THREE.SphereGeometry(0.03, 5, 4).scale(1, 2.3, 1).translate(0, 0.069, 0), shade: 0.85 },
    },
    plant(r, add) {
      const h = R(r, 0.88, 1.1);
      add('stalk', 0, 0, 0, R(r, -0.04, 0.04), 0, R(r, -0.04, 0.04), 1, h, 1, pick(r, [0x7ea446, 0x89ad4c, 0x749c40]));
      const leafCol = pick(r, [0x76a03f, 0x84ad4a, 0x6d9a3c]);
      for (let k = 0; k < 4; k++) {
        const s = 1 - k * 0.12;
        add('leaf', 0, (0.1 + k * 0.11) * h, 0, 0, k * 2.6 + R(r, -0.3, 0.3), -R(r, 0.45, 0.7), s, s, s, leafCol);
      }
      add('tassel', 0, 0.59 * h, 0, 0, R(r, 0, 6), 0, 1, R(r, 0.9, 1.2), 1, pick(r, [0xd9c27a, 0xe2cf8f, 0xcdb46a]));
      if (r() < 0.8) add('ear', 0.02, 0.26 * h, 0, 0, 0, -0.38, 1, 1, 1, pick(r, [0xc8cf78, 0xd4d886, 0xbfc56d]));
    },
  },

  soybeans: {
    spacing: 0.16, rowGap: 1.9, jitter: [0.12, 0.05], inset: 0.1, yaw: 'random',
    parts: {
      blob: { geo: () => new THREE.IcosahedronGeometry(0.075, 0), shade: 0.7 },
    },
    plant(r, add) {
      const s = R(r, 0.85, 1.12);
      const base = [0x6f9b3e, 0x7aa645, 0x86b04f];
      for (const [x, y, z, k] of [[0, 0.09, 0, 1.1], [0.06, 0.06, 0.03, 0.85], [-0.055, 0.065, -0.035, 0.9], [0.01, 0.06, 0.07, 0.8], [0.01, 0.155, -0.01, 0.75]]) {
        const q = k * s;
        add('blob', x * s, y * s, z * s, R(r, 0, 3), R(r, 0, 3), 0, q, q * 0.85, q, pick(r, base));
      }
    },
  },

  wheat: {
    spacing: 0.18, rowGap: 1.05, jitter: [0.2, 0.1], inset: 0.07, yaw: 'random',
    parts: {
      stalk: { geo: () => new THREE.CylinderGeometry(0.006, 0.01, 0.4, 4, 1).translate(0, 0.2, 0), shade: 0.7 },
      head: { geo: () => new THREE.SphereGeometry(0.04, 6, 4).scale(0.42, 1.35, 0.42).translate(0, 0.054, 0), shade: 0.82 },
      leaf: { geo: () => blade(0.16, 0.018), shade: 0.7 },
    },
    plant(r, add) {
      const stalkCol = pick(r, [0xc9a65e, 0xd2b068, 0xbf9c55]);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + R(r, 0, 1);
        const ox = Math.cos(a) * 0.03, oz = Math.sin(a) * 0.03;
        const rx = R(r, -0.13, 0.13), rz = R(r, -0.13, 0.13), h = R(r, 0.88, 1.1);
        const t = tip(0.4 * h, rx, rz);
        add('stalk', ox, 0, oz, rx, 0, rz, 1, h, 1, stalkCol);
        add('head', ox + t.x, t.y, oz + t.z, rx, 0, rz, 1, 1, 1, pick(r, [0xe3c27a, 0xe9cd86, 0xd8b66a]));
      }
      for (let k = 0; k < 2; k++) add('leaf', 0, 0, 0, 0, R(r, 0, 6), -R(r, 0.6, 0.9), 1, 1, 1, pick(r, [0xc6a75f, 0xb99a55]));
    },
  },

  barley: {
    spacing: 0.18, rowGap: 1.05, jitter: [0.2, 0.1], inset: 0.07, yaw: 'random',
    parts: {
      stalk: { geo: () => new THREE.CylinderGeometry(0.006, 0.01, 0.36, 4, 1).translate(0, 0.18, 0), shade: 0.7 },
      head: { geo: () => new THREE.SphereGeometry(0.038, 6, 4).scale(0.45, 1.3, 0.45).translate(0, 0.049, 0), shade: 0.85 },
      awns: { geo: () => fan(6, 0.15, 0.0035, 0.18, 0.25), shade: 0.9 },
    },
    plant(r, add) {
      const stalkCol = pick(r, [0xcdb06c, 0xd6bb78, 0xc4a764]);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + R(r, 0, 1);
        const ox = Math.cos(a) * 0.03, oz = Math.sin(a) * 0.03;
        const rx = R(r, -0.12, 0.12), rz = R(r, -0.12, 0.12), h = R(r, 0.88, 1.1);
        const t = tip(0.36 * h, rx, rz);
        add('stalk', ox, 0, oz, rx, 0, rz, 1, h, 1, stalkCol);
        // ripe barley heads nod over to one side, bristling with long awns
        const nod = rz - R(r, 0.45, 0.7);
        add('head', ox + t.x, t.y, oz + t.z, rx, 0, nod, 1, 1, 1, pick(r, [0xe0cf8c, 0xd8c47a, 0xe8d9a0]));
        add('awns', ox + t.x, t.y, oz + t.z, rx, 0, nod, 1, 1, 1, pick(r, [0xeadba6, 0xf0e2b2]));
      }
    },
  },

  oats: {
    spacing: 0.19, rowGap: 1.05, jitter: [0.2, 0.1], inset: 0.07, yaw: 'random',
    parts: {
      stalk: { geo: () => new THREE.CylinderGeometry(0.006, 0.01, 0.34, 4, 1).translate(0, 0.17, 0), shade: 0.7 },
      panicle: { geo: oatPanicle, shade: 0.9 },
      leaf: { geo: () => blade(0.15, 0.02), shade: 0.7 },
    },
    plant(r, add) {
      const stalkCol = pick(r, [0xb4b873, 0xa9b06a, 0xbcbd7c]);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + R(r, 0, 1);
        const ox = Math.cos(a) * 0.03, oz = Math.sin(a) * 0.03;
        const rx = R(r, -0.14, 0.14), rz = R(r, -0.14, 0.14), h = R(r, 0.85, 1.1);
        const t = tip(0.34 * h, rx, rz);
        add('stalk', ox, 0, oz, rx, 0, rz, 1, h, 1, stalkCol);
        add('panicle', ox + t.x, t.y, oz + t.z, rx, R(r, 0, 6), rz - R(r, 0.25, 0.55), 1, 1, 1, pick(r, [0xd8cf92, 0xcdc486, 0xe0d69c]));
      }
      for (let k = 0; k < 2; k++) add('leaf', 0, 0, 0, 0, R(r, 0, 6), -R(r, 0.6, 0.9), 1, 1, 1, pick(r, [0xa9b26a, 0xb5bb78]));
    },
  },

  sorghum: {
    spacing: 0.23, rowGap: 1.45, jitter: [0.12, 0.08], inset: 0.11, yaw: 'random',
    parts: {
      stalk: { geo: () => new THREE.CylinderGeometry(0.015, 0.024, 0.46, 5, 1).translate(0, 0.23, 0), shade: 0.65 },
      leaf: { geo: () => archedLeaf(0.3, 0.045, 0.9), shade: 0.75 },
      head: { geo: sorghumHead, shade: 0.75 },
    },
    plant(r, add) {
      const h = R(r, 0.88, 1.1);
      add('stalk', 0, 0, 0, R(r, -0.04, 0.04), 0, R(r, -0.04, 0.04), 1, h, 1, pick(r, [0x86a54c, 0x93ad55, 0x7d9b46]));
      const leafCol = pick(r, [0x7c9e48, 0x88a851, 0x739642]);
      for (let k = 0; k < 3; k++) {
        const s = 1 - k * 0.1;
        add('leaf', 0, (0.08 + k * 0.11) * h, 0, 0, k * 2.4 + R(r, -0.3, 0.3), -R(r, 0.5, 0.75), s, s, s, leafCol);
      }
      add('head', 0, 0.45 * h, 0, R(r, -0.12, 0.12), R(r, 0, 6), R(r, -0.12, 0.12), 1, R(r, 0.9, 1.15), 1, pick(r, [0xa4553a, 0xb3653f, 0x96492f, 0xb8703f]));
    },
  },

  alfalfa: {
    spacing: 0.17, rowGap: 1.05, jitter: [0.35, 0.3], stagger: true, inset: 0.08, yaw: 'random',
    parts: {
      blob: { geo: () => new THREE.IcosahedronGeometry(0.05, 0), shade: 0.68 },
      flower: { geo: () => new THREE.IcosahedronGeometry(0.022, 0), shade: 0.9 },
    },
    plant(r, add) {
      const s = R(r, 0.85, 1.15);
      const green = [0x6e9e3f, 0x7dab49, 0x5f913a];
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3 + R(r, 0, 0.6), d = k ? R(r, 0.03, 0.07) : 0;
        const q = s * R(r, 0.8, 1.15);
        add('blob', Math.cos(a) * d * s, (k ? R(r, 0.045, 0.09) : 0.12) * s, Math.sin(a) * d * s, R(r, 0, 3), R(r, 0, 3), 0, q, q * 0.9, q, pick(r, green));
      }
      const flowers = 2 + Math.floor(r() * 3);
      for (let k = 0; k < flowers; k++) {
        const a = R(r, 0, 6.28), d = R(r, 0.01, 0.06);
        add('flower', Math.cos(a) * d * s, R(r, 0.15, 0.2) * s, Math.sin(a) * d * s, 0, R(r, 0, 3), 0, 1, 1.3, 1, pick(r, [0x9b7fd0, 0xb092dc, 0x8a72c6, 0xa98ad8]));
      }
    },
  },

  hay: {
    spacing: 0.12, rowGap: 1.5, jitter: [0.3, 0.15], inset: 0.13, yaw: 'random',
    parts: {
      stubble: { geo: () => fan(7, 0.1, 0.015, 0.32, 0.45), shade: 0.7 },
      bale: { geo: () => new THREE.CylinderGeometry(0.12, 0.12, 0.17, 10, 1).rotateX(Math.PI / 2).translate(0, 0.12, 0), shade: 0.85 },
      baleEnd: { geo: () => new THREE.CylinderGeometry(0.098, 0.098, 0.174, 10, 1).rotateX(Math.PI / 2).translate(0, 0.12, 0), shade: 1 },
    },
    plant(r, add, info) {
      add('stubble', 0, 0, 0, 0, R(r, 0, 6), 0, R(r, 0.8, 1.2), R(r, 0.8, 1.3), R(r, 0.8, 1.2), pick(r, [0xcdbb6f, 0xc2b064, 0xd6c47c]));
      // small round bales sit on every third row, a few plants apart
      if (info.row % 3 === 1 && (info.col + info.row * 2) % 7 === 0) {
        const yaw = R(r, -0.4, 0.4) + (r() < 0.5 ? 0 : Math.PI / 2);
        add('bale', 0, 0, 0, 0, yaw, 0, 1, 1, 1, pick(r, [0xe3c46f, 0xdcbc63, 0xe8cb7a]));
        add('baleEnd', 0, 0, 0, 0, yaw, 0, 1, 1, 1, pick(r, [0xd7b55c, 0xcfac52]));
      }
    },
  },

  pasture: {
    spacing: 0.2, rowGap: 1, jitter: [0.45, 0.45], stagger: true, inset: 0.07, yaw: 'random',
    parts: {
      tuft: { geo: () => fan(6, 0.24, 0.022, 0.42, 0.4), shade: 0.62 },
      stem: { geo: () => new THREE.CylinderGeometry(0.004, 0.005, 0.16, 3, 1).translate(0, 0.08, 0), shade: 0.8 },
      flower: { geo: () => new THREE.IcosahedronGeometry(0.03, 0).scale(1, 0.75, 1), shade: 0.92 },
    },
    plant(r, add) {
      const s = R(r, 0.65, 1.2);
      add('tuft', 0, 0, 0, 0, R(r, 0, 6), 0, s, s * R(r, 0.85, 1.15), s, pick(r, [0x9fb85a, 0xaec165, 0x93ad50, 0xb6c46e]));
      if (r() < 0.18) {
        const x = R(r, -0.05, 0.05), z = R(r, -0.05, 0.05), h = R(r, 0.9, 1.25);
        add('stem', x, 0, z, 0, 0, 0, 1, h, 1, 0x86a64a);
        add('flower', x, 0.16 * h, z, 0, R(r, 0, 3), 0, 1, 1, 1, pick(r, [0xf3b6c8, 0xfaf5ec, 0xf6dc6e]));
      }
    },
  },

  fallow: {
    spacing: 0.2, rowGap: 1, jitter: [0, 0], inset: 0.09, yaw: 'row',
    parts: {
      ridge: { geo: ridge, shade: 0.8 },
      stubble: { geo: () => fan(4, 0.07, 0.01, 0.35, 0.4), shade: 0.8 },
      weed: { geo: () => fan(5, 0.1, 0.016, 0.45, 0.3), shade: 0.7 },
    },
    plant(r, add, info) {
      // ridge pieces are as long as the gap between plants, so each row reads as one furrow
      add('ridge', 0, 0, 0, 0, 0, 0, info.spacing * 1.02, R(r, 0.9, 1.1), 1, pick(r, [0x8a6a4c, 0x93704f, 0x86654a]));
      if (r() < 0.35) add('stubble', R(r, -0.06, 0.06), 0.035, 0, 0, R(r, 0, 6), 0, 1, R(r, 0.8, 1.2), 1, pick(r, [0xc9b678, 0xbfae73]));
      if (r() < 0.05) add('weed', 0, 0.03, R(r, -0.08, 0.08), 0, R(r, 0, 6), 0, 1, 1, 1, pick(r, [0x9fb85a, 0x8fae4f]));
    },
  },

  other: {
    spacing: 0.19, rowGap: 1, jitter: [0.4, 0.4], stagger: true, inset: 0.08, yaw: 'random',
    parts: {
      leaf: { geo: () => blade(0.22, 0.05), shade: 0.65 },
      bud: { geo: () => new THREE.IcosahedronGeometry(0.04, 0), shade: 0.8 },
    },
    plant(r, add) {
      const s = R(r, 0.8, 1.2);
      const col = pick(r, [0x8cbf55, 0x7fb24c, 0x9acb62]);
      const n = 5;
      for (let k = 0; k < n; k++) {
        add('leaf', 0, 0, 0, 0, (k / n) * Math.PI * 2 + R(r, -0.2, 0.2), -R(r, 0.5, 0.85), s, s * R(r, 0.85, 1.1), s, col);
      }
      add('bud', 0, 0.1 * s, 0, R(r, 0, 3), R(r, 0, 3), 0, s, s, s, pick(r, [0x76a845, 0x84b34f]));
    },
  },
};

// ---------- shared geometry and material cache ----------

const geoCache = new Map();
function partGeometry(key, name) {
  const id = key + ':' + name;
  if (!geoCache.has(id)) {
    const def = CROPS[key].parts[name];
    const g = def.geo();
    if (!g.attributes.normal) g.computeVertexNormals();
    geoCache.set(id, shade(g, def.shade));
  }
  return geoCache.get(id);
}
let sharedMaterial = null;
function plantMaterial() {
  // One material for every plant part: white, tinted per instance, flat-shaded like the prototype.
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0,
    });
    sharedMaterial.userData.season = 'crop'; // ripens to straw in fall (src/island/seasons.js)
  }
  return sharedMaterial;
}

// ---------- polygon helpers ----------

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
function polygonArea(poly) {
  let a = Math.abs(ringArea(poly[0]));
  for (let k = 1; k < poly.length; k++) a -= Math.abs(ringArea(poly[k]));
  return Math.max(0, a);
}
// Even-odd point-in-polygon over all rings, so holes are respected.
function insidePoly(x, z, poly) {
  let inside = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}
// True when (x, z) is at least d away from every edge of the polygon (outer ring and holes).
function clearOfEdges(x, z, poly, d) {
  const d2 = d * d;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
      let t = L ? ((x - ax) * dx + (z - az) * dz) / L : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - x, ez = az + dz * t - z;
      if (ex * ex + ez * ez < d2) return false;
    }
  }
  return true;
}
// Direction of the longest edge of the biggest polygon's outer ring (radians, in the x-z plane).
function longestEdgeAngle(polys) {
  let best = polys[0], bestA = -1;
  for (const p of polys) { const a = polygonArea(p); if (a > bestA) { bestA = a; best = p; } }
  const ring = best[0];
  let len = -1, ang = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const dx = ring[i][0] - ring[j][0], dz = ring[i][1] - ring[j][1], l = dx * dx + dz * dz;
    if (l > len) { len = l; ang = Math.atan2(dz, dx); }
  }
  return ang;
}
// Accept a single polygon (array of rings) as well as an array of polygons; drop empty ones.
function normalisePolygons(polygons) {
  if (!Array.isArray(polygons) || !polygons.length) return [];
  if (typeof polygons[0]?.[0]?.[0] === 'number') polygons = [polygons];
  return polygons.filter((p) => Array.isArray(p) && p[0] && p[0].length >= 3);
}

// Lay out plant positions in rows. Returns { pts: [{x, z, row, col, u, v}], spacing, rowSpacing }.
function layoutRows(def, polys, angle, spacing, rand) {
  const rowSpacing = spacing * def.rowGap;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  // u runs along the rows, v across them
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const p of polys) for (const [x, z] of p[0]) {
    const u = x * ca + z * sa, v = -x * sa + z * ca;
    if (u < umin) umin = u; if (u > umax) umax = u;
    if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  // centre the grid in the field's extent so the margins on both sides match
  const nRows = Math.floor((vmax - vmin) / rowSpacing) + 1;
  const nCols = Math.floor((umax - umin) / spacing) + 1;
  const v0 = vmin + (vmax - vmin - (nRows - 1) * rowSpacing) / 2;
  const u0 = umin + (umax - umin - (nCols - 1) * spacing) / 2;
  // per-polygon bounding boxes so most outside points are rejected quickly
  const boxes = polys.map((p) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    return [x0, x1, z0, z1];
  });
  const [ja, jc] = def.jitter;
  const pts = [];
  for (let row = 0; row < nRows; row++) {
    const v = v0 + row * rowSpacing;
    const shift = def.stagger && row % 2 ? spacing / 2 : 0;
    for (let col = 0; col < nCols; col++) {
      const u = u0 + col * spacing + shift + (rand() - 0.5) * 2 * ja * spacing;
      const vv = v + (rand() - 0.5) * 2 * jc * spacing;
      const x = u * ca - vv * sa, z = u * sa + vv * ca;
      for (let k = 0; k < polys.length; k++) {
        const b = boxes[k];
        if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
        if (insidePoly(x, z, polys[k]) && clearOfEdges(x, z, polys[k], def.inset)) {
          pts.push({ x, z, row, col, u, v: vv });
          break;
        }
      }
    }
  }
  return { pts, spacing, rowSpacing };
}

// ---------- growth animation ----------

const GROW = 0.35; // each plant's own pop-in takes this share of the whole 0..1 timeline
const BACK = 1.4;  // overshoot strength (1.70 is the classic "back" ease; this is gentler)
function easeOutBack(k) {
  const c3 = BACK + 1, x = k - 1;
  return 1 + c3 * x * x * x + BACK * x * x;
}

// ---------- the main entry point ----------

/**
 * Fill field polygons with low-poly plants of one crop.
 * @param {string} cropKey   one of CROP_KEYS (anything else is passed through cropKeyFor)
 * @param {Array} polygons   [polygon, ...], polygon = [outerRing, ...holes], ring = [[x, z], ...]
 *                           in scene units on the plane y = 0
 * @param {object} [opts]
 * @param {number} [opts.seed=1]        same seed -> same plants
 * @param {number} [opts.spacing]       plant spacing along a row (default per crop, 0.16-0.24)
 * @param {number} [opts.maxPlants=1500] spacing grows to keep the field under this many plants
 * @param {number} [opts.rowAngle]      row direction in radians (default: longest field edge)
 * @param {number} [opts.plantScale=1]  extra size for every plant
 * @returns {THREE.Group} with userData { cropKey, count, spacing, rowAngle, setGrowth(t) }
 */
export function plantField(cropKey, polygons, opts = {}) {
  const key = CROP_KEYS.includes(cropKey) ? cropKey : cropKeyFor(cropKey);
  const def = CROPS[key];
  const { seed = 1, maxPlants = 1500, plantScale = 1 } = opts;
  const polys = normalisePolygons(polygons);

  const group = new THREE.Group();
  group.name = `Crop: ${CROP_STYLE[key].label}`;
  group.userData = { cropKey: key, count: 0, spacing: 0, rowAngle: 0, setGrowth: () => {} };
  if (!polys.length) return group;

  const angle = Number.isFinite(opts.rowAngle) ? opts.rowAngle : longestEdgeAngle(polys);
  const area = polys.reduce((s, p) => s + polygonArea(p), 0);

  // Pick the spacing: the crop's own, widened up front if the area would need too many plants,
  // then widened a little more until the real count (after edges and holes) fits.
  let spacing = (opts.spacing ?? def.spacing) * plantScale;
  const perPlant = spacing * spacing * def.rowGap;
  if (area / perPlant > maxPlants) spacing *= Math.sqrt(area / perPlant / maxPlants);
  let lay;
  for (let tries = 0; tries < 8; tries++) {
    lay = layoutRows(def, polys, angle, spacing, rng(seed * 7919 + 13));
    if (lay.pts.length <= maxPlants) break;
    spacing *= Math.sqrt(lay.pts.length / maxPlants) * 1.02;
  }
  // A tiny field may have no room on the normal grid: try a finer one so it is not left bare.
  for (let tries = 0; tries < 2 && !lay.pts.length; tries++) {
    spacing /= 2;
    lay = layoutRows({ ...def, inset: tries ? 0 : def.inset / 2 }, polys, angle, spacing, rng(seed * 7919 + 13));
  }
  // Still nothing (a sliver): one plant in the middle of the biggest polygon, if it is inside.
  if (!lay.pts.length) {
    const big = polys.reduce((a, p) => (polygonArea(p) > polygonArea(a) ? p : a));
    const ring = big[0];
    const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length;
    const cz = ring.reduce((s, q) => s + q[1], 0) / ring.length;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    if (insidePoly(cx, cz, big)) lay.pts.push({ x: cx, z: cz, row: 0, col: 0, u: cx * ca + cz * sa, v: -cx * sa + cz * ca });
  }
  if (lay.pts.length > maxPlants) lay.pts.length = maxPlants;
  const pts = lay.pts;
  const n = pts.length;
  group.userData.spacing = spacing;
  group.userData.rowAngle = angle;
  group.userData.count = n;
  if (!n) return group;

  // Build every plant: collect the pieces per part, already moved into field space.
  const partNames = Object.keys(def.parts);
  const buckets = Object.fromEntries(partNames.map((p) => [p, { mats: [], cols: [], plant: [] }]));
  const rand = rng(seed * 104729 + key.length * 31);
  const local = new THREE.Matrix4(), plantM = new THREE.Matrix4(), out = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const col = new THREE.Color();
  const unit = new THREE.Vector3(1, 1, 1), yAxis = new THREE.Vector3(0, 1, 0);
  let current = 0;
  const add = (part, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, colour = 0xffffff) => {
    const b = buckets[part];
    local.compose(pos.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), scl.set(sx, sy, sz));
    out.multiplyMatrices(plantM, local);
    const m = out.elements;
    b.mats.push(m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[12], m[13], m[14]);
    col.setHex(colour);
    b.cols.push(col.r, col.g, col.b);
    b.plant.push(current);
  };

  const plantX = new Float32Array(n), plantZ = new Float32Array(n), start = new Float32Array(n);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const p of pts) {
    if (p.u < umin) umin = p.u; if (p.u > umax) umax = p.u;
    if (p.v < vmin) vmin = p.v; if (p.v > vmax) vmax = p.v;
  }
  const rowYaw = -angle; // turns plant-space +x onto the row direction
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    current = i;
    plantX[i] = p.x; plantZ[i] = p.z;
    const yaw = def.yaw === 'row' ? rowYaw : rand() * Math.PI * 2;
    plantM.compose(pos.set(p.x, 0, p.z), q.setFromAxisAngle(yAxis, yaw), scl.copy(unit).multiplyScalar(plantScale));
    def.plant(rand, add, { row: p.row, col: p.col, spacing: spacing / plantScale });
    // Pop-in order: a wave that runs from one end of the rows to the other, slightly diagonal.
    const ou = (p.u - umin) / Math.max(1e-6, umax - umin);
    const ov = (p.v - vmin) / Math.max(1e-6, vmax - vmin);
    const order = Math.min(1, Math.max(0, (0.8 * ou + 0.2 * ov) * 0.96 + rand() * 0.04));
    start[i] = order * (1 - GROW);
  }

  // One InstancedMesh per part.
  const parts = [];
  for (const name of partNames) {
    const b = buckets[name];
    const count = b.plant.length;
    if (!count) continue;
    const mesh = new THREE.InstancedMesh(partGeometry(key, name), plantMaterial(), count);
    mesh.name = `${key} ${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const base = new Float32Array(b.mats);
    const arr = mesh.instanceMatrix.array;
    for (let i = 0; i < count; i++) {
      const o = i * 16, s = i * 12;
      arr[o] = base[s]; arr[o + 1] = base[s + 1]; arr[o + 2] = base[s + 2]; arr[o + 3] = 0;
      arr[o + 4] = base[s + 3]; arr[o + 5] = base[s + 4]; arr[o + 6] = base[s + 5]; arr[o + 7] = 0;
      arr[o + 8] = base[s + 6]; arr[o + 9] = base[s + 7]; arr[o + 10] = base[s + 8]; arr[o + 11] = 0;
      arr[o + 12] = base[s + 9]; arr[o + 13] = base[s + 10]; arr[o + 14] = base[s + 11]; arr[o + 15] = 1;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(b.cols), 3);
    // Bounds from the fully grown state, so the field is never culled while it is growing.
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
    parts.push({ mesh, base, plant: Uint32Array.from(b.plant) });
  }

  // setGrowth(t): every plant scales up from its base with a small overshoot, in a wave.
  // Each instance is "full-size matrix scaled about the plant's base point", which is just
  // the 3x3 part times s and the offset from the base times s, so no matrix maths per frame.
  const scale = new Float32Array(n);
  let last = 1;
  group.userData.setGrowth = (t) => {
    t = t >= 1 ? 1 : t <= 0 ? 0 : +t || 0;
    if (t === last) return;
    last = t;
    for (let i = 0; i < n; i++) {
      const k = (t - start[i]) / GROW;
      scale[i] = k <= 0 ? 0 : k >= 1 ? 1 : easeOutBack(k);
    }
    writeScales();
  };
  // setSize(s): every plant at the same size, 0 (none) to 1 (full grown): the crop growing through
  // a season, or cut to stubble after harvest. (setGrowth above is the reveal's pop-in wave.)
  group.userData.setSize = (s) => {
    s = s >= 1 ? 1 : s <= 0 ? 0 : +s || 0;
    const key = 2 + s; // never equal to a setGrowth value
    if (key === last) return;
    last = key;
    scale.fill(s);
    writeScales();
  };
  function writeScales() {
    for (const { mesh, base, plant } of parts) {
      const a = mesh.instanceMatrix.array;
      for (let i = 0, count = plant.length; i < count; i++) {
        const j = plant[i], s = scale[j], o = i * 16, b = i * 12;
        const px = plantX[j], pz = plantZ[j];
        a[o] = base[b] * s; a[o + 1] = base[b + 1] * s; a[o + 2] = base[b + 2] * s;
        a[o + 4] = base[b + 3] * s; a[o + 5] = base[b + 4] * s; a[o + 6] = base[b + 5] * s;
        a[o + 8] = base[b + 6] * s; a[o + 9] = base[b + 7] * s; a[o + 10] = base[b + 8] * s;
        a[o + 12] = px + (base[b + 9] - px) * s;
        a[o + 13] = base[b + 10] * s;
        a[o + 14] = pz + (base[b + 11] - pz) * s;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = scale.some((v) => v > 0);
    }
  }
  return group;
}
