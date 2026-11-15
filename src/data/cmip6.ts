/**
 * NASA NEX-GDDP-CMIP6 (NASA NCCS; CC0) point access and trend fitting, for the
 * "today's climate" weather adjustment. Thrasher et al. 2022, Scientific Data.
 *
 * Access is by point subsetting through the NCCS THREDDS NetCDF Subset Service
 * (one request = one variable, one year, one 0.25 deg grid cell). Whole files
 * are never downloaded. The precompute script (scripts/cmip6-trends.ts) uses
 * this module and writes small JSON files of per-model monthly trends; the
 * planning engine only ever reads those JSON files.
 *
 * Trends: for each model, variable and calendar month, an ordinary least-squares
 * line through the 3-month moving-window means (centred on the month, wrapping
 * Dec-Jan across years) for 1995-2035 (historical 1995-2014 joined to ssp245
 * 2015-2035). The 3-month window (design) reduces single-run noise. Each trend
 * carries its standard error so noise can be told apart from signal.
 */
import type { FetchFn } from './power';

export const CMIP6_VARIABLES = ['tasmax', 'tasmin', 'pr', 'hurs', 'rsds', 'sfcWind'] as const;
export type Cmip6Variable = (typeof CMIP6_VARIABLES)[number];

/** Multiplicative variables are trended relative to their 1995-2035 mean. */
export const RELATIVE_VARIABLES: readonly Cmip6Variable[] = ['pr', 'rsds', 'sfcWind'];

/**
 * The five models. Selection rule: all six variables for historical and ssp245
 * in the same run, every year 1995-2060 present, a standard calendar, distinct
 * modelling centres, and equilibrium climate sensitivity inside the IPCC AR6
 * "very likely" range of 2-5 C (AR6 WG1 SPM A.4.4). ECS values: IPCC AR6 WG1
 * Chapter 7 Supplementary Material, Table 7.SM.5.
 */
export const CMIP6_MODELS = [
  { model: 'MIROC6', variant: 'r1i1p1f1', ecsC: 2.61, centre: 'MIROC (Japan)' },
  { model: 'MPI-ESM1-2-HR', variant: 'r1i1p1f1', ecsC: 2.98, centre: 'MPI-M (Germany)' },
  { model: 'MRI-ESM2-0', variant: 'r1i1p1f1', ecsC: 3.15, centre: 'MRI (Japan)' },
  { model: 'IPSL-CM6A-LR', variant: 'r1i1p1f1', ecsC: 4.56, centre: 'IPSL (France)' },
  { model: 'ACCESS-CM2', variant: 'r1i1p1f1', ecsC: 4.72, centre: 'CSIRO-ARCCSS (Australia)' },
] as const;

export const CMIP6_CITATIONS = {
  data: 'Thrasher, B., Wang, W., Michaelis, A., Melton, F., Lee, T. & Nemani, R. (2022). NASA Global Daily Downscaled Projections, CMIP6. Scientific Data 9, 262. https://doi.org/10.1038/s41597-022-01393-4 (data: NASA NCCS, CC0)',
  ecs: 'IPCC AR6 WG1 Chapter 7 Supplementary Material, Table 7.SM.5 (ECS by model); selection rule: AR6 WG1 SPM A.4.4 very likely range 2-5 C',
} as const;

export const FIT_YEARS = { first: 1995, last: 2035, historicalLast: 2014 } as const;
export const THREDDS = 'https://ds.nccs.nasa.gov/thredds';

export function scenarioFor(year: number): 'historical' | 'ssp245' {
  return year <= FIT_YEARS.historicalLast ? 'historical' : 'ssp245';
}

export function catalogUrl(model: string, scenario: string, variant: string, variable: string): string {
  return `${THREDDS}/catalog/AMES/NEX/GDDP-CMIP6/${model}/${scenario}/${variant}/${variable}/catalog.xml`;
}

/** year -> dataset urlPath, preferring the highest version suffix (_v2.0 over _v1.1 over none). */
export function parseCatalog(xml: string): Map<number, string> {
  const best = new Map<number, { path: string; version: number }>();
  for (const m of xml.matchAll(/urlPath="([^"]+_(\d{4})(?:_v([\d.]+))?\.nc)"/g)) {
    const year = Number(m[2]);
    const version = m[3] ? Number(m[3]) : 0;
    const cur = best.get(year);
    if (!cur || version > cur.version) best.set(year, { path: m[1]!, version });
  }
  return new Map([...best].map(([y, v]) => [y, v.path]));
}

