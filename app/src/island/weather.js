// The farm's weather on the island: the pure parts (no three.js, no fetching), so they can be tested.
//
//   lookFromReading(reading)   a current-conditions reading (src/services/weatherFeed.js) -> { look, intensity, wind }
//   blendFor(weather)          that weather -> how much of each effect seasons.js mixes in
//   refreshDelay(failures)     when to ask again (every 20 minutes; sooner, then backing off, after a failure)
//   lightningAt(t)             0..1: the brightness of an occasional lightning flash at time t (seconds)
//   weatherParam(text)         ?weather=rain -> 'rain' (or null)
//   weatherLine(look)          Manami's one plain line about the live weather (or null)
//
// The looks, from fair to wild:
//   clear    sun (or stars) and nothing in the way
//   partly   a few clouds: soft cloud shadows drifting over the farm
//   cloudy   overcast: a flat grey sky, softer light, no sun or stars
//   fog      the far side of the island fades into mist
//   rain     drizzle or rain: overcast, a little haze, rain falling
//   storm    heavy rain or a thunderstorm: darker, wind, now and then lightning
//   snow     snow falling, and a light dusting on the ground and roofs
//   wind     fair but blowy: the windmill spins fast and the trees sway

export const LOOKS = ['clear', 'partly', 'cloudy', 'fog', 'rain', 'storm', 'snow', 'wind'];

/** The looks the farmer can pick in the time-of-day popover (and ?weather=), in its order. */
export const PICKS = ['clear', 'cloudy', 'fog', 'rain', 'storm', 'snow', 'wind'];

