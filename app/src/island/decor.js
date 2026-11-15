// Seasonal and holiday decorations for the farm, in the island's low-poly style (no emoji, no
// textures: everything is built from simple shapes).
//
//   spring     flowers by the barn
//   summer     sunflowers
//   fall       pumpkins and a scarecrow
//   Halloween  carved pumpkins that glow, the scarecrow, bats round the barn, orange and purple lights
//   winter     a snowman
//   Christmas  the snowman, a decorated tree with presents, coloured lights on the barn, a wreath
//
//   const decor = createDecor(view, { attach })   attach: the seasons' material patch (snow on things)
//   decor.setState(state)      a state from src/island/timeline.js
//   decor.update(dt, time)     every frame (pop in/out, twinkling lights, flickering lanterns, bats)
//   decor.dispose()
//
// The spots are picked once, near the farmstead on open grass, and kept clear for the sheep (they
// walk round them all year, so a decoration never appears on top of a sheep).
import * as THREE from 'three';
import { makeBush, makeHayBale, makeScarecrow, makeTree, mat, mesh, soft } from './props.js';

const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

/** An unlit glowing material (lantern faces, bulbs, the star): never snowed on or tinted. */
function glow(color) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.userData.noSeason = true;
  return m;
}

// ---------------------------------------------------------------- makers

/** A pumpkin, 0.36 across. carved: a jack-o'-lantern with a glowing face (userData.face to flicker). */
export function makePumpkin(seed = 1, { carved = false, size = 1 } = {}) {
  const g = new THREE.Group();
  g.name = carved ? 'Jack-o-lantern' : 'Pumpkin';
  const body = mesh(new THREE.SphereGeometry(0.18, 10, 7), mat([0xe8822e, 0xf0973a, 0xdf7526][seed % 3], { flatShading: true }));
  body.scale.set(1, 0.74, 1);
  body.position.y = 0.13;
  g.add(body);
  const stem = mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.08, 5), mat(0x6f7f3a));
  stem.position.y = 0.27;
  stem.rotation.z = 0.2;
  g.add(stem);
  if (carved) {
    const face = glow(0xffc24a);
    const tri = (x, y, w, h, flip = false) => {
      const sh = new THREE.Shape();
      sh.moveTo(-w / 2, flip ? h / 2 : -h / 2);
      sh.lineTo(w / 2, flip ? h / 2 : -h / 2);
      sh.lineTo(0, flip ? -h / 2 : h / 2);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), face);
      m.position.set(x, y, 0.172);
      return m;
    };
    g.add(tri(-0.06, 0.17, 0.06, 0.05), tri(0.06, 0.17, 0.06, 0.05), tri(0, 0.13, 0.03, 0.03));
    const mouth = new THREE.Shape();
    mouth.moveTo(-0.09, 0.09);
    [[-0.06, 0.07], [-0.04, 0.09], [-0.01, 0.07], [0.02, 0.09], [0.05, 0.07], [0.09, 0.09], [0.06, 0.05], [-0.06, 0.05]].forEach(([x, y]) => mouth.lineTo(x, y));
    const mm = new THREE.Mesh(new THREE.ShapeGeometry(mouth), face);
    mm.position.z = 0.165;
    g.add(mm);
    g.userData.face = face;
  }
  g.scale.setScalar(size);
  return g;
}

/** A patch of pumpkins on a little straw mat (carved for Halloween). About 0.9 across. */
export function makePumpkinPatch({ carved = false } = {}) {
  const g = new THREE.Group();
  g.name = carved ? 'Jack-o-lanterns' : 'Pumpkin patch';
  const straw = mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.04, 9), mat(0xd9be76, { flatShading: true }), false, true);
  straw.position.y = 0.02;
  g.add(straw);
  const spots = [[0, 0.08, 1.15], [-0.26, -0.12, 0.85], [0.27, -0.08, 0.9], [-0.1, -0.3, 0.7], [0.18, 0.26, 0.75]];
  g.userData.faces = [];
  spots.forEach(([x, z, s], i) => {
    const p = makePumpkin(i + 1, { carved: carved && i < 3, size: s });
    p.position.set(x, 0.02, z);
    p.rotation.y = carved ? (i - 1) * 0.12 : i * 1.7; // carved faces look out (+z)
    g.add(p);
    if (p.userData.face) g.userData.faces.push(p.userData.face);
  });
  return g;
}

/** A snowman with a carrot nose, coal eyes, a red scarf, stick arms and a hat. 1.0 tall. */
export function makeSnowman() {
  const g = new THREE.Group();
  g.name = 'Snowman';
  const snow = soft(0xf6f8fc, { roughness: 0.9 });
  for (const [r, y] of [[0.26, 0.24], [0.19, 0.6], [0.14, 0.86]]) {
    const b = mesh(new THREE.SphereGeometry(r, 14, 10), snow);
    b.position.y = y;
    g.add(b);
  }
  const coal = mat(0x2f2a2c);
  for (const x of [-0.05, 0.05]) {
    const e = mesh(new THREE.SphereGeometry(0.018, 6, 5), coal);
    e.position.set(x, 0.9, 0.125);
    g.add(e);
  }
  for (const y of [0.52, 0.62, 0.72]) {
    const b = mesh(new THREE.SphereGeometry(0.02, 6, 5), coal);
    b.position.set(0, y, 0.185);
    g.add(b);
  }
  const nose = mesh(new THREE.ConeGeometry(0.025, 0.14, 6), mat(0xee8a2a));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.86, 0.19);
  g.add(nose);
  const scarf = mesh(new THREE.TorusGeometry(0.15, 0.035, 6, 14), mat(0xc8463c));
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 0.75;
  g.add(scarf);
  const tail = mesh(new THREE.BoxGeometry(0.06, 0.18, 0.03), mat(0xc8463c));
  tail.position.set(0.09, 0.67, 0.13);
  tail.rotation.z = 0.25;
  g.add(tail);
  for (const s of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.36, 4), mat(0x6e5139));
    arm.rotation.z = s * 1.1;
    arm.position.set(s * 0.3, 0.68, 0);
    g.add(arm);
  }
  const brim = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 14), coal);
  brim.position.y = 0.98;
  g.add(brim);
  const top = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 14), coal);
  top.position.y = 1.07;
  g.add(top);
  const band = mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.035, 14), mat(0xc8463c));
  band.position.y = 1.02;
  g.add(band);
  return g;
}

/**
 * Halloween's scarecrow: a skeleton strung on the cross-post, in a battered black hat, with eyes
 * that glow green in the dark (userData.eyes, a shared glowing material). 1.25 tall.
 */
