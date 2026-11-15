// How loud each of the farm's sounds is, for a moment of the day, a season and a festival.
// Pure (no Web Audio here), so it's tested on its own (mix.test.js); src/audio/ambience.js
// plays it.
//
//   mixAt({ hour, night, golden, morning, season, occasion })
//     -> { sea, breeze, birds, crickets, creak, bells,          beds and loudness, 0..1
//          rates: { birds, owl, baa, creak, bells } }            calls per minute
//   masterFor({ on, unlocked, hidden, away })   the whole mix's volume (0 when it should be quiet)
//   nextGap(perMinute, rnd)                     seconds to the next call (Infinity at 0 a minute)
//   readSoundPref(storage) / writeSoundPref(storage, on)   remembered in localStorage
//   sceneOf(timeTravel.session)                 the moment the farm is showing, for mixAt
//
// night and golden come from src/island/daylight.js (dayNight.info); give just the hour and the
// season and they're worked out the same way.
import { daylightAt } from '../island/daylight.js';

/** The whole mix, at most: quiet, under everything else on the page. */
export const MASTER = 0.3;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// the season's share of each sound
const SEASON = {
  //        sea   breeze birds crickets owl
  spring: { sea: 0.5, breeze: 0.26, birds: 0.75, crickets: 0.45, owl: 0.6 },
  summer: { sea: 0.46, breeze: 0.18, birds: 0.65, crickets: 1, owl: 0.5 },
  fall: { sea: 0.55, breeze: 0.42, birds: 0.4, crickets: 0.55, owl: 1 },
  winter: { sea: 0.6, breeze: 0.52, birds: 0.18, crickets: 0, owl: 0.85 },
};

// a festival's touch on top of the season (only what changes)
const OCCASION = {
  easter: { birds: 1.2 },
  halloween: { owl: 2, birds: 0.7, breeze: 1.15 },
  christmas: { bells: 1 },
  newyear: { bells: 0.55 },
};

/**
 * @param {object} o
 * @param {number} [o.hour]      0..24
 * @param {number} [o.night]     0 day .. 1 night (from daylightAt; worked out from the hour if missing)
 * @param {number} [o.golden]    the low sun round sunrise and sunset
 * @param {boolean} [o.morning]
 * @param {'spring'|'summer'|'fall'|'winter'} [o.season]
 * @param {string|null} [o.occasion]   a festival key (src/island/themes/index.js THEMES)
 */
export function mixAt({ hour = 12, night, golden, morning, season = 'summer', occasion = null } = {}) {
  if (night === undefined || golden === undefined) {
    const d = daylightAt(hour, season);
    night ??= d.night;
    golden ??= d.golden;
    morning ??= d.morning;
  }
  morning ??= hour < 12;
  const s = SEASON[season] || SEASON.summer;
  const o = OCCASION[occasion] || {};
  const day = 1 - night;

  const sea = s.sea;
  const breeze = clamp01(s.breeze * (o.breeze || 1) * (1 - 0.2 * night));
  // the dawn chorus: more birds as the sun comes up, a few at dusk, none once it's dark (the
  // island's dawn takes about an hour, so these ramp with the light rather than snap)
  const chorus = 1 + (morning ? 0.5 : 0.15) * golden;
  const birds = clamp01(day * s.birds * (o.birds || 1) * chorus);
  // crickets start at dusk and sing through the night
  const crickets = clamp01(((night - 0.2) / 0.7) * s.crickets);
  const owl = smooth(0.7, 0.95, night) * s.owl * (o.owl || 1);
  // the windmill turns faster (and creaks more) in the windy months
  const creak = clamp01(0.35 + breeze * 0.8);
  const bells = clamp01(o.bells || 0);

  return {
    sea, breeze, birds, crickets, creak, bells,
    rates: {
      birds: birds * 16,
      owl: owl * 1.1,
      baa: 0.3 + 1.1 * day, // sheep baa by day, and only now and then at night
      creak: 1.5 + breeze * 4,
      bells: bells * 1.4,
    },
  };
}

/** The whole mix's volume: off, before the first tap, with the tab hidden or while something covers the farm. */
export function masterFor({ on = true, unlocked = false, hidden = false, away = false } = {}) {
  return on && unlocked && !hidden && !away ? MASTER : 0;
}

/**
 * Seconds until the next call of a sound that comes `perMinute` times a minute on average
 * (spread out at random, but never closer than `min` seconds).
 */
export function nextGap(perMinute, rnd = Math.random, min = 1.5) {
  if (!(perMinute > 0)) return Infinity;
  const u = Math.min(0.999, Math.max(0, rnd()));
  return Math.max(min, (-Math.log(1 - u) * 60) / perMinute);
}

/**
 * What the sounds follow, from the hub's time travel (src/screens/timeTravel.js): its time of day
 * (dayInfo) and the season and festival on show (state). null while there's no farm showing.
 */
export function sceneOf(session) {
  const d = session?.dayInfo;
  const st = session?.state;
  if (!d || !st) return null;
  return { hour: d.hour, night: d.night, golden: d.golden, morning: d.morning, season: st.season, occasion: st.occasion ?? null };
}

export const SOUND_KEY = 'rotation-maxxing.sound';

/** Sound on unless the farmer turned it off (and it's on if storage can't be read). */
export function readSoundPref(storage) {
  try { return storage?.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function writeSoundPref(storage, on) {
  try { storage?.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* private mode: just this visit */ }
}
