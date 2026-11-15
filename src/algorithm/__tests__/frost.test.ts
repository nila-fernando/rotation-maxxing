import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluatePlan, generatePlans } from '../api';
import { scenariosFromDailyWeather } from '../climate';
import { WHEAT_FREEZE_INJURY } from '../croptraits';
import { createContext } from '../farmModel';
import { freezeFactor, springFreeze, wheatStageAt } from '../frost';
import { drawSamples, freezeRngFor, simulate, type Draws } from '../montecarlo';
import { planFromCrops } from '../plans';
import { createRng } from '../rng';
import { syntheticWeatherForTestsOnly } from '../weather';
import { meanScenario } from '../yieldModel';
import type { DailyWeather, Farm, FreezeEventSummary, WeatherScenario } from '../types';
import { gridFarm, land, NEUTRAL } from './fixtures';

/**
 * Synthetic year from 1 Jan: daily max/min of 10/0 C (41 F mean -> 9 growing degrees/day),
 * with cold nights at the given day indexes (0 = 1 Jan).
 */
function spring(cold: Record<number, number>, tmaxC: (i: number) => number = () => 10): DailyWeather {
  const dates: string[] = [];
  const d0 = Date.UTC(2007, 0, 1);
  for (let i = 0; i < 212; i++) dates.push(new Date(d0 + i * 86_400_000).toISOString().slice(0, 10));
  const n = dates.length;
  return {
    dates,
    tmaxC: dates.map((_, i) => tmaxC(i)),
    tminC: dates.map((_, i) => cold[i] ?? 0),
    rainMm: Array(n).fill(1), solarMJ: Array(n).fill(18), rhPct: Array(n).fill(60), wind2m: Array(n).fill(2),
    latitude: 38.78, elevationM: 400, source: 'test',
  };
}

