/**
 * Stage 6: uncertainty, for a handful of candidate plans only.
 *
 * Common random numbers: every sample draws ONE weather year per horizon
 * year (a whole year from the pool, all crops together), one price path, and
 * one shade-tolerance value per crop with unknown tolerance. The same draws
 * are used for every paddock and every candidate plan, so differences
 * between plans are real differences, not sampling noise.
 *
 * Known gap: prices are log-normal and independent per crop and year; the
 * corn/soybean price correlation is not modelled yet.
 */
import { P_LOW } from './constants';
import { priceVolatility, shadeTolerance } from './cropData';
import { farmRevenue, yieldWithNeighbours, type ModelContext } from './farmModel';
import { lognormalMultiplier, uniformInt, type Rng } from './rng';
import type { CropId, WeatherScenario } from './types';

export const PRICE_CORRELATION_GAP =
  'Prices are sampled independently per crop; the corn/soybean price correlation is not modelled yet.';

export interface Sample {
  /** Weather year per horizon year (drawn whole from the pool). */
  weather: WeatherScenario[];
  /** Price multiplier per crop per horizon year. */
  price: Record<CropId, number[]>;
  /** Shade tolerance draws for crops whose tolerance is not sourced. */
  shadeTolerance: Record<CropId, number>;
  /** Where freeze damage falls within its design range this sample (0-1), shared by every field and plan. */
  freezeU: number;
  /** Climate model used this sample (present-climate adjustment), if any. */
  member?: string;
}

export interface Draws {
  samples: Sample[];
  gaps: string[];
}

export function drawSamples(ctx: ModelContext, n: number, rng: Rng): Draws {
  const cropIds = Object.keys(ctx.crops).sort(); // fixed order -> reproducible
  const gaps = new Set<string>([PRICE_CORRELATION_GAP]);
  const sigma: Record<CropId, number> = {};
  for (const id of cropIds) {
    const c = ctx.crops[id]!;
    const s = priceVolatility(c);
    if (s === null && ctx.prices[id]) gaps.add(`Price volatility for ${c.name} is not available; its price is held fixed in Monte Carlo.`);
    sigma[id] = s ?? 0;
  }
  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) {
    // One climate model per sample (common to every paddock and plan), then whole years from its pool.
    const member = ctx.members && ctx.members.length ? ctx.members[uniformInt(rng, ctx.members.length)]! : null;
    const yearPool = member ? member.pool : ctx.weatherPool;
    const weather: WeatherScenario[] = [];
    for (let y = 0; y < ctx.horizon; y++) weather.push(yearPool[uniformInt(rng, yearPool.length)]!);
    const price: Record<CropId, number[]> = {};
    for (const id of cropIds) {
      const path: number[] = [];
      for (let y = 0; y < ctx.horizon; y++) path.push(lognormalMultiplier(rng, sigma[id]!));
      price[id] = path;
    }
    const tol: Record<CropId, number> = {};
    for (const id of cropIds) {
      if (shadeTolerance(ctx.crops[id]!) === null) tol[id] = rng.next();
    }
    samples.push({ weather, price, shadeTolerance: tol, freezeU: rng.next(), ...(member ? { member: member.model } : {}) });
  }
  return { samples, gaps: [...gaps] };
}

/**
 * Farm gross margin over the horizon for each sample.
 * @param fixedMoney costs and N credits (they don't vary with weather or prices), $
 */
export function simulate(ctx: ModelContext, seqs: CropId[][], fixedMoney: number, draws: Draws): number[] {
  return draws.samples.map((s) => {
    const tol = (id: CropId) => s.shadeTolerance[id];
    const freezeDraw = () => s.freezeU;
    const yields = seqs.map((seq, p) =>
      seq.map((_, y) => yieldWithNeighbours(ctx, seqs, p, y, s.weather[y]!, tol, false, freezeDraw).value ?? 0),
    );
    return farmRevenue(ctx, seqs, yields, (c, y) => s.price[c]?.[y] ?? 1) + fixedMoney;
  });
}

/** Linear-interpolated quantile of an unsorted array. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export interface McSummary {
  expected: number;
  p10: number;
  totals: number[];
}

export function summarise(totals: number[]): McSummary {
  const expected = totals.reduce((a, b) => a + b, 0) / (totals.length || 1);
  return { expected, p10: quantile(totals, P_LOW), totals };
}

/** Share of samples where `plan` beats `baseline` (same samples, so paired). */
export function probBeats(plan: number[], baseline: number[]): number {
  if (plan.length === 0) return 0;
  let wins = 0;
  for (let i = 0; i < plan.length; i++) if (plan[i]! > baseline[i]!) wins++;
  return wins / plan.length;
}