export function ncssUrl(urlPath: string, variable: string, lat: number, lng: number, year: number): string {
  const q = new URLSearchParams({
    var: variable,
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    time_start: `${year}-01-01T00:00:00Z`,
    time_end: `${year}-12-31T23:59:59Z`,
    accept: 'csv',
  });
  return `${THREDDS}/ncss/grid/${urlPath}?${q}`;
}

export interface PointSeries {
  /** YYYY-MM-DD */
  dates: string[];
  /** Values in the model's native units. */
  values: number[];
  gridLat: number;
  gridLng: number;
}

/** Parse an NCSS point CSV (time, station, latitude, longitude, value). */
export function parseNcssCsv(text: string): PointSeries {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !lines[0]!.startsWith('time')) throw new Error('Not an NCSS point CSV response.');
  const dates: string[] = [];
  const values: number[] = [];
  let gridLat = NaN;
  let gridLng = NaN;
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const v = Number(cols[4]);
    if (!Number.isFinite(v)) continue;
    dates.push(cols[0]!.slice(0, 10));
    values.push(v);
    gridLat = Number(cols[2]);
    gridLng = Number(cols[3]);
  }
  return { dates, values, gridLat, gridLng };
}

/** NEX-GDDP native units -> the units NASA POWER and the water balance use. */
export function toModelUnits(variable: Cmip6Variable, v: number): number {
  switch (variable) {
    case 'tasmax':
    case 'tasmin':
      return v - 273.15; // K -> C
    case 'pr':
      return v * 86400; // kg m-2 s-1 -> mm/day
    case 'rsds':
      return v * 0.0864; // W m-2 -> MJ m-2 day-1
    case 'hurs':
    case 'sfcWind':
      return v; // % and m/s already
  }
}

/** Monthly means (index 0 = January) of one year's daily series. */
export function monthlyMeans(s: PointSeries): number[] {
  const sum = Array<number>(12).fill(0);
  const n = Array<number>(12).fill(0);
  s.dates.forEach((d, i) => {
    const m = Number(d.slice(5, 7)) - 1;
    sum[m]! += s.values[i]!;
    n[m]!++;
  });
  return sum.map((v, m) => (n[m] ? v / n[m]! : NaN));
}

export interface Trend {
  /** Per calendar month (0 = Jan): change per year (absolute units, or relative fraction for pr/rsds/sfcWind). */
  slope: number[];
  /** Standard error of each slope, same units. */
  se: number[];
}

/** Ordinary least squares slope and its standard error. */
export function olsSlope(xs: number[], ys: number[]): { slope: number; se: number; mean: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxy / sxx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (ys[i]! - (my + slope * (xs[i]! - mx))) ** 2;
  const se = n > 2 ? Math.sqrt(rss / (n - 2) / sxx) : NaN;
  return { slope, se, mean: my };
}

/**
 * Trend per calendar month from monthly means by year, on 3-month windows
 * centred on the month (Dec-Jan wrap uses the neighbouring year). Relative
 * variables are divided by the window series' mean, so the slope is a
 * fraction per year.
 */
export function fitTrend(byYear: Map<number, number[]>, relative: boolean): Trend {
  const slope: number[] = [];
  const se: number[] = [];
  const years = [...byYear.keys()].sort((a, b) => a - b);
  for (let m = 0; m < 12; m++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const y of years) {
      const at = (yy: number, mm: number) => byYear.get(yy)?.[mm];
      const prev = m === 0 ? at(y - 1, 11) : at(y, m - 1);
      const cur = at(y, m);
      const next = m === 11 ? at(y + 1, 0) : at(y, m + 1);
      if (prev === undefined || cur === undefined || next === undefined) continue;
      const w = (prev + cur + next) / 3;
      if (!Number.isFinite(w)) continue;
      xs.push(y);
      ys.push(w);
    }
    const fit = olsSlope(xs, ys);
    const scale = relative && fit.mean !== 0 ? 1 / fit.mean : 1;
    slope.push(fit.slope * scale);
    se.push(fit.se * Math.abs(scale));
  }
  return { slope, se };
}

/** Linear back-off between retries in the precompute (5 s, 10 s, ... ). */
export const RETRY_BACKOFF_MS = 5000;