export function makeSkeletonScarecrow() {
  const g = new THREE.Group();
  g.name = 'Skeleton scarecrow';
  const wood = mat(0x7d5e45), bone = soft(0xf1ead8, { roughness: 0.7 }), dark = mat(0x2a2430);
  const post = mesh(new THREE.BoxGeometry(0.06, 1.05, 0.06), wood);
  post.position.y = 0.52;
  const bar = mesh(new THREE.BoxGeometry(0.74, 0.05, 0.05), wood);
  bar.position.set(0, 0.8, -0.04);
  g.add(post, bar);
  const add = (geo, m, x, y, z, rx = 0, rz = 0) => { const o = mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); g.add(o); return o; };
  // the skull: round cranium, square jaw, dark sockets lit from inside
  add(new THREE.SphereGeometry(0.115, 12, 9), bone, 0, 1.02, 0.03);
  add(new THREE.BoxGeometry(0.13, 0.06, 0.1), bone, 0, 0.92, 0.05);
  const eyes = glow(0x9cff6a);
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.03, 8, 6), eyes, s * 0.042, 1.02, 0.12);
  add(new THREE.ConeGeometry(0.018, 0.035, 3), dark, 0, 0.975, 0.135, Math.PI);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.014, 0.022, 0.01), dark, -0.033 + i * 0.022, 0.915, 0.103);
  // the spine, the ribs (open hoops) and the hips
  add(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 6), bone, 0, 0.66, 0.04);
  for (let i = 0; i < 4; i++) {
    const w = 0.13 - i * 0.012;
    const rib = add(new THREE.TorusGeometry(w, 0.014, 5, 12, Math.PI * 1.35), bone, 0, 0.8 - i * 0.065, 0.06, Math.PI / 2);
    rib.rotation.z = -Math.PI * 0.175 + Math.PI / 2;
    rib.scale.set(1, 0.7, 1);
  }
  add(new THREE.BoxGeometry(0.2, 0.07, 0.08), bone, 0, 0.44, 0.04);
  // arms along the bar, hands hanging; legs dangling, a little crooked
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 5), bone, s * 0.14, 0.8, 0.01, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.18, 5), bone, s * 0.29, 0.79, 0.01, 0, Math.PI / 2 + s * 0.1);
    add(new THREE.SphereGeometry(0.034, 6, 5), bone, s * 0.39, 0.76, 0.01);
    add(new THREE.CylinderGeometry(0.02, 0.018, 0.22, 5), bone, s * 0.06, 0.3, 0.05, 0, s * 0.08);
    add(new THREE.CylinderGeometry(0.017, 0.015, 0.2, 5), bone, s * 0.075, 0.1, 0.08, 0.25, s * 0.05);
    add(new THREE.BoxGeometry(0.05, 0.02, 0.08), bone, s * 0.08, 0.0, 0.11);
  }
  // a battered black hat, cocked to one side, with a purple band
  const hat = new THREE.Group();
  hat.position.set(0.02, 1.11, 0.02);
  hat.rotation.set(-0.12, 0, 0.22);
  const brim = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.02, 12), dark);
  const crown = mesh(new THREE.ConeGeometry(0.11, 0.3, 10), dark);
  crown.position.y = 0.15;
  crown.rotation.z = -0.25;
  const band = mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.035, 10), mat(0x7b4bb3));
  band.position.y = 0.04;
  hat.add(brim, crown, band);
  g.add(hat);
  g.userData.eyes = eyes;
  return g;
}

/** A wrapped present with a ribbon cross and bow. */
function makePresent(color, ribbon, w = 0.22, h = 0.16, d = 0.2) {
  const g = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  box.position.y = h / 2;
  g.add(box);
  const r = mat(ribbon);
  const a = mesh(new THREE.BoxGeometry(w + 0.004, h + 0.004, 0.03), r);
  a.position.y = h / 2;
  g.add(a);
  const b = mesh(new THREE.BoxGeometry(0.03, h + 0.004, d + 0.004), r);
  b.position.y = h / 2;
  g.add(b);
  for (const s of [-1, 1]) {
    const loop = mesh(new THREE.TorusGeometry(0.035, 0.012, 5, 10), r);
    loop.position.set(s * 0.03, h + 0.02, 0);
    loop.rotation.y = Math.PI / 2;
    loop.rotation.z = s * 0.6;
    g.add(loop);
  }
  return g;
}

/** A five-pointed star (flat, extruded a little). */
function starGeometry(outer = 0.12, inner = 0.05, depth = 0.03) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Bulbs along a line through `points` ([x, y, z] in the parent's space), sagging a little between
 * points, as one InstancedMesh. update(time) twinkles them. colors: the bulb colours in turn.
 */
export function makeStringLights(points, { colors, spacing = 0.12, sag = 0.035, size = 0.03 } = {}) {
  const pos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.round(len / spacing));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      pos.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]);
    }
  }
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  material.userData.noSeason = true;
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 6, 5), material, pos.length);
  im.name = 'String lights';
  const m = new THREE.Matrix4();
  pos.forEach((p, i) => { im.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2])); });
  const base = pos.map((_, i) => new THREE.Color(colors[i % colors.length]));
  const c = new THREE.Color();
  const phase = pos.map((_, i) => (i * 2.399) % 6.283);
  im.userData.update = (time) => {
    for (let i = 0; i < pos.length; i++) {
      const k = 0.55 + 0.45 * Math.max(0, Math.sin(time * 2.6 + phase[i]));
      im.setColorAt(i, c.copy(base[i]).multiplyScalar(k));
    }
    im.instanceColor.needsUpdate = true;
  };
  im.userData.update(0);
  return im;
}

