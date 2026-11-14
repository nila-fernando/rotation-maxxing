import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePowerDaily } from '../../data/power';
import { evaluatePlan } from '../api';
import { scenariosFromDailyWeather, startDepletionFraction, type CarryoverInput } from '../climate';
import { planFromCrops } from '../plans';
import { dailyEt0 } from '../waterBalance';
import type { Farm } from '../types';
import { gridFarm, land, NEUTRAL } from './fixtures';

// Recorded NASA POWER daily weather, Saline County KS, 2010-2014.
const weather = parsePowerDaily(JSON.parse(readFileSync(join(__dirname, '../../data/__tests__/fixtures/power_saline_ks_2010_2014.json'), 'utf8')), 38.78).weather;
const carry: CarryoverInput = { weather, et0: dailyEt0(weather), state: 'KS', awc: 0.18, texture: 'silt', irrigated: false, allocationMm: Infinity };

describe('soil-water carryover across seasons (Saline County, KS)', () => {
  it('wheat after summer fallow starts wetter than wheat after sorghum, every year', () => {
    for (const year of [2012, 2013, 2014]) {
      const afterFallow = startDepletionFraction(carry, 'fallow', 'winter-wheat', year)!;
      const afterSorghum = startDepletionFraction(carry, 'sorghum', 'winter-wheat', year)!;
      expect(afterFallow).not.toBeNull();
      expect(afterSorghum).not.toBeNull();
      expect(afterFallow).toBeLessThan(afterSorghum);
    }
  });

  it('depletion stays within 0..1 of the root zone', () => {
    for (const prev of ['fallow', 'sorghum', 'soybeans', 'corn', 'winter-wheat', 'sunflower']) {
      const f = startDepletionFraction(carry, prev, 'corn', 2013)!;
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(startDepletionFraction(carry, 'oats', 'corn', 2013)).toBeNull(); // no sourced Ky: average start used
  });

  it('turns stored water into a higher wheat yield after fallow, explained to the farmer', () => {
    const farm: Farm = { ...gridFarm(2, 1, 40, { land: land({ awcInPerIn: 0.18, texture: 'silt' }) }), state: 'KS', latitude: 38.78 };
    const built = scenariosFromDailyWeather(farm, weather);
    const pool = built.scenarios;
    expect(built.gaps.join()).toMatch(/carries over one season/);
    for (const s of pool) {
      const after = s.byPaddockAfter!['p00']!;
      expect(after['fallow']!['winter-wheat']!).toBeGreaterThanOrEqual(after['sorghum']!['winter-wheat']!);
    }
    const r = evaluatePlan(
      farm,
      planFromCrops({ p00: ['fallow', 'winter-wheat', 'sorghum'], p01: ['sorghum', 'winter-wheat', 'sorghum'] }),
      NEUTRAL,
      {},
      pool,
      { mcSamples: 30 },
    );
    const wheatAfterFallow = r.paddocks[0]!.years[1]!;
    const wheatAfterSorghum = r.paddocks[1]!.years[1]!;
    expect(wheatAfterFallow.yieldPerAcre!).toBeGreaterThan(wheatAfterSorghum.yieldPerAcre!);
    expect(wheatAfterFallow.terms.some((t) => /soil water after fallow/.test(t.label))).toBe(true);
  });
});
