// The Thanksgiving theme: the whole farm dressed for the harvest, in amber, rust, gold, deep red
// and brown.
//
//   centrepiece   a giant wicker cornucopia at the front of the farmyard, spilling pumpkins, apples,
//                 corn, grapes and gourds
//   fences        autumn-leaf garlands swagged along every fence with a wreath hung every so often,
//                 pumpkins along the foot of them, corn shocks and pumpkins at the corners, and at
//                 every gate two shocks under an arch of leaves with a wreath hanging from it
//   buildings     a big harvest wreath on the front of each one, corn shocks at its front corners,
//                 leaf swags across it (a belt of leaves round silos and windmills) and pumpkins
//                 by the door; the barn gets shocks at its
//                 corners, leaves along the ridge and over the door, and a golden turkey weathervane
//   lamps         a wreath on every post, leaves wound up it, a corn shock and a pumpkin at its foot
//   trees         heaps of orange, red and gold leaves round each one, and loose leaves all about
//   paths         hay bales topped with pumpkins and gourds (some with a lantern), wheat sheaves
//   all over      turkeys strutting and pecking, plaid scarecrows at the field edges, a hay wagon
//                 piled with pumpkins, a long harvest table (corn shocks at its ends) with the roast turkey, pies and corn,
//                 pumpkin heaps and leaf piles out on the grass
//   sheep         pilgrim hats with a gold buckle, and crowns of autumn leaves
//
// Each placed thing is baked into one vertex-coloured mesh (one draw call each); things repeated
// round the island (shocks, pumpkins, wreaths, leaves, sheaves) are one InstancedMesh per kind,
// popped in here one by one, rippling out from the farmyard.
import * as THREE from 'three';
import { jitter, makeHayBale, mat, mesh, rng } from '../props.js';
import { makeCornShock, makeHarvestWreath } from '../decor.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const smooth = (t) => t * t * (3 - 2 * t);

// the harvest palette
const C = {
  orange: 0xe8822e, deep: 0xd0601e, pale: 0xf0e4c8, rust: 0xb5532a, red: 0xa8302a, gold: 0xe6b83a,
  wheat: 0xd9b25a, wheatHead: 0xe8c15a, brown: 0x7a4a26, dark: 0x4a2e1a, cream: 0xf1e6cc,
  hay: 0xe3c46f, stem: 0x6f7f3a, wood: 0xa6815f, woodDark: 0x7d5e45, black: 0x1e1b1a,
};
const LEAF_COLS = [0xe0662a, 0xc23a22, 0xe89a2c, 0xe8bf3a, 0xa84a22, 0xd4502a, 0x9a2a1e];

// keys that aren't buildings (the context counts every prop that isn't a tree, lamp or bale)
const NOT_BUILDINGS = new Set(['dock', 'boat', 'rock', 'bush', 'barrel', 'crate', 'bench', 'mailbox', 'signpost', 'wheelbarrow', 'firewood', 'scarecrow', 'hayStack', 'sheep', 'manami', 'fence']);
const ROUND = new Set(['silo', 'windmill', 'grainBins', 'well']);

// ---------------------------------------------------------------- baking

const WHITE = new THREE.Color(1, 1, 1);
const _m = new THREE.Matrix4();

/** Joins non-indexed geometries with position, normal and colour into one. */
function merge(list) {
  if (!list.length) return null;
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Bakes every mesh under `root` into vertex-coloured geometry in root's own space (each mesh's
 * material colour painted on): { solid, glow } (glow: the unlit MeshBasic parts, or null).
 */
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const solid = [], glow = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count, tint = o.material.color || WHITE, src = g.attributes.color;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = tint.r * (src ? src.getX(i) : 1);
      c[i * 3 + 1] = tint.g * (src ? src.getY(i) : 1);
      c[i * 3 + 2] = tint.b * (src ? src.getZ(i) : 1);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    (o.material.isMeshBasicMaterial ? glow : solid).push(g);
  });
  return { solid: merge(solid), glow: merge(glow) };
}

// ---------------------------------------------------------------- building blocks

const glowMats = new Map();
const glowPart = (color) => { if (!glowMats.has(color)) glowMats.set(color, new THREE.MeshBasicMaterial({ color })); return glowMats.get(color); };

/** Adds a coloured shape to g (only its colour matters: it gets baked). */
function part(g, geo, color, [x = 0, y = 0, z = 0] = [], [rx = 0, ry = 0, rz = 0] = [], s = 1, glow = false) {
  const m = new THREE.Mesh(geo, glow ? glowPart(color) : mat(color));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  if (Array.isArray(s)) m.scale.set(...s); else m.scale.setScalar(s);
  g.add(m);
  return m;
}

let leafShapeGeo = null;
/** A maple-ish leaf about 0.9 across, flat in the xy plane. */
function leafShape() {
  if (leafShapeGeo) return leafShapeGeo;
  const pts = [[0, -0.5], [0.1, -0.22], [0.4, -0.16], [0.28, 0.02], [0.46, 0.26], [0.17, 0.22], [0, 0.5], [-0.17, 0.22], [-0.46, 0.26], [-0.28, 0.02], [-0.4, -0.16], [-0.1, -0.22]];
  const sh = new THREE.Shape();
  sh.moveTo(...pts[0]);
  for (const p of pts.slice(1)) sh.lineTo(...p);
  leafShapeGeo = new THREE.ShapeGeometry(sh);
  return leafShapeGeo;
}

let ribbedGeo = null;
/** A pumpkin's body: a sphere with eight ribs. */
function ribbed() {
  if (ribbedGeo) return ribbedGeo;
  const geo = new THREE.SphereGeometry(0.18, 16, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const k = 0.88 + 0.12 * Math.sqrt(Math.abs(Math.sin(Math.atan2(z, x) * 4)));
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  geo.computeVertexNormals();
  ribbedGeo = geo;
  return geo;
}
const stemGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.08, 5);

/** A ribbed pumpkin sitting at y (0.36 across at size 1). */
function addPumpkin(g, x, y, z, size = 1, color = C.orange, ry = 0) {
  part(g, ribbed(), color, [x, y + 0.13 * size, z], [0, ry, 0], [size, 0.74 * size, size]);
  part(g, stemGeo, C.stem, [x, y + 0.26 * size, z], [0, 0, 0.25], size);
}
const ballGeo = new THREE.SphereGeometry(0.05, 8, 6);
function addGourd(g, x, y, z, s = 1, color = C.gold, ry = 0) {
  part(g, ballGeo, color, [x, y + 0.04 * s, z], [0, ry, 0], [s, 0.8 * s, 1.4 * s]);
  part(g, ballGeo, color, [x + Math.sin(ry) * 0.06 * s, y + 0.07 * s, z + Math.cos(ry) * 0.06 * s], [0, ry, 0], 0.65 * s);
}
function addApple(g, x, y, z, color = 0xc8302a, s = 1) {
  part(g, ballGeo, color, [x, y + 0.055 * s, z], [], [1.2 * s, 1.1 * s, 1.2 * s]);
  part(g, stemGeo, C.dark, [x, y + 0.12 * s, z], [], [0.4 * s, 0.6 * s, 0.4 * s]);
}
const cobGeo = new THREE.CylinderGeometry(0.045, 0.035, 1, 8);
const huskGeo = new THREE.ConeGeometry(0.04, 1, 5);
/** An ear of corn with its husk peeled back, pointing up its local y (len long), turned by rot. */
function addCorn(g, at, rot, len = 0.32) {
  const c = new THREE.Group();
  c.position.set(...at);
  c.rotation.set(...rot);
  part(c, cobGeo, 0xf2c53d, [0, len / 2, 0], [], [1, len, 1]);
  part(c, ballGeo, 0xf2c53d, [0, len, 0], [], [0.75, 0.9, 0.75]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    part(c, huskGeo, 0xc9b070, [Math.cos(a) * 0.04, len * 0.15, Math.sin(a) * 0.04], [Math.sin(a) * 2.6, 0, -Math.cos(a) * 2.6], [1, len * 0.6, 0.5]);
  }
  g.add(c);
}
const grapeGeo = new THREE.SphereGeometry(0.042, 7, 5);
/** A bunch of grapes hanging down from (x, y, z). */
function addGrapes(g, x, y, z, s = 1) {
  const rows = [4, 3, 3, 2, 1];
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r;
      const rad = n > 1 ? 0.025 * n * s : 0;
      part(g, grapeGeo, (i + r) % 2 ? 0x5e2a6e : 0x7a3a8a, [x + Math.cos(a) * rad, y - r * 0.06 * s, z + Math.sin(a) * rad], [], s);
    }
  });
  part(g, leafShape(), 0x6f8a3a, [x, y + 0.04 * s, z - 0.03], [-0.6, 0, 0.3], 0.14 * s);
}

// ---------------------------------------------------------------- the things

