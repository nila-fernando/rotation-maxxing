/**
 * The objective: how the farmer's priorities turn criteria into one score.
 *
 *   weights   w_c = slider_c / (profit + soilHealth + water)   (equal if all 0)
 *   lambda    = risk / 100 x LAMBDA_MAX                        (risk does nothing else)
 *   profit    = expected GM - lambda x (expected GM - P10 GM) + end-of-horizon N value
 *   norm_c    = (value - worst_c) / (best_c - worst_c)          (fixed per-farm bounds)
 *   objective = sum_c w_c x norm_c - variety penalty
 *
 * Bounds are computed ONCE per farm from the per-paddock enumeration (sum of
 * each paddock's best and worst), not from the handful of candidate plans,
 * so adding or removing a candidate can't flip the winner.
 */
import { LAMBDA_MAX, VARIETY_MAX_FAMILY_SHARE, VARIETY_PENALTY_WEIGHT } from './constants';
import type { Priorities, ReferenceBounds, Term } from './types';

export interface CriteriaWeights {
  profit: number;
  soilHealth: number;
  water: number;
}

export function criteriaWeights(p: Priorities): CriteriaWeights {
  const clamp = (x: number) => Math.min(100, Math.max(0, x));
  const a = clamp(p.profit);
  const b = clamp(p.soilHealth);
  const c = clamp(p.water);
  const sum = a + b + c;
  if (sum === 0) return { profit: 1 / 3, soilHealth: 1 / 3, water: 1 / 3 };
  return { profit: a / sum, soilHealth: b / sum, water: c / sum };
}

export function riskLambda(p: Priorities): number {
  return (Math.min(100, Math.max(0, p.risk)) / 100) * LAMBDA_MAX;
}

/** expected - lambda x (expected - P10). */
export function riskAdjusted(expected: number, p10: number, lambda: number): number {
  return expected - lambda * (expected - p10);
}

/** Map a criterion onto 0 (worst bound) .. 1 (best bound). Works for "lower is better" too. */
export function normalise(bounds: { worst: number; best: number }, value: number): number {
  const range = bounds.best - bounds.worst;
  if (Math.abs(range) < 1e-12) return 0;
  return (value - bounds.worst) / range;
}

/**
 * Excess family share of the CROPPED area, averaged over years: sum over crop
 * families of max(0, share - VARIETY_MAX_FAMILY_SHARE). Fallow is not a crop
 * family and not in the denominator: leaving land empty removes revenue, it
 * doesn't diversify it.
 * @param familyAcres per year, acres per family (a 'fallow' entry is ignored)
 */
export function varietyExcess(familyAcres: Map<string, number>[]): number {
  if (familyAcres.length === 0) return 0;
  let sum = 0;
  for (const year of familyAcres) {
    let cropped = 0;
    for (const [fam, acres] of year) if (fam !== 'fallow') cropped += acres;
    if (cropped <= 0) continue;
    for (const [fam, acres] of year) if (fam !== 'fallow') sum += Math.max(0, acres / cropped - VARIETY_MAX_FAMILY_SHARE);
  }
  return sum / familyAcres.length;
}

export interface CriteriaValues {
  /** $: risk-adjusted (or expected) GM plus end-of-horizon value. */
  profit: number;
  /** Acre-weighted soil score 0-1. */
  soilHealth: number;
  /** Acre-weighted water-use index (lower is better). */
  water: number;
  /** From varietyExcess(). */
  varietyExcess: number;
  /** Share of last season's planned paddock-years (acre-weighted) this plan changes (re-planning only). */
  switchShare?: number;
}

export interface ObjectiveScore {
  value: number;
  terms: Term[];
}

export function scoreObjective(
  v: CriteriaValues,
  bounds: ReferenceBounds,
  w: CriteriaWeights,
  lambda: number,
  explain = false,
  switchWeight = 0,
): ObjectiveScore {
  const nP = normalise(bounds.profit, v.profit);
  const nS = normalise(bounds.soilHealth, v.soilHealth);
  const nW = normalise(bounds.water, v.water);
  const variety = VARIETY_PENALTY_WEIGHT * lambda * v.varietyExcess;
  const switching = switchWeight * (v.switchShare ?? 0);
  const value = w.profit * nP + w.soilHealth * nS + w.water * nW - variety - switching;
  if (!explain) return { value, terms: [] };
  const t = (label: string, x: number, basis: Term['basis'] = 'design'): Term => ({ label, value: x, unit: 'score', basis });
  return {
    value,
    terms: [
      t(`Profit (risk-adjusted, lambda ${lambda.toFixed(2)}): ${(nP * 100).toFixed(0)}% of the way from worst to best, weight ${pct(w.profit)}`, w.profit * nP),
      t(`Soil health: ${(nS * 100).toFixed(0)}% of the way from worst to best, weight ${pct(w.soilHealth)}`, w.soilHealth * nS),
      t(`Water: ${(nW * 100).toFixed(0)}% of the way from worst to best, weight ${pct(w.water)}`, w.water * nW),
      ...(variety > 0 ? [t(`Crop-variety penalty (over ${pct(VARIETY_MAX_FAMILY_SHARE)} of the farm in one family)`, -variety)] : []),
      ...(switching > 0 ? [t(`Switching cost: changes ${pct(v.switchShare ?? 0)} of last season's plan`, -switching)] : []),
    ],
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
