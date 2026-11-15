// The rotation planner (src/vendor/rotation-maxxing) in a Web Worker, so working out plans never
// stalls the 3D island.
//
// Messages in:  { id, type: 'plans', farm, priorities, market, demo, options, learn? }
//               { id, type: 'evaluate', farm, plan, priorities, market, demo, options, learn? }
//   learn: { farmBefore, reports } (src/plan/seasons.js): the farm as it stood before its first
//   reported season, and the reports. They're replayed season by season (the planner's
//   updateAfterSeason, with each season's real NASA POWER weather), and the fields' learned yield
//   factors and the observed seasons are planned with. The reply then has result.learned:
//   { log, notes, observed: [{ season, ok }] }.
// Messages out: { id, ok: true, result, weather: { source, years, gaps } } or { id, ok: false, error }
//
// Weather: the demo farm uses the bundled NASA POWER record for Ames, Iowa (2000-2024, same county),
// so it works offline. Any other farm asks NASA POWER for its own location. If that fails (offline,
// blocked), a farm near Ames falls back to the Ames record; one further away gets no weather years
// (the planner then uses one average year). Either way the plans say so.
import { CROP_BY_ID, evaluatePlan, generatePlans } from '../vendor/rotation-maxxing/algorithm/index.ts';
import { scenariosFromDailyWeather } from '../vendor/rotation-maxxing/algorithm/climate.ts';
import { fetchPowerDaily } from '../vendor/rotation-maxxing/data/power.ts';
import { learnFrom, tuned } from './learn.js';
import { cropIdsFor } from './cropIds.js';

