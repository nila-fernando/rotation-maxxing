// Local crops, yields and prices from USDA NASS Quick Stats, for the rotation planner.
//
// Quick Stats needs an API key and sends no CORS header, so the browser never calls it: every request
// goes through our own proxy, which adds the key on the server (the Vite dev/preview server, or the
// Cloudflare Worker in proxy/cropscape/ for the live site). The proxy is VITE_NASS_PROXY, set at
// build time like VITE_CDL_PROXY: '/nass' for `npm run dev` and `npm run preview`, '' (off) for the
// GitHub Pages build unless it is set. With no proxy there is no market data, and the plans say so.
//
// Everything below the fetch helpers is pure (rows in, numbers out), so it is unit tested.
import { CROP_BY_ID } from '../vendor/rotation-maxxing/algorithm/croptraits.ts';
import { chooseBaseYield, parseYieldRows, BASE_YIELD_YEARS, MIN_YEARS, RECENT_WINDOW_YEARS, NASS_FIRST_YEAR } from '../vendor/rotation-maxxing/data/nassYields.ts';

const envProxy = import.meta.env?.VITE_NASS_PROXY; // undefined under node:test
/** The NASS proxy path or URL (no trailing slash); '' when this build has none. */
export const NASS_PROXY = typeof envProxy === 'string' ? envProxy.trim().replace(/\/+$/, '') : '/nass';
/** Whether this site can ask NASS at all. */
export const nassAvailable = (base = NASS_PROXY) => !!base;

export const QUICKSTATS = 'https://quickstats.nass.usda.gov/api/';

/**
 * A Quick Stats URL as the same request through the proxy, with any `key` taken out (the proxy adds
 * its own). Anything that isn't a Quick Stats URL is returned as it was.
 */
export function toProxyUrl(url, base = NASS_PROXY) {
  const s = String(url);
  if (!s.startsWith(QUICKSTATS)) return s;
  const u = new URL(s);
  u.searchParams.delete('key');
  const path = u.pathname.replace(/^\/api\//, '');
  return `${base}/${path}${u.search}`;
}

/** A fetch that sends Quick Stats URLs through the proxy (for the vendored nassYields functions too). */
export const proxiedFetch = (base = NASS_PROXY, fetchFn = globalThis.fetch) => (url, init) => fetchFn(toProxyUrl(url, base), init);

/** A Quick Stats api_GET URL (no key) from { param: value | value[] }; repeated params mean "any of". */
export function quickStatsUrl(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const x of [].concat(v)) if (x != null && x !== '') q.append(k, String(x));
  q.set('format', 'JSON');
  return `${QUICKSTATS}api_GET/?${q}`;
}

/**
 * The planner's crops as NASS names them. `bases` are the series names (short_desc before " - "):
 * yields are "<base> - YIELD, MEASURED IN <unit>" (plus ", IRRIGATED" / ", NON-IRRIGATED" splits),
 * Census acreage "<base> - ACRES HARVESTED". `prices` are PRICE RECEIVED series in order of
 * preference (the crop's own class first, then the commodity as a whole). `lbPerBu` is the USDA
 * standard bushel weight, for prices NASS gives per hundredweight.
 */
