/**
 * Public API: generatePlans and evaluatePlan. checkPlacement lives in placement.ts.
 */
import {
  CANDIDATE_WEIGHT_SHIFT,
  MC_SAMPLES,
  MC_TOP_K,
  RANK_JITTER,
  RANK_JITTER_SAMPLES,
  SHADE_WARNING_FRACTIONS,
} from './constants';
import { createContext, explainPlan, sequenceStatics, type ExplainedPlan, type ModelContext, type ModelOptions, type SequenceStatics } from './farmModel';
import { screenCrops, sequenceViolation, UNSOURCED_LAND_CHECKS } from './filters';
import { drawSamples, probBeats, simulate, summarise, type Draws, type McSummary } from './montecarlo';
import {
  criteriaWeights,
  riskAdjusted,
  riskLambda,
  scoreObjective,
  varietyExcess,
  type CriteriaWeights,
} from './objective';
import { checkPlacement } from './placement';
import { continueHistory, planFromSequences, sequencesFromPlan } from './plans';
import { createRng, type Rng } from './rng';
import { buildSpaces, createSearcher } from './search';
import type {
  CropId,
  Exclusion,
  Farm,
  GenerateResult,
  Market,
  PaddockId,
  Plan,
  PlanResult,
  PreparedFarm,
  PriceOfPriorities,
  Priorities,
  ReferenceBounds,
  Term,
  WeatherScenario,
} from './types';

export interface GenerateOptions extends ModelOptions {
  /** Seed for every random draw. Same seed + same inputs = same result. Default 1. */
  seed?: number;
  /** Monte Carlo samples. Default MC_SAMPLES (200). */
  mcSamples?: number;
  /** Candidate plans (beyond max-profit and current) that get Monte Carlo. Default MC_TOP_K (4). */
  mcTopK?: number;
  /** Coordinate-descent iteration cap. Default MAX_DESCENT_ITERATIONS. */
  maxIterations?: number;
  /** Priority jitters used for rank stability. Default RANK_JITTER_SAMPLES. */
  rankJitterSamples?: number;
}

// ---------------------------------------------------------------------------
// Candidate bookkeeping
// ---------------------------------------------------------------------------

interface Candidate {
  key: string;
  seqs: CropId[][];
  statics: SequenceStatics[];
  feasible: boolean;
  soil: number;
  endSoil: number;
  water: number;
  endValue: number;
  /** Costs and N credits: fixed across weather and price draws, $. */
  fixedMoney: number;
  varietyExcess: number;
  mc?: McSummary;
}

function makeCandidate(ctx: ModelContext, seqs: CropId[][], statics: SequenceStatics[], feasible: boolean): Candidate {
  let soil = 0, endSoil = 0, water = 0, endValue = 0, fixedMoney = 0;
  const fam: Map<string, number>[] = Array.from({ length: ctx.horizon }, () => new Map());
  statics.forEach((s, p) => {
    const acres = ctx.paddocks[p]!.acres;
    const share = acres / ctx.totalAcres;
    soil += share * s.soil;
    endSoil += share * s.endSoil;
    water += share * s.water;
    endValue += s.endValue;
    fixedMoney += s.nCredit - s.cost;
    s.families.forEach((f, y) => fam[y]!.set(f, (fam[y]!.get(f) ?? 0) + acres));
  });
  return {
    key: seqs.map((s) => s.join('>')).join('|'),
    seqs,
    statics,
    feasible,
    soil,
    endSoil,
    water,
    endValue,
    fixedMoney,
    varietyExcess: varietyExcess(fam, ctx.totalAcres),
  };
}

function objectiveOf(c: Candidate, bounds: ReferenceBounds, w: CriteriaWeights, lambda: number, explain = false) {
  const mc = c.mc!;
  return scoreObjective(
    {
      profit: riskAdjusted(mc.expected, mc.p10, lambda) + c.endValue,
      soilHealth: c.soil,
      water: c.water,
      varietyExcess: c.varietyExcess,
    },
    bounds,
    w,
    lambda,
    explain,
  );
}

