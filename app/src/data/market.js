// The farm's market data for the planner, all fetched for where the farm really is: its county
// (FCC Census API), the crops grown there, their yields and their prices (USDA NASS Quick Stats,
// through our proxy: src/data/nass.js). No stand-in numbers: when any of it can't be had, the
// answer is { ok: false, reason } and the plans say plainly that there's no data.
//
//   const markets = createMarkets()
//   const market = await markets.forFarm([lng, lat], { practice: 'non-irrigated' })
//   market: { ok: true, county, crops, prices, baseYields, gaps }  (see marketFor)
//        or { ok: false, reason }
//
// The NASS answers are kept per county for the session (a failed try isn't, so it's asked again).
import { CROP_BY_ID, SOURCES } from '../vendor/rotation-maxxing/algorithm/croptraits.ts';
import { CROP_WORD } from '../plan/planNames.js';
import { countyAt } from './countyLookup.js';
import { NASS_PROXY, baseYieldsFrom, cropsGrown, marketQueries, nassAvailable, pickPrice, proxiedFetch, stateCensusQuery } from './nass.js';

const TIMEOUT_MS = 45000; // Quick Stats is often slow (5-10 s per request is normal)
const RETRIES = 2;

const word = (id) => CROP_WORD[id]?.word ?? id;
const listWords = (ids) => ids.map(word).join(', ');
const cap = (t) => t[0].toUpperCase() + t.slice(1);

/** "$4.00/bu", "$0.229/lb", "$170/ton". */
export function priceText(price, unit) {
  const digits = unit === 'ton' ? 0 : price < 1 ? 3 : 2;
  return `$${price.toFixed(digits)}/${unit}`;
}

/** One Quick Stats request through the proxy: its rows ([] when NASS has none: it answers 400 then). */
async function nassRows(url, fetchFn) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetchFn(url, { signal: ctrl.signal });
    } catch (e) {
      if (attempt < RETRIES && !ctrl.signal.aborted) continue;
      throw new Error(ctrl.signal.aborted ? 'USDA NASS took too long to answer' : 'USDA NASS could not be reached');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 400) return [];
    if (res.status >= 500 && attempt < RETRIES) continue;
    if (!res.ok) throw new Error(res.status === 503 ? 'the USDA NASS connection isn’t set up on this server' : `USDA NASS answered HTTP ${res.status}`);
    const body = await res.json();
    return Array.isArray(body?.data) ? body.data : [];
  }
}

/**
 * Everything NASS has for the farm's county, in one go (6 requests at once). Throws with a reason a
 * farmer can read when the county or NASS can't be had.
 */
export async function loadMarketRows(point, { fetchFn = globalThis.fetch, base = NASS_PROXY, thisYear = new Date().getFullYear(), county = null } = {}) {
  if (!nassAvailable(base)) throw new Error('this site has no connection to USDA NASS set up (VITE_NASS_PROXY)');
  county ??= await countyAt(point, { fetchFn });
  const ask = proxiedFetch(base, fetchFn);
  const q = marketQueries(county, thisYear);
  const names = Object.keys(q);
  const got = await Promise.all(names.map((k) => nassRows(q[k], ask)));
  const rows = Object.fromEntries(names.map((k, i) => [k, got[i]]));
  rows.censusLevel = 'county';
  if (!rows.census.length) { // a county with nothing on record: the state's Census instead
    rows.census = await nassRows(stateCensusQuery(county, thisYear), ask);
    rows.censusLevel = 'state';
  }
  return { county, rows, thisYear };
}

const COST_SOURCE_SHORT = {
  ersCostForecast2027: 'USDA ERS 2026F-2027F cost-of-production forecast (US average)',
  isuA120_2026: 'Iowa State University 2026 budget (Iowa)',
  ndsuBudgets2026: 'NDSU 2026 crop budgets (East Central North Dakota)',
};

/** The gap line that says what the planner's per-acre costs are (croptraits.ts: not local). */
export function costLine(crops) {
  const bySource = new Map();
  for (const id of crops) {
    const src = CROP_BY_ID[id]?.operatingCostPerAcre?.source;
    const key = Array.isArray(src) ? src[0] : src;
    if (!key) continue;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(id);
  }
  const parts = [...bySource].map(([key, ids]) => `${COST_SOURCE_SHORT[key] || SOURCES[key]?.title || key} for ${listWords(ids)}`);
  if (!parts.length) return null;
  return `Costs: operating costs per planted acre aren’t local yet: ${parts.join('; ')}. Fallow field work isn’t costed.`;
}

/**
 * The planner's market data from the NASS rows, for dryland ('non-irrigated') or irrigated farms.
 *   crops       planner ids grown locally that have a price and a yield (no fallow, no cover crop)
 *   prices      { id: { price, unit, year, level, place, nassValue, nassUnit, series, source } }
 *               for every crop NASS prices (so a field's past crops are priced too)
 *   baseYields  { id: BaseYield } for the planner's Farm.baseYields
 *   gaps        where it all came from, and what was left out, for the plans' "Good to know"
 */
