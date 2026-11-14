// More farm buildings for the island, in the barn's style (chunky low-poly boxes, flat shading,
// warm lit windows):
//
//   makeFarmhouse()     the family house: cream walls, terracotta roof, porch, chimney
//   makeMachineShed()   an open-fronted equipment shed with a red tractor parked inside
//   makeTractor()       the tractor on its own (faces +z)
//   makeGrainBins()     three corrugated grain bins with cone roofs, an auger and a ladder
//   makeChickenCoop()   a little coop on stilts, a fenced run and a few hens
//   makeGreenhouse()    a glass hoop house with rows of seedlings inside
//   makeWell()          a stone well with a roof and a bucket
//
// Every one stands on y = 0 with its front facing +z, like the barn. BUILDING_FOOTPRINT is the
// radius each needs (at scale 1) to stay clear of fences, other buildings and the sheep's paths.
import * as THREE from 'three';
import { glowMat, mat, mesh, rng, soft } from './props.js';

export const BUILDING_FOOTPRINT = {
  farmhouse: 1.0,
  machineShed: 1.05,
  grainBins: 0.95,
  chickenCoop: 0.85,
  greenhouse: 0.9,
  well: 0.32,
};

const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };

const box = (w, h, d, color, x = 0, y = 0, z = 0) => {
  const m = mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
};

/** A gable end: a triangle w wide and h tall, extruded d thick, base on y = 0, centred on x. */
function gable(w, h, d, color) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0);
  sh.lineTo(w / 2, 0);
  sh.lineTo(0, h);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return mesh(g, mat(color));
}

/** A window: frame, lit pane and cross bars, facing +z (rotate the group for other walls). */
function windowPane(w = 0.26, h = 0.24) {
  const g = new THREE.Group();
  g.add(box(w + 0.06, h + 0.06, 0.04, 0xf4ecdc));
  const pane = mesh(new THREE.BoxGeometry(w, h, 0.04), glowMat(0xffe1a0, 0xffc766, 0.65, 0.6));
  pane.position.z = 0.012;
  g.add(pane);
  g.add(box(w, 0.025, 0.02, 0xf4ecdc, 0, 0, 0.035));
  g.add(box(0.025, h, 0.02, 0xf4ecdc, 0, 0, 0.035));
  return g;
}

/** A gable roof along x: two boards meeting at a ridge. */
function gableRoof(len, halfSpan, rise, color, ridgeColor, y) {
  const g = new THREE.Group();
  const slope = Math.hypot(halfSpan, rise);
  const ang = Math.atan2(rise, halfSpan);
  for (const s of [-1, 1]) {
    const b = box(len, 0.07, slope + 0.12, color);
    b.position.set(0, y + rise / 2, (s * halfSpan) / 2);
    b.rotation.x = s * ang;
    g.add(b);
  }
  const ridge = mesh(new THREE.CylinderGeometry(0.055, 0.055, len + 0.04, 8), soft(ridgeColor));
  ridge.rotation.z = Math.PI / 2;
  ridge.position.y = y + rise + 0.02;
  g.add(ridge);
  return g;
}

// ---------------------------------------------------------------------------------------------