function argmax<T>(items: T[], f: (t: T) => number): number {
  let best = 0;
  let bestVal = -Infinity;
  items.forEach((t, i) => {
    const v = f(t);
    if (v > bestVal + 1e-9) {
      bestVal = v;
      best = i;
    }
  });
  return best;
}

function shifted(p: Priorities, key: 'profit' | 'soilHealth' | 'water'): Priorities {
  return { ...p, [key]: Math.min(100, p[key] + CANDIDATE_WEIGHT_SHIFT) };
}

/** Share of jittered priority vectors (each slider +/- RANK_JITTER) where each candidate ranks first. */
function rankStability(pool: Candidate[], bounds: ReferenceBounds, priorities: Priorities, n: number, rng: Rng): number[] {
  const wins = new Array<number>(pool.length).fill(0);
  const jit = (x: number) => Math.min(100, Math.max(0, x + (rng.next() * 2 - 1) * RANK_JITTER));
  for (let j = 0; j < n; j++) {
    const p: Priorities = {
      profit: jit(priorities.profit),
      soilHealth: jit(priorities.soilHealth),
      water: jit(priorities.water),
      risk: jit(priorities.risk),
    };
    const w = criteriaWeights(p);
    const l = riskLambda(p);
    wins[argmax(pool, (c) => objectiveOf(c, bounds, w, l).value)]!++;
  }
  return wins.map((x) => x / (n || 1));
}

// ---------------------------------------------------------------------------
// Result building
// ---------------------------------------------------------------------------

function money(x: number): string {
  const s = Math.round(Math.abs(x)).toLocaleString('en-US');
  return `${x < 0 ? '-' : ''}$${s}`;
}

function buildResult(
  ctx: ModelContext,
  kind: PlanResult['kind'],
  c: Candidate,
  explained: ExplainedPlan,
  extra: {
    bounds: ReferenceBounds;
    w: CriteriaWeights;
    lambda: number;
    baseline: Candidate | null;
    rankStability: number | null;
    reasons: string[];
    gaps: string[];
  },
): PlanResult {
  const mc = c.mc!;
  const obj = objectiveOf(c, extra.bounds, extra.w, extra.lambda, true);
  const risks = [...explained.risks];
  for (const m of explained.marketExcess) {
    const crop = ctx.crops[m.cropId]!;
    const excess = 1 - m.localDemand / m.production;
    risks.push(
      `Year ${m.year + 1}: the farm grows more ${crop.name.toLowerCase()} than local buyers take; ` +
        `${Math.round(excess * 100)}% goes to the distant market at a lower net price.`,
    );
  }
  for (const s of explained.shade) {
    if (s.fraction >= SHADE_WARNING_FRACTIONS[0]) {
      const name = ctx.paddocks[ctx.paddockIndex.get(s.paddockId)!]!.name;
      risks.push(`${name}, year ${s.year + 1}: ${(s.fraction * 100).toFixed(1)}% of the paddock is in noon shade from a taller crop to the south.`);
    }
  }
  if (mc.p10 < 0) risks.push(`In a bad run of years (P10) this plan loses ${money(-mc.p10)} over ${ctx.horizon} years.`);

  const reasons = [...extra.reasons];
  for (const pr of explained.paddocks) {
    for (const yr of pr.years) {
      const credit = yr.terms.find((t) => t.label.startsWith('N credit from'));
      if (credit) reasons.push(`${pr.name}, year ${yr.year + 1}: ${credit.label} saves ${money(credit.value)}/ac of fertiliser.`);
    }
  }

  return {
    kind,
    plan: planFromSequences(ctx.paddocks.map((p) => p.id), c.seqs),
    paddocks: explained.paddocks,
    expectedGM: mc.expected,
    p10GM: mc.p10,
    probBeatsCurrent: extra.baseline && extra.baseline !== c ? probBeats(mc.totals, extra.baseline.mc!.totals) : null,
    endOfHorizonValue: c.endValue,
    riskAdjustedProfit: riskAdjusted(mc.expected, mc.p10, extra.lambda) + c.endValue,
    soilHealth: c.soil,
    endSoilHealth: c.endSoil,
    waterUse: c.water,
    objective: obj.value,
    objectiveTerms: obj.terms,
    rankStability: extra.rankStability,
    reasons,
    risks: [...new Set(risks)],
    informationGaps: [...new Set([...explained.gaps, ...extra.gaps])],
  };
}

