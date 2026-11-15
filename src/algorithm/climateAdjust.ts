/**
 * Shift the NASA POWER weather record toward TODAY's climate (change-factor /
 * delta method), using per-model monthly trends from NASA NEX-GDDP-CMIP6
 * (precomputed by scripts/cmip6-trends.ts; Thrasher et al. 2022).
 *
 * For a day in year y and calendar month m, with dt = targetYear - y:
 *   tasmax, tasmin  += slope[m] x dt                  (C)
 *   hurs            += slope[m] x dt, kept in 0..100  (RH points)
 *   pr, rsds, wind  *= clamp(1 + relSlope[m] x dt, 0.5, 2.0)   (DESIGN clamp; dry days stay dry)
 *   if the shifted Tmin exceeds Tmax, Tmin = Tmax     (DESIGN)
 * Recent years move little; old years move more. Everything downstream
 * (ET0, water balance, freeze, erosivity) is recomputed from the shifted days.
 *
 * Ensemble: the deterministic search uses the 5-model MEAN trend; Monte Carlo
 * picks one model per sample (shared by every paddock and plan), so
 * disagreement between climate models widens P10.
 *
 * Only trends are used (NEX-GDDP is bias-adjusted to GMFD, not POWER), and
 * only averages shift: changes in extremes or variability are not represented.
 */
import { scenariosFromDailyWeather, type ClimateOptions } from './climate';
import type { DailyWeather, Farm, WeatherEnsemble, WeatherAdjustmentMeta, WeatherScenario } from './types';

export const CLIMATE_VARIABLES = ['tasmax', 'tasmin', 'pr', 'hurs', 'rsds', 'sfcWind'] as const;
export type ClimateVariable = (typeof CLIMATE_VARIABLES)[number];
const RELATIVE: readonly ClimateVariable[] = ['pr', 'rsds', 'sfcWind'];

/** DESIGN: multiplicative factors are kept within this range. */
export const MULTIPLIER_CLAMP = { min: 0.5, max: 2.0 } as const;

export interface Trend {
  /** Per calendar month (0 = Jan). Absolute per year, or a fraction per year for pr/rsds/sfcWind. */
  slope: number[];
  se: number[];
}
export type TrendSet = Record<ClimateVariable, Trend>;

/** The shape of src/data/cmip6/<site>.json (only the fields the engine reads). */
export interface ClimateTrendsFile {
  site: string;
  gridCell: { lat: number; lng: number };
  fitYears: [number, number];
  models: { model: string; variant?: string; ecsC: number; trends: TrendSet }[];
}

/** Ensemble-mean trend; its standard error is sqrt(sum se^2) / n (design: models treated as independent). */
export function meanTrends(file: ClimateTrendsFile): TrendSet {
  const n = file.models.length;
  const out = {} as TrendSet;
  for (const v of CLIMATE_VARIABLES) {
    const slope = Array.from({ length: 12 }, (_, m) => file.models.reduce((a, x) => a + x.trends[v].slope[m]!, 0) / n);
    const se = Array.from({ length: 12 }, (_, m) => Math.sqrt(file.models.reduce((a, x) => a + x.trends[v].se[m]! ** 2, 0)) / n);
    out[v] = { slope, se };
  }
  return out;
}

export function zeroTrends(): TrendSet {
  const z = (): Trend => ({ slope: Array(12).fill(0), se: Array(12).fill(0) });
  return { tasmax: z(), tasmin: z(), pr: z(), hurs: z(), rsds: z(), sfcWind: z() };
}

const clampMult = (x: number) => Math.min(MULTIPLIER_CLAMP.max, Math.max(MULTIPLIER_CLAMP.min, x));

/** Shift every day of the record toward `targetYear`. Pure: returns new arrays. */
export function adjustDailyWeather(w: DailyWeather, t: TrendSet, targetYear: number): DailyWeather {
  const n = w.dates.length;
  const out: DailyWeather = {
    ...w,
    tmaxC: new Array(n),
    tminC: new Array(n),
    rainMm: new Array(n),
    solarMJ: new Array(n),
    rhPct: new Array(n),
    wind2m: new Array(n),
    source: w.source,
  };
  for (let i = 0; i < n; i++) {
    const d = w.dates[i]!;
    const dt = targetYear - Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7)) - 1;
    const tmax = w.tmaxC[i]! + t.tasmax.slope[m]! * dt;
    out.tmaxC[i] = tmax;
    out.tminC[i] = Math.min(tmax, w.tminC[i]! + t.tasmin.slope[m]! * dt);
    out.rainMm[i] = w.rainMm[i]! * clampMult(1 + t.pr.slope[m]! * dt);
    out.solarMJ[i] = w.solarMJ[i]! * clampMult(1 + t.rsds.slope[m]! * dt);
    out.wind2m[i] = w.wind2m[i]! * clampMult(1 + t.sfcWind.slope[m]! * dt);
    out.rhPct[i] = Math.min(100, Math.max(0, w.rhPct[i]! + t.hurs.slope[m]! * dt));
  }
  return out;
}

