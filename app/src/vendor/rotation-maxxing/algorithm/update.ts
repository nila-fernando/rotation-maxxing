/**
 * The dynamic planner: plan -> season happens -> farmer reports -> learn -> re-plan.
 *
 *   let state = createFarmState(farm, weatherPool, 2026);
 *   const plans = replan(state, priorities, market);          // 3 plans for 2026-2028
 *   state = adoptPlan(state, plans.plans.priority.plan);      // the farmer picks one
 *   ... the 2026 season happens ...
 *   const { state: next } = updateAfterSeason(state, report2026, { weather: observed2026 });
 *   const replanned = replan(next, priorities, market);       // 2027-2029, close to the adopted plan
 *
 * What updateAfterSeason learns:
 *  - history: each paddock's reported crop becomes its newest history year
 *  - yield calibration: reported vs model yield (with that season's ACTUAL
 *    weather and neighbours), combined with earlier seasons by shrinkage, so
 *    one odd year can't swing the plan
 *  - weather: the observed season joins the weather pool
 *  - land: optional updates (e.g. re-pulled soil data, a new slope survey)
 *
 * Everything here is pure: state in, new state out.
 */
import { CALIBRATION_EXCLUDED_EVENTS, CALIBRATION_OBS_SD, CALIBRATION_PRIOR_SD } from './constants';
import { generatePlans, type GenerateOptions } from './api';
import { CROP_BY_ID } from './croptraits';
import { prepareFarm } from './geometry';
import { meanScenario, TraitYieldModel, type YieldModel } from './yieldModel';
import { buildWeather, type ClimateTrendsFile } from './climateAdjust';
import { isEnsemble } from './types';
import type {
  CalibrationRecord,
  CropCalibration,
  CropId,
  CropTable,
  Farm,
  GenerateResult,
  Land,
  Market,
  Paddock,
  PaddockId,
  Plan,
  Priorities,
  WeatherScenario,
  WeatherInput,
  DailyWeather,
} from './types';

export interface FarmState {
  farm: Farm;
  /** Calendar year of the next season to plan. */
  nextSeason: number;
  /** Weather years used for expected values and Monte Carlo. Observed seasons are appended. */
  /** Weather years used for expected values and Monte Carlo (raw pool, or a present-climate ensemble). */
  weatherPool: WeatherInput;
  /**
   * Optional: the daily weather and climate trends the pool was built from. When
   * present, replan() rebuilds the pool adjusted to `nextSeason`, so the
   * adjustment target always follows the season being planned.
   */
  weatherSource?: WeatherSource;
  /** The plan the farmer adopted, and the season its first year is for. */
  adoptedPlan?: { firstSeason: number; plan: Plan };
  /** One entry per season reported, newest last. */
  log: SeasonLogEntry[];
}

export type SeasonEvent = 'hail' | 'flood' | 'drought' | 'pest' | 'disease' | 'replant' | 'other';

export interface PaddockReport {
  paddockId: PaddockId;
  /** The main crop actually grown. */
  cropId: CropId;
  /** Harvested yield per acre in the crop's unit (bu, lb, ton). Leave out if unknown. */
  yieldPerAcre?: number | null;
  events?: SeasonEvent[];
  notes?: string;
}

export interface SeasonReport {
  season: number;
  paddocks: PaddockReport[];
}

export interface WeatherSource {
  daily: DailyWeather;
  trends?: ClimateTrendsFile;
  weatherAdjustment: 'none' | 'present';
}

export interface SeasonObservations {
  /** That season's weather year, e.g. NASA POWER through scenariosFromDailyWeather(). */
  weather?: WeatherScenario;
  /** That season's DAILY weather (NASA POWER), appended to the weather source when the state has one. */
  daily?: DailyWeather;
  /** Field data that changed (e.g. re-pulled SSURGO, a new slope survey). */
  land?: Record<PaddockId, Partial<Land>>;
}

export interface SeasonLogEntry {
  season: number;
  report: SeasonReport;
  /** Per paddock: model prediction for what was grown, and the calibration after this season. */
  calibration: { paddockId: PaddockId; cropId: CropId; predicted: number | null; reported: number | null; factorAfter: number | null; used: boolean }[];
  notes: string[];
}

export interface UpdateOptions {
  crops?: CropTable;
  /** The UNcalibrated model used to predict last season (default TraitYieldModel). */
  yieldModel?: YieldModel;
}