export const NASS_CROPS = {
  corn: { bases: ['CORN, GRAIN'], unit: 'BU / ACRE', lbPerBu: 56, prices: ['CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU'] },
  soybeans: { bases: ['SOYBEANS'], unit: 'BU / ACRE', lbPerBu: 60, prices: ['SOYBEANS - PRICE RECEIVED, MEASURED IN $ / BU'] },
  'winter-wheat': { bases: ['WHEAT, WINTER'], unit: 'BU / ACRE', lbPerBu: 60, prices: ['WHEAT, WINTER - PRICE RECEIVED, MEASURED IN $ / BU', 'WHEAT - PRICE RECEIVED, MEASURED IN $ / BU'] },
  'spring-wheat': { bases: ['WHEAT, SPRING, (EXCL DURUM)'], unit: 'BU / ACRE', lbPerBu: 60, prices: ['WHEAT, SPRING, (EXCL DURUM) - PRICE RECEIVED, MEASURED IN $ / BU', 'WHEAT - PRICE RECEIVED, MEASURED IN $ / BU'] },
  sorghum: { bases: ['SORGHUM, GRAIN'], unit: 'BU / ACRE', lbPerBu: 56, prices: ['SORGHUM, GRAIN - PRICE RECEIVED, MEASURED IN $ / CWT', 'SORGHUM, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU'] },
  oats: { bases: ['OATS'], unit: 'BU / ACRE', lbPerBu: 32, prices: ['OATS - PRICE RECEIVED, MEASURED IN $ / BU'] },
  barley: { bases: ['BARLEY'], unit: 'BU / ACRE', lbPerBu: 48, prices: ['BARLEY - PRICE RECEIVED, MEASURED IN $ / BU'] },
  alfalfa: { bases: ['HAY, ALFALFA'], unit: 'TONS / ACRE', prices: ['HAY, ALFALFA - PRICE RECEIVED, MEASURED IN $ / TON'] },
  cotton: { bases: ['COTTON, UPLAND'], unit: 'LB / ACRE', prices: ['COTTON, UPLAND - PRICE RECEIVED, MEASURED IN $ / LB'] },
  sunflower: { bases: ['SUNFLOWER'], unit: 'LB / ACRE', prices: ['SUNFLOWER, OIL TYPE - PRICE RECEIVED, MEASURED IN $ / CWT', 'SUNFLOWER - PRICE RECEIVED, MEASURED IN $ / CWT'] },
  canola: { bases: ['CANOLA'], unit: 'LB / ACRE', prices: ['CANOLA - PRICE RECEIVED, MEASURED IN $ / CWT'] },
  'dry-beans': {
    bases: ['BEANS, DRY EDIBLE, (EXCL CHICKPEAS)', 'BEANS, DRY EDIBLE, INCL CHICKPEAS'],
    censusBases: ['BEANS, DRY EDIBLE, (EXCL CHICKPEAS & LIMA)', 'BEANS, DRY EDIBLE, (EXCL CHICKPEAS)', 'BEANS, DRY EDIBLE, INCL CHICKPEAS'],
    unit: 'LB / ACRE',
    prices: ['BEANS, DRY EDIBLE, (EXCL CHICKPEAS) - PRICE RECEIVED, MEASURED IN $ / CWT', 'BEANS, DRY EDIBLE, INCL CHICKPEAS - PRICE RECEIVED, MEASURED IN $ / CWT'],
  },
};
/** Planner crops NASS can tell us about (cash crops: fallow and the cover crop need no price). */
export const NASS_CROP_IDS = Object.keys(NASS_CROPS);

const PRACTICES = ['', ', IRRIGATED', ', NON-IRRIGATED'];
const yieldShort = (base, unit, practice = '') => `${base}${practice} - YIELD, MEASURED IN ${unit}`;
const censusShort = (base) => `${base} - ACRES HARVESTED`;

/** Every yield series name to ask for (all practices only, or with the irrigated/dryland splits). */
export function yieldSeries({ splits = true } = {}) {
  return NASS_CROP_IDS.flatMap((id) => NASS_CROPS[id].bases.flatMap((b) => (splits ? PRACTICES : ['']).map((p) => yieldShort(b, NASS_CROPS[id].unit, p))));
}
export const censusSeries = () => [...new Set(NASS_CROP_IDS.flatMap((id) => (NASS_CROPS[id].censusBases || NASS_CROPS[id].bases).map(censusShort)))];
export const priceSeries = () => [...new Set(NASS_CROP_IDS.flatMap((id) => NASS_CROPS[id].prices))];

/**
 * The Quick Stats requests behind one farm's market data (all without a key; see toProxyUrl).
 * county: { stateFips: '20', countyCode: '169', state: 'KS' }
 */
export function marketQueries(county, thisYear) {
  const survey = { source_desc: 'SURVEY', reference_period_desc: 'YEAR' };
  return {
    countyYields: quickStatsUrl({ ...survey, short_desc: yieldSeries(), agg_level_desc: 'COUNTY', state_fips_code: county.stateFips, county_code: county.countyCode, year__GE: NASS_FIRST_YEAR }),
    stateYields: quickStatsUrl({ ...survey, short_desc: yieldSeries(), agg_level_desc: 'STATE', state_fips_code: county.stateFips, year__GE: NASS_FIRST_YEAR }),
    usYields: quickStatsUrl({ ...survey, short_desc: yieldSeries({ splits: false }), agg_level_desc: 'NATIONAL', year__GE: thisYear - 12 }),
    census: quickStatsUrl({ source_desc: 'CENSUS', short_desc: censusSeries(), domain_desc: 'TOTAL', agg_level_desc: 'COUNTY', state_fips_code: county.stateFips, county_code: county.countyCode, year__GE: thisYear - 10 }),
    statePrices: quickStatsUrl({ source_desc: 'SURVEY', short_desc: priceSeries(), reference_period_desc: 'MARKETING YEAR', agg_level_desc: 'STATE', state_alpha: county.state, year__GE: thisYear - 6 }),
    usPrices: quickStatsUrl({ source_desc: 'SURVEY', short_desc: priceSeries(), reference_period_desc: 'MARKETING YEAR', agg_level_desc: 'NATIONAL', year__GE: thisYear - 6 }),
  };
}
/** The state-level Census acreage, asked only when the county has none on record. */
export const stateCensusQuery = (county, thisYear) => quickStatsUrl({ source_desc: 'CENSUS', short_desc: censusSeries(), domain_desc: 'TOTAL', agg_level_desc: 'STATE', state_fips_code: county.stateFips, year__GE: thisYear - 10 });

