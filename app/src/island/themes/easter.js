// The Easter theme: the whole farm in bold spring colours (hot pink, violet, sunny yellow, sky blue,
// mint and orange, with white). Pale pastels vanish against spring grass, so they are only accents.
//
//   centrepiece   a giant painted egg (1.6 tall) in a big straw nest, tied with a ribbon and a huge bow,
//                 and a big white bunny sitting beside it
//   farmyard      an arch of painted eggs over the front, ribbon maypoles with bunnies dancing round
//                 them, a giant chocolate bunny, a carrot patch with a bunny
//   fences        thick bunting with big flags along every fence, a string of little eggs along the top
//                 rail, pompoms at the knots, big bows at the corners and giant eggs standing all along
//   gates         a pair of giant eggs either side of every gate and an arch of eggs over it, with a bow
//   buildings     big bunny ears on every roof, a paper egg-and-flower garland and bows across every
//                 front, a giant egg by a front corner (the barn: ears, a wreath of eggs, garlands)
//   trees         every tree hung all over with big painted eggs, a bow on every trunk (or pine top)
//   lamp posts    a candy-striped ribbon wound up every post, a ring of flowers, a big bow, an egg at its foot
//   grass         a hundred painted eggs and little egg piles, hundreds of tulips and daffodils, bunnies
//                 (half of them hopping round in arcs)
//   paths         Easter baskets, little egg trees in pots, painted eggs lining them
//   sheep         tall bunny ears on a headband, flower crowns or straw Easter bonnets, by turns
//
// Nearly everything is built from flat-shaded primitives with the colours painted into the vertices,
// so each placed thing is one mesh (one draw call) on one shared material, and everything repeated
// island-wide (eggs, bows, flags, bunnies, flowers) is one InstancedMesh per kind.
import * as THREE from 'three';
import { jitter, mat, mesh, rng } from '../props.js';
import { towerRadiusAt as lhR, LIGHTHOUSE } from '../lighthouse.js';

const C = {
  pink: 0xff5fa8, violet: 0x9a5cff, yellow: 0xffd23a, sky: 0x46b4ff, mint: 0x3fd6a0, orange: 0xff9a3c,
  white: 0xffffff, red: 0xff3b5c, blush: 0xffa6d0, lilac: 0xc6a2ff, // (the two pastels: accents only)
  green: 0x4f9a35, leaf: 0x72b843, straw: 0xe8c065, strawDark: 0xc79a3e, wicker: 0xc9925a, wickerDark: 0xa8763f,
  soil: 0x6e4a31, carrot: 0xf5862a, wood: 0x8a6a4f, dark: 0x2f2a2c, pot: 0xd9825b, brown: 0xb07a50,
};
const BRIGHTS = [C.pink, C.yellow, C.sky, C.violet, C.orange, C.mint];
const FLAGS = [C.pink, C.yellow, C.sky, C.white, C.violet, C.orange, C.mint];
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// one material for everything painted in its vertices, a glossier one for the painted eggs, one for
// the flags (seen from both sides) and one for things coloured per instance
const VC = () => mat(0xffffff, { vertexColors: true });
const GLOSS = () => mat(0xffffff, { vertexColors: true, roughness: 0.55 });
const FLAG = () => mat(0xffffff, { side: THREE.DoubleSide, roughness: 0.8 });
const TINT = () => mat(0xffffff, { roughness: 0.6 });

// ---------------------------------------------------------------- a kit of parts merged into one mesh

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
const compose = (pos = [0, 0, 0], rot = [0, 0, 0], s = 1) => {
  const sc = Array.isArray(s) ? s : [s, s, s];
  return new THREE.Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(sc[0], sc[1], sc[2]));
};
/** An egg `h` long centred on `centre`, pointing along `dir` (for arches of eggs). */
const pointing = (centre, dir, h) => {
  _d.set(dir[0], dir[1], dir[2]).normalize();
  _q.setFromUnitVectors(_up, _d);
  return new THREE.Matrix4().compose(_p.set(centre[0] - (_d.x * h) / 2, centre[1] - (_d.y * h) / 2, centre[2] - (_d.z * h) / 2), _q, _s.set(h, h, h));
};
/** Is (x, z) inside the ring? */
const inRing = (x, z, ring) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};

/** Collects coloured parts (each with its own place) into one geometry. color: a hex, or (x, y, z) -> hex per face. */
class Kit {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.stack = [new THREE.Matrix4()]; }
  /** Parts added inside fn are placed relative to (pos, rot, scale). */
  group(pos, rot, s, fn) {
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(compose(pos, rot, s)));
    fn();
    this.stack.pop();
    return this;
  }
  add(geo, color, pos, rot, s) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      let col = color;
      if (typeof color === 'function') {
        const n = Math.min(3, p.count - i);
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < n; k++) { x += p.getX(i + k) / n; y += p.getY(i + k) / n; z += p.getZ(i + k) / n; }
        col = color(x, y, z);
      }
      _c.set(col);
      for (let k = 0; k < 3 && i + k < p.count; k++) this.col.push(_c.r, _c.g, _c.b);
    }
    _m.multiplyMatrices(this.stack[this.stack.length - 1], compose(pos, rot, s));
    g.applyMatrix4(_m);
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    for (let i = 0; i < pa.length; i++) { this.pos.push(pa[i]); this.nor.push(na[i]); }
    g.dispose();
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  mesh(cast = true, receive = true, material = VC()) { return mesh(this.geometry(), material, cast, receive); }
}

// ---------------------------------------------------------------- shapes

const SPHERE = new THREE.SphereGeometry(1, 8, 6);
const BLOB = new THREE.IcosahedronGeometry(1, 0);
const DOT = new THREE.OctahedronGeometry(1, 0);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const DISC = new THREE.CylinderGeometry(1, 1, 0.18, 7).rotateX(Math.PI / 2); // a flat paper flower facing +z

/** The egg's radius at height y (a unit egg: 1 tall, fatter below the middle). */
const eggR = (y) => { const s = clamp(2 * y - 1, -1, 1); return 0.37 * Math.sqrt(1 - s * s) * (1 - 0.12 * s); };
function eggLathe(seg, rings) {
  const pts = [];
  for (let k = 0; k <= rings; k++) {
    const th = -Math.PI / 2 + (Math.PI * k) / rings;
    const y = 0.5 + 0.5 * Math.sin(th);
    pts.push(new THREE.Vector2(k === 0 || k === rings ? 0 : eggR(y), y));
  }
  return new THREE.LatheGeometry(pts, seg);
}
const EGG_S = eggLathe(8, 10); // the hundreds of instanced eggs (low-poly)
const EGG = eggLathe(14, 12);
const EGG_FINE = eggLathe(22, 20);
const MINI_EGG = eggLathe(6, 6);

// painted patterns on a unit egg, by where each face is: wide bands in strong colours read from afar
const tri = (x, z, n) => { const a = (Math.atan2(z, x) / Math.PI + 1) * n; return Math.abs((a % 2) - 1) * 2 - 1; }; // -1..1, n peaks round
const zig = (x, y, z, n, amp) => y + tri(x, z, n) * amp;
const PATTERNS = [
  // hot pink with white and yellow bands
  (x, y) => (y < 0.32 ? C.pink : y < 0.43 ? C.white : y < 0.57 ? C.yellow : y < 0.68 ? C.white : C.pink),
  // violet with a yellow zigzag and a white tip
  (x, y, z) => { const w = zig(x, y, z, 4, 0.07); return y > 0.84 ? C.white : w > 0.38 && w < 0.6 ? C.yellow : C.violet; },
  // sky blue with a yellow band (and white dots)
  (x, y) => (y > 0.44 && y < 0.6 ? C.yellow : C.sky),
  // sunny yellow with an orange zigzag, pink at the tip and the foot
  (x, y, z) => { const w = zig(x, y, z, 4, 0.07); return y > 0.8 || y < 0.12 ? C.pink : w > 0.38 && w < 0.58 ? C.orange : C.yellow; },
  // mint with a white-edged hot pink band and a white tip
  (x, y, z) => { const w = zig(x, y, z, 5, 0.04); return w > 0.43 && w < 0.58 ? C.pink : w > 0.35 && w < 0.67 ? C.white : y > 0.86 ? C.white : C.mint; },
  // hot pink with a violet band (and white and yellow dots)
  (x, y) => (y > 0.44 && y < 0.6 ? C.violet : C.pink),
];
const NP = PATTERNS.length;
const DOTS = { 2: [[0.26, 6, C.white, C.white], [0.74, 6, C.white, C.white], [0.89, 3, C.white, C.white]], 5: [[0.26, 6, C.white, C.yellow], [0.74, 5, C.yellow, C.white]] };
const GRAND = (x, y, z) => {
  const w = y + tri(x, z, 9) * 0.035;
  if (y < 0.15) return C.violet;
  if (w < 0.25) return C.white;
  if (y < 0.48) return C.sky;
  if (y < 0.65) return C.yellow;
  if (w < 0.72) return C.white;
  if (w < 0.87) return C.pink;
  return C.violet;
};