export function createFarmState(farm: Farm, weatherPool: WeatherInput, nextSeason: number, weatherSource?: WeatherSource): FarmState {
  return { farm, nextSeason, weatherPool, log: [], ...(weatherSource ? { weatherSource } : {}) };
}

/** The mean (deterministic) pool of a raw pool or an ensemble. */
function meanPool(w: WeatherInput): WeatherScenario[] {
  return isEnsemble(w) ? w.mean : w;
}

/** Append days to a daily record, skipping dates it already has. */
function appendDaily(a: DailyWeather, b: DailyWeather): DailyWeather {
  const seen = new Set(a.dates);
  const keep = b.dates.map((d, i) => (seen.has(d) ? -1 : i)).filter((i) => i >= 0);
  const pick = (xs: number[], ys: number[]) => [...xs, ...keep.map((i) => ys[i]!)];
  return {
    ...a,
    dates: [...a.dates, ...keep.map((i) => b.dates[i]!)],
    tmaxC: pick(a.tmaxC, b.tmaxC),
    tminC: pick(a.tminC, b.tminC),
    rainMm: pick(a.rainMm, b.rainMm),
    solarMJ: pick(a.solarMJ, b.solarMJ),
    rhPct: pick(a.rhPct, b.rhPct),
    wind2m: pick(a.wind2m, b.wind2m),
  };
}

/** Record the plan the farmer chose, so the next re-plan stays close to it. */
export function adoptPlan(state: FarmState, plan: Plan): FarmState {
  return { ...state, adoptedPlan: { firstSeason: state.nextSeason, plan } };
}

/**
 * Shrinkage update of a field's yield factor (conjugate normal on log scale):
 *   prior   log f ~ N(0, PRIOR_SD^2)
 *   seasons log(reported / predicted) ~ N(log f, OBS_SD^2)
 */
export function calibrate(records: CalibrationRecord[]): CropCalibration {
  const used = records.filter((r) => r.used && r.reported > 0 && r.predicted > 0);
  const priorPrec = 1 / CALIBRATION_PRIOR_SD ** 2;
  const obsPrec = 1 / CALIBRATION_OBS_SD ** 2;
  const prec = priorPrec + used.length * obsPrec;
  const logMean = (used.reduce((a, r) => a + Math.log(r.reported / r.predicted), 0) * obsPrec) / prec;
  return { factor: Math.exp(logMean), logMean, logSd: 1 / Math.sqrt(prec), seasons: used.length, records };
}

