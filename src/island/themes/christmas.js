// The Christmas theme: the whole farm dressed for Christmas (see ./index.js for the contract).
//
//   everywhere   multicoloured string lights along every fence, round every building's roofline,
//                spiralled round every tree and lamp post, and arched over every gate; a green
//                garland with red bows and baubles along the fences and across every building front
//   fences       giant candy canes standing along every fence, bows at every corner
//   trees        big shiny baubles all over the crown and a gold star on top of each
//   lamps        a big wreath with a red bow on every post
//   windmill, silo   a giant glowing gold star on top
//   gates        a pile of presents beside each
//   paths        giant candy canes lining them
//   open grass   clusters of giant shiny baubles, a family of snowmen, more presents
//   farmyard     a gingerbread house (the centrepiece) and Santa's sleigh full of presents, pulled by
//                three reindeer (the lead one with a glowing red nose)
//   sheep        Santa hats and reindeer antlers with a red nose, in turn
//
// Most things are baked into one vertex-coloured mesh each (one draw call), and everything repeated
// island-wide (bulbs, garland, bows, ornaments, fence canes, tree stars) is one InstancedMesh per kind.
import * as THREE from 'three';
import { mat, mesh, soft } from '../props.js';
import { makeSnowman } from '../decor.js';

const RED = 0xd42a2a, GREEN = 0x2f8a3e, GOLD = 0xf2b632, WHITE = 0xf7f4ee;
const BULBS = [0xff3b30, 0x34d058, 0xffcc33, 0x3d8bff, 0xfff4d6, 0xff4fa3];
const TREE_BAUBLES = [0xe0242c, 0xf2b632, 0x2f6fe0, 0xe8e8f0, 0xb03ad0, 0xe0242c, 0xf2b632];
const TAU = Math.PI * 2;

/** An unlit glowing material (bulbs, stars, windows): never snowed on. */
function glow(color) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.userData.noSeason = true;
  return m;
}

/** Adds a part (a mesh with its own colour) to a group; bake() reads the colour back. */
function part(g, geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const o = new THREE.Mesh(geo, mat(color));
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.scale.set(sx, sy, sz);
  g.add(o);
  return o;
}

/**
 * Merges every mesh under `obj` into one mesh with the parts' colours as vertex colours (one draw
 * call). recolor: { fromHex: toHex } to swap colours on the way.
 */
const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _c = new THREE.Color();
function bake(obj, material, { recolor, name } = {}) {
  // (relative to the object's parent, so its own position, turn and scale are kept)
  obj.updateMatrixWorld(true);
  if (obj.parent) _inv.copy(obj.parent.matrixWorld).invert(); else _inv.identity();
  const pos = [], nor = [], col = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(_m.multiplyMatrices(_inv, o.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    const hex = o.material.color.getHex();
    if (recolor && recolor[hex] != null) _c.setHex(recolor[hex]); else _c.copy(o.material.color);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) col.push(_c.r, _c.g, _c.b);
    g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, material);
  m.name = name || obj.name || 'Baked';
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Plain geometries merged into one (positions and normals), for instancing. */
function mergeGeos(geos) {
  const g = new THREE.Group();
  for (const geo of geos) g.add(new THREE.Mesh(geo, mat(0xffffff)));
  const m = bake(g, null);
  m.geometry.deleteAttribute('color');
  return m.geometry;
}

/** A five-pointed star, flat in x-y, extruded a little. */
function starGeometry(outer, inner, depth) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer, a = (i / 10) * TAU + Math.PI / 2;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.4, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A ribbon bow (two loops, a knot, two tails), about 0.16 across, facing +z. */
function bowGeometry() {
  const parts = [];
  for (const s of [-1, 1]) {
    const loop = new THREE.TorusGeometry(0.045, 0.018, 4, 8);
    loop.scale(1.25, 0.8, 0.7);
    loop.rotateZ(s * 0.35);
    loop.translate(s * 0.05, 0.01, 0);
    parts.push(loop);
    const tail = new THREE.BoxGeometry(0.03, 0.09, 0.012);
    tail.rotateZ(s * 0.35);
    tail.translate(s * 0.025, -0.05, 0.005);
    parts.push(tail);
  }
  parts.push(new THREE.IcosahedronGeometry(0.026, 0));
  return mergeGeos(parts);
}

/** Points along a polyline every `spacing`, dipping `sag` between its points (swags). */
function sample(points, spacing, sag = 0, out = []) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.round(len / spacing));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/** Is (x, z) inside the ring [[x, z]...]? */
function inRing(x, z, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}

const ring = (cx, y, cz, r, n = 16) => [...Array(n + 1)].map((_, i) => [cx + Math.cos((i / n) * TAU) * r, y, cz + Math.sin((i / n) * TAU) * r]);
const rect = (cx, cz, hx, hz, y) => {
  const Y = typeof y === 'function' ? y : () => y;
  return [[cx - hx, cz + hz], [cx + hx, cz + hz], [cx + hx, cz - hz], [cx - hx, cz - hz], [cx - hx, cz + hz]].map(([x, z]) => [x, Y(z - cz), z]);
};
const spiral = (cx, cz, y0, y1, radius, turns, n = 80, a0 = 0) => [...Array(n + 1)].map((_, i) => {
  const t = i / n, a = a0 + t * turns * TAU, r = radius(t);
  return [cx + Math.cos(a) * r, y0 + (y1 - y0) * t, cz + Math.sin(a) * r];
});

/**
 * Where the lights and the garland go on each kind of building, in its own space at scale 1
 * (front +z). lights: polylines of bulbs; garland: swags { pts, sag }; bows: points.
 * The barn's eaves already carry lights from ../decor.js, so it only gets garlands.
 */
