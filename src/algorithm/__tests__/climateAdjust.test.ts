import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatePlans } from '../api';
import { scenariosFromDailyWeather } from '../climate';
import { adjustDailyWeather, buildWeather, meanTrends, shiftTable, zeroTrends, type ClimateTrendsFile, type TrendSet } from '../climateAdjust';
import { adoptPlan, createFarmState, replan } from '../update';
import { dailyEt0 } from '../waterBalance';
import { isEnsemble, type DailyWeather } from '../types';
import { createContext } from '../farmModel';
import { drawSamples } from '../montecarlo';
import { createRng } from '../rng';
import { gridFarm, land, NEUTRAL } from './fixtures';

const ames = JSON.parse(readFileSync(join(__dirname, '../../data/__tests__/fixtures/power_ames_2000_2024.daily.json'), 'utf8')) as DailyWeather;
const farm = gridFarm(2, 1, 40, { land: land({ awcInPerIn: 0.18, kFactor: 0.28, tFactorTonsPerAcre: 5 }) });

/** A synthetic trend set: warming and wetter, uniform across months. */
function trend(tC: number, prRel: number, hurs = 0): TrendSet {
  const t = zeroTrends();
  t.tasmax.slope = Array(12).fill(tC);
  t.tasmin.slope = Array(12).fill(tC);
  t.pr.slope = Array(12).fill(prRel);
  t.hurs.slope = Array(12).fill(hurs);
  return t;
}
const file = (sets: TrendSet[]): ClimateTrendsFile => ({
  site: 'test',
  gridCell: { lat: 42.0, lng: -93.6 },
  fitYears: [1995, 2035],
  models: sets.map((trends, i) => ({ model: `M${i}`, ecsC: 3, trends })),
});

describe('present-climate adjustment (delta method)', () => {
  it('zero trends leave the weather pool identical to raw', () => {
    const raw = scenariosFromDailyWeather(farm, ames).scenarios;
    const adj = scenariosFromDailyWeather(farm, adjustDailyWeather(ames, zeroTrends(), 2027)).scenarios;
    expect(JSON.stringify(adj)).toBe(JSON.stringify(raw));
  });

  it('a warmer shift raises reference ET', () => {
    const warm = adjustDailyWeather(ames, trend(0.05, 0), 2027);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(dailyEt0(warm))).toBeGreaterThan(sum(dailyEt0(ames)));
  });

  it('keeps dry days dry and clamps the precipitation factor to 0.5-2.0', () => {
    const wet = adjustDailyWeather(ames, trend(0, 0.5), 2027); // absurd +50%/yr -> clamped at x2
    ames.rainMm.forEach((r, i) => {
      if (r === 0) expect(wet.rainMm[i]).toBe(0);
      else expect(wet.rainMm[i]! / r).toBeLessThanOrEqual(2 + 1e-9);
    });
  });

  it('shifts older years more than recent ones (2001 vs 2022)', () => {
    const w = adjustDailyWeather(ames, trend(0.04, 0), 2027);
    const i01 = ames.dates.indexOf('2001-07-15');
    const i22 = ames.dates.indexOf('2022-07-15');
    expect(w.tmaxC[i01]! - ames.tmaxC[i01]!).toBeCloseTo(0.04 * 26);
    expect(w.tmaxC[i22]! - ames.tmaxC[i22]!).toBeCloseTo(0.04 * 5);
  });

  it('keeps humidity in 0-100 and Tmin <= Tmax', () => {
    const t = trend(0, 0, 5);
    t.tasmin.slope = Array(12).fill(0.5); // nights warming far faster than days
    const w = adjustDailyWeather(ames, t, 2027);
    expect(Math.max(...w.rhPct)).toBeLessThanOrEqual(100);
    w.tminC.forEach((v, i) => expect(v).toBeLessThanOrEqual(w.tmaxC[i]!));
  });

  it('flags trends smaller than 2x their standard error as likely noise', () => {
    const t = trend(0.03, 0.001);
    t.tasmax.se = Array(12).fill(0.005);
    t.pr.se = Array(12).fill(0.002);
    const rows = shiftTable(t, 2001, 2027);
    expect(rows.find((r) => r.variable === 'tasmax' && r.month === 6)!.likelyNoise).toBe(false);
    expect(rows.find((r) => r.variable === 'pr' && r.month === 6)!.likelyNoise).toBe(true);
  });
});