/** A decorated Christmas tree: a pine with baubles, a spiral of lights, a star and presents. */
export function makeChristmasTree() {
  const g = new THREE.Group();
  g.name = 'Christmas tree';
  const s = 1.0;
  const pine = makeTree('pine', 5, s);
  g.add(pine);
  // baubles round the lower edge of each cone (pineTree: cones at y 0.65 + k * 0.38, radius 0.62 - k * 0.13, 0.75 tall)
  const baubles = [];
  const lights = [];
  for (let k = 0; k < 4; k++) {
    const r = (0.62 - k * 0.13) * s, y = (0.65 + k * 0.38) * s - 0.3 * s;
    const n = 7 - k;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.5;
      baubles.push([Math.cos(a) * r * 0.86, y, Math.sin(a) * r * 0.86]);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + k;
      // on the cone's surface at that height (its 8-sided profile, plus the bulb), never inside it
      const h = 0.125 * s + 0.03 * s * i;
      const rr = r * (1 - h / (0.75 * s)) * Math.cos(Math.PI / 8) + 0.03;
      lights.push([Math.cos(a) * rr, y + 0.3 * s * (i / 10) + 0.05, Math.sin(a) * rr]);
    }
  }
  const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), soft(0xffffff, { roughness: 0.35, metalness: 0.2 }), baubles.length);
  const cols = [0xd8453c, 0xf2c14e, 0x5b8fd6, 0xf5f0e8];
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  baubles.forEach((p, i) => { bm.setMatrixAt(i, m4.makeTranslation(...p)); bm.setColorAt(i, c.set(cols[i % cols.length])); });
  bm.castShadow = true;
  bm.material.userData.noSeason = true;
  g.add(bm);
  const tw = makeStringLights(lights, { colors: [0xfff1b8, 0xffd36b], spacing: 1, sag: 0, size: 0.022 });
  g.add(tw);
  g.userData.twinkle = [tw];
  const star = new THREE.Mesh(starGeometry(0.13, 0.055, 0.04), glow(0xffd84a));
  star.position.y = (0.65 + 3 * 0.38 + 0.4) * s;
  g.add(star);
  g.userData.star = star;
  // presents under it
  [[0xd8453c, 0xf2e6c9, 0.42, 0.3, 0.3], [0x5b9a6a, 0xd8453c, -0.4, 0.34, -0.2], [0x6e8fd0, 0xf2c14e, 0.1, 0.5, 1.1]].forEach(([col, rib, x, z, ry], i) => {
    const p = makePresent(col, rib, 0.22 - i * 0.03, 0.16 + (i % 2) * 0.05, 0.2);
    p.position.set(x, 0, z);
    p.rotation.y = ry;
    g.add(p);
  });
  return g;
}

/** A wreath with a red bow and berries (faces +z). */
export function makeWreath() {
  const g = new THREE.Group();
  g.name = 'Wreath';
  const ring = mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 16), mat(0x4f8a46, { flatShading: true }), false, false);
  g.add(ring);
  const berry = mat(0xd8453c);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const b = mesh(new THREE.SphereGeometry(0.018, 6, 5), berry, false, false);
    b.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.035);
    g.add(b);
  }
  for (const s of [-1, 1]) {
    const loop = mesh(new THREE.TorusGeometry(0.035, 0.014, 5, 10), berry, false, false);
    loop.position.set(s * 0.04, -0.12, 0.04);
    loop.scale.set(1, 0.7, 1);
    g.add(loop);
  }
  return g;
}

/** A small bat silhouette (wings flap with scale.x). */
function batGeometry() {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.05);
  [[0.05, 0.08], [0.11, 0.04], [0.2, 0.08], [0.16, 0.0], [0.12, -0.02], [0.08, -0.01], [0.04, -0.04], [0, -0.03],
    [-0.04, -0.04], [-0.08, -0.01], [-0.12, -0.02], [-0.16, 0.0], [-0.2, 0.08], [-0.11, 0.04], [-0.05, 0.08]].forEach(([x, y]) => sh.lineTo(x, y));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Sunflowers: three tall stems with yellow heads facing out (+z). */
export function makeSunflowers() {
  const g = new THREE.Group();
  g.name = 'Sunflowers';
  const stemM = mat(0x5f8a39), leafM = mat(0x6f9a3e, { side: THREE.DoubleSide }), petal = mat(0xf4c534, { flatShading: true }), seed = mat(0x6b4a2b);
  [[0, 0, 1.0], [-0.22, -0.12, 0.85], [0.2, -0.08, 0.92]].forEach(([x, z, h]) => {
    const stem = mesh(new THREE.CylinderGeometry(0.018, 0.024, h, 5), stemM);
    stem.position.set(x, h / 2, z);
    g.add(stem);
    for (const s of [-1, 1]) {
      const leaf = mesh(new THREE.CircleGeometry(0.07, 5), leafM);
      leaf.scale.set(1.6, 0.8, 1);
      leaf.position.set(x + s * 0.07, h * 0.45, z);
      leaf.rotation.set(-0.5, 0, s * 0.5);
      g.add(leaf);
    }
    const head = new THREE.Group();
    head.position.set(x, h + 0.02, z);
    head.rotation.x = -0.25;
    const petals = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 12), petal);
    petals.rotation.x = Math.PI / 2;
    head.add(petals);
    const disc = mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 12), seed);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = 0.012;
    head.add(disc);
    g.add(head);
  });
  return g;
}

/** A spring flower bed: flowering bushes and a few tulips. */
export function makeSpringFlowers() {
  const g = new THREE.Group();
  g.name = 'Spring flowers';
  const a = makeBush('flowering', 4, 0.7);
  a.position.set(-0.18, 0, 0);
  g.add(a);
  const b = makeBush('flowering', 9, 0.55);
  b.position.set(0.25, 0, -0.1);
  g.add(b);
  const stemM = mat(0x5f8a39);
  [[0xf07a8c, -0.05, 0.3], [0xf6dc6e, 0.12, 0.28], [0xb7a7ec, 0.3, 0.2], [0xf07a8c, -0.3, 0.22]].forEach(([col, x, z]) => {
    const stem = mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.26, 4), stemM);
    stem.position.set(x, 0.13, z);
    g.add(stem);
    const cup = mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.08, 6), mat(col));
    cup.position.set(x, 0.29, z);
    g.add(cup);
  });
  return g;
}

/**
 * Bunting: little triangular flags hanging along a line through `points` (parent space), in turn
 * through `colors`, one InstancedMesh, with the string. update(time) lets them stir in the breeze.
 */
export function makeBunting(points, colors, { spacing = 0.17, size = 0.1, sag = 0.05 } = {}) {
  const g = new THREE.Group();
  g.name = 'Bunting';
  const flags = [];
  const line = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.round(len / spacing));
    const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0]); // the flag faces out from the line
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
      line.push(new THREE.Vector3(...p));
      if (k < n || i === points.length - 2) flags.push({ p, yaw });
    }
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(line), new THREE.LineBasicMaterial({ color: 0x6b5545 })));
  const sh = new THREE.Shape();
  sh.moveTo(-size / 2, 0);
  sh.lineTo(size / 2, 0);
  sh.lineTo(0, -size * 1.25);
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, flatShading: true });
  material.userData.noSeason = true;
  const im = new THREE.InstancedMesh(new THREE.ShapeGeometry(sh), material, flags.length);
  im.name = 'Bunting flags';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  flags.forEach((_, i) => im.setColorAt(i, c.set(colors[i % colors.length])));
  im.userData.update = (time) => {
    flags.forEach((f, i) => {
      e.set(Math.sin(time * 2.2 + i * 0.9) * 0.22, f.yaw, 0);
      im.setMatrixAt(i, m.compose(v.set(...f.p), q.setFromEuler(e), one));
    });
    im.instanceMatrix.needsUpdate = true;
  };
  im.userData.update(0);
  g.add(im);
  g.userData.update = im.userData.update;
  return g;
}