/** Wicker horn geometry along a curling path, checkered weave, with a dark inner wall. */
function hornGeometry() {
  const curve = new THREE.CatmullRomCurve3([
    [0, 0.44, 0.36], [0.04, 0.38, -0.05], [0.1, 0.34, -0.42], [0.15, 0.6, -0.76], [0.13, 0.98, -0.84], [0.06, 1.22, -0.62], [0.02, 1.26, -0.38], [0, 1.14, -0.24],
  ].map((p) => new THREE.Vector3(...p)));
  const SEG = 52, SIDES = 18, R0 = 0.44;
  const frames = curve.computeFrenetFrames(SEG, false);
  const rings = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG, c = curve.getPointAt(t), r = R0 * (1 - t) ** 1.15 + 0.02;
    const N = frames.normals[i], B = frames.binormals[i];
    const ring = [];
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      ring.push(new THREE.Vector3().copy(c).addScaledVector(N, Math.cos(a) * r).addScaledVector(B, Math.sin(a) * r));
    }
    rings.push({ c, ring });
  }
  const pos = [], col = [];
  const light = new THREE.Color(0xd09448), dark = new THREE.Color(0xa86b2c), band = new THREE.Color(0x7a4a22), inner = new THREE.Color(0x5e3b1c);
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), out = new THREE.Vector3();
  const tri = (a, b, c, center, inward, color) => {
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    out.subVectors(a, center);
    if ((n.dot(out) < 0) !== inward) [b, c] = [c, b];
    for (const v of [a, b, c]) { pos.push(v.x, v.y, v.z); col.push(color.r, color.g, color.b); }
  };
  for (let i = 0; i < SEG; i++) {
    const A = rings[i], Bn = rings[i + 1];
    for (let j = 0; j < SIDES; j++) {
      const j2 = (j + 1) % SIDES;
      const color = i % 7 === 0 ? band : (i + j) % 2 ? light : dark;
      tri(A.ring[j], Bn.ring[j], Bn.ring[j2], A.c, false, color);
      tri(A.ring[j], Bn.ring[j2], A.ring[j2], A.c, false, color);
      if (i < SEG * 0.45) {
        // the inside of the mouth, a little in from the outside
        const s = 0.9, ia = A.ring[j].clone().sub(A.c).multiplyScalar(s).add(A.c), ib = Bn.ring[j].clone().sub(Bn.c).multiplyScalar(s).add(Bn.c);
        const ic = Bn.ring[j2].clone().sub(Bn.c).multiplyScalar(s).add(Bn.c), id = A.ring[j2].clone().sub(A.c).multiplyScalar(s).add(A.c);
        tri(ia, ib, ic, A.c, true, inner);
        tri(ia, ic, id, A.c, true, inner);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return { geo, mouth: curve.getPointAt(0), tangent: curve.getTangentAt(0), R0 };
}

/** The centrepiece: a giant wicker cornucopia spilling the harvest, mouth to +z. ~1.35 tall, 1.6 long. */
function makeCornucopia() {
  const g = new THREE.Group();
  const r = rng(41);
  part(g, new THREE.CylinderGeometry(0.98, 1.04, 0.05, 14), 0xd9be76, [0, 0.025, 0.12]);
  const horn = hornGeometry();
  g.add(new THREE.Mesh(horn.geo, mat(0xffffff)));
  const rim = part(g, new THREE.TorusGeometry(horn.R0 + 0.015, 0.055, 6, 22), 0x7a4a22, [horn.mouth.x, horn.mouth.y, horn.mouth.z]);
  rim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), horn.tangent);
  // the harvest pouring out of the mouth
  addPumpkin(g, 0.04, 0.03, 0.62, 1.55, C.orange, 0.3);
  addPumpkin(g, -0.42, 0.03, 0.66, 1.1, C.pale, 1.1);
  addPumpkin(g, 0.46, 0.03, 0.74, 1.05, C.deep, 2);
  addPumpkin(g, -0.08, 0.05, 0.24, 0.95, C.deep, 0.5);
  addPumpkin(g, 0.18, 0.05, 0.2, 0.8, C.orange, 1.4);
  addPumpkin(g, 0.72, 0.03, 0.3, 0.75, C.orange, 0.9);
  addCorn(g, [0.18, 0.32, 0.28], [0.9, 0, -0.5], 0.36);
  addCorn(g, [-0.22, 0.3, 0.3], [0.8, 0, 0.6], 0.36);
  addCorn(g, [0.3, 0.06, 1.05], [Math.PI / 2, 0, -1.1], 0.34);
  addCorn(g, [-0.64, 0.06, 0.32], [Math.PI / 2, 0, 0.6], 0.34);
  addGrapes(g, -0.2, 0.62, 0.36, 1.25);
  addGrapes(g, 0.3, 0.45, 0.42, 1.1);
  addGrapes(g, -0.68, 0.32, 0.72, 1);
  addApple(g, 0.0, 0.43, 0.62, 0xc8302a, 1.2);
  addApple(g, 0.12, 0.38, 0.72, 0xd94a2a, 1.1);
  [[-0.62, 0.52, 0xc8302a], [0.68, 0.52, 0x8fb33a], [-0.24, 0.98, 0xc8302a], [0.58, 1.0, 0xe8c547], [0.08, 1.04, 0xb8262a], [-0.82, 0.08, 0xd94a2a]].forEach(([x, z, c]) => addApple(g, x, 0.03, z, c, 1.15));
  addGourd(g, -0.5, 0.03, 0.96, 1.4, C.gold, 0.6);
  addGourd(g, 0.8, 0.03, 0.62, 1.4, 0x6f9a3e, -0.8);
  addGourd(g, 0.02, 0.03, 1.12, 1.3, C.pale, 0.2);
  addGourd(g, 0.38, 0.6, 0.5, 1.1, 0xb8c04a, 1.8);
  // wheat stalks fanning up out of the mouth
  const stalk = new THREE.CylinderGeometry(0.008, 0.01, 0.5, 4);
  for (let i = 0; i < 7; i++) {
    const a = -0.7 + i * 0.23;
    part(g, stalk, C.wheat, [Math.sin(a) * 0.12, 0.72, 0.3], [0.5, 0, -a], 1);
    part(g, ballGeo, C.wheatHead, [Math.sin(a) * 0.36, 0.94 + Math.cos(a) * 0.02, 0.42], [0.5, 0, -a], [0.55, 1.9, 0.55]);
  }
  // leaves strewn round it
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 0.45 + r() * 0.5;
    part(g, leafShape(), LEAF_COLS[i % LEAF_COLS.length], [Math.cos(a) * d, 0.06, 0.2 + Math.sin(a) * d * 0.9], [-Math.PI / 2 + (r() - 0.5) * 0.4, 0, r() * 6], 0.15 + r() * 0.06);
  }
  return g;
}

