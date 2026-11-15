// The day-night cycle on the island. The clock has three ways to go:
//   'live'  the real time of day, from the clock on the wall (the default)
//   'play'  the whole day in about two and a half minutes (quicker through the night), to watch it
//   'hold'  still, at an hour the farmer picked
// From the hour (src/island/daylight.js) it sets:
//   the sun, then the moon, moving across the sky (the shadows swing round with them)
//   the light's colour: warm at sunrise and sunset, blue moonlight at night (through seasons.js,
//     which owns those lights and mixes this in on top of the season's own look)
//   the sky behind the island: dawn and dusk colours, night blue, stars, the moon and the sun's glow
//   lamps that come on one by one at dusk and go off at dawn, and lit windows that brighten
//   the lighthouse's lantern and its slowly turning beam (view.beacons: src/island/lighthouse.js)
//   unlit things (foam, snow) dimmed so nothing glows by accident
//
//   const dn = createDayNight(view, { seasons, lamps, mode, hour, clock })
//   dn.update(dt)   every frame, before seasons.update
//   dn.setHour(h)   (holds it there)   dn.setMode('live' | 'play' | 'hold')
//   dn.setSeason('winter')   (shorter days)   dn.dispose()
import * as THREE from 'three';
import { daylightAt, hourOf, hoursPerSecond, wrapHour } from './daylight.js';

const WHITE = new THREE.Color(1, 1, 1);
const GOLDEN_HEMI = new THREE.Color(1.0, 0.86, 0.8);
const NIGHT_HEMI = new THREE.Color(0.5, 0.58, 0.95);
const GOLDEN_SUN = new THREE.Color(1.0, 0.66, 0.4);
const MOON = new THREE.Color(0.6, 0.7, 1.0);
const DUSK_SKY = [0xf2c3a4, 0xd9a3bd, 0x8d84c6].map((h) => new THREE.Color(h));
const DAWN_SKY = [0xf7d6c3, 0xe8c4d6, 0xaea8de].map((h) => new THREE.Color(h));
const NIGHT_SKY = [0x1c2149, 0x2a2e60, 0x4a4583].map((h) => new THREE.Color(h));
const DUSK_FOG = new THREE.Color(0xc9a9c4);
const DAWN_FOG = new THREE.Color(0xdcc4d6);
const NIGHT_FOG = new THREE.Color(0x3a3a6c);
const FILL = new THREE.Color(0xcdd6ff);
const NIGHT_FILL = new THREE.Color(0x7d8ad6);

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param {object} view   the reveal's view (scene, lights, root, island, ...)
 * @param {object} o
 * @param {object} o.seasons   from createSeasons (setDaylight)
 * @param {Array}  [o.lamps]   [{ glass, halo, pool, light }] from src/island/lamps.js
 * @param {'live'|'play'|'hold'} [o.mode]
 * @param {number} [o.hour]    the hour to start at, for 'play' and 'hold' (0..24)
 * @param {() => Date} [o.clock]   the wall clock, for 'live'
 */
