import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatePlans } from '../api';
import { scenariosFromDailyWeather } from '../climate';
import { WHEAT_FREEZE_INJURY } from '../croptraits';
import { freezeFactor, springFreeze, wheatStageAt } from '../frost';
import { meanScenario } from '../yieldModel';
import type { DailyWeather, Farm } from '../types';
import { gridFarm, land, NEUTRAL } from './fixtures';

/**
 * Synthetic year from 1 Jan: daily max/min of 10/0 C (41 F mean -> 9 growing degrees/day),
 * with cold nights at the given day indexes (0 = 1 Jan).
 */
function spring(cold: Record<number, number>): DailyWeather {
  const dates: string[] = [];
  const d0 = Date.UTC(2007, 0, 1);
  for (let i = 0; i < 212; i++) dates.push(new Date(d0 + i * 86_400_000).toISOString().slice(0, 10));
  const n = dates.length;
  return {
    dates,
    tmaxC: Array(n).fill(10),
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

  it('uses the design ranges: midpoint for the search, draws within the range', () => {
    expect(freezeFactor('moderate to severe')).toBeCloseTo(0.675);
    expect(freezeFactor('severe', 0)).toBeCloseTo(0.2);
    expect(freezeFactor('severe', 1)).toBeCloseTo(0.6);
    expect(freezeFactor('slight to moderate')).toBeCloseTo(0.9);
  });
});

describe('freeze and water-limited flag in plans', () => {
  const saline = JSON.parse(readFileSync(join(__dirname, '../../data/__tests__/fixtures/power_saline_ks_2010_2014.json'), 'utf8'));
  it('explains freeze risk for wheat and flags Kansas as water-limited, Iowa not', async () => {
    const { parsePowerDaily } = await import('../../data/power');
    const w = parsePowerDaily(saline, 38.78).weather;
    const f: Farm = { ...gridFarm(2, 1, 40, { land: land({ awcInPerIn: 0.18, texture: 'silt' }), availableCrops: ['winter-wheat', 'sorghum', 'soybeans', 'fallow'] }), state: 'KS', latitude: 38.78 };
    const pool = scenariosFromDailyWeather(f, w).scenarios;
    for (const s of pool) expect(s.freeze).toBeDefined();
    const risk = meanScenario(pool).freezeRisk!['winter-wheat']!;
    expect(risk.of).toBe(pool.length);
    const r = generatePlans(f, NEUTRAL, {}, pool, { seed: 1, mcSamples: 40, rankJitterSamples: 10 });
    expect(r.plans.priority.weatherRisk).toMatchObject({ waterLimited: true, aridityClass: 'semi-arid' });
    if (risk.years > 0) {
      const wheat = r.plans.priority.paddocks.flatMap((p) => p.years).find((y) => y.cropId === 'winter-wheat');
      if (wheat) expect(wheat.terms.some((t) => /^Freeze risk: in \d+ of \d+ years/.test(t.label))).toBe(true);
    }
    const ames = JSON.parse(readFileSync(join(__dirname, '../../data/__tests__/fixtures/power_ames_2000_2024.daily.json'), 'utf8')) as DailyWeather;
    const ia = gridFarm(2, 1, 40, { land: land({ awcInPerIn: 0.18 }) });
    const ri = generatePlans(ia, NEUTRAL, {}, scenariosFromDailyWeather(ia, ames).scenarios, { seed: 1, mcSamples: 40, rankJitterSamples: 10 });
    expect(ri.plans.priority.weatherRisk.waterLimited).toBe(false);
    expect(ri.plans.priority.weatherRisk.message).toMatch(/mostly not about water/);
  });
});