/** The long harvest table, lengthwise along x: cloth, runner, roast turkey, pies, corn, candles, benches. */
function makeHarvestTable() {
  const g = new THREE.Group();
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  part(g, box(1.7, 0.05, 0.5), C.wood, [0, 0.29, 0]);
  for (const x of [-0.78, 0.78]) for (const z of [-0.2, 0.2]) part(g, box(0.05, 0.28, 0.05), C.woodDark, [x, 0.14, z]);
  part(g, box(1.76, 0.014, 0.56), C.cream, [0, 0.322, 0]);
  for (const z of [-0.28, 0.28]) part(g, box(1.76, 0.12, 0.012), C.cream, [0, 0.27, z]);
  for (const x of [-0.88, 0.88]) part(g, box(0.012, 0.12, 0.56), C.cream, [x, 0.27, 0]);
  part(g, box(1.5, 0.012, 0.17), C.rust, [0, 0.334, 0]);
  for (const z of [-0.09, 0.09]) part(g, box(1.5, 0.014, 0.02), C.gold, [0, 0.335, z]);
  // benches either side
  for (const z of [-0.45, 0.45]) {
    part(g, box(1.6, 0.05, 0.17), C.woodDark, [0, 0.18, z]);
    for (const x of [-0.7, 0.7]) part(g, box(0.05, 0.16, 0.12), C.dark, [x, 0.08, z]);
  }
  // a plate at every place
  const plate = new THREE.CylinderGeometry(0.06, 0.05, 0.012, 12);
  for (const x of [-0.65, -0.3, 0.3, 0.65]) for (const z of [-0.17, 0.17]) part(g, plate, 0xfaf6ee, [x, 0.335, z]);
  // the roast turkey on its platter
  part(g, new THREE.CylinderGeometry(0.2, 0.17, 0.02, 14), 0xfaf6ee, [0, 0.34, 0]);
  part(g, new THREE.SphereGeometry(0.12, 10, 8), 0xb5652a, [0, 0.42, 0], [], [1.3, 0.75, 1]);
  part(g, new THREE.SphereGeometry(0.07, 8, 6), 0xc8783a, [0, 0.47, 0.02], [], [1.2, 0.6, 0.9]);
  for (const s of [-1, 1]) {
    part(g, new THREE.SphereGeometry(0.05, 8, 6), 0xa95a24, [s * 0.14, 0.43, 0.06], [0, 0, s * 0.6], [1.4, 0.8, 0.8]);
    part(g, new THREE.CylinderGeometry(0.012, 0.014, 0.07, 5), 0xf6efe0, [s * 0.2, 0.47, 0.08], [0, 0, -s * 0.9]);
  }
  [[0.16, -0.08], [-0.16, -0.08], [0.06, 0.15], [-0.1, 0.14], [0.17, 0.1], [-0.17, 0.08]].forEach(([x, z], i) => part(g, ballGeo, i % 2 ? 0x6f9a3e : 0xe8902a, [x, 0.37, z], [], 0.5));
  // pies: pumpkin, cherry lattice, pumpkin
  const crust = new THREE.CylinderGeometry(0.1, 0.085, 0.04, 12), fill = new THREE.CylinderGeometry(0.085, 0.085, 0.01, 12);
  [[-0.5, 0.06, C.deep], [0.48, -0.05, 0x9a1e24], [-0.82, -0.02, C.deep]].forEach(([x, z, c], i) => {
    part(g, crust, 0xd8a35a, [x, 0.35, z]);
    part(g, fill, c, [x, 0.372, z]);
    if (i === 1) for (let k = -1; k <= 1; k++) {
      part(g, box(0.17, 0.012, 0.018), 0xe2b56a, [x, 0.38, z + k * 0.05]);
      part(g, box(0.018, 0.012, 0.17), 0xe2b56a, [x + k * 0.05, 0.381, z]);
    }
  });
  // corn on a dish, a bowl of apples, rolls, little pumpkins
  part(g, new THREE.CylinderGeometry(0.11, 0.09, 0.02, 12), 0xfaf6ee, [0.3, 0.34, 0.02]);
  [-0.05, 0, 0.05].forEach((dz, i) => addCorn(g, [0.22 + i * 0.02, 0.37, 0.02 + dz], [0, 0, -Math.PI / 2], 0.18));
  part(g, new THREE.CylinderGeometry(0.1, 0.06, 0.06, 10), C.brown, [0.72, 0.36, 0.05]);
  [[0.69, 0.02], [0.75, 0.08], [0.72, -0.02], [0.66, 0.08], [0.77, 0.0]].forEach(([x, z], i) => addApple(g, x, 0.36, z, i % 2 ? 0xc8302a : 0xd94a2a, 0.8));
  [[-0.25, -0.05], [-0.3, 0.05], [-0.2, 0.06]].forEach(([x, z]) => part(g, ballGeo, 0xd8a35a, [x, 0.36, z], [], [0.9, 0.6, 0.8]));
  addPumpkin(g, -0.88, 0.33, 0.13, 0.42, C.orange);
  addPumpkin(g, 0.88, 0.33, -0.12, 0.42, C.pale);
  addPumpkin(g, -1.02, 0, 0.2, 0.75, C.orange, 1);
  addPumpkin(g, 1.02, 0, -0.15, 0.7, C.deep, 2);
  // candles (the flames glow)
  for (const x of [-0.12, 0.12]) {
    part(g, new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6), C.cream, [x, 0.4, -0.12]);
    part(g, new THREE.SphereGeometry(0.018, 6, 5), 0xffc24a, [x, 0.48, -0.12], [], [1, 1.8, 1], true);
  }
  // leaves on the runner
  for (let i = 0; i < 9; i++) part(g, leafShape(), LEAF_COLS[i % 7], [-0.7 + i * 0.17, 0.343, (i % 2 ? 1 : -1) * 0.04], [-Math.PI / 2, 0, i * 1.3], 0.09);
  return g;
}

/** A red hay wagon on spoked wheels, piled with pumpkins, a lantern on a post (glows). Lengthwise along x. */
function makeHayWagon() {
  const g = new THREE.Group();
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  part(g, box(1.12, 0.07, 0.58), C.wood, [0, 0.3, 0]);
  for (const z of [-0.29, 0.29]) {
    part(g, box(1.14, 0.06, 0.04), 0xa8392c, [0, 0.39, z]);
    part(g, box(1.14, 0.06, 0.04), 0xa8392c, [0, 0.5, z]);
    for (const x of [-0.55, -0.18, 0.18, 0.55]) part(g, box(0.05, 0.22, 0.05), 0x8a2c22, [x, 0.42, z]);
  }
  for (const x of [-0.57, 0.57]) part(g, box(0.04, 0.18, 0.58), 0xa8392c, [x, 0.42, 0]);
  const rimGeo = new THREE.TorusGeometry(0.16, 0.025, 5, 14), spoke = box(0.3, 0.025, 0.02), hub = new THREE.CylinderGeometry(0.045, 0.045, 0.08, 8);
  for (const x of [-0.38, 0.38]) for (const z of [-0.33, 0.33]) {
    part(g, rimGeo, C.dark, [x, 0.18, z]);
    for (let k = 0; k < 3; k++) part(g, spoke, C.woodDark, [x, 0.18, z], [0, 0, (k * Math.PI) / 3]);
    part(g, hub, 0x3f3a36, [x, 0.18, z], [Math.PI / 2, 0, 0]);
  }
  part(g, box(0.55, 0.045, 0.045), C.woodDark, [0.82, 0.22, 0], [0, 0, 0.28]);
  part(g, box(0.045, 0.045, 0.34), C.woodDark, [1.07, 0.15, 0]);
  // hay, then the pumpkins heaped on it
  const hay = jitter(new THREE.DodecahedronGeometry(0.3, 1), [0.06, 0.04, 0.06]);
  part(g, hay, C.hay, [-0.2, 0.36, 0], [], [1.4, 0.35, 0.85]);
  part(g, hay, 0xd7b55c, [0.22, 0.36, 0.02], [], [1.3, 0.32, 0.85]);
  const cols = [C.orange, C.deep, C.pale, C.orange, C.deep, C.orange, C.gold];
  [[-0.32, -0.1, 1.1], [0.0, 0.1, 1.15], [0.3, -0.08, 1.05], [-0.1, -0.12, 0.95], [0.36, 0.14, 0.9], [-0.38, 0.14, 0.9]].forEach(([x, z, s], i) => addPumpkin(g, x, 0.4, z, s, cols[i], i));
  [[-0.16, 0.0, 1.0], [0.16, -0.02, 0.95], [0.02, 0.04, 0.8]].forEach(([x, z, s], i) => addPumpkin(g, x, 0.66, z, s, cols[i + 3], i * 2));
  addPumpkin(g, 0.0, 0.88, 0.0, 0.75, C.deep, 1);
  addGourd(g, 0.45, 0.42, -0.18, 1.2, C.gold);
  addGourd(g, -0.45, 0.42, -0.16, 1.2, 0x6f9a3e, 1.2);
  // a corn shock tied to the back, a lantern on a post at the front corner
  const shock = makeCornShock(4);
  shock.scale.setScalar(0.72);
  shock.position.set(-0.46, 0.33, 0.16);
  g.add(shock);
  part(g, box(0.03, 0.42, 0.03), C.dark, [0.55, 0.52, 0.29]);
  part(g, box(0.1, 0.12, 0.1), 0xffb347, [0.55, 0.78, 0.29], [], 1, true);
  part(g, new THREE.ConeGeometry(0.08, 0.06, 4), 0x3f3a36, [0.55, 0.87, 0.29], [0, Math.PI / 4, 0]);
  return g;
}

/** A plaid-shirted scarecrow with a burlap face, straw hat, patched jeans and a crow on its arm. ~1.25 tall. */
function makePlaidScarecrow(shirt = 0xb8352a) {
  const g = new THREE.Group();
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  part(g, box(0.06, 1.1, 0.06), C.woodDark, [0, 0.55, -0.02]);
  part(g, box(0.82, 0.05, 0.05), C.woodDark, [0, 0.82, -0.02]);
  // jeans with straw at the cuffs, and a patch
  for (const s of [-1, 1]) {
    part(g, box(0.12, 0.32, 0.13), 0x4f6d96, [s * 0.075, 0.4, 0]);
    part(g, new THREE.ConeGeometry(0.06, 0.12, 5), C.hay, [s * 0.075, 0.2, 0], [Math.PI, 0, 0]);
  }
  part(g, box(0.07, 0.07, 0.01), 0xd9a441, [0.08, 0.44, 0.068]);
  // the plaid shirt: a base colour crossed with dark and gold bands
  const dark = 0x3a1612, line = 0xe8c050;
  part(g, box(0.36, 0.34, 0.18), shirt, [0, 0.68, 0]);
  for (const y of [0.6, 0.74]) part(g, box(0.372, 0.035, 0.192), dark, [0, y, 0]);
  for (const x of [-0.09, 0.09]) part(g, box(0.035, 0.345, 0.192), dark, [x, 0.68, 0]);
  part(g, box(0.374, 0.012, 0.194), line, [0, 0.67, 0]);
  part(g, box(0.012, 0.347, 0.194), line, [0, 0.68, 0]);
  for (const s of [-1, 1]) {
    part(g, box(0.26, 0.12, 0.14), shirt, [s * 0.3, 0.8, 0]);
    for (const x of [0.22, 0.34]) part(g, box(0.035, 0.126, 0.146), dark, [s * x, 0.8, 0]);
    part(g, box(0.262, 0.03, 0.146), dark, [s * 0.3, 0.8, 0]);
    part(g, new THREE.ConeGeometry(0.05, 0.14, 5), C.hay, [s * 0.47, 0.8, 0], [0, 0, (s * Math.PI) / 2]);
  }
  part(g, box(0.38, 0.035, 0.2), 0xc9a457, [0, 0.52, 0]);
  part(g, new THREE.ConeGeometry(0.1, 0.1, 6), 0xd9722b, [0, 0.83, 0.02], [Math.PI, 0, 0]);
  // a burlap head with a stitched face
  part(g, new THREE.SphereGeometry(0.135, 10, 8), 0xd8c49a, [0, 0.98, 0]);
  for (const s of [-1, 1]) part(g, ballGeo, C.black, [s * 0.05, 1.01, 0.118], [], 0.32);
  part(g, new THREE.ConeGeometry(0.025, 0.06, 4), C.deep, [0, 0.97, 0.14], [Math.PI / 2, 0, 0]);
  for (let i = -2; i <= 2; i++) part(g, box(0.018, 0.012, 0.01), C.black, [i * 0.024, 0.93 - Math.abs(i) * -0.004, 0.124]);
  // the straw hat with a rust band and a leaf
  part(g, new THREE.CylinderGeometry(0.25, 0.25, 0.025, 14), 0xd9b86a, [0, 1.08, 0]);
  part(g, new THREE.CylinderGeometry(0.11, 0.135, 0.13, 12), 0xd9b86a, [0, 1.16, 0]);
  part(g, new THREE.CylinderGeometry(0.137, 0.137, 0.035, 12), C.rust, [0, 1.11, 0]);
  part(g, leafShape(), 0xe0662a, [0.08, 1.15, 0.11], [0, 0.6, 0.4], 0.11);
  // a crow on its arm
  part(g, ballGeo, 0x24211f, [-0.3, 0.9, 0.0], [], [0.9, 0.85, 1.4]);
  part(g, ballGeo, 0x24211f, [-0.3, 0.97, 0.06], [], 0.6);
  part(g, new THREE.ConeGeometry(0.012, 0.04, 4), 0xe8b04a, [-0.3, 0.97, 0.1], [Math.PI / 2, 0, 0]);
  part(g, box(0.02, 0.012, 0.09), 0x24211f, [-0.3, 0.9, -0.08], [0.4, 0, 0]);
  return g;
}