/** A minimal cache interface (the script backs it with files; tests with a Map). */
export interface ResponseCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/** Fetch text with the cache in front, retrying transient errors. */
export async function cachedText(url: string, cache: ResponseCache, fetchFn: FetchFn, attempts = 4, backoffMs = 0): Promise<string> {
  const hit = await cache.get(url);
  if (hit !== undefined) return hit;
  let last = '';
  for (let a = 0; a < attempts; a++) {
    // Back off before each retry (linear), so a brief network drop or NCCS hiccup doesn't end the run.
    if (a > 0 && backoffMs > 0) await new Promise((r) => setTimeout(r, backoffMs * a));
    try {
      const res = await fetchFn(url);
      if (res.ok) {
        const text = await res.text();
        await cache.set(url, text);
        return text;
      }
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new Error(`NEX-GDDP-CMIP6 request failed (${last}): ${url}`);
}

/** Run async jobs with at most `limit` in flight (4 by default: be polite to NCCS). */
export async function pool<T>(jobs: (() => Promise<T>)[], limit = 4): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}

export interface ModelTrends {
  model: string;
  variant: string;
  ecsC: number;
  trends: Record<Cmip6Variable, Trend>;
}

/** The JSON file written per site and read by the engine. */
export interface Cmip6Trends {
  site: string;
  requested: { lat: number; lng: number };
  gridCell: { lat: number; lng: number };
  fitYears: [number, number];
  /** 3-month moving windows centred on each calendar month. */
  window: '3-month centred';
  scenarioNote: string;
  units: Record<Cmip6Variable, string>;
  models: ModelTrends[];
  citations: typeof CMIP6_CITATIONS;
  retrieved: string;
}

/** Fetch and fit all five models for one site. `retrieved` is passed in (no clock here). */
export async function fetchSiteTrends(
  site: string,
  lat: number,
  lng: number,
  retrieved: string,
  cache: ResponseCache,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
  onProgress?: (done: number, total: number) => void,
): Promise<Cmip6Trends> {
  const models: ModelTrends[] = [];
  let gridCell = { lat: NaN, lng: NaN };
  const total = CMIP6_MODELS.length * CMIP6_VARIABLES.length * (FIT_YEARS.last - FIT_YEARS.first + 1);
  let done = 0;
  for (const m of CMIP6_MODELS) {
    const trends = {} as Record<Cmip6Variable, Trend>;
    for (const v of CMIP6_VARIABLES) {
      const catalogs = new Map<string, Map<number, string>>();
      for (const sc of ['historical', 'ssp245']) {
        catalogs.set(sc, parseCatalog(await cachedText(catalogUrl(m.model, sc, m.variant, v), cache, fetchFn, 6, RETRY_BACKOFF_MS)));
      }
      const years = Array.from({ length: FIT_YEARS.last - FIT_YEARS.first + 1 }, (_, i) => FIT_YEARS.first + i);
      const series = await pool(
        years.map((y) => async () => {
          const path = catalogs.get(scenarioFor(y))!.get(y);
          if (!path) throw new Error(`No ${m.model} ${v} file for ${y}`);
          const s = parseNcssCsv(await cachedText(ncssUrl(path, v, lat, lng, y), cache, fetchFn, 6, RETRY_BACKOFF_MS));
          done++;
          onProgress?.(done, total);
          return { y, s };
        }),
        4,
      );
      const byYear = new Map<number, number[]>();
      for (const { y, s } of series) {
        gridCell = { lat: s.gridLat, lng: s.gridLng };
        byYear.set(y, monthlyMeans({ ...s, values: s.values.map((x) => toModelUnits(v, x)) }));
      }
      trends[v] = fitTrend(byYear, RELATIVE_VARIABLES.includes(v));
    }
    models.push({ model: m.model, variant: m.variant, ecsC: m.ecsC, trends });
  }
  return {
    site,
    requested: { lat, lng },
    gridCell,
    fitYears: [FIT_YEARS.first, FIT_YEARS.last],
    window: '3-month centred',
    scenarioNote:
      'Historical runs end in 2014 and SSP2-4.5 starts in 2015; this close to the present the scenario choice barely affects the trend.',
    units: { tasmax: 'C per year', tasmin: 'C per year', hurs: '% (RH points) per year', pr: 'fraction per year', rsds: 'fraction per year', sfcWind: 'fraction per year' },
    models,
    citations: CMIP6_CITATIONS,
    retrieved,
  };
}