function buildingPlan(p) {
  const R = p.r / (p.scale || 1), H = p.height / (p.scale || 1);
  const swag = (pts, sag = 0.08) => ({ pts, sag });
  switch (p.key) {
    case 'barn': {
      const left = [[-1.32, 1.2, 1.05], [-0.88, 1.2, 1.05], [-0.44, 1.2, 1.05]];
      const right = [[0.44, 1.2, 1.05], [0.88, 1.2, 1.05], [1.32, 1.2, 1.05]];
      return {
        lights: [],
        garland: [swag(left), swag(right), swag([[-0.43, 0.12, 0.87], [-0.43, 1.0, 0.87]], 0), swag([[0.43, 0.12, 0.87], [0.43, 1.0, 0.87]], 0)],
        bows: [...left, ...right, [-0.43, 1.0, 0.9], [0.43, 1.0, 0.9]],
      };
    }
    case 'farmhouse': {
      const porch = [[-0.5, 0.74, 0.85], [0, 0.74, 0.85], [0.5, 0.74, 0.85]];
      return {
        lights: [rect(0, -0.06, 0.73, 0.54, 0.93), ...[-0.73, 0.73].map((x) => [[x, 0.93, -0.6], [x, 1.45, -0.06], [x, 0.93, 0.48]]), [[-0.73, 1.45, -0.06], [0.73, 1.45, -0.06]]],
        garland: [swag(porch, 0.07), swag([[-0.4, 0.15, 0.75], [-0.4, 0.74, 0.75]], 0), swag([[0.4, 0.15, 0.75], [0.4, 0.74, 0.75]], 0)],
        bows: porch,
      };
    }
    case 'machineShed': {
      const header = [[-0.8, 1.0, 0.64], [-0.27, 1.0, 0.64], [0.27, 1.0, 0.64], [0.8, 1.0, 0.64]];
      return { lights: [rect(0, 0, 0.89, 0.69, (z) => 1.05 + 0.12 * z)], garland: [swag(header, 0.07)], bows: header };
    }
    case 'grainBins': {
      const bins = [[-0.5, 0.05, 0.34, 0.95], [0.2, -0.12, 0.38, 1.05], [0.72, 0.25, 0.26, 0.75]];
      return {
        lights: bins.map(([x, z, r, h]) => ring(x, 0.05 + h, z, r + 0.05, 18)),
        garland: bins.map(([x, z, r, h]) => swag(ring(x, 0.05 + h * 0.5, z, r + 0.035, 14), 0.02)),
        bows: bins.map(([x, z, r, h]) => [x, 0.05 + h * 0.5, z + r + 0.06]),
      };
    }
    case 'chickenCoop': {
      const run = [[-0.6, 0.25, 0.75], [-0.15, 0.25, 0.75], [0.3, 0.25, 0.75], [0.7, 0.25, 0.75]];
      return {
        lights: [rect(-0.2, -0.25, 0.31, 0.27, 0.62), ...[-0.51, 0.11].map((x) => [[x, 0.62, -0.52], [x, 0.87, -0.25], [x, 0.62, 0.02]])],
        garland: [swag(run, 0.05)],
        bows: run,
      };
    }
    case 'greenhouse': {
      const wall = [[-0.7, 0.26, 0.54], [0, 0.26, 0.54], [0.7, 0.26, 0.54]];
      const arc = (x) => [...Array(13)].map((_, i) => { const a = (i / 12) * Math.PI; return [x, 0.22 + Math.sin(a) * 0.52, Math.cos(a) * 0.52]; });
      return { lights: [[[-0.72, 0.74, 0], [0.72, 0.74, 0]], arc(-0.72), arc(0.72)], garland: [swag(wall, 0.05)], bows: wall };
    }
    case 'well':
      return {
        lights: [[[-0.22, 0.25, 0.03], [-0.22, 0.8, 0.03], [0.22, 0.8, 0.03], [0.22, 0.25, 0.03]]],
        garland: [swag(ring(0, 0.27, 0, 0.27, 12), 0.02)],
        bows: [[0, 0.27, 0.3]],
      };
    case 'silo':
      return {
        lights: [ring(0, 1.95, 0, 0.56, 20), spiral(0, 0, 0.2, 1.75, () => 0.59, 3, 90)],
        garland: [swag(ring(0, 1.84, 0, 0.56, 16), 0.03)],
        bows: [[0, 1.84, 0.62], [0.44, 1.84, 0.44], [-0.44, 1.84, 0.44]],
      };
    case 'windmill': {
      const door = [[-0.22, 0.06, 0.63], [-0.22, 0.62, 0.61], [0.22, 0.62, 0.61], [0.22, 0.06, 0.63]];
      return {
        lights: [ring(0, 2.06, 0, 0.44, 16), ring(0, 1.0, 0, 0.56, 18), ring(0, 0.08, 0, 0.64, 20)],
        garland: [swag(door, 0)],
        bows: [door[1], door[2]],
      };
    }
    case 'dock': case 'boat': case 'rowboat':
      return { lights: [], garland: [], bows: [] };
    default: {
      const front = [[-R * 0.55, H * 0.4, R * 0.7], [0, H * 0.4, R * 0.7], [R * 0.55, H * 0.4, R * 0.7]];
      return { lights: [rect(0, 0, R * 0.62, R * 0.62, H * 0.55)], garland: [swag(front, 0.07)], bows: front };
    }
  }
}

// ---------------------------------------------------------------- the big pieces