let flagTexture = null;
/** A flagpole with the Stars and Stripes (a little canvas picture: stripes and a starry canton). userData.wave(time). */
export function makeFlagpole() {
  const g = new THREE.Group();
  g.name = 'Flagpole';
  const pole = mesh(new THREE.CylinderGeometry(0.022, 0.03, 1.9, 8), soft(0xe9e6e0, { roughness: 0.5 }));
  pole.position.y = 0.95;
  const ball = mesh(new THREE.SphereGeometry(0.045, 10, 8), soft(0xe2b84a, { roughness: 0.35, metalness: 0.3 }));
  ball.position.y = 1.93;
  const foot = mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.08, 8), mat(0x9a9188));
  foot.position.y = 0.04;
  g.add(pole, ball, foot);
  if (!flagTexture) {
    const cv = document.createElement('canvas');
    cv.width = 190; cv.height = 100;
    const x = cv.getContext('2d');
    for (let i = 0; i < 13; i++) { x.fillStyle = i % 2 ? '#f5f2ea' : '#c8363c'; x.fillRect(0, (i * 100) / 13, 190, 100 / 13 + 0.5); }
    x.fillStyle = '#2f4f9a';
    x.fillRect(0, 0, 76, 54);
    x.fillStyle = '#f5f2ea';
    for (let r = 0; r < 5; r++) for (let k = 0; k < 6 - (r % 2); k++) { x.beginPath(); x.arc(7 + k * 12.5 + (r % 2) * 6, 6 + r * 10.5, 2.1, 0, Math.PI * 2); x.fill(); }
    flagTexture = new THREE.CanvasTexture(cv);
    flagTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const geo = new THREE.PlaneGeometry(0.62, 0.34, 12, 2);
  geo.translate(0.31 + 0.025, 0, 0);
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTexture, side: THREE.DoubleSide, roughness: 0.75 });
  flagMat.userData.noSeason = true;
  const flag = mesh(geo, flagMat, true, false);
  flag.position.y = 1.7;
  g.add(flag);
  const base = geo.attributes.position.array.slice();
  g.userData.wave = (time) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      pos.setZ(i, Math.sin(x * 9 - time * 5.5) * 0.045 * Math.min(1, x / 0.3));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };
  g.userData.wave(0);
  return g;
}

/** An egg shape, 0.1 tall (instanced for the Easter egg hunt). */
const eggGeometry = () => { const geo = new THREE.SphereGeometry(0.04, 10, 8); geo.scale(1, 1.32, 1); geo.translate(0, 0.05, 0); return geo; };
const EGG_COLORS = [0xf7a8c4, 0xa8d8f7, 0xf7e08a, 0xb9e6a8, 0xd2b4f2, 0xffc49a];

/** A white rabbit, sitting (faces +z). userData.ears to twitch. */
export function makeBunny() {
  const g = new THREE.Group();
  g.name = 'Bunny';
  const fur = soft(0xf6f2ee, { roughness: 0.9 }), pink = mat(0xf2a7b8), dark = mat(0x2f2a2c);
  const body = mesh(new THREE.SphereGeometry(0.11, 12, 9), fur);
  body.scale.set(0.95, 0.9, 1.2);
  body.position.set(0, 0.1, 0);
  const head = mesh(new THREE.SphereGeometry(0.075, 12, 9), fur);
  head.position.set(0, 0.2, 0.1);
  const tail = mesh(new THREE.SphereGeometry(0.04, 8, 6), fur);
  tail.position.set(0, 0.09, -0.13);
  g.add(body, head, tail);
  for (const s of [-1, 1]) {
    const foot = mesh(new THREE.SphereGeometry(0.035, 8, 6), fur);
    foot.scale.set(1, 0.6, 1.6);
    foot.position.set(s * 0.06, 0.02, 0.08);
    const eye = mesh(new THREE.SphereGeometry(0.011, 6, 5), dark);
    eye.position.set(s * 0.035, 0.225, 0.165);
    g.add(foot, eye);
  }
  const nose = mesh(new THREE.SphereGeometry(0.012, 6, 5), pink);
  nose.position.set(0, 0.2, 0.175);
  g.add(nose);
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.032, 0.26, 0.08);
    ear.rotation.z = -s * 0.18;
    const outer = mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.15, 6), fur);
    outer.scale.z = 0.55;
    outer.position.y = 0.075;
    const inner = mesh(new THREE.BoxGeometry(0.02, 0.11, 0.006), pink, false, false);
    inner.position.set(0, 0.075, 0.012);
    ear.add(outer, inner);
    g.add(ear);
    ears.push(ear);
  }
  g.userData.ears = ears;
  return g;
}

/** A wicker basket of painted eggs, with the Easter bunny sitting beside it. */
export function makeEasterBasket() {
  const g = new THREE.Group();
  g.name = 'Easter basket';
  const wicker = mat(0xc9925a, { flatShading: true });
  const basket = mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.15, 10), wicker);
  basket.position.y = 0.075;
  const rim = mesh(new THREE.TorusGeometry(0.17, 0.02, 5, 14), mat(0xb27c47));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.15;
  const handle = mesh(new THREE.TorusGeometry(0.15, 0.014, 5, 14, Math.PI), mat(0xb27c47));
  handle.position.y = 0.15;
  const grass = mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.02, 10), mat(0x9ccf6a, { flatShading: true }));
  grass.position.y = 0.14;
  g.add(basket, rim, handle, grass);
  const egg = eggGeometry();
  [[-0.06, 0.03, 0], [0.05, -0.04, 1], [0.0, 0.07, 2], [0.07, 0.05, 3], [-0.05, -0.06, 4]].forEach(([x, z, i]) => {
    const e = mesh(egg, soft(EGG_COLORS[i], { roughness: 0.5 }));
    e.position.set(x, 0.13, z);
    e.rotation.set(0.3 * (i - 2), i, 0.2);
    g.add(e);
  });
  const bunny = makeBunny();
  bunny.position.set(0.36, 0, 0.05);
  bunny.rotation.y = -0.5;
  g.add(bunny);
  g.userData.bunny = bunny;
  return g;
}

/** A corn shock: cut stalks stood up in a tied bundle, 0.95 tall. */
export function makeCornShock(seed = 1) {
  const g = new THREE.Group();
  g.name = 'Corn shock';
  const cols = [mat(0xd9b56a, { flatShading: true }), mat(0xc9a457, { flatShading: true }), mat(0xe2c27a, { flatShading: true })];
  const geo = new THREE.CylinderGeometry(0.012, 0.022, 0.95, 4);
  geo.translate(0, 0.475, 0);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const s = mesh(geo, cols[(i + seed) % 3]);
    s.position.set(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17);
    s.rotation.order = 'YZX';
    s.rotation.y = -a;
    s.rotation.z = 0.19 + ((i * 7) % 5) * 0.012; // leaning in to the tie
    g.add(s);
  }
  const tie = mesh(new THREE.TorusGeometry(0.085, 0.018, 5, 12), mat(0x8a5a2b));
  tie.rotation.x = Math.PI / 2;
  tie.position.y = 0.55;
  const tassel = mesh(new THREE.ConeGeometry(0.07, 0.2, 6), cols[2]);
  tassel.position.y = 0.98;
  g.add(tie, tassel);
  return g;
}

