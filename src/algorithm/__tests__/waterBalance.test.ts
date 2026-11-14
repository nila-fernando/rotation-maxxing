import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePowerDaily } from '../../data/power';
import { dailyEt0, indexOfDate, kcOnDay, rootDepthOnDay, simulateSeason, type CropWaterParams } from '../waterBalance';

// TEST-ONLY parameters shaped like a summer grain crop. NOT sourced data:
// the engine is tested here; the sourced table lives in waterParams.ts.
const TEST_CROP: CropWaterParams = { lIni: 30, lDev: 40, lMid: 50, lLate: 30, kcIni: 0.3, kcMid: 1.2, kcEnd: 0.6, ky: 1.25, p: 0.55, rootIniM: 0.15, rootMaxM: 1.2 };

const weather = parsePowerDaily(JSON.parse(readFileSync(join(__dirname, '../../data/__tests__/fixtures/power_ames_2011_2014.json'), 'utf8')), 42.03).weather;
const et0 = dailyEt0(weather);
const season = (year: number, extra = {}) =>
  simulateSeason(weather, TEST_CROP, { startIndex: indexOfDate(weather, `${year}-05-01`), awc: 0.17, et0, ...extra })!;

describe('water balance (FAO-56 ch. 8 + FAO-33)', () => {
  it('builds the Kc curve and root growth from stage lengths', () => {
    expect(kcOnDay(TEST_CROP, 0)).toBe(0.3);
    expect(kcOnDay(TEST_CROP, 50)).toBeCloseTo(0.75);
    expect(kcOnDay(TEST_CROP, 100)).toBe(1.2);
    expect(kcOnDay(TEST_CROP, 149)).toBeCloseTo(0.6 + (1 / 30) * 0.6, 2);
    expect(rootDepthOnDay(TEST_CROP, 0)).toBe(0.15);
    expect(rootDepthOnDay(TEST_CROP, 70)).toBe(1.2);
  });

  it('gives plausible Iowa summer ET0 (3-7 mm/day in July)', () => {
    const july = et0.filter((_, i) => weather.dates[i]!.startsWith('2013-07'));
    const mean = july.reduce((a, b) => a + b, 0) / july.length;
    expect(mean).toBeGreaterThan(3);
    expect(mean).toBeLessThan(7);
  });

  it('shows the 2012 drought as a bigger deficit and lower relative yield than 2014', () => {
    const dry = season(2012);
    const wet = season(2014);
    expect(dry.deficitMm).toBeGreaterThan(wet.deficitMm + 50);
    expect(dry.yieldRatio).toBeLessThan(wet.yieldRatio);
    expect(dry.stressDays).toBeGreaterThan(wet.stressDays);
  });

  it('irrigation removes the deficit, within the allocation', () => {
    const full = season(2012, { irrigated: true });
    expect(full.irrigationMm).toBeGreaterThan(0);
    expect(full.yieldRatio).toBeGreaterThan(season(2012).yieldRatio);
    const capped = season(2012, { irrigated: true, allocationMm: 50 });
    expect(capped.irrigationMm).toBeLessThanOrEqual(50);
    expect(capped.yieldRatio).toBeLessThanOrEqual(full.yieldRatio);
  });

  it('conserves water: eta never exceeds etm; starting dry hurts', () => {
    const s = season(2013);
    expect(s.etaMm).toBeLessThanOrEqual(s.etmMm + 1e-9);
    expect(season(2013, { initialDepletionFraction: 0.8 }).yieldRatio).toBeLessThanOrEqual(s.yieldRatio);
  });

  it('returns null when the season runs past the data', () => {
    expect(simulateSeason(weather, TEST_CROP, { startIndex: indexOfDate(weather, '2014-11-01'), awc: 0.17 })).toBeNull();
  });
});