/** A gingerbread house on an icing plate: candy roof, gumdrops, candy-cane corners, lollipops. 1.3 tall. */
function makeGingerbreadHouse(kit) {
  const g = new THREE.Group();
  const lit = new THREE.Group(); // the windows (they glow)
  const ginger = 0xb4692f, gingerDark = 0x8a4a22, icing = 0xfbf8f2;
  const candy = [0xe8323a, 0x38b54a, 0xf6c62e, 0x8a5ad6, 0xff7ab8, 0x3fa0ff];
  part(g, new THREE.CylinderGeometry(0.62, 0.66, 0.05, 20), icing, 0, 0.025, 0);
  part(g, new THREE.BoxGeometry(0.84, 0.5, 0.64), ginger, 0, 0.3, 0);
  part(g, new THREE.BoxGeometry(0.88, 0.04, 0.68), icing, 0, 0.55, 0);
  part(g, new THREE.BoxGeometry(0.88, 0.04, 0.68), icing, 0, 0.07, 0);
  // gables front and back
  const tri = new THREE.Shape();
  tri.moveTo(-0.42, 0); tri.lineTo(0.42, 0); tri.lineTo(0, 0.37); tri.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.04, bevelEnabled: false });
  for (const z of [0.3, -0.34]) part(g, gableGeo, ginger, 0, 0.55, z);
  // roof: two gingerbread slabs with thick white frosting, candy buttons and icing drips
  const a = Math.atan2(0.4, 0.52), slope = Math.hypot(0.4, 0.52);
  for (const s of [-1, 1]) {
    const nx = Math.sin(a) * s, ny = Math.cos(a);
    const cx = s * 0.26, cy = 0.73;
    part(g, new THREE.BoxGeometry(slope + 0.04, 0.06, 0.84), gingerDark, cx, cy, 0, 0, 0, -s * a);
    part(g, new THREE.BoxGeometry(slope - 0.04, 0.04, 0.78), icing, cx + nx * 0.045, cy + ny * 0.045, 0, 0, 0, -s * a);
    for (let row = 0; row < 3; row++) {
      const t = (row + 0.6) / 3.4; // down the slope from the ridge
      const px = s * (0.04 + t * 0.48), py = 0.935 - t * 0.38;
      for (let k = 0; k < 5; k++) {
        part(g, new THREE.SphereGeometry(0.035, 7, 5), candy[(row * 2 + k + (s > 0 ? 1 : 0)) % candy.length], px + nx * 0.07, py + ny * 0.07, -0.3 + k * 0.15, 0, 0, 0, 1, 0.7, 1);
      }
    }
    for (let k = 0; k < 10; k++) part(g, new THREE.SphereGeometry(0.036, 6, 5), icing, s * 0.55, 0.5, -0.38 + k * 0.085, 0, 0, 0, 1, 1.3, 1);
    // icing along the front and back roof edges
    for (const z of [0.43, -0.43]) part(g, new THREE.BoxGeometry(slope + 0.06, 0.05, 0.04), icing, cx + nx * 0.03, cy + ny * 0.03, z, 0, 0, -s * a);
  }
  // gumdrops along the ridge
  for (let k = 0; k < 5; k++) part(g, new THREE.SphereGeometry(0.055, 8, 6, 0, TAU, 0, Math.PI / 2), candy[k % candy.length], 0, 0.95, -0.32 + k * 0.16);
  // chimney with a snowy cap
  part(g, new THREE.BoxGeometry(0.13, 0.28, 0.13), 0xa0522d, -0.22, 0.95, -0.14);
  part(g, new THREE.BoxGeometry(0.17, 0.05, 0.17), icing, -0.22, 1.1, -0.14);
  // candy-cane posts on the four corners
  for (const [x, z] of [[-0.43, 0.33], [0.43, 0.33], [-0.43, -0.33], [0.43, -0.33]]) {
    for (let k = 0; k < 6; k++) part(g, new THREE.CylinderGeometry(0.035, 0.035, 0.085, 8), k % 2 ? icing : 0xe8323a, x, 0.09 + k * 0.085, z);
  }
  // the door: pink with an icing arch and a gold knob, peppermints either side
  part(g, new THREE.BoxGeometry(0.22, 0.3, 0.03), 0xe05a7a, 0, 0.22, 0.33);
  part(g, new THREE.BoxGeometry(0.26, 0.035, 0.04), icing, 0, 0.385, 0.335);
  for (const s of [-1, 1]) part(g, new THREE.BoxGeometry(0.03, 0.32, 0.04), icing, s * 0.125, 0.22, 0.335);
  part(g, new THREE.SphereGeometry(0.02, 6, 5), GOLD, 0.06, 0.22, 0.355);
  for (const s of [-1, 1]) {
    for (const [r, c, d] of [[0.06, icing, 0.02], [0.045, 0xe8323a, 0.026], [0.025, icing, 0.032]]) part(g, new THREE.CylinderGeometry(r, r, d, 12), c, s * 0.27, 0.16, 0.325, Math.PI / 2);
  }
  // windows: glowing panes with icing frames and crosses (front pair, the gable, two each side)
  const win = (x, y, z, ry, w = 0.13) => {
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = ry;
    g.add(holder);
    part(holder, new THREE.BoxGeometry(w + 0.05, w + 0.05, 0.02), icing, 0, 0, 0);
    part(holder, new THREE.BoxGeometry(w + 0.06, 0.025, 0.035), icing, 0, 0, 0.012);
    part(holder, new THREE.BoxGeometry(0.025, w + 0.06, 0.035), icing, 0, 0, 0.012);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, w), mat(0xffd27a));
    pane.position.set(x + Math.sin(ry) * 0.012, y, z + Math.cos(ry) * 0.012);
    pane.rotation.y = ry;
    lit.add(pane);
  };
  for (const s of [-1, 1]) win(s * 0.27, 0.38, 0.325, 0, 0.12);
  win(0, 0.7, 0.345, 0, 0.11);
  for (const s of [-1, 1]) for (const z of [-0.15, 0.15]) win(s * 0.425, 0.34, z, (s * Math.PI) / 2, 0.12);
  // two giant lollipops at the front corners
  for (const s of [-1, 1]) {
    part(g, new THREE.CylinderGeometry(0.018, 0.018, 0.62, 6), icing, s * 0.58, 0.33, 0.36);
    const swirl = [[0.15, s > 0 ? 0xe8323a : 0x38b54a, 0.05], [0.115, icing, 0.056], [0.08, s > 0 ? 0xe8323a : 0x38b54a, 0.062], [0.045, icing, 0.068]];
    for (const [r, c, d] of swirl) part(g, new THREE.CylinderGeometry(r, r, d, 14), c, s * 0.58, 0.72, 0.36, Math.PI / 2);
  }
  g.scale.setScalar(1.22);
  const house = bake(g, kit.bright, { name: 'Gingerbread house' });
  const glass = bake(lit, null);
  glass.material = kit.windowGlow;
  glass.castShadow = glass.receiveShadow = false;
  glass.geometry.deleteAttribute('color');
  glass.scale.setScalar(1.22);
  const out = new THREE.Group();
  out.name = 'Gingerbread house';
  out.add(house, glass);
  return out;
}

const DEER = 1.1, SLEIGH = 1.15;
/** A reindeer (faces +x): brown body, cream belly, pale antlers, red harness with gold bells. */
function makeReindeer(kit, { rudolph = false } = {}) {
  const g = new THREE.Group();
  const fur = 0x93603a, dark = 0x5a3a24, cream = 0xead9bd, antler = 0xe6d3ac, harness = 0xc8262c;
  part(g, new THREE.BoxGeometry(0.38, 0.18, 0.18), fur, 0, 0.34, 0);
  part(g, new THREE.BoxGeometry(0.3, 0.06, 0.15), cream, 0, 0.25, 0);
  for (const [x, z] of [[0.13, 0.06], [0.13, -0.06], [-0.13, 0.06], [-0.13, -0.06]]) {
    part(g, new THREE.BoxGeometry(0.045, 0.26, 0.045), fur, x, 0.13, z);
    part(g, new THREE.BoxGeometry(0.05, 0.04, 0.05), dark, x, 0.02, z);
  }
  part(g, new THREE.BoxGeometry(0.09, 0.2, 0.09), fur, 0.19, 0.47, 0, 0, 0, -0.45);
  part(g, new THREE.BoxGeometry(0.15, 0.11, 0.11), fur, 0.27, 0.58, 0);
  part(g, new THREE.BoxGeometry(0.08, 0.075, 0.085), 0xb07a4f, 0.36, 0.56, 0);
  if (!rudolph) part(g, new THREE.SphereGeometry(0.025, 6, 5), 0x2a1e18, 0.405, 0.57, 0);
  for (const s of [-1, 1]) {
    part(g, new THREE.SphereGeometry(0.014, 5, 4), 0x1e1a18, 0.33, 0.61, s * 0.045);
    part(g, new THREE.BoxGeometry(0.03, 0.06, 0.02), fur, 0.22, 0.63, s * 0.07, s * 0.6, 0, 0);
    // antlers: a beam rising and leaning out, with two tines
    const ant = new THREE.Group();
    ant.position.set(0.24, 0.63, s * 0.035);
    ant.rotation.set(s * 0.5, 0, 0.25);
    g.add(ant);
    part(ant, new THREE.CylinderGeometry(0.012, 0.017, 0.2, 5), antler, 0, 0.1, 0);
    part(ant, new THREE.CylinderGeometry(0.009, 0.012, 0.09, 5), antler, 0.035, 0.12, 0, 0, 0, -0.8);
    part(ant, new THREE.CylinderGeometry(0.009, 0.012, 0.08, 5), antler, -0.03, 0.17, 0, 0, 0, 0.7);
  }
  part(g, new THREE.SphereGeometry(0.035, 6, 5), 0xfaf6ee, -0.2, 0.38, 0);
  // harness: a red band round the chest and the collar, gold bells
  part(g, new THREE.BoxGeometry(0.04, 0.2, 0.2), harness, 0.08, 0.34, 0);
  part(g, new THREE.TorusGeometry(0.065, 0.018, 5, 10), harness, 0.16, 0.42, 0, 0, Math.PI / 2, -0.45);
  for (const z of [-0.06, 0, 0.06]) part(g, new THREE.SphereGeometry(0.022, 6, 5), GOLD, 0.2, 0.37, z);
  g.scale.setScalar(DEER);
  const deer = bake(g, kit.plain, { name: rudolph ? 'Rudolph' : 'Reindeer' });
  if (rudolph) {
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), kit.noseGlow);
    nose.position.set(0.41 * DEER, 0.57 * DEER, 0);
    deer.add(nose);
  }
  return deer;
}

