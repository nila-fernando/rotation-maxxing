// The Fourth of July: the whole farm in red, white and navy blue. Every building flies the Stars
// and Stripes from its roof and wears pleated flag fans on its front (the barn gets a big barn star
// on its roof too), every fence has fans on its rail with bunting swagged between them, bunting
// spirals round every tree, balloons bob at every gate, star-spangled pinwheels spin along the
// fences, the lamps carry crossed flags, big white stars on posts and little flags line the paths,
// and the open grass has flag-draped hay bales and flag picnic blankets. Out front: a tall flagpole
// with a maypole of bunting, a bandstand, and a picnic (checked tablecloths, watermelon, a grill
// with smoke). The sheep wear Uncle Sam hats, star boppers or the Statue of Liberty's crown.
// See ./index.js for the module contract.
import * as THREE from 'three';
import { mat } from '../props.js';
import { towerRadiusAt as lhR, LIGHTHOUSE } from '../lighthouse.js';

const RED = 0xd42a3a, WHITE = 0xf7f4ec, BLUE = 0x2b50ad, NAVY = 0x1d3473, GOLD = 0xf0b93a;
const WOOD = 0x9a6b45, DARK = 0x2b2725, GREEN = 0x3f8a3a, POLE = 0xe9e6e0;
const LIBERTY = 0x5fb398, LIBERTY_DARK = 0x3f8f76;
const RWB = [RED, WHITE, BLUE];

// ---------------------------------------------------------------- building blocks

// A transform: tilt (x, z) first, then turn (y), then move.
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));

const _c = new THREE.Color(), _v = new THREE.Vector3();
/**
 * Collects coloured triangles from many shapes into one geometry (one draw call): colour a hex, a
 * function (x, y, z of a triangle's middle, in the shape's own space) -> hex, or null to keep the
 * shape's own vertex colours.
 */
class Kit {
  constructor() { this.p = []; this.c = []; }
  add(geo, color, x, y, z, rx, ry, rz, sx, sy, sz) { return this.addM(geo, color, M(x, y, z, rx, ry, rz, sx, sy, sz)); }
  addM(geo, color, m) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position, c = g.attributes.color;
    for (let i = 0; i < p.count; i += 3) {
      let hex = color;
      if (typeof color === 'function') hex = color((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3);
      if (hex != null) _c.set(hex);
      for (let j = i; j < i + 3; j++) {
        _v.fromBufferAttribute(p, j).applyMatrix4(m);
        this.p.push(_v.x, _v.y, _v.z);
        if (hex == null && c) this.c.push(c.getX(j), c.getY(j), c.getZ(j));
        else this.c.push(_c.r, _c.g, _c.b);
      }
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }
  tri(a, b, c, hex) {
    _c.set(hex);
    for (const q of [a, b, c]) { this.p.push(q[0], q[1], q[2]); this.c.push(_c.r, _c.g, _c.b); }
    return this;
  }
  quad(a, b, c, d, hex) { return this.tri(a, b, c, hex).tri(a, c, d, hex); }
  /** A thin square rod from a to b. */
  rod(a, b, w, hex) {
    const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A);
    const L = d.length() || 1e-4;
    const geo = new THREE.BoxGeometry(w, L, w);
    geo.translate(0, L / 2, 0);
    return this.addM(geo, hex, new THREE.Matrix4().compose(A, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1)));
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** A five-pointed star facing +z, R to the tips, depth thick. */
function starGeo(R, depth, inner = 0.45) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? R * inner : R;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A disc facing +z. */
const discGeo = (r, t, seg = 14) => new THREE.CylinderGeometry(r, r, t, seg).rotateX(Math.PI / 2);

/**
 * The Stars and Stripes as triangles in the z = 0 plane: lower left corner at (x0, y0), w by h.
 * Seven stripes, a navy canton over the top four, white stars on both sides of it (dz out).
 */
function flagCloth(kit, x0, y0, w, h, dz = w * 0.008) {
  const cols = 12, rows = 7, cw = w / cols, rh = h / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const col = c < 5 && r < 4 ? BLUE : r % 2 ? WHITE : RED;
    const xa = x0 + c * cw, xb = xa + cw, yt = y0 + h - r * rh, yb = yt - rh;
    kit.quad([xa, yb, 0], [xb, yb, 0], [xb, yt, 0], [xa, yt, 0], col);
  }
  const sw = 5 * cw, sh = 4 * rh, s = sw / 13;
  for (let i = 0; i < 3; i++) for (let j = 0; j < (i % 2 ? 3 : 4); j++) {
    const x = x0 + (sw * (i % 2 ? j + 1 : j + 0.5)) / 4, y = y0 + h - (sh * (i + 0.5)) / 3;
    for (const z of [dz, -dz]) kit.quad([x, y - s, z], [x + s, y, z], [x, y + s, z], [x - s, y, z], WHITE);
  }
}

/** Makes a flag's cloth wave: every vertex right of x0 moves in z, more towards the fly end. */
function waver(geo, x0, w, amp) {
  const pos = geo.attributes.position, base = pos.array.slice(), freq = (Math.PI * 2) / (w * 0.85);
  return (time) => {
    const a = pos.array;
    for (let i = 0; i < a.length; i += 3) {
      const x = base[i] - x0;
      if (x <= 0) continue;
      a[i + 2] = base[i + 2] + Math.sin(x * freq - time * 4.2 + base[i + 1] * 2) * amp * Math.min(1, x / (w * 0.35));
    }
    pos.needsUpdate = true;
  };
}

/** A little flag on a stick (stick from the origin up L; the flag flies along +x). */
function miniFlagGeo(L = 0.36, w = 0.2, h = 0.12) {
  const k = new Kit();
  k.rod([0, 0, 0], [0, L, 0], 0.014, WOOD);
  k.add(new THREE.SphereGeometry(0.013, 6, 4), GOLD, 0, L + 0.008, 0);
  flagCloth(k, 0.007, L - h, w, h, 0.003);
  return k.geometry();
}

const fanCache = new Map();
/**
 * A pleated flag fan (a half rosette, hanging down from its straight top edge, facing +z), R across
 * the radius: blue in the middle with white stars, then white, red, white, red rings, a gold knot.
 */
