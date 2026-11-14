import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePowerDaily } from '../../data/power';
import { dailyEt0, indexOfDate, kcOnDay, rootDepthOnDay, simulateBareSoil, simulateSeason, type CropWaterParams } from '../waterBalance';

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

describe('bare-soil (fallow) evaporation, FAO-56 Ch. 7 / Ch. 11', () => {
  // Synthetic days: ET0 4.5 mm/day (FAO-56 Example 31), a soaking rain on day 1, then dry.
  const days = 12;
  const w = {
    dates: Array.from({ length: days }, (_, i) => `2020-07-${String(i + 1).padStart(2, '0')}`),
    tmaxC: [], tminC: [], solarMJ: [], rhPct: [], wind2m: [],
    rainMm: [40, ...Array(days - 1).fill(0)],
    latitude: 42, elevationM: 300, source: 'test',
  } as unknown as import('../types').DailyWeather;
  const et0 = Array(days).fill(4.5);
  const loam = { rewMm: 9, tewMm: 20, kcMax: 1.2 }; // Example 31: TEW ~20, REW ~9, Kc max 1.20

  it('evaporates at Kc max x ET0 on a wet day (Example 31 day 1: 5.4 mm with Kcb = 0)', () => {
    const one = simulateBareSoil(w, { startIndex: 0, days: 1, ...loam, et0 })!;
    expect(one.evaporationMm).toBeCloseTo(5.4);
  });

  it('slows once the surface dries past REW and never evaporates more than TEW from one wetting', () => {
    const r = simulateBareSoil(w, { startIndex: 0, days, ...loam, et0 })!;
    expect(r.evaporationMm).toBeLessThanOrEqual(20 + 1e-9);
    expect(r.evaporationMm).toBeGreaterThan(9);
    expect(r.evaporationMm).toBeLessThan(days * 5.4);
  });

  it('gives a plausible Iowa summer fallow loss, well below crop ET', () => {
    const start = indexOfDate(weather, '2013-05-01');
    const r = simulateBareSoil(weather, { startIndex: start, days: 153, ...loam, et0: dailyEt0(weather) })!;
    expect(r.evaporationMm).toBeGreaterThan(0.2 * r.et0Mm);
    expect(r.evaporationMm).toBeLessThan(r.rainMm + 20);
    expect(r.evaporationMm).toBeLessThan(season(2013).etaMm);
  });
});