/** A Quick Stats Value as a number: "1,234.5" -> 1234.5; "(D)", "(NA)", "(Z)" and blanks -> null. */
export function nassNumber(v) {
  const s = String(v ?? '').trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * A NASS price in the unit the planner's yields use for that crop (croptraits.ts yieldUnit: bu, lb
 * or ton). Hundredweight is 100 lb, a short ton 2000 lb; bushels convert at the crop's standard
 * weight. Returns null when the units can't be matched (say $/BU for a crop with no bushel weight).
 */
export function toYieldUnit(value, nassUnit, cropId) {
  const to = CROP_BY_ID[cropId]?.yieldUnit;
  const lbPerBu = NASS_CROPS[cropId]?.lbPerBu;
  if (!Number.isFinite(value) || !to) return null;
  const from = { '$ / BU': 'bu', '$ / CWT': 'cwt', '$ / LB': 'lb', '$ / TON': 'ton' }[String(nassUnit).trim()];
  if (!from) return null;
  if (from === to) return value;
  const perLb = from === 'lb' ? value : from === 'cwt' ? value / 100 : from === 'ton' ? value / 2000 : lbPerBu ? value / lbPerBu : null;
  if (perLb == null) return null;
  if (to === 'lb') return perLb;
  if (to === 'ton') return perLb * 2000;
  if (to === 'bu') return lbPerBu ? perLb * lbPerBu : null;
  return null;
}

/** The newest marketing-year value among a crop's price series in these rows (earlier series win ties). */
function newestPrice(rows, series) {
  let best = null;
  series.forEach((short, rank) => {
    for (const r of rows) {
      if (r.short_desc !== short || r.reference_period_desc !== 'MARKETING YEAR') continue;
      const value = nassNumber(r.Value);
      const year = Number(r.year);
      if (value == null || value <= 0 || !Number.isInteger(year)) continue;
      if (!best || year > best.year || (year === best.year && rank < best.rank)) best = { year, value, short, rank, unit: r.unit_desc, place: r.state_name || r.location_desc || '' };
    }
  });
  return best;
}

/** DESIGN: a state price is used if it's no more than this many years older than the US one. */
export const STATE_PRICE_LAG_YEARS = 1;

/**
 * One crop's latest NASS marketing-year price received: the state's when it's current (within
 * STATE_PRICE_LAG_YEARS of the newest US year), else the US average. In the planner's unit.
 * Returns null when NASS has no usable price at either level.
 */
