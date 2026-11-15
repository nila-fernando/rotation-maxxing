/**
 * Local base yields from USDA NASS Quick Stats (needs a free API key).
 *
 *   base yield = mean of the last 5 available all-practice years
 *                x the practice ratio (non-irrigated or irrigated / all practices)
 *
 * Why the ratio: NASS publishes recent yields only for "all production
 * practices", which mixes irrigated and dryland acres. In Kansas the
 * non-irrigated / irrigated split stops after 2018 (county and state), so the
 * split is applied as a ratio: the mean of (practice yield / all-practice
 * yield) over the years NASS published both (DESIGN). The ratio comes from the
 * same county when it has at least 3 paired years, else from the state.
 *
 * Fallback order for the yield series: county -> state -> national (the US
 * average in croptraits.ts), each with an information gap naming the level.
 *
 * The API key goes in the request URL (Quick Stats requires it), so it is
 * never logged, cached or put in an error message here.
 */
import { CROP_BY_ID } from '../algorithm/croptraits';
import type { BaseYield, CropId } from '../algorithm/types';
import type { FetchFn } from './power';

export type Practice = 'non-irrigated' | 'irrigated';
type PracticeKey = 'all' | Practice;
export type PracticeSeries = Record<PracticeKey, Record<string, number>>;

export interface NassYieldSpec {
  commodity: string;
  util?: string;
  classDesc?: string;
  unit: string;
}

/** Crops with a NASS yield series in the crop's own unit. Others keep the US average. */
export const NASS_YIELD_SPECS: Partial<Record<CropId, NassYieldSpec>> = {
  corn: { commodity: 'CORN', util: 'GRAIN', unit: 'BU / ACRE' },
  soybeans: { commodity: 'SOYBEANS', unit: 'BU / ACRE' },
  'winter-wheat': { commodity: 'WHEAT', classDesc: 'WINTER', unit: 'BU / ACRE' },
  'spring-wheat': { commodity: 'WHEAT', classDesc: 'SPRING, (EXCL DURUM)', unit: 'BU / ACRE' },
  sorghum: { commodity: 'SORGHUM', util: 'GRAIN', unit: 'BU / ACRE' },
  oats: { commodity: 'OATS', unit: 'BU / ACRE' },
  barley: { commodity: 'BARLEY', unit: 'BU / ACRE' },
};

/** DESIGN: average over up to this many most recent available years. */
export const BASE_YIELD_YEARS = 5;
/** DESIGN: a level needs at least this many years (series or paired ratio years) to be used. */
export const MIN_YEARS = 3;
/**
 * DESIGN: only yields from the last this-many years (counted back from the
 * newest NASS year for the crop at any level) are averaged, so a county that
 * stopped reporting falls back to the state instead of a stale average. The
 * practice ratio is exempt: the Kansas split ends in 2018.
 */
export const RECENT_WINDOW_YEARS = 10;
/** First year requested from Quick Stats. */
export const NASS_FIRST_YEAR = 2000;

export function quickStatsUrl(key: string, spec: NassYieldSpec, stateFips: string, countyFips?: string): string {
  const q = new URLSearchParams({
    key,
    source_desc: 'SURVEY',
    sector_desc: 'CROPS',
    commodity_desc: spec.commodity,
    statisticcat_desc: 'YIELD',
    agg_level_desc: countyFips ? 'COUNTY' : 'STATE',
    state_fips_code: stateFips,
    year__GE: String(NASS_FIRST_YEAR),
    format: 'JSON',
  });
  if (countyFips) q.set('county_code', countyFips);
  return `https://quickstats.nass.usda.gov/api/api_GET/?${q}`;
}

/** Quick Stats rows -> yearly yields per practice, plus the place name. */
export function parseYieldRows(body: unknown, spec: NassYieldSpec): { series: PracticeSeries; place: string | null } {
  const series: PracticeSeries = { all: {}, 'non-irrigated': {}, irrigated: {} };
  let place: string | null = null;
  for (const r of (body as { data?: Record<string, string>[] }).data ?? []) {
    if (r['reference_period_desc'] !== 'YEAR') continue;
    if (r['unit_desc'] !== spec.unit && !(r['short_desc'] ?? '').endsWith(`MEASURED IN ${spec.unit}`)) continue;
    if (spec.util && r['util_practice_desc'] !== spec.util) continue;
    if (spec.classDesc && r['class_desc'] !== spec.classDesc) continue;
    const p = r['prodn_practice_desc'];
    const key: PracticeKey | null = p === 'ALL PRODUCTION PRACTICES' ? 'all' : p === 'NON-IRRIGATED' ? 'non-irrigated' : p === 'IRRIGATED' ? 'irrigated' : null;
    if (!key) continue;
    const v = Number((r['Value'] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(v) || v <= 0) continue;
    series[key][r['year']!] = v;
    if (!place) {
      const st = r['state_alpha'] ?? '';
      const county = r['county_name'];
      place = county ? `${titleCase(county)} County, ${st}` : st;
    }
  }
  return { series, place };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bMc(\w)/g, (_, c: string) => `Mc${c.toUpperCase()}`);
}

export interface LevelSeries {
  level: 'county' | 'state';
  place: string;
  series: PracticeSeries;
}

