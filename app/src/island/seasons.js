// The island through the seasons: snow, autumn leaves, spring-green grass, ripening crops, the sky
// and light, and things in the air (snowflakes, falling leaves, petals, butterflies).
//
// Colours change in the shaders, not by rebuilding anything: every island material gets a small
// patch that reads four shared values (snow, grass, leaves, ripe), so a season change costs nothing.
//   - snow settles on whatever faces up (ground, roofs, fence rails, beds), in soft patches
//   - grass: fresh green in spring, straw-dry in fall (only the green parts: cliffs stay sandstone)
//   - leaves: reds and golds in fall, bare greys in winter (pines stay green)
//   - crops: ripen to straw in fall
//
//   const seasons = createSeasons(view)
//   seasons.attach(object)     patch an object's materials (the island, new paddocks, decorations)
//   seasons.setState(state)    a state from src/island/timeline.js; eases there unless { instant: true }
//   seasons.setWeather(blend)  the farm's weather mixed in (src/island/weather.js blendFor); eases there
//   seasons.update(dt, time)   every frame
//   seasons.dispose()
//
// The weather goes on top of the season, the festival and the time of day: clouds grey the sky and
// soften the light (and hide the sun, moon and stars), a broken sky drifts cloud shadows over the
// ground, fog pulls the mist in, rain and snow fall (snow dusts the ground), storms flash now and
// then (by lifting the light and sky a moment: no new lights), and wind sways the trees.
import * as THREE from 'three';
import { lightningAt } from './weather.js';

// ---------------------------------------------------------------- the shader patch

const U = {
  uSnow: { value: 0 },
  uGrass: { value: 0 },
  uLeaves: { value: 0 },
  uRipe: { value: 0 },
  // a festival's tint on the grass and leaves (dusky purple for Halloween, gold for Thanksgiving...)
  uTheme: { value: new THREE.Vector3(1, 1, 1) },
  uThemeMix: { value: 0 },
  // the weather: cloud shadows drifting over the ground (how dark, their offset, their size), and
  // the wind in the trees (how hard, and its clock)
  uShade: { value: 0 },
  uShadeOff: { value: new THREE.Vector2() },
  uShadeK: { value: 0.3 },
  uWind: { value: 0 },
  uWindT: { value: 0 },
};

const COMMON = /* glsl */ `
varying float vSeasonUp;
varying vec3 vSeasonPos;
uniform float uSnow;
uniform float uGrass;
uniform float uLeaves;
uniform float uRipe;
uniform vec3 uTheme;
uniform float uThemeMix;
uniform float uShade;
uniform vec2 uShadeOff;
uniform float uShadeK;
vec3 sTheme(vec3 c, float g) {
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  return mix(c, vec3(l) * uTheme * 1.3, g * uThemeMix);
}
float sHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float sNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float sGreen(vec3 c) { return clamp((c.g - max(c.r, c.b)) * 6.0, 0.0, 1.0); }
vec3 sSnow(vec3 c) {
  float up = smoothstep(0.3, 0.75, vSeasonUp);
  float n = sNoise(vSeasonPos.xz * 2.2) * 0.55 + sNoise(vSeasonPos.xz * 7.0) * 0.2;
  float cover = smoothstep(n, n + 0.22, uSnow * 1.2) * up;
  return mix(c, vec3(0.95, 0.97, 1.0), cover * 0.94);
}
// a broken sky's cloud shadows, drifting over everything below
float sShade() {
  if (uShade <= 0.0) return 1.0;
  vec2 p = vSeasonPos.xz * uShadeK + uShadeOff;
  float n = sNoise(p) * 0.65 + sNoise(p * 2.3 + 7.1) * 0.35;
  return 1.0 - uShade * smoothstep(0.5, 0.7, n);
}`;