/** Thanksgiving's harvest display: two corn shocks, a hay bale with pumpkins and gourds. */
export function makeHarvestDisplay() {
  const g = new THREE.Group();
  g.name = 'Harvest display';
  for (const [x, z, k] of [[-0.42, -0.05, 1], [0.44, -0.1, 2]]) {
    const s = makeCornShock(k);
    s.position.set(x, 0, z);
    g.add(s);
  }
  const bale = makeHayBale(7);
  bale.scale.setScalar(0.8);
  g.add(bale);
  const top = makePumpkin(2, { size: 0.8 });
  top.position.set(0, 0.36, 0.02);
  g.add(top);
  [[-0.2, 0.32, 0.85, 1], [0.24, 0.3, 0.7, 3]].forEach(([x, z, s, k]) => {
    const p = makePumpkin(k, { size: s });
    p.position.set(x, 0, z);
    g.add(p);
  });
  [[0.05, 0.36, 0xe8c547], [-0.06, 0.42, 0x6f9a3e], [0.14, 0.44, 0xf2efe0]].forEach(([x, z, col]) => {
    const gourd = mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(col, { flatShading: true }));
    gourd.scale.set(1, 0.8, 1.3);
    gourd.position.set(x, 0.04, z);
    g.add(gourd);
  });
  return g;
}

/** A harvest wreath of autumn leaves with a wheat-coloured bow (faces +z). */
export function makeHarvestWreath() {
  const g = new THREE.Group();
  g.name = 'Harvest wreath';
  const ring = mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 16), mat(0x9a6a3a, { flatShading: true }), false, false);
  g.add(ring);
  const leafCols = [0xd9572b, 0xe8a23a, 0xb8452a, 0xe6c04a];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const leaf = mesh(new THREE.BoxGeometry(0.06, 0.04, 0.012), mat(leafCols[i % 4], { flatShading: true }), false, false);
    leaf.position.set(Math.cos(a) * 0.125, Math.sin(a) * 0.125, 0.03);
    leaf.rotation.z = a + 0.6;
    g.add(leaf);
  }
  for (const s of [-1, 1]) {
    const loop = mesh(new THREE.TorusGeometry(0.035, 0.014, 5, 10), mat(0xe2c27a), false, false);
    loop.position.set(s * 0.04, -0.12, 0.04);
    loop.scale.set(1, 0.7, 1);
    g.add(loop);
  }
  return g;
}

/**
 * A fireworks show over the island, for New Year and July 4th nights: rockets climb with a
 * sparkling tail, then burst as a big ball of sparks, a ring, a two-colour peony (white heart) or a
 * gold willow that droops and crackles, and fade. The darker it is the more go up at once (none by
 * day). One InstancedMesh of glowing sparks, drawn additively so they light up the night sky.
 * update(time, colors, night) every frame while they're on.
 */