/** An egg `h` tall standing at pos (its foot), painted with pattern p (0..5). */
function addEgg(kit, p, pos, h, rot = [0, 0, 0], geo = EGG) {
  p = ((p % NP) + NP) % NP;
  kit.group(pos, rot, h, () => {
    kit.add(geo, PATTERNS[p]);
    if (DOTS[p]) addDots(kit, DOTS[p], 0.06);
  });
}
function addDots(kit, rows, r) {
  for (const [y, n, a1, a2] of rows) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + y * 5;
      const rr = eggR(y) * 0.97;
      kit.add(DOT, i % 2 ? a2 : a1, [Math.cos(a) * rr, y, Math.sin(a) * rr], [0, -a, 0], r);
    }
  }
}

/** A ribbon bow about `size` across, facing +z. */
function addBow(kit, col, pos, size, rot = [0, 0, 0]) {
  kit.group(pos, rot, size, () => {
    for (const s of [-1, 1]) {
      kit.add(new THREE.TorusGeometry(0.2, 0.085, 4, 9), col, [s * 0.22, 0.02, 0], [0, 0, s * 0.25], [1, 0.75, 0.6]);
      kit.add(BOX, col, [s * 0.12, -0.21, 0], [0, 0, s * 0.32], [0.12, 0.38, 0.04]);
    }
    kit.add(BLOB, col, [0, 0, 0.01], [0, 0, 0], 0.1);
  });
}

/** Bunny ears `len` tall standing up from pos (white, pink inside, facing +z). */
function addEars(kit, pos, len, rot = [0, 0, 0]) {
  kit.group(pos, rot, len, () => {
    for (const s of [-1, 1]) {
      kit.group([s * 0.17, 0, 0], [-0.08, 0, -s * 0.16], 1, () => {
        kit.add(SPHERE, C.white, [0, 0.5, 0], [0, 0, 0], [0.18, 0.52, 0.08]);
        kit.add(SPHERE, C.pink, [0, 0.5, 0.045], [0, 0, 0], [0.11, 0.4, 0.05]);
      });
    }
  });
}

/** A rabbit sitting, facing +z, about 0.42 * s tall to the ear tips (0.28 * s to the top of its head). */
function addBunny(kit, fur, pos, s = 1, ry = 0, belly = fur === C.white ? 0xfbf6f0 : 0xf4ece4) {
  kit.group(pos, [0, ry, 0], s, () => {
    kit.add(SPHERE, fur, [0, 0.1, 0], [0, 0, 0], [0.105, 0.1, 0.13]);
    kit.add(SPHERE, belly, [0, 0.09, 0.07], [0, 0, 0], [0.075, 0.08, 0.06]);
    kit.add(SPHERE, fur, [0, 0.2, 0.1], [0, 0, 0], 0.075);
    kit.add(BLOB, 0xffffff, [0, 0.1, -0.13], [0, 0, 0], 0.045);
    kit.add(SPHERE, C.pink, [0, 0.2, 0.174], [0, 0, 0], 0.014);
    for (const k of [-1, 1]) {
      kit.add(SPHERE, belly, [k * 0.06, 0.02, 0.08], [0, 0, 0], [0.035, 0.022, 0.056]);
      kit.add(SPHERE, C.dark, [k * 0.036, 0.225, 0.162], [0, 0, 0], 0.012);
      kit.add(SPHERE, belly, [k * 0.022, 0.185, 0.165], [0, 0, 0], 0.024);
      kit.group([k * 0.032, 0.25, 0.08], [-0.15, 0, -k * 0.2], 1, () => {
        kit.add(SPHERE, fur, [0, 0.085, 0], [0, 0, 0], [0.026, 0.09, 0.015]);
        kit.add(SPHERE, C.pink, [0, 0.085, 0.009], [0, 0, 0], [0.015, 0.068, 0.008]);
      });
    }
  });
}

/** Thin box from a to b (string, twig, ribbon). */
function addRod(kit, col, a, b, w = 0.012) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  kit.add(BOX, col, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [e.x, e.y, e.z], [w, len, w]);
}

/** A ribbon wound `turns` times up a post of radius r from y0 to y1. */
function addSpiral(kit, col, r, y0, y1, turns, phase = 0, tube = 0.022) {
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48, a = t * TAU * turns + phase;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + t * (y1 - y0), Math.sin(a) * r));
  }
  kit.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, tube, 4), col);
}

const GARLAND = [C.pink, C.yellow, C.sky, C.white, C.violet, C.orange, C.mint];
/**
 * A paper garland swagged along a polyline (in the parent's space): big paper flowers and paper eggs
 * on a string, each swag facing away from `centre` [x, z] (or toward +z without one).
 */
function addGarland(kit, pts, sag, size, seed = 0, centre = null) {
  let j = seed;
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1];
    const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    let nx = -dz, nz = dx;
    const ox = centre ? (a[0] + b[0]) / 2 - centre[0] : 0, oz = centre ? (a[2] + b[2]) / 2 - centre[1] : 1;
    if (nx * ox + nz * oz < 0) { nx = -nx; nz = -nz; }
    const yaw = nx || nz ? Math.atan2(nx, nz) : 0;
    const n = Math.max(2, Math.round(Math.hypot(dx, dz, b[1] - a[1]) / (size * 2)));
    for (let i = 0; i < 6; i++) addRod(kit, C.white, at(i / 6), at((i + 1) / 6), 0.02);
    for (let i = s ? 1 : 0; i <= n; i++) {
      const p = at(i / n);
      const col = GARLAND[j++ % GARLAND.length];
      kit.group([p[0] + Math.sin(yaw) * 0.02, p[1], p[2] + Math.cos(yaw) * 0.02], [0, yaw, 0], size, () => {
        if (j % 2) kit.add(SPHERE, col, [0, -0.95, 0], [0, 0, 0], [0.72, 1, 0.3]); // a paper egg
        else {
          kit.add(DISC, col, [0, -0.85, 0]); // a paper flower with a bright middle
          kit.add(DISC, col === C.yellow ? C.orange : C.yellow, [0, -0.85, 0.1], [0, 0, 0], [0.4, 0.4, 1]);
        }
      });
    }
  }
}

/** Points round (cx, cz) at height y, radius r, from angle a0 to a1 (0 = the front, +z). */
const arc = (cx, y, cz, r, a0, a1, n) => [...Array(n + 1)].map((_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r]; });

/**
 * Where the Easter things go on each kind of building, in its own space at scale 1 (front +z):
 * ears (on the roof top, `len` tall), garland swags { pts, sag, centre? } and bows [x, y, z, yaw?].
 */