/** A round hay bale topped with pumpkins and gourds. Variant 1 carries a lantern (it glows). */
function makeBaleDisplay(variant = 0) {
  const g = new THREE.Group();
  const bale = makeHayBale(variant + 3);
  g.add(bale);
  if (variant === 0) {
    addPumpkin(g, 0, 0.47, 0, 1.05, C.orange, 0.4);
    addGourd(g, 0.15, 0.46, 0.12, 1, C.gold, 0.8);
    addGourd(g, -0.15, 0.46, 0.1, 1, 0x6f9a3e, -0.6);
    addPumpkin(g, 0.28, 0, 0.18, 0.8, C.deep, 1);
    addGourd(g, -0.26, 0, 0.22, 1.2, C.pale, 2);
  } else {
    addPumpkin(g, -0.06, 0.47, 0, 0.8, C.pale, 0.4);
    addPumpkin(g, 0.12, 0.47, 0.06, 0.6, C.deep, 1.2);
    addPumpkin(g, -0.02, 0.66, 0.0, 0.5, C.orange, 2);
    part(g, new THREE.BoxGeometry(0.1, 0.13, 0.1), 0xffb347, [0.0, 0.08, 0.32], [], 1, true);
    part(g, new THREE.ConeGeometry(0.08, 0.06, 4), 0x3f3a36, [0.0, 0.17, 0.32], [0, Math.PI / 4, 0]);
    addCorn(g, [-0.24, 0.0, 0.18], [0.0, 0, 0.35], 0.34);
    addCorn(g, [-0.28, 0.0, 0.1], [0.2, 0, 0.55], 0.34);
    addPumpkin(g, 0.28, 0, 0.16, 0.7, C.orange, 3);
  }
  for (let i = 0; i < 6; i++) part(g, leafShape(), LEAF_COLS[(i + variant) % 7], [Math.cos(i * 1.1) * 0.36, 0.01, Math.sin(i * 1.1) * 0.36], [-Math.PI / 2, 0, i * 2.1], 0.14);
  return g;
}

/** A heap of pumpkins and gourds on the grass, among fallen leaves. */
function makePumpkinHeap(seed = 1) {
  const g = new THREE.Group();
  const r = rng(seed * 31 + 7);
  const cols = [C.orange, C.deep, C.pale, C.orange];
  addPumpkin(g, 0, 0, 0, 1.25, cols[seed % 4], r() * 6);
  addPumpkin(g, -0.3, 0, 0.1, 0.85, cols[(seed + 1) % 4], r() * 6);
  addPumpkin(g, 0.28, 0, 0.12, 0.75, cols[(seed + 2) % 4], r() * 6);
  addGourd(g, 0.06, 0, 0.3, 1.3, seed % 2 ? C.gold : 0x6f9a3e, r() * 6);
  for (let i = 0; i < 8; i++) {
    const a = r() * Math.PI * 2, d = 0.25 + r() * 0.3;
    part(g, leafShape(), LEAF_COLS[i % 7], [Math.cos(a) * d, 0.012, Math.sin(a) * d], [-Math.PI / 2, 0, r() * 6], 0.14 + r() * 0.05);
  }
  return g;
}

/** A sheaf of wheat tied round the middle, ~0.62 tall. */
function makeWheatSheaf() {
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.045, 0.11, 0.28, 8), C.wheat, [0, 0.14, 0]);
  part(g, new THREE.CylinderGeometry(0.14, 0.045, 0.22, 8), 0xe0be66, [0, 0.39, 0]);
  part(g, new THREE.TorusGeometry(0.05, 0.018, 5, 10), C.rust, [0, 0.28, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, d = i % 2 ? 0.1 : 0.05;
    part(g, ballGeo, i % 3 ? C.wheatHead : 0xd9a840, [Math.cos(a) * d, 0.53 + (i % 2) * 0.03, Math.sin(a) * d], [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4], [0.5, 1.7, 0.5]);
  }
  return g;
}

/** A low heap of fallen leaves: three coloured mounds with leaves on top. ~0.45 across. */
function makeLeafPile() {
  const g = new THREE.Group();
  const mound = jitter(new THREE.IcosahedronGeometry(0.17, 1), [0.05, 0.03, 0.05]);
  part(g, mound, 0xd9602a, [0, 0.0, 0], [], [1.2, 0.4, 1.1]);
  part(g, mound, 0xb8352a, [0.12, 0.0, 0.07], [0, 1, 0], [0.8, 0.34, 0.8]);
  part(g, mound, 0xe6b03a, [-0.11, 0.0, 0.08], [0, 2, 0], [0.75, 0.32, 0.75]);
  for (let i = 0; i < 7; i++) part(g, leafShape(), LEAF_COLS[i], [Math.cos(i * 0.9) * 0.14, 0.06 + (i % 2) * 0.01, Math.sin(i * 0.9) * 0.12], [-1.2, i * 0.9, 0], 0.12);
  return g;
}

/** A harvest wreath, chunkier than decor's: its ring and bow with big maple leaves and berries. ~0.36 across, faces +z. */
function makeBigWreath() {
  const g = makeHarvestWreath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    part(g, leafShape(), LEAF_COLS[i % 7], [Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.045], [0, 0, a - Math.PI / 2], 0.11);
  }
  for (const [x, y] of [[-0.09, 0.08], [0.1, 0.07], [0, 0.135]]) part(g, ballGeo, 0xb8262a, [x, y, 0.06], [], 0.45);
  part(g, new THREE.BoxGeometry(0.02, 0.1, 0.01), C.gold, [-0.025, -0.17, 0.045], [0, 0, 0.3]);
  part(g, new THREE.BoxGeometry(0.02, 0.1, 0.01), C.gold, [0.025, -0.17, 0.045], [0, 0, -0.3]);
  return g;
}

