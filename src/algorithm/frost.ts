/**
 * Spring freeze injury to winter wheat.
 *
 *   growing degrees (F) = max(0, (Tmax + Tmin)/2 - 32), summed from 1 January
 *                                                  (Kansas Mesonet formula; start date: assumption)
 *   stage               = WHEAT_GDD_STAGES band (design mapping of the Mesonet legend)
 *   freeze event        = a day with NASA POWER Tmin <= the C646 injurious temperature for that stage
 *   season damage       = the worst event's C646 yield effect -> FREEZE_DAMAGE_FACTORS range
 *                         (unsourced design values: midpoint in the search, sampled in Monte Carlo)
 *
 * Limits (also in DATA_GAPS): daily minimum air temperature of a ~50 km grid
 * cell, not canopy temperature in low spots; C646 thresholds are for two hours
 * of exposure, which daily data can't resolve; snow cover isn't modelled.
 */
import {
  FREEZE_DAMAGE_FACTORS,
  WHEAT_FREEZE_INJURY,
  WHEAT_GDD_STAGES,
  type FreezeYieldEffect,
  type WheatStage,
} from './croptraits';
import type { DailyWeather } from './types';

export interface FreezeEvent {
  /** YYYY-MM-DD */
  date: string;
  stage: WheatStage;
  tminF: number;
  thresholdF: number;
  /** Growing degrees (F) accumulated before that day. */
  gddF: number;
  effect: FreezeYieldEffect;
}

const SEVERITY: Record<FreezeYieldEffect, number> = { 'slight to moderate': 1, 'moderate to severe': 2, severe: 3 };
const toF = (c: number) => (c * 9) / 5 + 32;

export function wheatStageAt(gddF: number): WheatStage | 'mature' {
  for (const b of WHEAT_GDD_STAGES) if (gddF < b.belowF) return b.stage;
  return 'mature';
}

/**
 * Freeze events for the winter wheat crop harvested in `harvestYear`.
 * Returns null if the weather record doesn't cover 1 January - 31 July of that year.
 */
export function springFreeze(w: DailyWeather, harvestYear: number): { events: FreezeEvent[]; worst: FreezeEvent | null } | null {
  const start = w.dates.indexOf(`${harvestYear}-01-01`);
  const end = w.dates.indexOf(`${harvestYear}-07-31`);
  if (start < 0 || end < 0) return null;
  let gdd = 0;
  const events: FreezeEvent[] = [];
  for (let i = start; i <= end; i++) {
    const stage = wheatStageAt(gdd);
    if (stage === 'mature') break;
    const tminF = toF(w.tminC[i]!);
    const t = WHEAT_FREEZE_INJURY[stage];
    if (tminF <= t.injuriousF) {
      events.push({ date: w.dates[i]!, stage, tminF, thresholdF: t.injuriousF, gddF: gdd, effect: t.yieldEffect });
    }
    gdd += Math.max(0, (toF(w.tmaxC[i]!) + tminF) / 2 - 32);
  }
  let worst: FreezeEvent | null = null;
  for (const e of events) {
    if (
      !worst ||
      SEVERITY[e.effect] > SEVERITY[worst.effect] ||
      (SEVERITY[e.effect] === SEVERITY[worst.effect] && e.tminF - e.thresholdF < worst.tminF - worst.thresholdF)
    ) {
      worst = e;
    }
  }
  return { events, worst };
}

/** Yield factor for a C646 yield effect: the midpoint, or a Monte Carlo draw u in [0, 1). */
export function freezeFactor(effect: FreezeYieldEffect, u?: number): number {
  const r = FREEZE_DAMAGE_FACTORS[effect];
  return u === undefined ? (r.low + r.high) / 2 : r.low + u * (r.high - r.low);
}

export const FREEZE_GAP =
  'Freeze injury uses NASA POWER daily minimum air temperature for a ~50 km grid cell (low spots and the canopy get colder) and C646 thresholds for two hours of exposure, which daily data cannot resolve; damage sizes are unsourced design ranges.';