export function pickPrice(cropId, stateRows = [], usRows = []) {
  const spec = NASS_CROPS[cropId];
  if (!spec) return null;
  const st = newestPrice(stateRows, spec.prices);
  const us = newestPrice(usRows, spec.prices);
  const useState = st && (!us || st.year >= us.year - STATE_PRICE_LAG_YEARS);
  for (const [pick, level] of useState ? [[st, 'state'], [us, 'national']] : [[us, 'national']]) {
    if (!pick) continue;
    const price = toYieldUnit(pick.value, pick.unit, cropId);
    if (price == null) continue;
    return {
      price,
      unit: CROP_BY_ID[cropId].yieldUnit,
      year: pick.year,
      level,
      place: level === 'state' ? titleCase(pick.place) : 'US',
      nassValue: pick.value,
      nassUnit: pick.unit,
      series: pick.short,
      source: 'USDA NASS Quick Stats, price received, marketing year',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The crops grown locally
// ---------------------------------------------------------------------------

/** DESIGN: a county yield this recent (years back from this year) also counts as "grown here". */
export const SURVEY_RECENT_YEARS = 5;

/**
 * The planner crops grown in a place: harvested in the latest Census of Agriculture there (acres on
 * record, or "(D)": withheld so as not to show single farms, which still means it's grown), or with
 * a NASS county yield in the last SURVEY_RECENT_YEARS years. Returns { crops, censusYear, acres, surveyed }.
 */
export function cropsGrown({ censusRows = [], yieldRows = [], thisYear }) {
  const acresRows = censusRows.filter((r) => /- ACRES HARVESTED$/.test(r.short_desc || ''));
  const censusYear = acresRows.length ? Math.max(...acresRows.map((r) => Number(r.year)).filter(Number.isFinite)) : null;
  const acres = {};
  const surveyed = {};
  for (const id of NASS_CROP_IDS) {
    const spec = NASS_CROPS[id];
    const names = new Set((spec.censusBases || spec.bases).map(censusShort));
    for (const r of acresRows) {
      if (Number(r.year) !== censusYear || !names.has(r.short_desc)) continue;
      const n = nassNumber(r.Value);
      if (n != null && n > 0) acres[id] = (typeof acres[id] === 'number' ? acres[id] : 0) + n; // (two bean series never overlap in one year)
      else if (String(r.Value).trim() === '(D)' && !(id in acres)) acres[id] = 'D';
    }
    const ys = new Set(spec.bases.map((b) => yieldShort(b, spec.unit)));
    for (const r of yieldRows) {
      const y = Number(r.year);
      if (ys.has(r.short_desc) && y >= thisYear - SURVEY_RECENT_YEARS && nassNumber(r.Value) > 0) surveyed[id] = Math.max(surveyed[id] ?? 0, y);
    }
  }
  const crops = NASS_CROP_IDS.filter((id) => id in acres || id in surveyed);
  return { crops, censusYear, acres, surveyed };
}

// ---------------------------------------------------------------------------
// Yields
// ---------------------------------------------------------------------------

/** One crop's yield rows from a mixed response (its own series only), for the vendored parser. */
function rowsFor(cropId, rows) {
  const spec = NASS_CROPS[cropId];
  const names = new Set(spec.bases.flatMap((b) => PRACTICES.map((p) => yieldShort(b, spec.unit, p))));
  return rows.filter((r) => names.has(r.short_desc));
}

/**
 * The base (average-year) yield per crop for this farm: the vendored chooser over the county, then the
 * state series (with the non-irrigated or irrigated ratio when NASS has the split), then the US
 * NASS average of the last BASE_YIELD_YEARS years. A county or state series that stopped more than
 * RECENT_WINDOW_YEARS before `thisYear` is too old to stand for today (California stopped
 * publishing sorghum in 2008), so the US one is used instead. A crop with none of these has no yield.
 * Returns { baseYields: { cropId: BaseYield }, missing: [cropId] }.
 */
export function baseYieldsFrom({ countyRows = [], stateRows = [], usRows = [], crops, practice, thisYear = new Date().getFullYear() }) {
  const baseYields = {};
  const missing = [];
  for (const id of crops) {
    const spec = NASS_CROPS[id];
    if (!spec) continue;
    const levels = [];
    for (const [level, rows] of [['county', countyRows], ['state', stateRows]]) {
      const parsed = parseYieldRows({ data: rowsFor(id, rows) }, { unit: spec.unit });
      if (parsed.place) levels.push({ level, place: parsed.place, series: parsed.series });
    }
    const pick = chooseBaseYield(id, levels, practice);
    if (pick.baseYield && Math.max(...pick.baseYield.years) > thisYear - RECENT_WINDOW_YEARS) { baseYields[id] = pick.baseYield; continue; }
    const us = nationalYield(id, usRows);
    if (us) baseYields[id] = us; else missing.push(id);
  }
  return { baseYields, missing };
}

/** The US NASS all-practice yield: mean of the newest BASE_YIELD_YEARS years within the recent window. */
export function nationalYield(cropId, usRows) {
  const spec = NASS_CROPS[cropId];
  const { series } = parseYieldRows({ data: rowsFor(cropId, usRows) }, { unit: spec.unit });
  const all = Object.keys(series.all).map(Number);
  if (!all.length) return null;
  const newest = Math.max(...all);
  const years = all.filter((y) => y > newest - RECENT_WINDOW_YEARS).sort((a, b) => b - a).slice(0, BASE_YIELD_YEARS);
  if (years.length < MIN_YEARS) return null;
  const mean = years.reduce((a, y) => a + series.all[String(y)], 0) / years.length;
  return {
    value: mean, level: 'national', place: 'US', practice: 'all', years, allPracticeMean: mean,
    basis: 'sourced', sources: ['nassQuickStats'], note: `NASS ${Math.min(...years)}-${Math.max(...years)} US all-practice mean.`,
  };
}

export function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
