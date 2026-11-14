/**
 * The farm model: turns a set of paddock sequences into money, soil health
 * and water numbers. Search, Monte Carlo and evaluatePlan all go through
 * these functions, so a plan scores the same wherever it is scored.
 *
 * Split into:
 *  - per-sequence "statics" that don't depend on neighbours, weather or prices
 *    (costs, N credits, soil health, water, end-of-horizon value)
 *  - farm-wide revenue, which depends on every paddock's yield (shade) and on
 *    total production (market caps)
 */
import { CROP_BY_ID } from './croptraits';
import { COVER_CROP_ID, END_SOIL_WEIGHT, HORIZON_YEARS } from './constants';
import { seasonFor } from './seasons';
import { RYE_COVER } from './waterParams';
import { economicsStatus, FALLOW_COST_GAP, getCrop, isFallow, operatingCost } from './cropData';
import { sourceIds } from './evidence';
import { prepareFarm } from './geometry';
import { priceInfo, sell, type PriceInfo } from './market';
import { DEFAULT_N_PRICE, nitrogenCreditReceived, nitrogenLeftBehind, sequenceViolation, timelineOf } from './rotation';
import { nCreditReference, residueReference, soilHealthIndex, waterUseIndex, type FieldWaterInput } from './soilHealth';
import { meanScenario, TraitYieldModel, withCalibration, type YieldModel } from './yieldModel';
import type {
  CropId,
  CropTable,
  Farm,
  FieldWater,
  Market,
  Paddock,
  PaddockId,
  PaddockResult,
  PreparedFarm,
  Term,
  WeatherScenario,
  YearResult,
} from './types';

export interface ModelOptions {
  /** Default: TraitYieldModel. */
  yieldModel?: YieldModel;
  /** Default: CROP_BY_ID from croptraits.ts. */
  crops?: CropTable;
  /** $/lb N used to value N credits. Default: NITROGEN_PRICE_PER_LB from croptraits.ts. */
  nitrogenPricePerLb?: number;
  /** Count the soil health and N left behind at the end of the horizon. Default true. */
  endOfHorizon?: boolean;
  /**
   * Re-planning: last season's plan aligned to this horizon (null = no
   * earlier plan for that year). Changing it costs SWITCHING_PENALTY_WEIGHT.
   */
  previousPlan?: Record<PaddockId, (CropId | null)[]>;
}

export interface ModelContext {
  prepared: PreparedFarm;
  paddocks: Paddock[];
  crops: CropTable;
  model: YieldModel;
  market: Market;
  prices: Record<CropId, PriceInfo | null>;
  nPricePerLb: number;
  horizon: number;
  endOfHorizon: boolean;
  /** Weather pool supplied by the caller (never empty: falls back to an average year). */
  weatherPool: WeatherScenario[];
  /** Mean of the pool: used for every expected (deterministic) number. */
  expectedWeather: WeatherScenario;
  refs: { residueLb: number; nCreditLb: number };
  totalAcres: number;
  /** Paddock id -> position in `paddocks`. */
  paddockIndex: Map<PaddockId, number>;
  previousPlan: Record<PaddockId, (CropId | null)[]> | null;
  /** Gaps that apply to the whole run (market, weather). */
  globalGaps: string[];
}

export function createContext(
  farm: Farm | PreparedFarm,
  market: Market,
  scenarios: WeatherScenario[],
  options: ModelOptions = {},
): ModelContext {
  const prepared = 'adjacency' in farm ? farm : prepareFarm(farm);
  const crops = options.crops ?? CROP_BY_ID;
  const globalGaps: string[] = [];
  const prices: Record<CropId, PriceInfo | null> = {};
  for (const c of Object.values(crops)) {
    const { info, gap } = priceInfo(market, c);
    prices[c.id] = info;
    if (gap && Object.keys(market).length > 0) globalGaps.push(gap);
  }
  if (Object.keys(market).length === 0) {
    globalGaps.push('No local market data supplied; US average prices with no demand caps are used.');
  }
  let pool = scenarios;
  if (pool.length === 0) {
    pool = [{ label: 'Average year', multipliers: {} }];
    globalGaps.push('No weather scenarios supplied: yields use average weather and Monte Carlo varies prices only.');
  }
  const paddocks = prepared.farm.paddocks;
  return {
    prepared,
    paddocks,
    crops,
    model: withCalibration(options.yieldModel ?? new TraitYieldModel()),
    market,
    prices,
    nPricePerLb: options.nitrogenPricePerLb ?? DEFAULT_N_PRICE,
    horizon: HORIZON_YEARS,
    endOfHorizon: options.endOfHorizon ?? true,
    weatherPool: pool,
    expectedWeather: meanScenario(pool),
    refs: { residueLb: residueReference(crops), nCreditLb: nCreditReference(crops) },
    totalAcres: paddocks.reduce((a, p) => a + p.acres, 0),
    paddockIndex: new Map(paddocks.map((p, i) => [p.id, i])),
    previousPlan: options.previousPlan ?? null,
    globalGaps,
  };
}