function buildingPlan(b) {
  const sc = b.scale || 1, R = (b.r || 0.6) / sc, Ht = (b.height || 1) / sc;
  const sw = (pts, sag = 0.1, centre = null) => ({ pts, sag, centre });
  switch (b.key) {
    case 'farmhouse': {
      const porch = [[-0.52, 0.76, 0.86], [0, 0.76, 0.86], [0.52, 0.76, 0.86]];
      return { ears: [0, 1.4, -0.06], len: 0.8, swags: [sw(porch, 0.12)], bows: porch };
    }
    case 'machineShed': {
      const header = [[-0.82, 1.02, 0.65], [-0.27, 1.02, 0.65], [0.27, 1.02, 0.65], [0.82, 1.02, 0.65]];
      return { ears: [0, 1.1, 0], len: 0.8, swags: [sw(header, 0.12)], bows: header };
    }
    case 'grainBins': {
      const bins = [[-0.5, 0.05, 0.34, 0.95], [0.2, -0.12, 0.38, 1.05], [0.72, 0.25, 0.26, 0.75]];
      return {
        ears: [0.2, 1.38, -0.12], len: 0.72,
        swags: bins.map(([x, z, r, h]) => sw(arc(x, 0.05 + h * 0.72, z, r + 0.03, -1.3, 1.3, 3), 0.05, [x, z])),
        bows: bins.map(([x, z, r, h]) => [x, 0.05 + h * 0.72, z + r + 0.05]),
      };
    }
    case 'chickenCoop': {
      const run = [[-0.6, 0.27, 0.75], [-0.15, 0.27, 0.75], [0.3, 0.27, 0.75], [0.7, 0.27, 0.75]];
      return { ears: [-0.2, 0.85, -0.25], len: 0.6, swags: [sw(run, 0.06)], bows: [run[0], run[3]] };
    }
    case 'greenhouse': {
      const wall = [[-0.72, 0.28, 0.56], [0, 0.28, 0.56], [0.72, 0.28, 0.56]];
      return { ears: [0, 0.7, 0], len: 0.64, swags: [sw(wall, 0.05)], bows: wall };
    }
    case 'well':
      return { ears: [0, 0.83, 0], len: 0.45, swags: [sw(arc(0, 0.3, 0, 0.27, -1.4, 1.4, 3), 0.03, [0, 0])], bows: [[0, 0.3, 0.3]] };
    case 'silo':
      return { ears: [0, 2.5, 0], len: 0.85, swags: [sw(arc(0, 1.86, 0, 0.57, -1.6, 1.6, 4), 0.07, [0, 0]), sw(arc(0, 1.1, 0, 0.57, -1.6, 1.6, 4), 0.07, [0, 0])], bows: [[0, 1.86, 0.62], [0.58, 1.86, 0, Math.PI / 2], [-0.58, 1.86, 0, -Math.PI / 2]] };
    case 'windmill':
      // round the gallery band (the sails turn in front of the cap)
      return { ears: [0, 2.66, 0], len: 0.75, swags: [sw(arc(0, 1.0, 0, 0.54, -1.6, 1.6, 4), 0.08, [0, 0])], bows: [[0, 1.02, 0.6], [0.56, 1.02, 0, Math.PI / 2], [-0.56, 1.02, 0, -Math.PI / 2]] };
    case 'lighthouse': {
      // ears up off the cap, a swag round the gallery rail and one round the tower under its window
      const y = 0.9, r = lhR(y) + 0.04;
      return {
        ears: [0, LIGHTHOUSE.capTop - 0.04, 0], len: 0.6,
        swags: [sw(arc(0, LIGHTHOUSE.railY - 0.02, 0, LIGHTHOUSE.railR + 0.04, -1.6, 1.6, 4), 0.06, [0, 0]), sw(arc(0, y, 0, r, -1.6, 1.6, 4), 0.07, [0, 0])],
        bows: [[0, y + 0.02, r + 0.02], [r + 0.02, y + 0.02, 0, Math.PI / 2], [-r - 0.02, y + 0.02, 0, -Math.PI / 2]],
      };
    }
    case 'dock': case 'boat': case 'rowboat':
      return null;
    default: {
      const front = [[-R * 0.55, Ht * 0.45, R * 0.72], [0, Ht * 0.45, R * 0.72], [R * 0.55, Ht * 0.45, R * 0.72]];
      return { ears: [0, Ht - 0.04, 0], len: clamp(0.45 + Ht * 0.2, 0.5, 0.9), swags: [sw(front, 0.1)], bows: front };
    }
  }
}

// ---------------------------------------------------------------- the placed things

/** The giant painted egg (1.6 tall, 1.75 with its nest) in a straw nest, a big bow, a big bunny beside it. */
function centrepiece() {
  const kit = new Kit();
  const r = rng(41);
  // the nest: a squashed ring of straw on a straw floor, with loose straws sticking out
  kit.group([0, 0, 0], [0, 0, 0], 1.2, () => {
    kit.add(new THREE.CylinderGeometry(0.52, 0.58, 0.1, 14), C.strawDark, [0, 0.05, 0]);
    kit.add(jitter(new THREE.TorusGeometry(0.58, 0.2, 7, 18), [0.08, 0.08, 0.08]), (x, y) => ((Math.floor((Math.atan2(y, x) + 4) * 5) % 2) ? C.straw : C.strawDark), [0, 0.15, 0], [Math.PI / 2, 0, 0], [1, 1, 0.6]);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU + r.range(-0.1, 0.1), d = r.range(0.5, 0.76);
      kit.add(BOX, i % 2 ? C.straw : 0xf0d27e, [Math.cos(a) * d, r.range(0.1, 0.26), Math.sin(a) * d], [r.range(-0.6, 0.6), -a + Math.PI / 2 + r.range(-0.5, 0.5), r.range(-0.6, 0.6)], [0.03, 0.03, r.range(0.3, 0.45)]);
    }
  });
  // the giant egg, banded and dotted
  const H = 1.62, y0 = 0.1;
  kit.group([0, y0, 0], [0, 0, 0], H, () => {
    kit.add(EGG_FINE, GRAND);
    addDots(kit, [[0.37, 11, C.white, C.white], [0.8, 9, C.yellow, C.white], [0.93, 4, C.white, C.white]], 0.035);
  });
  // a hot pink ribbon round it and a huge bow at the front, its tails hanging down
  const by = y0 + 0.565 * H, br = eggR(0.565) * H + 0.015;
  kit.add(new THREE.TorusGeometry(br, 0.045, 4, 28), C.pink, [0, by, 0], [Math.PI / 2, 0, 0], [1, 1, 1.5]);
  addBow(kit, C.pink, [0, by, br + 0.04], 0.9);
  // painted eggs tucked all round the nest
  for (let i = 0; i < 9; i++) {
    const a = 0.3 + (i / 9) * TAU;
    addEgg(kit, i, [Math.cos(a) * 0.66, 0.16, Math.sin(a) * 0.66], 0.32, [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]);
  }
  // a big white bunny sitting beside it at the front, looking out
  addBunny(kit, C.white, [0.92, 0, 0.72], 2.3, -0.35);
  addBow(kit, C.violet, [0.92 + Math.sin(-0.35) * 0.37, 0.43, 0.72 + Math.cos(-0.35) * 0.37], 0.3, [0, -0.35, 0]);
  const o = kit.mesh();
  o.name = 'Giant Easter egg';
  return o;
}

/** An arch of painted eggs (about 1.75 tall, 1.8 across), with a bow on top and an egg hanging under it. */
function eggArch() {
  const kit = new Kit();
  const W = 0.8, P = 0.72, h = 0.26, step = 0.15;
  for (const s of [-1, 1]) {
    kit.add(BOX, C.white, [s * W, P / 2, 0], [0, 0, 0], [0.07, P, 0.07]);
    kit.add(BOX, C.violet, [s * W, 0.04, 0], [0, 0, 0], [0.22, 0.08, 0.22]);
  }
  kit.add(new THREE.TorusGeometry(W, 0.035, 5, 20, Math.PI), C.white, [0, P, 0]);
  // eggs all along it, two rows, every one pointing outward like a balloon arch
  const at = [];
  for (const s of [-1, 1]) for (let y = 0.16; y < P; y += step) at.push([s * W, y, -s * (Math.PI / 2)]);
  const n = Math.round((Math.PI * W) / step);
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; at.push([Math.cos(a) * W, P + Math.sin(a) * W, a - Math.PI / 2]); }
  at.forEach(([x, y, th], i) => {
    for (const row of [0, 1]) {
      kit.group([x, y, row ? -0.075 : 0.075], [0, 0, th], 1, () => addEgg(kit, i + row * 3, [0, -h / 2, 0], h, [0, i, 0], EGG_S));
    }
  });
  // a big bow at the top and an egg hanging under it
  const top = P + W + 0.1;
  addBow(kit, C.pink, [0, top, 0.12], 0.55);
  addRod(kit, C.white, [0, P + W - 0.08, 0], [0, 1.18, 0], 0.014);
  addEgg(kit, 2, [0, 0.86, 0], 0.32);
  const o = kit.mesh();
  o.name = 'Egg arch';
  return o;
}

