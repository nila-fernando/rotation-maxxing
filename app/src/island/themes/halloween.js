// The Halloween theme: the whole farm dressed up spooky-cute (see ./index.js for the contract).
//
//   everywhere  big white cobwebs (building corners, gates, fence corners, trees, lamp posts) with
//               fat black spiders bobbing on threads, orange and purple lights along every fence
//               and eave, jack-o'-lanterns on the paths, gate and corner posts, rooftops, lamp
//               feet and the grass, a black cat up on the barn's ridge
//   centre      a giant jack-o'-lantern in a witch's hat, glowing from inside
//   about       skeleton scarecrows by the fields, skeletons on hay bales and fence rails, a
//               graveyard with an iron fence and hands poking out of the ground, twisted bare trees
//               with bats, floating ghosts, a bubbling green cauldron, black cats with glowing eyes
//   sheep       witch hats, pumpkin hats and little devil horns
//
// To keep draw calls down each placed thing is built from plain shapes and then baked into one
// vertex-coloured mesh per material (lit, warm glow, toxic glow, eyes); things repeated all over
// the island (webs, spiders, lights, pumpkins, ghosts, bats) are one mesh or InstancedMesh each.
import * as THREE from 'three';
import { makeHayBale, rng } from '../props.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// colours
const ORANGE = 0xf27a1e;
const PUMPKIN = [0xf27a1e, 0xf08a2a, 0xe56a17];
const STEM = 0x5c6b2a;
const LEAF = 0x5e8a2e;
const FACE = 0xffc04a;
const HAT = 0x2a2235;
const PURPLE = 0x8e4ad0;
const GOLD = 0xe9c94a;
const BONE = 0xf2ead2;
const SOCKET = 0x1c1620;
const BLACK = 0x1e1a24;
const BARK = 0x3a2e40;
const IRON = 0x2a2630;
const WOOD = 0x7d5e45;
const STONE = [0x9a97a8, 0x8a879a, 0xa8a5b5];
const TOXIC = 0x8aff3c;
const EYE = 0xd8ff3a;

// ---------------------------------------------------------------- building blocks

/** A part to be baked: a mesh with only a colour and a material kind (lit, warm, toxic, eyes). */
function P(geo, color, kind = 'lit') {
  const m = new THREE.Mesh(geo);
  m.userData.c = color;
  m.userData.k = kind;
  return m;
}
function put(o, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.scale.set(sx, sy, sz);
  return o;
}
/** A tapered rod from a to b (r at a, r2 at b), with ball joints if knob. */
function rod(g, a, b, r, color, { r2 = r, knob = 0, seg = 5, kind = 'lit' } = {}) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length() || 0.001;
  const m = P(new THREE.CylinderGeometry(r2, r, len, seg), color, kind);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  g.add(m);
  if (knob) for (const p of [a, b]) g.add(put(P(new THREE.SphereGeometry(knob, 6, 4), color, kind), p.x, p.y, p.z));
  return m;
}
const ball = (g, r, color, x, y, z, sx = 1, sy = sx, sz = sx, kind = 'lit') => g.add(put(P(new THREE.SphereGeometry(r, 8, 6), color, kind), x, y, z, 0, 0, 0, sx, sy, sz));
const block = (g, w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0) => g.add(put(P(new THREE.BoxGeometry(w, h, d), color), x, y, z, rx, ry, rz));

/** Joins non-indexed geometries (position, normal, color) into one. */
function concat(list) {
  const total = list.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
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
 * Bakes every mesh under `group` into one geometry per material kind, in the group's own space,
 * with the colours as vertex colours. Meshes from the shared makers count too (basic = warm glow).
 */
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
function bakeGeos(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = {};
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const kind = o.userData.k || (o.material?.isMeshBasicMaterial ? 'warm' : 'lit');
    const color = o.userData.c ?? o.material?.color?.getHex() ?? 0xffffff;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    _m.multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(_m);
    if (_m.determinant() < 0) {
      // mirrored: swap two corners of each triangle so it still faces out
      for (const a of [g.attributes.position, g.attributes.normal]) {
        const arr = a.array;
        for (let i = 0; i < arr.length; i += 9) for (let k = 0; k < 3; k++) { const t = arr[i + 3 + k]; arr[i + 3 + k] = arr[i + 6 + k]; arr[i + 6 + k] = t; }
      }
    }
    _c.setHex(color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (buckets[kind] ||= []).push(g);
  });
  const out = {};
  for (const [k, list] of Object.entries(buckets)) out[k] = concat(list);
  return out;
}

// ---------------------------------------------------------------- pumpkins

