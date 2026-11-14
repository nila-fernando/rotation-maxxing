// Festival costumes for the sheep: two looks per festival, taken in turn (sheep 0 gets the first,
// sheep 1 the second, ...). The theme manager (./index.js) puts one on every sheep's head.
//
//   costumeFor('halloween', i) -> THREE.Group
//
// Island units; origin = the top of the sheep's head between the ears, +y up, +z the way the sheep
// faces. A sheep's head is about 0.2 wide, so the hats are made a little big: they need to read
// from across the island.
import * as THREE from 'three';
import { mat, mesh, soft } from '../props.js';

const part = (g, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const o = mesh(geo, m, false, false);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  g.add(o);
  return o;
};
const glowMat = (color) => { const m = new THREE.MeshBasicMaterial({ color }); m.userData.noSeason = true; return m; };

/** A witch's hat: wide black brim, a tall bent cone, a purple band and a gold buckle. */
function witchHat() {
  const g = new THREE.Group();
  const black = mat(0x2a2430);
  part(g, new THREE.CylinderGeometry(0.19, 0.2, 0.018, 16), black, 0, 0.01, 0);
  part(g, new THREE.CylinderGeometry(0.075, 0.105, 0.17, 12), black, 0, 0.1, -0.01, -0.12);
  part(g, new THREE.ConeGeometry(0.075, 0.17, 12), black, 0, 0.25, -0.05, -0.55);
  part(g, new THREE.CylinderGeometry(0.106, 0.107, 0.04, 12), mat(0x8a4fd0), 0, 0.04, 0);
  part(g, new THREE.BoxGeometry(0.05, 0.045, 0.01), mat(0xf2c14e), 0, 0.04, 0.105);
  g.rotation.z = 0.12;
  return g;
}

/** A little pumpkin worn as a cap, with a leafy stem. */
function pumpkinCap() {
  const g = new THREE.Group();
  const p = part(g, new THREE.SphereGeometry(0.11, 12, 8), mat(0xec832c, { flatShading: true }), 0, 0.06, 0);
  p.scale.set(1.15, 0.72, 1.1);
  part(g, new THREE.CylinderGeometry(0.014, 0.022, 0.08, 6), mat(0x6f7f3a), 0.01, 0.16, 0, 0, 0, 0.25);
  part(g, new THREE.BoxGeometry(0.07, 0.008, 0.04), mat(0x5f8a39), 0.05, 0.15, 0, 0, 0.4, -0.3);
  // a grin carved in the front, glowing at night
  const face = glowMat(0xffc24a);
  for (const s of [-1, 1]) part(g, new THREE.ConeGeometry(0.018, 0.03, 3), face, s * 0.035, 0.08, 0.118, Math.PI / 2);
  part(g, new THREE.BoxGeometry(0.07, 0.016, 0.01), face, 0, 0.045, 0.118);
  g.userData.update = (time, night) => face.color.setRGB(1, 0.76, 0.29).multiplyScalar(0.55 + 0.45 * night);
  return g;
}

/** Santa's hat: a red cone flopping to one side, white fur trim and pom-pom. */
function santaHat() {
  const g = new THREE.Group();
  const red = soft(0xd23a3a, { roughness: 0.8 }), white = soft(0xf6f4f0, { roughness: 1 });
  part(g, new THREE.CylinderGeometry(0.07, 0.105, 0.14, 12), red, 0, 0.07, 0);
  const tip = part(g, new THREE.ConeGeometry(0.07, 0.17, 12), red, 0.06, 0.18, -0.02, 0, 0, -0.95);
  part(g, new THREE.TorusGeometry(0.105, 0.03, 8, 18), white, 0, 0.01, 0, Math.PI / 2);
  const pom = part(g, new THREE.SphereGeometry(0.038, 10, 8), white, 0.15, 0.2, -0.02);
  g.userData.update = (time) => {
    const b = Math.sin(time * 3.2) * 0.012;
    pom.position.y = 0.2 + b;
    tip.rotation.z = -0.95 - b * 2;
  };
  return g;
}