// the wind in the leaves: the tops of the crowns lean and sway (the trunk end stays put), each tree a
// little after its neighbour, like gusts crossing the farm. A few hundredths of a unit at most, so
// nothing reaches into anything else.
const SWAY = /* glsl */ `
  if (uWind > 0.0) {
    vec4 so = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_INSTANCING
      so = instanceMatrix * so;
    #endif
    so = modelMatrix * so;
    float ph = uWindT + so.x * 0.55 + so.z * 0.4;
    float sway = sin(ph) * 0.7 + sin(ph * 2.3 + 1.7) * 0.3;
    float lean = clamp(0.5 + position.y * 1.5, 0.15, 1.0) * uWind;
    transformed.x += (0.012 + 0.028 * sway) * lean;
    transformed.z += 0.014 * sway * lean;
  }`;

const KINDS = {
  plain: 'diffuseColor.rgb = sSnow(diffuseColor.rgb);',
  evergreen: 'diffuseColor.rgb = sSnow(diffuseColor.rgb);',
  grass: `{
    vec3 c = diffuseColor.rgb;
    float g = sGreen(c);
    vec3 fresh = c * vec3(0.84, 1.1, 0.8);
    float l = dot(c, vec3(0.4, 0.45, 0.15));
    vec3 straw = vec3(l) * vec3(1.28, 1.06, 0.6);
    c = mix(c, fresh, g * clamp(-uGrass, 0.0, 1.0));
    c = mix(c, straw, g * clamp(uGrass, 0.0, 1.0) * 0.72);
    c = sTheme(c, g);
    diffuseColor.rgb = sSnow(c);
  }`,
  foliage: `{
    vec3 c = diffuseColor.rgb;
    float g = sGreen(c);
    float l = dot(c, vec3(0.3, 0.59, 0.11));
    float fall = clamp(uLeaves, 0.0, 1.0);
    float bare = clamp(uLeaves - 1.0, 0.0, 1.0);
    float h = sHash(floor(vSeasonPos.xz * 1.3));
    vec3 autumn = mix(vec3(0.86, 0.3, 0.12), vec3(0.98, 0.72, 0.2), h) * (0.6 + l * 0.85);
    c = mix(c, autumn, max(g, 0.6) * fall);
    vec3 dull = vec3(l) * vec3(0.92, 0.84, 0.76);
    c = mix(c, dull, bare * 0.75);
    c = sTheme(c, max(g, 0.5) * 0.8);
    diffuseColor.rgb = sSnow(c);
  }`,
  tuft: `{
    vec3 c = diffuseColor.rgb;
    float g = sGreen(c);
    float l = dot(c, vec3(0.4, 0.45, 0.15));
    c = mix(c, c * vec3(0.84, 1.1, 0.8), g * clamp(-uGrass, 0.0, 1.0));
    c = mix(c, vec3(l) * vec3(1.28, 1.06, 0.6), g * clamp(uGrass, 0.0, 1.0) * 0.72);
    c = sTheme(c, g);
    diffuseColor.rgb = mix(c, vec3(0.93, 0.95, 0.99), clamp(uSnow, 0.0, 1.0) * 0.82);
  }`,
  flower: `{
    vec3 c = diffuseColor.rgb;
    float l = dot(c, vec3(0.3, 0.59, 0.11));
    c = mix(c, vec3(l) * vec3(1.1, 0.95, 0.72), clamp(uGrass, 0.0, 1.0) * 0.45);
    diffuseColor.rgb = mix(c, vec3(0.93, 0.95, 0.99), clamp(uSnow, 0.0, 1.0) * 0.92);
  }`,
  crop: `{
    vec3 c = diffuseColor.rgb;
    float l = dot(c, vec3(0.3, 0.59, 0.11));
    vec3 straw = vec3(0.93, 0.78, 0.42) * (0.62 + l * 0.6);
    c = mix(c, straw, uRipe * 0.88);
    diffuseColor.rgb = sSnow(c);
  }`,
};

// patched materials (a WeakSet, not a userData flag: material.clone() copies userData but not the
// hook, and a clone must get its own patch)
const patched = new WeakSet();