/** A ribbed pumpkin body of radius R (squashed by sy), its base on y = 0. */
function pumpkinBody(R, sy = 0.78, ribs = 8) {
  const geo = new THREE.SphereGeometry(R, 18, 12);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 - 0.08 * (0.5 - 0.5 * Math.cos(ribs * Math.atan2(z, x)));
    p.setXYZ(i, x * k, y * sy + R * sy, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * A strip across the front of the ellipsoid (R, R*sy, R) centred at y0, between bot(x) and top(x),
 * lifted just off its surface: the carved bits of a jack-o'-lantern, bent round the pumpkin.
 */
function faceStrip(R, sy, y0, x0, x1, top, bot, n = 8) {
  const rows = 2;
  const pos = [];
  const pt = (x, y) => {
    const z = R * Math.sqrt(Math.max(0.03, 1 - (x / R) ** 2 - (y / (R * sy)) ** 2)) + R * 0.02;
    return [x, y + y0, z];
  };
  const grid = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, yt = top(x), yb = Math.min(bot(x), yt);
    grid.push([...Array(rows + 1)].map((_, j) => pt(x, yb + ((yt - yb) * j) / rows)));
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) {
    const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** The carved face (two eyes, a nose, a toothy grin) on a pumpkin of radius R, as warm-glow parts. */
function carveFace(g, R, sy, { angry = false } = {}) {
  const y0 = R * sy;
  const tri = (cx, hw, yb, h, lean) => (x) => {
    const ax = cx + lean, x0 = cx - hw, x1 = cx + hw;
    return x < ax ? yb + (h * (x - x0)) / (ax - x0) : yb + (h * (x1 - x)) / (x1 - ax);
  };
  for (const s of [-1, 1]) {
    const cx = s * 0.36 * R, hw = 0.19 * R, yb = 0.08 * R * sy;
    const top = tri(cx, hw, yb, (angry ? 0.3 : 0.36) * R * sy, -s * 0.06 * R);
    g.add(P(faceStrip(R, sy, y0, cx - hw, cx + hw, top, () => yb, 6), FACE, 'warm'));
  }
  const ny = -0.06 * R * sy;
  g.add(P(faceStrip(R, sy, y0, -0.08 * R, 0.08 * R, tri(0, 0.08 * R, ny, 0.14 * R * sy, 0), () => ny, 4), FACE, 'warm'));
  const w = 0.62 * R;
  const curve = (x) => (-0.32 + 0.24 * (x / w) ** 2) * R * sy;
  const mouthTop = (x) => curve(x) + 0.06 * R * sy - (Math.abs(Math.abs(x) - 0.22 * R) < 0.06 * R ? 0.1 * R * sy : 0);
  const mouthBot = (x) => curve(x) - 0.24 * R * sy * Math.sqrt(Math.max(0, 1 - (x / w) ** 2)) + (Math.abs(x) < 0.06 * R ? 0.1 * R * sy : 0);
  g.add(P(faceStrip(R, sy, y0, -w, w, mouthTop, mouthBot, 30), FACE, 'warm'));
}

/** A pumpkin (and its stem and a leaf) of radius R into g; carved: with a glowing face on +z. */
function pumpkin(g, R, { sy = 0.78, color = ORANGE, carved = false, stem = true, ribs = 8, angry = false } = {}) {
  g.add(P(pumpkinBody(R, sy, ribs), color));
  if (stem) {
    g.add(put(P(new THREE.CylinderGeometry(R * 0.09, R * 0.14, R * 0.38, 6), STEM), 0, R * sy * 2 + R * 0.08, 0, 0, 0, 0.25));
    ball(g, R * 0.16, LEAF, R * 0.2, R * sy * 1.95, -R * 0.08, 1.4, 0.35, 0.9);
  }
  if (carved) carveFace(g, R, sy, { angry });
  return g;
}

// ---------------------------------------------------------------- skeletons

/** A cartoon skeleton, pelvis at the origin, facing +z. pose: 'hang' (arms out on a cross-post) or 'sit'. */
function skeleton(pose = 'hang', { eyes = true, wave = 1 } = {}) {
  const g = new THREE.Group();
  const bone = (a, b, r = 0.03) => rod(g, a, b, r, BONE, { knob: r * 1.4 });
  rod(g, V(0, 0.02, 0), V(0, 0.42, -0.01), 0.026, BONE); // spine
  ball(g, 0.07, BONE, 0, 0, 0, 1.3, 0.6, 0.85); // pelvis
  [0.08, 0.095, 0.092, 0.078].forEach((r, i) => {
    g.add(put(P(new THREE.TorusGeometry(r * 1.08, 0.021, 4, 12), BONE), 0, 0.35 - i * 0.045, 0.005, Math.PI / 2, 0, 0, 1, 0.78, 1));
  });
  block(g, 0.032, 0.15, 0.02, BONE, 0, 0.29, 0.08); // breastbone
  rod(g, V(-0.11, 0.39, 0), V(0.11, 0.39, 0), 0.02, BONE); // collar bones
  rod(g, V(0, 0.42, 0), V(0, 0.47, 0.01), 0.026, BONE); // neck
  // the skull: cranium, jaw, dark sockets and nose, maybe glowing eyes
  const sk = new THREE.Group();
  sk.position.set(pose === 'sit' ? 0.015 : 0, 0.55, 0.01);
  sk.rotation.z = pose === 'sit' ? 0.18 : -0.12;
  sk.scale.setScalar(1.18); // a big cartoon skull reads from afar
  g.add(sk);
  ball(sk, 0.1, BONE, 0, 0, 0, 1, 0.98, 1.05);
  block(sk, 0.11, 0.05, 0.08, BONE, 0, -0.085, 0.035);
  for (const s of [-1, 1]) ball(sk, 0.03, SOCKET, s * 0.042, 0.005, 0.083, 1, 1.15, 0.7);
  sk.add(put(P(new THREE.ConeGeometry(0.016, 0.03, 3), SOCKET), 0, -0.035, 0.098, Math.PI, 0, 0));
  for (let i = -2; i <= 2; i++) block(sk, 0.012, 0.022, 0.01, SOCKET, i * 0.02, -0.075, 0.076);
  if (eyes) for (const s of [-1, 1]) ball(sk, 0.014, TOXIC, s * 0.042, 0.005, 0.1, 1, 1, 1, 'eyes');
  // arms and legs
  for (const s of [-1, 1]) {
    const sh = V(s * 0.11, 0.39, 0);
    if (pose === 'hang') {
      const el = V(s * 0.27, 0.39, 0.01), wr = V(s * 0.41, 0.375, 0.015);
      bone(sh, el); bone(el, wr, 0.026);
      ball(g, 0.04, BONE, s * 0.455, 0.35, 0.02, 0.8, 1.4, 0.55);
      const hip = V(s * 0.06, -0.01, 0), kn = V(s * 0.075, -0.22, s > 0 ? 0.05 : 0.02), an = V(s * 0.07, -0.42, s > 0 ? 0.01 : 0);
      bone(hip, kn, 0.033); bone(kn, an, 0.028);
      block(g, 0.065, 0.04, 0.12, BONE, an.x, an.y - 0.02, an.z + 0.04);
    } else {
      const up = s === wave;
      const el = up ? V(s * 0.24, 0.44, 0.03) : V(s * 0.17, 0.2, 0.07);
      const wr = up ? V(s * 0.27, 0.62, 0.06) : V(s * 0.12, 0.06, 0.18);
      bone(sh, el); bone(el, wr, 0.026);
      ball(g, 0.04, BONE, wr.x + s * 0.01, wr.y + (up ? 0.05 : -0.01), wr.z + (up ? 0 : 0.03), 0.8, up ? 1.4 : 0.6, up ? 0.55 : 1.3);
      const hip = V(s * 0.06, 0, 0.02), kn = V(s * 0.085, 0.02, 0.22), an = V(s * 0.09, -0.19, 0.25 + (s > 0 ? 0.04 : 0));
      bone(hip, kn, 0.033); bone(kn, an, 0.028);
      block(g, 0.065, 0.04, 0.12, BONE, an.x, an.y - 0.02, an.z + 0.04);
    }
  }
  return g;
}

/** A skeleton strung on a cross-post with a tattered pointed hat and a crow. About 1.45 tall. */
function skeletonScarecrow(seed) {
  const r = rng(seed * 97 + 5);
  const g = new THREE.Group();
  block(g, 0.06, 1.3, 0.06, WOOD, 0, 0.65, -0.05);
  block(g, 0.95, 0.055, 0.055, WOOD, 0, 0.98, -0.05);
  const sk = skeleton('hang');
  sk.position.set(0, 0.6, 0.0);
  g.add(sk);
  // torn rags hanging off the arms
  for (const [x, c] of [[-0.3, PURPLE], [0.22, 0x3d3247], [0.36, PURPLE], [-0.4, 0x3d3247]]) block(g, 0.07, 0.22 + r() * 0.1, 0.012, c, x, 0.86, 0.03, 0, 0, (r() - 0.5) * 0.4);
  // the hat, tipped over one eye
  const hat = new THREE.Group();
  put(hat, 0.02, 1.22, 0.01, -0.08, 0, 0.22);
  g.add(hat);
  hat.add(P(new THREE.CylinderGeometry(0.22, 0.24, 0.022, 9), 0x3d3247));
  hat.add(put(P(new THREE.CylinderGeometry(0.07, 0.12, 0.18, 9), 0x3d3247), 0, 0.1, 0));
  hat.add(put(P(new THREE.CylinderGeometry(0.122, 0.124, 0.04, 9), PURPLE), 0, 0.03, 0));
  hat.add(put(P(new THREE.ConeGeometry(0.075, 0.16, 8), 0x3d3247), 0.04, 0.24, -0.02, -0.4, 0, -0.6));
  block(hat, 0.06, 0.05, 0.01, 0x8a6a3a, -0.05, 0.11, 0.09, 0, 0, 0.3); // a patch
  // a crow on the cross-post
  const crow = new THREE.Group();
  put(crow, -0.4, 1.01, -0.04, 0, 0.5, 0);
  g.add(crow);
  ball(crow, 0.05, BLACK, 0, 0.05, 0, 0.9, 0.9, 1.4);
  ball(crow, 0.035, BLACK, 0, 0.1, 0.05);
  crow.add(put(P(new THREE.ConeGeometry(0.014, 0.05, 4), 0xe8a23a), 0, 0.1, 0.1, Math.PI / 2, 0, 0));
  block(crow, 0.03, 0.01, 0.08, BLACK, 0, 0.04, -0.08, 0.4, 0, 0);
  return g;
}

/** A skeleton sitting on a round hay bale, waving, with a little jack-o'-lantern beside it. */
function haySkeleton(seed) {
  const g = new THREE.Group();
  g.add(makeHayBale(seed));
  const sk = skeleton('sit', { wave: seed % 2 ? 1 : -1 });
  sk.position.set(0, 0.5, -0.02);
  g.add(sk);
  const p = pumpkin(new THREE.Group(), 0.13, { carved: true });
  put(p, seed % 2 ? -0.38 : 0.38, 0, 0.12, 0, seed % 2 ? 0.3 : -0.3, 0);
  g.add(p);
  return g;
}

// ---------------------------------------------------------------- spooky things

/** A bat hanging upside down by its feet from (x, y, z), wings folded round it, s times life size. */
function hangingBat(g, x, y, z, s = 1.5, ry = 0) {
  const h = new THREE.Group();
  put(h, x, y, z, 0, ry, 0, s);
  g.add(h);
  rod(h, V(0, 0, 0), V(0, -0.03, 0), 0.008, BLACK);
  ball(h, 0.05, BLACK, 0, -0.09, 0, 1, 1.5, 0.9);
  ball(h, 0.038, BLACK, 0, -0.165, 0.005);
  for (const k of [-1, 1]) {
    h.add(put(P(new THREE.ConeGeometry(0.016, 0.05, 4), BLACK), k * 0.02, -0.205, 0, Math.PI, 0, 0));
    h.add(put(P(new THREE.ConeGeometry(0.055, 0.18, 5), 0x2b2038), k * 0.048, -0.1, -0.005, 0, 0, k * 0.14, 1, 1, 0.5));
    ball(h, 0.011, 0xff5a3a, k * 0.016, -0.17, 0.034, 1, 1, 1, 'eyes');
  }
}

/** A twisted bare tree: crooked branches, a hollow with eyes, bats hanging off it. About 1.5 tall. */
function spookyTree(seed) {
  const r = rng(seed * 131 + 7);
  const g = new THREE.Group();
  const ends = [];
  const pts = [V(0, 0, 0), V(0.05, 0.3, 0.02), V(-0.04, 0.58, 0), V(0.03, 0.82, -0.02)];
  for (let i = 0; i < 3; i++) rod(g, pts[i], pts[i + 1], 0.12 - i * 0.025, BARK, { r2: 0.1 - i * 0.025, knob: 0.1 - i * 0.025, seg: 6 });
  for (let i = 0; i < 4; i++) { // roots
    const a = (i / 4) * TAU + r() * 0.6;
    rod(g, V(0, 0.08, 0), V(Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24), 0.05, BARK, { r2: 0.02 });
  }
  const grow = (a, yaw, pitch, len, rad, depth) => {
    let p = a.clone();
    for (let s = 0; s < 2; s++) {
      const q = p.clone().add(V(Math.cos(yaw) * Math.cos(pitch) * len / 2, Math.sin(pitch) * len / 2, Math.sin(yaw) * Math.cos(pitch) * len / 2));
      rod(g, p, q, rad, BARK, { r2: rad * 0.72, knob: rad * 0.95, seg: 5 });
      p = q; rad *= 0.72;
      yaw += (r() - 0.5) * 1.1; pitch += (r() - 0.5) * 0.6 - 0.12;
    }
    if (depth > 0) for (const k of [-1, 1]) grow(p, yaw + k * 0.75, pitch + 0.25, len * 0.62, rad, depth - 1);
    else ends.push(p);
  };
  const y0 = r() * TAU;
  for (let i = 0; i < 4; i++) {
    const from = i < 2 ? pts[2] : pts[3];
    grow(from, y0 + (i / 4) * TAU, 0.45 + r() * 0.35, 0.55 + r() * 0.15, 0.055, 1);
  }
  // the hollow, with a pair of eyes looking out
  ball(g, 0.06, 0x120e16, 0.02, 0.38, 0.085, 0.8, 1.15, 0.5);
  for (const s of [-1, 1]) ball(g, 0.014, EYE, 0.02 + s * 0.022, 0.39, 0.112, 1, 1.2, 0.6, 'eyes');
  // bats hanging from the lowest branch ends
  ends.sort((a, b) => a.y - b.y);
  ends.slice(0, 2).forEach((e) => hangingBat(g, e.x, e.y, e.z));
  g.userData.web = { y: 0.75, side: ends[ends.length - 1] };
  return g;
}

/** A black cat sitting up, tail curled, eyes glowing. About 0.5 tall. */
function blackCat(seed) {
  const g = new THREE.Group();
  ball(g, 0.1, BLACK, 0, 0.13, 0, 1, 1.3, 1.1);
  ball(g, 0.07, BLACK, 0, 0.18, 0.055);
  ball(g, 0.075, BLACK, 0, 0.32, 0.05, 1.1, 0.95, 1);
  for (const s of [-1, 1]) {
    g.add(put(P(new THREE.ConeGeometry(0.03, 0.075, 4), BLACK), s * 0.045, 0.39, 0.05, 0, 0, -s * 0.28));
    rod(g, V(s * 0.035, 0.0, 0.085), V(s * 0.035, 0.16, 0.07), 0.018, BLACK);
    ball(g, 0.02, EYE, s * 0.03, 0.335, 0.112, 1, 1.35, 0.6, 'eyes');
  }
  ball(g, 0.012, 0xd97aa0, 0, 0.31, 0.123);
  const s = seed % 2 ? 1 : -1;
  const tail = [V(0, 0.04, -0.1), V(s * 0.07, 0.12, -0.17), V(s * 0.05, 0.26, -0.2), V(s * 0.1, 0.33, -0.15)];
  for (let i = 0; i < 3; i++) rod(g, tail[i], tail[i + 1], 0.02, BLACK, { knob: 0.02 });
  return g;
}

/** A tombstone into g at (x, z): rounded, a cross or a pointed slab. */
function tombstone(g, x, z, ry, kind, seed) {
  const r = rng(seed * 61 + 3);
  const t = new THREE.Group();
  put(t, x, 0, z, (r() - 0.5) * 0.12, ry, (r() - 0.5) * 0.2);
  g.add(t);
  const col = STONE[seed % 3];
  block(t, 0.34, 0.05, 0.14, 0x7a7788, 0, 0.025, 0);
  if (kind === 0) {
    block(t, 0.26, 0.26, 0.08, col, 0, 0.16, 0);
    t.add(put(P(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12, 1, false, -Math.PI / 2, Math.PI), col), 0, 0.29, 0, -Math.PI / 2, 0, 0));
    block(t, 0.03, 0.13, 0.01, 0x5d5a6b, 0, 0.24, 0.042);
    block(t, 0.09, 0.03, 0.01, 0x5d5a6b, 0, 0.27, 0.042);
  } else if (kind === 1) {
    block(t, 0.07, 0.44, 0.07, col, 0, 0.27, 0);
    block(t, 0.26, 0.07, 0.07, col, 0, 0.37, 0);
  } else {
    block(t, 0.22, 0.34, 0.08, col, 0, 0.2, 0);
    t.add(put(P(new THREE.ConeGeometry(0.16, 0.12, 4), col), 0, 0.43, 0, 0, Math.PI / 4, 0, 1, 1, 0.36));
    block(t, 0.12, 0.025, 0.01, 0x5d5a6b, 0, 0.26, 0.042);
  }
  ball(t, 0.04, 0x6f8a3a, -0.12, 0.05, 0.05, 1.3, 0.6, 1);
}

/** A skeleton hand clawing out of a little dirt mound. */
function boneHand(g, x, z, ry) {
  const h = new THREE.Group();
  put(h, x, 0, z, 0, ry, 0);
  g.add(h);
  ball(h, 0.09, 0x5a463c, 0, 0, 0, 1, 0.45, 1);
  rod(h, V(0, 0, 0), V(0.02, 0.17, 0.02), 0.022, BONE, { knob: 0.028 });
  ball(h, 0.036, BONE, 0.025, 0.2, 0.02, 1.1, 1.1, 0.55);
  [-0.025, -0.008, 0.01, 0.027].forEach((fx, i) => rod(h, V(0.025 + fx, 0.22, 0.02), V(0.025 + fx * 1.8, 0.29 + (i % 2) * 0.015, 0.035), 0.011, BONE, { knob: 0.013 }));
  rod(h, V(0, 0.2, 0.02), V(-0.04, 0.24, 0.04), 0.011, BONE, { knob: 0.013 });
}

/** The graveyard: a dark patch, tombstones, open graves with bony hands, candles, an iron fence. ~1.9 x 1.4. */
function graveyard() {
  const g = new THREE.Group();
  g.add(put(P(new THREE.CylinderGeometry(1, 1, 0.03, 14), 0x5e5560), 0, 0.015, 0, 0, 0, 0, 0.92, 1, 0.7));
  const stones = [[-0.52, -0.3, 0], [0, -0.36, 2], [0.52, -0.28, 1], [-0.3, 0.12, 1], [0.34, 0.14, 0]];
  stones.forEach(([x, z, k], i) => {
    tombstone(g, x, z, (i - 2) * 0.08, k, i + 1);
    ball(g, 0.1, 0x6b5446, x, 0.02, z + 0.22, 1, 0.35, 1.7);
  });
  boneHand(g, -0.3, 0.36, 0.4);
  boneHand(g, 0.58, 0.02, -0.5);
  // candles
  for (const [x, z] of [[-0.12, -0.18], [0.18, -0.15], [-0.62, 0.0]]) {
    g.add(put(P(new THREE.CylinderGeometry(0.025, 0.028, 0.09, 6), 0xf1e6c8), x, 0.045, z));
    g.add(put(P(new THREE.ConeGeometry(0.02, 0.06, 5), 0xffc04a, 'warm'), x, 0.12, z));
  }
  // a shovel stuck in a mound
  rod(g, V(0.75, 0.0, -0.32), V(0.7, 0.55, -0.34), 0.016, WOOD);
  block(g, 0.11, 0.14, 0.015, 0x6d6a78, 0.755, 0.06, -0.32, 0, 0, 0.09);
  // the little iron fence, with a gap at the front
  const ax = 0.88, az = 0.66;
  const post = (x, z, tall = false) => {
    block(g, 0.024, tall ? 0.42 : 0.32, 0.024, IRON, x, tall ? 0.21 : 0.16, z);
    if (tall) ball(g, 0.035, IRON, x, 0.44, z);
    else g.add(put(P(new THREE.ConeGeometry(0.022, 0.06, 4), IRON), x, 0.35, z));
  };
  for (let x = -ax; x <= ax + 1e-6; x += ax / 5) { post(x, -az); if (Math.abs(x) > 0.25) post(x, az, Math.abs(Math.abs(x) - 0.352) < 0.01); }
  for (let z = -az + az / 4; z < az - 1e-6; z += az / 4) { post(-ax, z); post(ax, z); }
  for (const y of [0.1, 0.27]) {
    block(g, ax * 2, 0.02, 0.02, IRON, 0, y, -az);
    block(g, 0.02, 0.02, az * 2, IRON, -ax, y, 0);
    block(g, 0.02, 0.02, az * 2, IRON, ax, y, 0);
    for (const s of [-1, 1]) block(g, ax - 0.35, 0.02, 0.02, IRON, s * (ax + 0.35) / 2, y, az);
  }
  // a lantern on the gate post
  block(g, 0.08, 0.02, 0.08, IRON, -0.352, 0.5, az);
  block(g, 0.06, 0.08, 0.06, 0xffc04a, -0.352, 0.45, az);
  g.children[g.children.length - 1].userData.k = 'warm';
  return g;
}

/** A bubbling cauldron of green brew over a little fire, a broom leaning by it. ~0.8 across. */
function cauldron() {
  const g = new THREE.Group();
  const pot = new THREE.LatheGeometry([[0.001, 0], [0.14, 0.01], [0.25, 0.08], [0.29, 0.2], [0.27, 0.32], [0.22, 0.38], [0.23, 0.4]].map(([x, y]) => new THREE.Vector2(x, y)), 14);
  g.add(put(P(pot, IRON), 0, 0.12, 0));
  g.add(put(P(new THREE.TorusGeometry(0.225, 0.03, 5, 14), IRON), 0, 0.52, 0, Math.PI / 2, 0, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    rod(g, V(Math.cos(a) * 0.22, 0.2, Math.sin(a) * 0.22), V(Math.cos(a) * 0.27, 0, Math.sin(a) * 0.27), 0.022, IRON);
  }
  g.add(put(P(new THREE.CylinderGeometry(0.215, 0.215, 0.02, 14), TOXIC, 'toxic'), 0, 0.5, 0));
  ball(g, 0.03, TOXIC, 0.2, 0.47, 0.1, 0.7, 1.7, 0.7, 'toxic');
  ball(g, 0.025, TOXIC, -0.16, 0.45, 0.16, 0.7, 1.9, 0.7, 'toxic');
  // fire: logs, flames and a ring of stones
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    rod(g, V(Math.cos(a) * 0.2, 0.03, Math.sin(a) * 0.2), V(-Math.cos(a) * 0.2, 0.03, -Math.sin(a) * 0.2), 0.03, 0x6b4a32);
  }
  [[0, 0, 0.12, 0xff8a1e], [0.08, 0.05, 0.08, 0xffc63a], [-0.07, -0.04, 0.09, 0xffb02a], [0.02, 0.1, 0.07, 0xffc63a]].forEach(([x, z, h, c]) => {
    g.add(put(P(new THREE.ConeGeometry(0.05, h, 5), c, 'warm'), x, 0.05 + h / 2, z));
  });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    g.add(put(P(new THREE.DodecahedronGeometry(0.05, 0), STONE[i % 3]), Math.cos(a) * 0.36, 0.03, Math.sin(a) * 0.36, i, i * 2, 0, 1, 0.7, 1));
  }
  rod(g, V(0.05, 0.42, -0.04), V(0.2, 0.78, -0.12), 0.015, WOOD); // the stirring stick
  // the broom
  rod(g, V(0.5, 0.0, -0.05), V(0.38, 1.0, -0.2), 0.018, WOOD);
  g.add(put(P(new THREE.ConeGeometry(0.09, 0.26, 8), 0xc9a24f), 0.49, 0.1, -0.06, 0, 0, -0.12));
  g.add(put(P(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8), PURPLE), 0.475, 0.23, -0.07, 0, 0, -0.12));
  return g;
}