/** The farmhouse: 1.5 wide, 1.2 deep, about 1.9 tall to the chimney. */
export function makeFarmhouse(seed = 2) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.name = 'Farmhouse';
  g.add(box(1.5, 0.12, 1.18, 0xbfb8aa, 0, 0.06, -0.04)); // stone base
  const wallC = 0xf1e3c8, trim = 0xf8f1e2, roofC = 0xc9765c, roofDark = 0xa85d48;
  g.add(box(1.3, 0.82, 0.92, wallC, 0, 0.53, -0.06));
  // siding lines
  for (let k = 0; k < 5; k++) g.add(box(1.31, 0.015, 0.93, 0xe6d6b8, 0, 0.22 + k * 0.15, -0.06));
  // gable ends and roof
  for (const x of [-0.65, 0.65]) {
    const ge = gable(0.92, 0.48, 0.04, wallC);
    ge.rotation.y = Math.PI / 2;
    ge.position.set(x, 0.94, -0.06);
    g.add(ge);
  }
  g.add(at(gableRoof(1.5, 0.56, 0.5, roofC, roofDark, 0.92), 0, 0, -0.06));
  // chimney
  g.add(box(0.2, 0.55, 0.2, 0xb0897a, 0.42, 1.48, -0.25));
  g.add(box(0.26, 0.06, 0.26, 0x8f7064, 0.42, 1.78, -0.25));
  // front: door, windows, porch
  g.add(box(0.28, 0.5, 0.04, 0x6f9a6a, 0, 0.37, 0.41));
  g.add(box(0.04, 0.04, 0.02, 0xe9c46a, 0.09, 0.36, 0.44)); // knob
  for (const x of [-0.42, 0.42]) {
    const w = windowPane();
    w.position.set(x, 0.62, 0.41);
    g.add(w);
    g.add(box(0.34, 0.08, 0.1, 0x7d9c4b, x, 0.45, 0.45)); // flower box
    for (let k = 0; k < 4; k++) {
      const fl = mesh(new THREE.IcosahedronGeometry(0.035, 0), mat(r.pick([0xf3b6c8, 0xf6dc6e, 0xb7a7ec, 0xfaf5ec])));
      fl.position.set(x - 0.11 + k * 0.075, 0.51, 0.46);
      g.add(fl);
    }
  }
  for (const s of [-1, 1]) {
    const w = windowPane(0.22, 0.22);
    w.rotation.y = s * Math.PI / 2;
    w.position.set(s * 0.66, 0.62, -0.06);
    g.add(w);
  }
  // porch: deck, two posts, a little roof, steps
  g.add(box(0.9, 0.06, 0.34, 0xa98363, 0, 0.14, 0.57));
  for (const x of [-0.4, 0.4]) g.add(box(0.05, 0.62, 0.05, trim, x, 0.47, 0.71));
  const pr = box(1.0, 0.05, 0.42, roofC, 0, 0.8, 0.6);
  pr.rotation.x = 0.28;
  g.add(pr);
  g.add(box(0.36, 0.05, 0.14, 0xa98363, 0, 0.06, 0.8));
  // a rocking chair-ish bench on the porch
  g.add(box(0.26, 0.04, 0.12, 0x8a6a4d, -0.25, 0.3, 0.6));
  g.add(box(0.26, 0.16, 0.03, 0x8a6a4d, -0.25, 0.4, 0.54));
  for (const lx of [-0.36, -0.14]) for (const lz of [0.55, 0.65]) g.add(box(0.025, 0.11, 0.025, 0x6f5540, lx, 0.225, lz));
  return g;
}

/** A tractor: red body, big black rear wheels, cab frame. About 0.75 long. Faces +z. */
export function makeTractor() {
  const g = new THREE.Group();
  g.name = 'Tractor';
  const red = 0xd9493d, dark = 0x34302e, hub = 0xe9c46a;
  g.add(box(0.3, 0.2, 0.46, red, 0, 0.28, 0.08)); // hood
  g.add(box(0.36, 0.14, 0.3, red, 0, 0.3, -0.2)); // body under the seat
  g.add(box(0.31, 0.06, 0.02, 0x5c5c5c, 0, 0.3, 0.32)); // grille
  for (const s of [-1, 1]) {
    const w = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 14), mat(dark));
    w.rotation.z = Math.PI / 2;
    w.position.set(s * 0.24, 0.2, -0.2);
    g.add(w);
    const h = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.11, 10), mat(hub));
    h.rotation.z = Math.PI / 2;
    h.position.set(s * 0.24, 0.2, -0.2);
    g.add(h);
    const f = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12), mat(dark));
    f.rotation.z = Math.PI / 2;
    f.position.set(s * 0.17, 0.11, 0.2);
    g.add(f);
    const fh = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 8), mat(hub));
    fh.rotation.z = Math.PI / 2;
    fh.position.set(s * 0.17, 0.11, 0.2);
    g.add(fh);
  }
  // cab: four posts and a roof
  for (const [x, z] of [[-0.15, -0.08], [0.15, -0.08], [-0.15, -0.32], [0.15, -0.32]]) g.add(box(0.025, 0.36, 0.025, dark, x, 0.55, z));
  g.add(box(0.36, 0.04, 0.32, red, 0, 0.74, -0.2));
  g.add(box(0.14, 0.05, 0.12, 0x3d3a38, 0, 0.4, -0.22)); // seat
  const pipe = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 6), mat(0x5c5c5c));
  pipe.position.set(0.09, 0.5, 0.22);
  g.add(pipe);
  return g;
}