/** RUSLE R for the soil index, when the weather pool came from daily rain. */
function erosionInput(ctx: ModelContext): { erosivityR?: number } {
  const r = ctx.expectedWeather.erosivityR;
  return r !== undefined ? { erosivityR: r } : {};
}

/**
 * Expected field water for a paddock from the water balance, or the farm
 * average where this field had no soil data. Undefined if the pool has no water results.
 */
export function fieldWater(ctx: ModelContext, paddockId: PaddockId): FieldWaterInput | undefined {
  const all = ctx.expectedWeather.water;
  if (!all || Object.keys(all).length === 0) return undefined;
  const irrigated = ctx.prepared.farm.constraints?.irrigation === 'irrigated';
  const own = all[paddockId];
  if (own) return { byCrop: own, irrigated };
  const byCrop: Record<CropId, FieldWater> = {};
  const crops = new Set(Object.values(all).flatMap((r) => Object.keys(r)));
  for (const c of crops) {
    const vals = Object.values(all).flatMap((r) => (r[c] ? [r[c]] : []));
    const avg = (k: keyof FieldWater) => vals.reduce((a, v) => a + v[k], 0) / vals.length;
    byCrop[c] = { demandMm: avg('demandMm'), deficitMm: avg('deficitMm'), irrigationMm: avg('irrigationMm') };
  }
  return { byCrop, irrigated };
}

// ---------------------------------------------------------------------------
// Per-sequence statics
// ---------------------------------------------------------------------------

export interface SequenceStatics {
  seq: CropId[];
  key: string;
  /** Shade-free expected yield per acre per year (0 when there is no harvest). */
  yields: number[];
  /** Operating cost over the horizon, $ (whole paddock). */
  cost: number;
  /** N credits received over the horizon, $ (whole paddock). */
  nCredit: number;
  /** $ value of N left for the next corn crop (0 if endOfHorizon is off). */
  endValue: number;
  /** Horizon soil score 0-1 (mean, final year weighted up if endOfHorizon). */
  soil: number;
  /** Final-year soil health index 0-1. */
  endSoil: number;
  /** Mean water-use index over the horizon. */
  water: number;
  families: string[];
  /** Years that differ from last season's plan (re-planning only). */
  switches: number;
  /** Winter cover crop after each year's main crop (null = none). */
  covers: (CropId | null)[];
  /** What adding a cover crop in each year would cost and add (only years where it fits). */
  coverOptions: CoverOption[];
}

export interface CoverOption {
  year: number;
  /** $ for the whole paddock. */
  cost: number;
  /** Change in the horizon soil score (same units as SequenceStatics.soil). */
  soilGain: number;
  /** Change in the final-year soil index (non-zero for the last year only). */
  endSoilGain: number;
}

/**
 * Can a winter cover crop follow the main crop in year y? It needs a
 * summer-harvested crop (not winter wheat or a continuing alfalfa stand) and a
 * spring-planted crop after it (not winter wheat, planted in October).
 */
export function coverFits(ctx: ModelContext, paddock: Paddock, seq: CropId[], y: number): boolean {
  if (!paddock.availableCrops.includes(COVER_CROP_ID) || !ctx.crops[COVER_CROP_ID]) return false;
  const isWinter = (id: CropId | undefined) => {
    if (!id) return false;
    const span = seasonFor(getCrop(ctx.crops, id), ctx.prepared.farm.state).span;
    return !!span && span.plantMonth > span.harvestMonth;
  };
  const here = seq[y]!;
  const next = seq[y + 1];
  if (isWinter(here) || isWinter(next)) return false;
  if (here === 'alfalfa' && next === 'alfalfa') return false;
  return true;
}