/** The centrepiece: a giant jack-o'-lantern in a witch's hat, small pumpkins at its feet. ~1.55 tall. */
function giantLantern() {
  const g = new THREE.Group();
  const R = 0.55, sy = 0.8;
  pumpkin(g, R, { sy, carved: true, stem: false, ribs: 10, color: 0xf47a1f, angry: false });
  const hat = new THREE.Group();
  put(hat, 0.02, 2 * R * sy - 0.06, -0.02, -0.06, 0, 0.12);
  g.add(hat);
  hat.add(put(P(new THREE.CylinderGeometry(0.62, 0.65, 0.04, 22), HAT), 0, 0.02, 0));
  hat.add(put(P(new THREE.CylinderGeometry(0.2, 0.3, 0.32, 18), HAT), 0, 0.2, 0));
  hat.add(put(P(new THREE.CylinderGeometry(0.305, 0.31, 0.09, 18), PURPLE), 0, 0.085, 0));
  block(hat, 0.13, 0.1, 0.02, GOLD, 0, 0.085, 0.31);
  block(hat, 0.07, 0.05, 0.022, PURPLE, 0, 0.085, 0.312);
  const mid = new THREE.Group();
  put(mid, 0, 0.35, 0, -0.35, 0, 0);
  hat.add(mid);
  mid.add(put(P(new THREE.CylinderGeometry(0.11, 0.2, 0.24, 16), HAT), 0, 0.11, 0));
  const tip = new THREE.Group();
  put(tip, 0, 0.22, 0, -0.65, 0, 0);
  mid.add(tip);
  tip.add(put(P(new THREE.ConeGeometry(0.11, 0.26, 14), HAT), 0, 0.12, 0));
  ball(tip, 0.04, GOLD, 0, 0.26, 0);
  // vines, leaves and little pumpkins at its feet
  for (const [x, z, s] of [[-0.45, 0.32, 1], [0.5, 0.28, -1]]) {
    ball(g, 0.12, LEAF, x, 0.03, z, 1.3, 0.25, 1);
    rod(g, V(x * 0.7, 0.02, z * 0.9), V(x * 1.15, 0.05, z * 1.3), 0.02, STEM);
    rod(g, V(x * 1.15, 0.05, z * 1.3), V(x * 1.2 + s * 0.05, 0.12, z * 1.4), 0.016, STEM);
  }
  const p1 = pumpkin(new THREE.Group(), 0.17, { carved: true, angry: true });
  put(p1, 0.68, 0, 0.3, 0, -0.35, 0);
  const p2 = pumpkin(new THREE.Group(), 0.13, { color: 0xe56a17 });
  put(p2, -0.66, 0, 0.36, 0, 1, 0);
  const p3 = pumpkin(new THREE.Group(), 0.1, { color: 0xf3e9d8 }); // a white one
  put(p3, -0.5, 0, 0.56, 0, 2, 0);
  g.add(p1, p2, p3);
  return g;
}

