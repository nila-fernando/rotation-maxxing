// The New Year theme: a midnight party all over the farm. Gold and silver lights along every fence,
// every roofline and between the lamp posts, glowing paper lanterns strung round the farmyard,
// balloon bunches at every gate, sparkler fountains, star garlands on the trees, streamers on the
// buildings, spinning disco balls, star stakes over the grass, and the coming year in giant gold
// digits (the New Year of the farm year on show) by a clock at midnight in front of the farmyard.
// The sheep wear party hats and tiaras.
// (The fireworks, the barn's own lights and the tree by the barn come from ../decor.js.)
import * as THREE from 'three';
import { mat, mergeStatic, mesh } from '../props.js';
import { towerRadiusAt as lhR, LIGHTHOUSE } from '../lighthouse.js';

const GOLD = 0xffc94a, GOLD_DEEP = 0xe8a92a, SILVER = 0xe6ecf6, WHITE = 0xfffaf0, MAGENTA = 0xff4fc3, MIDNIGHT = 0x1f2a5c, ICE = 0x9cc8ff;
const BULB_COLORS = [GOLD, SILVER, GOLD, WHITE];
const BCOL_ALL = [GOLD, SILVER, MAGENTA, WHITE, GOLD, ICE]; // balloons

/** An unlit glowing material (bulbs, lanterns, sparks): never snowed on or tinted. */
function glow(color, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ color, ...opts });
  m.userData.noSeason = true;
  return m;
}

/** A five-pointed star, 1 across the points, facing +z (scaled per instance). */
function starGeometry() {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 0.42 : 1;
    if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.28, bevelEnabled: false });
  g.translate(0, 0, -0.14);
  return g;
}

/** A curly foil streamer: a twisted strip 1 long hanging down from its origin (scaled per instance). */
function streamerGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 1, 14);
  g.translate(0, -0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), a = y * Math.PI * 5;
    p.setXYZ(i, x * Math.cos(a), y, x * Math.sin(a));
  }
  g.computeVertexNormals();
  return g;
}

// the segments lit for each digit: a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle
const SEGMENTS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

// each building's outline in its own space (front +z, unscaled): the roofline the lights run
// along, the eave the streamers hang from, and where its star goes
function buildingDress(b) {
  const H = b.height / (b.scale || 0.75);
  switch (b.key) {
    case 'barn': // (its roofline lights come from decor.js)
      return { lines: [], front: [-1.2, 1.2, 1.2, 1.03], stars: [[0, 2.48, 0, 0.24], [-1.38, 2.42, 0, 0.16], [1.38, 2.42, 0, 0.16]] };
    case 'farmhouse':
      return {
        lines: [[[-0.76, 0.92, 0.5], [0.76, 0.92, 0.5], [0.78, 1.42, -0.06], [0.76, 0.92, -0.62], [-0.76, 0.92, -0.62], [-0.78, 1.42, -0.06], [-0.76, 0.92, 0.5]], [[-0.78, 1.43, -0.06], [0.78, 1.43, -0.06]]],
        front: [-0.66, 0.66, 0.88, 0.53], stars: [[0, 1.62, -0.06, 0.2]],
      };
    case 'machineShed':
      return { lines: [[[-0.82, H * 0.74, -0.62], [-0.82, H * 0.93, 0.62], [0.82, H * 0.93, 0.62], [0.82, H * 0.74, -0.62]]], front: [-0.75, 0.75, H * 0.9, 0.65], stars: [[0, H * 0.98 + 0.2, 0.55, 0.2]] };
    case 'chickenCoop':
      return {
        lines: [[[-0.55, 0.6, 0.03], [0.15, 0.6, 0.03], [0.16, 0.84, -0.25], [-0.56, 0.84, -0.25], [-0.55, 0.6, 0.03]]],
        front: [-0.45, 0.05, 0.58, 0.05], stars: [[-0.2, 1.0, -0.25, 0.16]],
      };
    case 'greenhouse': {
      const arch = (x) => Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * Math.PI; return [x, 0.16 + Math.sin(a) * 0.5, Math.cos(a) * 0.5]; });
      return { lines: [arch(-0.72), arch(0.72), [[-0.72, 0.67, 0], [0.72, 0.67, 0]], [[-0.72, 0.2, 0.52], [0.72, 0.2, 0.52]]], front: null, stars: [[0, 0.86, 0, 0.18]] };
    }
    case 'grainBins': {
      const bins = [[-0.5, 0.05, 0.34, 0.95], [0.2, -0.12, 0.38, 1.05], [0.72, 0.25, 0.26, 0.75]];
      return { lines: bins.map(([x, z, r, h]) => ring(x, z, r + 0.03, h + 0.05)), front: null, stars: bins.map(([x, z, , h]) => [x, h + 0.28, z, 0.15]) };
    }
    case 'silo':
      return { lines: [spiral(0, 0, (y) => 0.56, 0.15, 1.88, 3), ring(0, 0, 0.56, 1.9)], round: [0.56, 1.86], stars: [[0, 2.78, 0, 0.22]] };
    case 'windmill':
      return { lines: [spiral(0, 0, (y) => 0.62 - 0.22 * (y / 2.1), 0.2, 2.05, 2.5)], round: null, stars: [[0, 2.92, 0, 0.24]] };
    case 'lighthouse':
      // lights spiralling up the tower and round the gallery rail, a star over the cap
      return { lines: [spiral(0, 0, (y) => lhR(y) + 0.025, 0.3, 2.5, 2.5), ring(0, 0, LIGHTHOUSE.railR + 0.03, LIGHTHOUSE.railY + 0.01)], round: null, stars: [[0, LIGHTHOUSE.top + 0.3, 0, 0.24]] };
    case 'well':
      return { lines: [ring(0, 0, 0.27, 0.42)], front: null, stars: [[0, H + 0.16, 0, 0.14]] };
    default: {
      const hw = (b.r / (b.scale || 0.75)) * 0.72, e = H * 0.62;
      return { lines: [[[-hw, e, hw], [hw, e, hw], [hw, e, -hw], [-hw, e, -hw], [-hw, e, hw]]], front: [-hw * 0.9, hw * 0.9, e - 0.04, hw + 0.03], stars: [[0, H + 0.16, 0, 0.18]] };
    }
  }
}
function ring(x, z, r, y, n = 18) {
  return Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; });
}
function spiral(x, z, rad, y0, y1, turns) {
  const n = Math.round(turns * 18);
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, y = y0 + (y1 - y0) * t, a = t * turns * Math.PI * 2; return [x + Math.cos(a) * rad(y), y, z + Math.sin(a) * rad(y)]; });
}