/** An open-fronted machine shed with the tractor parked inside: 1.6 wide, 1.2 deep. */
export function makeMachineShed() {
  const g = new THREE.Group();
  g.name = 'Machine shed';
  const metal = [0x9fb0c2, 0x8fa1b4], frame = 0x6d7d8f, roofC = 0xb6604c;
  g.add(box(1.6, 0.06, 1.2, 0xc4bcae, 0, 0.03, 0));
  // back and side walls, ribbed
  g.add(box(1.6, 0.95, 0.05, metal[0], 0, 0.5, -0.58));
  for (let k = 0; k < 9; k++) g.add(box(0.03, 0.95, 0.02, metal[1], -0.72 + k * 0.18, 0.5, -0.55));
  // side walls: taller at the front, so they meet the sloping roof all the way along
  const sideShape = new THREE.Shape();
  sideShape.moveTo(-0.58, 0.025);
  sideShape.lineTo(0.58, 0.025);
  sideShape.lineTo(0.58, 0.975);
  sideShape.lineTo(-0.58, 1.115);
  sideShape.closePath();
  for (const s of [-1, 1]) {
    const sg = new THREE.ExtrudeGeometry(sideShape, { depth: 0.05, bevelEnabled: false });
    sg.translate(0, 0, -0.025);
    const side = mesh(sg, mat(metal[0]));
    side.rotation.y = Math.PI / 2; // the shape's -x end becomes the front (+z)
    side.position.x = s * 0.78;
    g.add(side);
    for (let k = 0; k < 6; k++) g.add(box(0.02, 0.95, 0.03, metal[1], s * 0.81, 0.5, -0.5 + k * 0.2));
  }
  // front posts and header, up to the roof
  for (const x of [-0.78, 0, 0.78]) g.add(box(0.07, 1.1, 0.07, frame, x, 0.55, 0.57));
  g.add(box(1.62, 0.1, 0.08, frame, 0, 1.065, 0.57));
  // single-slope roof, higher at the front
  const roof = box(1.76, 0.06, 1.36, roofC, 0, 1.08, 0);
  roof.rotation.x = -0.12;
  g.add(roof);
  for (let k = 0; k < 8; k++) {
    const rib = box(0.03, 0.02, 1.36, 0x9d4f3e, -0.77 + k * 0.22, 1.115, 0);
    rib.rotation.x = -0.12;
    g.add(rib);
  }
  const t = makeTractor();
  t.position.set(-0.32, 0.06, 0.08);
  g.add(t);
  // a fuel drum and a few sacks
  const drum = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 12), mat(0x4f8a46));
  drum.position.set(0.5, 0.21, -0.35);
  g.add(drum);
  for (const [x, z] of [[0.3, -0.4], [0.42, -0.2]]) {
    const sack = mesh(new THREE.SphereGeometry(0.1, 8, 6), mat(0xe2d3ae));
    sack.scale.set(1.2, 0.7, 0.9);
    sack.position.set(x, 0.12, z);
    g.add(sack);
  }
  return g;
}

/** Three grain bins with cone roofs, a slanted auger and a ladder. About 1.6 wide. */
export function makeGrainBins() {
  const g = new THREE.Group();
  g.name = 'Grain bins';
  const shades = [0xc9ccd2, 0xbfc3ca, 0xd3d6db];
  const bins = [[-0.5, 0.05, 0.34, 0.95], [0.2, -0.12, 0.38, 1.05], [0.72, 0.25, 0.26, 0.75]];
  bins.forEach(([x, z, rad, h], i) => {
    g.add(at(mesh(new THREE.CylinderGeometry(rad + 0.04, rad + 0.04, 0.06, 18), mat(0xbfb8aa)), x, 0.03, z));
    const body = mesh(new THREE.CylinderGeometry(rad, rad, h, 18, 6), mat(shades[i]));
    body.position.set(x, h / 2 + 0.05, z);
    g.add(body);
    // corrugation bands
    for (let k = 1; k < 5; k++) {
      const band = mesh(new THREE.CylinderGeometry(rad + 0.008, rad + 0.008, 0.02, 18), mat(0xa9aeb6));
      band.position.set(x, 0.05 + (h * k) / 5, z);
      g.add(band);
    }
    const roof = mesh(new THREE.ConeGeometry(rad + 0.04, rad * 0.7, 18), mat(0xd9dce0));
    roof.position.set(x, 0.05 + h + rad * 0.35, z);
    g.add(roof);
    const cap = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 8), mat(0x9aa0a8));
    cap.position.set(x, 0.05 + h + rad * 0.7 + 0.02, z);
    g.add(cap);
  });
  // ladder up the big bin
  for (const dx of [-0.07, 0.07]) g.add(box(0.02, 1.05, 0.02, 0x7d8590, 0.2 + dx, 0.58, -0.12 + 0.4));
  for (let k = 0; k < 8; k++) g.add(box(0.15, 0.015, 0.015, 0x7d8590, 0.2, 0.15 + k * 0.12, 0.28));
  // auger: a long slanted pipe from the ground to the big bin's roof
  const aug = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.45, 8), mat(0xe2b43c));
  aug.position.set(0.08, 0.68, 0.53);
  aug.rotation.set(-0.62, 0, -0.18); // low end on the hopper (front), high end over the big bin's roof
  g.add(aug);
  g.add(box(0.14, 0.18, 0.14, 0xe2b43c, -0.05, 0.09, 0.95));
  return g;
}