/** Statics with the given cover choices applied (cost and soil adjusted). */
export function applyCovers(o: SequenceStatics, mask: boolean[]): SequenceStatics {
  let cost = o.cost;
  let soil = o.soil;
  let endSoil = o.endSoil;
  const covers = o.seq.map(() => null as CropId | null);
  for (const c of o.coverOptions) {
    if (!mask[c.year]) continue;
    cost += c.cost;
    soil += c.soilGain;
    endSoil += c.endSoilGain;
    covers[c.year] = COVER_CROP_ID;
  }
  return { ...o, cost, soil, endSoil, covers, key: coverKey(o.seq, covers) };
}

export function coverKey(seq: CropId[], covers: (CropId | null)[]): string {
  return seq.map((c, y) => (covers[y] ? `${c}+${covers[y]}` : c)).join('>');
}

/**
 * Everything about a paddock sequence that doesn't depend on neighbours,
 * weather draws or market totals.
 * @param yieldCache optional cache keyed by prefix, shared across sequences of one paddock
 */
export function sequenceStatics(
  ctx: ModelContext,
  paddock: Paddock,
  seq: CropId[],
  yieldCache?: Map<string, number>,
  covers?: (CropId | null)[],
): SequenceStatics {
  const { crops } = ctx;
  const coverOptions: CoverOption[] = [];
  const soilByYear: number[] = [];
  const t = timelineOf(paddock, seq);
  const off = t.length - seq.length;
  const yields: number[] = [];
  let cost = 0;
  let nCredit = 0;
  let soilSum = 0;
  let endSoil = 0;
  let water = 0;
  const state = ctx.prepared.farm.state;
  for (let y = 0; y < seq.length; y++) {
    const prefix = seq.slice(0, y + 1).join(',');
    let yv = yieldCache?.get(prefix);
    if (yv === undefined) {
      const est = ctx.model.yieldFor(paddock, seq, y, ctx.expectedWeather, {
        prepared: ctx.prepared,
        crops,
        neighbourCrop: () => null,
        explain: false,
      });
      yv = est.value ?? 0;
      yieldCache?.set(prefix, yv);
    }
    yields.push(yv);
    const crop = getCrop(crops, seq[y]!);
    cost += (operatingCost(crop) ?? 0) * paddock.acres;
    nCredit += nitrogenCreditReceived(crops, t, off + y, ctx.nPricePerLb).dollarsPerAcre * paddock.acres;
    const soilInput = {
      crops,
      paddock,
      timeline: t,
      index: off + y,
      yieldPerAcre: yv || null,
      state,
      refs: ctx.refs,
      ...erosionInput(ctx),
    };
    const hasCover = !!covers?.[y];
    if (hasCover) cost += RYE_COVER.costPerAcre.value * paddock.acres;
    const soil = soilHealthIndex({ ...soilInput, coverCrop: hasCover }).value;
    soilByYear.push(soil);
    if (!covers && coverFits(ctx, paddock, seq, y)) {
      const withCover = soilHealthIndex({ ...soilInput, coverCrop: true }).value;
      coverOptions.push({ year: y, cost: RYE_COVER.costPerAcre.value * paddock.acres, soilGain: withCover - soil, endSoilGain: 0 });
    }
    soilSum += soil;
    if (y === seq.length - 1) endSoil = soil;
    water += waterUseIndex(crops, crop, state, fieldWater(ctx, paddock.id)).value;
  }
  const n = seq.length;
  const endW = ctx.endOfHorizon ? END_SOIL_WEIGHT : 0;
  const last = seq[n - 1]!;
  // Convert per-year soil gains into horizon-score units.
  for (const c of coverOptions) {
    const isLast = c.year === n - 1;
    c.endSoilGain = isLast ? c.soilGain : 0;
    c.soilGain = (c.soilGain * (1 + (isLast ? endW : 0))) / (n + endW);
  }
  const coverList = seq.map((_, y) => covers?.[y] ?? null);
  return {
    seq,
    key: coverKey(seq, coverList),
    covers: coverList,
    coverOptions,
    yields,
    cost,
    nCredit,
    endValue: ctx.endOfHorizon ? nitrogenLeftBehind(crops, last, ctx.nPricePerLb).dollars * paddock.acres : 0,
    soil: (soilSum + endW * endSoil) / (n + endW),
    endSoil,
    water: water / n,
    families: seq.map((id) => getCrop(crops, id).family),
    switches: countSwitches(seq, ctx.previousPlan?.[paddock.id]),
  };
}