const MAYPOLE_T = 2.2;
/** A maypole (2.4 tall): a striped post with a crown of flowers and an egg on top. */
function maypolePole(seed) {
  const kit = new Kit();
  const T = MAYPOLE_T;
  kit.add(new THREE.CylinderGeometry(0.045, 0.06, T, 8), C.white, [0, T / 2, 0]);
  addSpiral(kit, seed % 2 ? C.violet : C.pink, 0.055, 0.1, T - 0.1, 4, 0);
  addSpiral(kit, C.yellow, 0.055, 0.1, T - 0.1, 4, Math.PI);
  kit.add(new THREE.TorusGeometry(0.13, 0.03, 4, 12), C.green, [0, T - 0.06, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    kit.add(BLOB, BRIGHTS[(i + seed) % BRIGHTS.length], [Math.cos(a) * 0.13, T - 0.04, Math.sin(a) * 0.13], [i, i, 0], 0.075);
  }
  addEgg(kit, 3 + seed, [0, T - 0.02, 0], 0.28);
  // flowers round its foot
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    kit.add(BLOB, BRIGHTS[(i * 2 + seed) % BRIGHTS.length], [Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2], [i, i, 0], 0.07);
    kit.add(BLOB, C.leaf, [Math.cos(a + 0.26) * 0.22, 0.03, Math.sin(a + 0.26) * 0.22], [i, 0, i], 0.05);
  }
  return kit.mesh();
}
/** Its ribbons, streaming down to bunnies dancing round it (this part turns). */
function maypoleRibbons(seed, dir = 1) {
  const kit = new Kit();
  const top = MAYPOLE_T - 0.12, R0 = 0.88, n = 10, endY = 0.3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const col = BRIGHTS[(i + seed) % BRIGHTS.length];
    const bunny = i % 2 === 0;
    const end = bunny ? endY : 0.06;
    let prev = null;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, rr = 0.06 + (R0 - 0.06) * t + Math.sin(t * Math.PI) * 0.1;
      const p = [ca * rr, top + (end - top) * t - Math.sin(t * Math.PI) * 0.12, sa * rr];
      if (prev) addRod(kit, col, prev, p, 0.04);
      prev = p;
    }
    if (bunny) addBunny(kit, i % 4 ? C.brown : C.white, [ca * (R0 + 0.06), 0, sa * (R0 + 0.06)], 1.35, dir > 0 ? Math.PI - a : -a);
    else addEgg(kit, i + seed, [ca * R0, 0, sa * R0], 0.2, [0, a, 0]);
  }
  return kit.mesh();
}

function carrotPatch() {
  const kit = new Kit();
  const r = rng(77);
  kit.add(jitter(new THREE.BoxGeometry(1.05, 0.12, 0.72, 4, 1, 3), [0.04, 0.03, 0.04]), C.soil, [0, 0.05, 0]);
  for (const z of [-0.22, 0, 0.22]) {
    for (let i = 0; i < 5; i++) {
      const x = -0.4 + i * 0.2 + r.range(-0.03, 0.03);
      kit.add(new THREE.CylinderGeometry(0.04, 0.022, 0.06, 6), C.carrot, [x, 0.13, z]);
      for (const k of [-1, 0, 1]) kit.add(new THREE.ConeGeometry(0.022, 0.2, 3), k ? C.leaf : C.green, [x + k * 0.03, 0.24, z], [0, k, k * 0.38]);
    }
  }
  // a giant carrot pulled up and lying in front, and a bunny eyeing it
  kit.group([0.2, 0.09, 0.5], [0, 0.25, 0], 1, () => {
    kit.add(new THREE.ConeGeometry(0.085, 0.5, 7), C.carrot, [0, 0, 0], [0, 0, Math.PI / 2]);
    for (const k of [-1, 0, 1]) kit.add(new THREE.ConeGeometry(0.03, 0.26, 3), C.leaf, [-0.32, 0.03 + k * 0.03, k * 0.04], [k * 0.4, 0, Math.PI / 2 + 0.25 + k * 0.2]);
  });
  addBunny(kit, C.brown, [-0.5, 0, 0.42], 1.4, 1.1);
  const o = kit.mesh();
  o.name = 'Carrot patch';
  return o;
}

/** A giant chocolate bunny (about 1.15 tall) on a gold foil stand, with a ribbon bow at its neck. */
function chocolateBunny() {
  const kit = new Kit();
  kit.add(new THREE.CylinderGeometry(0.4, 0.44, 0.08, 12), 0xf0c23a, [0, 0.04, 0]);
  kit.add(new THREE.TorusGeometry(0.42, 0.03, 4, 18), C.pink, [0, 0.08, 0], [Math.PI / 2, 0, 0]);
  addBunny(kit, 0x7a4a2a, [0, 0.07, 0], 2.6, 0, 0x91603a);
  addBow(kit, C.pink, [0, 0.07 + 0.13 * 2.6, 0.16 * 2.6], 0.42); // under its chin
  const o = kit.mesh();
  o.name = 'Chocolate bunny';
  return o;
}

function basket(seed) {
  const kit = new Kit();
  kit.group([0, 0, 0], [0, 0, 0], 1.5, () => {
    kit.add(new THREE.CylinderGeometry(0.17, 0.13, 0.15, 10), (x, y) => (Math.floor((y + 1) * 30) % 2 ? C.wicker : C.wickerDark), [0, 0.075, 0]);
    kit.add(new THREE.TorusGeometry(0.17, 0.022, 4, 14), C.wickerDark, [0, 0.15, 0], [Math.PI / 2, 0, 0]);
    kit.add(new THREE.TorusGeometry(0.15, 0.016, 4, 12, Math.PI), C.wickerDark, [0, 0.15, 0]);
    kit.add(new THREE.CylinderGeometry(0.155, 0.155, 0.02, 10), C.leaf, [0, 0.14, 0]);
    [[-0.07, 0.03], [0.06, -0.05], [0.0, 0.07], [0.08, 0.06], [-0.05, -0.07]].forEach(([x, z], i) => addEgg(kit, i + seed, [x, 0.12, z], 0.14, [0.3 * (i - 2), i, 0.2]));
    addBow(kit, BRIGHTS[seed % BRIGHTS.length], [0, 0.3, 0.02], 0.14);
  });
  const o = kit.mesh(false, true);
  o.name = 'Easter basket';
  return o;
}

function eggTree(seed) {
  const kit = new Kit();
  const r = rng(seed * 13 + 5);
  kit.add(new THREE.CylinderGeometry(0.11, 0.085, 0.14, 8), C.pot, [0, 0.07, 0]);
  kit.add(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 8), C.soil, [0, 0.135, 0]);
  addRod(kit, C.wood, [0, 0.13, 0], [0, 0.6, 0], 0.028);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + r.range(-0.3, 0.3);
    const y0 = 0.34 + (i % 3) * 0.08;
    const tip = [Math.cos(a) * 0.28, y0 + 0.22, Math.sin(a) * 0.28];
    addRod(kit, C.wood, [0, y0, 0], tip, 0.018);
    addRod(kit, C.white, tip, [tip[0], tip[1] - 0.06, tip[2]], 0.01);
    addEgg(kit, i + seed, [tip[0], tip[1] - 0.22, tip[2]], 0.17);
  }
  addBow(kit, BRIGHTS[(seed + 2) % BRIGHTS.length], [0, 0.17, 0.11], 0.16);
  const o = kit.mesh(false, true);
  o.name = 'Egg tree';
  return o;
}

// ---------------------------------------------------------------- the theme