export interface ShiftRow {
  variable: ClimateVariable;
  /** Calendar month the row describes (0 = Jan). */
  month: number;
  /** Shift applied to the oldest year: C or RH points for absolute variables, % for relative ones. */
  shift: number;
  unit: string;
  /** |trend| < 2 x standard error: likely noise. */
  likelyNoise: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Shift of every variable and month for one year (the oldest pool year, typically). */
export function shiftTable(t: TrendSet, year: number, targetYear: number): ShiftRow[] {
  const dt = targetYear - year;
  const rows: ShiftRow[] = [];
  for (const v of CLIMATE_VARIABLES) {
    for (let m = 0; m < 12; m++) {
      const rel = RELATIVE.includes(v);
      const raw = t[v].slope[m]! * dt;
      rows.push({
        variable: v,
        month: m,
        shift: rel ? (clampMult(1 + raw) - 1) * 100 : raw,
        unit: rel ? '%' : v === 'hurs' ? 'RH points' : 'C',
        likelyNoise: Math.abs(t[v].slope[m]!) < 2 * t[v].se[m]!,
      });
    }
  }
  return rows;
}

export interface BuildWeatherOptions {
  trends?: ClimateTrendsFile;
  /** The season being planned. Falls back to last weather year + 1 (with a gap) when missing. */
  targetYear?: number;
  /** Default 'present' when trends are given, otherwise 'none'. */
  weatherAdjustment?: 'none' | 'present';
  climate?: ClimateOptions;
}

export interface BuiltWeather {
  /** Pass this to generatePlans / evaluatePlan / createFarmState. */
  weather: WeatherScenario[] | WeatherEnsemble;
  gaps: string[];
  targetYear: number;
}

export const ADJUSTMENT_GAPS = [
  'Climate adjustment shifts monthly averages only, not changes in extremes or day-to-day variability.',
  'The climate-adjusted weather pool cannot be backtested (the backtest uses raw NASA POWER).',
  'NEX-GDDP-CMIP6 is on a ~0.25 degree grid, so local climate trends are smoothed.',
  'NEX-GDDP-CMIP6 is bias-adjusted to GMFD, not NASA POWER; only its trends are used, to limit the mismatch.',
  'Each model trend comes from one simulation run; 3-month windows and the 5-model mean reduce, but do not remove, that noise.',
];

/**
 * The weather pool(s) for planning: raw NASA POWER ('none') or shifted toward
 * the target season ('present'), as a mean pool plus one pool per model.
 */
export function buildWeather(farm: Farm, daily: DailyWeather, o: BuildWeatherOptions = {}): BuiltWeather {
  const gaps: string[] = [];
  const lastYear = Number(daily.dates[daily.dates.length - 1]!.slice(0, 4));
  let targetYear = o.targetYear;
  if (targetYear === undefined) {
    targetYear = lastYear + 1;
    gaps.push(`No planning season was given; the weather was adjusted to ${targetYear} (last weather year + 1).`);
  }
  const mode = o.weatherAdjustment ?? (o.trends ? 'present' : 'none');
  if (mode === 'none' || !o.trends) {
    if (mode === 'present' && !o.trends) gaps.push('No NEX-GDDP-CMIP6 trends for this location: weather is raw NASA POWER, not adjusted to today\'s climate.');
    const raw = scenariosFromDailyWeather(farm, daily, o.climate);
    return { weather: raw.scenarios, gaps: [...gaps, ...raw.gaps], targetYear };
  }
  const file = o.trends;
  const mean = meanTrends(file);
  const meanBuilt = scenariosFromDailyWeather(farm, adjustDailyWeather(daily, mean, targetYear), o.climate);
  const tag = (pool: WeatherScenario[], label: string) =>
    pool.map((s) => ({ ...s, label: `${s.label} adjusted to ${targetYear} (${label})`, sources: [...(s.sources ?? []), 'nexGddpCmip6'] }));
  const members = file.models.map((m) => ({
    model: m.model,
    pool: tag(scenariosFromDailyWeather(farm, adjustDailyWeather(daily, m.trends, targetYear), o.climate).scenarios, m.model),
  }));
  const meanPool = tag(meanBuilt.scenarios, '5-model mean');
  const years = meanPool.map((s) => Number(s.label!.slice(0, 4)));
  const oldestYear = years.length ? Math.min(...years) : lastYear;
  const shifts = shiftTable(mean, oldestYear, targetYear);
  const julyTmax = shifts.find((r) => r.variable === 'tasmax' && r.month === 6)!;
  const adjustment: WeatherAdjustmentMeta = {
    method: 'present',
    targetYear,
    oldestYear,
    models: file.models.map((m) => m.model),
    gridCell: file.gridCell,
    shifts,
    summary:
      `Weather adjusted to today's climate using NASA NEX-GDDP-CMIP6 (${file.models.length} models); older years shifted more. ` +
      `${oldestYear} replayed ~${((julyTmax.shift * 9) / 5).toFixed(1)} F ${julyTmax.shift >= 0 ? 'warmer' : 'cooler'} in ${MONTHS[6]} (daily highs).`,
  };
  return {
    weather: { mean: meanPool, members, adjustment },
    gaps: [...gaps, ...meanBuilt.gaps, ...ADJUSTMENT_GAPS],
    targetYear,
  };
}
