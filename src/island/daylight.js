// The time of day on the island: where the sun and moon are, how dark it is, and how fast the
// day runs. Pure numbers (no three.js); src/island/dayNight.js turns them into light and colour.
//
//   daylightAt(hour, season) -> { hour, rise, set, sunHeight, night, golden, morning, moon,
//                                 dir: [x, y, z], strength, progress, part }
//   hoursPerSecond(hour, season)   how fast the cycle runs at that hour (the night goes quicker)
//   formatHour(19.67) -> '7:40 pm'
//
// Island axes: x east, y up, z south. The camera looks north from the south (+z), so the sun
// rises on the right of the screen, crosses behind the viewer's shoulder and sets on the left.

/** Sunrise and sunset, by season (roughly the Corn Belt: long summer evenings, short winter days). */
export const DAY_HOURS = { spring: [6.3, 19.6], summer: [5.6, 20.6], fall: [6.9, 18.6], winter: [7.4, 16.9] };
/** How high the sun gets at noon (degrees), by season; the moon gets to MOON_PEAK. */
const SUN_PEAK = { spring: 52, summer: 64, fall: 42, winter: 30 };
const MOON_PEAK = 38;
/** A full day takes about two and a half minutes: 9 s an hour by day, 4 s an hour by night. */
export const SECONDS_PER_HOUR = { day: 9, night: 4 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const rad = (deg) => (deg * Math.PI) / 180;
export const wrapHour = (h) => ((h % 24) + 24) % 24;

/**
 * Everything about one moment of the day.
 *   sunHeight  sine of the sun's height (below 0 under the horizon)
 *   night      0 full daylight .. 1 full night (twilight in between)
 *   golden     the low, warm sun round sunrise and sunset (0..1)
 *   morning    before noon (dawn colours rather than dusk ones)
 *   moon       the light that casts shadows is the moon's
 *   dir        unit vector from the island toward that light
 *   strength   how strong that light is (it fades out near the horizon, so the swap is hidden)
 *   progress   0..1 along its arc (sun: rise to set; moon: set to rise)
 *   part       'Night' | 'Dawn' | 'Morning' | 'Midday' | 'Afternoon' | 'Dusk'
 */
export function daylightAt(hour, season = 'summer') {
  const h = wrapHour(hour);
  const [rise, set] = DAY_HOURS[season] || DAY_HOURS.summer;
  const dayLen = set - rise;
  const isDay = h >= rise && h <= set;
  const dayP = (h - rise) / dayLen;
  const nightP = wrapHour(h - set) / (24 - dayLen);
  // the sun's height: an arc over the day, and on under the horizon through the night
  const sunHeight = isDay ? Math.sin(Math.PI * dayP) * Math.sin(rad(SUN_PEAK[season] || 50)) : -Math.sin(Math.PI * nightP) * 0.5;
  // dark once the sun is well down, light once it's a few degrees up
  const night = 1 - smooth(-0.15, 0.06, sunHeight);
  const golden = (1 - smooth(0.05, 0.4, sunHeight)) * smooth(-0.13, 0.01, sunHeight);
  const moon = !isDay;
  const progress = isDay ? dayP : nightP;
  const peak = moon ? Math.sin(rad(MOON_PEAK)) : Math.sin(rad(SUN_PEAK[season] || 50));
  const bodyHeight = Math.max(0, Math.sin(Math.PI * progress)) * peak;
  const el = Math.asin(Math.max(0.03, bodyHeight)); // never quite flat: shadows stay on the island
  const az = Math.PI * progress; // east (+x) at the start, south (+z) in the middle, west at the end
  const cosEl = Math.cos(el);
  const dir = [Math.cos(az) * cosEl, Math.sin(el), Math.sin(az) * 0.55 * cosEl];
  const len = Math.hypot(...dir);
  const strength = smooth(0, 0.18, bodyHeight);
  return {
    hour: h, rise, set, sunHeight, night, golden, morning: h < 12, moon,
    dir: dir.map((v) => v / len), strength, progress, part: partOfDay(h, night, golden),
  };
}

function partOfDay(h, night, golden) {
  if (night > 0.85) return 'Night';
  if (night > 0.12 || golden > 0.35) return h < 12 ? 'Dawn' : 'Dusk';
  if (h < 11) return 'Morning';
  if (h < 14) return 'Midday';
  return 'Afternoon';
}

/** Game hours per real second at this hour: slower by day (that's when the farm's worth looking at). */
export function hoursPerSecond(hour, season = 'summer') {
  const { night } = daylightAt(hour, season);
  const s = SECONDS_PER_HOUR.day + (SECONDS_PER_HOUR.night - SECONDS_PER_HOUR.day) * night;
  return 1 / s;
}

/** '7:40 pm', '12:00 pm' (noon), '12:05 am' (just after midnight); to the nearest 5 minutes. */
export function formatHour(hour) {
  let mins = Math.round((wrapHour(hour) * 60) / 5) * 5;
  if (mins >= 24 * 60) mins -= 24 * 60;
  const h24 = Math.floor(mins / 60), m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
}

/** The hour of a Date, with minutes (19:40 -> 19.67). */
export const hourOf = (date) => date.getHours() + date.getMinutes() / 60;