/** Fold one season's report into the farm state. Returns the new state and plain-English notes. */
export function updateAfterSeason(
  state: FarmState,
  report: SeasonReport,
  observations: SeasonObservations = {},
  options: UpdateOptions = {},
): { state: FarmState; notes: string[] } {
  if (report.season !== state.nextSeason) {
    throw new Error(`Report is for ${report.season} but the plan expects ${state.nextSeason}. Report seasons in order.`);
  }
  const crops = options.crops ?? CROP_BY_ID;
  const model = options.yieldModel ?? new TraitYieldModel();
  const prepared = prepareFarm(state.farm);
  const byId = new Map(report.paddocks.map((r) => [r.paddockId, r]));
  const weather = observations.weather ?? meanScenario(meanPool(state.weatherPool));
  const notes: string[] = [];
  if (!observations.weather) notes.push(`No observed weather for ${report.season}; predictions used the average year, so calibration is less reliable.`);

  const calLog: SeasonLogEntry['calibration'] = [];
  const paddocks: Paddock[] = state.farm.paddocks.map((p) => {
    const r = byId.get(p.id);
    if (!r) {
      notes.push(`${p.name}: no report for ${report.season}; history not updated.`);
      return p;
    }
    if (!crops[r.cropId]) throw new Error(`Unknown crop "${r.cropId}" reported for ${p.name}.`);

    // Predict what the model expected for what was ACTUALLY grown, with the season's real weather and neighbours.
    const est = model.yieldFor(p, [r.cropId], 0, weather, {
      prepared,
      crops,
      neighbourCrop: (id) => byId.get(id)?.cropId ?? null,
      explain: false,
    });
    const predicted = est.value;
    const reported = r.yieldPerAcre ?? null;
    const oneOff = (r.events ?? []).filter((e) => CALIBRATION_EXCLUDED_EVENTS.includes(e));

    let yieldCalibration = p.yieldCalibration;
    let factorAfter: number | null = p.yieldCalibration?.[r.cropId]?.factor ?? null;
    let used = false;
    if (reported !== null && predicted !== null && predicted > 0 && reported > 0) {
      used = oneOff.length === 0;
      const prev = p.yieldCalibration?.[r.cropId]?.records ?? [];
      const rec: CalibrationRecord = {
        season: report.season,
        reported,
        predicted,
        used,
        ...(oneOff.length ? { note: `Not used: ${oneOff.join(', ')} reported` } : {}),
      };
      const cal = calibrate([...prev, rec]);
      yieldCalibration = { ...(p.yieldCalibration ?? {}), [r.cropId]: cal };
      factorAfter = cal.factor;
      const name = crops[r.cropId]!.name;
      const diff = (reported / predicted - 1) * 100;
      notes.push(
        used
          ? `${p.name}: ${name} yielded ${round(reported)} vs ${round(predicted)} predicted (${sign(diff)}%). ` +
              `Field factor now ${sign((cal.factor - 1) * 100)}% from ${cal.seasons} season(s).`
          : `${p.name}: ${name} yield recorded but not used to calibrate (${oneOff.join(', ')}).`,
      );
    } else if (reported === null) {
      notes.push(`${p.name}: no yield reported; history updated, calibration unchanged.`);
    }
    calLog.push({ paddockId: p.id, cropId: r.cropId, predicted, reported, factorAfter, used });

    const land = observations.land?.[p.id];
    return {
      ...p,
      history: [...p.history, r.cropId].slice(-3),
      ...(yieldCalibration ? { yieldCalibration } : {}),
      ...(land ? { land: { ...p.land, ...land } } : {}),
    };
  });

  const observed = observations.weather
    ? { ...observations.weather, label: observations.weather.label ?? `${report.season} (observed)` }
    : null;
  const pool = state.weatherPool;
  // The observed season is (nearly) today's climate: it joins every pool unshifted.
  const weatherPool: WeatherInput = !observed
    ? pool
    : isEnsemble(pool)
      ? { ...pool, mean: [...pool.mean, observed], members: pool.members.map((m) => ({ ...m, pool: [...m.pool, observed] })) }
      : [...pool, observed];
  const weatherSource =
    state.weatherSource && observations.daily
      ? { ...state.weatherSource, daily: appendDaily(state.weatherSource.daily, observations.daily) }
      : state.weatherSource;

  return {
    state: {
      ...state,
      farm: { ...state.farm, paddocks },
      nextSeason: report.season + 1,
      weatherPool,
      ...(weatherSource ? { weatherSource } : {}),
      log: [...state.log, { season: report.season, report, calibration: calLog, notes }],
    },
    notes,
  };
}

/** The adopted plan, shifted so its year 0 is `state.nextSeason` (null where it doesn't reach). */
export function alignedPreviousPlan(state: FarmState, horizon: number): Record<PaddockId, (CropId | null)[]> | undefined {
  const a = state.adoptedPlan;
  if (!a) return undefined;
  const offset = state.nextSeason - a.firstSeason;
  const out: Record<PaddockId, (CropId | null)[]> = {};
  for (const [id, slots] of Object.entries(a.plan.sequences)) {
    out[id] = Array.from({ length: horizon }, (_, y) => slots[offset + y]?.main ?? null);
  }
  return out;
}

/**
 * Plan the next seasons from the current state: updated history, field
 * calibration and weather pool, staying close to the adopted plan unless a
 * change is worth its switching cost.
 */
export function replan(
  state: FarmState,
  priorities: Priorities,
  market: Market,
  options: GenerateOptions = {},
): GenerateResult {
  const previousPlan = options.previousPlan ?? alignedPreviousPlan(state, 3);
  // With a weather source, rebuild the pool adjusted to the season being planned.
  const src = state.weatherSource;
  const weather = src
    ? buildWeather(state.farm, src.daily, {
        ...(src.trends ? { trends: src.trends } : {}),
        targetYear: state.nextSeason,
        weatherAdjustment: src.weatherAdjustment,
      }).weather
    : state.weatherPool;
  return generatePlans(state.farm, priorities, market, weather, {
    ...options,
    ...(previousPlan ? { previousPlan } : {}),
  });
}

function round(x: number): string {
  return x >= 100 ? x.toFixed(0) : x.toFixed(1);
}
function sign(x: number): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(0)}`;
}
