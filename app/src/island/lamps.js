// Farm lamps: a wooden post with a lantern hanging off its arm. By day the lantern is dark; at
// dusk it comes on (src/island/dayNight.js), with a soft halo round the glass and a warm pool of
// light on the ground under it. Only a few lamps carry a real light (each one costs every lit
// pixel on the island); the halo and the pool make the rest look lit for next to nothing.
//
//   const lamp = makeFarmLamp({ light: true })   lamp.userData.lamp = { glass, halo, pool, light }
import * as THREE from 'three';
import { ISLAND_COLORS, mat, mesh } from './props.js';

/** Where the lantern hangs, in the lamp's own space (it faces +z; the arm reaches out along +x). */
export const LANTERN_AT = [0.34, 1.3, 0];
export const LAMP_FOOTPRINT = 0.16;

let haloTex = null;
let poolTex = null;
/** A soft round spot, white in the middle fading to nothing (tinted by the material). */
function spotTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, a] of stops) grad.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeFarmLamp({ light = false } = {}) {
  haloTex ??= spotTexture(64, [[0, 1], [0.18, 0.75], [0.45, 0.22], [1, 0]]);
  poolTex ??= spotTexture(128, [[0, 0.9], [0.35, 0.5], [0.7, 0.14], [1, 0]]);
  const g = new THREE.Group();
  g.name = 'Lamp';
  const iron = mat(0x3f3a36, { roughness: 0.6 });
  // a stone footing, the post, the arm and its brace
  const foot = mesh(new THREE.BoxGeometry(0.22, 0.08, 0.22), mat(0x9a9188));
  foot.position.y = 0.04;
  const post = mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), mat(ISLAND_COLORS.woodDark));
  post.position.y = 0.08 + 0.75;
  const arm = mesh(new THREE.BoxGeometry(0.44, 0.07, 0.07), mat(ISLAND_COLORS.wood));
  arm.position.set(0.17, 1.52, 0);
  const brace = mesh(new THREE.BoxGeometry(0.05, 0.26, 0.05), mat(ISLAND_COLORS.wood));
  brace.position.set(0.1, 1.42, 0);
  brace.rotation.z = Math.PI / 4.2;
  const hook = mesh(new THREE.BoxGeometry(0.02, 0.09, 0.02), iron);
  hook.position.set(LANTERN_AT[0], 1.46, 0);
  g.add(foot, post, arm, brace, hook);

  // the lantern: an iron cap and base, four corner bars, and the glass (its own material, so each
  // lamp can come on by itself)
  const [lx, ly] = LANTERN_AT;
  const cap = mesh(new THREE.ConeGeometry(0.125, 0.09, 4), iron);
  cap.rotation.y = Math.PI / 4;
  cap.position.set(lx, ly + 0.135, 0);
  const top = mesh(new THREE.BoxGeometry(0.17, 0.025, 0.17), iron);
  top.position.set(lx, ly + 0.095, 0);
  const bottom = mesh(new THREE.BoxGeometry(0.17, 0.03, 0.17), iron);
  bottom.position.set(lx, ly - 0.095, 0);
  g.add(cap, top, bottom);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const bar = mesh(new THREE.BoxGeometry(0.018, 0.18, 0.018), iron);
    bar.position.set(lx + sx * 0.068, ly, sz * 0.068);
    g.add(bar);
  }
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xfff1cc, emissive: 0xffc35a, emissiveIntensity: 0.04, roughness: 0.35 });
  glassMat.userData.noSeason = true; // no snow on the glass
  const glass = mesh(new THREE.BoxGeometry(0.12, 0.165, 0.12), glassMat, false, false);
  glass.position.set(lx, ly, 0);
  g.add(glass);

  // the glow: a halo round the glass and a pool of light on the ground (both off by day)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, color: 0xffd08a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.position.set(lx, ly, 0);
  halo.scale.setScalar(1.05);
  halo.renderOrder = 3;
  halo.visible = false;
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex, color: 0xffc46a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  poolMat.userData.noSeason = true;
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.3, 28), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(lx * 0.8, 0.035, 0);
  pool.renderOrder = 2;
  pool.visible = false;
  halo.userData.noBox = pool.userData.noBox = true; // (light, not a solid: things may stand in it)
  g.add(halo, pool);

  let lamp = null;
  if (light) {
    // no shadow: a shadow-casting point light would mean six more shadow renders a frame
    lamp = new THREE.PointLight(0xffc56e, 0, 2.8, 2);
    lamp.position.set(lx, ly - 0.05, 0);
    g.add(lamp);
  }
  g.userData.lamp = { glass, halo, pool, light: lamp };
  g.userData.keep = [glass, halo, pool]; // mergeStatic leaves these alone (they fade on their own)
  return g;
}