describe('ensemble in planning', () => {
  const f = file([trend(0.01, -0.01), trend(0.03, 0), trend(0.06, 0.01)]);

  it('builds a mean pool and one pool per model, and explains the shift', () => {
    const b = buildWeather(farm, ames, { trends: f, targetYear: 2027 });
    expect(isEnsemble(b.weather)).toBe(true);
    if (!isEnsemble(b.weather)) return;
    expect(b.weather.members.map((m) => m.model)).toEqual(['M0', 'M1', 'M2']);
    expect(b.weather.adjustment.summary).toMatch(/Weather shifted to the model-projected \d{4} climate using NASA NEX-GDDP-CMIP6 \(3 climate models\); older years shifted more\. 2001 replayed ~1\.6 F warmer in Jul/); // mean 0.0333 C/yr x 26 yr = 0.87 C
    expect(meanTrends(f).tasmax.slope[6]).toBeCloseTo((0.01 + 0.03 + 0.06) / 3);
    expect(b.gaps.join()).toMatch(/cannot be backtested/);
  });

  it('falls back to last weather year + 1 (with a gap) when no target year is given', () => {
    const b = buildWeather(farm, ames, { trends: f });
    expect(b.targetYear).toBe(2025);
    expect(b.gaps[0]).toMatch(/No planning season was given/);
  });

  it("'none' gives exactly the raw pool (as the backtest uses)", () => {
    const b = buildWeather(farm, ames, { trends: f, targetYear: 2027, weatherAdjustment: 'none' });
    expect(JSON.stringify(b.weather)).toBe(JSON.stringify(scenariosFromDailyWeather(farm, ames).scenarios));
  });

  it('is deterministic for a seed; each Monte Carlo sample uses one climate model, and all are used', () => {
    const b = buildWeather(farm, ames, { trends: f, targetYear: 2027 });
    const opts = { seed: 5, mcSamples: 150, rankJitterSamples: 10 };
    const r1 = generatePlans(farm, NEUTRAL, {}, b.weather, opts);
    const r2 = generatePlans(farm, NEUTRAL, {}, b.weather, opts);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.plans.priority.reasons.join()).toMatch(/model-projected \d{4} climate/);
    const draws = drawSamples(createContext(farm, {}, b.weather), 150, createRng(5));
    expect(new Set(draws.samples.map((s) => s.member))).toEqual(new Set(['M0', 'M1', 'M2']));
    if (!isEnsemble(b.weather)) return;
    // Every year in a sample comes from that sample's model pool.
    for (const s of draws.samples.slice(0, 20)) for (const w of s.weather) expect(w.label).toMatch(new RegExp(`\\(${s.member}\\)`));
  });

  it('replan re-adjusts the weather to the state\'s nextSeason', () => {
    const b = buildWeather(farm, ames, { trends: f, targetYear: 2026 });
    let state = createFarmState(farm, b.weather, 2027, { daily: ames, trends: f, weatherAdjustment: 'present' });
    state = adoptPlan(state, generatePlans(farm, NEUTRAL, {}, b.weather, { seed: 1, mcSamples: 30, rankJitterSamples: 5 }).plans.priority.plan);
    const r = replan(state, NEUTRAL, {}, { seed: 1, mcSamples: 30, rankJitterSamples: 5 });
    // Built for 2026 (25 yr -> 1.5 F); replan rebuilds for nextSeason 2027 (26 yr -> 1.6 F).
    expect(r.plans.priority.reasons.join()).toMatch(/model-projected \d{4} climate.*2001 replayed ~1\.6 F warmer/);
  });
});