describe('wheat freeze injury (K-State C646 + Mesonet GDD)', () => {
  it('maps growing degrees to C646 stages (design mapping of the Mesonet legend)', () => {
    expect(wheatStageAt(500)).toBe('tillering');
    expect(wheatStageAt(900)).toBe('jointing');
    expect(wheatStageAt(1300)).toBe('boot');
    expect(wheatStageAt(1500)).toBe('heading');
    expect(wheatStageAt(1800)).toBe('flowering');
    expect(wheatStageAt(3000)).toBe('mature');
    expect(WHEAT_FREEZE_INJURY.jointing.injuriousF).toBe(24);
  });

  it('flags a spring night below the stage threshold, and not one above it', () => {
    // ~9 GDD/day: day 96 (7 Apr) has ~860 GDD -> jointing (24 F).
    const hit = springFreeze(spring({ 96: -8.3 }), 2007)!; // 17 F
    expect(hit.worst).toMatchObject({ stage: 'jointing', effect: 'moderate to severe', date: '2007-04-07' });
    expect(springFreeze(spring({ 96: -3 }), 2007)!.worst).toBeNull(); // 27 F > 24 F
    // The same 17 F during spring tillering (6 Mar, ~580 GDD; threshold 12 F) does no damage.
    expect(springFreeze(spring({ 64: -8.3 }), 2007)!.worst).toBeNull();
  });

  it('ignores dormant-season cold before spring green-up (C646 covers spring stages; counted from 1 March)', () => {
    // -4 F in January and February: below the 12 F tillering threshold, but the wheat is dormant.
    expect(springFreeze(spring({ 10: -20, 40: -20 }), 2007)!.worst).toBeNull();
    // The same cold on 5 March counts (spring tillering).
    expect(springFreeze(spring({ 63: -20 }), 2007)!.worst).toMatchObject({ stage: 'tillering', date: '2007-03-05' });
  });

  it('waits for green-up warmth, not just the calendar: a cold early March does not count', () => {
    // Days 0-69 (to 10 Mar) average 23 F (max -2 C, min -8 C): still dormant. Warm from day 70.
    const cold = (i: number) => (i < 70 ? -2 : 10);
    const lows = (extra: Record<number, number>) => {
      const c: Record<number, number> = { ...extra };
      for (let i = 0; i < 70; i++) c[i] ??= -8;
      return c;
    };
    // -4 F on 5 March: below the tillering threshold, but no warm run yet.
    expect(springFreeze(spring(lows({ 63: -20 }), cold), 2007)!.events).toEqual([]);
    // The same night after five warm days (green-up on 15 March) counts.
    expect(springFreeze(spring(lows({ 76: -20 }), cold), 2007)!.worst).toMatchObject({ stage: 'tillering', date: '2007-03-18' });
  });

  it('flags no freezes on the Ames, Iowa record (dormant wheat in early March)', () => {
    const ames = JSON.parse(readFileSync(join(__dirname, '../../data/__tests__/fixtures/power_ames_2000_2024.daily.json'), 'utf8')) as DailyWeather;
    for (let y = 2001; y <= 2024; y++) {
      const r = springFreeze(ames, y)!;
      expect(r).not.toBeNull();
      // Before green-up the wheat has only a few growing degrees; none of those days may count.
      expect(r.events.filter((e) => e.gddF < 200)).toEqual([]);
    }
  });

  it('stops at maturity: cold after ~2800 growing degrees does no damage', () => {
    // 25 C / 15 C = 68 F mean -> 36 growing degrees a day: mature (2800) by about day 78.
    const hot = spring({ 120: -5 }, () => 25);
    for (let i = 0; i < hot.tminC.length; i++) if (i !== 120) hot.tminC[i] = 15;
    expect(springFreeze(hot, 2007)!.events).toEqual([]);
  });

  it('returns null when the record does not cover 1 January - 31 July', () => {
    const w = spring({});
    expect(springFreeze(w, 2008)).toBeNull();
    const short = { ...w, dates: w.dates.slice(0, 200) }; // ends 19 July
    expect(springFreeze(short, 2007)).toBeNull();
  });

  it('keeps the worst event: the more severe C646 effect, then the one furthest below its threshold', () => {
    // Tillering at -4 F (16 F under 12 F, slight-moderate) vs jointing at 23 F (1 F under 24 F, moderate-severe).
    const r = springFreeze(spring({ 63: -20, 96: -5 }), 2007)!;
    expect(r.events.map((e) => e.stage)).toEqual(['tillering', 'jointing']);
    expect(r.worst).toMatchObject({ stage: 'jointing', date: '2007-04-07' });
    // Two jointing nights: the colder one wins.
    expect(springFreeze(spring({ 96: -5, 98: -9 }), 2007)!.worst).toMatchObject({ date: '2007-04-09' });
  });

  it('skips a missing day instead of switching detection off for the season', () => {
    const w = spring({ 96: -8.3 });
    w.tmaxC[30] = NaN;
    w.tminC[50] = NaN;
    expect(springFreeze(w, 2007)!.worst).toMatchObject({ stage: 'jointing' });
  });

  it('uses the design ranges: midpoint for the search, draws within the range', () => {
    expect(freezeFactor('moderate to severe')).toBeCloseTo(0.675);
    expect(freezeFactor('severe', 0)).toBeCloseTo(0.2);
    expect(freezeFactor('severe', 1)).toBeCloseTo(0.6);
    expect(freezeFactor('slight to moderate')).toBeCloseTo(0.9);
  });
});