/** A turkey's parts: legs (still), body with head (pitches to peck, pivot at the hip), tail fan. */
function makeTurkeyParts() {
  const legs = new THREE.Group();
  for (const s of [-1, 1]) {
    part(legs, new THREE.CylinderGeometry(0.018, 0.016, 0.17, 5), 0xd98a3a, [s * 0.06, 0.085, 0]);
    for (const a of [-0.5, 0, 0.5]) part(legs, new THREE.BoxGeometry(0.014, 0.01, 0.06), 0xd98a3a, [s * 0.06 + Math.sin(a) * 0.025, 0.005, 0.025], [0, a, 0]);
  }
  const body = new THREE.Group();
  part(body, new THREE.SphereGeometry(0.16, 10, 8), 0x6b4426, [0, 0.1, 0], [], [1, 0.92, 1.15]);
  part(body, new THREE.SphereGeometry(0.12, 9, 7), 0x55331c, [0, 0.11, 0.09]);
  for (const s of [-1, 1]) {
    part(body, new THREE.SphereGeometry(0.11, 8, 6), 0x7a5232, [s * 0.14, 0.1, -0.01], [], [0.38, 0.78, 1.15]);
    part(body, new THREE.BoxGeometry(0.02, 0.04, 0.15), 0xe8dcc0, [s * 0.165, 0.05, -0.04]);
  }
  part(body, new THREE.CylinderGeometry(0.03, 0.045, 0.17, 6), 0x8a6a52, [0, 0.24, 0.14], [0.35, 0, 0]);
  part(body, new THREE.SphereGeometry(0.052, 8, 6), 0xbcc8da, [0, 0.33, 0.17]);
  part(body, new THREE.ConeGeometry(0.018, 0.05, 5), 0xe8b04a, [0, 0.325, 0.23], [Math.PI / 2, 0, 0]);
  part(body, ballGeo, 0xd02a24, [0, 0.27, 0.2], [], [0.6, 1.4, 0.7]);
  part(body, ballGeo, 0xd02a24, [0.015, 0.31, 0.225], [], [0.25, 0.9, 0.3]);
  for (const s of [-1, 1]) part(body, ballGeo, C.black, [s * 0.035, 0.345, 0.2], [], 0.16);
  part(body, new THREE.ConeGeometry(0.012, 0.08, 4), 0x2a1d14, [0, 0.12, 0.2], [Math.PI, 0, 0]);
  // the fan: eleven feathers, each striped dark, rust, dark, cream
  const tail = new THREE.Group();
  const bands = [[0.04, 0.16, 0.055, 0x4a2e1a], [0.16, 0.23, 0.075, 0xb5532a], [0.23, 0.255, 0.082, 0x2a1d14], [0.255, 0.32, 0.088, 0xeadcb8]];
  for (let i = 0; i < 11; i++) {
    const a = -1.3 + i * 0.26;
    for (const [r0, r1, w, c] of bands) {
      const mid = (r0 + r1) / 2;
      part(tail, new THREE.BoxGeometry(w, r1 - r0, 0.015), c, [Math.sin(a) * mid, Math.cos(a) * mid, (i % 2) * 0.006], [0, 0, -a]);
    }
  }
  return { legs: bake(legs).solid, body: bake(body).solid, tail: bake(tail).solid };
}

/** A golden turkey weathervane in profile (to +x), on its post and arms. ~0.75 tall (barn units). */
function makeWeathervane() {
  const g = new THREE.Group();
  const gold = 0xd9a441, copper = 0xb5652a, iron = 0x3f3a36;
  part(g, new THREE.CylinderGeometry(0.018, 0.024, 0.5, 6), iron, [0, 0.25, 0]);
  part(g, new THREE.BoxGeometry(0.34, 0.02, 0.02), iron, [0, 0.28, 0]);
  part(g, new THREE.BoxGeometry(0.02, 0.02, 0.34), iron, [0, 0.28, 0]);
  part(g, new THREE.SphereGeometry(0.035, 8, 6), gold, [0, 0.4, 0]);
  part(g, new THREE.BoxGeometry(0.56, 0.018, 0.018), iron, [0, 0.45, 0]);
  part(g, new THREE.ConeGeometry(0.035, 0.08, 4), iron, [0.3, 0.45, 0], [0, 0, -Math.PI / 2]);
  part(g, new THREE.BoxGeometry(0.06, 0.08, 0.012), iron, [-0.28, 0.45, 0]);
  // the turkey
  part(g, new THREE.SphereGeometry(0.11, 10, 8), gold, [0.02, 0.58, 0], [], [1.25, 0.95, 0.35]);
  part(g, new THREE.CylinderGeometry(0.022, 0.03, 0.12, 6), gold, [0.13, 0.66, 0], [0, 0, -0.5]);
  part(g, new THREE.SphereGeometry(0.035, 8, 6), gold, [0.17, 0.72, 0], [], [1, 1, 0.5]);
  part(g, new THREE.ConeGeometry(0.012, 0.04, 4), copper, [0.21, 0.715, 0], [0, 0, -Math.PI / 2]);
  part(g, ballGeo, 0xc83a2a, [0.185, 0.68, 0], [], [0.3, 0.6, 0.25]);
  for (let i = 0; i < 9; i++) {
    const a = -0.35 - i * 0.24; // fanned up and back
    for (const [r0, r1, w, c] of [[0.03, 0.17, 0.05, gold], [0.17, 0.21, 0.06, copper], [0.21, 0.26, 0.064, gold]]) {
      const mid = (r0 + r1) / 2;
      part(g, new THREE.BoxGeometry(w, r1 - r0, 0.012), c, [-0.06 + Math.sin(a) * mid, 0.6 + Math.cos(a) * mid, (i % 2) * 0.004], [0, 0, -a]);
    }
  }
  for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.012, 0.06, 0.012), gold, [0.02 + s * 0.03, 0.49, 0]);
  return g;
}

/** A pilgrim hat: tall black crown, wide brim, dark band and a gold buckle (at the front, +z). */
function makePilgrimHat() {
  // (tilted inside a holder: bake() keeps the holder's children as they sit in it)
  const holder = new THREE.Group();
  const g = new THREE.Group();
  g.rotation.x = -0.12;
  holder.add(g);
  part(g, new THREE.CylinderGeometry(0.165, 0.165, 0.024, 18), C.black, [0, 0.012, 0]);
  part(g, new THREE.CylinderGeometry(0.084, 0.1, 0.23, 16), 0x262220, [0, 0.135, 0]);
  part(g, new THREE.CylinderGeometry(0.085, 0.085, 0.012, 16), C.black, [0, 0.256, 0]);
  part(g, new THREE.CylinderGeometry(0.097, 0.101, 0.05, 16), 0x4a3a2e, [0, 0.05, 0]);
  // a big gold buckle at the front, with its dark middle
  part(g, new THREE.BoxGeometry(0.09, 0.066, 0.016), 0xf0c040, [0, 0.05, 0.098]);
  part(g, new THREE.BoxGeometry(0.05, 0.032, 0.018), 0x262220, [0, 0.05, 0.1]);
  return holder;
}

/** A crown of big autumn leaves flaring up off a twig band, with wheat ears and red berries at the front. */
function makeLeafCrown() {
  const g = new THREE.Group();
  part(g, new THREE.TorusGeometry(0.1, 0.018, 5, 16), C.brown, [0, 0.02, 0], [Math.PI / 2, 0, 0]);
  const cols = [0xe0662a, 0xc23a22, 0xe8bf3a, 0xd4502a, 0xe89a2c, 0x9a2a1e];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, tall = i % 2 === 0;
    const leaf = new THREE.Group();
    leaf.position.set(Math.sin(a) * 0.1, tall ? 0.075 : 0.06, Math.cos(a) * 0.1);
    leaf.rotation.set(0, a, 0);
    part(leaf, leafShape(), cols[i % cols.length], [0, 0, 0], [0.28, 0, 0], tall ? 0.14 : 0.115);
    g.add(leaf);
  }
  // wheat ears either side of the front, berries in the middle
  for (const s of [-1, 1]) part(g, ballGeo, C.wheatHead, [s * 0.045, 0.085, 0.112], [0, 0, s * 0.35], [0.45, 1.5, 0.45]);
  for (const [x, y] of [[-0.02, 0.03], [0.02, 0.034], [0, 0.055]]) part(g, ballGeo, 0xb8262a, [x, y, 0.122], [], 0.45);
  return g;
}

// ---------------------------------------------------------------- the theme