export function countSwitches(seq: CropId[], previous: (CropId | null)[] | undefined): number {
  if (!previous) return 0;
  return seq.reduce((n, c, y) => n + (previous[y] != null && previous[y] !== c ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// Farm-wide revenue
// ---------------------------------------------------------------------------

/**
 * Revenue of the whole farm over the horizon, given every paddock's yield.
 * @param seqs crop per paddock (by paddock index) per year
 * @param yields yield per acre per paddock per year
 * @param priceMultiplier Monte Carlo price draw per crop and year (default 1)
 */
export function farmRevenue(
  ctx: ModelContext,
  seqs: CropId[][],
  yields: number[][],
  priceMultiplier?: (cropId: CropId, year: number) => number,
): number {
  let total = 0;
  const production = new Map<CropId, number>();
  for (let y = 0; y < ctx.horizon; y++) {
    production.clear();
    for (let p = 0; p < seqs.length; p++) {
      const c = seqs[p]![y]!;
      const units = yields[p]![y]! * ctx.paddocks[p]!.acres;
      if (units > 0) production.set(c, (production.get(c) ?? 0) + units);
    }
    for (const [c, units] of production) {
      const info = ctx.prices[c];
      if (!info) continue;
      total += sell(info, units, priceMultiplier ? priceMultiplier(c, y) : 1).revenue;
    }
  }
  return total;
}

/** Yield of paddock p in year y with neighbours from `seqs` (no caching). */
export function yieldWithNeighbours(
  ctx: ModelContext,
  seqs: CropId[][],
  p: number,
  y: number,
  weather: WeatherScenario,
  shadeToleranceDraw?: (cropId: CropId) => number | undefined,
  explain = false,
) {
  const index = ctx.paddockIndex;
  return ctx.model.yieldFor(ctx.paddocks[p]!, seqs[p]!, y, weather, {
    prepared: ctx.prepared,
    crops: ctx.crops,
    neighbourCrop: (id) => {
      const q = index.get(id);
      return q === undefined ? null : (seqs[q]?.[y] ?? null);
    },
    ...(shadeToleranceDraw ? { shadeToleranceDraw } : {}),
    explain,
  });
}

// ---------------------------------------------------------------------------
// Explained evaluation (for display)
// ---------------------------------------------------------------------------

export interface ExplainedPlan {
  paddocks: PaddockResult[];
  /** Deterministic GM with expected weather and prices, $. */
  grossMargin: number;
  endValue: number;
  soil: number;
  endSoil: number;
  water: number;
  gaps: string[];
  risks: string[];
  /** Production per crop per year vs local demand (for market warnings). */
  marketExcess: { cropId: CropId; year: number; production: number; localDemand: number }[];
  /** Largest shaded fraction found per paddock-year. */
  shade: { paddockId: PaddockId; year: number; fraction: number }[];
}

/** Score a whole plan with expected weather and full explanations. */
export function explainPlan(ctx: ModelContext, seqs: CropId[][], covers?: (CropId | null)[][]): ExplainedPlan {
  const { crops } = ctx;
  const gaps = new Set<string>(ctx.globalGaps);
  const risks = new Set<string>();
  const shade: ExplainedPlan['shade'] = [];

  // Yields with neighbours, explained.
  const yieldEst = seqs.map((_, p) =>
    seqs[p]!.map((__, y) => yieldWithNeighbours(ctx, seqs, p, y, ctx.expectedWeather, undefined, true)),
  );
  const yields = yieldEst.map((row) => row.map((e) => e.value ?? 0));

  // Effective prices per crop-year.
  const effPrice = new Map<string, { price: number; local: number; distant: number; production: number }>();
  const marketExcess: ExplainedPlan['marketExcess'] = [];
  for (let y = 0; y < ctx.horizon; y++) {
    const prod = new Map<CropId, number>();
    seqs.forEach((s, p) => {
      const u = yields[p]![y]! * ctx.paddocks[p]!.acres;
      if (u > 0) prod.set(s[y]!, (prod.get(s[y]!) ?? 0) + u);
    });
    for (const [c, u] of prod) {
      const info = ctx.prices[c];
      if (!info) continue;
      const sale = sell(info, u);
      effPrice.set(`${c}|${y}`, { price: sale.effectivePrice, local: sale.localUnits, distant: sale.distantUnits, production: u });
      if (sale.distantUnits > 0) marketExcess.push({ cropId: c, year: y, production: u, localDemand: info.localDemand });
    }
  }

  let grossMargin = 0;
  let endValue = 0;
  let soilW = 0;
  let endSoilW = 0;
  let waterW = 0;
  const paddocks: PaddockResult[] = ctx.paddocks.map((pad, p) => {
    const seq = seqs[p]!;
    const t = timelineOf(pad, seq);
    const off = t.length - seq.length;
    const violation = sequenceViolation(crops, pad, seq);
    if (violation) risks.add(`${pad.name}: ${violation}`);
    const years: YearResult[] = [];
    let soilSum = 0;
    let lastSoil = 0;
    let waterSum = 0;
    for (let y = 0; y < seq.length; y++) {
      const crop = getCrop(crops, seq[y]!);
      const est = yieldEst[p]![y]!;
      est.gaps.forEach((g) => gaps.add(g));
      est.risks.forEach((r) => risks.add(`${pad.name}, year ${y + 1}: ${r}`));
      if (est.shadedFraction > 0) shade.push({ paddockId: pad.id, year: y, fraction: est.shadedFraction });
      const terms: Term[] = [...est.terms];

      // Money per acre.
      const yv = yields[p]![y]!;
      const ep = effPrice.get(`${crop.id}|${y}`);
      const revenue = ep ? yv * ep.price : 0;
      if (ep) {
        const split = ep.distant > 0 ? ` (${Math.round((ep.local / ep.production) * 100)}% sold locally, rest at distant price less freight)` : '';
        const fromMarket = ctx.prices[crop.id]?.fromMarket ?? false;
        terms.push({
          label: `Effective ${crop.name} price${split}`,
          value: ep.price,
          unit: `$/${crop.yieldUnit}`,
          basis: fromMarket ? 'input' : 'sourced',
          sources: fromMarket ? ['marketInput'] : sourceIds(crop.pricePerUnit?.source),
        });
      }
      terms.push({ label: 'Revenue', value: revenue, unit: '$/ac', basis: 'input' });
      const oc = operatingCost(crop);
      const econ = economicsStatus(crop);
      if (isFallow(crop)) {
        gaps.add(FALLOW_COST_GAP);
        terms.push({ label: 'Operating cost (fallow: field operations not costed yet)', value: 0, unit: '$/ac', basis: 'assumption' });
      } else if (oc === null) {
        gaps.add(
          econ.status === 'incomplete'
            ? `Operating cost for ${crop.name} is not sourced: its gross margin is incomplete (cost shown as $0).`
            : `Operating cost for ${crop.name.toLowerCase()} is not sourced (shown as $0).`,
        );
      } else {
        terms.push({
          label: `Operating cost (${crop.operatingCostPerAcre?.source ?? 'source'})`,
          value: -oc,
          unit: '$/ac',
          basis: 'sourced',
          sources: sourceIds(crop.operatingCostPerAcre?.source),
        });
      }
      const nc = nitrogenCreditReceived(crops, t, off + y, ctx.nPricePerLb);
      if (nc.term) terms.push(nc.term);
      if (nc.gap) gaps.add(nc.gap);
      const cover = covers?.[p]?.[y] ?? null;
      let coverCost = 0;
      if (cover) {
        coverCost = RYE_COVER.costPerAcre.value;
        terms.push({
          label: `Winter cover crop: ${getCrop(crops, cover).name} after ${crop.name.toLowerCase()} (seed + seeding, SARE median for all cover crops)`,
          value: -coverCost,
          unit: '$/ac',
          basis: 'sourced',
          sources: [...RYE_COVER.costPerAcre.sources],
        });
        if (seq[y + 1] === 'corn') {
          terms.push({
            label: 'Next corn yield after a grass cover crop: no change (meta-analysis)',
            value: RYE_COVER.nextCornYieldChange.value,
            unit: '%',
            basis: 'sourced',
            sources: [...RYE_COVER.nextCornYieldChange.sources],
          });
        }
        gaps.add('Cereal rye cover crop: spring soil-water use (about 1 in per 1,000 lb/ac biomass) and N tie-up are not modelled; biomass is not sourced.');
      }
      const gm = revenue - (oc ?? 0) - coverCost + nc.dollarsPerAcre;
      terms.push({ label: 'Gross margin', value: gm, unit: '$/ac', basis: 'input' });
      grossMargin += gm * pad.acres;

      // Soil and water.
      const sh = soilHealthIndex({
        crops,
        paddock: pad,
        timeline: t,
        index: off + y,
        yieldPerAcre: sequenceYieldShadeFree(ctx, pad, seq, y),
        coverCrop: !!cover,
        state: ctx.prepared.farm.state,
        refs: ctx.refs,
        ...erosionInput(ctx),
        ...(est.soil ? { override: est.soil } : {}),
      });
      sh.gaps.forEach((g) => gaps.add(g));
      terms.push(...sh.components, { label: 'Soil health index', value: sh.value, unit: 'index 0-1', basis: 'design' });
      const w = waterUseIndex(crops, crop, ctx.prepared.farm.state, fieldWater(ctx, pad.id));
      if (w.gap) gaps.add(w.gap);
      terms.push(w.term);
      soilSum += sh.value;
      lastSoil = sh.value;
      waterSum += w.value;

      years.push({
        year: y,
        cropId: crop.id,
        yieldPerAcre: est.value,
        yieldUnit: crop.yieldUnit,
        grossMarginPerAcre: gm,
        soilHealthIndex: sh.value,
        erosionTonsPerAcre: sh.erosionTonsPerAcre,
        waterUseIndex: w.value,
        terms,
      });
    }
    const n = seq.length;
    const endW = ctx.endOfHorizon ? END_SOIL_WEIGHT : 0;
    const share = pad.acres / ctx.totalAcres;
    soilW += share * ((soilSum + endW * lastSoil) / (n + endW));
    endSoilW += share * lastSoil;
    waterW += share * (waterSum / n);
    if (ctx.endOfHorizon) endValue += nitrogenLeftBehind(crops, seq[n - 1]!, ctx.nPricePerLb).dollars * pad.acres;
    return { paddockId: pad.id, name: pad.name, acres: pad.acres, sequence: seq.slice(), years };
  });

  return {
    paddocks,
    grossMargin,
    endValue,
    soil: soilW,
    endSoil: endSoilW,
    water: waterW,
    gaps: [...gaps],
    risks: [...risks],
    marketExcess,
    shade,
  };
}

/**
 * Acre-weighted horizon soil score with tillage retention at position `at`
 * (0 = low end, 1 = high end of the NRCS ranges). Cover only rises with
 * retention, and one draw is shared farm-wide, so the soil score's P10/P90
 * under a uniform draw are exactly its values at at = 0.1 / 0.9.
 */
export function planSoilAt(ctx: ModelContext, seqs: CropId[][], covers: (CropId | null)[][] | undefined, at: number): number {
  const endW = ctx.endOfHorizon ? END_SOIL_WEIGHT : 0;
  let total = 0;
  ctx.paddocks.forEach((pad, p) => {
    const seq = seqs[p]!;
    const t = timelineOf(pad, seq);
    const off = t.length - seq.length;
    let sum = 0;
    let last = 0;
    seq.forEach((_, y) => {
      const v = soilHealthIndex({
        crops: ctx.crops,
        paddock: pad,
        timeline: t,
        index: off + y,
        yieldPerAcre: sequenceYieldShadeFree(ctx, pad, seq, y),
        state: ctx.prepared.farm.state,
        refs: ctx.refs,
        ...erosionInput(ctx),
        coverCrop: !!covers?.[p]?.[y],
        retentionAt: at,
      }).value;
      sum += v;
      last = v;
    });
    total += (pad.acres / ctx.totalAcres) * ((sum + endW * last) / (seq.length + endW));
  });
  return total;
}

/** Shade-free expected yield used for residue-based soil components (same as in statics). */
function sequenceYieldShadeFree(ctx: ModelContext, pad: Paddock, seq: CropId[], y: number): number | null {
  return ctx.model.yieldFor(pad, seq, y, ctx.expectedWeather, {
    prepared: ctx.prepared,
    crops: ctx.crops,
    neighbourCrop: () => null,
    explain: false,
  }).value;
}