export default function build(ctx) {
  const root = new THREE.Group();
  const s = ctx.scale;
  const H = ctx.heightAt;
  const obstaclesBefore = ctx.view.obstacles ? ctx.view.obstacles.slice() : [];
  const geos = [];
  const own = (o) => { o.traverse((c) => c.geometry && geos.push(c.geometry)); return o; };
  const place = (o, x, z, { ry = 0, sc = 1, flags = {} } = {}) => {
    o.position.set(x, H(x, z), z);
    o.rotation.y = ry;
    o.scale.multiplyScalar(sc);
    Object.assign(o.userData, flags);
    root.add(own(o));
    return o;
  };
  const R = rng(2024);

  // everything repeated island-wide is gathered here and instanced at the end:
  const eggs = [...Array(NP)].map(() => []); // painted eggs (one InstancedMesh per pattern)
  const bowList = []; // [matrix, colour]

  /** Up to n free spots scattered over the whole island (not just round the farmyard). */
  function scatter(n, { r = 0.2, gap = 0.6, from = 1.5, block = false, seed = 1 } = {}) {
    const rr = rng(seed);
    const out = [];
    const rad = ctx.radius;
    for (let t = 0; t < n * 60 && out.length < n; t++) {
      const a = rr() * TAU, d = Math.sqrt(rr()) * rad;
      const x = ctx.center[0] + Math.cos(a) * d, z = ctx.center[1] + Math.sin(a) * d;
      if (Math.hypot(x - ctx.home[0], z - ctx.home[1]) < from) continue;
      if (out.some(([px, pz]) => Math.hypot(px - x, pz - z) < gap)) continue;
      if (!ctx.free(x, z, r)) continue;
      ctx.take(x, z, r, { block });
      out.push([x, z]);
    }
    return out;
  }

  // (keep clear of the lamp posts: their ribbons and eggs go on them below)
  for (const l of ctx.lamps) if (l.at) ctx.take(l.at[0], l.at[1], 0.32, { block: false });

  // ---- the centrepiece, the egg arch, the chocolate bunny and the carrot patch, at the front of the farmyard
  let cp = ctx.spots(1, { r: 1.15, from: 2, to: 5.5 });
  if (!cp.length) cp = ctx.spots(1, { r: 0.8, from: 2, to: 6 });
  for (const [x, z] of cp) place(centrepiece(), x, z);
  for (const [x, z] of ctx.spots(1, { r: 0.9, from: 1.5, to: 4.5, front: 1.2 })) place(eggArch(), x, z);
  for (const [x, z] of ctx.spots(1, { r: 0.48, from: 2.2, to: 5.5, front: 0.8 })) place(chocolateBunny(), x, z, { ry: R.range(-0.3, 0.3) });
  for (const [x, z] of ctx.spots(1, { r: 0.75, from: 2.2, to: 6 })) place(carrotPatch(), x, z, { ry: R.range(-0.5, 0.5) });

  // ---- ribbon maypoles, with bunnies dancing round them holding the ribbons
  const maypoles = [];
  ctx.spots(2, { r: 1.1, from: 2.4, to: 6.5, spacing: 3.5 }).forEach(([x, z], i) => {
    const g = new THREE.Group();
    g.name = 'Maypole';
    g.add(maypolePole(i));
    const ribbons = maypoleRibbons(i * 3, i % 2 ? -1 : 1);
    g.add(ribbons);
    maypoles.push({ o: ribbons, dir: i % 2 ? -1 : 1 });
    place(g, x, z);
  });

  // ---- the barn: big bunny ears on the ridge, a wreath of eggs on the door, garlands up the door frame
  // and along the front (../decor.js already hangs bunting along its eaves and puts a basket by it)
  let barnBits = null;
  if (ctx.barn) {
    const kit = new Kit();
    addEars(kit, [0, 2.2, 0], 1.3);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      addEgg(kit, i, [Math.cos(a) * 0.3, 0.6 + Math.sin(a) * 0.3, 0.93], 0.22, [Math.PI / 2 - 0.2, 0, -a + Math.PI / 2]);
      kit.add(BLOB, i % 2 ? C.leaf : C.green, [Math.cos(a + 0.22) * 0.31, 0.6 + Math.sin(a + 0.22) * 0.31, 0.9], [i, i, 0], 0.06);
    }
    addBow(kit, C.pink, [0, 0.94, 1.0], 0.42);
    for (const x of [-0.45, 0.45]) addGarland(kit, [[x, 1.06, 0.9], [x, 0.14, 0.9]], 0, 0.17, x > 0 ? 3 : 0);
    for (const sd of [-1, 1]) {
      addGarland(kit, [[sd * 1.3, 1.14, 1.0], [sd * 0.62, 1.14, 1.0]], 0.12, 0.17, sd > 0 ? 2 : 5);
      addBow(kit, sd > 0 ? C.violet : C.sky, [sd * 1.3, 1.16, 1.03], 0.3);
    }
    barnBits = new THREE.Group();
    barnBits.name = 'Easter barn';
    barnBits.add(own(kit.mesh()));
  }

  // ---- every other building: bunny ears on the roof, a paper garland and bows across the front, a giant egg by it
  ctx.buildings.forEach((b, bi) => {
    if (b.key === 'barn' && barnBits) return;
    const plan = buildingPlan(b);
    if (!plan) return;
    const kit = new Kit();
    const r = b.r || 0.6;
    // the plan is in the building's own units: this mesh is in island units, so scale it
    kit.group([0, 0, 0], [0, 0, 0], b.scale || 1, () => {
      addEars(kit, plan.ears, plan.len);
      plan.swags.forEach((g, gi) => addGarland(kit, g.pts, g.sag, 0.2, bi * 3 + gi, g.centre));
      plan.bows.forEach((p, k) => {
        const yaw = p[3] || 0; // (a side bow says which way it faces)
        addBow(kit, BRIGHTS[(bi + k) % BRIGHTS.length], [p[0] + Math.sin(yaw) * 0.05, p[1] + 0.04, p[2] + Math.cos(yaw) * 0.05], 0.36, [0, yaw, 0]);
      });
    });
    // a giant egg by a front corner, where there's room
    const ry = b.ry || 0;
    for (const side of [1, -1]) {
      const a = ry + side * 0.7, dd = r + 0.36;
      const ex = b.x + Math.sin(a) * dd, ez = b.z + Math.cos(a) * dd;
      if (!ctx.free(ex, ez, 0.24)) continue;
      ctx.take(ex, ez, 0.24);
      // into the building's own space
      const lx = ex - b.x, lz = ez - b.z, c = Math.cos(-ry), sn = Math.sin(-ry);
      addEgg(kit, bi, [lx * c + lz * sn, H(ex, ez) - (b.y ?? H(b.x, b.z)) - 0.01, -lx * sn + lz * c], 0.62, [0, bi, 0]);
      break;
    }
    const o = kit.mesh();
    o.name = `Easter ${b.key || 'building'}`;
    o.position.set(b.x, b.y ?? H(b.x, b.z), b.z);
    o.rotation.y = ry;
    o.userData.onBuilding = true;
    root.add(own(o));
  });

  // ---- every gate: a pair of giant painted eggs, one either side, each with a bow
  ctx.fields.forEach((f, fi) => {
    const g = f.gate;
    if (!g) return;
    const kit = new Kit();
    const tx = -g.nz, tz = g.nx;
    for (const k of [-1, 1]) {
      const ex = g.x + tx * k * 0.58 + g.nx * 0.3, ez = g.z + tz * k * 0.58 + g.nz * 0.3;
      ctx.take(ex, ez, 0.28, { block: false });
      const lx = ex - g.x, lz = ez - g.z, y = H(ex, ez) - H(g.x, g.z) - 0.01;
      const p = k < 0 ? fi * 2 : fi * 2 + 3;
      const eh = k < 0 ? 0.7 : 0.62;
      addEgg(kit, p, [lx, y, lz], eh, [0, fi + k, 0]);
      addBow(kit, BRIGHTS[(fi * 2 + k + 3) % BRIGHTS.length], [lx + g.nx * 0.25, y + eh * 0.52, lz + g.nz * 0.25], 0.32, [0, Math.atan2(g.nx, g.nz), 0]);
    }
    const o = place(kit.mesh(), g.x, g.z, { flags: { onFence: true } });
    o.name = 'Gate eggs';
  });

  // ---- every fence: thick bunting, a string of little eggs along the top rail, pompoms at the knots,
  // big bows at the corners, giant eggs standing all along outside and an arch of eggs over the gate
  const flags = [], knots = [], line = [], beads = [];
  ctx.fields.forEach((f, fi) => {
    if (!f.ring) return;
    const pts = ctx.fenceLine(f, { outset: 0.08, step: 0.5, lift: 0.06 });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const n = Math.max(1, Math.round(len / 0.23));
      const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
      knots.push(a);
      let prev = a;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.06, a[2] + (b[2] - a[2]) * t];
        line.push(...prev, ...p);
        const mid = [(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2, (prev[2] + p[2]) / 2];
        flags.push({ p: new THREE.Vector3(...mid), yaw });
        prev = p;
      }
    }
    // little eggs end to end along the top rail
    const rail = ctx.fenceLine(f, { outset: 0.02, step: 0.3, lift: 0.03 });
    for (let i = 0; i < rail.length - 1; i++) {
      const a = rail[i], b = rail[i + 1];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const n = Math.max(1, Math.round(len / 0.15));
      const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        beads.push(compose([a[0] + (b[0] - a[0]) * t - (Math.cos(yaw) * 0.075), a[1], a[2] + (b[2] - a[2]) * t + Math.sin(yaw) * 0.075], [0, yaw, -Math.PI / 2], 0.15));
      }
    }
    // big bows at the corners, facing out
    const [cx, cz] = f.center;
    for (const [x, z] of f.ring) {
      const d = Math.hypot(x - cx, z - cz) || 1;
      bowList.push([compose([x + ((x - cx) / d) * 0.14, f.fenceY + 0.06, z + ((z - cz) / d) * 0.14], [0, Math.atan2(x - cx, z - cz), 0], 0.5), BRIGHTS[(bowList.length + fi) % BRIGHTS.length]]);
    }
    // giant eggs standing just outside the fence every metre or so (not in the gate, not on anything,
    // not in a neighbouring field, not down a slope)
    let last = -1e9, run = 0, k = fi;
    const cl = ctx.fenceLine(f, { outset: 0.26, step: 0.25 });
    for (let i = 0; i < cl.length - 1; i++) {
      const [x, , z] = cl[i], [bx, , bz] = cl[i + 1];
      run += Math.hypot(bx - x, bz - z);
      if (run - last < 0.9) continue;
      if (f.gate && Math.hypot(x - f.gate.x, z - f.gate.z) < 0.95) continue;
      if ((ctx.view.obstacles || []).some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 0.15)) continue;
      if (ctx.fields.some((o) => o !== f && o.rings.some((rg) => inRing(x, z, rg)))) continue;
      if (H(x, z) < f.topY - 0.4) continue;
      last = run;
      eggs[k++ % NP].push(compose([x, H(x, z) - 0.01, z], [R.range(-0.1, 0.1), R() * TAU, R.range(-0.1, 0.1)], R.range(0.42, 0.52)));
    }
    // an arch of eggs over the gate, a big bow at the top
    const gt = f.gate;
    if (gt) {
      const tx = -gt.nz, tz = gt.nx;
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
        const c = [gt.x + gt.nx * 0.1 + tx * ca * 0.44, f.fenceY - 0.02 + sa * 0.5, gt.z + gt.nz * 0.1 + tz * ca * 0.44];
        eggs[(i + fi) % NP].push(pointing(c, [tx * ca * 0.5, sa, tz * ca * 0.5], 0.22));
      }
      bowList.push([compose([gt.x + gt.nx * 0.2, f.fenceY + 0.56, gt.z + gt.nz * 0.2], [0, Math.atan2(gt.nx, gt.nz), 0], 0.6), C.pink]);
    }
  });
  let flagMesh = null;
  if (flags.length) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.13, 0); sh.lineTo(0.13, 0); sh.lineTo(0, -0.3); // big flags: they cover the fence face
    flagMesh = new THREE.InstancedMesh(new THREE.ShapeGeometry(sh), FLAG(), flags.length);
    flagMesh.name = 'Fence bunting';
    flags.forEach((_, i) => flagMesh.setColorAt(i, _c.set(FLAGS[i % FLAGS.length])));
    flagMesh.userData.noPop = true;
    flagMesh.userData.onFence = true;
    root.add(own(flagMesh));
    const lm = new THREE.LineBasicMaterial({ color: 0xffffff });
    const strings = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(line, 3)), lm);
    strings.name = 'Bunting strings';
    Object.assign(strings.userData, { noPop: true, onFence: true, mat: lm });
    root.add(own(strings));
    const pom = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.095, 0), TINT(), knots.length);
    pom.name = 'Bunting pompoms';
    knots.forEach((p, i) => { pom.setMatrixAt(i, _m.makeTranslation(p[0], p[1], p[2])); pom.setColorAt(i, _c.set(BRIGHTS[(i * 3) % BRIGHTS.length])); });
    pom.computeBoundingSphere();
    Object.assign(pom.userData, { noPop: true, onFence: true });
    root.add(own(pom));
  }
  if (beads.length) {
    const im = new THREE.InstancedMesh(MINI_EGG.clone(), TINT(), beads.length);
    beads.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, _c.set(BRIGHTS[i % BRIGHTS.length])); });
    im.computeBoundingSphere();
    im.name = 'Fence egg string';
    Object.assign(im.userData, { noPop: true, onFence: true });
    root.add(own(im));
  }

  // ---- every lamp post: a candy-striped ribbon wound up it, a ring of flowers, a big bow (lamp units)
  ctx.lamps.forEach((l, li) => {
    if (!l.at) return;
    const kit = new Kit();
    addSpiral(kit, li % 2 ? C.violet : C.pink, 0.07, 0.15, 1.35, 3.5, 0, 0.026);
    addSpiral(kit, C.white, 0.07, 0.15, 1.35, 3.5, Math.PI, 0.026);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      kit.add(BLOB, BRIGHTS[(i + li) % BRIGHTS.length], [Math.cos(a) * 0.12, 0.95, Math.sin(a) * 0.12], [i, i, 0], 0.1);
      kit.add(BLOB, C.leaf, [Math.cos(a + 0.35) * 0.1, 0.89, Math.sin(a + 0.35) * 0.1], [i, 0, i], 0.05);
    }
    addBow(kit, li % 2 ? C.violet : C.pink, [0, 1.3, 0.1], 0.62);
    addEgg(kit, li * 2 + 1, [0, -0.01, 0.3], 0.5, [0, li, 0]); // a giant egg at its foot
    const o = place(kit.mesh(false, true), l.at[0], l.at[1], { sc: s, flags: { onBuilding: true, onFence: true } });
    o.name = 'Lamp ribbons';
  });

  // ---- every tree hung all over with big painted eggs, and a bow on every trunk (or pine top)
  const treeStrings = [];
  ctx.trees.forEach((t, ti) => {
    const h = t.height || 1.2, y0 = t.y ?? H(t.x, t.z), sc = t.scale || 0.75;
    const pine = t.key === 'pine', tall = !pine && h / sc > 2; // (a tall tulip-shaped crown)
    const eh = clamp(h * 0.15, 0.22, 0.3);
    // rings of eggs: [height, radius (both as parts of the tree's height), how many, hanging on a string?]
    const rings = pine
      ? [[0.23, 0.2, 8, false], [0.3, 0.23, 6, true], [0.4, 0.16, 6, false], [0.48, 0.17, 5, true], [0.58, 0.12, 5, false], [0.75, 0.075, 3, false]]
      : tall
        ? [[0.34, 0.12, 6, true], [0.46, 0.2, 8, false], [0.6, 0.22, 8, false], [0.75, 0.19, 6, false], [0.88, 0.12, 3, false]]
        : [[0.3, 0.3, 7, true], [0.45, 0.39, 9, false], [0.62, 0.37, 8, false], [0.78, 0.28, 6, false], [0.92, 0.14, 3, false]];
    rings.forEach(([f, rf, n, hang], j) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + j * 0.7 + ti;
        const ca = Math.cos(a), sa = Math.sin(a);
        const x = t.x + ca * rf * h, z = t.z + sa * rf * h, y = y0 + f * h;
        const p = (i + j * 2 + ti) % NP;
        if (hang && y - 0.08 - eh < H(x, z) + 0.05) {
          // (no room to hang under a low crown: it sits in the grass beneath, waiting to be found)
          eggs[p].push(compose([x, H(x, z) - 0.01, z], [R.range(-0.2, 0.2), a, R.range(-0.2, 0.2)], eh));
        } else if (hang) {
          treeStrings.push(x, y + 0.02, z, x, y - 0.06, z);
          eggs[p].push(compose([x, y - 0.06 - eh, z], [0, a, 0], eh));
        } else {
          // sitting on the crown, leaning out
          eggs[p].push(compose([x + ca * eh * 0.2, y - eh * 0.5, z + sa * eh * 0.2], [sa * 0.45, 0, -ca * 0.45], eh));
        }
      }
    });
    if (pine) bowList.push([compose([t.x, y0 + h + 0.04, t.z], [0, 0, 0], 0.5), BRIGHTS[ti % BRIGHTS.length]]);
    else bowList.push([compose([t.x, y0 + h * (tall ? 0.24 : 0.2), t.z + 0.1], [0, 0, 0], 0.4), BRIGHTS[(ti + 3) % BRIGHTS.length]]);
  });
  if (treeStrings.length) {
    const lm = new THREE.LineBasicMaterial({ color: 0xfff4ea });
    const strings = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(treeStrings, 3)), lm);
    strings.name = 'Tree egg strings';
    Object.assign(strings.userData, { noPop: true, onBuilding: true, mat: lm });
    root.add(own(strings));
  }

  // ---- along the paths: Easter baskets and little egg trees in pots, and painted eggs lining them
  ctx.pathSpots(12, { r: 0.28, spacing: 1.3 }).forEach(([x, z], i) => {
    place(i % 2 ? eggTree(i) : basket(i), x, z, { ry: R.range(-0.6, 0.6) });
  });
  ctx.pathSpots(36, { r: 0.15, spacing: 0.5, block: false }).forEach(([x, z], i) => {
    eggs[i % NP].push(compose([x, H(x, z) - 0.01, z], [R.range(-0.12, 0.12), R() * TAU, R.range(-0.12, 0.12)], R.range(0.3, 0.36)));
  });

  // ---- bunnies all over the island (white and brown), half of them hopping round in arcs
  const FURS = [C.white, C.brown];
  const bunnyList = [[], []]; // [x, y, z, ry, scale] per fur
  const hoppers = [];
  scatter(26, { r: 0.42, gap: 1.2, from: 1.8, block: true, seed: 7 }).forEach(([x, z], i) => {
    const fur = i % 2, sc = R.range(1.35, 1.6), y = H(x, z);
    const idx = bunnyList[fur].length;
    bunnyList[fur].push([x, y, z, R.range(-0.9, 0.9), sc]);
    if (i % 4 < 2) {
      const rad = 0.24;
      const hs = new Float32Array(17);
      for (let k = 0; k <= 16; k++) { const a = (k / 16) * TAU; hs[k] = H(x + Math.cos(a) * rad, z + Math.sin(a) * rad) - y; }
      hoppers.push({ fur, idx, x, y, z, sc, rad, hs, ph: i * 1.7, dir: i % 3 ? 1 : -1, sp: 0.8 + (i % 4) * 0.12 });
    }
  });
  const bunnyMeshes = FURS.map((fur, k) => {
    const list = bunnyList[k];
    if (!list.length) return null;
    const kit = new Kit();
    addBunny(kit, fur, [0, 0, 0], 1);
    const im = new THREE.InstancedMesh(kit.geometry(), VC(), list.length);
    im.castShadow = true;
    list.forEach(([x, y, z, ry, sc], i) => im.setMatrixAt(i, compose([x, y, z], [0, ry, 0], sc)));
    im.computeBoundingSphere();
    im.name = 'Bunnies';
    im.userData.noPop = true;
    root.add(own(im));
    return im;
  });

  // ---- drifts of tulips and daffodils all over the grass (instanced: stems, tulip cups, daffodil heads)
  const stemKit = new Kit();
  stemKit.add(new THREE.CylinderGeometry(0.01, 0.013, 0.28, 4), C.green, [0, 0.14, 0]);
  for (const k of [-1, 1]) stemKit.add(new THREE.ConeGeometry(0.03, 0.2, 3), k > 0 ? C.leaf : C.green, [k * 0.024, 0.09, 0], [0, 0, -k * 0.3], [1, 1, 0.35]);
  const tulipKit = new Kit();
  tulipKit.add(new THREE.CylinderGeometry(0.07, 0.04, 0.12, 6), 0xffffff, [0, 0.32, 0]);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; tulipKit.add(new THREE.ConeGeometry(0.04, 0.08, 4), 0xffffff, [Math.cos(a) * 0.038, 0.41, Math.sin(a) * 0.038]); }
  const daffKit = new Kit();
  daffKit.group([0, 0.3, 0], [0.45, 0, 0], 1, () => { // nodding a little
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; daffKit.add(DOT, i % 2 ? 0xffe066 : C.yellow, [Math.cos(a) * 0.055, 0, Math.sin(a) * 0.055], [0, -a, 0], [0.06, 0.016, 0.036]); }
    daffKit.add(new THREE.CylinderGeometry(0.036, 0.024, 0.065, 6), C.orange, [0, 0.03, 0]);
  });
  const stems = [], tulips = [], tulipCols = [], daffs = [];
  const TULIPS = [[C.pink, C.white], [C.red, C.yellow], [C.violet, C.lilac], [C.orange, C.yellow], [C.pink, C.red], [C.yellow, C.white], [C.violet, C.pink], [C.blush, C.pink]];
  scatter(46, { r: 0.5, gap: 0.95, from: 1.6, seed: 19 }).forEach(([cx, cz], di) => {
    const daff = di % 3 === 2;
    const cols = TULIPS[di % TULIPS.length];
    const n = 16 + (di % 7);
    for (let i = 0; i < n; i++) {
      const a = i * 2.399 + di, d = Math.sqrt((i + 0.5) / n) * 0.45;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const m = compose([x, H(x, z), z], [R.range(-0.15, 0.15), R() * TAU, R.range(-0.15, 0.15)], R.range(1.25, 1.65)); // big blooms: patches of colour from afar
      stems.push(m);
      if (daff) daffs.push(m);
      else { tulips.push(m); tulipCols.push(cols[i % 2]); }
    }
  });
  for (const [kit, list, cols, name] of [[stemKit, stems, null, 'Flower stems'], [tulipKit, tulips, tulipCols, 'Tulips'], [daffKit, daffs, null, 'Daffodils']]) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(kit.geometry(), VC(), list.length);
    list.forEach((m, i) => { im.setMatrixAt(i, m); if (cols) im.setColorAt(i, _c.set(cols[i])); });
    im.computeBoundingSphere();
    im.name = name;
    im.userData.noPop = true;
    root.add(own(im));
  }

  // ---- painted eggs all over the grass, and little piles of them here and there
  scatter(8, { r: 0.3, gap: 1.4, from: 1.6, seed: 53 }).forEach(([x, z], i) => {
    eggs[i % NP].push(compose([x, H(x, z) - 0.01, z], [0, R() * TAU, 0], 0.38));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + i, ex = x + Math.cos(a) * 0.17, ez = z + Math.sin(a) * 0.17;
      eggs[(i + k + 1) % NP].push(compose([ex, H(ex, ez) - 0.02, ez], [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4], R.range(0.26, 0.31)));
    }
  });
  scatter(110, { r: 0.15, gap: 0.5, from: 1.4, seed: 31 }).forEach(([x, z], i) => {
    eggs[i % NP].push(compose([x, H(x, z) - 0.01, z], [R.range(-0.22, 0.22), R() * TAU, R.range(-0.22, 0.22)], R.range(0.26, 0.35)));
  });

  // ---- the instanced eggs (one mesh per pattern) and bows
  eggs.forEach((list, p) => {
    if (!list.length) return;
    const kit = new Kit();
    addEgg(kit, p, [0, 0, 0], 1, [0, 0, 0], EGG_S);
    const im = new THREE.InstancedMesh(kit.geometry(), GLOSS(), list.length);
    im.castShadow = true;
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    im.name = 'Painted eggs';
    im.userData.noPop = true;
    root.add(own(im));
  });
  if (bowList.length) {
    const kit = new Kit();
    addBow(kit, 0xffffff, [0, 0, 0], 1);
    const im = new THREE.InstancedMesh(kit.geometry(), VC(), bowList.length);
    bowList.forEach(([m, col], i) => { im.setMatrixAt(i, m); im.setColorAt(i, _c.set(col)); });
    im.computeBoundingSphere();
    im.name = 'Bows';
    Object.assign(im.userData, { noPop: true, onBuilding: true });
    root.add(own(im));
  }

  const blocked = ctx.view.obstacles ? ctx.view.obstacles.filter((o) => !obstaclesBefore.includes(o)) : [];

  // ---- motion: the bunting stirs, the maypoles turn, the hoppers hop round in arcs
  const fm = new THREE.Matrix4(), fq = new THREE.Quaternion(), fe = new THREE.Euler(0, 0, 0, 'YXZ'), fv = new THREE.Vector3(), fs = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function update(dt, time, { k = 1 } = {}) {
    if (k <= 0) return;
    if (flagMesh) {
      for (let i = 0; i < flags.length; i++) {
        fe.set(Math.sin(time * 2.2 + i * 0.9) * 0.28, flags[i].yaw, 0);
        flagMesh.setMatrixAt(i, fm.compose(flags[i].p, fq.setFromEuler(fe), one));
      }
      flagMesh.instanceMatrix.needsUpdate = true;
    }
    for (const m of maypoles) m.o.rotation.y = time * 0.5 * m.dir;
    for (const h of hoppers) {
      const t = time * h.sp + h.ph, n = Math.floor(t), f = Math.min(1, (t - n) / 0.55);
      const a = (n + f * f * (3 - 2 * f)) * 0.55 * h.dir;
      const ca = Math.cos(a), sa = Math.sin(a);
      const u = ((((a / TAU) % 1) + 1) % 1) * 16, k0 = Math.min(15, Math.floor(u));
      const ground = h.hs[k0] + (h.hs[k0 + 1] - h.hs[k0]) * (u - k0);
      const lift = Math.sin(f * Math.PI);
      fv.set(h.x + ca * h.rad, h.y + ground + lift * 0.18, h.z + sa * h.rad);
      fe.set(-lift * 0.25, Math.atan2(-sa * h.dir, ca * h.dir), 0);
      fs.set(h.sc, h.sc * (1 + lift * 0.1), h.sc);
      bunnyMeshes[h.fur].setMatrixAt(h.idx, fm.compose(fv, fq.setFromEuler(fe), fs));
    }
    if (hoppers.length) for (const im of bunnyMeshes) if (im) im.instanceMatrix.needsUpdate = true;
  }
  update(0, 0);

  // ---- costumes: tall bunny ears on a headband, a flower crown, or a straw Easter bonnet (by turns)
  const earGeo = (() => {
    const kit = new Kit();
    kit.add(SPHERE, C.white, [0, 0.13, 0], [0, 0, 0], [0.046, 0.15, 0.024]);
    kit.add(SPHERE, C.pink, [0, 0.13, 0.016], [0, 0, 0], [0.029, 0.115, 0.012]); // pink inside
    return kit.geometry();
  })();
  geos.push(earGeo);
  const bandGeos = [C.pink, C.violet, C.sky].map((col) => {
    const kit = new Kit();
    kit.add(new THREE.TorusGeometry(0.105, 0.019, 4, 12, Math.PI), col, [0, -0.095, 0]);
    addBow(kit, col, [0.075, -0.005, 0.03], 0.11, [0, 0.3, -0.6]);
    return kit.geometry();
  });
  geos.push(...bandGeos);
  const crownGeos = [0, 1].map((v) => {
    const kit = new Kit();
    kit.add(new THREE.TorusGeometry(0.118, 0.016, 4, 16), C.green, [0, 0, 0], [Math.PI / 2 + 0.15, 0, 0]);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + Math.PI / 2; // i = 0 at the front (+z)
      const big = i === 0;
      const x = Math.cos(a) * 0.118, z = Math.sin(a) * 0.118, y = -z * 0.15;
      kit.add(BLOB, BRIGHTS[(i + v * 2) % BRIGHTS.length], [x, y + 0.014, z], [i, i, 0], big ? 0.058 : 0.044);
      kit.add(BLOB, BRIGHTS[(i + v * 2) % BRIGHTS.length] === C.yellow ? C.orange : C.yellow, [x * 1.1, y + 0.038, z * 1.1], [0, 0, 0], big ? 0.022 : 0.017);
      kit.add(BLOB, C.leaf, [Math.cos(a + 0.35) * 0.125, y, Math.sin(a + 0.35) * 0.125], [i, 0, i], 0.024);
    }
    return kit.geometry();
  });
  geos.push(...crownGeos);
  const bonnetGeos = [C.pink, C.sky, C.violet].map((col, v) => {
    const kit = new Kit();
    const weave = (x, y, z) => (Math.floor((Math.atan2(z, x) + 4) * 4 + y * 60) % 2 ? C.straw : C.strawDark);
    kit.add(new THREE.CylinderGeometry(0.17, 0.17, 0.018, 14), weave, [0, -0.004, 0.01]); // the brim
    kit.add(new THREE.CylinderGeometry(0.085, 0.095, 0.085, 12), weave, [0, 0.045, 0]); // the crown
    kit.add(new THREE.CylinderGeometry(0.093, 0.098, 0.03, 12), col, [0, 0.018, 0]); // the ribbon round it
    addBow(kit, col, [0.06, 0.03, 0.08], 0.11, [0, 0.6, 0]);
    for (const k of [-1, 1]) kit.add(BOX, col, [k * 0.03, -0.055, -0.16], [0.3, 0, k * 0.18], [0.028, 0.1, 0.006]); // tails at the back
    for (let i = 0; i < 4; i++) {
      const a = -1.1 - i * 0.42;
      kit.add(BLOB, BRIGHTS[(i + v + 1) % BRIGHTS.length], [Math.sin(a) * 0.125, 0.02, Math.cos(a) * 0.125], [i, i, 0], 0.038);
      kit.add(BLOB, C.white, [Math.sin(a) * 0.13, 0.044, Math.cos(a) * 0.13], [0, 0, 0], 0.014);
    }
    return kit.geometry();
  });
  geos.push(...bonnetGeos);
  function sheepWear(i) {
    const g = new THREE.Group();
    g.name = 'Easter costume';
    const v = i % 3, n = Math.floor(i / 3);
    if (v === 0) {
      g.add(mesh(bandGeos[n % 3], VC(), false, false));
      const ears = [-1, 1].map((sd) => {
        const e = mesh(earGeo, VC(), false, false);
        e.position.set(sd * 0.055, 0, 0);
        g.add(e);
        return e;
      });
      const floppy = n % 2 === 1; // now and then one ear flops over
      const ph = i * 1.3;
      g.userData.update = (time) => {
        const w = Math.sin(time * 2.4 + ph) * 0.07;
        ears[0].rotation.set(-0.12 + w, 0, floppy ? 1.0 : 0.22);
        ears[1].rotation.set(-0.12 - w, 0, -0.22);
      };
      g.userData.update(0);
    } else if (v === 1) {
      const c = mesh(crownGeos[n % 2], VC(), false, false);
      c.position.y = -0.02;
      g.add(c);
    } else {
      const c = mesh(bonnetGeos[n % 3], VC(), false, false);
      c.rotation.x = -0.12; // worn tipped back
      g.add(c);
    }
    return g;
  }

  return {
    root,
    barnBits,
    update,
    sheepWear,
    lampColors: [0xff6fb5, 0xa77bff, 0x5fd0ff, 0xffd23a],
    dispose() {
      // let this theme's spots go (anything already released is left alone)
      for (const o of blocked) { const i = ctx.view.obstacles?.indexOf(o); if (i >= 0) ctx.view.obstacles.splice(i, 1); }
      blocked.length = 0;
      root.traverse((o) => o.userData.mat?.dispose());
      for (const g of new Set(geos)) g.dispose();
    },
  };
}