/** Reindeer antlers and a glowing red nose. */
function antlers() {
  const g = new THREE.Group();
  const horn = mat(0x8a5a35);
  for (const s of [-1, 1]) {
    part(g, new THREE.CylinderGeometry(0.014, 0.018, 0.2, 6), horn, s * 0.06, 0.09, -0.01, 0, 0, -s * 0.35);
    part(g, new THREE.CylinderGeometry(0.011, 0.013, 0.1, 6), horn, s * 0.1, 0.17, 0.02, 0.5, 0, -s * 0.9);
    part(g, new THREE.CylinderGeometry(0.011, 0.013, 0.09, 6), horn, s * 0.06, 0.2, -0.03, -0.4, 0, -s * 0.1);
    part(g, new THREE.CylinderGeometry(0.01, 0.012, 0.08, 6), horn, s * 0.13, 0.12, -0.02, 0, 0, -s * 1.2);
  }
  const nose = glowMat(0xff3a2a);
  part(g, new THREE.SphereGeometry(0.035, 10, 8), nose, 0, -0.09, 0.15);
  g.userData.update = (time, night) => nose.color.setRGB(1, 0.23, 0.16).multiplyScalar(0.6 + 0.4 * night + 0.15 * Math.sin(time * 4));
  return g;
}

/** Tall bunny ears, white with pink insides. */
function bunnyEars() {
  const g = new THREE.Group();
  const white = soft(0xfbf8f4, { roughness: 0.9 }), pink = mat(0xf4a6bd);
  part(g, new THREE.CylinderGeometry(0.1, 0.1, 0.025, 14), mat(0xf4a6bd), 0, 0.01, 0); // the headband
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.05, 0.02, 0);
    ear.rotation.z = -s * 0.2;
    const outer = part(ear, new THREE.SphereGeometry(0.045, 10, 8), white, 0, 0.13, 0);
    outer.scale.set(0.75, 3, 0.45);
    const inner = part(ear, new THREE.SphereGeometry(0.03, 8, 6), pink, 0, 0.13, 0.016);
    inner.scale.set(0.7, 3.2, 0.3);
    g.add(ear);
    ears.push(ear);
  }
  g.userData.update = (time) => { const w = Math.max(0, Math.sin(time * 1.7) - 0.85) * 2.5; ears[1].rotation.x = -w * 0.6; };
  return g;
}

/** A crown of pastel spring flowers. */
function flowerCrown() {
  const g = new THREE.Group();
  part(g, new THREE.TorusGeometry(0.1, 0.016, 6, 18), mat(0x6fae54), 0, 0.02, 0, Math.PI / 2);
  const cols = [0xf7a8c4, 0xf7e08a, 0xd2b4f2, 0xa8d8f7, 0xffffff, 0xf7a8c4, 0xf7e08a];
  cols.forEach((c, i) => {
    const a = (i / cols.length) * Math.PI * 2;
    part(g, new THREE.SphereGeometry(0.034, 8, 6), mat(c, { flatShading: true }), Math.cos(a) * 0.1, 0.04, Math.sin(a) * 0.1);
    part(g, new THREE.SphereGeometry(0.013, 6, 5), mat(0xf2c14e), Math.cos(a) * 0.1, 0.07, Math.sin(a) * 0.1);
  });
  return g;
}

/** Uncle Sam's top hat: white with red stripes, a blue band with white stars. */
function topHat() {
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.15, 0.15, 0.016, 16), mat(0x2f4f9a), 0, 0.008, 0);
  part(g, new THREE.CylinderGeometry(0.085, 0.08, 0.22, 16), mat(0xf5f2ea), 0, 0.12, 0);
  for (const y of [0.1, 0.16, 0.22]) part(g, new THREE.CylinderGeometry(0.087, 0.087, 0.025, 16), mat(0xc8363c), 0, y, 0);
  part(g, new THREE.CylinderGeometry(0.087, 0.087, 0.05, 16), mat(0x2f4f9a), 0, 0.045, 0);
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45;
    part(g, new THREE.SphereGeometry(0.011, 5, 4), mat(0xffffff), Math.sin(a) * 0.089, 0.045, Math.cos(a) * 0.089);
  }
  g.rotation.set(-0.12, 0, 0.1);
  return g;
}

/** A red, white and blue headband with a big gold star on the front. */
function starBand() {
  const g = new THREE.Group();
  part(g, new THREE.TorusGeometry(0.1, 0.018, 6, 18), mat(0xc8363c), 0, 0.0, 0, Math.PI / 2);
  part(g, new THREE.TorusGeometry(0.1, 0.012, 6, 18), mat(0xf5f2ea), 0, 0.03, 0, Math.PI / 2);
  part(g, new THREE.TorusGeometry(0.1, 0.018, 6, 18), mat(0x2f4f9a), 0, 0.055, 0, Math.PI / 2);
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.026 : 0.06, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const star = new THREE.ExtrudeGeometry(sh, { depth: 0.015, bevelEnabled: false });
  part(g, star, mat(0xf2c14e), 0, 0.08, 0.1);
  return g;
}