/** Mean of practice/all over years with both; null if fewer than MIN_YEARS. */
export function practiceRatio(s: PracticeSeries, practice: Practice): { value: number; years: number[] } | null {
  const years = Object.keys(s[practice]).filter((y) => s.all[y] !== undefined).map(Number).sort((a, b) => a - b);
  if (years.length < MIN_YEARS) return null;
  const value = years.reduce((a, y) => a + s[practice][String(y)]! / s.all[String(y)]!, 0) / years.length;
  return { value, years };
}

/**
 * Pick the base yield for one crop from county/state series (in that order).
 * Returns null when neither level has enough years (caller falls back to the US average).
 */
export function chooseBaseYield(cropId: CropId, levels: LevelSeries[], practice: Practice): { baseYield: BaseYield | null; gaps: string[] } {
  const name = CROP_BY_ID[cropId]?.name ?? cropId;
  const gaps: string[] = [];
  const newest = Math.max(0, ...levels.flatMap((l) => Object.keys(l.series.all).map(Number)));
  const oldestAllowed = newest - RECENT_WINDOW_YEARS + 1;
  for (const lv of levels) {
    const years = Object.keys(lv.series.all).map(Number).filter((y) => y >= oldestAllowed).sort((a, b) => b - a).slice(0, BASE_YIELD_YEARS);
    if (years.length < MIN_YEARS) continue;
    const allMean = years.reduce((a, y) => a + lv.series.all[String(y)]!, 0) / years.length;
    let ratio: BaseYield['practiceRatio'];
    for (const r of levels) {
      const pr = practiceRatio(r.series, practice);
      if (pr) {
        ratio = { ...pr, level: r.level };
        break;
      }
    }
    if (lv.level !== 'county') gaps.push(`${name}: no county yield series with ${MIN_YEARS}+ years since ${oldestAllowed}; using the ${lv.place} state yield.`);
    if (years.length < BASE_YIELD_YEARS) gaps.push(`${name}: only ${years.length} years of NASS yields at ${lv.place}.`);
    const yrs = `${Math.min(...years)}-${Math.max(...years)}`;
    if (ratio) {
      return {
        baseYield: {
          value: allMean * ratio.value,
          level: lv.level,
          place: lv.place,
          practice,
          years,
          allPracticeMean: allMean,
          practiceRatio: ratio,
          basis: 'design',
          sources: ['nassQuickStats'],
          note: `NASS ${yrs} all-practice mean ${allMean.toFixed(1)} x ${ratio.value.toFixed(3)} (mean ${practice}/all-practice ratio, ${ratio.level} level, ${ratio.years.length} years ${Math.min(...ratio.years)}-${Math.max(...ratio.years)}).`,
        },
        gaps,
      };
    }
    gaps.push(`${name}: NASS publishes no ${practice} yield split here (3+ paired years), so the all-practice yield is used; it mixes irrigated and dryland acres.`);
    return {
      baseYield: {
        value: allMean,
        level: lv.level,
        place: lv.place,
        practice: 'all',
        years,
        allPracticeMean: allMean,
        basis: 'sourced',
        sources: ['nassQuickStats'],
        note: `NASS ${yrs} all-practice mean.`,
      },
      gaps,
    };
  }
  gaps.push(`${name}: no county or state NASS yield series with ${MIN_YEARS}+ years since ${oldestAllowed}; using the US average yield.`);
  return { baseYield: null, gaps };
}

export interface BaseYieldsResult {
  baseYields: Partial<Record<CropId, BaseYield>>;
  gaps: string[];
  /** Raw series per crop and level, for traceability. */
  series: Partial<Record<CropId, LevelSeries[]>>;
}

/** Fetch county and state series for each crop and pick base yields. */
export async function fetchBaseYields(
  o: { key: string; stateFips: string; countyFips: string; crops: CropId[]; practice: Practice },
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<BaseYieldsResult> {
  const out: BaseYieldsResult = { baseYields: {}, gaps: [], series: {} };
  for (const cropId of [...new Set(o.crops)]) {
    const spec = NASS_YIELD_SPECS[cropId];
    if (!spec) {
      if (CROP_BY_ID[cropId]?.yieldUnit) out.gaps.push(`${CROP_BY_ID[cropId]!.name}: no NASS yield series mapped; using the US average yield.`);
      continue;
    }
    const levels: LevelSeries[] = [];
    for (const [level, county] of [['county', o.countyFips], ['state', undefined]] as const) {
      const res = await fetchFn(quickStatsUrl(o.key, spec, o.stateFips, county));
      // Quick Stats answers 400 when a query matches no rows.
      if (res.status === 400) continue;
      if (!res.ok) throw new Error(`NASS Quick Stats request failed (HTTP ${res.status}).`);
      const parsed = parseYieldRows(await res.json(), spec);
      if (parsed.place) levels.push({ level, place: parsed.place, series: parsed.series });
    }
    out.series[cropId] = levels;
    const pick = chooseBaseYield(cropId, levels, o.practice);
    out.gaps.push(...pick.gaps);
    if (pick.baseYield) out.baseYields[cropId] = pick.baseYield;
  }
  return out;
}

/** The shape of src/data/baseYields/<site>.json (precomputed, so the demo needs no key). */
export interface BaseYieldsFile {
  site: string;
  geoid: string;
  place: string;
  retrieved: string;
  'non-irrigated': { baseYields: Partial<Record<CropId, BaseYield>>; gaps: string[] };
  irrigated: { baseYields: Partial<Record<CropId, BaseYield>>; gaps: string[] };
  series: Partial<Record<CropId, LevelSeries[]>>;
}