/** Adds the season patch to one material (once). Skips see-through, unlit and opted-out ones. */
export function patchMaterial(m) {
  if (!m || !m.isMeshStandardMaterial || patched.has(m) || m.transparent || m.userData.noSeason) return;
  const kind = KINDS[m.userData.season] ? m.userData.season : 'plain';
  patched.add(m);
  const before = m.onBeforeCompile;
  m.onBeforeCompile = function (shader, renderer) {
    before?.call(this, shader, renderer);
    Object.assign(shader.uniforms, U);
    let vs = shader.vertexShader;
    if (kind === 'foliage') vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY}`);
    shader.vertexShader = vs
      .replace('#include <common>', '#include <common>\nvarying float vSeasonUp;\nvarying vec3 vSeasonPos;\nuniform float uWind;\nuniform float uWindT;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        {
          vec3 sn = objectNormal;
          #ifdef USE_INSTANCING
            sn = mat3( instanceMatrix ) * sn;
          #endif
          vSeasonUp = normalize( mat3( modelMatrix ) * sn ).y;
        }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 sp = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            sp = instanceMatrix * sp;
          #endif
          vSeasonPos = ( modelMatrix * sp ).xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${KINDS[kind]}\ndiffuseColor.rgb *= sShade();`);
  };
  const baseKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${baseKey()}|season-${kind}`;
  m.needsUpdate = true;
}

const isSheep = (o) => { for (let p = o; p; p = p.parent) if (/^(Sheep|Manami)/.test(p.name)) return true; return false; };

/**
 * Patches every island material under `object` (not the sheep). With all the season values at 0
 * the patched shaders draw exactly as before, so the reveal runs this before it compiles its
 * shaders, and the hub's seasons then need no recompile.
 */
export function attachSeasons(object) {
  object.traverse((o) => {
    if (!o.isMesh || isSheep(o)) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(patchMaterial);
  });
}

// ---------------------------------------------------------------- how each season looks

const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
// sky: top, middle, bottom of the page behind the island; fog matches the bottom; light colours and strengths
const LOOKS = {
  spring: { sky: [0xdcecf3, 0xe5ecdf, 0xcfd8e8], fog: 0xe6ece6, hemi: [0xf4fff0, 1.32], sun: [0xfff3dc, 2.35] },
  summer: { sky: [0xf1edf8, 0xe3dcf0, 0xc9bfe3], fog: 0xe6e2ee, hemi: [0xf7f3ff, 1.3], sun: [0xfff0d6, 2.35] },
  fall: { sky: [0xf7e9dd, 0xebd9de, 0xcdbfdc], fog: 0xeee1dc, hemi: [0xfff0e0, 1.24], sun: [0xffd8a6, 2.3] },
  winter: { sky: [0xf0f3f8, 0xdfe5f0, 0xc2cae2], fog: 0xe7ebf3, hemi: [0xeef4ff, 1.45], sun: [0xe9f1ff, 2.05] },
  halloween: { sky: [0xefc7a8, 0xc7a3cc, 0x8a76b4], fog: 0xc8b2d3, hemi: [0xcbb6ea, 1.02], sun: [0xffa45c, 1.75] },
  christmas: { sky: [0xe9edf7, 0xd2d8ec, 0xabb2d6], fog: 0xdfe4f1, hemi: [0xeaf0ff, 1.38], sun: [0xf2eaff, 1.95] },
  // the other festivals: a soft pastel Easter morning, a clear bright Fourth of July, a warm amber
  // Thanksgiving, and a crisp, cool New Year
  easter: { sky: [0xf8e2ee, 0xeae4f6, 0xccd6f0], fog: 0xeee6f1, hemi: [0xfff3fa, 1.36], sun: [0xfff2e4, 2.3] },
  independence: { sky: [0xdde9f8, 0xe8e6f4, 0xc3c6e8], fog: 0xe3e6f2, hemi: [0xf6f7ff, 1.32], sun: [0xfff4dc, 2.42] },
  thanksgiving: { sky: [0xf6d9bd, 0xe8c6bd, 0xc2a9cc], fog: 0xead4c8, hemi: [0xffecd8, 1.2], sun: [0xffc685, 2.2] },
  newyear: { sky: [0xdde1f3, 0xc8cde7, 0x9fa4d2], fog: 0xd6daec, hemi: [0xe9efff, 1.36], sun: [0xeef0ff, 1.95] },
};
// the festivals tint the grass and leaves too ([r, g, b] times the grass's brightness, how much),
// and some fill the air with confetti ([colours])
const GROUND = {
  halloween: [[0.6, 0.48, 0.82], 0.55],
  thanksgiving: [[1.22, 0.84, 0.42], 0.5],
  easter: [[0.86, 1.18, 0.92], 0.3],
  newyear: [[0.82, 0.86, 1.18], 0.35],
};
const CONFETTI = {
  newyear: [0xffd36b, 0xf2f2ff, 0xff7ad9, 0x7ae0ff, 0xffc04a],
  independence: [0xd8363c, 0xf5f2ff, 0x3a5fc0],
  easter: [0xf7a8c4, 0xa8d8f7, 0xf7e08a, 0xb9e6a8, 0xd2b4f2],
};

// ---------------------------------------------------------------- things in the air

const rand = (a, b) => a + Math.random() * (b - a);

/** Flat 2D shapes (position only) merged into one geometry. */
function mergeFlat(geos) {
  const pos = [], idx = [];
  let base = 0;
  for (const g of geos) {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    const ix = g.index ? g.index.array : [...Array(p.length / 3).keys()];
    for (const i of ix) idx.push(i + base);
    base += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}

function makeParticles(kind, count, radius, center) {
  let geo, material, colors;
  if (kind === 'snow') {
    geo = new THREE.IcosahedronGeometry(0.035, 0);
    material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  } else if (kind === 'rain') {
    // thin see-through streaks (a slim box reads from every side), in a few soft blue-greys
    geo = new THREE.BoxGeometry(0.011, 0.24, 0.011);
    material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false });
    colors = [0xcfd9ea, 0xbccbe0, 0xdfe6f2];
  } else if (kind === 'leaves') {
    geo = new THREE.PlaneGeometry(0.11, 0.075);
    material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    colors = [0xd9572b, 0xe8892f, 0xf2b843, 0xb8452a, 0xe6a23a];
  } else if (kind === 'petals') {
    geo = new THREE.PlaneGeometry(0.07, 0.05);
    material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    colors = [0xfbd3dd, 0xf6b8c8, 0xffffff, 0xfce6ec];
  } else if (kind === 'confetti') {
    // little paper rectangles and curls that tumble and flash as they turn
    geo = new THREE.PlaneGeometry(0.09, 0.055);
    material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    colors = [0xffd36b, 0xf2f2ff, 0xff7ad9];
  } else { // butterflies: two round wings each side, in bright colours
    const wing = new THREE.CircleGeometry(0.06, 10);
    const parts = [[-0.055, 0.022, 1], [0.055, 0.022, 1], [-0.042, -0.04, 0.72], [0.042, -0.04, 0.72]].map(([x, y, s]) => wing.clone().scale(s, s * 0.9, 1).translate(x, y, 0));
    geo = mergeFlat(parts);
    material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    colors = [0xf6d55c, 0xffffff, 0x9cc8f0, 0xf2a35e, 0xe58bd8, 0x8be0b4, 0xff8a5a, 0xb7a7ec];
  }
  material.userData.noSeason = true;
  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.name = `Season ${kind}`;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const c = new THREE.Color();
  const ps = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius * 1.15;
    ps.push({
      x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, y: rand(-0.2, 5.5),
      v: kind === 'rain' ? rand(7, 9.5) : kind === 'snow' ? rand(0.45, 0.8) : kind === 'leaves' || kind === 'confetti' ? rand(0.25, 0.45) : rand(0.18, 0.32),
      ph: rand(0, 6.3), sp: rand(0.6, 1.4),
      // butterflies circle a spot near the ground
      cx: center.x + Math.cos(a) * r * 0.7, cz: center.z + Math.sin(a) * r * 0.7, cr: rand(0.3, 0.9), cy: rand(0.9, 1.6),
    });
    if (colors) mesh.setColorAt(i, c.set(colors[i % colors.length]));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  let amount = 0;
  return {
    mesh,
    set amount(v) { amount = v; },
    /** New colours for the pieces (the confetti changes with the festival). */
    setColors(list) {
      if (!list?.length) return;
      for (let i = 0; i < count; i++) mesh.setColorAt(i, c.set(list[i % list.length]));
      mesh.instanceColor.needsUpdate = true;
    },
    /** wind 0..1: what falls is blown sideways on its way down (rain slants). */
    update(dt, t, wind = 0) {
      const n = Math.round(count * amount);
      mesh.count = n;
      mesh.visible = n > 0;
      if (!n) return;
      for (let i = 0; i < n; i++) {
        const o = ps[i];
        if (kind === 'butterflies') {
          // fluttering loops a little above the grass, wings beating (lying flat-ish, tilted up)
          const a = t * 0.8 * o.sp + o.ph;
          p.set(o.cx + Math.cos(a) * o.cr, o.cy + Math.sin(t * 2.1 + o.ph) * 0.15, o.cz + Math.sin(a * 1.3) * o.cr);
          e.set(-1.1, -a, 0, 'YXZ');
          s.set(0.2 + Math.abs(Math.sin(t * 13 * o.sp + o.ph)) * 0.8, 1, 1);
        } else if (kind === 'confetti') {
          o.y -= o.v * 0.8 * dt;
          if (o.y < -0.3) { o.y = rand(4.5, 6); }
          p.set(o.x + Math.sin(t * 1.1 * o.sp + o.ph) * 0.5, o.y, o.z + Math.cos(t * 0.9 * o.sp + o.ph) * 0.5);
          e.set(t * 5.5 * o.sp + o.ph, t * 1.4 + o.ph, t * 3.1 * o.sp, 'XYZ');
          // every other piece is a thin streamer curl
          s.set(o.ph > 3.1 ? 0.35 : 1, o.ph > 3.1 ? 2.1 : 1, 1);
        } else if (kind === 'rain') {
          // straight down, fast, leaning with the wind (blown across as it falls, so the path slants)
          o.y -= o.v * dt;
          if (o.y < -0.3) { o.y = rand(5, 6.5); }
          const slant = 0.06 + 0.5 * wind;
          p.set(o.x + (3 - o.y) * slant, o.y, o.z + (3 - o.y) * slant * 0.35); // (centred: the shower stays over the island)
          e.set(slant * 0.35, 0, -slant, 'XYZ');
          s.set(1, 0.8 + o.sp * 0.4, 1);
        } else {
          o.y -= o.v * dt;
          if (o.y < -0.3) { o.y = rand(4.5, 6); }
          const sway = kind === 'snow' ? 0.15 : 0.45;
          const blow = (2.8 - o.y) * wind * (kind === 'snow' ? 0.35 : 0.25); // drifting downwind as it falls
          p.set(o.x + Math.sin(t * 0.9 * o.sp + o.ph) * sway + blow, o.y, o.z + Math.cos(t * 0.7 * o.sp + o.ph) * sway + blow * 0.35);
          if (kind === 'snow') e.set(0, 0, 0);
          else e.set(t * 2.2 * o.sp + o.ph, t * 1.3 + o.ph, t * 1.7 * o.sp);
          s.set(1, 1, 1);
        }
        m.compose(p, q.setFromEuler(e), s);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- the season system

/**
 * @param {object} view  the reveal's view (scene, lights, root, radius, center, island)
 */
export function createSeasons(view) {
  const { scene, lights, root } = view;
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => motionQuery.matches;
  const center = view.center || new THREE.Vector3();
  const air = new THREE.Group();
  air.name = 'Season air';
  scene.add(air);
  const particles = {
    snow: makeParticles('snow', 320, view.radius, center),
    leaves: makeParticles('leaves', 130, view.radius, center),
    petals: makeParticles('petals', 110, view.radius, center),
    butterflies: makeParticles('butterflies', 40, view.radius, center),
    confetti: makeParticles('confetti', 70, view.radius, center), // a light sprinkle, not a blizzard
    rain: makeParticles('rain', 620, view.radius, center),
  };
  for (const p of Object.values(particles)) air.add(p.mesh);
  // cloud shadows about a third of the island across
  U.uShadeK.value = 2.6 / Math.max(2, view.radius || 7);

  // the weather (src/island/weather.js blendFor): eased, more slowly than a season change
  const wx = { cloud: 0, shadows: 0, dim: 0, fog: 0, rain: 0, snow: 0, settle: 0, lightning: 0, wind: 0 };
  const wxGoal = { ...wx };
  let wxTime = 0;
  let flash = 0;
  // the fog's reach before the weather pulls it in (someone else may move it: the hub does, with
  // the camera; a change we didn't make becomes the new reach)
  const fogReach = scene.fog ? { near: scene.fog.near, far: scene.fog.far, wrote: null } : null;
  const SKY_FLASH = new THREE.Color(0xeeeaff);
  let clearCss = null;

  // eased values: current and target
  const cur = { snow: 0, grass: 0, leaves: 0, ripe: 0, snowfall: 0, leaffall: 0, petalfall: 0, butterflies: 0, confetti: 0, themeMix: 0 };
  const goal = { ...cur };
  const themeTint = new THREE.Vector3(1, 1, 1), themeGoal = new THREE.Vector3(1, 1, 1);
  let confettiFor = null;
  const color = {
    hemi: lights.hemi.color.clone(), sun: lights.sun.color.clone(), fog: new THREE.Color(0xe6e2ee),
    sky: [new THREE.Color(0xf1edf8), new THREE.Color(0xe3dcf0), new THREE.Color(0xc9bfe3)],
  };
  const colorGoal = { hemi: color.hemi.clone(), sun: color.sun.clone(), fog: color.fog.clone(), sky: color.sky.map((c) => c.clone()) };
  let hemiI = lights.hemi.intensity, sunI = lights.sun.intensity, hemiGoal = hemiI, sunGoal = sunI;
  const skyCss = [];
  const original = { hemi: lights.hemi.color.clone(), hemiI, sun: lights.sun.color.clone(), sunI, fog: scene.fog?.color.clone() };
  // the time of day on top of the season (src/island/dayNight.js): light tints and strengths, and
  // the sky and fog it fades toward. This module stays the one writer of those lights and colours.
  let daylight = null;
  const tmp = new THREE.Color();
  const tmpGrey = new THREE.Color();

  const attach = attachSeasons;
  attach(scene);

  /** Moves the island toward a state (instant: jump there, for a still view chosen by the farmer). */
  function setState(state, { instant = false } = {}) {
    const L = state.look;
    const look = LOOKS[state.occasion] || LOOKS[state.season];
    Object.assign(goal, {
      snow: L.snow,
      grass: L.grass,
      leaves: L.leaves,
      ripe: L.ripe,
      snowfall: state.season === 'winter' ? (state.t < 0.85 ? 1 : 0.3) : state.season === 'fall' && state.t > 0.9 ? 0.35 : 0,
      leaffall: state.season === 'fall' && state.t > 0.15 && state.t < 0.95 ? 1 : 0,
      petalfall: state.season === 'spring' && state.t > 0.25 ? 0.8 : 0,
      butterflies: state.season === 'summer' || state.occasion === 'easter' ? 1 : state.season === 'spring' && state.t > 0.3 ? 0.8 : 0,
      confetti: CONFETTI[state.occasion] ? 1 : 0,
      themeMix: GROUND[state.occasion]?.[1] || 0,
    });
    // the festival's grass tint (kept while it fades out) and confetti colours
    if (GROUND[state.occasion]) themeGoal.set(...GROUND[state.occasion][0]);
    if (CONFETTI[state.occasion] && confettiFor !== state.occasion) { confettiFor = state.occasion; particles.confetti.setColors(CONFETTI[state.occasion]); }
    colorGoal.hemi.set(look.hemi[0]);
    colorGoal.sun.set(look.sun[0]);
    colorGoal.fog.set(look.fog);
    look.sky.forEach((h, i) => colorGoal.sky[i].set(h));
    hemiGoal = look.hemi[1];
    sunGoal = look.sun[1];
    if (instant) step(1);
  }

  function step(k) {
    for (const key of Object.keys(cur)) cur[key] += (goal[key] - cur[key]) * k;
    color.hemi.lerp(colorGoal.hemi, k);
    color.sun.lerp(colorGoal.sun, k);
    color.fog.lerp(colorGoal.fog, k);
    color.sky.forEach((c, i) => c.lerp(colorGoal.sky[i], k));
    hemiI += (hemiGoal - hemiI) * k;
    sunI += (sunGoal - sunI) * k;
    U.uSnow.value = Math.max(cur.snow, wx.settle); // (falling snow dusts the ground, whatever the season)
    U.uGrass.value = cur.grass;
    U.uLeaves.value = cur.leaves;
    U.uRipe.value = cur.ripe;
    themeTint.lerp(themeGoal, k);
    U.uTheme.value.copy(themeTint);
    U.uThemeMix.value = cur.themeMix;
    const d = daylight;
    const still = reduced();
    const night = d ? Math.min(1, Math.max(0, (1 - d.basicK) * 2)) : 0;
    const f = still ? 0 : flash;
    // the light: clouds hide the sun (or moon) and soften everything; a flash lifts the sky light a moment
    lights.hemi.color.copy(color.hemi);
    lights.hemi.intensity = hemiI * (d ? d.hemiK : 1) * (1 - 0.42 * wx.dim + 0.1 * wx.cloud) * (1 + 1.5 * f);
    lights.sun.color.copy(color.sun);
    lights.sun.intensity = sunI * (d ? d.sunK : 1) * (1 - 0.8 * wx.cloud) * (1 - 0.25 * wx.dim);
    if (d) { lights.hemi.color.multiply(d.hemiTint); lights.sun.color.multiply(d.sunTint); }
    greyer(lights.hemi.color, 0.45 * wx.cloud, 0);
    greyer(lights.sun.color, 0.6 * wx.cloud, 0);
    if (f) lights.hemi.color.lerp(SKY_FLASH, 0.5 * f);
    if (scene.fog) {
      scene.fog.color.copy(color.fog);
      if (d) scene.fog.color.lerp(d.fog, d.fogMix);
      greyer(scene.fog.color, 0.75 * Math.max(wx.cloud, wx.fog), 0.18 * wx.dim);
      if (f) scene.fog.color.lerp(SKY_FLASH, 0.25 * f * (0.4 + 0.6 * night));
      // mist closes in (from wherever the fog sits now: the hub moves it back with the camera)
      const fg = scene.fog, r = fogReach;
      if (r.wrote && (fg.near !== r.wrote.near || fg.far !== r.wrote.far)) { r.near = fg.near; r.far = fg.far; }
      const near = r.near * (1 - 0.85 * wx.fog), far = r.far * (1 - 0.6 * wx.fog);
      if (fg.near !== near || fg.far !== far) { fg.near = near; fg.far = far; }
      r.wrote = { near: fg.near, far: fg.far };
    }
    // the page's sky behind the canvas (only touched when a colour actually changes)
    color.sky.forEach((c, i) => {
      tmp.copy(c);
      if (d) tmp.lerp(d.sky[i], d.skyMix);
      greyer(tmp, 0.85 * wx.cloud, 0.22 * wx.dim);
      if (wx.fog && scene.fog) tmp.lerp(scene.fog.color, wx.fog * (0.35 + 0.2 * i)); // the horizon fades into the mist
      if (f) tmp.lerp(SKY_FLASH, f * (0.3 + 0.35 * night));
      const v = css(tmp.getHex());
      if (skyCss[i] !== v) { skyCss[i] = v; root.style.setProperty(`--sky${i + 1}`, v); }
    });
    // the sun's glow, the moon and the stars go behind the clouds (src/styles.css)
    const clear = (1 - 0.97 * Math.max(wx.cloud, wx.fog * 0.9)).toFixed(2);
    if (clear !== clearCss) { clearCss = clear; root.style.setProperty('--wx-clear', clear); }
    // snow, leaves and petals are unlit: dim them with the light
    const glow = (d ? d.basicK : 1) * (1 - 0.25 * wx.dim) + 0.35 * f;
    for (const p of Object.values(particles)) if (p.mesh.material.color.r !== glow) p.mesh.material.color.setScalar(glow);
    // cloud shadows on the ground (by day: the moon's are too faint to matter)
    U.uShade.value = wx.shadows * (1 - night) * 0.32;
    U.uWind.value = still ? 0 : wx.wind;
    // nothing falls or flies with reduced motion (checked every frame: it can be turned on any time)
    particles.snow.amount = still ? 0 : Math.max(cur.snowfall, wx.snow);
    particles.leaves.amount = still ? 0 : cur.leaffall;
    particles.petals.amount = still ? 0 : cur.petalfall * (1 - wx.rain);
    particles.butterflies.amount = still ? 0 : cur.butterflies * (1 - Math.max(wx.rain, wx.snow, wx.fog * 0.6, wx.wind * 0.5));
    particles.confetti.amount = still ? 0 : cur.confetti;
    particles.rain.amount = still ? 0 : wx.rain;
  }

  /** c toward a grey of its own brightness (a touch cool), and darker by `darken`. */
  function greyer(c, amount, darken) {
    if (amount <= 0 && darken <= 0) return c;
    const l = (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) * (1 - darken);
    return c.lerp(tmpGrey.setRGB(l * 0.97, l * 0.99, l * 1.05), amount);
  }
  function update(dt, time) {
    // the weather settles over a second or two (a live change, or one picked in the popover)
    const kw = Math.min(1, dt * 1.6);
    for (const key of Object.keys(wx)) wx[key] += (wxGoal[key] - wx[key]) * kw;
    if (dt > 0) {
      wxTime += dt;
      // the clouds' shadows drift downwind, faster when it blows; the trees sway to the gusts
      if (!reduced()) {
        U.uShadeOff.value.x -= dt * (0.015 + 0.09 * wx.wind);
        U.uShadeOff.value.y -= dt * (0.005 + 0.03 * wx.wind);
        U.uWindT.value = (U.uWindT.value + dt * (0.8 + 2.2 * wx.wind)) % 6283.19;
      }
    }
    flash = wx.lightning > 0.01 ? lightningAt(wxTime) * wx.lightning : 0;
    step(Math.min(1, dt * 3.2)); // about a third of a second to settle
    for (const p of Object.values(particles)) p.update(dt, time, wx.wind);
  }

  /**
   * The farm's weather to mix in: an amounts object from src/island/weather.js blendFor (null:
   * none). Eases there over a second or two; instant: straight there (applied on the next update).
   */
  function setWeather(blend, { instant = false } = {}) {
    for (const key of Object.keys(wxGoal)) wxGoal[key] = Math.max(0, Math.min(1, blend?.[key] || 0));
    if (instant) Object.assign(wx, wxGoal);
  }

  function dispose() {
    scene.remove(air);
    for (const p of Object.values(particles)) { p.mesh.geometry.dispose(); p.mesh.material.dispose(); p.mesh.dispose(); }
    // back to plain summer daylight (the patched materials then draw exactly as before)
    U.uSnow.value = U.uGrass.value = U.uLeaves.value = U.uRipe.value = U.uThemeMix.value = 0;
    U.uShade.value = U.uWind.value = 0;
    if (scene.fog && fogReach) { scene.fog.near = fogReach.near; scene.fog.far = fogReach.far; }
    root.style.removeProperty('--wx-clear');
    lights.hemi.color.copy(original.hemi);
    lights.hemi.intensity = original.hemiI;
    lights.sun.color.copy(original.sun);
    lights.sun.intensity = original.sunI;
    if (scene.fog && original.fog) scene.fog.color.copy(original.fog);
    root.style.removeProperty('--sky1');
    root.style.removeProperty('--sky2');
    root.style.removeProperty('--sky3');
  }

  /**
   * The time of day to mix in (null for plain daylight): { hemiTint, hemiK, sunTint, sunK,
   * fog: Color, fogMix, sky: [Color x3], skyMix, basicK }. Applied on the next update().
   */
  const setDaylight = (d) => { daylight = d || null; };

  return {
    attach, setState, setDaylight, setWeather, update, dispose, uniforms: U,
    get current() { return { ...cur }; },
    /** The weather as it is on the island this moment (eased): { cloud, wind, rain, snow, ... }, plus flash 0..1. */
    get weather() { return { ...wx, flash }; },
    /** How hard the wind blows on the island this moment (0..1, eased): the windmill turns with it. */
    get wind() { return wx.wind; },
  };
}