/** Santa's sleigh (faces +x): red body, gold runners and trim, piled with presents. */
function makeSleigh(kit) {
  const g = new THREE.Group();
  const red = 0xc8262c, gold = 0xe8b84a;
  for (const s of [-1, 1]) {
    part(g, new THREE.BoxGeometry(0.66, 0.03, 0.04), gold, 0, 0.03, s * 0.19);
    part(g, new THREE.TorusGeometry(0.08, 0.018, 5, 10, Math.PI), gold, 0.33, 0.11, s * 0.19, 0, 0, -Math.PI / 2);
    for (const x of [-0.2, 0.15]) part(g, new THREE.BoxGeometry(0.03, 0.12, 0.03), gold, x, 0.09, s * 0.19);
    part(g, new THREE.BoxGeometry(0.62, 0.22, 0.04), red, -0.02, 0.28, s * 0.21);
    part(g, new THREE.BoxGeometry(0.64, 0.03, 0.05), gold, -0.02, 0.4, s * 0.21);
    part(g, new THREE.TorusGeometry(0.07, 0.022, 5, 10, Math.PI * 1.5), gold, 0.3, 0.44, s * 0.21, 0, 0, -Math.PI / 2);
  }
  part(g, new THREE.BoxGeometry(0.62, 0.06, 0.42), red, -0.02, 0.17, 0);
  part(g, new THREE.BoxGeometry(0.07, 0.44, 0.46), red, -0.32, 0.38, 0);
  part(g, new THREE.BoxGeometry(0.08, 0.04, 0.48), gold, -0.32, 0.61, 0);
  part(g, new THREE.BoxGeometry(0.06, 0.24, 0.42), red, 0.28, 0.28, 0);
  // the load: presents and a sack
  [[-0.18, 0.28, -0.08, 0.2, 0.18, 0.18, 0x2f8a3e, 0xf2c14e, 0.3], [-0.16, 0.27, 0.11, 0.18, 0.16, 0.16, 0xf5f2ea, 0xd42a2a, -0.2], [0.06, 0.26, 0.02, 0.16, 0.14, 0.2, 0x3d6fd6, 0xf7f4ee, 0.1], [-0.17, 0.46, 0.0, 0.15, 0.13, 0.15, 0xf2b632, 0x2f8a3e, 0.6]].forEach(([x, y, z, w, h, d, c, rib, ry]) => {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    p.rotation.y = ry;
    g.add(p);
    present(p, w, h, d, c, rib, 0);
  });
  part(g, new THREE.SphereGeometry(0.14, 8, 6), 0x9a6b45, 0.1, 0.36, 0.0, 0, 0, 0, 1, 1.15, 1);
  part(g, new THREE.CylinderGeometry(0.035, 0.05, 0.08, 6), 0x9a6b45, 0.1, 0.53, 0);
  part(g, new THREE.TorusGeometry(0.04, 0.012, 4, 8), red, 0.1, 0.5, 0, Math.PI / 2);
  g.scale.setScalar(SLEIGH);
  return bake(g, kit.bright, { name: 'Sleigh' });
}

/** A wrapped present, base on y = y0: a box, a ribbon cross and a bow on top. */
function present(g, w, h, d, color, ribbon, y0 = 0) {
  part(g, new THREE.BoxGeometry(w, h, d), color, 0, y0 + h / 2, 0);
  part(g, new THREE.BoxGeometry(w + 0.006, h + 0.006, Math.min(0.05, d * 0.2)), ribbon, 0, y0 + h / 2, 0);
  part(g, new THREE.BoxGeometry(Math.min(0.05, w * 0.2), h + 0.006, d + 0.006), ribbon, 0, y0 + h / 2, 0);
  const s = Math.min(w, d) / 0.22;
  for (const k of [-1, 1]) part(g, new THREE.TorusGeometry(0.04 * s, 0.015 * s, 5, 10), ribbon, k * 0.035 * s, y0 + h + 0.025 * s, 0, 0, 0, k * 0.5, 1, 0.8, 1);
  part(g, new THREE.SphereGeometry(0.02 * s, 6, 5), ribbon, 0, y0 + h + 0.01, 0);
}

const WRAPS = [[0xd42a2a, 0xf2c14e], [0x2f8a3e, 0xd42a2a], [0xf5f2ea, 0xd42a2a], [0xf2b632, 0x2f8a3e], [0x3d6fd6, 0xf7f4ee], [0x8a4fd0, 0xf2c14e], [0xe85a9a, 0xf7f4ee]];
/** A pile of presents, big ones at the back and a little one on top. About 0.6 across. */
function makePresentPile(kit, seed = 0) {
  const g = new THREE.Group();
  const w = (i) => WRAPS[(seed * 3 + i) % WRAPS.length];
  const put = (x, z, ry, sw, sh, sd, i, y0 = 0) => {
    const p = new THREE.Group();
    p.position.set(x, 0, z);
    p.rotation.y = ry;
    g.add(p);
    present(p, sw, sh, sd, w(i)[0], w(i)[1], y0);
  };
  put(-0.08, -0.06, 0.2, 0.34, 0.28, 0.3, 0);
  put(0.22, 0.08, -0.4, 0.24, 0.2, 0.24, 1);
  put(-0.22, 0.18, 0.7, 0.2, 0.16, 0.2, 2);
  put(0.06, 0.24, 0.1, 0.16, 0.13, 0.16, 3);
  put(-0.06, -0.08, -0.3, 0.2, 0.17, 0.2, 4, 0.28);
  return bake(g, kit.bright, { name: 'Presents' });
}

/** Three giant shiny baubles in a heap, with gold caps. About 0.8 across. */
function makeBaubles(kit, seed = 0) {
  const g = new THREE.Group();
  const cols = [0xd42a2a, 0xf2b632, 0x2f8a3e, 0x3d6fd6, 0xd8dde6, 0xc23a9a];
  const put = (x, z, r, i, tilt) => {
    const y = r;
    const c = cols[(seed + i) % cols.length];
    part(g, new THREE.SphereGeometry(r, 14, 10), c, x, y, z);
    part(g, new THREE.TorusGeometry(r * 1.005, r * 0.06, 5, 24), i % 2 ? 0xf7f4ee : 0xf2c14e, x, y, z, Math.PI / 2 + tilt, 0, tilt);
    part(g, new THREE.CylinderGeometry(r * 0.22, r * 0.24, r * 0.22, 10), 0xe0b040, x + Math.sin(tilt) * r * 0.98, y + Math.cos(tilt) * r * 0.98, z, 0, 0, -tilt);
    part(g, new THREE.TorusGeometry(r * 0.1, r * 0.03, 4, 8), 0xe0b040, x + Math.sin(tilt) * r * 1.16, y + Math.cos(tilt) * r * 1.16, z, 0, 0, -tilt);
  };
  put(0, -0.05, 0.3, 0, 0.25);
  put(0.38, 0.12, 0.21, 1, -0.5);
  put(-0.33, 0.16, 0.17, 2, 0.6);
  return bake(g, kit.shiny, { name: 'Giant baubles' });
}