/** A floating ghost sheet (body and face as separate geometries, for two instanced meshes). */
function ghostParts() {
  const body = new THREE.Group();
  const lathe = new THREE.LatheGeometry([[0.18, 0], [0.165, 0.08], [0.155, 0.2], [0.135, 0.3], [0.095, 0.38], [0.001, 0.43]].map(([x, y]) => new THREE.Vector2(x, y)), 16);
  const p = lathe.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.01) p.setY(i, 0.035 * Math.sin(6 * Math.atan2(p.getX(i), p.getZ(i))));
  lathe.computeVertexNormals();
  body.add(P(lathe, 0xf6f4ff));
  for (const s of [-1, 1]) body.add(put(P(new THREE.SphereGeometry(0.045, 8, 6), 0xf6f4ff), s * 0.165, 0.22, 0.02, 0, 0, s * 0.6, 1.7, 0.75, 0.8));
  const face = new THREE.Group();
  for (const s of [-1, 1]) ball(face, 0.026, 0x2a2236, s * 0.05, 0.3, 0.125, 1, 1.45, 0.5);
  ball(face, 0.024, 0x2a2236, 0, 0.215, 0.145, 1, 1.3, 0.5);
  return { body: bakeGeos(body).lit, face: bakeGeos(face).lit };
}

/** A fat black spider, its thread tied at the origin, legs splayed, facing +z. ~0.42 across. */
function spiderGeo() {
  const g = new THREE.Group();
  ball(g, 0.085, BLACK, 0, -0.085, -0.01, 1, 0.95, 1.1);
  ball(g, 0.05, BLACK, 0, -0.18, 0.03);
  ball(g, 0.03, 0xf27a1e, 0, -0.07, 0.075, 1.2, 1.4, 0.4); // an orange mark
  for (const s of [-1, 1]) {
    ball(g, 0.014, 0xff4a3a, s * 0.02, -0.18, 0.075);
    for (let k = 0; k < 4; k++) {
      const a = V(s * 0.04, -0.15 + k * 0.025, 0.02 - k * 0.012);
      const kn = V(s * 0.15, -0.06 - k * 0.035, 0.03 - k * 0.03);
      const ft = V(s * 0.21, -0.2 - k * 0.025, 0.04 - k * 0.04);
      rod(g, a, kn, 0.012, BLACK, { knob: 0.012, seg: 4 });
      rod(g, kn, ft, 0.011, BLACK, { r2: 0.007, seg: 4 });
    }
  }
  return bakeGeos(g).lit;
}

/** A flying bat silhouette, wings along x, head toward -z. ~0.46 across. */
function flyingBatGeo() {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.07);
  [[0.06, 0.1], [0.13, 0.05], [0.23, 0.1], [0.19, 0.0], [0.14, -0.03], [0.09, -0.01], [0.05, -0.05], [0, -0.04],
    [-0.05, -0.05], [-0.09, -0.01], [-0.14, -0.03], [-0.19, 0.0], [-0.23, 0.1], [-0.13, 0.05], [-0.06, 0.1]].forEach(([x, y]) => sh.lineTo(x, y));
  const geo = new THREE.ShapeGeometry(sh);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// ---------------------------------------------------------------- sheep costumes

function costumeGroup(kind) {
  const g = new THREE.Group();
  if (kind === 'witch') {
    const hat = new THREE.Group();
    put(hat, 0, 0, -0.01, -0.12, 0, 0.14);
    g.add(hat);
    hat.add(put(P(new THREE.CylinderGeometry(0.175, 0.18, 0.016, 18), HAT), 0, 0.012, 0));
    hat.add(put(P(new THREE.CylinderGeometry(0.06, 0.095, 0.15, 14), HAT), 0, 0.09, 0));
    hat.add(put(P(new THREE.CylinderGeometry(0.098, 0.1, 0.035, 14), PURPLE), 0, 0.035, 0));
    block(hat, 0.04, 0.035, 0.012, GOLD, 0, 0.035, 0.099);
    const tip = new THREE.Group();
    put(tip, 0, 0.16, 0, -0.6, 0, 0);
    hat.add(tip);
    tip.add(put(P(new THREE.ConeGeometry(0.062, 0.15, 12), HAT), 0, 0.07, 0));
  } else if (kind === 'pumpkin') {
    const p = pumpkin(new THREE.Group(), 0.125, { carved: true });
    put(p, 0, -0.03, 0.0, 0, 0, 0.1);
    g.add(p);
  } else {
    // little red devil horns on a black headband
    g.add(put(P(new THREE.TorusGeometry(0.105, 0.016, 4, 12, Math.PI), BLACK), 0, -0.09, -0.005));
    for (const s of [-1, 1]) {
      rod(g, V(s * 0.06, -0.02, 0), V(s * 0.1, 0.07, 0.014), 0.034, 0xd6283a, { r2: 0.022, seg: 6 });
      g.add(put(P(new THREE.ConeGeometry(0.022, 0.08, 6), 0xd6283a), s * 0.1, 0.1, 0.02, 0.2, 0, s * 0.42));
    }
  }
  return g;
}