/** A chicken coop on short stilts with a ramp, a fenced run and four hens. About 1.4 wide. */
export function makeChickenCoop(seed = 4) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.name = 'Chicken coop';
  const wall = 0xd8a65a, roofC = 0x8ccab3, wood = 0x8a6a4d;
  for (const [x, z] of [[-0.42, -0.42], [0.02, -0.42], [-0.42, -0.08], [0.02, -0.08]]) g.add(box(0.05, 0.22, 0.05, wood, x, 0.11, z));
  g.add(box(0.56, 0.4, 0.46, wall, -0.2, 0.42, -0.25));
  for (let k = 0; k < 4; k++) g.add(box(0.025, 0.4, 0.47, 0xc8954c, -0.44 + k * 0.16, 0.42, -0.25));
  for (const x of [-0.48, 0.08]) {
    const ge = gable(0.46, 0.22, 0.03, wall);
    ge.rotation.y = Math.PI / 2;
    ge.position.set(x, 0.62, -0.25);
    g.add(ge);
  }
  g.add(at(gableRoof(0.68, 0.27, 0.22, roofC, 0x6faa94, 0.61), -0.2, 0, -0.25));
  g.add(box(0.14, 0.16, 0.03, 0x5c4433, -0.2, 0.34, -0.01)); // hen door
  const ramp = box(0.14, 0.02, 0.36, wood, -0.2, 0.13, 0.13);
  ramp.rotation.x = 0.5;
  g.add(ramp);
  // the run: a low fence round a patch of dirt
  g.add(at(mesh(new THREE.BoxGeometry(1.3, 0.02, 0.62), mat(0xc9ad83), false, true), 0.05, 0.01, 0.42));
  const posts = [[-0.6, 0.12], [-0.2, 0.12], [0.3, 0.12], [0.7, 0.12], [0.7, 0.42], [0.7, 0.72], [0.3, 0.72], [-0.15, 0.72], [-0.6, 0.72], [-0.6, 0.42]];
  posts.forEach(([x, z]) => g.add(box(0.04, 0.24, 0.04, wood, x, 0.12, z)));
  for (const y of [0.1, 0.2]) {
    g.add(box(1.3, 0.025, 0.02, wood, 0.05, y, 0.72));
    g.add(box(0.02, 0.025, 0.6, wood, 0.7, y, 0.42));
    g.add(box(0.02, 0.025, 0.6, wood, -0.6, y, 0.42));
    g.add(box(0.5, 0.025, 0.02, wood, 0.45, y, 0.12));
  }
  // hens: a round body, a tail tuft, a head with comb and beak
  const hens = [[-0.3, 0.45, 0.4], [0.05, 0.55, -0.6], [0.4, 0.38, 2.2], [0.48, 0.6, -1.4]];
  hens.forEach(([x, z, ry]) => {
    const hen = new THREE.Group();
    const col = r.pick([0xfaf6ee, 0xd9a066, 0xfaf6ee]);
    const body = mesh(new THREE.SphereGeometry(0.075, 8, 6), mat(col));
    body.scale.set(1, 0.85, 1.25);
    body.position.y = 0.08;
    hen.add(body);
    const tail = mesh(new THREE.ConeGeometry(0.04, 0.08, 5), mat(col));
    tail.position.set(0, 0.12, -0.09);
    tail.rotation.x = -0.8;
    hen.add(tail);
    const head = mesh(new THREE.SphereGeometry(0.04, 7, 5), mat(col));
    head.position.set(0, 0.15, 0.07);
    hen.add(head);
    hen.add(box(0.015, 0.035, 0.04, 0xd8453c, 0, 0.195, 0.07));
    const beak = mesh(new THREE.ConeGeometry(0.014, 0.035, 4), mat(0xf2b843));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.145, 0.115);
    hen.add(beak);
    hen.position.set(x, 0.02, z);
    hen.rotation.y = ry;
    g.add(hen);
  });
  return g;
}

