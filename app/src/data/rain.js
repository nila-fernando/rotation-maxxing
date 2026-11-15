// Growing-season (April-September) rain at the farm from NASA POWER monthly totals (keyless, CORS
// open), for the check-up's rain trend: every year from 1991, and the 1991-2020 average.
//
//   farmRain([lng, lat])  ->  Promise<{ growingSeasonRainMm: [{year, value}], avg30yrRainMm } | null>
//
// POWER's grid is about 50 km, so one call covers the whole farm. A year counts only when all six
// months are in the record (the current year appears once September is).
import { assertAnswered, fetchRetry } from './net.js';

export const POWER_MONTHLY = 'https://power.larc.nasa.gov/api/temporal/monthly/point';
const FIRST_YEAR = 1991;
const NORMAL = [1991, 2020];
const MONTHS = ['04', '05', '06', '07', '08', '09'];

export function rainUrl([lng, lat], endYear) {
  return `${POWER_MONTHLY}?parameters=PRECTOTCORR_SUM&community=AG&longitude=${lng.toFixed(4)}&latitude=${lat.toFixed(4)}&start=${FIRST_YEAR}&end=${endYear}&format=JSON`;
}

/** Season totals from a POWER monthly response (missing values are -999). */
export function seasonTotals(json) {
  const m = json?.properties?.parameter?.PRECTOTCORR_SUM;
  if (!m) return null;
  const years = [...new Set(Object.keys(m).map((k) => Number(k.slice(0, 4))))].sort((a, b) => a - b);
  const series = [];
  for (const year of years) {
    const vals = MONTHS.map((mm) => m[`${year}${mm}`]);
    if (vals.every((v) => Number.isFinite(v) && v >= 0)) series.push({ year, value: Math.round(vals.reduce((a, b) => a + b, 0)) });
  }
  const normal = series.filter((r) => r.year >= NORMAL[0] && r.year <= NORMAL[1]);
  if (!series.length || normal.length < 25) return null;
  return { growingSeasonRainMm: series, avg30yrRainMm: Math.round(normal.reduce((a, r) => a + r.value, 0) / normal.length) };
}

/**
 * The farm's rain, or null when POWER has no full record there. Throws Unreachable when POWER
 * doesn't answer (each try times out; tried again with backoff).
 */
export async function farmRain(point, { fetchFn = globalThis.fetch, now = new Date(), signal = null, clock } = {}) {
  const res = assertAnswered(await fetchRetry(fetchFn, rainUrl(point, now.getFullYear()), {}, { timeoutMs: 20000, attempts: 3, backoffMs: 800, signal, clock }), 'NASA POWER');
  if (!res.ok) return null;
  try {
    return seasonTotals(await res.json());
  } catch {
    return null; // not a readable answer
  }
}

/** Every field with the farm's rain attached. */
export const withRain = (fields, rain) => (rain ? fields.map((f) => ({ ...f, rain })) : fields);