describe('freeze risk in plans', () => {
  const ev: FreezeEventSummary = { date: '2013-04-24', stage: 'jointing', tminF: 22, thresholdF: 24, effect: 'moderate to severe' };
  const sc = (freeze?: WeatherScenario['freeze']): WeatherScenario => ({ multipliers: { 'winter-wheat': 1 }, ...(freeze ? { freeze } : {}) });

  it('averages over the years checked: no-freeze years count as 1, unchecked years are left out', () => {
    const tiller: FreezeEventSummary = { ...ev, stage: 'tillering', tminF: 0, thresholdF: 12, effect: 'slight to moderate' };
    const pool = [sc({ 'winter-wheat': ev }), sc({ 'winter-wheat': tiller }), sc({ 'winter-wheat': null }), sc({ 'winter-wheat': null }), sc()];
    const risk = meanScenario(pool).freezeRisk!['winter-wheat']!;
    expect(risk).toMatchObject({ years: 2, of: 4, worstStage: 'jointing' });
    expect(risk.meanFactor).toBeCloseTo((freezeFactor('moderate to severe') + freezeFactor('slight to moderate') + 2) / 4);
    // One year each: the tie goes to the more severe effect, not the stage seen first.
    expect(risk.typicalStage).toBe('jointing');
  });

  it('Monte Carlo: one damage draw per weather year, from its own stream', () => {
    const farm = gridFarm(2, 1, 40, { availableCrops: ['winter-wheat', 'soybeans'] });
    const pool = syntheticWeatherForTestsOnly(2, 10, ['winter-wheat', 'soybeans']).map((w) => ({ ...w, freeze: { 'winter-wheat': ev } }));
    const ctx = createContext(farm, {}, pool);
    const draws = drawSamples(ctx, 30, createRng(1), freezeRngFor(1));
    for (const s of draws.samples) expect(s.freezeU).toHaveLength(ctx.horizon);
    expect(new Set(draws.samples[0]!.freezeU).size).toBe(ctx.horizon); // years are not tied together
    const withU = (u: number): Draws => ({ ...draws, samples: draws.samples.map((s) => ({ ...s, freezeU: s.freezeU.map(() => u) })) });
    const wheat = Array.from({ length: 2 }, () => Array(ctx.horizon).fill('winter-wheat'));
    const soy = Array.from({ length: 2 }, () => Array(ctx.horizon).fill('soybeans'));
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(simulate(ctx, wheat, 0, withU(0)))).toBeLessThan(sum(simulate(ctx, wheat, 0, withU(1))));
    expect(simulate(ctx, soy, 0, withU(0))).toEqual(simulate(ctx, soy, 0, withU(1)));
    // The main stream is untouched by the freeze stream.
    const other = drawSamples(ctx, 30, createRng(1), freezeRngFor(99));
    expect(other.samples.map((s) => s.weather)).toEqual(draws.samples.map((s) => s.weather));
    expect(other.samples.map((s) => s.price)).toEqual(draws.samples.map((s) => s.price));
  });

  const saline = JSON.parse(readFileSync(join(__dirname, '../../data/__tests__/fixtures/power_saline_ks_2010_2014.json'), 'utf8'));
  it('explains freeze risk on a Kansas wheat plan and flags Kansas as water-limited, Iowa not', async () => {
    const { parsePowerDaily } = await import('../../data/power');
    const w = parsePowerDaily(saline, 38.78).weather;
    const f: Farm = { ...gridFarm(2, 1, 40, { land: land({ awcInPerIn: 0.18, texture: 'silt' }), availableCrops: ['winter-wheat', 'sorghum', 'soybeans', 'fallow'] }), state: 'KS', latitude: 38.78 };
    const pool = scenariosFromDailyWeather(f, w).scenarios;
    for (const s of pool) expect(s.freeze).toBeDefined();
    const risk = meanScenario(pool).freezeRisk!['winter-wheat']!;
    expect(risk).toMatchObject({ years: 1, of: pool.length, typicalStage: 'jointing' }); // 24 April 2013
    const r = generatePlans(f, NEUTRAL, {}, pool, { seed: 1, mcSamples: 40, rankJitterSamples: 10 });
    expect(r.plans.priority.weatherRisk).toMatchObject({ waterLimited: true, aridityClass: 'semi-arid' });
    const horizon = r.plans.priority.paddocks[0]!.sequence.length;
    const wheat = evaluatePlan(f, planFromCrops({ p00: Array(horizon).fill('winter-wheat'), p01: Array(horizon).fill('winter-wheat') }), NEUTRAL, {}, pool, { seed: 1, mcSamples: 40 });
    const label = new RegExp(`^Freeze risk: in 1 of ${pool.length} years, temperatures fell to or below the jointing threshold`);
    expect(wheat.paddocks[0]!.years.some((y) => y.terms.some((t) => label.test(t.label)))).toBe(true);
    expect(wheat.risks.some((x) => label.test(x))).toBe(true);

    const ames = JSON.parse(readFileSync(join(__dirname, '../../data/__tests__/fixtures/power_ames_2000_2024.daily.json'), 'utf8')) as DailyWeather;
    const ia = gridFarm(2, 1, 40, { land: land({ awcInPerIn: 0.18 }) });
    const iaPool = scenariosFromDailyWeather(ia, ames).scenarios;
    expect(meanScenario(iaPool).freezeRisk!['winter-wheat']!.years).toBe(0);
    const ri = generatePlans(ia, NEUTRAL, {}, iaPool, { seed: 1, mcSamples: 40, rankJitterSamples: 10 });
    expect(ri.plans.priority.weatherRisk.waterLimited).toBe(false);
    expect(ri.plans.priority.weatherRisk.message).toMatch(/mostly not about water/);
    expect(ri.plans.priority.risks.some((x) => /Freeze/.test(x))).toBe(false);
  });
});