/** A hoop greenhouse: white ribs, glass, and rows of seedlings on two benches. About 1.5 long. */
export function makeGreenhouse() {
  const g = new THREE.Group();
  g.name = 'Greenhouse';
  const len = 1.4, rad = 0.48;
  g.add(box(len + 0.1, 0.2, rad * 2 + 0.1, 0xc4bcae, 0, -0.04, 0)); // floor slab, reaching 0.14 below ground (no gap on a slight slope)
  // low side walls
  for (const s of [-1, 1]) g.add(box(len, 0.16, 0.05, 0xe9e4da, 0, 0.14, s * rad));
  // glass: half a cylinder along x (see-through, so it isn't snowed on)
  const glassM = new THREE.MeshStandardMaterial({ color: 0xdff1f5, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 18, 1, true, 0, Math.PI), glassM);
  glass.rotation.z = Math.PI / 2; // the cylinder's +x half becomes the top, its axis runs along x
  glass.position.y = 0.22;
  g.add(glass);
  // ribs
  for (let k = 0; k <= 5; k++) {
    const rib = mesh(new THREE.TorusGeometry(rad, 0.018, 4, 14, Math.PI), mat(0xf7f7f2));
    rib.rotation.y = Math.PI / 2;
    rib.position.set(-len / 2 + (k * len) / 5, 0.22, 0);
    g.add(rib);
  }
  const ridge = box(len, 0.03, 0.03, 0xf7f7f2, 0, 0.22 + rad, 0);
  g.add(ridge);
  // end walls with a door
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.CircleGeometry(rad, 18, 0, Math.PI), glassM);
    end.rotation.y = s * Math.PI / 2;
    end.position.set(s * len / 2, 0.22, 0);
    g.add(end);
  }
  g.add(box(0.03, 0.42, 0.24, 0xf7f7f2, len / 2 + 0.01, 0.25, 0));
  // benches with seedlings
  for (const z of [-0.22, 0.22]) {
    g.add(box(len - 0.2, 0.04, 0.24, 0x8a6a4d, 0, 0.3, z));
    for (const lx of [-0.56, 0.56]) for (const lz of [-0.1, 0.1]) g.add(box(0.03, 0.22, 0.03, 0x6f5540, lx, 0.17, z + lz));
    for (let k = 0; k < 7; k++) {
      const pot = mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.05, 6), mat(0xc0704e));
      pot.position.set(-0.54 + k * 0.18, 0.345, z);
      g.add(pot);
      const leaf = mesh(new THREE.IcosahedronGeometry(0.05, 0), mat(k % 3 ? 0x7fbf5a : 0x9fd36a));
      leaf.position.set(-0.54 + k * 0.18, 0.4, z);
      g.add(leaf);
    }
  }
  return g;
}

/** A stone well with a little roof, a crank and a bucket. */
export function makeWell() {
  const g = new THREE.Group();
  g.name = 'Well';
  // an open stone ring (reaching a little below ground), its inner wall, a stone rim, and the water
  const ring = mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.38, 12, 1, true), mat(0xb9b3a6, { side: THREE.DoubleSide }));
  ring.position.y = 0.07;
  g.add(ring);
  const inner = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.36, 12, 1, true), mat(0x9d978a, { side: THREE.BackSide }));
  inner.position.y = 0.08;
  g.add(inner);
  const rim = mesh(new THREE.RingGeometry(0.17, 0.225, 12), mat(0xc7c1b4, { side: THREE.DoubleSide }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.26;
  g.add(rim);
  const water = mesh(new THREE.CircleGeometry(0.17, 12), mat(0x7a7fc4));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.18;
  g.add(water);
  for (const s of [-1, 1]) g.add(box(0.04, 0.58, 0.04, 0x8a6a4d, s * 0.2, 0.49, 0));
  const roof = gableRoof(0.5, 0.2, 0.14, 0xc9765c, 0xa85d48, 0.68);
  g.add(roof);
  const axle = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.44, 6), mat(0x6e5139));
  axle.rotation.z = Math.PI / 2;
  axle.position.y = 0.55;
  g.add(axle);
  const bucket = mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.08, 8), mat(0x8fb7c9));
  bucket.position.set(0.06, 0.4, 0);
  g.add(bucket);
  return g;
}