function fanGeo(R) {
  if (fanCache.has(R)) return fanCache.get(R).clone();
  const k = new Kit();
  const bands = [[0, 0.34, BLUE], [0.34, 0.52, WHITE], [0.52, 0.7, RED], [0.7, 0.85, WHITE], [0.85, 1, RED]];
  const N = 14, depth = R * 0.12;
  for (let j = 0; j < N; j++) {
    const a0 = Math.PI + (j / N) * Math.PI, a1 = Math.PI + ((j + 1) / N) * Math.PI;
    const z0 = j % 2 ? depth : 0, z1 = j % 2 ? 0 : depth;
    const P = (r, a, z) => [Math.cos(a) * r * R, Math.sin(a) * r * R, z * r];
    for (const [r0, r1, col] of bands) k.quad(P(r0, a0, z0), P(r1, a0, z0), P(r1, a1, z1), P(r0, a1, z1), col);
  }
  const s = R * 0.05, z = depth * 0.4 + R * 0.02;
  for (const a of [1.2, 1.5, 1.8]) {
    const x = Math.cos(a * Math.PI) * R * 0.22, y = Math.sin(a * Math.PI) * R * 0.22;
    k.quad([x, y - s, z], [x + s, y, z], [x, y + s, z], [x - s, y, z], WHITE);
  }
  k.add(new THREE.SphereGeometry(R * 0.12, 8, 6), GOLD, 0, 0, depth * 0.3);
  k.add(new THREE.BoxGeometry(R * 2.04, R * 0.08, R * 0.06), NAVY, 0, -R * 0.02, 0);
  const g = k.geometry();
  fanCache.set(R, g);
  return g.clone();
}

/** Bunting flags hanging from a straight line a -> b (static, into a kit), the flags facing across it. */
function staticBunting(kit, a, b, { spacing = 0.13, size = 0.1, sag = 0.04, off = 0 } = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(1, Math.round(len / spacing));
  const hx = b[0] - a[0], hz = b[2] - a[2], hl = Math.hypot(hx, hz) || 1;
  const ux = (hx / hl) * size * 0.5, uz = (hz / hl) * size * 0.5;
  let prev = null;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
    if (prev) kit.rod(prev, p, 0.008, DARK);
    prev = p;
    if (k > 0 && k < n) kit.tri([p[0] - ux, p[1], p[2] - uz], [p[0] + ux, p[1], p[2] + uz], [p[0], p[1] - size * 1.25, p[2]], RWB[(k + off) % 3]);
  }
}

/** A watermelon slice standing on its rind (flat edge down at the origin), facing +z. */
function slice(kit, x, y, z, ry, R = 0.1) {
  kit.add(new THREE.CylinderGeometry(R, R, 0.03, 10, 1, false, Math.PI / 2, Math.PI), GREEN, x, y, z, Math.PI / 2, ry);
  kit.add(new THREE.CylinderGeometry(R * 0.84, R * 0.84, 0.038, 10, 1, false, Math.PI / 2, Math.PI), 0xf04a55, x, y + 0.004, z, Math.PI / 2, ry);
  for (const [sx, sy] of [[-0.035, 0.045], [0.03, 0.05], [0, 0.03]]) {
    const ox = Math.cos(ry) * sx, oz = -Math.sin(ry) * sx;
    for (const f of [1, -1]) kit.add(new THREE.BoxGeometry(0.012, 0.016, 0.004), DARK, x + ox + Math.sin(ry) * 0.02 * f, y + sy * R * 10, z + oz + Math.cos(ry) * 0.02 * f, 0, ry);
  }
}

// Where each kind of building takes its things, in its own units (front +z, see ../props.js and
// ../buildings.js): flag = the foot of the roof flag's pole; fans = [x, y of the top edge, z, turn,
// radius]; swags = bunting [from, to, sag]; ring = bunting round a tower [radius, y].
const Q8 = Math.PI / 8;
const towerFan = (a, rad, y, R) => [Math.sin(a) * rad, y, Math.cos(a) * rad, a, R];
const DRESS = {
  // (with no barnBits: fans above its windows)
  barn: { flag: [0, 2.25, 0], fans: [[-0.74, 1.3, 0.875, 0, 0.21], [0.74, 1.3, 0.875, 0, 0.21]] },
  // two fans either side of the ladder, bunting round the top under the dome
  silo: { flag: [0, 2.5, 0], fans: [towerFan(0.62, 0.56, 1.5, 0.24), towerFan(-0.62, 0.56, 1.5, 0.24)], ring: [0.6, 1.86] },
  // four fans round the front of the tower above the door, bunting under the cap
  windmill: { flag: [0, 2.62, 0], fans: [towerFan(-3 * Q8, 0.47, 0.96, 0.2), towerFan(-Q8, 0.47, 0.96, 0.2), towerFan(Q8, 0.47, 0.96, 0.2), towerFan(3 * Q8, 0.47, 0.96, 0.2)], ring: [0.45, 1.9] },
  // the flag up off the cap's brass ball, four fans round the top of the tower under the gallery,
  // bunting round the rail
  lighthouse: { flag: [0, LIGHTHOUSE.top - 0.02, 0], fans: [towerFan(-3 * Q8, lhR(2.35), 2.42, 0.17), towerFan(-Q8, lhR(2.35), 2.42, 0.17), towerFan(Q8, lhR(2.35), 2.42, 0.17), towerFan(3 * Q8, lhR(2.35), 2.42, 0.17)], ring: [LIGHTHOUSE.railR + 0.03, LIGHTHOUSE.railY - 0.02] },
  // fans hung from the porch roof's front edge and on both gable ends
  farmhouse: { flag: [0, 1.42, -0.06], fans: [[0, 0.72, 0.83, 0, 0.24], [-0.42, 0.72, 0.83, 0, 0.16], [0.42, 0.72, 0.83, 0, 0.16], [0.69, 1.12, -0.06, Math.PI / 2, 0.2], [-0.69, 1.12, -0.06, -Math.PI / 2, 0.2]] },
  // fans on the header over the open front, bunting swagged between the posts below them
  machineShed: { flag: [0, 1.1, -0.1], fans: [[-0.6, 1.04, 0.63, 0, 0.2], [0, 1.04, 0.63, 0, 0.2], [0.6, 1.04, 0.63, 0, 0.2]], swags: [[[-0.78, 0.8, 0.66], [0, 0.8, 0.66], 0.08], [[0, 0.8, 0.66], [0.78, 0.8, 0.66], 0.08]] },
  // the flag on the big bin's cap, fans on the two bins clear of the ladder and the auger
  grainBins: { flag: [0.2, 1.36, -0.12], fans: [[-0.5, 0.81, 0.405, 0, 0.2], [0.72, 0.65, 0.525, 0, 0.15]] },
  chickenCoop: { flag: [-0.2, 0.83, -0.25], fans: [[-0.2, 0.6, 0.005, 0, 0.15]] },
  greenhouse: { flag: [0, 0.68, 0], fans: [[-0.45, 0.4, 0.49, 0, 0.14], [0, 0.4, 0.49, 0, 0.14], [0.45, 0.4, 0.49, 0, 0.14]] },
  well: { flag: [0, 0.8, 0], fans: [[0, 0.24, 0.25, 0, 0.12]] },
};