// the same record as the bundled Ames file (2000-2024: 24 growing seasons, each needing the year before)
const WEATHER_YEARS = [2000, 2024];
const AMES = [42.03, -93.63];
// the Ames weather stands in for a farm only if it's this close (km); further off, the planner
// gets no weather years and says so, rather than using the wrong climate
const STAND_IN_KM = 150;
const kmBetween = ([a, b], [c, d]) => {
  const r = Math.PI / 180;
  const h = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
let amesWeather = null;
const liveWeather = new Map(); // "lat,lng" -> Promise<DailyWeather>

async function bundledWeather() {
  amesWeather ??= import('../vendor/rotation-maxxing/fixtures/power_ames_2000_2024.daily.json').then((m) => m.default);
  return amesWeather;
}

/** Daily weather for the farm, and a note on where it came from. */
async function weatherFor(farm, demo, hint = null) {
  if (demo) return { weather: await bundledWeather(), source: 'NASA POWER daily weather for Ames, Iowa (2000-2024), bundled', gaps: [] };
  // scoring a farmer's plan next to plans made on stand-in weather: use that same weather
  if (hint === 'ames') return { weather: await bundledWeather(), source: 'NASA POWER daily weather for Ames, Iowa (bundled stand-in for this farm)', fallback: true, gaps: [] };
  if (hint === 'none') return { weather: null, source: 'none', fallback: true, gaps: [] };
  const lat = farm.latitude;
  const lngs = farm.paddocks.flatMap((p) => p.polygon.lngLat.map((c) => c[0]));
  const lng = lngs.reduce((a, b) => a + b, 0) / Math.max(1, lngs.length);
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (!liveWeather.has(key)) {
    // give up after 25 s (and actually cancel the request)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const fetchFn = (url, init) => fetch(url, { ...init, signal: ctrl.signal });
    const job = fetchPowerDaily(lat, lng, WEATHER_YEARS[0], WEATHER_YEARS[1], fetchFn)
      .then((r) => ({ weather: r.weather, gaps: r.gaps }))
      .catch((e) => { throw new Error(ctrl.signal.aborted ? 'NASA POWER took too long' : e.message); })
      .finally(() => clearTimeout(timer));
    job.catch(() => liveWeather.delete(key)); // try again next time
    liveWeather.set(key, job);
  }
  try {
    const live = await liveWeather.get(key);
    return { weather: live.weather, source: `NASA POWER daily weather for this farm (${WEATHER_YEARS[0]}-${WEATHER_YEARS[1]})`, gaps: live.gaps };
  } catch (e) {
    if (kmBetween([lat, lng], AMES) <= STAND_IN_KM) {
      return {
        weather: await bundledWeather(),
        source: 'NASA POWER daily weather for Ames, Iowa (bundled stand-in for this farm)',
        fallback: true,
        gaps: [`Couldn't reach NASA POWER (${e.message}), so the weather at Ames, Iowa stands in for this farm's.`],
      };
    }
    return { weather: null, source: 'none', fallback: true, gaps: [`Couldn't reach NASA POWER (${e.message}): the plans use one average year, so they can't show good and bad years.`] };
  }
}

// The weather pool depends on the fields' soil, tillage, drainage, irrigation and crops, not their
// names or outlines; it's worked out once per combination (20-100 ms each).
const pools = new Map();
function poolFor(farm, w, cropIds) {
  const key = JSON.stringify([w.source, farm.constraints, cropIds, farm.paddocks.map((p) => [p.id, p.land, p.tillage, p.tileDrained, p.history])]);
  if (!pools.has(key)) {
    if (pools.size > 8) pools.clear();
    pools.set(key, w.weather ? scenariosFromDailyWeather(farm, w.weather, { crops: cropIds }) : { scenarios: [], gaps: [] });
  }
  return pools.get(key);
}

// ---------------------------------------------------------------- learning from reported seasons
const observedDaily = new Map(); // "lat,lng|season" -> Promise<DailyWeather | null>
const farmCentre = (farm) => {
  const lngs = farm.paddocks.flatMap((p) => p.polygon.lngLat.map((c) => c[0]));
  return [farm.latitude, lngs.reduce((a, b) => a + b, 0) / Math.max(1, lngs.length)];
};
/** That season's real weather at the farm (with the year before it, for the soil water), or null. */
function seasonDaily(farm, season) {
  const [lat, lng] = farmCentre(farm);
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}|${season}`;
  if (!observedDaily.has(key)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const job = fetchPowerDaily(lat, lng, season - 1, season, (url, init) => fetch(url, { ...init, signal: ctrl.signal }))
      .then((r) => r.weather)
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    job.then((w) => { if (!w) observedDaily.delete(key); }); // try again next time
    observedDaily.set(key, job);
  }
  return observedDaily.get(key);
}

/** Removes "No local market data for X" notes about crops this farm doesn't grow or choose from. */
function dropOtherCropNotes(result, cropIds) {
  const names = new Set(cropIds.map((id) => CROP_BY_ID[id]?.name).filter(Boolean));
  const keep = (g) => { const m = /^No local market data for (.+?);/.exec(g); return !m || names.has(m[1]); };
  const plans = result.plans ? Object.values(result.plans) : [result];
  for (const p of plans) if (Array.isArray(p?.informationGaps)) p.informationGaps = p.informationGaps.filter(keep);
}

self.onmessage = async ({ data }) => {
  const { id, type, farm, priorities, market, demo, plan, weatherHint, learn, options = {} } = data;
  try {
    const w = await weatherFor(farm, demo, type === 'evaluate' ? weatherHint : null);
    // The weather pool only needs this farm's crops (its choices and its history). Scoring keeps the
    // planner's full crop table, though: its soil-health scale is set across all crops, so cutting
    // the table would shift every score. Notes about crops the farm doesn't grow are dropped after.
    const cropIds = cropIdsFor(farm);
    const climate = poolFor(farm, w, cropIds);
    const weather = { source: w.source, years: climate.scenarios.length, gaps: [...w.gaps, ...climate.gaps], fallback: !!w.fallback };
    // what the farmer's season reports taught the planner (null when there are none)
    const learned = learn ? await learnFrom(learn, climate.scenarios, cropIds, (season) => seasonDaily(learn.farmBefore, season)) : null;
    const planFarm = tuned(farm, learned);
    const scenarios = learned?.weathers?.length ? [...climate.scenarios, ...learned.weathers] : climate.scenarios;
    if (learned) weather.years = scenarios.length;
    let result;
    if (type === 'plans') result = generatePlans(planFarm, priorities, market, scenarios, options);
    else if (type === 'evaluate') result = evaluatePlan(planFarm, plan, priorities, market, scenarios, options);
    else throw new Error(`Unknown request: ${type}`);
    dropOtherCropNotes(result, cropIds);
    if (learned) result.learned = { log: learned.log, notes: learned.notes, observed: learned.observed };
    self.postMessage({ id, ok: true, result, weather });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e?.message || String(e) });
  }
};