function createFireworks(view) {
  const PER = 64, TAIL = 4, BURSTS = 9;
  const SLOT = PER + TAIL;
  // (not tone-mapped: the film curve would wash the colours out to white where sparks overlap)
  const material = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  material.userData.noSeason = true;
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4), material, BURSTS * SLOT);
  im.name = 'Fireworks';
  im.frustumCulled = false;
  im.visible = false;
  const c = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const hide = (i) => im.setMatrixAt(i, m.makeScale(0, 0, 0));
  for (let i = 0; i < im.count; i++) { im.setColorAt(i, c.setRGB(0, 0, 0)); hide(i); }
  // spark directions: evenly over a sphere, and round a ring
  const ball = [...Array(PER)].map((_, i) => {
    const y = 1 - (2 * (i + 0.5)) / PER, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  const ring = [...Array(PER)].map((_, i) => { const a = (i / PER) * Math.PI * 2; return [Math.cos(a), Math.sin(a) * 0.35, Math.sin(a) * 0.94]; });
  const cx = view.center?.x || 0, cz = view.center?.z || 0, R = view.radius || 7;
  const bursts = [...Array(BURSTS)].map((_, i) => ({ period: 2.9 + (i % 4) * 0.47, offset: i * 1.13, color: new THREE.Color() }));
  const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
  const RISE = 0.95;
  const KINDS = ['ball', 'ring', 'peony', 'willow', 'ball', 'peony'];
  function update(time, colors, night = 1) {
    // how many are going up: none by day, the whole show once it's properly dark
    const live = Math.round(BURSTS * Math.max(0, Math.min(1, (night - 0.25) / 0.5)));
    const glow = (0.55 + 0.45 * night) * 0.85; // (a touch under full: overlapping sparks add up)
    bursts.forEach((b, bi) => {
      const base = bi * SLOT;
      if (bi >= live) { for (let i = 0; i < SLOT; i++) hide(base + i); return; }
      const T = time + b.offset;
      const cycle = Math.floor(T / b.period), t = T - cycle * b.period;
      const seed = cycle * 7 + bi * 31;
      // over the island and the sea beyond it, high enough to clear the camera's view of the farm
      // over the island, a little behind its middle, low enough to burst in the camera's view
      const x = cx + (hash(seed) - 0.5) * 1.6 * R, z = cz - R * (0.05 + hash(seed + 1) * 0.5);
      const peak = 3.3 + hash(seed + 2) * 1.8;
      const kind = KINDS[Math.floor(hash(seed + 3) * KINDS.length)];
      const col = b.color.set(colors[(cycle + bi) % colors.length]);
      const fade = kind === 'willow' ? 2.3 : 1.6;
      const size = kind === 'willow' ? 1.6 : 2.0 + hash(seed + 4) * 0.8;
      // the rocket climbing, with a short sparkling tail
      for (let j = 0; j < TAIL; j++) {
        const kk = t / RISE - j * 0.06;
        if (t >= RISE || kk < 0) { hide(base + PER + j); continue; }
        m.compose(p.set(x, 0.9 + (peak - 0.9) * (1 - (1 - kk) ** 2), z), q, s.setScalar(0.7 - j * 0.14));
        im.setMatrixAt(base + PER + j, m);
        im.setColorAt(base + PER + j, c.setRGB(1, 0.82, 0.55).multiplyScalar((1 - j * 0.22) * glow));
      }
      // the burst
      const k = (t - RISE) / fade;
      for (let i = 0; i < PER; i++) {
        if (k < 0 || k > 1) { hide(base + i); continue; }
        const d = kind === 'ring' ? ring[i] : ball[i];
        const inner = kind === 'peony' && i % 5 === 0; // a white heart inside the coloured ball
        const out = size * (inner ? 0.5 : 1) * (1 - (1 - k) ** 3);
        const drop = kind === 'willow' ? k * k * 2.2 : k * k * 0.8;
        m.compose(p.set(x + d[0] * out, peak + d[1] * out - drop, z + d[2] * out), q, s.setScalar(0.85 * (1 - k) + 0.18));
        im.setMatrixAt(base + i, m);
        // gold willows crackle as they fade; the rest dim smoothly
        const crackle = kind === 'willow' && k > 0.5 ? (hash(i + Math.floor(time * 18)) > 0.5 ? 1.4 : 0.3) : 1;
        if (inner) c.setRGB(1, 0.97, 0.9);
        else if (kind === 'willow') c.setRGB(1, 0.78, 0.35);
        else c.copy(col);
        im.setColorAt(base + i, c.multiplyScalar((1 - k * 0.8) * glow * crackle));
      }
    });
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
  }
  return { mesh: im, update };
}

// ---------------------------------------------------------------- placing them

/** What's out for a state. */
export function decorFor(state) {
  const o = state.occasion, s = state.season;
  const pumpkins = (s === 'fall' && o !== 'halloween' && state.t < 0.85) || o === 'thanksgiving';
  return {
    flowers: s === 'spring' && (state.t > 0.2 || o === 'easter'),
    sunflowers: s === 'summer',
    pumpkins,
    lanterns: o === 'halloween',
    doorPumpkins: pumpkins,
    doorLanterns: o === 'halloween',
    scarecrow: s === 'fall' && o !== 'halloween',
    skeleton: o === 'halloween', // (the scarecrow's Halloween costume: a skeleton, same spot)
    bats: o === 'halloween',
    snowman: s === 'winter',
    xmasTree: o === 'christmas' || o === 'newyear', // (the tree stays up for New Year)
    wreath: o === 'christmas' || o === 'newyear',
    harvestWreath: o === 'thanksgiving',
    harvest: o === 'thanksgiving',
    eggs: o === 'easter',
    easterBasket: o === 'easter',
    flag: o === 'independence',
    fireworks: o === 'independence' || o === 'newyear' ? o : null,
    bunting: o === 'easter' || o === 'independence' || o === 'thanksgiving' ? o : null,
    lights: o === 'christmas' || o === 'halloween' || o === 'newyear' ? o : null,
  };
}

/** Each festival's colours: bunting flags, string lights and fireworks. */
const BUNTING_COLORS = {
  easter: [0xf7a8c4, 0xa8d8f7, 0xf7e08a, 0xb9e6a8, 0xd2b4f2],
  independence: [0xc8363c, 0xf5f2ea, 0x2f4f9a],
  thanksgiving: [0xd9722b, 0xb8452a, 0xe8b23a, 0x8a5a2b],
};
const FIREWORK_COLORS = {
  independence: [0xff2a2a, 0x2a5cff, 0xff2a2a, 0xf0eeff, 0x3a74ff, 0xff4040],
  newyear: [0xffd36b, 0xff7ad9, 0x7ae0ff, 0xb8ff7a, 0xffffff, 0xff9a4a],
};

/**
 * @param {object} view    the reveal's view (island, heightAt, farmstead, barn, barnScale, flock, obstacles)
 * @param {object} [o]
 * @param {(object: THREE.Object3D) => void} [o.attach]  patches materials for the seasons (snow)
 */
export function createDecor(view, { attach } = {}) {
  const root = new THREE.Group();
  root.name = 'Decorations';
  view.island.add(root);
  const scale = view.barnScale || 0.75;
  const items = {};
  const twinkles = [];
  const faces = [];

  // ---- spots on open grass near the farmstead, kept clear of the sheep's paths all year
  const home = view.farmstead?.yard?.at || view.farmstead?.at || [view.center?.x || 0, view.center?.z || 0];
  const taken = [];
  const free = (x, z, r) => {
    if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r + 0.15)) return false;
    if (view.flock?.walkable && !view.flock.walkable(x, z, null, r * 2)) return false;
    // never on a sheep: it would be inside the new obstacle and unable to step out
    if (view.flock?.sheep?.some((sh) => Math.hypot(sh.g.position.x - x, sh.g.position.z - z) < r + 0.25 + sh.size * 0.6)) return false;
    // keep the reserved upgrade pads free, as the reveal does
    if (view.slots?.some((sl) => sl.kind !== 'tree' && Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + r + 0.1)) return false;
    return true;
  };
  // the barn (its footprint, so nothing is hidden behind it from the camera's usual side, +z)
  const barnAt = view.farmstead?.at || home;
  const hiddenByBarn = (x, z) => z < barnAt[1] - 0.4 && Math.abs(x - barnAt[0]) < 1.9 && barnAt[1] - z < 4;
  function spot(r, prefer = 0) {
    // every free spot on rings out from the yard, best first: near, on the camera's side (+z), not behind the barn
    const cands = [];
    for (const d of [1.6, 2.0, 2.4, 2.8, 3.3, 3.8, 4.4, 5.1, 5.8]) {
      const n = Math.round(d * 7);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + prefer * 0.05;
        const x = home[0] + Math.cos(a) * d, z = home[1] + Math.sin(a) * d;
        const score = d * 0.55 - (z - home[1]) * 0.35 + (hiddenByBarn(x, z) ? 4 : 0) + Math.abs(Math.sin(a - prefer)) * 0.2;
        cands.push({ x, z, score });
      }
    }
    cands.sort((p, q) => p.score - q.score);
    for (const c of cands) {
      if (!free(c.x, c.z, r)) continue;
      taken.push({ x: c.x, z: c.z, r });
      view.obstacles?.push({ x: c.x, z: c.z, r }); // the sheep walk round it, all year
      return [c.x, c.z];
    }
    return null;
  }
  function place(name, obj, r, prefer, size = 1) {
    const at = spot(r * scale * size, prefer);
    if (!at) return null;
    const wrap = new THREE.Group();
    wrap.name = `${name} (decor)`;
    wrap.position.set(at[0], view.heightAt(at[0], at[1]), at[1]);
    wrap.rotation.y = Math.atan2(-(at[0] - home[0]) * 0.15, 1); // faces the camera side, roughly
    wrap.add(obj);
    wrap.userData.full = scale * size;
    wrap.scale.setScalar(0.001);
    wrap.visible = false;
    root.add(wrap);
    attach?.(wrap);
    items[name] = { wrap, k: 0, on: false };
    return wrap;
  }

  const pumpkins = makePumpkinPatch();
  const lanterns = makePumpkinPatch({ carved: true });
  faces.push(...lanterns.userData.faces);
  const pumpkinSpot = place('pumpkins', pumpkins, 0.5, 0.4, 1.2);
  if (pumpkinSpot) { // the carved ones go in the same spot
    const wrap = new THREE.Group();
    wrap.position.copy(pumpkinSpot.position);
    wrap.rotation.copy(pumpkinSpot.rotation);
    wrap.add(lanterns);
    wrap.userData.full = scale * 1.2;
    wrap.scale.setScalar(0.001);
    wrap.visible = false;
    root.add(wrap);
    attach?.(wrap);
    items.lanterns = { wrap, k: 0, on: false };
  }
  const tree = makeChristmasTree();
  twinkles.push(...tree.userData.twinkle);
  place('xmasTree', tree, 0.7, 2.2, 1.25);
  place('snowman', makeSnowman(), 0.35, 1.0, 1.15);
  const scarecrowSpot = place('scarecrow', makeScarecrow(), 0.4, 0.2, 1.1);
  // for Halloween a skeleton takes the scarecrow's place (same spot, swapped as one leaves)
  const skeleton = makeSkeletonScarecrow();
  if (scarecrowSpot) {
    const wrap = new THREE.Group();
    wrap.name = 'skeleton (decor)';
    wrap.position.copy(scarecrowSpot.position);
    wrap.rotation.copy(scarecrowSpot.rotation);
    wrap.add(skeleton);
    wrap.userData.full = scale * 1.15;
    wrap.scale.setScalar(0.001);
    wrap.visible = false;
    root.add(wrap);
    attach?.(wrap);
    items.skeleton = { wrap, k: 0, on: false };
  }
  place('sunflowers', makeSunflowers(), 0.35, 1.6, 1.15);
  place('flowers', makeSpringFlowers(), 0.45, 2.6, 1.15);
  // the other festivals: the Easter basket (and bunny), the flag for the Fourth, the harvest display
  const basket = makeEasterBasket();
  place('easterBasket', basket, 0.45, 0.7, 1.2);
  const flag = makeFlagpole();
  place('flag', flag, 0.5, 1.3, 1.15); // (room for the flag as well as the pole: it reaches 0.6 out)
  place('harvest', makeHarvestDisplay(), 0.6, 0.9, 1.1);

  // ---- an Easter egg hunt: eggs hidden about the grass round the farmyard (tiny: the sheep step
  // over them, so they don't take a spot)
  const eggSpots = [];
  for (const d of [1.5, 2.1, 2.7, 3.3, 4.0, 4.8]) {
    const n = Math.round(d * 5);
    for (let i = 0; i < n && eggSpots.length < 18; i++) {
      const a = (i / n) * Math.PI * 2 + d * 1.7;
      const x = home[0] + Math.cos(a) * d, z = home[1] + Math.sin(a) * d;
      if (hiddenByBarn(x, z) || !free(x, z, 0.06)) continue;
      if (eggSpots.some((e) => Math.hypot(e.x - x, e.z - z) < 0.6)) continue;
      eggSpots.push({ x, z, y: view.heightAt(x, z), tilt: ((eggSpots.length * 7) % 5 - 2) * 0.25, spin: eggSpots.length * 1.3 });
    }
  }
  const eggMat = soft(0xffffff, { roughness: 0.5 });
  eggMat.userData.noSeason = true;
  const eggs = new THREE.InstancedMesh(eggGeometry(), eggMat, Math.max(1, eggSpots.length));
  eggs.name = 'Easter eggs';
  eggs.castShadow = true;
  eggs.visible = false;
  eggSpots.forEach((_, i) => eggs.setColorAt(i, new THREE.Color(EGG_COLORS[i % EGG_COLORS.length])));
  if (!eggSpots.length) eggs.count = 0;
  root.add(eggs);
  let eggK = 0;
  const placeEggs = (k) => {
    const em = new THREE.Matrix4(), eq = new THREE.Quaternion(), ee = new THREE.Euler(), ep = new THREE.Vector3(), es = new THREE.Vector3();
    eggSpots.forEach((e, i) => {
      const kk = Math.max(0, Math.min(1, k * 1.6 - (i % 6) * 0.1)); // they turn up one after another
      eggs.setMatrixAt(i, em.compose(ep.set(e.x, e.y, e.z), eq.setFromEuler(ee.set(e.tilt, e.spin, e.tilt * 0.5)), es.setScalar(Math.max(0.001, easeOutBack(kk) * scale * 1.3))));
    });
    eggs.instanceMatrix.needsUpdate = true;
  };

  // ---- fireworks for the Fourth of July and New Year
  const fireworks = createFireworks(view);
  root.add(fireworks.mesh);
  let night = 0;

  // ---- on the barn (in its own space: door faces +z, eaves at y 1.28, ridge at y 2.27)
  const barnBits = new THREE.Group();
  barnBits.name = 'Barn decorations';
  if (view.barn) view.barn.add(barnBits);
  for (const [name, make] of [['wreath', makeWreath], ['harvestWreath', makeHarvestWreath]]) {
    const w = make();
    w.position.set(0, 0.68, 0.88);
    w.visible = false;
    barnBits.add(w);
    items[name] = { wrap: w, k: 0, on: false };
    w.userData.full = 1.7;
  }
  // a pumpkin either side of the door in fall, carved and glowing for Halloween
  for (const [name, carved] of [['doorPumpkins', false], ['doorLanterns', true]]) {
    const g = new THREE.Group();
    g.name = name;
    // (the bench is at x -1.15..-0.55, z 1.02..1.22: the left one sits in front of its door end)
    [[-0.5, 1.45, 1.2], [0.62, 1.12, 1.1]].forEach(([x, z, sz], i) => {
      const p = makePumpkin(i + 4, { carved, size: sz });
      p.position.set(x, 0, z);
      g.add(p);
      if (p.userData.face) faces.push(p.userData.face);
    });
    g.visible = false;
    g.userData.full = 1;
    barnBits.add(g);
    items[name] = { wrap: g, k: 0, on: false };
  }
  const outline = [[-1.33, 1.27, 0.99], [-0.66, 1.27, 0.99], [0, 1.27, 0.99], [0.66, 1.27, 0.99], [1.33, 1.27, 0.99], [1.36, 1.77, 0.5], [1.38, 2.3, 0]];
  const outline2 = [[-1.38, 2.3, 0], [-1.36, 1.77, 0.5], [-1.33, 1.27, 0.99]];
  const lightSets = {
    christmas: [makeStringLights(outline, { colors: [0xff5a4f, 0xffd24a, 0x5fd06a, 0x5aa0ff, 0xffffff], spacing: 0.16, size: 0.05 }), makeStringLights(outline2, { colors: [0x5aa0ff, 0xff5a4f, 0xffd24a, 0x5fd06a], spacing: 0.16, size: 0.05 })],
    halloween: [makeStringLights(outline, { colors: [0xff8a2a, 0xa565e0], spacing: 0.16, size: 0.05 }), makeStringLights(outline2, { colors: [0xa565e0, 0xff8a2a], spacing: 0.16, size: 0.05 })],
    newyear: [makeStringLights(outline, { colors: [0xffd36b, 0xffffff, 0xffc04a, 0xe8e0ff], spacing: 0.14, size: 0.045 }), makeStringLights(outline2, { colors: [0xe8e0ff, 0xffd36b, 0xffffff], spacing: 0.14, size: 0.045 })],
  };
  for (const [key, set] of Object.entries(lightSets)) {
    const g = new THREE.Group();
    g.name = `${key} lights`;
    set.forEach((l) => { g.add(l); twinkles.push(l); });
    g.visible = false;
    barnBits.add(g);
    lightSets[key] = g;
  }
  // bunting along the same eaves, a little below and in front of where the lights go
  const low = (pts) => pts.map(([x, y, z]) => [x, y - 0.05, z + 0.04]);
  const buntingSets = {};
  for (const [key, colors] of Object.entries(BUNTING_COLORS)) {
    const g = new THREE.Group();
    g.name = `${key} bunting`;
    const a = makeBunting(low(outline), colors), b = makeBunting(low(outline2), colors.slice().reverse());
    g.add(a, b);
    g.userData.update = (time) => { a.userData.update(time); b.userData.update(time); };
    g.visible = false;
    barnBits.add(g);
    buntingSets[key] = g;
  }

  // ---- bats circling the barn
  const bats = new THREE.InstancedMesh(batGeometry(), (() => { const m = new THREE.MeshBasicMaterial({ color: 0x3a2b48, side: THREE.DoubleSide }); m.userData.noSeason = true; return m; })(), 8);
  bats.name = 'Bats';
  bats.frustumCulled = false;
  bats.visible = false;
  root.add(bats);
  attach?.(barnBits); // the wreath and door pumpkins get snow like everything else
  const batInfo = [...Array(8)].map((_, i) => ({ r: 1.6 + (i % 4) * 0.6, h: 2.6 + (i % 3) * 0.45, sp: 0.5 + (i % 5) * 0.12, ph: i * 0.8 }));

  let want = {};
  let lightsOn = null;

  function setState(state) {
    want = decorFor(state);
    lightsOn = want.lights;
  }
  /** How dark it is (0 day .. 1 night, from src/island/dayNight.js): fireworks shine brighter at night. */
  const setNight = (n) => { night = n; };

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  function update(dt, time) {
    // with reduced motion: no popping, twinkling, flickering or flying (things simply appear, lit)
    const reduced = reducedQuery.matches;
    if (reduced) time = 0.4;
    for (const [name, it] of Object.entries(items)) {
      const on = !!want[name];
      it.k = reduced ? (on ? 1 : 0) : Math.max(0, Math.min(1, it.k + (on ? dt : -dt) * 3));
      it.wrap.visible = it.k > 0.001;
      const full = it.wrap.userData.full ?? scale;
      it.wrap.scale.setScalar(Math.max(0.001, (on ? easeOutBack(it.k) : it.k) * full));
    }
    for (const [key, g] of Object.entries(lightSets)) g.visible = lightsOn === key;
    for (const tw of twinkles) if (tw.parent?.visible !== false && isShown(tw)) tw.userData.update(time);
    for (const [key, g] of Object.entries(buntingSets)) {
      g.visible = want.bunting === key;
      if (g.visible && isShown(g)) g.userData.update(time);
    }
    if (items.flag?.wrap.visible) flag.userData.wave(time);
    // the bunny's ears twitch now and then
    if (items.easterBasket?.wrap.visible) {
      const tw = Math.max(0, Math.sin(time * 1.3) - 0.9) * 4;
      basket.userData.bunny.userData.ears.forEach((ear, i) => { ear.rotation.x = -tw * (i ? 0.35 : 0.2); });
    }
    // the eggs: hidden about the grass one after another, gone again after Easter
    const eggTo = want.eggs ? 1 : 0;
    if (eggK !== eggTo || (eggTo && !eggs.visible)) {
      eggK = reduced ? eggTo : Math.max(0, Math.min(1, eggK + (eggTo ? dt : -dt) * 1.6));
      eggs.visible = eggK > 0.001;
      if (eggs.visible) placeEggs(eggK);
    }
    // the skeleton's eyes glow in the dark
    if (items.skeleton?.wrap.visible) skeleton.userData.eyes.color.setRGB(0.61, 1, 0.42).multiplyScalar(0.55 + 0.45 * night);
    // fireworks (none with reduced motion: they're nothing but motion)
    fireworks.mesh.visible = !!want.fireworks && !reduced && night > 0.25; // a night-time show
    if (fireworks.mesh.visible) fireworks.update(time, FIREWORK_COLORS[want.fireworks], night);
    // the jack-o'-lanterns flicker
    const f = reduced ? 0.92 : 0.82 + 0.18 * Math.sin(time * 13) * Math.sin(time * 7.3);
    faces.forEach((m) => m.color.setRGB(1 * f, 0.76 * f, 0.29 * f));
    // bats
    bats.visible = !!want.bats && !reduced;
    if (bats.visible) {
      batInfo.forEach((b, i) => {
        const a = time * b.sp + b.ph;
        p.set(barnAt[0] + Math.cos(a) * b.r, view.heightAt(barnAt[0], barnAt[1]) + b.h + Math.sin(time * 2 + i) * 0.15, barnAt[1] + Math.sin(a) * b.r);
        e.set(0, -a, 0);
        s.set(0.35 + Math.abs(Math.sin(time * 11 + i)) * 0.65, 1, 1);
        bats.setMatrixAt(i, m4.compose(p, q.setFromEuler(e), s));
      });
      bats.instanceMatrix.needsUpdate = true;
    }
  }

  /** Decorations arrive or leave at once (no pop), e.g. when the play-through is paused. */
  function snap() {
    for (const [name, it] of Object.entries(items)) it.k = want[name] ? 1 : 0;
    eggK = want.eggs ? 1 : 0;
    eggs.visible = eggK > 0;
    if (eggs.visible) placeEggs(1);
    update(0, 0.4);
  }

  function isShown(o) { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; }

  function dispose() {
    root.parent?.remove(root);
    barnBits.parent?.remove(barnBits);
    // free the spots again
    if (view.obstacles) for (const t of taken) { const i = view.obstacles.indexOf(view.obstacles.find((o) => o.x === t.x && o.z === t.z)); if (i >= 0) view.obstacles.splice(i, 1); }
  }

  return { setState, setNight, update, snap, dispose, root, get spots() { return taken.slice(); } };
}