// ---------------------------------------------------------------- the theme

export default function build(ctx) {
  const root = new THREE.Group();
  const S = (ctx.scale || 0.75) / 0.75; // 1 at the usual prop scale
  const rand = rng(1031);
  const own = []; // geometries and materials to dispose

  // ---- materials (vertex coloured, shared by everything)
  const LIT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });
  const vbasic = (o = {}) => { const m = new THREE.MeshBasicMaterial({ vertexColors: true, ...o }); m.userData.noSeason = true; return m; };
  const basic = (color, o = {}) => { const m = new THREE.MeshBasicMaterial({ color, ...o }); m.userData.noSeason = true; return m; };
  const WARM = vbasic({ side: THREE.DoubleSide });
  const TOXICM = vbasic();
  const EYES = vbasic();
  const MATS = { lit: LIT, warm: WARM, toxic: TOXICM, eyes: EYES };
  const WEB = basic(0xf1edf7, { side: THREE.DoubleSide });
  const THREAD = basic(0xdcd8e4);
  const BULB_O = basic(0xff8a2a), BULB_P = basic(0xa860ff);
  const baseO = new THREE.Color(0xff8a2a), baseP = new THREE.Color(0xa860ff), baseWeb = new THREE.Color(0xf1edf7);
  const GHOST = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, emissive: 0xdfe6ff, emissiveIntensity: 0.2, side: THREE.DoubleSide });
  GHOST.userData.noSeason = true;
  const GHOST_FACE = vbasic();
  const BAT = basic(0x2b2038, { side: THREE.DoubleSide });
  const POOL = basic(0xff9a3a, { transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  const POOL_G = basic(0x8aff3c, { transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false });
  own.push(LIT, WARM, TOXICM, EYES, WEB, THREAD, BULB_O, BULB_P, GHOST, GHOST_FACE, BAT, POOL, POOL_G);

  /** Bakes a built group into one mesh per material kind, wrapped in a fresh group. */
  function finish(group, { cast = false, name = 'Halloween thing' } = {}) {
    const out = bakeGeos(group);
    const g = new THREE.Group();
    g.name = name;
    for (const [k, geo] of Object.entries(out)) {
      own.push(geo);
      const m = new THREE.Mesh(geo, MATS[k]);
      m.castShadow = cast && k === 'lit';
      m.receiveShadow = k === 'lit';
      m.name = `${name} (${k})`;
      g.add(m);
    }
    return g;
  }
  const ground = (x, z) => ctx.heightAt(x, z);
  const place = (obj, x, z, ry = 0, { y = ground(x, z), s = S, flag } = {}) => {
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    obj.scale.multiplyScalar(s);
    if (flag) obj.userData[flag] = true;
    root.add(obj);
    return obj;
  };
  const faceCam = (amt = 0.5) => (rand() - 0.5) * amt;

  // ---- collections for the island-wide meshes
  const webPos = [];
  const spiders = []; // { x, top, z, len, s, ph, ry }
  const bulbs = [[], []]; // orange, purple: [x, y, z]
  const jacks = []; // { x, y, z, ry, s, carved }
  const dressing = new THREE.Group(); // static lit bits on trees, lamps (hanging bats)

  // a web: ribbons in its own XY plane round a hub, spokes from a0 to a1
  const _w = new THREE.Vector3();
  function ribbon(m, ax, ay, bx, by, w) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * w / 2, ny = (dx / L) * w / 2;
    for (const [x, y] of [[ax + nx, ay + ny], [ax - nx, ay - ny], [bx - nx, by - ny], [ax + nx, ay + ny], [bx - nx, by - ny], [bx + nx, by + ny]]) {
      _w.set(x, y, 0).applyMatrix4(m);
      webPos.push(_w.x, _w.y, _w.z);
    }
  }
  function addWeb(m, R, { a0 = 0, a1 = TAU, spokes = 9, rings = 5, w = 0.036 } = {}) {
    const full = a1 - a0 >= TAU - 1e-3;
    const n = full ? spokes : Math.max(3, Math.round(spokes * (a1 - a0) / TAU) + 2);
    const angs = [...Array(n)].map((_, i) => a0 + ((a1 - a0) * i) / (full ? n : n - 1));
    const len = angs.map((_, i) => R * (0.84 + 0.16 * ((i * 0.618 + R * 3.1) % 1)));
    angs.forEach((a, i) => ribbon(m, 0, 0, Math.cos(a) * len[i], Math.sin(a) * len[i], w));
    for (let k = 1; k <= rings; k++) {
      const f = (k / rings) * 0.94;
      for (let i = 0; i < (full ? n : n - 1); i++) {
        const j = (i + 1) % n;
        const ax = Math.cos(angs[i]) * len[i] * f, ay = Math.sin(angs[i]) * len[i] * f;
        const bx = Math.cos(angs[j]) * len[j] * f, by = Math.sin(angs[j]) * len[j] * f;
        const mx = (ax + bx) * 0.45, my = (ay + by) * 0.45; // sags toward the hub
        ribbon(m, ax, ay, mx, my, w * 0.75);
        ribbon(m, mx, my, bx, by, w * 0.75);
      }
    }
  }
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _n = new THREE.Vector3();
  /** A web at (x, y, z) in the vertical plane along `right` (a unit [x, z]). */
  function webAt(x, y, z, rx, rz, R, opts) {
    _r.set(rx, 0, rz).normalize().multiplyScalar(S);
    _u.set(0, S, 0);
    _n.crossVectors(_r, _u).normalize().multiplyScalar(S);
    addWeb(new THREE.Matrix4().makeBasis(_r, _u, _n).setPosition(x, y, z), R, opts);
  }
  /** Bulbs hanging along a polyline of [x, y, z] points, sagging between them, colours alternating. */
  let bulbTurn = 0;
  function stringAlong(points, { spacing = 0.2, sag = 0.05 } = {}) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const t = k / n;
        bulbs[bulbTurn++ % 2].push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]);
      }
    }
  }
  const spider = (x, top, z, len, s = 1.2, ry = faceCam(0.8)) => spiders.push({ x, top, z, len: len * S, s: s * S, ph: rand() * TAU, ry });
  const jack = (x, z, s = 1, { carved = true, ry = faceCam(0.7), y = ground(x, z) } = {}) => jacks.push({ x, y, z, ry, s: s * S, carved });
  /** A jack-o'-lantern on the grass near (x, z), if there's room. */
  const jackNear = (x, z, s = 1) => {
    if (!ctx.free(x, z, 0.14 * s)) return false;
    ctx.take(x, z, 0.14 * s);
    jack(x, z, s);
    return true;
  };

  // ================================================================ the centrepiece
  // (a wider search only if the first finds nothing, so no spare spot is taken)
  const cp = ctx.spots(1, { r: 0.7, from: 2, to: 5 })[0] ?? ctx.spots(1, { r: 0.6, from: 1.6, to: 6.5 })[0];
  if (cp) {
    const big = finish(giantLantern(), { cast: true, name: 'Giant jack-o-lantern' });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), POOL);
    own.push(pool.geometry);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.02;
    pool.renderOrder = 2;
    big.add(pool);
    place(big, cp[0], cp[1], 0);
  }

  // ================================================================ the bubbling cauldron
  let bubbles = null;
  const [cs] = ctx.spots(1, { r: 0.5, from: 1.8, to: 5 });
  if (cs) {
    const c = finish(cauldron(), { cast: true, name: 'Cauldron' });
    const bg = new THREE.Group();
    ball(bg, 0.045, TOXIC, 0, 0, 0, 1, 1, 1, 'toxic');
    const bgeo = bakeGeos(bg).toxic;
    own.push(bgeo);
    bubbles = new THREE.InstancedMesh(bgeo, TOXICM, 6);
    bubbles.frustumCulled = false;
    bubbles.name = 'Bubbles';
    bubbles.userData.info = [...Array(6)].map((_, i) => ({ x: Math.cos(i * 2.4) * 0.12 * (i % 3) / 2, z: Math.sin(i * 2.4) * 0.12 * (i % 3) / 2, ph: i / 6, sp: 0.6 + (i % 3) * 0.2 }));
    c.add(bubbles);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), POOL_G);
    own.push(pool.geometry);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.02;
    pool.renderOrder = 2;
    c.add(pool);
    place(c, cs[0], cs[1], faceCam(0.6), { s: S * 1.25 });
  }

  // ================================================================ the graveyard
  let grave = null;
  const [gs] = ctx.spots(1, { r: 1.05, from: 2.6, to: 7, spacing: 2 });
  if (gs) {
    grave = place(finish(graveyard(), { cast: true, name: 'Graveyard' }), gs[0], gs[1], faceCam(0.3));
  }

  // ================================================================ skeleton scarecrows by the fields
  const fieldsNear = ctx.fields.filter((f) => f.ring).slice().sort((a, b) => Math.hypot(a.center[0] - ctx.home[0], a.center[1] - ctx.home[1]) - Math.hypot(b.center[0] - ctx.home[0], b.center[1] - ctx.home[1]));
  fieldsNear.slice(0, 4).forEach((fl, i) => {
    const R = Math.max(...fl.ring.map(([x, z]) => Math.hypot(x - fl.center[0], z - fl.center[1])));
    const [sp] = ctx.spots(1, { around: fl.center, from: 0.5, to: R + 1.6, r: 0.38, spacing: 1, front: 0.6 });
    if (sp) place(finish(skeletonScarecrow(i + 1), { cast: true, name: 'Skeleton scarecrow' }), sp[0], sp[1], faceCam(0.6), { s: S * 1.2 });
  });

  // ================================================================ skeletons on hay bales and fence rails
  ctx.props.filter((p) => p.key === 'hayBale').slice(0, 2).forEach((p, i) => {
    const sk = finish(skeleton('sit', { wave: i % 2 ? -1 : 1 }), { name: 'Skeleton on a bale' });
    place(sk, p.x, p.z, faceCam(0.4), { y: p.y + (p.height || 0.5 * (p.scale || 0.75)) - 0.03, flag: 'onBuilding' });
  });
  ctx.spots(2, { r: 0.35, from: 2.2, to: 6.5, spacing: 2.5 }).forEach(([x, z], i) => {
    place(finish(haySkeleton(i + 1), { cast: true, name: 'Skeleton on a hay bale' }), x, z, faceCam(0.6));
  });
  // sitting on a fence's top rail, legs dangling outside, on fronts facing the camera
  let sitters = 0;
  for (const fl of fieldsNear) {
    if (sitters >= 2) break;
    const pts = ctx.fenceLine(fl, { outset: 0, step: 0.3 });
    for (const [x, , z] of pts) {
      const dx = x - fl.center[0], dz = z - fl.center[1], d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
      if (nz < 0.55) continue;
      if (fl.gate && Math.hypot(fl.gate.x - x, fl.gate.z - z) < 0.9) continue;
      if (fl.ring.some(([vx, vz]) => Math.hypot(vx - x, vz - z) < 0.4)) continue;
      const fx = x + nx * 0.45, fz = z + nz * 0.45;
      if (!ctx.free(fx, fz, 0.15)) continue;
      ctx.take(fx, fz, 0.18);
      place(finish(skeleton('sit', { wave: sitters ? -1 : 1 }), { name: 'Skeleton on the fence' }), x, z, Math.atan2(nx, nz), { y: fl.fenceY - 0.01, flag: 'onFence' });
      sitters++;
      break;
    }
  }

  // ================================================================ twisted bare trees
  const spooky = ctx.spots(6, { r: 0.4, from: 3.2, to: 7.5, spacing: 1.8, front: 0 });
  spooky.forEach(([x, z], i) => {
    const raw = spookyTree(i + 1);
    const info = raw.userData.web;
    const t = place(finish(raw, { cast: true, name: 'Spooky tree' }), x, z, rand() * TAU, { s: S * (1.05 + rand() * 0.2) });
    // a web between the trunk and its highest branch, and a spider under it
    t.updateMatrixWorld(true);
    const hub = V(info.side.x * 0.5, info.y, info.side.z * 0.5).applyMatrix4(t.matrix);
    const side = V(info.side.x, 0, info.side.z).applyMatrix4(new THREE.Matrix4().extractRotation(t.matrix));
    webAt(hub.x, hub.y, hub.z, side.x || 1, side.z, 0.42);
    spider(hub.x, hub.y - 0.05, hub.z, 0.3, 1.3);
  });

  // ================================================================ black cats
  ctx.spots(4, { r: 0.2, from: 1.6, to: 6.5, spacing: 2.2 }).forEach(([x, z], i) => {
    place(finish(blackCat(i), { name: 'Black cat' }), x, z, faceCam(1), { s: S * 1.25 });
  });

  // ================================================================ lone tombstones on the grass
  ctx.spots(6, { r: 0.22, from: 3, to: 7.5, spacing: 1.5 }).forEach(([x, z], i) => {
    const g = new THREE.Group();
    tombstone(g, 0, 0, 0, i % 3, i + 7);
    ball(g, 0.1, 0x6b5446, 0, 0.02, 0.22, 1, 0.35, 1.7);
    place(finish(g, { name: 'Tombstone' }), x, z, faceCam(0.6), { s: S * 1.25 });
  });

  // ================================================================ dressing every building
  // Where each building's front eave corners and roof top are, in its own unscaled space (front
  // +z), so the webs hang right off the eaves and the pumpkins sit on the ridge. [x, y, z, size]
  const SHAPES = {
    barn: { eave: [1.33, 1.27, 1.0], R: 0.74, roof: [[-0.75, 2.36, 0, 1.7]] },
    farmhouse: { eave: [0.7, 0.78, 0.84], R: 0.58, roof: [[-0.28, 1.42, 0, 1.4]] },
    machineShed: { eave: [0.85, 1.15, 0.68], R: 0.62, roof: [[-0.3, 1.12, 0.05, 1.4]] },
    chickenCoop: { eave: [0.22, 0.62, 0.06], R: 0.3, roof: [[0, 0.84, -0.2, 0.95]] },
    greenhouse: { eave: [0.72, 0.46, 0.55], R: 0.46, roof: [[0.3, 0.7, 0, 1.15]] },
    silo: { web: [0, 1.25, 0.56], R: 0.46, roof: [[0, 2.5, 0, 1.4]] },
    windmill: { web: [0, 0.48, 0.6], R: 0.36 }, // low on the base, under the sails
  };
  const ROUND = new Set(['silo', 'windmill', 'grainBins', 'well']);
  const SKIP = new Set(['rock', 'bush', 'dock', 'boat', 'bench', 'barrel', 'crate', 'mailbox', 'signpost', 'wheelbarrow', 'firewood', 'hayStack', 'scarecrow', 'fence']);
  const DIMS = { barn: [0.92, 0.69, 0.56], farmhouse: [0.78, 0.7, 0.52], machineShed: [0.8, 0.7, 0.6], chickenCoop: [0.7, 0.62, 0.55], greenhouse: [0.75, 0.68, 0.6] };
  for (const b of ctx.buildings) {
    if (SKIP.has(b.key) || b.r < 0.2) continue;
    const ry = b.ry || 0, cr = Math.cos(ry), sr = Math.sin(ry);
    const fx = sr, fz = cr, rx = cr, rz = -sr;
    const sc = b.scale || ctx.scale || 0.75, k = sc / 0.75;
    const at = (lx, ly, lz) => [b.x + (lx * cr + lz * sr) * sc, b.y + ly * sc, b.z + (-lx * sr + lz * cr) * sc];
    const H = b.height || 1.2;
    const shape = SHAPES[b.key];
    // a big glowing jack-o'-lantern up on the roof
    for (const [lx, ly, lz, size] of shape?.roof || []) {
      const [x, y, z] = at(lx, ly, lz);
      jack(x, z, size * k, { y, ry: ry + faceCam(0.3) });
    }
    if (ROUND.has(b.key)) {
      // a full web on the front, a spider beside it, a pumpkin at the foot
      const [x, y, z] = shape?.web ? at(...shape.web) : [b.x + fx * (b.r * 0.8 + 0.03), b.y + H * 0.42, b.z + fz * (b.r * 0.8 + 0.03)];
      const R = (shape?.R || Math.min(0.42, 0.25 + b.r * 0.3)) * k;
      webAt(x, y, z, rx, rz, R, { spokes: 12 });
      spider(x + rx * R * 0.7 + fx * 0.16, y + R * 0.6, z + rz * R * 0.7 + fz * 0.16, 0.4, 1.4, ry);
      jackNear(b.x + fx * (b.r + 0.2) + rx * 0.3, b.z + fz * (b.r + 0.2) + rz * 0.3, 1.2);
      continue;
    }
    // the front eave's corners
    let corner, R;
    if (shape?.eave) {
      const [ex, ey, ez] = shape.eave;
      corner = (side, out = 0, down = 0) => at(ex * side, ey - down, ez + out);
      R = shape.R * k;
    } else {
      const [kw, kd, ke] = DIMS[b.key] || [0.72, 0.68, 0.55];
      const hw = (kw * b.r) / sc, hd = (kd * b.r + 0.03) / sc, ey = (ke * H) / sc;
      corner = (side, out = 0, down = 0) => at(hw * side, ey - down, hd + out);
      R = Math.min(0.62, Math.max(0.4, 0.3 * b.r + 0.25));
    }
    for (const side of [-1, 1]) {
      const [cx, cy, cz] = corner(side);
      webAt(cx, cy, cz, rx, rz, R, side > 0 ? { a0: Math.PI, a1: Math.PI * 1.5, spokes: 16 } : { a0: Math.PI * 1.5, a1: TAU, spokes: 16 });
    }
    // two fat spiders dangling off the eave, clear of the wall
    {
      const [ax, ay, az] = corner(0.45, 0.26);
      spider(ax, ay, az, 0.4, 1.7, ry + faceCam(0.4));
      const [bx, by, bz] = corner(-0.72, 0.22, 0.05);
      spider(bx, by, bz, 0.25, 1.3, ry + faceCam(0.4));
    }
    if (b.key !== 'barn') {
      // orange and purple lights along the front eave (the barn has its own: ../decor.js)
      const pts = [];
      for (let i = 0; i <= 6; i++) pts.push(corner(-1 + i / 3, 0.04, 0.03));
      stringAlong(pts, { spacing: 0.17, sag: 0.05 });
      // pumpkins at the front corners
      for (const side of [-1, 1]) {
        const [ox, , oz] = corner(side * 1.12, 0.3 / sc);
        if (!jackNear(ox, oz, 1.2)) jackNear(ox + fx * 0.3, oz + fz * 0.3, 1.05);
      }
    }
  }
  // a black cat up on the barn's ridge, by its pumpkin
  const barnProp = ctx.buildings.find((b) => b.key === 'barn');
  if (barnProp) {
    const sc = barnProp.scale || ctx.scale || 0.75, ry = barnProp.ry || 0;
    const lx = 0.15, x = barnProp.x + lx * Math.cos(ry) * sc, z = barnProp.z - lx * Math.sin(ry) * sc;
    place(finish(blackCat(3), { name: 'Black cat on the barn' }), x, z, ry + 0.3, { y: barnProp.y + 2.33 * sc, s: S * 1.5 * (sc / 0.75), flag: 'onBuilding' });
  }

  // ================================================================ fences: lights all round, webs across the corners
  for (const fl of ctx.fields) {
    if (!fl.ring) continue;
    stringAlong(ctx.fenceLine(fl, { outset: 0.05, step: 0.45 }), { spacing: 0.2, sag: 0.055 });
    const ring = fl.ring, n = ring.length;
    const corners = [];
    for (let i = 0; i < n; i++) {
      const [vx, vz] = ring[i], [px, pz] = ring[(i + n - 1) % n], [qx, qz] = ring[(i + 1) % n];
      let ax = px - vx, az = pz - vz, bx = qx - vx, bz = qz - vz;
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      ax /= la; az /= la; bx /= lb; bz /= lb;
      const ang = Math.acos(Math.max(-1, Math.min(1, ax * bx + az * bz)));
      let mx = ax + bx, mz = az + bz;
      const ml = Math.hypot(mx, mz);
      if (ang > 2.5 || ml < 1e-3) continue;
      mx /= ml; mz /= ml;
      // the inside of the angle must be the field's side
      if ((fl.center[0] - vx) * mx + (fl.center[1] - vz) * mz < 0) continue;
      corners.push({ vx, vz, mx, mz, ang });
    }
    corners.sort((a, b) => a.ang - b.ang);
    const used = [];
    for (const c of corners) {
      if (used.length >= 4) break;
      if (used.some((u) => Math.hypot(u.vx - c.vx, u.vz - c.vz) < 1)) continue;
      const d = 0.3, R = Math.min(0.3, d * Math.tan(c.ang / 2));
      if (R < 0.14) continue;
      used.push(c);
      webAt(c.vx + c.mx * d, fl.fenceY - 0.05, c.vz + c.mz * d, -c.mz, c.mx, R, { spokes: 9, rings: 4, w: 0.03 });
      if (used.length <= 2) spider(c.vx + c.mx * d, fl.fenceY + 0.14, c.vz + c.mz * d, 0.22, 1.1);
      // a jack-o'-lantern on the corner post, looking out
      jack(c.vx, c.vz, 0.85, { y: fl.fenceY + 0.04, ry: Math.atan2(-c.mx, -c.mz) });
    }
    // the gate: a web between its posts, a jack-o'-lantern on each post, a spider
    const gt = fl.gate;
    if (gt) {
      const tx = -gt.nz, tz = gt.nx, ry = Math.atan2(gt.nx, gt.nz);
      webAt(gt.x + gt.nx * 0.02, fl.fenceY - 0.06, gt.z + gt.nz * 0.02, tx, tz, 0.3, { spokes: 10 });
      for (const s of [-1, 1]) jack(gt.x + tx * 0.32 * s, gt.z + tz * 0.32 * s, 0.8, { ry, y: fl.fenceY + 0.17 });
      spider(gt.x + tx * 0.12 + gt.nx * 0.06, fl.fenceY + 0.2, gt.z + tz * 0.12 + gt.nz * 0.06, 0.3, 1.3);
      jackNear(gt.x + gt.nx * 0.45 + tx * 0.6, gt.z + gt.nz * 0.45 + tz * 0.6, 1.1);
    }
  }

  // ================================================================ trees: webs, spiders, bats, pumpkins
  for (const t of ctx.trees) {
    const H = t.height || 1.4;
    webAt(t.x + 0.05, t.y + H * 0.42, t.z + 0.09, 1, -0.25, 0.34);
    spider(t.x - 0.16, t.y + H * 0.52, t.z + 0.24, 0.35, 1.4);
    hangingBat(dressing, t.x + 0.22, t.y + H * 0.5, t.z + 0.12, 1.6, 0.3);
    hangingBat(dressing, t.x - 0.06, t.y + H * 0.53, t.z + 0.26, 1.6, -0.2);
    jackNear(t.x + 0.1, t.z + (t.r || 0.3) + 0.2, 1.15);
  }

  // ================================================================ lamp posts: a web under the arm, a bat, a pumpkin at the foot
  // (each lamp's own frame from its prop: position, turn and scale, so it's right even mid-pop-in)
  ctx.view.island?.updateMatrixWorld?.(true);
  const toIsland = ctx.view.island ? new THREE.Matrix4().copy(ctx.view.island.matrixWorld).invert() : new THREE.Matrix4();
  const lampProps = ctx.props.filter((p) => p.key === 'lampPost');
  for (const l of ctx.lamps) {
    const at = l.at || [0, 0];
    const lp = lampProps.find((p) => Math.hypot(p.x - at[0], p.z - at[1]) < 0.05);
    const post = l.glass?.parent;
    let m = null;
    if (lp) {
      m = new THREE.Matrix4().compose(V(lp.x, lp.y ?? ground(lp.x, lp.z), lp.z), new THREE.Quaternion().setFromAxisAngle(UP, lp.ry || 0), V(1, 1, 1).multiplyScalar(lp.scale || ctx.scale || 0.75));
    } else if (post) {
      post.updateMatrixWorld(true);
      m = new THREE.Matrix4().multiplyMatrices(toIsland, post.matrixWorld);
    }
    if (m) {
      const local = new THREE.Matrix4().makeTranslation(0.03, 1.48, 0.0);
      addWeb(new THREE.Matrix4().multiplyMatrices(m, local), 0.27, { a0: -Math.PI / 2, a1: 0, spokes: 14, rings: 4, w: 0.03 });
      const bat = V(0.2, 1.49, 0.07).applyMatrix4(m);
      hangingBat(dressing, bat.x, bat.y, bat.z, 1.5);
      const foot = V(0.0, 0, 0.38).applyMatrix4(m);
      jack(foot.x, foot.z, 1.0, { y: ground(foot.x, foot.z) });
    } else {
      jack(at[0], at[1] + 0.24, 1.0);
    }
  }

  // ================================================================ paths and grass: jack-o'-lanterns everywhere
  ctx.pathSpots(28, { spacing: 0.75, r: 0.15 }).forEach(([x, z], i) => jack(x, z, 0.95 + (i % 3) * 0.15));
  ctx.spots(16, { r: 0.22, from: 1.5, to: 7.5, spacing: 1.2, front: 0.1 }).forEach(([x, z], i) => {
    jack(x, z, 1.2 + (i % 2) * 0.25, { carved: i % 3 !== 2, ry: faceCam(1.2) });
    jack(x + 0.2 * S, z + 0.08 * S, 0.75, { carved: false, ry: rand() * TAU });
  });

  // ================================================================ the island-wide meshes
  // cobwebs
  if (webPos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(webPos, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    own.push(geo);
    const webs = new THREE.Mesh(geo, WEB);
    webs.name = 'Cobwebs';
    webs.userData.noPop = true;
    webs.userData.onBuilding = true;
    root.add(webs);
  }
  // spiders and their threads
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _mm = new THREE.Matrix4();
  let spiderIM = null, threadIM = null;
  if (spiders.length) {
    const sg = spiderGeo();
    const tg = new THREE.BoxGeometry(0.012, 1, 0.012).translate(0, -0.5, 0);
    own.push(sg, tg);
    spiderIM = new THREE.InstancedMesh(sg, LIT, spiders.length);
    threadIM = new THREE.InstancedMesh(tg, THREAD, spiders.length);
    for (const im of [spiderIM, threadIM]) { im.frustumCulled = false; im.userData.noPop = true; im.userData.onBuilding = true; root.add(im); }
    spiderIM.name = 'Spiders';
    threadIM.name = 'Spider threads';
    for (const sp of spiders) sp.q = new THREE.Quaternion().setFromEuler(_e.set(0, sp.ry, 0));
  }
  function placeSpiders(time) {
    if (!spiderIM) return;
    for (let i = 0; i < spiders.length; i++) {
      const sp = spiders[i];
      const y = sp.top - sp.len * (0.78 + 0.22 * Math.sin(time * 1.5 + sp.ph));
      spiderIM.setMatrixAt(i, _mm.compose(_p.set(sp.x, y, sp.z), sp.q, _s.set(sp.s, sp.s, sp.s)));
      threadIM.setMatrixAt(i, _mm.compose(_p.set(sp.x, sp.top, sp.z), _q.identity(), _s.set(1, sp.top - y, 1)));
    }
    spiderIM.instanceMatrix.needsUpdate = true;
    threadIM.instanceMatrix.needsUpdate = true;
  }
  placeSpiders(0);
  // orange and purple lights
  const bulbGeo = new THREE.SphereGeometry(0.062, 6, 5);
  own.push(bulbGeo);
  [BULB_O, BULB_P].forEach((m, k) => {
    if (!bulbs[k].length) return;
    const im = new THREE.InstancedMesh(bulbGeo, m, bulbs[k].length);
    bulbs[k].forEach(([x, y, z], i) => im.setMatrixAt(i, _mm.makeTranslation(x, y, z)));
    im.computeBoundingSphere();
    im.name = k ? 'Purple lights' : 'Orange lights';
    im.userData.noPop = true;
    im.userData.onFence = true;
    root.add(im);
  });
  // jack-o'-lanterns (bodies for all, faces for the carved ones)
  if (jacks.length) {
    const pg = new THREE.Group();
    pumpkin(pg, 0.18, { carved: true });
    const parts = bakeGeos(pg);
    own.push(parts.lit, parts.warm);
    const bodies = new THREE.InstancedMesh(parts.lit, LIT, jacks.length);
    const carved = jacks.filter((j) => j.carved);
    const faces = new THREE.InstancedMesh(parts.warm, WARM, Math.max(1, carved.length));
    faces.count = carved.length;
    const tint = new THREE.Color();
    let f = 0;
    jacks.forEach((j, i) => {
      _mm.compose(_p.set(j.x, j.y, j.z), _q.setFromEuler(_e.set(0, j.ry, 0)), _s.set(j.s, j.s * (0.92 + (i % 3) * 0.06), j.s));
      bodies.setMatrixAt(i, _mm);
      bodies.setColorAt(i, tint.setScalar(0.9 + (i % 4) * 0.035));
      if (j.carved) faces.setMatrixAt(f++, _mm);
    });
    for (const im of [bodies, faces]) { im.computeBoundingSphere(); im.userData.noPop = true; im.userData.onFence = true; root.add(im); }
    bodies.name = 'Pumpkins';
    faces.name = 'Pumpkin faces';
    bodies.castShadow = false;
  }
  // bats hanging in the trees and from the lamps
  if (dressing.children.length) {
    const d = finish(dressing, { name: 'Hanging bats' });
    d.userData.noPop = true;
    d.userData.onBuilding = true;
    root.add(d);
  }
  // floating ghosts
  const ghostSpots = ctx.spots(12, { r: 0.5, from: 2, to: 7.5, spacing: 1.4, block: false }); // (room to drift)
  let ghostIM = null, ghostFaceIM = null;
  const ghosts = ghostSpots.map(([x, z], i) => ({ x, z, y: ground(x, z) + 0.6 + (i % 3) * 0.25, ph: i * 1.7, s: S * (1.35 + (i % 3) * 0.2) }));
  if (ghosts.length) {
    const gp = ghostParts();
    own.push(gp.body, gp.face);
    ghostIM = new THREE.InstancedMesh(gp.body, GHOST, ghosts.length);
    ghostFaceIM = new THREE.InstancedMesh(gp.face, GHOST_FACE, ghosts.length);
    for (const im of [ghostIM, ghostFaceIM]) { im.frustumCulled = false; im.userData.noPop = true; root.add(im); }
    ghostIM.name = 'Ghosts';
    ghostFaceIM.name = 'Ghost faces';
  }
  function placeGhosts(time) {
    if (!ghostIM) return;
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i];
      const a = time * 0.35 + g.ph;
      _p.set(g.x + Math.cos(a) * 0.3, g.y + 0.12 * Math.sin(time * 1.4 + g.ph), g.z + Math.sin(a) * 0.3);
      _q.setFromEuler(_e.set(0.08 * Math.sin(time * 1.1 + g.ph), 0.5 * Math.sin(time * 0.4 + g.ph), 0.1 * Math.sin(time * 0.9 + g.ph)));
      _mm.compose(_p, _q, _s.set(g.s, g.s, g.s));
      ghostIM.setMatrixAt(i, _mm);
      ghostFaceIM.setMatrixAt(i, _mm);
    }
    ghostIM.instanceMatrix.needsUpdate = true;
    ghostFaceIM.instanceMatrix.needsUpdate = true;
  }
  placeGhosts(0);
  // bats flapping round the graveyard and the spooky trees
  const batCentres = [grave ? [grave.position.x, grave.position.z] : null, ...spooky].filter(Boolean);
  if (!batCentres.length) batCentres.push(ctx.home);
  const batGeo = flyingBatGeo();
  own.push(batGeo);
  const BATS = 16;
  const bats = new THREE.InstancedMesh(batGeo, BAT, BATS);
  bats.frustumCulled = false;
  bats.name = 'Bats';
  bats.userData.noPop = true;
  root.add(bats);
  const batInfo = [...Array(BATS)].map((_, i) => {
    const [cx, cz] = batCentres[i % batCentres.length];
    return { cx, cz, r: 0.5 + (i % 3) * 0.3, h: ground(cx, cz) + 1.5 + (i % 4) * 0.25, sp: (0.7 + (i % 5) * 0.15) * (i % 2 ? 1 : -1), ph: i * 1.3 };
  });
  function placeBats(time) {
    for (let i = 0; i < BATS; i++) {
      const b = batInfo[i];
      const a = time * b.sp + b.ph;
      _p.set(b.cx + Math.cos(a) * b.r, b.h + 0.15 * Math.sin(time * 2 + b.ph), b.cz + Math.sin(a) * b.r);
      _q.setFromEuler(_e.set(0, (b.sp > 0 ? Math.PI : 0) - a, 0));
      _mm.compose(_p, _q, _s.set(S * 1.2 * (0.35 + 0.65 * Math.abs(Math.sin(time * 9 + b.ph))), S * 1.2, S * 1.2));
      bats.setMatrixAt(i, _mm);
    }
    bats.instanceMatrix.needsUpdate = true;
  }
  placeBats(0);

  // ================================================================ the sheep's costumes
  const wearGeo = {};
  function sheepWear(i) {
    const kind = ['witch', 'pumpkin', 'witch', 'devil'][i % 4];
    if (!wearGeo[kind]) { wearGeo[kind] = bakeGeos(costumeGroup(kind)); own.push(...Object.values(wearGeo[kind])); }
    const g = new THREE.Group();
    g.name = 'Halloween costume';
    for (const [k, geo] of Object.entries(wearGeo[kind])) {
      const m = new THREE.Mesh(geo, MATS[k]);
      m.castShadow = k === 'lit';
      g.add(m);
    }
    return g;
  }

  // ================================================================ every frame
  function update(dt, time, { night = 0, k = 1 } = {}) {
    if (!k) return;
    const flick = 0.86 + 0.08 * Math.sin(time * 7.3) + 0.06 * Math.sin(time * 13.1 + 1.3);
    WARM.color.setScalar(Math.min(1, (0.78 + 0.3 * night) * flick));
    TOXICM.color.setScalar(0.78 + 0.22 * night + 0.06 * Math.sin(time * 3));
    EYES.color.setScalar(0.65 + 0.35 * night);
    const tw = 0.5 + 0.5 * Math.sin(time * 2.2);
    const glowK = 0.8 + 0.2 * night; // bright enough to read by day too
    BULB_O.color.copy(baseO).multiplyScalar(glowK * (0.82 + 0.18 * tw));
    BULB_P.color.copy(baseP).multiplyScalar(glowK * (1 - 0.18 * tw));
    WEB.color.copy(baseWeb).multiplyScalar(1 - 0.25 * night);
    GHOST.emissiveIntensity = 0.18 + 0.7 * night;
    POOL.opacity = (0.1 + 0.45 * night) * flick * k;
    POOL_G.opacity = (0.06 + 0.32 * night) * k;
    placeSpiders(time);
    placeGhosts(time);
    placeBats(time);
    if (bubbles) {
      const info = bubbles.userData.info;
      for (let i = 0; i < info.length; i++) {
        const b = info[i];
        const t = (time * b.sp + b.ph) % 1;
        const s = Math.max(0.001, Math.sin(t * Math.PI) * 1.2);
        bubbles.setMatrixAt(i, _mm.compose(_p.set(b.x, 0.5 + t * 0.14, b.z), _q.identity(), _s.set(s, s, s)));
      }
      bubbles.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    root,
    update,
    lampColors: [0xff8a2a, 0xa860ff],
    sheepWear,
    dispose() {
      for (const o of own) o.dispose?.();
      own.length = 0;
    },
  };
}