export default function build(ctx) {
  const root = new THREE.Group();
  const geos = [];
  const keep = (geo) => { if (geo) geos.push(geo); return geo; };
  const VC = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, side: THREE.DoubleSide });
  const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  GLOW.userData.noSeason = true;
  const home = ctx.home;
  const H = (x, z) => ctx.heightAt(x, z);
  const rand = rng(1121);

  // ---- where things may go (fence things sit just outside a fence, never in a field)
  const inRing = (x, z, ring) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    return ins;
  };
  const inField = (x, z) => ctx.fields.some((f) => f.rings.some((ring) => inRing(x, z, ring)));
  const nearObstacle = (x, z, r) => (ctx.view.obstacles || []).some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r);
  const okFence = (x, z, r = 0.12) => !inField(x, z) && !nearObstacle(x, z, r);

  // ---- one baked mesh per placed thing
  const geoCache = new Map();
  const baked = (key, make) => {
    if (!geoCache.has(key)) { const b = bake(make()); keep(b.solid); keep(b.glow); geoCache.set(key, b); }
    return geoCache.get(key);
  };
  /** A placed thing: a group at (x, z) on the ground holding the baked mesh (and its glow). */
  function place(name, b, x, z, ry = 0, { cast = true, flag } = {}) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, H(x, z), z);
    g.rotation.y = ry;
    g.add(mesh(b.solid, VC, cast, true));
    if (b.glow) g.add(mesh(b.glow, GLOW, false, false));
    if (flag) g.userData[flag] = true;
    root.add(g);
    return g;
  }

  // ---- repeated things: one InstancedMesh per kind, popped in here
  const insts = [];
  const tint = new THREE.Color();
  function instanced(name, geo, items, { parent = root, flag, delay } = {}) {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(geo, VC, items.length);
    im.name = name;
    im.frustumCulled = false;
    im.castShadow = false;
    im.receiveShadow = true;
    im.userData.noPop = true;
    if (flag) im.userData[flag] = true;
    const e = new THREE.Euler();
    const data = items.map((it, i) => {
      if (Array.isArray(it.c)) im.setColorAt(i, tint.setRGB(...it.c));
      else im.setColorAt(i, tint.set(it.c ?? 0xffffff));
      const s = it.s ?? 1;
      return {
        p: new THREE.Vector3(it.x, it.y, it.z),
        q: new THREE.Quaternion().setFromEuler(e.set(it.rx || 0, it.ry || 0, it.rz || 0)),
        s: Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s),
        d: delay ? delay(it, i) : clamp01(Math.hypot(it.x - home[0], it.z - home[1]) / 8) * 0.42,
      };
    });
    parent.add(im);
    insts.push({ im, data });
    return im;
  }
  const _mm = new THREE.Matrix4(), _sv = new THREE.Vector3();
  function popInstances(k) {
    for (const { im, data } of insts) {
      for (let i = 0; i < data.length; i++) {
        const it = data[i], kk = clamp01((k - it.d) / 0.55);
        const e = kk <= 0 ? 1e-4 : kk >= 1 ? 1 : Math.max(1e-4, easeOutBack(kk));
        im.setMatrixAt(i, _mm.compose(it.p, it.q, _sv.copy(it.s).multiplyScalar(e)));
      }
      im.instanceMatrix.needsUpdate = true;
    }
  }

  // shared geometries for the repeated kinds
  const G = {
    shock: keep(bake(makeCornShock(1)).solid),
    pumpkin: keep(bake((() => { const g = new THREE.Group(); addPumpkin(g, 0, 0, 0, 1, 0xffffff); return g; })()).solid),
    wreath: keep(bake(makeBigWreath()).solid),
    leaf: keep(bake((() => { const g = new THREE.Group(); part(g, leafShape(), 0xffffff); return g; })()).solid),
    pile: keep(bake(makeLeafPile()).solid),
    sheaf: keep(bake(makeWheatSheaf()).solid),
  };
  const shocks = [], pumpkins = [], wreaths = [], leaves = [], piles = [], sheaves = [];
  const PUMPKIN_TINTS = [[0.91, 0.25, 0.03], [0.68, 0.13, 0.01], [0.95, 0.45, 0.05], [0.9, 0.82, 0.62]];
  const pumpkinAt = (x, z, s = 0.85, y = H(x, z)) => pumpkins.push({ x, y, z, ry: rand() * 6, s, c: PUMPKIN_TINTS[pumpkins.length % 4] });
  const leafColor = () => LEAF_COLS[Math.floor(rand() * LEAF_COLS.length)];
  const leafAt = (x, y, z, s = 0.12, flat = false) => leaves.push({ x, y, z, rx: flat ? -Math.PI / 2 + (rand() - 0.5) * 0.5 : (rand() - 0.5) * 2.4, ry: rand() * 6.283, rz: rand() * 6.283, s: s * (0.85 + rand() * 0.4), c: leafColor() });
  /** A swag of leaves hanging between two points (sagging), two rows thick. */
  const swag = (a, b, sag = 0.07, size = 0.12, spacing = 0.055) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(2, Math.round(len / spacing));
    for (let k = 0; k <= n; k++) {
      const t = k / n, dip = Math.sin(t * Math.PI) * sag;
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t - dip, z = a[2] + (b[2] - a[2]) * t;
      leafAt(x, y, z, size);
      if (k % 2) leafAt(x + (rand() - 0.5) * 0.03, y - 0.035, z + (rand() - 0.5) * 0.03, size * 0.9);
    }
  };

  // ---------------------------------------------------------------- the centrepiece, the table, the wagon
  // (each big thing also keeps the grass clear out to its real size, so nothing is put in it)
  const [cs] = ctx.spots(1, { r: 0.7, from: 2, to: 5 });
  if (cs) {
    place('Cornucopia', baked('cornucopia', makeCornucopia), cs[0], cs[1], 0).scale.setScalar(1.18);
    ctx.take(cs[0], cs[1], 1.25, { block: false });
  }
  let [ts] = ctx.spots(1, { r: 1.05, from: 1.6, to: 5.5, front: 1 });
  if (!ts) [ts] = ctx.spots(1, { r: 0.9, from: 1.6, to: 6.5 });
  if (ts) {
    place('Harvest table', baked('table', makeHarvestTable), ts[0], ts[1], 0);
    ctx.take(ts[0], ts[1], 1.2, { block: false });
    // a tall corn shock at either end, so the table reads from afar
    for (const s of [-1, 1]) {
      const x = ts[0] + s * 1.32, z = ts[1] - 0.1;
      if (okFence(x, z, 0.2)) { shocks.push({ x, y: H(x, z), z, ry: rand() * 6, s: 1.05 }); ctx.take(x, z, 0.2); }
    }
  }
  // (the wagon, its tongue included, centred on its spot)
  const [ws] = ctx.spots(1, { r: 0.9, from: 2.2, to: 6.5, front: 0.8 });
  if (ws) {
    place('Hay wagon', baked('wagon', () => { const w = new THREE.Group(), g = makeHayWagon(); g.position.x = -0.25; w.add(g); return w; }), ws[0], ws[1], 0.45);
    ctx.take(ws[0], ws[1], 1.0, { block: false });
  }

  // ---------------------------------------------------------------- the paths: hay bales with pumpkins (before the turkeys take the spots)
  ctx.pathSpots(14, { r: 0.32, spacing: 1.25 }).forEach(([x, z], i) => {
    place('Harvest bale', baked(`bale${i % 2}`, () => makeBaleDisplay(i % 2)), x, z, (i % 3 - 1) * 0.5, { cast: true });
  });
  // ---------------------------------------------------------------- turkeys strutting and pecking
  const tp = makeTurkeyParts();
  keep(tp.legs); keep(tp.body); keep(tp.tail);
  const turkeys = [];
  const tSpots = ctx.spots(4, { r: 0.55, from: 1.5, to: 4.2, spacing: 1.1 }).concat(ctx.spots(3, { r: 0.55, from: 3.8, to: 6.8, spacing: 1.5 }));
  tSpots.forEach(([x, z], i) => {
    const g = new THREE.Group();
    g.name = 'Turkey';
    g.position.set(x, H(x, z), z);
    const walker = new THREE.Group();
    walker.add(mesh(tp.legs, VC, false, false));
    const pivot = new THREE.Group();
    pivot.position.y = 0.16;
    pivot.add(mesh(tp.body, VC, true, false));
    const tail = mesh(tp.tail, VC, true, false);
    tail.position.set(0, 0.14, -0.13);
    tail.rotation.x = -0.3;
    pivot.add(tail);
    walker.add(pivot);
    g.add(walker);
    g.scale.setScalar(1.05);
    root.add(g);
    turkeys.push({ walker, pivot, tail, phase: i * 0.37 + rand(), a0: rand() * 6.283, dir: i % 2 ? 1 : -1, R: 0.22 });
  });

  // ---------------------------------------------------------------- fences: garlands, shocks at corners and gates, pumpkins
  const scarecrowSpots = [];
  ctx.fields.forEach((f, fi) => {
    const ring = f.ring;
    if (!ring) return;
    const [cx, cz] = f.center;
    const gate = f.gate;
    const nearGate = (x, z, d) => gate && Math.hypot(x - gate.x, z - gate.z) < d;
    // the corners: the sharpest turns of the fence
    const corners = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[(i - 1 + ring.length) % ring.length], v = ring[i], q = ring[(i + 1) % ring.length];
      const a1 = Math.atan2(v[1] - p[1], v[0] - p[0]), a2 = Math.atan2(q[1] - v[1], q[0] - v[0]);
      let turn = Math.abs(a2 - a1);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn < 0.45) continue;
      // outward: the two edges' normals, pointing away from the middle of the field
      const nrm = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; let nx = dz / l, nz = -dx / l; if (nx * (v[0] - cx) + nz * (v[1] - cz) < 0) { nx = -nx; nz = -nz; } return [nx, nz]; };
      const n1 = nrm(v[0] - p[0], v[1] - p[1]), n2 = nrm(q[0] - v[0], q[1] - v[1]);
      const l = Math.hypot(n1[0] + n2[0], n1[1] + n2[1]) || 1;
      corners.push({ v, turn, n: [(n1[0] + n2[0]) / l, (n1[1] + n2[1]) / l] });
    }
    corners.sort((a, b) => b.turn - a.turn);
    const chosen = [];
    for (const c of corners) {
      if (chosen.length >= 5) break;
      if (chosen.some((o) => Math.hypot(o.v[0] - c.v[0], o.v[1] - c.v[1]) < 0.9)) continue;
      const x = c.v[0] + c.n[0] * 0.27, z = c.v[1] + c.n[1] * 0.27;
      if (nearGate(x, z, 0.7) || !okFence(x, z, 0.1)) continue;
      chosen.push(c);
      shocks.push({ x, y: H(x, z), z, ry: rand() * 6, s: 0.95 });
      // a big pumpkin out in front of the shock and a smaller one beside it
      const px = c.v[0] + c.n[0] * 0.6, pz = c.v[1] + c.n[1] * 0.6;
      if (okFence(px, pz, 0.1)) pumpkinAt(px, pz, 1.1);
      const tx = -c.n[1], tz = c.n[0];
      const qx = c.v[0] + c.n[0] * 0.48 + tx * 0.24, qz = c.v[1] + c.n[1] * 0.48 + tz * 0.24;
      if (okFence(qx, qz, 0.1)) pumpkinAt(qx, qz, 0.7);
      ctx.take(x, z, 0.22);
    }
    // the gate: a shock either side under an arch of leaves, pumpkins at their feet
    if (gate) {
      const nl = Math.hypot(gate.nx, gate.nz) || 1, nx = gate.nx / nl, nz = gate.nz / nl, tx = -nz, tz = nx;
      const ends = [];
      for (const s of [-1, 1]) {
        const x = gate.x + nx * 0.22 + tx * s * 0.45, z = gate.z + nz * 0.22 + tz * s * 0.45;
        if (inField(x, z)) continue;
        shocks.push({ x, y: H(x, z), z, ry: rand() * 6, s: 0.92 });
        ends.push([x, H(x, z) + 0.66, z]);
        ctx.take(x, z, 0.2);
        const px = gate.x + nx * 0.34 + tx * s * 0.72, pz = gate.z + nz * 0.34 + tz * s * 0.72;
        if (okFence(px, pz, 0.1)) pumpkinAt(px, pz, 0.9);
      }
      if (ends.length === 2) {
        const [a, b] = ends, top = Math.max(a[1], b[1]) + 0.32;
        const n = 26;
        for (let k = 0; k <= n; k++) {
          const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
          const y = a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * (top - Math.max(a[1], b[1]));
          leafAt(x, y, z, 0.19);
          leafAt(x + nx * 0.03, y - 0.05, z + nz * 0.03, 0.17);
          if (k % 2) leafAt(x - nx * 0.03, y + 0.04, z - nz * 0.03, 0.15);
        }
        // a wreath hanging from the top of the arch, facing out
        wreaths.push({ x: (a[0] + b[0]) / 2 + nx * 0.05, y: top - 0.2, z: (a[2] + b[2]) / 2 + nz * 0.05, ry: Math.atan2(nx, nz), s: 1.05 });
      }
    }
    // the garland all along the fence (not across the gate)
    const line = ctx.fenceLine(f, { outset: 0.05, step: 0.45 });
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      if (nearGate((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, 0.5)) continue;
      swag(a, b, 0.08, 0.15);
      // a rosette at each post-ish point
      for (let k = 0; k < 3; k++) leafAt(a[0], a[1] + 0.02, a[2], 0.19);
    }
    // a harvest wreath hung on the outside of the rails every so often, facing out
    let hung = 0.9;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      hung += Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (hung < 1.7) continue;
      if (nearGate(a[0], a[2], 0.75) || chosen.some((c) => Math.hypot(c.v[0] - a[0], c.v[1] - a[2]) < 0.5)) continue;
      let ox = b[2] - a[2], oz = -(b[0] - a[0]);
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol; oz /= ol;
      if (ox * (a[0] - cx) + oz * (a[2] - cz) < 0) { ox = -ox; oz = -oz; }
      hung = 0;
      wreaths.push({ x: a[0] + ox * 0.05, y: a[1] - 0.07, z: a[2] + oz * 0.05, ry: Math.atan2(ox, oz), s: 0.85 });
    }
    // pumpkins along the foot of the fence
    const foot = ctx.fenceLine(f, { outset: 0.2, step: 0.3 });
    let run = 0;
    for (let i = 1; i < foot.length; i++) {
      run += Math.hypot(foot[i][0] - foot[i - 1][0], foot[i][2] - foot[i - 1][2]);
      if (run < 0.95) continue;
      const [x, , z] = foot[i];
      if (nearGate(x, z, 0.85) || chosen.some((c) => Math.hypot(c.v[0] - x, c.v[1] - z) < 0.6) || !okFence(x, z, 0.1)) continue;
      run = 0;
      pumpkinAt(x, z, 0.85 + rand() * 0.3);
    }
    // a scarecrow at the field's front edge
    const cands = ctx.fenceLine(f, { outset: 0.62, step: 0.35 }).sort((p, q) => q[2] - p[2]);
    for (const [x, , z] of cands) {
      if (nearGate(x, z, 1.0) || chosen.some((c) => Math.hypot(c.v[0] - x, c.v[1] - z) < 0.7)) continue;
      if (!ctx.free(x, z, 0.28)) continue;
      ctx.take(x, z, 0.35);
      const ox = x - cx, oz = z - cz, l = Math.hypot(ox, oz) || 1;
      scarecrowSpots.push({ x, z, ry: Math.atan2((ox / l) * 0.6, (oz / l) * 0.6 + 0.45), fi });
      break;
    }
  });
  const SHIRTS = [0xb8352a, 0xc8632a, 0x8a2c3a, 0xb8352a, 0x7a4a26, 0xc8632a];
  scarecrowSpots.slice(0, 6).forEach((s, i) => {
    const o = place('Scarecrow', baked(`scarecrow${i % 3}`, () => makePlaidScarecrow(SHIRTS[i % 3])), s.x, s.z, s.ry);
    o.scale.setScalar(1.12);
  });

  // ---------------------------------------------------------------- buildings: wreath, shocks, swag, pumpkins
  const v = new THREE.Vector3();
  /** The building's shape in its own frame (front +z), from its object on the island if found. */
  function shapeOf(b) {
    const wrap = (ctx.view.island?.children || []).find((o) => o.userData.finalScale != null && Math.abs(o.position.x - b.x) < 0.02 && Math.abs(o.position.z - b.z) < 0.02 && o.children.length);
    if (!wrap) return null;
    wrap.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(wrap.matrixWorld).invert();
    const s = wrap.userData.finalScale || b.scale || ctx.scale;
    const pts = [];
    // (not the windmill's sails: they turn, and they'd make the tower look as wide as they are)
    const spin = new Set(ctx.view.spinners || []);
    const turning = (o) => { for (let p = o; p && p !== wrap; p = p.parent) if (spin.has(p)) return true; return false; };
    wrap.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes?.position || turning(o)) return;
      const p = o.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const step = Math.max(1, Math.floor(p.count / 3000));
      for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(m); pts.push(v.x * s, v.y * s, v.z * s); }
    });
    return pts.length ? pts : null;
  }
  const frontZ = (pts, fx, y0, y1) => { let z = -Infinity; for (let i = 0; i < pts.length; i += 3) if (Math.abs(pts[i]) < fx && pts[i + 1] > y0 && pts[i + 1] < y1 && pts[i + 2] > z) z = pts[i + 2]; return z; };
  const spanX = (pts, y1) => { let a = Infinity, b = -Infinity; for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] < y1) { a = Math.min(a, pts[i]); b = Math.max(b, pts[i]); } return [a, b]; };
  for (const b of ctx.buildings) {
    if (NOT_BUILDINGS.has(b.key) || (b.key === 'barn' && ctx.barn) || (b.height || 0) < 0.5) continue;
    const h = b.height || 1.2, round = ROUND.has(b.key);
    const pts = shapeOf(b);
    const wy = Math.min(1.1, Math.max(0.35, h * 0.5));
    let fz = b.r * 0.72, fz0 = b.r * 0.75, x0 = -b.r * 0.75, x1 = b.r * 0.75;
    if (pts) {
      const z1 = frontZ(pts, 0.3, wy - 0.12, wy + 0.12), z0 = frontZ(pts, 10, -1, 0.4);
      if (z1 > -Infinity) fz = z1;
      if (z0 > -Infinity) fz0 = z0;
      [x0, x1] = spanX(pts, 0.4);
    }
    const c = Math.cos(b.ry || 0), s = Math.sin(b.ry || 0);
    const W = (lx, lz) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
    const gy = b.y ?? H(b.x, b.z);
    const [wx, wz] = W(0, fz + 0.035);
    wreaths.push({ x: wx, y: gy + wy, z: wz, ry: b.ry || 0, s: round ? 1.4 : 1.65 });
    for (const [lx, side] of [[x0 - 0.14, -1], [x1 + 0.14, 1]]) {
      const [x, z] = W(lx, fz0 + 0.12);
      if (inField(x, z)) continue;
      shocks.push({ x, y: H(x, z), z, ry: rand() * 6, s: 0.95 });
      // a big pumpkin and a small one at its foot
      const [px, pz] = W(lx - side * 0.28, fz0 + 0.3);
      if (!inField(px, pz)) pumpkinAt(px, pz, 1.0);
      const [qx, qz] = W(lx + side * 0.02, fz0 + 0.44);
      if (!inField(qx, qz)) pumpkinAt(qx, qz, 0.65);
    }
    if (!round) {
      // two leaf swags across the front, one under the other
      const sy = Math.min(h * 0.8, wy + 0.32);
      let sz = fz;
      if (pts) { const z2 = frontZ(pts, Math.max(-x0, x1), sy - 0.1, sy + 0.1); if (z2 > -Infinity) sz = z2; }
      const [ax, az] = W(x0 + 0.08, sz + 0.05), [bx, bz] = W(x1 - 0.08, sz + 0.05);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      swag([ax, gy + sy, az], [mx, gy + sy, mz], 0.12, 0.16);
      swag([mx, gy + sy, mz], [bx, gy + sy, bz], 0.12, 0.16);
      for (let k = 0; k < 4; k++) leafAt(mx, gy + sy + 0.02, mz, 0.2);
    } else {
      // a belt of leaves round a silo or a windmill's tower, scalloped
      const by = Math.min(h * 0.72, wy + 0.34);
      let R = 0;
      if (pts) for (let i = 0; i < pts.length; i += 3) if (Math.abs(pts[i + 1] - by) < 0.08) R = Math.max(R, Math.hypot(pts[i], pts[i + 2]));
      if (!R || R > b.r * 1.1) R = Math.min(R || Infinity, b.r * 0.72); // (never wider than the building itself)
      const n = Math.max(24, Math.round((Math.PI * 2 * R) / 0.05));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, dip = Math.abs(Math.sin(a * 4)) * 0.08;
        const x = b.x + Math.cos(a) * (R + 0.03), z = b.z + Math.sin(a) * (R + 0.03);
        leafAt(x, gy + by - dip, z, 0.16);
        if (k % 2) leafAt(x, gy + by - dip - 0.05, z, 0.14);
      }
    }
  }

  // ---------------------------------------------------------------- lamps: wreath, leaves up the post, a shock and a pumpkin
  for (const l of ctx.lamps) {
    const [x, z] = l.at || [];
    if (x == null) continue;
    const y = H(x, z);
    wreaths.push({ x, y: y + 0.72, z: z + 0.05, s: 1.05 });
    for (let k = 0; k < 24; k++) {
      const a = k * 0.8, yy = 0.12 + k * 0.038;
      leafAt(x + Math.cos(a) * 0.055, y + yy, z + Math.sin(a) * 0.055, 0.1);
    }
    const sx = x - 0.27, sz = z - 0.06;
    if (!inField(sx, sz)) shocks.push({ x: sx, y: H(sx, sz), z: sz, ry: rand() * 6, s: 0.75 });
    if (!inField(x + 0.14, z + 0.16)) pumpkinAt(x + 0.14, z + 0.16, 0.7);
  }

  // ---------------------------------------------------------------- trees: leaf heaps and loose leaves
  for (const t of ctx.trees) {
    const r = t.r || 0.35;
    for (let k = 0; k < 5; k++) {
      const a = k * 1.257 + rand() * 0.6, d = r * 0.9 + 0.1 + rand() * 0.25;
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (inField(x, z)) continue;
      piles.push({ x, y: H(x, z), z, ry: rand() * 6, s: 1.0 + rand() * 0.45 });
    }
    for (let k = 0; k < 70; k++) {
      const a = rand() * 6.283, d = r * 0.5 + Math.sqrt(rand()) * (r + 1.0);
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (inField(x, z)) continue;
      leafAt(x, H(x, z) + 0.012, z, 0.2, true);
    }
  }

  // wheat sheaves along the paths and round the farmyard
  for (const [x, z] of ctx.pathSpots(12, { r: 0.17, spacing: 1.0 })) sheaves.push({ x, y: H(x, z), z, ry: rand() * 6, s: 1.3 });
  for (const [x, z] of ctx.spots(10, { r: 0.18, from: 1.6, to: 7, spacing: 1.5 })) sheaves.push({ x, y: H(x, z), z, ry: rand() * 6, s: 1.3 });

  // ---------------------------------------------------------------- the open grass: pumpkin heaps, leaf piles
  ctx.spots(10, { r: 0.36, from: 2.6, to: 7.2, spacing: 1.6 }).forEach(([x, z], i) => place('Pumpkin heap', baked(`heap${i % 3}`, () => makePumpkinHeap(i % 3 + 1)), x, z, rand() * 6, { cast: false }));
  for (const [x, z] of ctx.spots(30, { r: 0.24, from: 1.3, to: 7.5, spacing: 1.05, block: false })) {
    piles.push({ x, y: H(x, z), z, ry: rand() * 6, s: 0.9 + rand() * 0.5 });
    for (let k = 0; k < 5; k++) {
      const a = rand() * 6.283, d = 0.25 + rand() * 0.35, lx = x + Math.cos(a) * d, lz = z + Math.sin(a) * d;
      if (!inField(lx, lz)) leafAt(lx, H(lx, lz) + 0.012, lz, 0.15, true);
    }
  }

  instanced('Corn shocks', G.shock, shocks, { flag: 'onFence' });
  instanced('Pumpkins', G.pumpkin, pumpkins, { flag: 'onFence' });
  instanced('Harvest wreaths', G.wreath, wreaths, { flag: 'onBuilding' });
  instanced('Autumn leaves', G.leaf, leaves, { flag: 'onFence' });
  instanced('Leaf heaps', G.pile, piles, { flag: 'onBuilding' });
  instanced('Wheat sheaves', G.sheaf, sheaves);

  // ---------------------------------------------------------------- the barn: shocks at the corners, leaves on the ridge and over the door, a weathervane
  let barnBits = null, vane = null;
  if (ctx.barn) {
    barnBits = new THREE.Group();
    barnBits.name = 'Thanksgiving barn';
    const bDelay = (_, i) => 0.1 + (i % 12) * 0.03;
    instanced('Barn corn shocks', G.shock, [[-1.38, 0.92], [1.32, 0.92], [-1.32, -0.86], [1.32, -0.86]].map(([x, z]) => ({ x, y: 0, z, ry: rand() * 6, s: 1.2 })), { parent: barnBits, delay: bDelay });
    instanced('Barn pumpkins', G.pumpkin, [[-1.6, 1.08, 1.1], [-1.4, 1.28, 0.8], [1.58, 1.1, 1.05], [1.2, 1.24, 0.85]].map(([x, z, s], i) => ({ x, y: 0, z, ry: i * 1.7, s, c: PUMPKIN_TINTS[i % 4] })), { parent: barnBits, delay: bDelay });
    const keepLeaves = leaves.length;
    for (let k = 0; k <= 46; k++) {
      const x = -1.36 + (k / 46) * 2.72;
      leafAt(x, 2.36 + rand() * 0.03, (rand() - 0.5) * 0.16, 0.18);
      if (k % 2) leafAt(x, 2.32, (k % 4 ? 1 : -1) * 0.1, 0.16);
    }
    swag([-0.5, 1.08, 1.21], [0.5, 1.08, 1.21], 0.13, 0.17, 0.05);
    instanced('Barn leaves', G.leaf, leaves.splice(keepLeaves), { parent: barnBits, delay: (_, i) => 0.15 + (i / 140) * 0.3 });
    const vb = bake(makeWeathervane());
    keep(vb.solid);
    vane = mesh(vb.solid, VC, true, false);
    vane.name = 'Turkey weathervane';
    vane.position.set(-0.55, 2.33, 0);
    barnBits.add(vane);
  }

  // ---------------------------------------------------------------- the sheep's costumes
  const wear = [];
  const wearGeo = (i) => { if (!wear[i]) wear[i] = keep(bake(i ? makeLeafCrown() : makePilgrimHat()).solid); return wear[i]; };
  function sheepWear(i) {
    const m = mesh(wearGeo(i % 2), VC, false, false);
    m.name = i % 2 ? 'Leaf crown' : 'Pilgrim hat';
    return m;
  }

  // ---------------------------------------------------------------- every frame
  let lastK = -1;
  function update(dt, time, { night = 0, k = 1 } = {}) {
    if (k <= 0) return;
    if (k !== lastK) {
      popInstances(k);
      if (vane) vane.scale.setScalar(Math.max(1e-4, easeOutBack(clamp01((k - 0.3) / 0.6))));
      lastK = k;
    }
    // lanterns and candles glow brighter at night, with a little flicker
    GLOW.color.setScalar(0.6 + 0.4 * night + 0.06 * night * Math.sin(time * 13.7));
    if (vane) vane.rotation.y = Math.sin(time * 0.33) * 0.45 + Math.sin(time * 1.4) * 0.06;
    // turkeys: strut a little way round their spot, stop, peck, fan the tail
    for (const t of turkeys) {
      const u = time * 0.3 + t.phase, cyc = Math.floor(u), f = u - cyc;
      const w = f < 0.55 ? smooth(f / 0.55) : 1;
      const a = t.a0 + (cyc + w) * 1.1 * t.dir;
      t.walker.position.set(Math.cos(a) * t.R, f < 0.55 ? Math.abs(Math.sin(f * 40)) * 0.012 : 0, Math.sin(a) * t.R);
      t.walker.rotation.y = Math.atan2(-Math.sin(a) * t.dir, Math.cos(a) * t.dir);
      t.pivot.rotation.x = f < 0.55 ? Math.sin(f * 40) * 0.05 : 0.95 * Math.max(0, Math.sin(((f - 0.55) / 0.45) * Math.PI * 3)) ** 0.7;
      const fan = 0.5 + 0.5 * Math.sin(time * 0.9 + t.phase * 3);
      t.tail.scale.set(0.86 + 0.18 * fan, 0.94 + 0.08 * fan, 1);
    }
  }

  function dispose() {
    for (const g of geos) g.dispose();
    VC.dispose();
    GLOW.dispose();
    root.clear();
    barnBits?.clear();
  }

  return { root, barnBits, update, lampColors: [0xffb347, 0xff8a2a], sheepWear, dispose };
}