// ---------------------------------------------------------------- the theme

export default function build(ctx) {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, side: THREE.DoubleSide });
  paint.userData.noSeason = true;
  const starMat = new THREE.MeshStandardMaterial({ color: WHITE, emissive: 0xfff3d6, emissiveIntensity: 0.1, roughness: 0.5, flatShading: true });
  starMat.userData.noSeason = true;
  const plainMats = [paint, starMat];
  const heightAt = ctx.heightAt;
  const R = ctx.radius || 7;
  const s = ctx.scale || 0.75;
  const meshOf = (kit, cast = false) => { const m = new THREE.Mesh(kit.geometry(), paint); m.castShadow = cast; m.receiveShadow = cast; return m; };
  /** Puts one placed thing on the island. */
  const place = (o, x, y, z, ry = 0, flags = {}) => {
    o.position.set(x, y, z);
    o.rotation.y = ry;
    Object.assign(o.userData, flags);
    root.add(o);
    return o;
  };
  const wrap = (name, ...kids) => { const g = new THREE.Group(); g.name = name; g.add(...kids); return g; };
  const strings = []; // bunting lines for the island-wide bunting: { pts, sag }
  const rand = (i, k = 1) => { const h = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return h - Math.floor(h); };

  // ---- the centrepiece: a tall flagpole on a red, white and blue plinth with a maypole of bunting
  const centre = ctx.spots(1, { r: 0.7, from: 2, to: 5 })[0];
  let bigWave = null;
  if (centre) {
    const k = new Kit();
    k.add(new THREE.CylinderGeometry(0.42, 0.46, 0.12, 8), NAVY, 0, 0.06, 0, 0, Math.PI / 8);
    k.add(new THREE.CylinderGeometry(0.32, 0.35, 0.12, 8), WHITE, 0, 0.18, 0, 0, Math.PI / 8);
    k.add(new THREE.CylinderGeometry(0.22, 0.25, 0.1, 8), RED, 0, 0.29, 0, 0, Math.PI / 8);
    for (const a of [-0.75, 0, 0.75]) k.add(starGeo(0.055, 0.02), GOLD, Math.sin(a) * 0.43, 0.065, Math.cos(a) * 0.43, -0.05, a);
    for (const a of [-0.5, 0.5]) k.add(starGeo(0.04, 0.02), RED, Math.sin(a) * 0.335, 0.18, Math.cos(a) * 0.335, -0.1, a);
    k.add(new THREE.CylinderGeometry(0.028, 0.045, 2.12, 8), POLE, 0, 0.34 + 1.06, 0);
    k.add(new THREE.SphereGeometry(0.065, 10, 8), GOLD, 0, 2.5, 0);
    k.add(starGeo(0.08, 0.025), GOLD, 0, 2.62, 0);
    const top = [0, 1.74, 0];
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) * (Math.PI / 4), sx = Math.sin(a) * 0.64, sz = Math.cos(a) * 0.64;
      k.rod([sx, 0, sz], [sx, 0.24, sz], 0.035, WHITE);
      k.add(new THREE.SphereGeometry(0.03, 6, 4), GOLD, sx, 0.26, sz);
      staticBunting(k, top, [sx, 0.24, sz], { spacing: 0.13, size: 0.11, sag: 0.06, off: i });
    }
    const flag = new Kit();
    flagCloth(flag, 0.05, 2.42 - 0.66, 1.15, 0.66, 0.007);
    const flagMesh = new THREE.Mesh(flag.geometry(), paint);
    flagMesh.castShadow = true;
    bigWave = waver(flagMesh.geometry, 0.05, 1.15, 0.08);
    place(wrap('Flagpole (centrepiece)', meshOf(k, true), flagMesh), centre[0], heightAt(centre[0], centre[1]), centre[1]);
  }

  // ---- a bandstand with a striped roof, bunting round its eaves and a drum on the stage
  const stand = ctx.spots(1, { r: 0.72, from: 1.8, to: 5.5, front: 0.8, spacing: 1 })[0];
  if (stand) {
    const k = new Kit();
    k.add(new THREE.CylinderGeometry(0.6, 0.63, 0.1, 8), NAVY, 0, 0.05, 0, 0, Math.PI / 8);
    k.add(new THREE.CylinderGeometry(0.57, 0.57, 0.05, 8), WHITE, 0, 0.125, 0, 0, Math.PI / 8);
    for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) k.add(starGeo(0.035, 0.015), WHITE, Math.sin(a) * 0.615, 0.05, Math.cos(a) * 0.615, 0, a);
    k.add(new THREE.BoxGeometry(0.34, 0.06, 0.14), RED, 0, 0.03, 0.66);
    const posts = [];
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) * (Math.PI / 4); posts.push([Math.sin(a) * 0.5, Math.cos(a) * 0.5]); }
    for (const [x, z] of posts) k.add(new THREE.BoxGeometry(0.05, 0.66, 0.05), WHITE, x, 0.15 + 0.33, z);
    for (let i = 0; i < 8; i++) {
      if (i === 7) continue; // the way in, at the front
      const [ax, az] = posts[i], [bx, bz] = posts[(i + 1) % 8];
      k.rod([ax, 0.38, az], [bx, 0.38, bz], 0.03, i % 2 ? RED : BLUE);
    }
    // the roof: an eight-sided cone in red and white panels, navy underneath
    const apex = [0, 1.2, 0], rim = [];
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) * (Math.PI / 4); rim.push([Math.sin(a) * 0.72, 0.8, Math.cos(a) * 0.72]); }
    for (let i = 0; i < 8; i++) {
      const a = rim[i], b = rim[(i + 1) % 8];
      k.tri(apex, a, b, i % 2 ? WHITE : RED);
      k.tri([0, 0.8, 0], a, b, NAVY);
      staticBunting(k, [a[0] * 1.01, 0.79, a[2] * 1.01], [b[0] * 1.01, 0.79, b[2] * 1.01], { spacing: 0.11, size: 0.09, sag: 0.03, off: i });
    }
    k.add(new THREE.SphereGeometry(0.05, 8, 6), GOLD, 0, 1.22, 0);
    k.add(starGeo(0.12, 0.035), GOLD, 0, 1.38, 0);
    // a drum on the stage
    k.add(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 12), RED, 0.12, 0.22, -0.12);
    k.add(new THREE.CylinderGeometry(0.122, 0.122, 0.02, 12), WHITE, 0.12, 0.3, -0.12);
    k.add(new THREE.CylinderGeometry(0.124, 0.124, 0.025, 12), NAVY, 0.12, 0.16, -0.12);
    place(wrap('Bandstand', meshOf(k, true)), stand[0], heightAt(stand[0], stand[1]), stand[1], (rand(3) - 0.5) * 0.4);
  }

  // ---- the picnic: tables with red and white checked cloths and watermelon, a grill with smoke
  const tables = ctx.spots(2, { r: 0.48, from: 1.3, to: 4.5, front: 1.5, spacing: 1.1 });
  tables.forEach(([x, z], ti) => {
    const k = new Kit();
    const T = 0.3, W = 0.8, D = 0.46, nx = 8, nz = 5;
    for (const sx of [-0.3, 0.3]) for (const sz of [-1, 1]) k.rod([sx, 0, sz * 0.17], [sx, T - 0.02, sz * 0.1], 0.035, WOOD);
    k.add(new THREE.BoxGeometry(W - 0.03, 0.035, D - 0.03), WOOD, 0, T - 0.018, 0);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const xa = -W / 2 + (i * W) / nx, xb = xa + W / nx, za = -D / 2 + (j * D) / nz, zb = za + D / nz;
      k.quad([xa, T, za], [xb, T, za], [xb, T, zb], [xa, T, zb], (i + j) % 2 ? WHITE : RED);
    }
    for (let i = 0; i < nx; i++) {
      const xa = -W / 2 + (i * W) / nx, xb = xa + W / nx;
      for (const zz of [-D / 2, D / 2]) k.quad([xa, T, zz], [xb, T, zz], [xb, T - 0.08, zz], [xa, T - 0.08, zz], i % 2 ? WHITE : RED);
    }
    for (let j = 0; j < nz; j++) {
      const za = -D / 2 + (j * D) / nz, zb = za + D / nz;
      for (const xx of [-W / 2, W / 2]) k.quad([xx, T, za], [xx, T, zb], [xx, T - 0.08, zb], [xx, T - 0.08, za], j % 2 ? WHITE : RED);
    }
    for (const sz of [-1, 1]) {
      k.add(new THREE.BoxGeometry(W - 0.04, 0.03, 0.11), WOOD, 0, 0.17, sz * 0.34);
      for (const sx of [-0.3, 0.3]) k.add(new THREE.BoxGeometry(0.03, 0.16, 0.03), WOOD, sx, 0.08, sz * 0.34);
    }
    slice(k, -0.26, T + 0.002, 0.06, 0.3, 0.1);
    slice(k, -0.1, T + 0.002, -0.08, -0.4, 0.1);
    slice(k, 0.06, T + 0.002, 0.1, 0.1, 0.09);
    // half a watermelon, cut side up, and blue plates
    k.add(new THREE.SphereGeometry(0.1, 10, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), GREEN, 0.25, T + 0.1, -0.04);
    k.add(new THREE.CylinderGeometry(0.088, 0.088, 0.012, 12), 0xf04a55, 0.25, T + 0.1, -0.04);
    for (const [px, pz] of [[-0.02, -0.15], [0.2, 0.15]]) k.add(new THREE.CylinderGeometry(0.06, 0.05, 0.012, 12), BLUE, px, T + 0.007, pz);
    k.add(new THREE.CylinderGeometry(0.035, 0.03, 0.1, 8), 0xf3d24a, 0.05, T + 0.05, -0.15);
    place(wrap('Picnic table', meshOf(k)), x, heightAt(x, z), z, (rand(ti, 5) - 0.5) * 0.5);
  });
  const grillAt = ctx.spots(1, { r: 0.36, from: 1.3, to: 4.8, front: 1.5, spacing: 0.9 })[0];
  let smoke = null;
  if (grillAt) {
    const k = new Kit();
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; k.rod([Math.sin(a) * 0.14, 0, Math.cos(a) * 0.14], [Math.sin(a) * 0.07, 0.38, Math.cos(a) * 0.07], 0.025, DARK); }
    k.add(new THREE.SphereGeometry(0.17, 12, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), RED, 0, 0.47, 0);
    k.add(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12), 0xff7a2a, 0, 0.44, 0);
    k.add(new THREE.CylinderGeometry(0.168, 0.168, 0.008, 12), 0x55504c, 0, 0.47, 0);
    for (const [bx, bz] of [[-0.06, 0.05], [0.06, 0.06], [0, -0.06]]) k.add(new THREE.CylinderGeometry(0.038, 0.038, 0.022, 8), 0x6b3f25, bx, 0.485, bz);
    for (const bx of [-0.1, 0.1]) k.add(new THREE.CapsuleGeometry(0.014, 0.08, 2, 6), 0xc0533a, bx, 0.485, -0.01, Math.PI / 2);
    const lid = new THREE.SphereGeometry(0.17, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    lid.translate(0, 0, 0.17);
    k.add(lid, RED, 0, 0.47, -0.17, -1.8);
    k.add(new THREE.BoxGeometry(0.06, 0.02, 0.02), DARK, 0, 0.8, -0.25);
    // a cooler beside it
    k.add(new THREE.BoxGeometry(0.26, 0.16, 0.18), RED, 0.38, 0.08, 0.06);
    k.add(new THREE.BoxGeometry(0.27, 0.035, 0.19), WHITE, 0.38, 0.175, 0.06);
    k.add(starGeo(0.04, 0.01), WHITE, 0.38, 0.08, 0.152);
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0xe4e1dc, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true });
    smokeMat.userData.noSeason = true;
    plainMats.push(smokeMat);
    smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), smokeMat, 6);
    smoke.name = 'Grill smoke';
    smoke.castShadow = false;
    smoke.frustumCulled = false;
    place(wrap('Grill', meshOf(k), smoke), grillAt[0], heightAt(grillAt[0], grillAt[1]), grillAt[1], (rand(9) - 0.5) * 0.6);
  }

  // ---- every building: a big flag on its roof, flag fans on its front (and bunting across it)
  const flagGeo = (() => {
    const k = new Kit(), P = 0.8;
    k.add(new THREE.CylinderGeometry(0.015, 0.02, P, 6), POLE, 0, P / 2, 0);
    k.add(new THREE.SphereGeometry(0.03, 8, 6), GOLD, 0, P + 0.015, 0);
    flagCloth(k, 0.035, P - 0.04 - 0.36, 0.6, 0.36, 0.005);
    return k.geometry();
  })();
  const roofWave = waver(flagGeo, 0.035, 0.6, 0.04);
  const toWorld = (b, lx, ly, lz) => [b.x + lx * Math.cos(b.ry) + lz * Math.sin(b.ry), b.y + ly, b.z - lx * Math.sin(b.ry) + lz * Math.cos(b.ry)];
  ctx.buildings.forEach((b, bi) => {
    const bs = b.scale || s, h = b.height || 1;
    // where this kind of building takes its things (its own units; the generic one from its size)
    const d = DRESS[b.key] || { flag: [0, (0.8 * h) / bs, 0], fans: [[0, (0.5 * h) / bs, (0.62 * b.r) / bs, 0, Math.min(0.26, Math.max(0.12, b.r * 0.3)) / bs]] };
    // the roof flag: as big as the building can carry
    const [px, py, pz] = toWorld(b, d.flag[0] * bs, d.flag[1] * bs, d.flag[2] * bs);
    const flag = wrap('Roof flag', new THREE.Mesh(flagGeo, paint));
    flag.scale.setScalar(Math.max(0.65, Math.min(1.15, h / 1.3)));
    place(flag, px, py, pz, (rand(bi, 2) - 0.5) * 0.5, { onBuilding: true });
    const fans = b.key === 'barn' && ctx.barn ? null : d.fans; // the barn's fans are in barnBits
    if (fans?.length) {
      const k = new Kit();
      for (const [x, y, z, ry, fr] of fans) k.addM(fanGeo(Math.round(fr * bs * 100) / 100), null, M(x * bs, y * bs, z * bs, 0, ry));
      place(wrap('Flag fans', meshOf(k)), b.x, b.y, b.z, b.ry, { onBuilding: true });
    }
    for (const [a, c, sag] of d.swags || []) strings.push({ pts: [toWorld(b, a[0] * bs, a[1] * bs, a[2] * bs), toWorld(b, c[0] * bs, c[1] * bs, c[2] * bs)], sag: sag * bs });
    if (d.ring) strings.push({ pts: ring(b.x, b.z, d.ring[0] * bs, b.y + d.ring[1] * bs, 18), sag: 0.02 });
  });
  function ring(cx, cz, rad, y, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad]); }
    return pts;
  }

  // ---- the barn (its own space; decor.js already hangs bunting along its eaves and a flag by it):
  // flag fans under the eaves and on both gables, and a big barn star on the front of the roof
  let barnBits = null;
  if (ctx.barn) {
    const k = new Kit();
    // (the front wall is at z 0.8 with windows at x ±0.74 up to y 1.15; the gables' faces at x ±1.13)
    for (const x of [-0.74, 0.74]) k.addM(fanGeo(0.21), null, M(x, 1.3, 0.875));
    for (const sx of [-1, 1]) k.addM(fanGeo(0.26), null, M(sx * 1.15, 1.47, 0, 0, sx * Math.PI / 2));
    // the front roof board: centred at (0, 1.73, 0.47), tilted 0.74 rad, its tiles ~0.085 proud
    const ny = Math.cos(0.74), nz = Math.sin(0.74), tilt = -(Math.PI / 2 - 0.74);
    const onRoof = (d) => [0, 1.73 + ny * d, 0.47 + nz * d];
    k.add(discGeo(0.5, 0.02, 20), RED, ...onRoof(0.09), tilt);
    k.add(discGeo(0.43, 0.02, 20), NAVY, ...onRoof(0.105), tilt);
    // the white star (it glows a little at night, like the path stars)
    const star = new THREE.Mesh(starGeo(0.38, 0.03), starMat);
    star.position.set(...onRoof(0.125));
    star.rotation.x = tilt;
    barnBits = wrap('July 4th barn', meshOf(k), star);
  }

  // ---- every fence: a pleated fan on the top rail every ~1.5, red, white and blue bunting
  // swagged from fan to fan (left open at the gates), and a pinwheel at every other swag
  const gates = ctx.fields.map((fl) => fl.gate).filter(Boolean);
  const nearGate = (x, z) => gates.some((g) => Math.hypot(g.x - x, g.z - z) < 0.45);
  const fenceFans = [], wheelAt = [];
  for (const fl of ctx.fields) {
    const d = ctx.fenceLine(fl, { outset: 0, step: 0.25 }); // closed: the last point is the first
    const N = d.length - 1;
    if (N < 3) continue;
    const [cx, cz] = fl.center;
    const nrm = d.map((p, i) => {
      const a = d[(i - 1 + N) % N], b = d[(i + 1) % N];
      let nx = b[2] - a[2], nz = -(b[0] - a[0]);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      if (nx * (p[0] - cx) + nz * (p[2] - cz) < 0) { nx = -nx; nz = -nz; }
      return [nx, nz];
    });
    const out = (i, o) => [d[i][0] + nrm[i][0] * o, d[i][2] + nrm[i][1] * o];
    const step = (i, j) => Math.hypot(d[j][0] - d[i][0], d[j][2] - d[i][2]);
    let run = [], len = 0, swag = 0;
    const finish = () => {
      if (run.length < 2 || len < 0.3) return;
      const pts = [];
      let u = 0;
      run.forEach((i, j) => {
        if (j) u += step(run[j - 1], i);
        const [x, z] = out(i, 0.09);
        pts.push([x, fl.fenceY + 0.02 - Math.sin((Math.PI * u) / len) * 0.07, z]);
      });
      strings.push({ pts, sag: 0 });
      if (swag++ % 2 || wheelAt.length >= 36) return;
      const [x, z] = out(run[run.length >> 1], 0.2);
      if (ctx.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 0.1)) return;
      ctx.take(x, z, 0.08, { block: false });
      wheelAt.push({ x, y: heightAt(x, z), z, hub: fl.fenceY - heightAt(x, z) + 0.3 });
    };
    const fan = (i) => {
      const [x, z] = out(i, 0.05);
      if (gates.some((g) => Math.hypot(g.x - x, g.z - z) < 0.75)) return; // (the balloons are there)
      fenceFans.push(M(x, fl.fenceY + 0.01, z, 0, Math.atan2(nrm[i][0], nrm[i][1])));
    };
    const start = d.findIndex((p, i) => i < N && !nearGate(p[0], p[2]));
    if (start < 0) continue;
    fan(start);
    run = [start];
    for (let st = 1; st <= N; st++) {
      const i = (start + st) % N;
      if (nearGate(d[i][0], d[i][2])) { finish(); run = []; len = 0; continue; }
      if (run.length) len += step(run[run.length - 1], i);
      run.push(i);
      if (len >= 1.5 || st === N) {
        finish();
        if (st < N) fan(i);
        run = [i]; len = 0;
      }
    }
  }
  if (fenceFans.length) {
    const im = new THREE.InstancedMesh(fanGeo(0.2), paint, fenceFans.length);
    im.name = 'Fence fans';
    fenceFans.forEach((m, i) => im.setMatrixAt(i, m));
    place(im, 0, 0, 0, 0, { noPop: true, onFence: true });
  }

  // ---- every tree: a spiral of bunting round its crown
  ctx.trees.forEach((t, ti) => {
    const h = t.height || 1.5, pts = [], pine = t.key === 'pine';
    const cr = Math.max(0.4, t.r * 1.35), cy = t.y + h * 0.66;
    for (let i = 0; i <= 30; i++) {
      const u = i / 30, a = u * Math.PI * 4 + ti;
      const y = t.y + h * (pine ? 0.3 + 0.52 * u : 0.5 + 0.38 * u);
      const rad = pine ? t.r * 1.55 * (1 - 0.72 * u) + 0.06 : Math.max(0.14, Math.sqrt(Math.max(0, cr * cr - (y - cy) ** 2)) + 0.05);
      pts.push([t.x + Math.cos(a) * rad, y, t.z + Math.sin(a) * rad]);
    }
    strings.push({ pts, sag: 0.02 });
  });
  const bunting = makeIslandBunting(strings);
  if (bunting) place(bunting.group, 0, 0, 0, 0, { noPop: true, onFence: true });

  // ---- every gate: two bunches of balloons, bobbing
  const bunches = [];
  const balloonGeos = [0, 1].map((v) => {
    const k = new Kit();
    // seven big balloons, a white one with a gold star on top
    const at = [[-0.1, 0.92, 0.03], [0.1, 0.95, -0.04], [0, 1.14, -0.01], [-0.05, 0.78, 0.1], [0.12, 0.76, 0.08], [-0.13, 0.74, -0.06], [0.03, 0.82, -0.12]];
    at.forEach(([x, y, z], i) => {
      const c = i === 2 ? WHITE : RWB[(i + v) % 3];
      k.add(new THREE.SphereGeometry(0.12, 10, 8), c, x, y, z, 0, 0, 0, 1, 1.18, 1);
      k.add(new THREE.ConeGeometry(0.026, 0.04, 5), c, x, y - 0.15, z, Math.PI);
      k.rod([0, 0.1, 0], [x, y - 0.16, z], 0.008, 0xf2efe8);
    });
    k.add(starGeo(0.07, 0.02), v ? RED : BLUE, 0, 1.14, 0.135);
    k.add(new THREE.BoxGeometry(0.09, 0.09, 0.09), GOLD, 0, 0.045, 0);
    k.add(new THREE.BoxGeometry(0.095, 0.02, 0.02), RED, 0, 0.07, 0);
    return k.geometry();
  });
  const perGate = gates.length > 8 ? 1 : 2;
  gates.forEach((g, gi) => {
    const tx = -g.nz, tz = g.nx;
    for (const side of perGate === 2 ? [-1, 1] : [1]) {
      const x = g.x + tx * side * 0.4 + g.nx * 0.14, z = g.z + tz * side * 0.4 + g.nz * 0.14;
      ctx.take(x, z, 0.14, { block: false });
      const m = new THREE.Mesh(balloonGeos[(gi + (side > 0 ? 1 : 0)) % 2], paint);
      const o = place(wrap('Balloons', m), x, heightAt(x, z), z, rand(gi, side + 3) * 6, { onFence: true });
      bunches.push({ o, m, ph: gi * 1.7 + side });
    }
  });

  // ---- every lamp: a striped sleeve, crossed flags and a flag fan
  const lampFlag = miniFlagGeo(0.4, 0.22, 0.13);
  ctx.lamps.forEach((l) => {
    if (!l.at) return;
    const [x, z] = l.at;
    const k = new Kit();
    const stripes = (px, py, pz) => (Math.floor(((Math.atan2(px, pz) + Math.PI) / (Math.PI * 2)) * 10) % 2 ? WHITE : RED);
    k.add(new THREE.CylinderGeometry(0.062, 0.062, 0.5, 10, 1, true), stripes, 0, 0.42, 0);
    for (const y of [0.17, 0.67]) k.add(new THREE.CylinderGeometry(0.068, 0.068, 0.045, 10), BLUE, 0, y, 0);
    k.addM(lampFlag.clone(), null, M(0.02, 0.7, 0.07, 0, 0, -0.55));
    k.addM(lampFlag.clone(), null, M(-0.02, 0.7, 0.07, 0, 0, 0.55, -1, 1, 1));
    k.addM(fanGeo(0.12), null, M(0, 0.76, 0.08));
    place(wrap('Lamp flags', meshOf(k)), x, heightAt(x, z), z, 0, { onBuilding: true });
  });

  // ---- the paths: big white stars on striped posts, little flags in between
  const starPosts = ctx.pathSpots(12, { r: 0.18, spacing: 1.3 });
  const postGeo = (() => {
    const k = new Kit();
    k.add(new THREE.BoxGeometry(0.16, 0.06, 0.16), NAVY, 0, 0.03, 0);
    k.add(new THREE.BoxGeometry(0.055, 0.9, 0.055), WHITE, 0, 0.5, 0);
    for (const y of [0.25, 0.45, 0.65]) k.add(new THREE.BoxGeometry(0.06, 0.07, 0.06), RED, 0, y, 0);
    k.add(discGeo(0.34, 0.025, 16), RED, 0, 1.0, -0.05);
    k.add(discGeo(0.29, 0.025, 16), NAVY, 0, 1.0, -0.035);
    return k.geometry();
  })();
  const bigStar = starGeo(0.27, 0.06);
  starPosts.forEach(([x, z], i) => {
    const star = new THREE.Mesh(bigStar, starMat);
    star.position.y = 1.0;
    place(wrap('Star post', new THREE.Mesh(postGeo, paint), star), x, heightAt(x, z), z, (rand(i, 7) - 0.5) * 0.5);
  });
  const miniAt = ctx.pathSpots(30, { r: 0.05, spacing: 0.5, block: false });
  let minis = null;
  if (miniAt.length) {
    minis = new THREE.InstancedMesh(miniFlagGeo(0.42, 0.22, 0.13), paint, miniAt.length);
    minis.name = 'Path flags';
    minis.userData.at = miniAt.map(([x, z], i) => ({ x, y: heightAt(x, z), z, yaw: (rand(i, 11) - 0.5) * 0.8, ph: i * 1.3 }));
    place(minis, 0, 0, 0, 0, { noPop: true });
  }

  // ---- open grass all round: hay bales draped in the flag, with a fan and a little flag
  const bales = ctx.spots(8, { r: 0.32, from: 2.8, to: R * 0.95, spacing: 1.7 });
  const baleGeo = (() => {
    const k = new Kit(), BR = 0.25;
    k.add(new THREE.CylinderGeometry(BR, BR, 0.38, 14), 0xe3c46f, 0, BR, 0, Math.PI / 2);
    for (const sz of [-1, 1]) k.add(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 14), 0xd7b55c, 0, BR, sz * 0.192, Math.PI / 2);
    const n = 9, span = 2.0;
    for (let i = 0; i < n; i++) {
      const th = -span / 2 + ((i + 0.5) / n) * span, w = ((BR + 0.008) * span) / n;
      const x = Math.sin(th) * (BR + 0.008), y = BR + Math.cos(th) * (BR + 0.008);
      k.add(new THREE.BoxGeometry(w * 1.04, 0.012, 0.3), i % 2 ? WHITE : RED, x, y, 0, 0, 0, -th);
      if (i < 4) k.add(new THREE.BoxGeometry(w * 1.06, 0.014, 0.14), BLUE, x * 1.005, y + 0.001, 0.08, 0, 0, -th);
    }
    k.addM(fanGeo(0.16), null, M(0, 0.44, 0.198));
    k.addM(miniFlagGeo(0.42, 0.22, 0.13), null, M(0.12, 0.38, -0.05, 0, 0.3, -0.25));
    return k.geometry();
  })();
  bales.forEach(([x, z], i) => place(wrap('Flag bale', new THREE.Mesh(baleGeo, paint)), x, heightAt(x, z), z, (rand(i, 13) - 0.5) * 0.9));

  // ---- open grass: picnic blankets in the Stars and Stripes, flat on the ground (only where it's flat)
  const blanketGeo = (() => {
    const k = new Kit(), W = 0.76, H = 0.46;
    k.add(new THREE.BoxGeometry(W + 0.05, 0.012, H + 0.05), WHITE, 0, 0.006, 0);
    const f = new Kit();
    flagCloth(f, -W / 2, -H / 2, W, H, 0.002);
    k.addM(f.geometry(), null, M(0, 0.014, 0, -Math.PI / 2));
    return k.geometry();
  })();
  let blankets = 0;
  for (const [x, z] of ctx.spots(10, { r: 0.45, from: 2.4, to: R * 0.95, spacing: 2.2, block: false })) {
    if (blankets >= 6) break;
    const hs = [[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]].map(([dx, dz]) => heightAt(x + dx, z + dz));
    if (Math.max(...hs) - Math.min(...hs) > 0.06) continue;
    const o = place(wrap('Flag blanket', new THREE.Mesh(blanketGeo, paint)), x, (hs[0] + hs[1] + hs[2] + hs[3]) / 4, z, (rand(blankets, 23) - 0.5) * 0.5);
    o.rotation.x = -Math.atan((hs[2] + hs[3] - hs[0] - hs[1]) / 2 / 0.5); // lie along the slope
    o.rotation.z = Math.atan((hs[1] + hs[3] - hs[0] - hs[2]) / 2 / 0.8);
    blankets++;
  }

  // ---- pinwheels: along every fence (above) and about the grass, spinning
  for (const [x, z] of ctx.spots(12, { r: 0.12, from: 1.6, to: R * 0.95, spacing: 1.3, block: false })) wheelAt.push({ x, y: heightAt(x, z), z, hub: 0.62 });
  let wheels = null;
  if (wheelAt.length) {
    const k = new Kit(), WR = 0.22;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const P = [Math.cos(a) * WR, Math.sin(a) * WR, 0];
      const Q = [Math.cos(a + 1.0) * WR * 0.62, Math.sin(a + 1.0) * WR * 0.62, 0.05];
      const S = [Math.cos(a - 0.6) * WR * 0.5, Math.sin(a - 0.6) * WR * 0.5, 0];
      k.tri([0, 0, 0], P, Q, i % 2 ? BLUE : RED);
      k.tri([0, 0, 0], S, P, WHITE);
    }
    k.add(starGeo(0.055, 0.02), GOLD, 0, 0, 0.055);
    wheels = new THREE.InstancedMesh(k.geometry(), paint, wheelAt.length);
    wheels.name = 'Pinwheels';
    const stickGeo = new THREE.BoxGeometry(0.022, 1, 0.022);
    stickGeo.translate(0, 0.5, 0);
    const sticks = new THREE.InstancedMesh(stickGeo, mat(0xf3efe6), wheelAt.length);
    sticks.name = 'Pinwheel sticks';
    wheelAt.forEach((w, i) => {
      w.yaw = (rand(i, 17) - 0.5) * 0.9;
      w.speed = 2.2 + rand(i, 19) * 2;
      sticks.setMatrixAt(i, M(w.x, w.y, w.z, 0, w.yaw, 0, 1, w.hub, 1));
    });
    place(wrap('Pinwheels', wheels, sticks), 0, 0, 0, 0, { noPop: true, onFence: true });
  }

  // ---------------------------------------------------------------- motion
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), sc = new THREE.Vector3();
  function update(dt, time, { night = 0, k = 1 } = {}) {
    if (!k) return;
    bunting?.update(time);
    roofWave(time);
    bigWave?.(time * 0.85);
    for (const b of bunches) {
      b.m.position.y = Math.sin(time * 1.6 + b.ph) * 0.03;
      b.o.rotation.z = Math.sin(time * 1.1 + b.ph) * 0.05;
      b.o.rotation.x = Math.cos(time * 0.9 + b.ph) * 0.04;
    }
    if (wheels) {
      for (let i = 0; i < wheelAt.length; i++) {
        const w = wheelAt[i];
        e.set(0, w.yaw, -time * w.speed);
        wheels.setMatrixAt(i, m4.compose(v.set(w.x + Math.sin(w.yaw) * 0.025, w.y + w.hub, w.z + Math.cos(w.yaw) * 0.025), q.setFromEuler(e), sc.set(1, 1, 1)));
      }
      wheels.instanceMatrix.needsUpdate = true;
    }
    if (minis) {
      const at = minis.userData.at;
      for (let i = 0; i < at.length; i++) {
        const f = at[i];
        e.set(0, f.yaw + Math.sin(time * 1.4 + f.ph) * 0.35, 0);
        minis.setMatrixAt(i, m4.compose(v.set(f.x, f.y, f.z), q.setFromEuler(e), sc.set(1, 1, 1)));
      }
      minis.instanceMatrix.needsUpdate = true;
    }
    if (smoke) {
      for (let i = 0; i < 6; i++) {
        const u = (time * 0.32 + i / 6) % 1;
        const r = 0.04 + Math.sin(u * Math.PI) * 0.09;
        e.set(u * 2, i, 0);
        smoke.setMatrixAt(i, m4.compose(v.set(Math.sin(u * 5 + i) * 0.06 + u * 0.12, 0.55 + u * 0.8, Math.cos(u * 4 + i) * 0.04), q.setFromEuler(e), sc.set(r, r, r)));
      }
      smoke.instanceMatrix.needsUpdate = true;
    }
    starMat.emissiveIntensity = 0.08 + 0.9 * night;
  }
  update(0, 0, { night: 0, k: 1 });

  // ---------------------------------------------------------------- the sheep's costumes
  /**
   * By turns: an Uncle Sam top hat (white with red stripes, a blue band with white stars), a red,
   * white and blue headband with two star boppers, or the Statue of Liberty's crown.
   */
  function sheepWear(i) {
    const g = new THREE.Group();
    g.name = 'July 4th costume';
    const ph = i * 1.9, kind = i % 3;
    if (kind === 0) {
      const k = new Kit();
      k.add(new THREE.CylinderGeometry(0.145, 0.145, 0.018, 18), BLUE, 0, 0.009, 0);
      const stripes = (x, y, z) => (Math.floor(((Math.atan2(x, z) + Math.PI) / (Math.PI * 2)) * 12) % 2 ? WHITE : RED);
      k.add(new THREE.CylinderGeometry(0.092, 0.08, 0.25, 12, 1, true), stripes, 0, 0.143, 0);
      k.add(new THREE.CylinderGeometry(0.092, 0.092, 0.01, 12), WHITE, 0, 0.268, 0);
      k.add(new THREE.CylinderGeometry(0.086, 0.086, 0.055, 12), BLUE, 0, 0.046, 0);
      for (const a of [-0.8, 0, 0.8]) k.add(starGeo(0.026, 0.008), WHITE, Math.sin(a) * 0.09, 0.046, Math.cos(a) * 0.09, 0, a);
      const hat = new THREE.Mesh(k.geometry(), paint);
      hat.rotation.set(-0.08, 0, 0.14);
      g.add(hat);
      g.userData.update = (time) => { hat.rotation.z = 0.14 + Math.sin(time * 1.7 + ph) * 0.035; };
    } else if (kind === 1) {
      const band = new Kit();
      // an arch over the head, ear to ear, in red, white and blue thirds
      const third = (x, y) => RWB[Math.min(2, Math.floor((Math.atan2(Math.max(0, y), x) / Math.PI) * 3))];
      band.add(new THREE.TorusGeometry(0.11, 0.02, 5, 18, Math.PI), third, 0, -0.09, 0);
      g.add(new THREE.Mesh(band.geometry(), paint));
      const bops = [-1, 1].map((sx) => {
        const k = new Kit();
        k.rod([0, 0, 0], [0, 0.13, 0], 0.012, 0xd8d8dc);
        k.add(starGeo(0.072, 0.024), sx < 0 ? RED : BLUE, 0, 0.17, 0);
        k.add(starGeo(0.036, 0.01), WHITE, 0, 0.17, 0.016);
        const pivot = new THREE.Group();
        pivot.position.set(sx * 0.05, 0.02, 0);
        pivot.add(new THREE.Mesh(k.geometry(), paint));
        g.add(pivot);
        return { pivot, sx };
      });
      const wob = (time) => { for (const b of bops) b.pivot.rotation.z = -b.sx * 0.38 + Math.sin(time * 5 + ph + b.sx) * 0.13; };
      wob(0);
      g.userData.update = wob;
    } else {
      // the crown: a copper-green cap with seven rays fanning round its front
      const k = new Kit();
      k.add(new THREE.CylinderGeometry(0.1, 0.104, 0.05, 14), LIBERTY, 0, 0.022, 0);
      k.add(new THREE.TorusGeometry(0.104, 0.012, 4, 14), LIBERTY_DARK, 0, 0.045, 0, Math.PI / 2);
      for (let j = 0; j < 7; j++) {
        const a = (j - 3) * 0.4;
        const ray = new THREE.ConeGeometry(0.024, 0.13, 4);
        ray.translate(0, 0.065, 0);
        k.add(ray, LIBERTY, Math.sin(a) * 0.09, 0.04, Math.cos(a) * 0.09, 0.45, a);
      }
      for (const a of [-0.5, 0, 0.5]) k.add(new THREE.BoxGeometry(0.03, 0.022, 0.01), LIBERTY_DARK, Math.sin(a) * 0.105, 0.022, Math.cos(a) * 0.105, 0, a);
      const crown = new THREE.Mesh(k.geometry(), paint);
      crown.rotation.x = -0.06;
      g.add(crown);
    }
    return g;
  }

  return {
    root,
    barnBits,
    update,
    sheepWear,
    lampColors: [0xff3b3b, 0xfff4e8, 0x3b6bff],
    dispose() {
      const geos = new Set();
      for (const o of [root, barnBits]) o?.traverse((m) => { if (m.geometry) geos.add(m.geometry); if (m.isInstancedMesh) m.dispose(); });
      geos.forEach((g) => g.dispose());
      bigStar.dispose();
      plainMats.forEach((m) => m.dispose());
      bunting?.dispose();
    },
  };
}