export function createDayNight(view, { seasons, lamps = [], mode = 'live', hour = 12, clock = () => new Date() } = {}) {
  const { lights, scene, root } = view;
  const beacons = view.beacons || [];
  const wallHour = () => { const d = clock(); return hourOf(d) + d.getSeconds() / 3600; };
  let how = mode;
  let h = how === 'live' ? wallHour() : wrapHour(hour);
  let season = 'summer';
  let info = daylightAt(h, season);

  // what the season mixes in (kept and reused: no garbage every frame)
  const daylight = {
    hemiTint: new THREE.Color(), hemiK: 1, sunTint: new THREE.Color(), sunK: 1,
    fog: new THREE.Color(), fogMix: 0, sky: [new THREE.Color(), new THREE.Color(), new THREE.Color()], skyMix: 0, basicK: 1,
  };
  const original = {
    fill: lights.fill.color.clone(), fillI: lights.fill.intensity, ground: lights.hemi.groundColor.clone(),
  };

  // things that glow: lit windows and lanterns (materials and lights tagged glowBase), and the
  // unlit sea foam, collected once
  const glowMats = new Set();
  const glowLights = [];
  const foam = [];
  scene.traverse((o) => {
    if (o.isPointLight && o.userData.glowBase !== undefined) glowLights.push(o);
    const m = o.material;
    if (m && !Array.isArray(m) && m.userData?.glowBase !== undefined) glowMats.add(m);
    if (o.isMesh && o.name === 'Foam' && m?.color) foam.push({ m, base: m.color.clone() });
  });
  let shownGlow = -1;

  // each lamp comes on at its own moment at dusk, so they light up one after another
  const lampState = lamps.map((l, i) => ({ ...l, k: 0, at: 0.3 + ((i * 7) % 11) * 0.03 }));

  const cssShown = {};
  const setCss = (name, v) => { if (cssShown[name] !== v) { cssShown[name] = v; root.style.setProperty(name, v); } };

  function apply(dt) {
    const d = (info = daylightAt(h, season));
    const { night, golden, morning } = d;
    const warm = golden * (1 - night);

    // the light's colour and strength, mixed in on top of the season by seasons.js
    daylight.hemiTint.copy(WHITE).lerp(GOLDEN_HEMI, golden).lerp(NIGHT_HEMI, night);
    daylight.hemiK = (1 - 0.08 * golden) * (1 - 0.48 * night);
    daylight.sunTint.copy(WHITE).lerp(GOLDEN_SUN, warm).lerp(MOON, d.moon ? 1 : night);
    daylight.sunK = Math.max(0.03, d.strength * (d.moon ? 0.3 : 1 - 0.2 * golden));
    const twilightSky = morning ? DAWN_SKY : DUSK_SKY;
    daylight.sky.forEach((c, i) => c.copy(twilightSky[i]).lerp(NIGHT_SKY[i], night));
    daylight.skyMix = Math.min(1, golden * 0.8 + night);
    daylight.fog.copy(morning ? DAWN_FOG : DUSK_FOG).lerp(NIGHT_FOG, night);
    daylight.fogMix = Math.min(1, golden * 0.6 + night * 0.95);
    daylight.basicK = 1 - 0.5 * night;
    seasons.setDaylight(daylight);

    // where the light comes from, and the cool fill and the ground's bounce dimmed at night
    lights.aim?.(d.dir);
    lights.fill.color.copy(FILL).lerp(NIGHT_FILL, night);
    lights.fill.intensity = original.fillI * (1 - 0.55 * night);
    lights.hemi.groundColor.copy(original.ground).multiplyScalar(1 - 0.55 * night);

    // lit windows (only touched when the night has moved on a little)
    if (Math.abs(night - shownGlow) > 0.004) {
      shownGlow = night;
      for (const m of glowMats) m.emissiveIntensity = m.userData.glowBase * (0.45 + 2.4 * night);
      for (const l of glowLights) {
        l.intensity = l.userData.glowBase * (0.15 + 2.6 * night);
        l.distance = l.userData.glowDistance * (1 + 0.7 * night);
      }
      for (const f of foam) f.m.color.copy(f.base).multiplyScalar(1 - 0.5 * night);
    }

    // the lamps: on when it's dark enough for each, eased on and off in a moment
    for (const l of lampState) {
      const want = night > l.at ? 1 : 0;
      if (l.k === want && dt >= 0) continue;
      l.k = dt < 0 ? want : l.k + Math.sign(want - l.k) * Math.min(Math.abs(want - l.k), dt * 2.5);
      const k = l.k * l.k * (3 - 2 * l.k);
      l.glass.material.emissiveIntensity = 0.04 + 2.6 * k;
      l.halo.material.opacity = 0.8 * k;
      l.halo.visible = k > 0.001;
      l.pool.material.opacity = 0.5 * k;
      l.pool.visible = k > 0.001;
      if (l.light) l.light.intensity = 2.2 * k;
    }
    // the lighthouse: its lantern glows and the beam turns while it's dark
    for (const b of beacons) b.update(dt, night);

    // the sky: stars, the moon and the sun's glow, moving across from right (east) to left (west)
    const across = (p) => 84 - 68 * p; // % from the left
    const up = (p, peak) => 40 - peak * Math.sin(Math.PI * p); // % from the top
    setCss('--stars', smooth(0.45, 1, night).toFixed(3));
    setCss('--moon', (d.moon ? smooth(0.02, 0.12, Math.sin(Math.PI * d.progress)) * smooth(0.5, 0.95, night) : 0).toFixed(3));
    setCss('--sun', (d.moon ? 0 : (1 - night) * smooth(0, 0.1, Math.sin(Math.PI * d.progress))).toFixed(3));
    setCss('--sun-warm', warm.toFixed(3));
    if (d.moon) { setCss('--moon-x', `${across(d.progress).toFixed(1)}%`); setCss('--moon-y', `${up(d.progress, 28).toFixed(1)}%`); }
    else { setCss('--sun-x', `${across(d.progress).toFixed(1)}%`); setCss('--sun-y', `${up(d.progress, 30).toFixed(1)}%`); }
    root.classList.toggle('is-night', night > 0.5);
  }

  /** Every frame (dt in seconds; 0 while the farm is paused). Moves the clock on, as its mode says. */
  function update(dt) {
    if (how === 'play' && dt > 0) h = wrapHour(h + dt * hoursPerSecond(h, season));
    else if (how === 'live' && dt > 0) h = wallHour();
    apply(dt);
  }

  apply(-1); // straight to this hour: lamps and all

  return {
    update,
    /** Jumps to an hour and holds it there (lamps switch at once). */
    setHour(v) { how = 'hold'; h = wrapHour(v); apply(-1); },
    /** 'live' jumps to the real time; 'play' runs on from here; 'hold' stops here. */
    setMode(m) {
      how = m === 'play' || m === 'hold' ? m : 'live';
      if (how === 'live') { h = wallHour(); apply(-1); }
    },
    setSeason(s) { if (s && s !== season) { season = s; apply(-1); } },
    get hour() { return h; },
    get mode() { return how; },
    get info() { return info; },
    dispose() {
      seasons.setDaylight(null);
      lights.aim?.(null);
      lights.fill.color.copy(original.fill);
      lights.fill.intensity = original.fillI;
      lights.hemi.groundColor.copy(original.ground);
      for (const m of glowMats) m.emissiveIntensity = m.userData.glowBase * 0.45;
      for (const l of glowLights) { l.intensity = l.userData.glowBase * 0.15; l.distance = l.userData.glowDistance; }
      for (const f of foam) f.m.color.copy(f.base);
      for (const l of lampState) {
        l.glass.material.emissiveIntensity = 0.04;
        l.halo.visible = l.pool.visible = false;
        if (l.light) l.light.intensity = 0;
      }
      for (const b of beacons) b.update(-1, 0);
      for (const name of Object.keys(cssShown)) root.style.removeProperty(name);
      root.classList.remove('is-night');
    },
  };
}