export const LOOK_NAMES = {
  clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog', rain: 'Rain', storm: 'Storm', snow: 'Snow', wind: 'Windy',
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * WMO weather codes (what Open-Meteo reports as weather_code) -> [look, intensity 0..1].
 * https://open-meteo.com/en/docs (the "WMO Weather interpretation codes" table)
 */
const CODES = {
  0: ['clear', 0], 1: ['clear', 0], 2: ['partly', 0.5], 3: ['cloudy', 1],
  45: ['fog', 0.85], 48: ['fog', 1], // fog, rime fog
  51: ['rain', 0.25], 53: ['rain', 0.35], 55: ['rain', 0.45], // drizzle
  56: ['rain', 0.35], 57: ['rain', 0.5], // freezing drizzle
  61: ['rain', 0.5], 63: ['rain', 0.75], 65: ['storm', 0.75], // rain: slight, moderate, heavy
  66: ['rain', 0.55], 67: ['rain', 0.85], // freezing rain
  71: ['snow', 0.45], 73: ['snow', 0.75], 75: ['snow', 1], 77: ['snow', 0.35], // snow, snow grains
  80: ['rain', 0.55], 81: ['rain', 0.85], 82: ['storm', 0.85], // rain showers
  85: ['snow', 0.6], 86: ['snow', 1], // snow showers
  95: ['storm', 1], 96: ['storm', 1], 99: ['storm', 1], // thunderstorms (with hail)
};

/** Wind (mph) -> 0..1 windiness: calm under 6 mph, wild by 35. */
export const windiness = (mph) => clamp01(((Number(mph) || 0) - 6) / 29);

/** Fair-weather looks this blowy (sustained mph, or gusts) count as "windy". */
export const WINDY_MPH = 20;
export const WINDY_GUST_MPH = 32;

/**
 * A reading -> the look to show. reading: { code, wind, gusts, cloud? } (wind and gusts in mph).
 * Unknown codes fall back on the cloud cover (or clear). Returns { look, intensity, wind } with
 * intensity and wind 0..1.
 */
export function lookFromReading(reading) {
  if (!reading) return { look: 'clear', intensity: 0, wind: 0 };
  let [look, intensity] = CODES[reading.code] ?? (reading.cloud >= 85 ? ['cloudy', 1] : reading.cloud >= 35 ? ['partly', 0.5] : ['clear', 0]);
  const wind = Math.max(windiness(reading.wind), windiness((Number(reading.gusts) || 0) * 0.7));
  const blowy = (Number(reading.wind) || 0) >= WINDY_MPH || (Number(reading.gusts) || 0) >= WINDY_GUST_MPH;
  if (blowy && (look === 'clear' || look === 'partly')) { look = 'wind'; intensity = Math.max(0.5, wind); }
  return { look, intensity: clamp01(intensity), wind };
}

/** A look picked to preview (not live): at its usual strength. */
export function pickedWeather(look) {
  const base = { clear: 0, partly: 0.5, cloudy: 1, fog: 1, rain: 0.7, storm: 1, snow: 0.75, wind: 0.85 }[look];
  if (base == null) return { look: 'clear', intensity: 0, wind: 0 };
  return { look, intensity: base, wind: { storm: 0.85, wind: 0.85, rain: 0.25, snow: 0.2 }[look] ?? 0.1 };
}

/**
 * How much of each effect the look mixes in (all 0..1; nothing at all for clear and calm):
 *   cloud     the sky greys and the sun (or moon and stars) goes behind it
 *   shadows   cloud shadows drifting over the ground (only a broken sky has those)
 *   dim       the light softens and darkens
 *   fog       mist closes in round the island
 *   rain      rain falling (how heavy)
 *   snow      snow falling (how heavy)
 *   settle    snow lying on the ground and roofs (at least this much)
 *   lightning now and then a flash (storms)
 *   wind      the windmill's speed, the trees' sway, the rain's slant
 */
export function blendFor({ look = 'clear', intensity = 0, wind = 0 } = {}) {
  const k = clamp01(intensity);
  const b = { cloud: 0, shadows: 0, dim: 0, fog: 0, rain: 0, snow: 0, settle: 0, lightning: 0, wind: clamp01(wind) };
  switch (look) {
    case 'partly': Object.assign(b, { cloud: 0.12 + 0.12 * k, shadows: 0.25 + 0.2 * k, dim: 0.04 }); break;
    case 'cloudy': Object.assign(b, { cloud: 0.55 + 0.3 * k, dim: 0.2 + 0.12 * k, fog: 0.08 }); break;
    case 'fog': Object.assign(b, { cloud: 0.6, dim: 0.18, fog: 0.6 + 0.4 * k }); break;
    case 'rain': Object.assign(b, { cloud: 0.8 + 0.1 * k, dim: 0.28 + 0.14 * k, fog: 0.15 + 0.15 * k, rain: 0.35 + 0.55 * k }); break;
    case 'storm': Object.assign(b, { cloud: 1, dim: 0.48 + 0.1 * k, fog: 0.28, rain: 0.8 + 0.2 * k, lightning: k >= 0.9 ? 1 : 0, wind: Math.max(b.wind, 0.7) }); break;
    case 'snow': Object.assign(b, { cloud: 0.7, dim: 0.16, fog: 0.2 + 0.15 * k, snow: 0.45 + 0.55 * k, settle: 0.22 + 0.2 * k }); break;
    case 'wind': Object.assign(b, { cloud: 0.1, shadows: 0.28, dim: 0.03, wind: Math.max(b.wind, 0.55 + 0.45 * k) }); break;
    default: break;
  }
  for (const key of Object.keys(b)) b[key] = clamp01(b[key]);
  return b;
}

// ---------------------------------------------------------------- asking for it again

export const REFRESH_MS = 20 * 60 * 1000;
const RETRY_MS = [60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3];

/** How long to wait before the next reading: 20 minutes, or after `failures` failures in a row 1, 2, 5, 10, then 20. */
export function refreshDelay(failures = 0) {
  if (!(failures > 0)) return REFRESH_MS;
  return RETRY_MS[Math.floor(failures) - 1] ?? REFRESH_MS;
}

/** A reading this old is due again (the page coming back into view asks then, not on its timer). */
export const isStale = (at, now = Date.now()) => !(at > 0) || now - at >= REFRESH_MS;

/** A reading older than this (a laptop asleep for the afternoon) isn't shown: fair weather until the next one. */
export const MAX_AGE_MS = 3 * 60 * 60 * 1000;

// ---------------------------------------------------------------- lightning

// a flash about every 9 to 17 seconds, each a quick double flicker (well under the three-a-second
// limit for flashing, and soft: it only lifts the light and sky a little)
const FLASH_EVERY = 13;
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
/** 0..1, how bright a lightning flash is at t seconds (0 nearly all the time). */
export function lightningAt(t) {
  if (!Number.isFinite(t) || t < 0) return 0;
  const i = Math.floor(t / FLASH_EVERY);
  const at = i * FLASH_EVERY + 2 + hash(i) * (FLASH_EVERY - 4); // somewhere in this stretch
  const u = t - at;
  if (u < 0 || u > 0.7) return 0;
  const pulse = (c, w, h) => h * Math.max(0, 1 - Math.abs(u - c) / w);
  return clamp01(Math.max(pulse(0.06, 0.07, 1), pulse(0.26, 0.1, 0.7 + 0.3 * hash(i + 0.5)), pulse(0.45, 0.25, 0.25)));
}

// ---------------------------------------------------------------- words

const ALIASES = { partlycloudy: 'partly', 'partly-cloudy': 'partly', overcast: 'cloudy', clouds: 'cloudy', drizzle: 'rain', rainy: 'rain', thunder: 'storm', thunderstorm: 'storm', foggy: 'fog', mist: 'fog', snowy: 'snow', windy: 'wind', sunny: 'clear', fair: 'clear' };
/** ?weather=rain -> 'rain'; 'live' or anything unknown -> null. */
export function weatherParam(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (LOOKS.includes(t)) return t;
  return ALIASES[t] ?? null;
}

const LINES = {
  cloudy: 'It’s cloudy at your farm right now, so it’s cloudy here too.',
  fog: 'It’s foggy at your farm right now, so it’s foggy here too.',
  rain: 'It’s raining at your farm right now, so it’s raining here too.',
  storm: 'There’s a storm at your farm right now, so there’s one here too. Stay safe out there.',
  snow: 'It’s snowing at your farm right now, so it’s snowing here too.',
  wind: 'It’s windy at your farm right now, so the windmill’s spinning fast here too.',
};
/** Manami's line about the live weather; null for fair weather (nothing worth saying). */
export const weatherLine = (look) => LINES[look] ?? null;

/** "Raining at your farm now" for the popover's Live button (its title and spoken name). */
export function liveWords(weather) {
  if (!weather) return 'No weather reading yet, so the farm shows fair weather';
  const what = { clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Foggy', rain: 'Raining', storm: 'Stormy', snow: 'Snowing', wind: 'Windy' }[weather.look] || 'Clear';
  return `${what} at your farm now`;
}