function currentCandidate(ctx: ModelContext, allowedByPaddock: Set<CropId>[]): { cand: Candidate; gaps: string[] } {
  const gaps: string[] = [];
  const seqs = ctx.paddocks.map((p) => {
    const r = continueHistory(p, ctx.horizon);
    if (r.gap) gaps.push(r.gap);
    return r.seq;
  });
  const statics = ctx.paddocks.map((p, i) => sequenceStatics(ctx, p, seqs[i]!));
  const feasible = ctx.paddocks.every(
    (p, i) => seqs[i]!.every((c) => allowedByPaddock[i]!.has(c)) && !sequenceViolation(ctx.crops, p, seqs[i]!),
  );
  return { cand: makeCandidate(ctx, seqs, statics, feasible), gaps };
}

// ---------------------------------------------------------------------------
// generatePlans
// ---------------------------------------------------------------------------

/**
 * Three plans: the current rotation continued, the max-profit plan (highest
 * expected gross margin + N left behind, lambda = 0) and the plan that best
 * fits the farmer's priorities. Plus the "price of your priorities".
 */
export function generatePlans(
  farm: Farm | PreparedFarm,
  priorities: Priorities,
  market: Market,
  scenarios: WeatherScenario[],
  options: GenerateOptions = {},
): GenerateResult {
  const ctx = createContext(farm, market, scenarios, options);
  const rng = createRng(options.seed ?? 1);
  const w = criteriaWeights(priorities);
  const lambda = riskLambda(priorities);

  // Stage 1: hard filters.
  const screens = ctx.paddocks.map((p) => screenCrops(ctx.crops, p, true));
  const exclusions: Record<PaddockId, Exclusion[]> = {};
  ctx.paddocks.forEach((p, i) => (exclusions[p.id] = screens[i]!.exclusions));
  const allowed = screens.map((s) => s.allowed);
  const allowedSets = allowed.map((a) => new Set(a));

  // Stage 5: enumeration, fixed bounds, coordinate descent under a few weight vectors.
  const spaces = buildSpaces(ctx, allowed);
  const searcher = createSearcher(ctx, spaces);
  const bounds = searcher.bounds;
  const profitOnly: CriteriaWeights = { profit: 1, soilHealth: 0, water: 0 };
  const runs: { w: CriteriaWeights; lambda: number }[] = [
    { w: profitOnly, lambda: 0 },
    { w, lambda },
    { w: criteriaWeights(shifted(priorities, 'soilHealth')), lambda },
    { w: criteriaWeights(shifted(priorities, 'water')), lambda },
    { w: criteriaWeights(shifted(priorities, 'profit')), lambda },
  ];
  const found = new Map<string, Candidate>();
  let iterations = 0;
  for (const r of runs) {
    const res = searcher.descend(searcher.standaloneStart(r.w), r.w, r.lambda, options.maxIterations);
    iterations += res.iterations;
    const seqs = searcher.sequences(res.choice);
    const statics = res.choice.map((o, p) => spaces[p]!.options[o]!);
    const c = makeCandidate(ctx, seqs, statics, true);
    if (!found.has(c.key)) found.set(c.key, c);
  }
  const all = [...found.values()];
  const maxProfitSearch = all[0]!; // first run is profit-only

  // Keep the top K by deterministic farmer objective, plus the max-profit candidate.
  const detScore = (c: Candidate) => {
    const choice = c.seqs.map((s, p) => spaces[p]!.options.findIndex((o) => o.key === s.join('>')));
    const crit = searcher.criteria(choice);
    return scoreObjective(crit, bounds, w, lambda).value;
  };
  const ranked = all
    .map((c) => ({ c, s: detScore(c) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
  const topK = options.mcTopK ?? MC_TOP_K;
  const pool: Candidate[] = [maxProfitSearch, ...ranked.filter((c) => c !== maxProfitSearch).slice(0, topK)];

  // Current rotation continued (the baseline).
  const { cand: current, gaps: currentGaps } = currentCandidate(ctx, allowedSets);
  const currentInPool = pool.find((c) => c.key === current.key);
  if (!currentInPool && current.feasible) pool.push(current);

  // Stage 6: Monte Carlo with common random numbers.
  const draws: Draws = drawSamples(ctx, options.mcSamples ?? MC_SAMPLES, rng);
  const simulateInto = (c: Candidate) => {
    c.mc ??= summarise(simulate(ctx, c.seqs, c.fixedMoney, draws));
  };
  pool.forEach(simulateInto);
  const baseline = currentInPool ?? current;
  simulateInto(baseline);

  // Selection.
  const maxProfit = pool[argmax(pool, (c) => c.mc!.expected + c.endValue)]!;
  const priority = pool[argmax(pool, (c) => objectiveOf(c, bounds, w, lambda).value)]!;
  const stability = rankStability(pool, bounds, priorities, options.rankJitterSamples ?? RANK_JITTER_SAMPLES, rng);
  const stabilityOf = (c: Candidate) => {
    const i = pool.indexOf(c);
    return i >= 0 ? stability[i]! : 0;
  };

  const commonGaps = [UNSOURCED_LAND_CHECKS, ...draws.gaps];
  const extraBase = { bounds, w, lambda, baseline, gaps: commonGaps };
  const wPct = `profit ${Math.round(w.profit * 100)}%, soil health ${Math.round(w.soilHealth * 100)}%, water ${Math.round(w.water * 100)}%`;

  const currentResult = buildResult(ctx, 'current', baseline, explainPlan(ctx, baseline.seqs), {
    ...extraBase,
    gaps: [...commonGaps, ...currentGaps],
    rankStability: stabilityOf(baseline),
    reasons: ['Your current rotation, continued: the repeating pattern of the last 3 years on each paddock.'],
  });
  const maxProfitResult = buildResult(ctx, 'maxProfit', maxProfit, explainPlan(ctx, maxProfit.seqs), {
    ...extraBase,
    rankStability: stabilityOf(maxProfit),
    reasons: [
      `Highest expected gross margin of the plans checked: ${money(maxProfit.mc!.expected)} over ${ctx.horizon} years, ` +
        `plus ${money(maxProfit.endValue)} of nitrogen left for next year. Bad-year (P10) margin: ${money(maxProfit.mc!.p10)}.`,
    ],
  });
  const priorityResult = buildResult(ctx, 'priority', priority, explainPlan(ctx, priority.seqs), {
    ...extraBase,
    rankStability: stabilityOf(priority),
    reasons: [
      priority === maxProfit
        ? `With your priorities (${wPct}; risk lambda ${lambda.toFixed(2)}), the max-profit plan also scores best.`
        : `Best match for your priorities: ${wPct}; risk lambda ${lambda.toFixed(2)}.`,
    ],
  });

  return {
    plans: { current: currentResult, maxProfit: maxProfitResult, priority: priorityResult },
    priceOfPriorities: priceOfPriorities(maxProfitResult, priorityResult),
    exclusions,
    referenceBounds: bounds,
    stats: {
      candidatesScored: searcher.evaluations,
      descentIterations: iterations,
      monteCarloSamples: draws.samples.length,
    },
  };
}

export function priceOfPriorities(maxProfit: PlanResult, priority: PlanResult): PriceOfPriorities {
  const mpTotal = maxProfit.expectedGM + maxProfit.endOfHorizonValue;
  const prTotal = priority.expectedGM + priority.endOfHorizonValue;
  const profitCost = mpTotal - prTotal;
  const soilHealthGain = priority.soilHealth - maxProfit.soilHealth;
  const waterUseReduction = maxProfit.waterUse - priority.waterUse;
  const p10Change = priority.p10GM - maxProfit.p10GM;
  const terms: Term[] = [
    { label: 'Expected gross margin given up', value: -(maxProfit.expectedGM - priority.expectedGM), unit: '$', basis: 'design' },
    { label: 'Change in N left for next year', value: priority.endOfHorizonValue - maxProfit.endOfHorizonValue, unit: '$', basis: 'design' },
    { label: 'Soil health index gained', value: soilHealthGain, unit: 'index 0-1', basis: 'design' },
    { label: 'Water-use index saved', value: waterUseReduction, unit: 'index', basis: 'design' },
    { label: 'Bad-year (P10) margin change', value: p10Change, unit: '$', basis: 'design' },
  ];
  const summary =
    Math.abs(profitCost) < 1 && Math.abs(soilHealthGain) < 1e-6 && Math.abs(waterUseReduction) < 1e-6
      ? 'Your priorities cost nothing here: the priority plan is the max-profit plan.'
      : `Your priorities cost about ${money(profitCost)} in expected profit over ${maxProfit.paddocks[0]?.years.length ?? 3} years. ` +
        `In return: soil health ${soilHealthGain >= 0 ? '+' : ''}${soilHealthGain.toFixed(3)}, ` +
        `water use ${waterUseReduction >= 0 ? '-' : '+'}${Math.abs(waterUseReduction).toFixed(3)}, ` +
        `bad-year margin ${p10Change >= 0 ? '+' : '-'}${money(Math.abs(p10Change))}.`;
  return { profitCost, soilHealthGain, waterUseReduction, p10Change, terms, summary };
}

// ---------------------------------------------------------------------------
// evaluatePlan
// ---------------------------------------------------------------------------

export interface EvaluateOptions extends ModelOptions {
  seed?: number;
  mcSamples?: number;
}

/**
 * Score a plan the farmer built. Uses the same reference bounds, Monte Carlo
 * draws and objective as generatePlans, so the numbers are comparable.
 * Hard-rule breaks and placement warnings come back as risks.
 */
export function evaluatePlan(
  farm: Farm | PreparedFarm,
  plan: Plan,
  priorities: Priorities,
  market: Market,
  scenarios: WeatherScenario[],
  options: EvaluateOptions = {},
): PlanResult {
  const ctx = createContext(farm, market, scenarios, options);
  const rng = createRng(options.seed ?? 1);
  const w = criteriaWeights(priorities);
  const lambda = riskLambda(priorities);

  const seqs = sequencesFromPlan(plan, ctx.paddocks, ctx.horizon, new Set(Object.keys(ctx.crops)));
  const screens = ctx.paddocks.map((p) => screenCrops(ctx.crops, p, true));
  const bounds = createSearcher(ctx, buildSpaces(ctx, screens.map((s) => s.allowed))).bounds;
  const allowedSets = screens.map((s) => new Set(s.allowed));

  const statics = ctx.paddocks.map((p, i) => sequenceStatics(ctx, p, seqs[i]!));
  const mine = makeCandidate(ctx, seqs, statics, true);
  const { cand: current, gaps: currentGaps } = currentCandidate(ctx, allowedSets);
  const draws = drawSamples(ctx, options.mcSamples ?? MC_SAMPLES, rng);
  mine.mc = summarise(simulate(ctx, mine.seqs, mine.fixedMoney, draws));
  current.mc = mine.key === current.key ? mine.mc : summarise(simulate(ctx, current.seqs, current.fixedMoney, draws));

  // Placement warnings for every cell, severity 2+.
  const warnings: string[] = [];
  const prepared = ctx.prepared;
  ctx.paddocks.forEach((p, i) => {
    seqs[i]!.forEach((cropId, y) => {
      for (const wn of checkPlacement(prepared, plan, p.id, y, cropId, { market, crops: ctx.crops })) {
        if (wn.severity >= 2) warnings.push(`${p.name}, year ${y + 1} (${wn.lens}): ${wn.reason}`);
      }
    });
  });

  const explained = explainPlan(ctx, seqs);
  const res = buildResult(ctx, 'custom', mine, explained, {
    bounds,
    w,
    lambda,
    baseline: current,
    rankStability: null,
    gaps: [UNSOURCED_LAND_CHECKS, ...draws.gaps, ...currentGaps],
    reasons: [
      `Expected gross margin ${money(mine.mc.expected)} over ${ctx.horizon} years vs ${money(current.mc.expected)} for your current rotation.`,
    ],
  });
  res.risks = [...new Set([...res.risks, ...warnings])];
  if (mine.key === current.key) res.probBeatsCurrent = null;
  return res;
}