/** A giant candy cane, 0.72 tall, chunky red and white bands, the hook turning +x. */
function makeCandyCane(kit) {
  const g = new THREE.Group();
  const r = 0.05, n = 7, H = 0.56, seg = H / n;
  for (let k = 0; k < n; k++) part(g, new THREE.CylinderGeometry(r, r, seg, 8), k % 2 ? WHITE : 0xe8323a, 0, seg * (k + 0.5), 0);
  const R = 0.11, pieces = 5;
  for (let k = 0; k < pieces; k++) {
    const geo = new THREE.TorusGeometry(R, r, 6, 4, Math.PI / pieces);
    geo.rotateZ(Math.PI - ((k + 1) * Math.PI) / pieces);
    part(g, geo, (k + n) % 2 ? WHITE : 0xe8323a, R, H, 0);
  }
  // a little end cap on the hook
  part(g, new THREE.SphereGeometry(r, 8, 5), 0xe8323a, 2 * R, H, 0);
  return bake(g, kit.bright, { name: 'Candy cane' });
}

/** A big wreath with berries and a red bow, faces +z. About 0.45 across. */
function makeLampWreath(kit) {
  const g = new THREE.Group();
  part(g, new THREE.TorusGeometry(0.16, 0.06, 6, 16), 0x2f7a3a, 0, 0, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    part(g, new THREE.IcosahedronGeometry(0.045, 0), i % 2 ? 0x3f9a4a : 0x24683a, Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.03, i, i * 2, 0);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.4;
    part(g, new THREE.SphereGeometry(0.025, 6, 5), 0xe02a2a, Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.07);
  }
  for (const s of [-1, 1]) {
    part(g, new THREE.TorusGeometry(0.055, 0.022, 5, 10), RED, s * 0.065, -0.17, 0.07, 0, 0, s * 0.4, 1.2, 0.8, 0.8);
    part(g, new THREE.BoxGeometry(0.04, 0.13, 0.015), RED, s * 0.035, -0.25, 0.07, 0, 0, s * 0.3);
  }
  part(g, new THREE.SphereGeometry(0.032, 6, 5), RED, 0, -0.17, 0.08);
  return bake(g, kit.bright, { name: 'Wreath' });
}

// ---------------------------------------------------------------- the sheep's costumes

let wearMats = null;
function wearMaterials() {
  wearMats ??= { red: mat(0xd42a2a), fur: soft(0xfaf7f0, { roughness: 0.95 }), antler: mat(0x9a6538), nose: glow(0xff2a1a) };
  return wearMats;
}
const wearPart = (g, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const o = mesh(geo, m, false, false);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  g.add(o);
  return o;
};

/** A Santa hat: a red cone flopping over to one side, a white fur band and a pom-pom. */
function santaHat(i) {
  const M = wearMaterials();
  const g = new THREE.Group();
  g.name = 'Santa hat';
  wearPart(g, new THREE.TorusGeometry(0.125, 0.042, 6, 16), M.fur, 0, 0.03, 0, Math.PI / 2);
  wearPart(g, new THREE.CylinderGeometry(0.075, 0.125, 0.17, 12), M.red, 0, 0.12, 0);
  const flop = new THREE.Group(); // the floppy top hinges at the top of the lower part
  flop.position.set(0, 0.2, 0);
  g.add(flop);
  wearPart(flop, new THREE.ConeGeometry(0.075, 0.2, 12), M.red, 0, 0.09, 0);
  wearPart(flop, new THREE.SphereGeometry(0.05, 10, 8), M.fur, 0, 0.19, 0);
  const side = i % 4 === 0 ? -1 : 1;
  flop.rotation.set(-0.35, 0, side * 0.9);
  g.rotation.set(-0.18, 0, side * -0.12);
  const ph = i * 1.7;
  g.userData.update = (time) => { flop.rotation.z = side * (0.9 + Math.sin(time * 2.2 + ph) * 0.1); };
  return g;
}

/** Reindeer antlers (chunky, so they read from across the island) and a glowing red nose. */
function antlers(i) {
  const M = wearMaterials();
  const g = new THREE.Group();
  g.name = 'Antlers';
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.065, -0.015, -0.01);
    a.rotation.set(-0.2, 0, -s * 0.42);
    g.add(a);
    wearPart(a, new THREE.CylinderGeometry(0.022, 0.032, 0.26, 6), M.antler, 0, 0.13, 0);
    wearPart(a, new THREE.CylinderGeometry(0.016, 0.022, 0.12, 5), M.antler, s * 0.045, 0.16, 0, 0, 0, -s * 0.9);
    wearPart(a, new THREE.CylinderGeometry(0.015, 0.021, 0.11, 5), M.antler, -s * 0.04, 0.22, 0, 0, 0, s * 0.8);
    wearPart(a, new THREE.SphereGeometry(0.024, 6, 4), M.antler, 0, 0.26, 0);
  }
  // the nose sits on the front of the snout (as the house costume in ./costumes.js does)
  const nose = wearPart(g, new THREE.SphereGeometry(0.046, 10, 8), M.nose, 0, -0.1, 0.16);
  const ph = i * 0.9;
  // (the nose colour is shared by every sheep and set once a frame by the theme's update)
  g.userData.update = (time, night = 0) => { nose.scale.setScalar(1 + 0.1 * night * (0.5 + 0.5 * Math.sin(time * 3 + ph))); };
  return g;
}

// ---------------------------------------------------------------- the theme

