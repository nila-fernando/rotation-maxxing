// The lighthouse on the island's highest point: a striped stone tower, a gallery with a railing, the
// lantern room and a mint cap, in the same low-poly style (and at the same scale) as the barn and the
// windmill. At night its lantern glows and a soft beam sweeps slowly round; by day the beam is gone.
// No real light: the glass is emissive and the beam is an unlit, additive cone that fades to nothing
// at its far end, so it costs a couple of draw calls and no shader recompiles.
//
//   const lh = makeLighthouse()        base at y 0, door facing +z, 3.62 tall (2.7 at the island's 0.75)
//   lh.userData.beacon.update(dt, night)   every frame (src/island/dayNight.js does it), dt < 0 jumps
//
// The beam holds still with reduced motion (it keeps shining, it just doesn't turn).
import * as THREE from 'three';
import { glowMat, mat, mesh } from './props.js';

/** The lighthouse's shape in its own units (front +z), for placing it and for the festivals to dress it. */
export const LIGHTHOUSE = {
  plinthTop: 0.2, plinthR: 0.62,
  towerBottom: 0.2, towerTop: 2.6, rBottom: 0.48, rTop: 0.32,
  deckY: 2.64, deckR: 0.52, railY: 2.86, railR: 0.48,
  glassBottom: 2.78, glassTop: 3.18, glassR: 0.27,
  lanternY: 2.98,
  capBottom: 3.18, capTop: 3.52, capR: 0.37,
  top: 3.62,
  // the beam: a cone from the lantern out to `beamLength`, `beamRadius` across at its far end, tipped
  // up a little so it rides above the island
  beamLength: 2.7, beamRadius: 0.36, beamTilt: 0.05,
};
/** The tower's radius at height y (its own units). */
export const towerRadiusAt = (y) => {
  const L = LIGHTHOUSE, t = Math.max(0, Math.min(1, (y - L.towerBottom) / (L.towerTop - L.towerBottom)));
  return L.rBottom + (L.rTop - L.rBottom) * t;
};

/**
 * How low the beam reaches at a distance d (island units) from the lighthouse's middle, as a height
 * above the lighthouse's base, for a lighthouse at `scale`: what stands within its reach must stay
 * under this. Past the beam's end it's Infinity (nothing to keep under).
 */
export function beamFloorAt(d, scale) {
  const L = LIGHTHOUSE, len = L.beamLength * scale;
  if (d > len + 0.05) return Infinity;
  const f = Math.max(0, d) / len;
  return (L.lanternY + Math.sin(L.beamTilt) * L.beamLength * f - L.beamRadius * f) * scale;
}
/** How far the beam reaches, in island units, at `scale`. */
export const beamReach = (scale) => LIGHTHOUSE.beamLength * scale;

const CREAM = 0xf3ece0, CORAL = 0xd9786c, STONE = 0xb9b3a6, WOOD_DARK = 0x7d5e45, MINT = 0x8ccab3, BRASS = 0xd8b25e;
const WARM = new THREE.Color(1.0, 0.84, 0.52);

let haloTex = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, a] of [[0, 1], [0.2, 0.7], [0.5, 0.2], [1, 0]]) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