/**
 * All the island's bunting (fences, trees, building fronts) as one InstancedMesh of flags and one
 * set of strings. update(time) lets the flags stir.
 */
function makeIslandBunting(strings, { spacing = 0.16, size = 0.155 } = {}) {
  const flags = [], seg = [];
  strings.forEach(({ pts, sag }, si) => {
    let n0 = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (len < 1e-4) continue;
      const n = Math.max(1, Math.round(len / spacing));
      const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
        if (prev) seg.push(...prev, ...p);
        prev = p;
        if (k < n) flags.push({ p, yaw, c: RWB[(n0++ + si) % 3] });
      }
    }
  });
  if (!flags.length) return null;
  const group = new THREE.Group();
  group.name = 'Bunting (fences, trees, buildings)';
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x5a4a3e });
  group.add(new THREE.LineSegments(lineGeo, lineMat));
  const sh = new THREE.Shape();
  sh.moveTo(-size / 2, 0);
  sh.lineTo(size / 2, 0);
  sh.lineTo(0, -size * 1.25);
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, flatShading: true });
  material.userData.noSeason = true;
  const im = new THREE.InstancedMesh(new THREE.ShapeGeometry(sh), material, flags.length);
  im.name = 'Bunting flags';
  const c = new THREE.Color();
  flags.forEach((f, i) => im.setColorAt(i, c.set(f.c)));
  group.add(im);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const update = (time) => {
    for (let i = 0; i < flags.length; i++) {
      const f = flags[i];
      e.set(Math.sin(time * 2.2 + i * 0.9) * 0.24, f.yaw, 0);
      im.setMatrixAt(i, m.compose(v.set(f.p[0], f.p[1], f.p[2]), q.setFromEuler(e), one));
    }
    im.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { group, update, dispose() { lineMat.dispose(); material.dispose(); } };
}