/** A pilgrim's hat: tall, black, with a gold buckle. */
function pilgrimHat() {
  const g = new THREE.Group();
  const black = mat(0x2a2430);
  part(g, new THREE.CylinderGeometry(0.16, 0.16, 0.016, 16), black, 0, 0.008, 0);
  part(g, new THREE.CylinderGeometry(0.07, 0.088, 0.2, 14), black, 0, 0.11, 0);
  part(g, new THREE.CylinderGeometry(0.09, 0.09, 0.035, 14), mat(0x6b4a2b), 0, 0.035, 0);
  part(g, new THREE.BoxGeometry(0.06, 0.05, 0.012), mat(0xf2c14e), 0, 0.04, 0.09);
  part(g, new THREE.BoxGeometry(0.03, 0.022, 0.014), mat(0x6b4a2b), 0, 0.04, 0.092);
  g.rotation.x = -0.1;
  return g;
}

/** A crown of autumn leaves with a few acorns. */
function leafCrown() {
  const g = new THREE.Group();
  part(g, new THREE.TorusGeometry(0.1, 0.014, 6, 18), mat(0x8a5a2b), 0, 0.02, 0, Math.PI / 2);
  const cols = [0xd9572b, 0xe8a23a, 0xb8452a, 0xe6c04a];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const leaf = part(g, new THREE.BoxGeometry(0.06, 0.012, 0.04), mat(cols[i % 4], { flatShading: true }), Math.cos(a) * 0.105, 0.045, Math.sin(a) * 0.105, 0, -a, 0.6);
    leaf.rotation.order = 'YXZ';
  }
  for (const a of [0.4, 2.2, 4.1]) part(g, new THREE.SphereGeometry(0.02, 6, 5), mat(0x9a6a3a), Math.cos(a) * 0.1, 0.06, Math.sin(a) * 0.1);
  return g;
}

/** A party cone hat with stripes and a pom-pom (gold or silver). */
function partyHat(gold) {
  const g = new THREE.Group();
  const base = soft(gold ? 0xf2c14e : 0xd8dce8, { roughness: 0.3, metalness: 0.5 });
  const stripe = mat(gold ? 0xd9417a : 0x3a5fc0);
  part(g, new THREE.ConeGeometry(0.075, 0.24, 14), base, 0, 0.12, 0);
  for (const [y, r] of [[0.05, 0.062], [0.11, 0.045], [0.17, 0.027]]) part(g, new THREE.CylinderGeometry(r, r + 0.008, 0.02, 14), stripe, 0, y, 0);
  const pom = part(g, new THREE.SphereGeometry(0.03, 8, 6), mat(gold ? 0xffffff : 0xf2c14e), 0, 0.25, 0);
  g.rotation.z = gold ? 0.2 : -0.2;
  g.userData.update = (time) => { pom.position.y = 0.25 + Math.abs(Math.sin(time * 4)) * 0.012; };
  return g;
}

/** A sparkly tiara: a silver arch with glowing gems. */
function tiara() {
  const g = new THREE.Group();
  const silver = soft(0xe4e8f2, { roughness: 0.25, metalness: 0.7 });
  part(g, new THREE.TorusGeometry(0.1, 0.012, 6, 18, Math.PI), silver, 0, 0.0, 0, 0, 0, 0).rotation.set(0, 0, 0);
  const arc = part(g, new THREE.TorusGeometry(0.095, 0.01, 5, 16, Math.PI), silver, 0, 0.02, 0.02);
  arc.rotation.x = -0.3;
  const gems = glowMat(0xff7ad9);
  [[0, 0.115], [-0.05, 0.09], [0.05, 0.09]].forEach(([x, y], i) => part(g, new THREE.OctahedronGeometry(i ? 0.018 : 0.028), i ? glowMat(0x7ae0ff) : gems, x, y, 0.03));
  g.userData.update = (time, night) => gems.color.setRGB(1, 0.48, 0.85).multiplyScalar(0.7 + 0.3 * night + 0.2 * Math.sin(time * 5));
  return g;
}

const LOOKS = {
  halloween: [witchHat, pumpkinCap],
  christmas: [santaHat, antlers],
  easter: [bunnyEars, flowerCrown],
  independence: [topHat, starBand],
  thanksgiving: [pilgrimHat, leafCrown],
  newyear: [() => partyHat(true), tiara, () => partyHat(false)],
};

/** Sheep number i's costume for a festival (null if it has none). */
export function costumeFor(key, i) {
  const looks = LOOKS[key];
  if (!looks) return null;
  const g = looks[i % looks.length]();
  g.name = `${key} costume`;
  return g;
}