export default function build(ctx) {
  const root = new THREE.Group();
  const s = ctx.scale;
  const own = []; // materials made here (disposed with the theme)
  const keep = (m) => { own.push(m); return m; };
  const kit = {
    plain: keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 })),
    bright: keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 })),
    shiny: keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.15 })),
    windowGlow: keep(glow(0xffd27a)),
    noseGlow: keep(glow(0xff2a1a)),
    starGlow: keep(glow(0xffd23a)),
  };
  // the saturated things stay bright (no snow on them); the snowmen and reindeer take the snow
  kit.bright.userData.noSeason = true;
  kit.shiny.userData.noSeason = true;
  const place = (o, x, z, ry = 0, flags = {}) => {
    o.position.set(x, ctx.heightAt(x, z), z);
    o.rotation.y = ry;
    Object.assign(o.userData, flags);
    root.add(o);
    return o;
  };
  const toward = (x, z) => Math.atan2(ctx.home[0] - x, ctx.home[1] + 4 - z) * 0.5; // face the front, a little toward the yard

  // ---- island-wide strings: bulbs, garland tufts, bows and ornaments (one InstancedMesh each)
  const bulbPts = [], bulbSize = [];
  const lights = (pts, { spacing = 0.15, sag = 0, size = 0.045 } = {}) => {
    const out = sample(pts, spacing, sag);
    for (const p of out) { bulbPts.push(p); bulbSize.push(size); }
  };
  const tufts = [];
  const garland = (pts, { spacing = 0.075, sag = 0.06, size = 1 } = {}) => {
    for (const p of sample(pts, spacing, sag)) tufts.push([...p, size]);
  };
  const bows = []; // [x, y, z, facing, size]
  const ornaments = []; // [x, y, z, colour, size]
  const treeStars = []; // [x, y, z, size]
  const fenceCanes = []; // [x, y, z, turn]

  // fences: lights draped along the top rail, a garland rope under them, bows at the corners and
  // every few posts, red and gold ornaments hanging off the garland
  for (const f of ctx.fields) {
    if (!f.ring) continue;
    lights(ctx.fenceLine(f, { outset: 0.075, step: 0.45, lift: 0.05 }), { spacing: 0.15, sag: 0.06, size: 0.06 });
    garland(ctx.fenceLine(f, { outset: 0.05, step: 0.3, lift: -0.02 }), { spacing: 0.075, sag: 0.025, size: 1.15 });
    const [cx, cz] = f.center;
    const pts = ctx.fenceLine(f, { outset: 0.1, step: 0.4, lift: -0.04 });
    pts.forEach(([x, y, z], i) => {
      if (i === pts.length - 1) return;
      const face = Math.atan2(x - cx, z - cz);
      if (i % 4 === 0) bows.push([x, y + 0.03, z, face, 1.7]);
      else if (i % 2 === 0) ornaments.push([x, y - 0.11, z, i % 4 === 2 ? 0xd8282e : 0xf2b632, 0.075]);
    });
    for (const [x, z] of f.ring) {
      const d = Math.hypot(x - cx, z - cz) || 1;
      bows.push([x + ((x - cx) / d) * 0.12, f.fenceY + 0.02, z + ((z - cz) / d) * 0.12, Math.atan2(x - cx, z - cz), 2.1]);
    }
    // giant candy canes standing just outside the fence every couple of units (not in the gate,
    // not on anything, not in a neighbouring field)
    let last = -1e9, run = 0;
    const cl = ctx.fenceLine(f, { outset: 0.16, step: 0.3 });
    for (let i = 0; i < cl.length - 1; i++) {
      const [x, , z] = cl[i], [bx, , bz] = cl[i + 1];
      run += Math.hypot(bx - x, bz - z);
      if (run - last < 1.7) continue;
      if (f.gate && Math.hypot(x - f.gate.x, z - f.gate.z) < 0.75) continue;
      if ((ctx.view.obstacles || []).some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 0.12)) continue;
      if (ctx.fields.some((o) => o !== f && o.rings.some((r) => inRing(x, z, r)))) continue;
      last = run;
      // the hook leans along the fence, alternating ways
      const flip = fenceCanes.length % 2 ? Math.PI : 0;
      fenceCanes.push([x, ctx.heightAt(x, z), z, Math.atan2(-(bz - z), bx - x) + flip]);
    }
    // gates: an arch of garland and lights with a big bow on top
    const gt = f.gate;
    if (gt) {
      const tx = -gt.nz, tz = gt.nx;
      const arch = [...Array(13)].map((_, i) => {
        const a = (i / 12) * Math.PI;
        return [gt.x + gt.nx * 0.08 + tx * Math.cos(a) * 0.42, f.fenceY - 0.05 + Math.sin(a) * 0.55, gt.z + gt.nz * 0.08 + tz * Math.cos(a) * 0.42];
      });
      garland(arch, { spacing: 0.06, sag: 0, size: 1.3 });
      lights(arch.map(([x, y, z]) => [x + gt.nx * 0.08, y, z + gt.nz * 0.08]), { spacing: 0.12, size: 0.065 });
      bows.push([gt.x + gt.nx * 0.2, f.fenceY + 0.54, gt.z + gt.nz * 0.2, Math.atan2(gt.nx, gt.nz), 2.8]);
    }
  }

  // buildings: lights round the roofline, a garland with bows across the front
  for (const p of ctx.buildings) {
    const plan = buildingPlan(p);
    const c = Math.cos(p.ry || 0), sn = Math.sin(p.ry || 0), sc = p.scale || s;
    const y0 = p.y ?? ctx.heightAt(p.x, p.z);
    const w = ([x, y, z]) => [p.x + (x * c + z * sn) * sc, y0 + y * sc, p.z + (-x * sn + z * c) * sc];
    for (const line of plan.lights) lights(line.map(w), { spacing: 0.14, sag: 0.02, size: 0.062 });
    for (const g of plan.garland) garland(g.pts.map(w), { spacing: 0.07, sag: g.sag * sc, size: 1.25 });
    for (const b of plan.bows) { const q = w(b); bows.push([q[0], q[1], q[2], p.ry || 0, 1.9]); }
  }

  // trees: a spiral of lights round the crown and a gold star on top
  ctx.trees.forEach((p, ti) => {
    const H = p.height, y0 = p.y ?? ctx.heightAt(p.x, p.z);
    const pine = p.key === 'pine';
    const tall = H / (p.scale || s) > 2.2;
    // the crown's outline: its radius at height fraction t (0 bottom of the lights, 1 top)
    let y1, y2, crown;
    if (pine) {
      // the pine's cones: radius 0.29 H at 0.13 H, tapering to the top
      y1 = 0.16 * H; y2 = 0.9 * H;
      crown = (t) => { const yy = 0.16 + t * 0.74; return 0.286 * H * (1 - (yy - 0.127) / 0.873); };
    } else {
      const cy = (tall ? 0.66 : 0.62) * H, hh = 0.33 * H, R = (tall ? 0.25 : 0.36) * H;
      y1 = cy - hh * 0.8; y2 = cy + hh * 0.75;
      crown = (t) => { const yy = -0.8 + t * 1.55; return R * Math.sqrt(Math.max(0.05, 1 - yy * yy)); };
    }
    lights(spiral(p.x, p.z, y0 + y1, y0 + y2, (t) => crown(t) + 0.06, 4, 120, ti), { spacing: 0.14, size: 0.06 });
    // big shiny baubles hung all over the crown, most on the camera's side
    for (let k = 0; k < 14; k++) {
      const t = 0.08 + ((k * 0.618 + ti * 0.3) % 1) * 0.8, a = ti + k * 2.39996;
      const r = crown(t) + 0.03;
      ornaments.push([p.x + Math.cos(a) * r, y0 + y1 + (y2 - y1) * t, p.z + Math.sin(a) * r, TREE_BAUBLES[(k + ti) % TREE_BAUBLES.length], 0.085]);
    }
    treeStars.push([p.x, y0 + H + 0.12, p.z, 1.35]);
  });

  // lamp posts: lights wound round the post (the wreath goes on below)
  for (const l of ctx.lamps) {
    const [x, z] = l.at, y0 = ctx.heightAt(x, z);
    lights(spiral(x, z, y0 + 0.15 * s, y0 + 1.5 * s, () => 0.085, 5, 80), { spacing: 0.12, size: 0.045 });
  }

  // -- bake the strings into instanced meshes
  const dummy = new THREE.Object3D();
  const bulbGeo = new THREE.IcosahedronGeometry(1, 0);
  const bulbMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  bulbMat.userData.noSeason = true;
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, Math.max(1, bulbPts.length));
  bulbs.name = 'Christmas lights';
  bulbs.count = bulbPts.length;
  const base = new Float32Array(bulbPts.length * 3), phase = new Float32Array(bulbPts.length);
  bulbPts.forEach(([x, y, z], i) => {
    dummy.position.set(x, y, z);
    dummy.scale.setScalar(bulbSize[i]);
    dummy.updateMatrix();
    bulbs.setMatrixAt(i, dummy.matrix);
    _c.setHex(BULBS[i % BULBS.length]);
    base[i * 3] = _c.r; base[i * 3 + 1] = _c.g; base[i * 3 + 2] = _c.b;
    phase[i] = (i * 2.399) % TAU;
    bulbs.setColorAt(i, _c);
  });
  bulbs.castShadow = bulbs.receiveShadow = false;
  bulbs.computeBoundingSphere();
  bulbs.userData.noPop = true;
  bulbs.userData.onFence = bulbs.userData.onBuilding = true;
  root.add(bulbs);

  const tuftGeo = new THREE.IcosahedronGeometry(0.062, 0);
  const tuftMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }));
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, Math.max(1, tufts.length));
  tuftMesh.name = 'Garland';
  tuftMesh.count = tufts.length;
  const greens = [0x2e7a3c, 0x3f9147, 0x276e3e, 0x4ea353];
  tufts.forEach(([x, y, z, k], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(i * 1.3, i * 2.1, i * 0.7);
    dummy.scale.setScalar(k * (0.9 + ((i * 37) % 10) * 0.03));
    dummy.updateMatrix();
    tuftMesh.setMatrixAt(i, dummy.matrix);
    tuftMesh.setColorAt(i, _c.setHex(greens[i % greens.length]));
  });
  tuftMesh.castShadow = false;
  tuftMesh.receiveShadow = true;
  tuftMesh.computeBoundingSphere();
  tuftMesh.userData.noPop = true;
  tuftMesh.userData.onFence = tuftMesh.userData.onBuilding = true;
  root.add(tuftMesh);

  const bowMat = keep(new THREE.MeshStandardMaterial({ color: 0xd42a2a, flatShading: true, roughness: 0.6 }));
  bowMat.userData.noSeason = true;
  const bowMesh = new THREE.InstancedMesh(bowGeometry(), bowMat, Math.max(1, bows.length));
  bowMesh.name = 'Bows';
  bowMesh.count = bows.length;
  bows.forEach(([x, y, z, face, k], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, face, 0);
    dummy.scale.setScalar(k);
    dummy.updateMatrix();
    bowMesh.setMatrixAt(i, dummy.matrix);
  });
  bowMesh.castShadow = bowMesh.receiveShadow = false;
  bowMesh.computeBoundingSphere();
  bowMesh.userData.noPop = true;
  bowMesh.userData.onFence = bowMesh.userData.onBuilding = true;
  root.add(bowMesh);

  const ornMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.15 }));
  ornMat.userData.noSeason = true;
  const ornMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), ornMat, Math.max(1, ornaments.length));
  ornMesh.name = 'Ornaments';
  ornMesh.count = ornaments.length;
  ornaments.forEach(([x, y, z, col, k], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(k);
    dummy.updateMatrix();
    ornMesh.setMatrixAt(i, dummy.matrix);
    ornMesh.setColorAt(i, _c.setHex(col));
  });
  ornMesh.castShadow = ornMesh.receiveShadow = false;
  ornMesh.computeBoundingSphere();
  ornMesh.userData.noPop = true;
  ornMesh.userData.onFence = ornMesh.userData.onBuilding = true;
  root.add(ornMesh);

  // giant candy canes round the fences (one cane shape, shared with the ones on the paths)
  const caneTemplate = makeCandyCane(kit);
  const caneGeo = caneTemplate.geometry;
  const caneMesh = new THREE.InstancedMesh(caneGeo, kit.bright, Math.max(1, fenceCanes.length));
  caneMesh.name = 'Fence candy canes';
  caneMesh.count = fenceCanes.length;
  fenceCanes.forEach(([x, y, z, ry], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.setScalar(1.15);
    dummy.updateMatrix();
    caneMesh.setMatrixAt(i, dummy.matrix);
  });
  caneMesh.castShadow = true;
  caneMesh.receiveShadow = false;
  caneMesh.computeBoundingSphere();
  caneMesh.userData.noPop = true;
  caneMesh.userData.onFence = true;
  root.add(caneMesh);

  const starGeo = starGeometry(0.13, 0.055, 0.05); // (scaled up per tree)
  const starMesh = new THREE.InstancedMesh(starGeo, kit.starGlow, Math.max(1, treeStars.length));
  starMesh.name = 'Tree stars';
  starMesh.count = treeStars.length;
  treeStars.forEach(([x, y, z, k], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(k);
    dummy.updateMatrix();
    starMesh.setMatrixAt(i, dummy.matrix);
  });
  starMesh.castShadow = starMesh.receiveShadow = false;
  starMesh.computeBoundingSphere();
  starMesh.userData.noPop = true;
  starMesh.userData.onBuilding = true;
  root.add(starMesh);

  // ---- the centrepiece: a gingerbread house at the front of the farmyard
  let spot = ctx.spots(1, { r: 0.85, from: 2, to: 5 })[0];
  let gingerScale = 1;
  if (!spot) { spot = ctx.spots(1, { r: 0.7, from: 2, to: 5.5 })[0]; gingerScale = 0.85; }
  if (spot) {
    const house = makeGingerbreadHouse(kit);
    house.scale.setScalar(gingerScale);
    place(house, spot[0], spot[1], 0);
  }

  // ---- Santa's sleigh and three reindeer, beside the gingerbread house, heading off toward the
  // front right (one long team: sleigh, a pair, and Rudolph in the lead)
  const deer = [];
  const side = [ctx.home[0] + 1.7, ctx.home[1] + 1.3];
  let teamSpot = null, teamScale = 1;
  for (const [r, k] of [[1.15, 1], [0.95, 0.8], [0.75, 0.62]]) {
    teamSpot = ctx.spots(1, { r, from: 0.3, to: 5.5, around: side })[0];
    if (teamSpot) { teamScale = k; break; }
  }
  if (teamSpot) {
    const team = new THREE.Group();
    team.name = 'Sleigh and reindeer';
    const sleigh = makeSleigh(kit);
    sleigh.position.set(-0.84, 0, 0);
    team.add(sleigh);
    [[-0.03, 0.19, false], [-0.03, -0.19, false], [0.76, 0, true]].forEach(([x, z, rudolph], i) => {
      const d = makeReindeer(kit, { rudolph });
      d.position.set(x, 0, z);
      team.add(d);
      deer.push({ o: d, ph: i * 1.9 });
    });
    // the reins: red straps from the sleigh's front to the harnesses
    const reins = new THREE.Group();
    for (const z of [0.19, -0.19]) part(reins, new THREE.BoxGeometry(0.56, 0.02, 0.02), 0xc8262c, -0.2, 0.46, z * 0.85);
    part(reins, new THREE.BoxGeometry(0.5, 0.02, 0.02), 0xc8262c, 0.6, 0.47, 0);
    team.add(bake(reins, kit.bright, { name: 'Reins' }));
    team.scale.setScalar(teamScale);
    place(team, teamSpot[0], teamSpot[1], -0.45);
  }

  // ---- gold stars on top of the windmill and the silo
  const bigStars = [];
  const bigStarGeo = starGeometry(0.44, 0.19, 0.1);
  const poleMat = keep(new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.4 }));
  poleMat.userData.noSeason = true;
  for (const p of ctx.buildings) {
    if (p.key !== 'windmill' && p.key !== 'silo') continue;
    // (the windmill's star rides a gold pole up off the cap, clear above its sails at 3.45)
    const sc = p.scale || s, mill = p.key === 'windmill';
    const top = (mill ? 2.72 : 2.58) * sc, lift = mill ? (3.45 - 2.72) * sc + 0.36 : 0.22; // (the star's centre notch sits 0.19 below its middle)
    const y0 = p.y ?? ctx.heightAt(p.x, p.z);
    const holder = new THREE.Group(); // origin on the roof tip, so it pops up out of it
    holder.name = 'Gold star';
    holder.position.set(p.x, y0 + top, p.z);
    holder.userData.onBuilding = true;
    const star = new THREE.Mesh(bigStarGeo, kit.starGlow);
    star.position.y = lift;
    star.rotation.y = p.ry || 0;
    holder.add(star);
    if (mill) {
      const pole = mesh(new THREE.CylinderGeometry(0.025, 0.035, lift - 0.12, 6), poleMat, false, false);
      pole.position.y = (lift - 0.12) / 2;
      holder.add(pole);
    }
    root.add(holder);
    bigStars.push({ o: star, ry: p.ry || 0 });
  }

  // ---- wreaths on the lamp posts (on the post's front, under the lantern)
  for (const l of ctx.lamps) {
    const [x, z] = l.at;
    const wr = makeLampWreath(kit);
    wr.scale.setScalar(1.2);
    // (low enough to clear a lantern hung out toward the front, in front of the bulbs round the post)
    wr.position.set(x, ctx.heightAt(x, z) + 0.8 * s, z + 0.16);
    wr.userData.onBuilding = true;
    root.add(wr);
  }

  // ---- presents piled at every gate (either side of it, outside the field)
  ctx.fields.forEach((f, i) => {
    const gt = f.gate;
    if (!gt) return;
    const tx = -gt.nz, tz = gt.nx;
    for (const side of [1, -1]) {
      for (const out of [0.45, 0.65, 0.85]) {
        const x = gt.x + gt.nx * out + tx * side * 0.66, z = gt.z + gt.nz * out + tz * side * 0.66;
        if (!ctx.free(x, z, 0.36)) continue;
        ctx.take(x, z, 0.42);
        const pile = place(makePresentPile(kit, i * 2 + (side > 0 ? 0 : 1)), x, z, Math.atan2(gt.nx, gt.nz) + side * 0.3, { onFence: true });
        pile.scale.setScalar(1.2);
        break;
      }
    }
  });

  // ---- giant candy canes lining the paths
  const canes = ctx.pathSpots(24, { r: 0.12, spacing: 0.85 });
  // (too few paths: more canes round the farmyard, so there are always plenty)
  if (canes.length < 12) canes.push(...ctx.spots(12 - canes.length, { r: 0.12, from: 1.6, to: 4.5, spacing: 0.8 }));
  canes.forEach(([x, z], i) => {
    const c = i === 0 ? caneTemplate : new THREE.Mesh(caneGeo, kit.bright);
    c.name = 'Candy cane';
    c.castShadow = c.receiveShadow = true;
    place(c, x, z, (i % 2 ? Math.PI : 0) + toward(x, z) * 0.6);
  });

  // ---- clusters of giant baubles out on the grass
  ctx.spots(8, { r: 0.6, from: 2.4, to: 7.2, spacing: 1.9 }).forEach(([x, z], i) => place(makeBaubles(kit, i), x, z, toward(x, z) + i).scale.setScalar(1.15));

  // ---- a family of snowmen spread round the island (each a different scarf)
  const scarves = [0xc8463c, 0x2f8a3e, 0xf2b632, 0x3d6fd6, 0xc23a9a];
  ctx.spots(5, { r: 0.45, from: 3.0, to: 7.2, spacing: 2.4 }).forEach(([x, z], i) => {
    const sm = bake(makeSnowman(), kit.plain, { recolor: { 0xc8463c: scarves[i] }, name: 'Snowman' });
    sm.scale.setScalar([1.3, 1.1, 0.8, 0.65, 0.95][i]);
    place(sm, x, z, toward(x, z));
  });

  // ---- more presents out on the grass
  ctx.spots(5, { r: 0.45, from: 2.6, to: 7.2, spacing: 2.0 }).forEach(([x, z], i) => place(makePresentPile(kit, 5 + i), x, z, toward(x, z) + i * 0.8).scale.setScalar(1.25));

  // ---------------------------------------------------------------- every frame
  const arr = bulbs.instanceColor.array;
  function update(dt, time, { night = 0, k = 1 } = {}) {
    if (k <= 0) return;
    // (bright by day too: unlit bulbs dimmed much below 1 read as dull beads in the sun)
    const lvl = (0.88 + 0.12 * night) * Math.min(1, k * 1.5);
    for (let i = 0, n = bulbs.count; i < n; i++) {
      const f = lvl * (0.72 + 0.28 * Math.max(0, Math.sin(time * 2.4 + phase[i])));
      arr[i * 3] = base[i * 3] * f; arr[i * 3 + 1] = base[i * 3 + 1] * f; arr[i * 3 + 2] = base[i * 3 + 2] * f;
    }
    bulbs.instanceColor.needsUpdate = true;
    const g = 0.82 + 0.18 * night + 0.06 * Math.sin(time * 1.7);
    kit.starGlow.color.setRGB(1 * Math.min(1, g + 0.1), 0.82 * g, 0.23 * g);
    for (const st of bigStars) st.o.rotation.y = st.ry + Math.sin(time * 0.7) * 0.6;
    const nk = 0.75 + 0.25 * Math.sin(time * 3.2);
    kit.noseGlow.color.setRGB(1, 0.16 * nk, 0.1 * nk);
    wearMaterials().nose.color.setRGB(0.75 + 0.25 * night, 0.1 * nk, 0.07 * nk);
    kit.windowGlow.color.setRGB(0.6 + 0.4 * night, 0.47 + 0.35 * night, 0.25 + 0.2 * night);
    for (const d of deer) d.o.position.y = Math.abs(Math.sin(time * 2.6 + d.ph)) * 0.025;
  }

  return {
    root,
    update,
    lampColors: [0xff4a3a, 0x3fcf62, 0xfff0c8],
    sheepWear: (i) => (i % 2 === 0 ? santaHat(i) : antlers(i)),
    dispose() {
      root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
      for (const m of own) m.dispose();
    },
  };
}