export default function build(ctx) {
  const root = new THREE.Group();
  const own = []; // materials made here (the props.js mat() ones are shared: never disposed)
  const keep = (m) => { own.push(m); return m; };
  const sc = ctx.scale;
  const hAt = ctx.heightAt;
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ'), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();

  // ---------------------------------------------------------------- shared materials
  const bulbMat = keep(glow(0xffffff));
  const lanternMat = keep(glow(0xffffff));
  const starMat = keep(glow(0xffffff));
  const sparkMat = keep(glow(0xffffff));
  const wireMat = keep(new THREE.LineBasicMaterial({ color: 0x3b3530 }));
  const goldGlow = keep(new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD_DEEP, emissiveIntensity: 0.3, roughness: 0.35, metalness: 0.35, flatShading: true }));
  const faceMat = keep(glow(0xfdf6e3));
  const gemMat = keep(glow(MAGENTA));
  const foilMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.25, side: THREE.DoubleSide, flatShading: true }));
  const balloonMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.3 }));
  foilMat.userData.noSeason = balloonMat.userData.noSeason = goldGlow.userData.noSeason = true;
  const navy = mat(MIDNIGHT, { roughness: 0.7 });
  const silverM = mat(0xc9d1de, { roughness: 0.35, metalness: 0.45 });
  const goldM = mat(GOLD, { roughness: 0.4, metalness: 0.4 });
  const ironM = mat(0x2b2f42, { roughness: 0.6 });

  // ---------------------------------------------------------------- collectors for the island-wide instanced things
  const bulbs = []; // [x, y, z, color]
  const wire = []; // segment end points
  const stars = []; // [x, y, z, yaw, size, color]
  const streamers = []; // [x, y, z, yaw, length, color]
  const lanterns = []; // [x, y, z, color]
  const partyBalloons = []; // { ax, ay, az (where the string is tied), ox, oy, oz (the balloon from there), ph, c }

  /** Bulbs along a line through world points, sagging between each pair, plus the wire. */
  function strand(points, { colors = BULB_COLORS, spacing = 0.13, sag = 0.04, out = bulbs, drop = 0, step = 1 } = {}) {
    let n0 = out.length;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const n = Math.max(1, Math.round(len / spacing));
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
        if (prev) wire.push(prev, p);
        prev = p;
        if ((k > 0 || i === 0) && (k % step === 0)) out.push([p[0], p[1] - drop, p[2], colors[(out.length - n0) % colors.length]]);
      }
    }
  }
  /** A gold tinsel swag through world points, drooping `sag` between each pair (one merged tube mesh later). */
  const tinsel = []; // { pts, color }
  function swag(points, { sag = 0.1, color = GOLD, sub = 6 } = {}) {
    const pts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      for (let k = i ? 1 : 0; k <= sub; k++) {
        const t = k / sub;
        pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t));
      }
    }
    if (pts.length > 1) tinsel.push({ pts, color });
  }
  // tall things of our own that strings must not run through: [x, z, half width x, half depth z, top]
  const tall = [];
  // does a line from a to b (world, at their heights) pass through a building (or the centrepiece)?
  const clearOfBuildings = (a, b) => ctx.buildings.every((bd) => {
    for (let t = 0.1; t < 0.95; t += 0.1) {
      const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t;
      if (Math.hypot(x - bd.x, z - bd.z) < bd.r * 0.9 && y < bd.y + bd.height + 0.1) return false;
    }
    return true;
  }) && tall.every(([cx, cz, hx, hz, top]) => {
    for (let t = 0.05; t < 0.96; t += 0.05) {
      const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t - 0.3;
      if (Math.abs(x - cx) < hx && Math.abs(z - cz) < hz && y < top) return false;
    }
    return true;
  });
  // is (x, z) in (or within pad of) a field?
  const inAField = (x, z, pad = 0.2) => ctx.fields.some((fl) => (fl.rings || []).some((r) => {
    let ins = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i], [xj, zj] = r[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    if (ins) return true;
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - t * dx, z - az - t * dz) < pad) return true;
    }
    return false;
  }));
  const local = (b, lx, ly, lz) => {
    const s = b.scale || sc, c = Math.cos(b.ry || 0), n = Math.sin(b.ry || 0);
    return [b.x + (lx * c + lz * n) * s, b.y + ly * s, b.z + (-lx * n + lz * c) * s];
  };

  // ---------------------------------------------------------------- the centrepiece: the coming year and a clock at midnight
  // the year it shows follows the farm year on show (setYear); until told, the coming one
  const now = new Date();
  const year = String(now.getMonth() === 0 ? now.getFullYear() : now.getFullYear() + 1);
  let showYear = null; // set below: shows a year on the sign
  // the front of the farmyard, with room for the whole 3-wide stage: its middle and both ends clear
  let front = null;
  {
    const [hx, hz] = ctx.home, cands = [];
    for (let d = 1.8; d <= 5.6; d += 0.2) for (let i = 0, n = Math.round(d * 8); i < n; i++) {
      const a = (i / n) * Math.PI * 2, x = hx + Math.cos(a) * d, z = hz + Math.sin(a) * d;
      cands.push({ x, z, s: d - (z - hz) * 0.6 });
    }
    cands.sort((p, q) => p.s - q.s);
    // the whole stage and clock (x -1.5..1.45, z -0.3..0.35 round its spot) must be on
    // open ground and well clear of every building: a building's round footprint undersells a wide
    // shed, so keep 1.4 times it away
    const outline = [];
    for (let dx = -1.5; dx <= 1.46; dx += 0.25) for (const dz of [-0.3, 0.05, 0.35]) outline.push([dx, dz]);
    const clear = (x, z, r) => outline.every(([dx, dz]) => ctx.free(x + dx, z + dz, r)
      && ctx.buildings.every((b) => Math.hypot(b.x - x - dx, b.z - z - dz) > b.r * 1.4 + 0.12));
    for (const r of [0.12, 0.06]) {
      const c = cands.find(({ x, z }) => clear(x, z, r));
      if (c) { front = [c.x, c.z]; break; }
    }
    if (front) for (const dx of [-1.0, 0, 0.95]) ctx.take(front[0] + dx, front[1], 0.5);
    front ??= ctx.spots(1, { r: 0.7, from: 2, to: 5 })[0];
    front ??= [ctx.home[0], ctx.home[1] + 2.4];
  }
  let bigBulbs = null;
  {
    const g = new THREE.Group();
    g.name = 'Year and midnight clock';
    const parts = new THREE.Group();
    g.add(parts);
    const dw = 0.42, gap = 0.1, t = 0.1, H = 1.0, base = 0.2, depth = 0.12;
    const span = year.length * dw + (year.length - 1) * gap;
    const shift = -0.24; // the clock stands to the right, so the digits sit a little left
    const add = (geo, m, x, y, z, cast = true) => { const o = mesh(geo, m, cast, false); o.position.set(x, y, z); parts.add(o); return o; };
    // a midnight-blue stage and backboard, trimmed in gold
    add(new THREE.BoxGeometry(span + 0.4, base, 0.5), navy, shift, base / 2, 0);
    add(new THREE.BoxGeometry(span + 0.3, H + 0.22, 0.06), navy, shift, base + (H + 0.22) / 2, -0.12);
    add(new THREE.BoxGeometry(span + 0.46, 0.04, 0.54), goldGlow, shift, base, 0, false);
    add(new THREE.BoxGeometry(span + 0.38, 0.05, 0.08), goldGlow, shift, base + H + 0.22, -0.12, false);
    // the digits: all seven segments of each of the four places, as two instanced sets (across and
    // up-and-down); a year lights the segments it needs and hides the rest
    const across = new THREE.InstancedMesh(new THREE.BoxGeometry(dw - 2 * t + 0.02, t, depth), goldGlow, 4 * 3);
    const upright = new THREE.InstancedMesh(new THREE.BoxGeometry(t, H / 2 - t + 0.02, depth), goldGlow, 4 * 4);
    across.name = 'Year digits (across)';
    upright.name = 'Year digits (upright)';
    const segAt = []; // [place][segment] -> { mesh, index, x, y }
    for (let i = 0; i < 4; i++) {
      const cx = shift - span / 2 + dw / 2 + i * (dw + gap), y0 = base + 0.08 - 0.04;
      const place = {};
      let a = i * 3, u = i * 4;
      for (const s of 'agd') place[s] = { mesh: across, index: a++, x: cx, y: y0 + { a: H - t / 2, g: H / 2, d: t / 2 }[s] };
      for (const s of 'bcef') place[s] = { mesh: upright, index: u++, x: cx + ('bc'.includes(s) ? dw / 2 - t / 2 : -dw / 2 + t / 2), y: y0 + ('bf'.includes(s) ? H * 0.75 : H * 0.25) };
      segAt.push(place);
    }
    showYear = (y) => {
      const digits = String(y).padStart(4, '0').slice(-4);
      segAt.forEach((place, i) => {
        const lit = SEGMENTS[digits[i]] || '';
        for (const [s, seg] of Object.entries(place)) {
          seg.mesh.setMatrixAt(seg.index, lit.includes(s) ? tmpM.makeTranslation(seg.x, seg.y, 0) : tmpM.makeScale(0, 0, 0));
        }
      });
      across.instanceMatrix.needsUpdate = true;
      upright.instanceMatrix.needsUpdate = true;
    };
    showYear(year);
    g.add(across, upright);
    // the clock post: an iron post, a round white face at midnight, gold rim and finial
    const kx = shift + span / 2 + 0.46, ky = 1.42;
    add(new THREE.BoxGeometry(0.3, 0.1, 0.3), ironM, kx, 0.05, 0);
    add(new THREE.CylinderGeometry(0.05, 0.06, ky, 8), ironM, kx, ky / 2, 0);
    const face = add(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 20), faceMat, kx, ky + 0.06, 0.02, false);
    face.rotation.x = Math.PI / 2;
    const rim = add(new THREE.TorusGeometry(0.27, 0.035, 6, 24), goldGlow, kx, ky + 0.06, 0.04, false);
    rim.name = 'rim';
    add(new THREE.SphereGeometry(0.06, 8, 6), goldGlow, kx, ky + 0.4, 0.02);
    for (let h = 0; h < 12; h++) {
      const a = (h / 12) * Math.PI * 2, tk = add(new THREE.BoxGeometry(0.025, h % 3 ? 0.04 : 0.07, 0.02), ironM, kx + Math.sin(a) * 0.2, ky + 0.06 + Math.cos(a) * 0.2, 0.06, false);
      tk.rotation.z = -a;
    }
    // both hands straight up: midnight
    add(new THREE.BoxGeometry(0.035, 0.2, 0.02), ironM, kx, ky + 0.06 + 0.09, 0.075, false);
    add(new THREE.BoxGeometry(0.045, 0.13, 0.02), ironM, kx, ky + 0.06 + 0.055, 0.085, false);
    mergeStatic(parts);
    // marquee bulbs round the backboard
    const pts = [];
    const bx0 = shift - span / 2 - 0.12, bx1 = shift + span / 2 + 0.12, by0 = base + 0.06, by1 = base + H + 0.17;
    for (let x = bx0; x <= bx1 + 1e-6; x += (bx1 - bx0) / 18) pts.push([x, by1, -0.07], [x, by0 - 0.02, 0.27]);
    for (let y = by0 + 0.1; y < by1; y += 0.14) pts.push([bx0, y, -0.07], [bx1, y, -0.07]);
    bigBulbs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.035, 0), bulbMat, pts.length);
    bigBulbs.name = 'Marquee bulbs';
    pts.forEach((p, i) => { bigBulbs.setMatrixAt(i, tmpM.makeTranslation(p[0], p[1], p[2])); bigBulbs.setColorAt(i, tmpC.set(i % 2 ? GOLD : WHITE)); });
    g.add(bigBulbs);
    g.position.set(front[0], hAt(front[0], front[1]), front[1]);
    root.add(g);
    tall.push([front[0] + shift * 0.5, front[1], 1.55, 0.4, g.position.y + 1.9]);
    // keep the grass in front of it clear (the camera looks from +z): nothing else of ours stands there
    for (const dz of [0.75, 1.5]) for (const dx of [-0.9, 0, 0.9]) ctx.take(front[0] + dx, front[1] + dz, 0.45, { block: false });
  }

  // ---------------------------------------------------------------- lantern poles round the farmyard, with paper lanterns strung between them
  const poleSpots = ctx.spots(6, { r: 0.12, from: 1.8, to: 3.0, spacing: 1.4 });
  const POLE = 1.4;
  const poleTops = poleSpots.map(([x, z]) => [x, hAt(x, z) + POLE, z]);
  for (const [x, z] of poleSpots) {
    const g = new THREE.Group();
    g.name = 'Lantern pole';
    const post = mesh(new THREE.CylinderGeometry(0.035, 0.05, POLE, 7), navy, false, false);
    post.position.y = POLE / 2;
    g.add(post);
    for (const y of [0.3, 0.65, 1.0]) { const b = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 7), goldM, false, false); b.position.y = y; g.add(b); }
    const ball = mesh(new THREE.SphereGeometry(0.06, 8, 6), goldM, false, false);
    ball.position.y = POLE + 0.02;
    g.add(ball);
    mergeStatic(g);
    g.position.set(x, hAt(x, z), z);
    root.add(g);
    stars.push([x, hAt(x, z) + POLE + 0.2, z, 0, 0.13, GOLD]);
  }
  {
    const [hx, hz] = ctx.home;
    const order = poleTops.map((p) => ({ p, a: Math.atan2(p[2] - hz, p[0] - hx) })).sort((a, b) => a.a - b.a);
    const LCOL = [GOLD, WHITE, MAGENTA, ICE, GOLD, SILVER];
    for (let i = 0; i < order.length && order.length > 1; i++) {
      const a = order[i].p, b = order[(i + 1) % order.length].p;
      if (order.length === 2 && i === 1) break;
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) > 3.8 || !clearOfBuildings(a, b)) continue;
      strand([a, b], { colors: LCOL, spacing: 0.36, sag: 0.24, out: lanterns, drop: 0.13 });
    }
  }

  // ---------------------------------------------------------------- lights between the lamp posts, and a star on every lamp
  {
    const tops = ctx.lamps.map((l) => {
      const [x, z] = l.at;
      const rec = ctx.props.find((p) => p.key === 'lampPost' && Math.hypot(p.x - x, p.z - z) < 0.05);
      return [x, hAt(x, z) + (rec ? rec.height * 0.97 : 1.55 * sc), z];
    });
    const done = new Set();
    tops.forEach((a, i) => {
      stars.push([a[0], a[1] + 0.24, a[2], 0, 0.2, i % 2 ? SILVER : GOLD]);
      // tinsel wound round the post, and a bunch of balloons tied at the top
      const y0 = hAt(a[0], a[2]) + 0.1, y1 = a[1] - 0.12, turns = 4, path = [];
      for (let j = 0; j <= 48; j++) { const t = j / 48, an = t * turns * Math.PI * 2; path.push([a[0] + Math.cos(an) * 0.07, y0 + (y1 - y0) * t, a[2] + Math.sin(an) * 0.07]); }
      swag(path, { sag: 0, color: i % 2 ? MAGENTA : GOLD, sub: 1 });
      for (let j = 0; j < 3; j++) {
        const an = (j / 3) * Math.PI * 2 + i;
        partyBalloons.push({ ax: a[0], ay: a[1] - 0.1, az: a[2], ox: Math.cos(an) * 0.2, oy: 0.66 + (j % 2) * 0.1, oz: Math.sin(an) * 0.2, ph: i * 2.1 + j * 1.3, c: [GOLD, SILVER, MAGENTA][(i + j) % 3] });
      }
      tops.map((b, j) => ({ j, d: Math.hypot(b[0] - a[0], b[2] - a[2]) })).filter((o) => o.j !== i && o.d < 3.4).sort((p, q) => p.d - q.d).slice(0, 2).forEach(({ j }) => {
        const key = Math.min(i, j) + ':' + Math.max(i, j);
        if (done.has(key) || !clearOfBuildings(a, tops[j])) return;
        done.add(key);
        strand([a, tops[j]], { sag: 0.2, spacing: 0.14 });
      });
    });
  }

  // ---------------------------------------------------------------- the fences: lights scalloped along every top rail, gold stars on top
  const gates = ctx.fields.map((f) => f.gate).filter(Boolean);
  for (const field of ctx.fields) {
    const line = ctx.fenceLine(field, { outset: 0.06, step: 0.5, lift: 0.02 });
    if (line.length < 2) continue;
    // split the ring at the gate so nothing hangs across the opening (the sheep walk through it)
    const atGate = (p) => gates.some((g) => Math.hypot(g.x - p[0], g.z - p[2]) < 0.4);
    const runs = [[]];
    for (const p of line) { if (atGate(p)) { if (runs[runs.length - 1].length) runs.push([]); } else runs[runs.length - 1].push(p); }
    if (runs.length > 1 && !atGate(line[0]) && !atGate(line[line.length - 1])) runs[0] = [...runs.pop(), ...runs[0].slice(1)];
    const [cx, cz] = field.center;
    for (const run of runs) {
      if (run.length < 2) continue;
      strand(run, { sag: 0.03, spacing: 0.12 });
      // gold tinsel swags hanging down the fence face, a little outside the rail
      swag(run.map(([x, y, z]) => { const d = Math.hypot(x - cx, z - cz) || 1; return [x + ((x - cx) / d) * 0.04, y - 0.03, z + ((z - cz) / d) * 0.04]; }), { sag: 0.13, color: GOLD });
    }
    line.forEach(([x, y, z], i) => {
      if (i % 3 || i === line.length - 1) return;
      if (gates.some((g) => Math.hypot(g.x - x, g.z - z) < 0.6)) return;
      stars.push([x, y + 0.2, z, Math.atan2(x - cx, z - cz), 0.17, i % 2 ? SILVER : GOLD]);
    });
  }

  // ---------------------------------------------------------------- the buildings: roofline lights, streamers down the front, a star on top
  const STREAM = [MAGENTA, GOLD, SILVER, ICE, GOLD, MAGENTA, SILVER];
  for (const b of ctx.buildings) {
    const d = buildingDress(b);
    for (const ln of d.lines) strand(ln.map(([x, y, z]) => local(b, x, y, z)), { sag: 0.02, spacing: 0.13 });
    const s = b.scale || sc;
    if (d.front) {
      // a fringe of foil streamers all along the front eave (never longer than the drop to the ground)
      const [x0, x1, y, z] = d.front, n = Math.max(4, Math.round(((x1 - x0) * s) / 0.12));
      const maxLen = y * s * 0.8;
      for (let i = 0; i <= n; i++) {
        const p = local(b, x0 + ((x1 - x0) * i) / n, y, z);
        streamers.push([p[0], p[1], p[2], b.ry || 0, Math.min(maxLen, (0.42 + ((i * 37) % 5) * 0.06) * Math.min(1.2, s / 0.75)), STREAM[i % STREAM.length]]);
      }
    } else if (d.round) {
      const [r, y] = d.round;
      for (let i = 0; i <= 12; i++) {
        const a = -1.3 + (i / 12) * 2.6, p = local(b, Math.sin(a) * (r + 0.03), y, Math.cos(a) * (r + 0.03));
        streamers.push([p[0], p[1], p[2], (b.ry || 0) + a, 0.5 + (i % 3) * 0.07, STREAM[i % STREAM.length]]);
      }
    }
    for (const [x, y, z, size] of d.stars) { const p = local(b, x, y, z); stars.push([p[0], p[1], p[2], b.ry || 0, size * 1.35 * Math.max(1, s / 0.75), GOLD]); }
    // a bunch of balloons tied at each front corner (the barn's front has decor.js's tree and wreath)
    if (b.key !== 'barn') {
      const R = b.r / s;
      const corners = d.front ? [[d.front[0] - 0.12, d.front[3] + 0.3], [d.front[1] + 0.12, d.front[3] + 0.3]] : [[-Math.sin(0.75) * (R + 0.15), Math.cos(0.75) * (R + 0.15)], [Math.sin(0.75) * (R + 0.15), Math.cos(0.75) * (R + 0.15)]];
      corners.forEach(([lx, lz], ci) => {
        const p = local(b, lx, 0, lz);
        if (inAField(p[0], p[2], 0.25) || ctx.buildings.some((o) => o !== b && Math.hypot(o.x - p[0], o.z - p[2]) < o.r + 0.2)) return;
        const gy = hAt(p[0], p[2]);
        ctx.take(p[0], p[2], 0.18, { block: false });
        for (let j = 0; j < 5; j++) {
          const an = (j / 5) * Math.PI * 2 + ci * 1.3 + b.x, rr = j ? 0.14 : 0;
          partyBalloons.push({ ax: p[0], ay: gy + 0.04, az: p[2], ox: Math.cos(an) * rr, oy: j ? 0.95 + (j % 3) * 0.09 : 1.22, oz: Math.sin(an) * rr, ph: j * 1.7 + ci * 2 + b.z, c: BCOL_ALL[(j + ci * 2) % BCOL_ALL.length] });
        }
      });
    }
  }

  // ---------------------------------------------------------------- the trees: a spiral garland of stars and lights, a star on top
  for (const t of ctx.trees) {
    const s = t.scale || sc, hr = t.height / s;
    // the canopy's radius at height y (world units above the ground), by the kind of tree
    let y0, y1, rad;
    if (t.key === 'pine') { const u = t.height / 2.165; y0 = 0.45 * u; y1 = 1.85 * u; rad = (y) => 0.62 * u * (1 - (y - 0.3 * u) / (1.75 * u)) + 0.04; }
    else if (hr > 2.2) { const u = t.height / 3.2; y0 = 1.2 * u; y1 = 2.9 * u; rad = (y) => 0.42 * u * Math.sqrt(Math.max(0.05, 1 - ((y - 2.0 * u) / (1.1 * u)) ** 2)) + 0.05; }
    else { const u = t.height / 1.8; y0 = 0.62 * u; y1 = 1.62 * u; rad = (y) => 0.64 * u * Math.sqrt(Math.max(0.08, 1 - ((y - 1.08 * u) / (0.72 * u)) ** 2)) + 0.04; }
    const turns = 2.5, n = 44, path = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, y = y0 + (y1 - y0) * f, a = f * turns * Math.PI * 2 + t.x, r = rad(y);
      path.push([t.x + Math.cos(a) * r, t.y + y, t.z + Math.sin(a) * r]);
      if (i % 4 === 2) stars.push([t.x + Math.cos(a) * (r + 0.03), t.y + y, t.z + Math.sin(a) * (r + 0.03), Math.atan2(Math.cos(a), Math.sin(a)), 0.12, (i / 4) % 2 < 1 ? GOLD : SILVER]);
    }
    strand(path, { sag: 0, spacing: 0.11, colors: [GOLD, WHITE] });
    // tinsel wound the other way round, half a turn out of step with the lights
    const tpath = [];
    for (let i = 0; i <= n; i++) { const f = i / n, y = y0 + (y1 - y0) * (0.04 + 0.92 * f), a = f * turns * Math.PI * 2 + t.x + Math.PI, r = rad(y) + 0.02; tpath.push([t.x + Math.cos(a) * r, t.y + y, t.z + Math.sin(a) * r]); }
    swag(tpath, { sag: 0, color: t.key === 'pine' ? SILVER : GOLD, sub: 1 });
    stars.push([t.x, t.y + t.height + 0.18, t.z, 0, 0.26, GOLD]);
  }

  // ---------------------------------------------------------------- balloon bunches at every gate, either side of the opening
  const bunches = [];
  const BCOL = [GOLD, SILVER, WHITE, MAGENTA, GOLD, SILVER];
  const balloonGeo = new THREE.SphereGeometry(0.14, 12, 9);
  ctx.fields.forEach((field, fi) => {
    const gt = field.gate;
    if (!gt) return;
    const nx = gt.nx, nz = gt.nz, tx = -nz, tz = nx;
    const gx = gt.x + nx * 0.26, gz = gt.z + nz * 0.26;
    const g = new THREE.Group();
    g.name = 'Gate balloons';
    g.userData.onFence = true;
    g.position.set(gx, hAt(gx, gz), gz);
    const list = [];
    for (const side of [-1, 1]) {
      const ax = tx * side * 0.46, az = tz * side * 0.46;
      ctx.take(gx + ax, gz + az, 0.14);
      for (let j = 0; j < 7; j++) {
        const a = (j / 6) * Math.PI * 2 + fi + side, rr = j === 0 ? 0 : 0.15 + (j % 2) * 0.05;
        list.push({ ax, az, ox: j === 0 ? 0 : Math.cos(a) * rr, oz: j === 0 ? 0 : Math.sin(a) * rr, oy: j === 0 ? 1.3 : 0.9 + ((j * 7) % 4) * 0.08, ph: j * 1.7 + side + fi, c: BCOL[(j + (side > 0 ? 3 : 0)) % BCOL.length] });
      }
    }
    const im = new THREE.InstancedMesh(balloonGeo, balloonMat, list.length + 2);
    im.name = 'Balloons';
    for (let i = 0; i < list.length; i++) im.setColorAt(i, tmpC.set(list[i].c));
    // the two weights: silver balloons squashed flat on the ground
    [-1, 1].forEach((side, k) => {
      im.setMatrixAt(list.length + k, tmpM.compose(tmpV.set(tx * side * 0.46, 0.03, tz * side * 0.46), tmpQ.identity(), tmpS.set(0.4, 0.28, 0.4)));
      im.setColorAt(list.length + k, tmpC.set(SILVER));
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list.length * 6), 3));
    const strings = new THREE.LineSegments(lineGeo, wireMat);
    strings.frustumCulled = false;
    g.add(im, strings);
    root.add(g);
    bunches.push({ im, list, pos: lineGeo.attributes.position });
  });
  // (the island-wide bunches at the lamps and buildings are tied at their own spots, in island space;
  // none near the year sign, so it reads clearly)
  for (let i = partyBalloons.length - 1; i >= 0; i--) {
    if (Math.hypot(partyBalloons[i].ax - front[0], partyBalloons[i].az - front[1]) < 2.0) partyBalloons.splice(i, 1);
  }
  const partyIM = new THREE.InstancedMesh(balloonGeo, balloonMat, Math.max(1, partyBalloons.length));
  partyIM.name = 'Party balloons';
  partyIM.count = partyBalloons.length;
  for (let i = 0; i < partyBalloons.length; i++) { const b = partyBalloons[i]; partyIM.setColorAt(i, tmpC.set(b.c)); b.ox += b.ax; b.oz += b.az; b.oy += b.ay; }
  const partyGeo = new THREE.BufferGeometry();
  partyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, partyBalloons.length) * 6), 3));
  const partyStrings = new THREE.LineSegments(partyGeo, wireMat);
  partyStrings.name = 'Party balloon strings';
  bunches.push({ im: partyIM, list: partyBalloons, pos: partyGeo.attributes.position, island: true });
  function bob(time, k) {
    for (const { im, list, pos, island } of bunches) {
      const s = island ? k : 1; // the island-wide ones grow in with the theme (the gate ones pop in)
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const x = b.ax + (b.ox - b.ax) * s + Math.sin(time * 1.1 + b.ph) * 0.03;
        const z = b.az + (b.oz - b.az) * s + Math.cos(time * 0.9 + b.ph) * 0.03;
        const ty = island ? b.ay + (b.oy - b.ay) * s : b.oy;
        const y = ty + Math.sin(time * 1.6 + b.ph) * 0.035;
        im.setMatrixAt(i, tmpM.compose(tmpV.set(x, y, z), tmpQ.identity(), tmpS.set(s, 1.2 * s, s)));
        pos.setXYZ(i * 2, b.ax, island ? b.ay : 0.06, b.az);
        pos.setXYZ(i * 2 + 1, x, y - 0.16 * s, z);
      }
      im.instanceMatrix.needsUpdate = true;
      pos.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- sparkler fountains round the farmyard and along the paths
  const fountains = [];
  const SPARKS = 48;
  const sparkGeo = new THREE.OctahedronGeometry(1, 0);
  const tubeGeo = new THREE.CylinderGeometry(0.09, 0.13, 0.26, 8);
  const fountainSpots = [...ctx.spots(6, { r: 0.2, from: 1.6, to: 3.4, spacing: 1.1 }), ...ctx.pathSpots(8, { r: 0.15, spacing: 1.5 })];
  fountainSpots.forEach(([x, z], fi) => {
    const g = new THREE.Group();
    g.name = 'Sparkler fountain';
    const tube = mesh(tubeGeo, fi % 2 ? silverM : goldM, false, false);
    tube.position.y = 0.13;
    const im = new THREE.InstancedMesh(sparkGeo, sparkMat, SPARKS + 1);
    im.name = 'Sparks';
    im.frustumCulled = false;
    const sp = [];
    for (let j = 0; j < SPARKS; j++) {
      const h = Math.sin(j * 12.9898 + fi * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      sp.push({ a: j * 2.399 + fi, h: 0.25 + r * 0.4, vy: 2.7 + ((j * 0.37) % 0.9), ph: (j / SPARKS + r * 0.3) % 1 });
      im.setColorAt(j, tmpC.set(j % 7 === 0 ? (fi % 2 ? ICE : MAGENTA) : j % 3 ? 0xffd86a : WHITE));
    }
    im.setColorAt(SPARKS, tmpC.set(WHITE));
    g.add(tube, im);
    g.position.set(x, hAt(x, z), z);
    root.add(g);
    fountains.push({ im, sp, off: fi * 0.37 });
  });
  function spurt(time) {
    for (const { im, sp, off } of fountains) {
      for (let j = 0; j < SPARKS; j++) {
        const p = sp[j], T = ((time + off) * 0.95 + p.ph) % 1;
        const y = 0.26 + p.vy * T - 3.4 * T * T;
        const s = y < 0.03 ? 0 : 0.055 * (1 - 0.6 * T);
        tmpM.makeScale(s, s, s);
        tmpM.setPosition(Math.cos(p.a) * p.h * T, y, Math.sin(p.a) * p.h * T);
        im.setMatrixAt(j, tmpM);
      }
      const c = 0.09 + Math.sin(time * 23 + off * 9) * 0.02;
      tmpM.makeScale(c, c * 1.3, c);
      tmpM.setPosition(0, 0.3, 0);
      im.setMatrixAt(SPARKS, tmpM);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- disco balls on posts, spinning
  const discos = [];
  const BALL_R = 0.3;
  const ballGeo = new THREE.IcosahedronGeometry(BALL_R, 1);
  {
    const col = new Float32Array(ballGeo.attributes.position.count * 3);
    for (let f = 0; f < col.length / 9; f++) {
      const h = Math.sin(f * 91.7) * 1000, r = h - Math.floor(h);
      tmpC.set(r > 0.82 ? 0xffffff : r > 0.55 ? 0xd4dbe8 : r > 0.3 ? 0xa9b3c6 : r > 0.12 ? 0x7d879c : 0xe9a6dc);
      for (let v = 0; v < 3; v++) { col[f * 9 + v * 3] = tmpC.r; col[f * 9 + v * 3 + 1] = tmpC.g; col[f * 9 + v * 3 + 2] = tmpC.b; }
    }
    ballGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const mirrorMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.55, flatShading: true, emissive: 0x3a3550 }));
  mirrorMat.userData.noSeason = true;
  const glintGeo = new THREE.OctahedronGeometry(1, 0);
  const GLINTS = 14;
  ctx.spots(4, { r: 0.32, from: 2.2, to: 6.4, spacing: 2.4 }).forEach(([x, z], di) => {
    const g = new THREE.Group();
    g.name = 'Disco ball';
    const stand = new THREE.Group();
    const foot = mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.08, 8), navy, false, false);
    foot.position.y = 0.04;
    const post = mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 7), silverM, false, false);
    post.position.y = 0.65;
    const arm = mesh(new THREE.BoxGeometry(0.035, 0.14, 0.035), silverM, false, false);
    arm.position.y = 1.36;
    stand.add(foot, post, arm);
    mergeStatic(stand);
    const ball = mesh(ballGeo, mirrorMat, false, false);
    ball.position.y = 1.42 + BALL_R;
    const gl = new THREE.InstancedMesh(glintGeo, starMat, GLINTS);
    gl.name = 'Glints';
    const dirs = [];
    for (let j = 0; j < GLINTS; j++) {
      const a = j * 2.4, e = Math.sin(j * 1.9) * 0.9, R = BALL_R + 0.005;
      dirs.push([Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R]);
      gl.setColorAt(j, tmpC.set(j % 3 ? WHITE : j % 2 ? ICE : MAGENTA));
    }
    ball.add(gl);
    g.add(stand, ball);
    g.position.set(x, hAt(x, z), z);
    root.add(g);
    discos.push({ ball, gl, dirs, off: di * 1.3 });
  });

  // ---------------------------------------------------------------- star stakes over the open grass and along the paths
  const stakeSpots = [...ctx.pathSpots(10, { r: 0.1, spacing: 1.2 }), ...ctx.spots(26, { r: 0.12, from: 3.0, to: 7.5, spacing: 1.15 })];
  const stakes = [];
  let stakeIM = null;
  if (stakeSpots.length) {
    const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.035, 0.9, 5), silverM, stakeSpots.length);
    im.name = 'Star stakes';
    stakeSpots.forEach(([x, z], i) => {
      const y = hAt(x, z);
      stakes.push([x, y, z]);
      stars.push([x, y + 1.08, z, (i * 0.7) % 1.2 - 0.6, 0.25, i % 3 === 2 ? SILVER : i % 3 ? MAGENTA : GOLD]);
    });
    stakeIM = im;
  }

  // ---------------------------------------------------------------- gold tinsel: the fence swags, round the trees and lamp posts (one mesh)
  const tinselMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.5, flatShading: true, emissive: GOLD_DEEP, emissiveIntensity: 0.2, transparent: true }));
  tinselMat.userData.noSeason = true;
  const tinselGroup = new THREE.Group();
  tinselGroup.name = 'Tinsel';
  {
    const tubes = [];
    for (const { pts, color } of tinsel) {
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(2, pts.length - 1), 0.03, 4, false);
      tmpC.set(color);
      const n = geo.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      tubes.push(geo);
      tinselGroup.add(new THREE.Mesh(geo, tinselMat));
    }
    mergeStatic(tinselGroup);
    const used = new Set();
    tinselGroup.traverse((o) => { if (o.geometry) used.add(o.geometry); });
    for (const geo of tubes) if (!used.has(geo)) geo.dispose(); // the parts the merge copied
    tinselGroup.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = false; o.frustumCulled = false; } });
  }

  // ---------------------------------------------------------------- the island-wide instanced meshes
  const bulbIM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.05, 0), bulbMat, Math.max(1, bulbs.length));
  bulbIM.name = 'Gold and silver lights';
  bulbIM.count = bulbs.length;
  const bulbBase = bulbs.map((b) => new THREE.Color(b[3]));
  const bulbPhase = new Float32Array(bulbs.length);
  for (let i = 0; i < bulbs.length; i++) { bulbIM.setColorAt(i, bulbBase[i]); bulbPhase[i] = (i * 2.399) % 6.283; }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wire.flat()), 3));
  const wires = new THREE.LineSegments(wireGeo, wireMat);
  wires.name = 'Light wires';

  const starIM = new THREE.InstancedMesh(starGeometry(), starMat, Math.max(1, stars.length));
  starIM.name = 'Stars';
  starIM.count = stars.length;
  for (let i = 0; i < stars.length; i++) starIM.setColorAt(i, tmpC.set(stars[i][5]));

  // the things that stand still: grown in with the theme (k), so they don't just appear
  function placeStatic(k) {
    for (let i = 0; i < bulbs.length; i++) { const b = bulbs[i]; bulbIM.setMatrixAt(i, tmpM.compose(tmpV.set(b[0], b[1], b[2]), tmpQ.identity(), tmpS.setScalar(k))); }
    bulbIM.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < stars.length; i++) {
      const [x, y, z, yaw, s] = stars[i];
      starIM.setMatrixAt(i, tmpM.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(0, yaw, 0)), tmpS.setScalar(s * k)));
    }
    starIM.instanceMatrix.needsUpdate = true;
    if (stakeIM) {
      for (let i = 0; i < stakes.length; i++) { const [x, y, z] = stakes[i]; stakeIM.setMatrixAt(i, tmpM.compose(tmpV.set(x, y + 0.45 * k, z), tmpQ.identity(), tmpS.set(1, k, 1))); }
      stakeIM.instanceMatrix.needsUpdate = true;
    }
    tinselMat.opacity = k;
    wireMat.opacity = k;
  }
  wireMat.transparent = true;

  const streamIM = new THREE.InstancedMesh(streamerGeometry(), foilMat, Math.max(1, streamers.length));
  streamIM.name = 'Streamers';
  streamIM.count = streamers.length;
  for (let i = 0; i < streamers.length; i++) streamIM.setColorAt(i, tmpC.set(streamers[i][5]));
  function sway(time, k) {
    for (let i = 0; i < streamers.length; i++) {
      const s = streamers[i];
      streamIM.setMatrixAt(i, tmpM.compose(tmpV.set(s[0], s[1], s[2]), tmpQ.setFromEuler(tmpE.set(Math.sin(time * 1.7 + i * 1.3) * 0.18, s[3] + time * 0.6 + i, 0)), tmpS.set(0.12, s[4] * k, 0.12)));
    }
    streamIM.instanceMatrix.needsUpdate = true;
  }

  const lanternIM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 7), lanternMat, Math.max(1, lanterns.length));
  lanternIM.name = 'Paper lanterns';
  lanternIM.count = lanterns.length;
  for (let i = 0; i < lanterns.length; i++) lanternIM.setColorAt(i, tmpC.set(lanterns[i][3]));
  function swing(time, k) {
    for (let i = 0; i < lanterns.length; i++) {
      const l = lanterns[i];
      tmpM.makeScale(0.15 * k, 0.125 * k, 0.15 * k);
      tmpM.setPosition(l[0] + Math.sin(time * 1.3 + i) * 0.015, l[1] + Math.sin(time * 1.9 + i * 0.7) * 0.012, l[2]);
      lanternIM.setMatrixAt(i, tmpM);
    }
    lanternIM.instanceMatrix.needsUpdate = true;
  }
  for (const o of [bulbIM, wires, starIM, streamIM, lanternIM, tinselGroup, partyIM, partyStrings, stakeIM]) {
    if (!o) continue;
    o.userData.noPop = true;
    o.userData.onFence = true;
    o.userData.onBuilding = true;
    o.frustumCulled = false;
    root.add(o);
  }

  // ---------------------------------------------------------------- every frame
  let lastNight = -1, lastK = -1;
  function update(dt, time, { night = 0, k = 1 } = {}) {
    if (k <= 0) return;
    const glowK = (0.85 + 0.35 * night) * k;
    if (night !== lastNight || k !== lastK) {
      if (k !== lastK) placeStatic(k);
      lastNight = night; lastK = k;
      lanternMat.color.setScalar(glowK);
      sparkMat.color.setScalar(Math.min(1.25, glowK + 0.2));
      faceMat.color.set(0xfdf6e3).multiplyScalar(0.85 + 0.25 * night);
      goldGlow.emissiveIntensity = 0.35 + 1.2 * night;
      tinselMat.emissiveIntensity = 0.2 + 0.7 * night;
      mirrorMat.emissiveIntensity = 0.6 + 1.4 * night;
      gemMat.color.set(MAGENTA).multiplyScalar(0.85 + 0.35 * night);
    }
    // twinkle: the lights chase, the stars shimmer
    bulbMat.color.setScalar(glowK);
    for (let i = 0; i < bulbs.length; i++) bulbIM.setColorAt(i, tmpC.copy(bulbBase[i]).multiplyScalar(0.7 + 0.3 * Math.max(0, Math.sin(time * 2.8 + bulbPhase[i]))));
    if (bulbs.length) bulbIM.instanceColor.needsUpdate = true;
    starMat.color.setScalar((0.9 + 0.12 * Math.sin(time * 3.1) + 0.25 * night) * k);
    if (bigBulbs) {
      for (let i = 0; i < bigBulbs.count; i++) bigBulbs.setColorAt(i, tmpC.set((i + Math.floor(time * 4)) % 3 ? GOLD : WHITE));
      bigBulbs.instanceColor.needsUpdate = true;
    }
    bob(time, k);
    spurt(time);
    sway(time, k);
    swing(time, k);
    for (const d of discos) {
      d.ball.rotation.y = time * 0.9 + d.off;
      for (let j = 0; j < d.dirs.length; j++) {
        const p = d.dirs[j];
        const s = 0.016 + 0.04 * Math.max(0, Math.sin(time * 5 + j * 2.1 + d.off));
        tmpM.makeScale(s, s * 1.6, s);
        tmpM.setPosition(p[0], p[1], p[2]);
        d.gl.setMatrixAt(j, tmpM);
      }
      d.gl.instanceMatrix.needsUpdate = true;
    }
  }
  update(0, 0, { night: 0, k: 1 });

  // ---------------------------------------------------------------- the sheep's party costumes: hats and tiaras
  const HAT_H = 0.27;
  const hatGeo = new THREE.ConeGeometry(0.082, HAT_H, 12, 5);
  hatGeo.translate(0, HAT_H / 2, 0);
  const stripedGeo = hatGeo.toNonIndexed();
  {
    const p = stripedGeo.attributes.position, col = new Float32Array(p.count * 3);
    const band = [new THREE.Color(MAGENTA), new THREE.Color(WHITE), new THREE.Color(GOLD)];
    for (let f = 0; f < p.count / 3; f++) {
      const y = (p.getY(f * 3) + p.getY(f * 3 + 1) + p.getY(f * 3 + 2)) / 3, c = band[Math.max(0, Math.floor(y / 0.054)) % 3];
      for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], (f * 3 + v) * 3);
    }
    stripedGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const stripedMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, flatShading: true }));
  const hatGold = keep(new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 0.5, flatShading: true }));
  const hatSilver = keep(new THREE.MeshStandardMaterial({ color: 0xd5dce8, roughness: 0.28, metalness: 0.55, flatShading: true }));
  for (const m of [stripedMat, hatGold, hatSilver]) m.userData.noSeason = true;
  const pomGeo = new THREE.IcosahedronGeometry(0.046, 1);
  const trimGeo = new THREE.TorusGeometry(0.08, 0.019, 6, 14);
  trimGeo.rotateX(Math.PI / 2);
  const pomWhite = mat(WHITE, { roughness: 1 }), pomMagenta = mat(MAGENTA, { roughness: 1 }), pomGold = mat(GOLD, { roughness: 1 });
  // the tiara: a gold band arching over the front of the head with five points, gems glowing
  const tiaraGeo = (() => {
    const g = new THREE.Group();
    // (the half ring turned flat runs from +x round the front, +z, to -x)
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 5, 16, Math.PI), hatGold);
    band.rotation.x = Math.PI / 2;
    g.add(band);
    for (let j = 0; j < 7; j++) {
      const a = Math.PI * (0.1 + (0.8 * j) / 6), h = j === 3 ? 0.15 : j % 2 ? 0.08 : 0.11;
      const pt = new THREE.Mesh(new THREE.ConeGeometry(0.022, h, 4), hatGold);
      pt.position.set(Math.cos(a) * 0.1, h / 2, Math.sin(a) * 0.1);
      g.add(pt);
    }
    g.updateMatrixWorld(true);
    mergeStatic(g);
    const geo = g.children[0].geometry;
    g.children.forEach((c) => c !== g.children[0] && c.geometry.dispose());
    return geo;
  })();
  const gemGeo = new THREE.OctahedronGeometry(0.032, 0);
  const costumeGeos = [hatGeo, stripedGeo, pomGeo, trimGeo, tiaraGeo, gemGeo];

  function sheepWear(i) {
    const g = new THREE.Group();
    g.name = 'Party costume';
    const kind = i % 4;
    if (kind === 1) {
      // a sparkly tiara
      const tiara = mesh(tiaraGeo, hatGold, false, false);
      tiara.position.set(0, -0.012, 0.01);
      g.add(tiara);
      const gems = [];
      [[0, 0.175, 0.1, starMat], [-0.068, 0.012, 0.094, gemMat], [0.068, 0.012, 0.094, gemMat], [0, 0.012, 0.12, gemMat]].forEach(([x, y, z, m]) => {
        const gm = mesh(gemGeo, m, false, false);
        gm.position.set(x, y, z);
        g.add(gm);
        gems.push(gm);
      });
      g.userData.update = (time) => { gems.forEach((gm, j) => { gm.rotation.y = time * 2 + j; }); };
    } else {
      // a cone party hat, tipped to one side, with a trim and a pom-pom
      const [geo, m, pm] = kind === 0 ? [hatGeo, hatGold, pomWhite] : kind === 2 ? [hatGeo, hatSilver, pomMagenta] : [stripedGeo, stripedMat, pomGold];
      const hat = new THREE.Group();
      hat.rotation.z = (i % 2 ? -1 : 1) * 0.2;
      hat.position.set(0, -0.01, 0.01);
      const cone = mesh(geo, m, false, false);
      const trim = mesh(trimGeo, pomWhite, false, false);
      trim.position.y = 0.01;
      const pom = mesh(pomGeo, pm, false, false);
      pom.position.y = HAT_H + 0.01;
      hat.add(cone, trim, pom);
      g.add(hat);
      const tilt = hat.rotation.z, ph = i * 1.37;
      g.userData.update = (time) => { hat.rotation.z = tilt + Math.sin(time * 2.2 + ph) * 0.06; pom.position.y = HAT_H + 0.01 + Math.abs(Math.sin(time * 3 + ph)) * 0.012; };
    }
    return g;
  }

  function dispose() {
    const geos = new Set(costumeGeos);
    root.traverse((o) => { if (o.geometry) geos.add(o.geometry); });
    geos.forEach((g) => g.dispose());
    own.forEach((m) => m.dispose());
    root.clear();
  }

  /** The farm year on show: the sign shows the New Year it's heading into (the year after). */
  const setYear = (y) => { if (Number.isFinite(y)) showYear?.(y + 1); };

  return { root, update, setYear, lampColors: [0xffd36b, 0xeef2ff], sheepWear, dispose };
}