/** One cone of light from the lantern out along +x, warm at the lantern and fading to nothing. */
function beamGeometry() {
  const L = LIGHTHOUSE;
  const g = new THREE.ConeGeometry(L.beamRadius, L.beamLength, 18, 6, true);
  g.translate(0, -L.beamLength / 2, 0); // the tip at the lantern, the wide end out along -y
  g.rotateZ(Math.PI / 2 + L.beamTilt); // ...now out along +x, tipped up a touch
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) / L.beamLength);
    const k = Math.min(1, t / 0.08) * (1 - t) ** 1.7; // soft at the glass, gone at the end
    col.set([WARM.r * k, WARM.g * k, WARM.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function makeLighthouse() {
  const L = LIGHTHOUSE;
  const g = new THREE.Group();
  g.name = 'Lighthouse';

  // the stone plinth and a step up to the door
  const plinth = mesh(new THREE.CylinderGeometry(L.plinthR - 0.04, L.plinthR, L.plinthTop, 10), mat(STONE));
  plinth.position.y = L.plinthTop / 2;
  g.add(plinth);
  const step = mesh(new THREE.BoxGeometry(0.34, 0.08, 0.16), mat(0xa9a396));
  step.position.set(0, 0.04, L.plinthR + 0.02);
  g.add(step);

  // the tower: four bands, cream and coral, narrowing as it rises
  const bands = 4, bh = (L.towerTop - L.towerBottom) / bands;
  for (let k = 0; k < bands; k++) {
    const y0 = L.towerBottom + k * bh, y1 = y0 + bh;
    const band = mesh(new THREE.CylinderGeometry(towerRadiusAt(y1), towerRadiusAt(y0), bh, 10), mat(k % 2 ? CORAL : CREAM));
    band.position.y = (y0 + y1) / 2;
    g.add(band);
  }
  const lean = Math.atan2(L.rBottom - L.rTop, L.towerTop - L.towerBottom); // (the wall's slope)
  // the door, and two small lit windows up the front and the back
  const door = mesh(new THREE.BoxGeometry(0.24, 0.4, 0.05), mat(0x6e5139));
  door.position.set(0, L.towerBottom + 0.2, towerRadiusAt(L.towerBottom + 0.2) - 0.005);
  door.rotation.x = -lean;
  g.add(door);
  const lit = glowMat(0xffe1a0, 0xffc766, 0.5); // (brightens at night like the windmill's window)
  for (const [y, side] of [[1.3, 1], [1.95, -1]]) {
    const w = mesh(new THREE.BoxGeometry(0.13, 0.18, 0.05), lit);
    w.position.set(0, y, side * (towerRadiusAt(y) - 0.005));
    w.rotation.x = -lean * side;
    g.add(w);
  }

  // the gallery: a dark deck, posts and a rail
  const deck = mesh(new THREE.CylinderGeometry(L.deckR, L.deckR - 0.06, 0.08, 12), mat(WOOD_DARK));
  deck.position.y = L.deckY;
  g.add(deck);
  const railMat = mat(WOOD_DARK);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const post = mesh(new THREE.BoxGeometry(0.025, L.railY - L.deckY, 0.025), railMat, false);
    post.position.set(Math.sin(a) * L.railR, (L.deckY + L.railY) / 2, Math.cos(a) * L.railR);
    g.add(post);
  }
  const rail = mesh(new THREE.TorusGeometry(L.railR, 0.016, 4, 24), railMat, false);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = L.railY;
  g.add(rail);

  // the lantern room: a cream sill, the glass (its own material, so it can glow by itself) and
  // six dark mullions round it
  const sill = mesh(new THREE.CylinderGeometry(L.glassR + 0.04, L.glassR + 0.05, L.glassBottom - L.deckY - 0.04, 10), mat(CREAM));
  sill.position.y = (L.deckY + 0.04 + L.glassBottom) / 2;
  g.add(sill);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffcf6e, emissiveIntensity: 0.12, roughness: 0.3 });
  glassMat.userData.noSeason = true; // no snow or frost on the lit glass
  const glass = mesh(new THREE.CylinderGeometry(L.glassR, L.glassR, L.glassTop - L.glassBottom, 10), glassMat, false, false);
  glass.position.y = (L.glassBottom + L.glassTop) / 2;
  g.add(glass);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const m = mesh(new THREE.BoxGeometry(0.03, L.glassTop - L.glassBottom, 0.03), mat(WOOD_DARK), false);
    m.position.set(Math.sin(a) * (L.glassR + 0.01), (L.glassBottom + L.glassTop) / 2, Math.cos(a) * (L.glassR + 0.01));
    g.add(m);
  }

  // the cap and a brass ball on top
  const cap = mesh(new THREE.ConeGeometry(L.capR, L.capTop - L.capBottom, 10), mat(MINT));
  cap.position.y = (L.capBottom + L.capTop) / 2;
  g.add(cap);
  const ball = mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(BRASS, { flatShading: false, roughness: 0.45, metalness: 0.3 }));
  ball.position.y = L.top - 0.05;
  g.add(ball);

  // ---- the light: a halo round the glass and two beams back to back, turning round the tower's axis
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(), color: 0xffd690, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  halo.material.userData.noSeason = true;
  halo.position.y = L.lanternY;
  halo.scale.setScalar(1.25);
  halo.renderOrder = 3;
  halo.visible = false;
  const beamMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  beamMat.userData.noSeason = true;
  const beams = new THREE.Group();
  beams.name = 'Lighthouse beams';
  beams.position.y = L.lanternY;
  const geo = beamGeometry();
  for (const turn of [0, Math.PI]) {
    const b = new THREE.Mesh(geo, beamMat);
    b.rotation.y = turn;
    b.renderOrder = 4;
    b.castShadow = b.receiveShadow = false;
    b.userData.noBox = true; // light, not a solid: nothing it passes over is "in" the lighthouse
    beams.add(b);
  }
  beams.visible = false;
  halo.userData.noBox = true;
  g.add(halo, beams);

  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let k = 0; // how lit (0 day .. 1 night), eased
  g.userData.beacon = {
    glass, halo, beams,
    /** dt in seconds (0 while paused, < 0 to jump straight there); night 0..1 from dayNight. */
    update(dt, night) {
      const want = smooth(0.25, 0.75, night);
      k = dt < 0 ? want : k + Math.sign(want - k) * Math.min(Math.abs(want - k), dt * 1.5);
      glassMat.emissiveIntensity = 0.12 + 2.6 * k;
      halo.material.opacity = 0.75 * k;
      halo.visible = k > 0.001;
      beamMat.opacity = 0.5 * k;
      beams.visible = k > 0.001;
      // a slow turn, about one round every fourteen seconds (held still with reduced motion)
      if (dt > 0 && beams.visible && !motion?.matches) beams.rotation.y = (beams.rotation.y + dt * 0.45) % (Math.PI * 2);
    },
    get lit() { return k; },
  };
  g.userData.keep = [glass, halo, beams]; // mergeStatic leaves these alone (they glow and turn)
  return g;
}