export function marketFor({ county, rows, thisYear }, { practice = 'non-irrigated' } = {}) {
  const countyPlace = `${county.name}, ${county.state}`;
  const grown = cropsGrown({ censusRows: rows.census, yieldRows: rows.countyYields, thisYear });
  if (!grown.crops.length) {
    return { ok: false, reason: `USDA NASS has no record of the crops this planner knows being grown in ${rows.censusLevel === 'state' ? county.stateName : countyPlace}` };
  }
  const prices = {};
  for (const id of Object.keys(CROP_BY_ID)) {
    const p = pickPrice(id, rows.statePrices, rows.usPrices);
    if (p) prices[id] = p;
  }
  const { baseYields, missing } = baseYieldsFrom({ countyRows: rows.countyYields, stateRows: rows.stateYields, usRows: rows.usYields, crops: grown.crops, practice, thisYear });
  const noPrice = grown.crops.filter((id) => !prices[id]);
  const crops = grown.crops.filter((id) => prices[id] && baseYields[id]);
  if (!crops.length) {
    return { ok: false, reason: `USDA NASS has no current prices or yields for the crops grown in ${countyPlace} (${listWords(grown.crops)})` };
  }

  const gaps = [];
  const where = rows.censusLevel === 'state' ? `${county.stateName} (the county has no record, so the state’s)` : countyPlace;
  const how = [grown.censusYear ? `USDA ${grown.censusYear} Census of Agriculture` : null, Object.keys(grown.surveyed).length ? 'NASS county surveys' : null].filter(Boolean).join(' and ');
  gaps.push(`Crops to choose from: those grown in ${where} (${how}): ${listWords(crops)}, plus fallow and a cereal-rye cover crop.`);
  for (const id of noPrice) gaps.push(`${cap(word(id))} is grown here, but USDA NASS has no price for it in ${county.stateName} or the US, so it’s left out.`);
  for (const id of missing.filter((m) => prices[m])) gaps.push(`${cap(word(id))} is grown here, but USDA NASS has no yield series for it (county, state or US), so it’s left out.`);

  // Prices: grouped by where and which year they're from
  const priceGroups = new Map();
  for (const id of crops) {
    const p = prices[id];
    const key = `${p.level === 'state' ? p.place : 'US'} marketing year ${p.year}`;
    if (!priceGroups.has(key)) priceGroups.set(key, []);
    const conv = p.nassUnit !== `$ / ${p.unit.toUpperCase()}` ? ` from $${p.nassValue.toFixed(2)}${p.nassUnit.replace('$ ', '').replace(' ', '').toLowerCase()}` : '';
    priceGroups.get(key).push(`${word(id)} ${priceText(p.price, p.unit)}${conv}`);
  }
  gaps.push(`Prices: USDA NASS prices received, ${[...priceGroups].map(([k, items]) => `${k} (${items.join(', ')})`).join('; ')}. One price everywhere: no local basis, freight or buyer limits.`);

  // Yields: grouped by place, years and practice
  const yieldGroups = new Map();
  const mixed = [];
  for (const id of crops) {
    const y = baseYields[id];
    const place = y.level === 'county' ? y.place : y.level === 'state' ? county.stateName : 'US';
    const yrs = `${Math.min(...y.years)}-${Math.max(...y.years)}`;
    const key = `${place} ${yrs}, ${y.practice === 'all' ? 'all practices' : y.practice}`;
    if (!yieldGroups.has(key)) yieldGroups.set(key, []);
    yieldGroups.get(key).push(word(id));
    if (y.practice === 'all') mixed.push(id);
  }
  gaps.push(`Yields: USDA NASS averages, ${[...yieldGroups].map(([k, ids]) => `${k} (${ids.join(', ')})`).join('; ')}.`);
  if (mixed.length) gaps.push(`NASS publishes no ${practice} yield split for ${listWords(mixed)} here, so ${mixed.length === 1 ? 'its yield mixes' : 'their yields mix'} irrigated and dryland acres.`);
  const costs = costLine(crops);
  if (costs) gaps.push(costs);

  return { ok: true, county, practice, crops, prices, baseYields, gaps };
}

/** The farm's market data, cached per county and NASS proxy for the session. */
export function createMarkets({ fetchFn = (...a) => globalThis.fetch(...a), base = NASS_PROXY, thisYear = () => new Date().getFullYear() } = {}) {
  const counties = new Map(); // "lng,lat" (3 decimals) -> Promise<county>
  const loads = new Map(); // county fips -> Promise<{ county, rows, thisYear }>

  function rowsFor(point) {
    if (!nassAvailable(base)) return Promise.reject(new Error('this site has no connection to USDA NASS set up'));
    const pk = point.map((v) => v.toFixed(3)).join(',');
    if (!counties.has(pk)) {
      const job = countyAt(point, { fetchFn });
      job.catch(() => counties.delete(pk));
      counties.set(pk, job);
    }
    return counties.get(pk).then((county) => {
      if (!loads.has(county.fips)) {
        const job = loadMarketRows(point, { fetchFn, base, thisYear: thisYear(), county });
        job.catch(() => loads.delete(county.fips));
        loads.set(county.fips, job);
      }
      return loads.get(county.fips);
    });
  }

  return {
    /** Starts the look-ups early (when the fields are picked), so the plans needn't wait. */
    warm(point) { if (point) rowsFor(point).catch(() => {}); },
    async forFarm(point, { practice = 'non-irrigated' } = {}) {
      if (!point) return { ok: false, reason: 'the farm has no fields to locate it by' };
      try {
        return marketFor(await rowsFor(point), { practice });
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    },
  };
}
