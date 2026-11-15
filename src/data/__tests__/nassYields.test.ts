import { describe, expect, it } from 'vitest';
import { chooseBaseYield, parseYieldRows, practiceRatio, quickStatsUrl, type LevelSeries, type PracticeSeries } from '../nassYields';
import { NASS_YIELD_SPECS } from '../nassYields';
import { generatePlans } from '../../algorithm/api';
import { baseYieldFor } from '../../algorithm/cropData';
import { CROP_BY_ID } from '../../algorithm/croptraits';
import type { Farm } from '../../algorithm/types';
import { gridFarm } from '../../algorithm/__tests__/fixtures';

const corn = NASS_YIELD_SPECS['corn']!;
const row = (year: number, practice: string, value: string, extra: Record<string, string> = {}) => ({
  year: String(year),
  reference_period_desc: 'YEAR',
  short_desc: 'CORN, GRAIN - YIELD, MEASURED IN BU / ACRE',
  unit_desc: 'BU / ACRE',
  util_practice_desc: 'GRAIN',
  class_desc: 'ALL CLASSES',
  prodn_practice_desc: practice,
  state_alpha: 'KS',
  county_name: 'MCPHERSON',
  Value: value,
  ...extra,
});

const series = (all: Record<number, number>, dry: Record<number, number> = {}, irr: Record<number, number> = {}): PracticeSeries => ({
  all: Object.fromEntries(Object.entries(all)),
  'non-irrigated': Object.fromEntries(Object.entries(dry)),
  irrigated: Object.fromEntries(Object.entries(irr)),
});

describe('NASS Quick Stats base yields', () => {
  it('puts the key and the county/state filter in the URL', () => {
    const u = new URL(quickStatsUrl('KEY', corn, '20', '113'));
    expect(u.searchParams.get('agg_level_desc')).toBe('COUNTY');
    expect(u.searchParams.get('county_code')).toBe('113');
    expect(new URL(quickStatsUrl('KEY', corn, '20')).searchParams.get('agg_level_desc')).toBe('STATE');
  });

  it('parses practices, skips forecasts, withheld values and other utilisations', () => {
    const body = {
      data: [
        row(2018, 'ALL PRODUCTION PRACTICES', '129.4'),
        row(2018, 'NON-IRRIGATED', '70.1'),
        row(2018, 'IRRIGATED', '216.6'),
        row(2019, 'ALL PRODUCTION PRACTICES', '(D)'),
        row(2020, 'ALL PRODUCTION PRACTICES', '149.5', { reference_period_desc: 'YEAR - AUG FORECAST' }),
        row(2020, 'ALL PRODUCTION PRACTICES', '20', { util_practice_desc: 'SILAGE', unit_desc: 'TONS / ACRE', short_desc: 'CORN, SILAGE - YIELD, MEASURED IN TONS / ACRE' }),
      ],
    };
    const p = parseYieldRows(body, corn);
    expect(p.series.all).toEqual({ '2018': 129.4 });
    expect(p.series['non-irrigated']).toEqual({ '2018': 70.1 });
    expect(p.series.irrigated).toEqual({ '2018': 216.6 });
    expect(p.place).toBe('McPherson County, KS');
  });

  it('ratio = mean of yearly practice/all over paired years (needs 3)', () => {
    const s = series({ 2016: 100, 2017: 100, 2018: 120 }, { 2016: 60, 2017: 70, 2018: 60 });
    expect(practiceRatio(s, 'non-irrigated')!.value).toBeCloseTo((0.6 + 0.7 + 0.5) / 3);
    expect(practiceRatio(series({ 2017: 100, 2018: 100 }, { 2017: 60, 2018: 60 }), 'non-irrigated')).toBeNull();
  });

  it('county: last 5 recent all-practice years x the county ratio (design)', () => {
    const county: LevelSeries = {
      level: 'county',
      place: 'X County, KS',
      series: series({ 2014: 100, 2015: 100, 2016: 100, 2021: 110, 2022: 90, 2023: 100, 2024: 120, 2025: 80 }, { 2014: 70, 2015: 70, 2016: 70 }),
    };
    const r = chooseBaseYield('corn', [county], 'non-irrigated');
    expect(r.baseYield!.years).toEqual([2025, 2024, 2023, 2022, 2021]);
    expect(r.baseYield!.allPracticeMean).toBeCloseTo(100);
    expect(r.baseYield!.value).toBeCloseTo(70);
    expect(r.baseYield!.practice).toBe('non-irrigated');
    expect(r.baseYield!.basis).toBe('design');
    expect(r.gaps).toEqual([]);
  });

  it('borrows the state ratio when the county has too few paired years', () => {
    const county: LevelSeries = { level: 'county', place: 'X County, KS', series: series({ 2021: 100, 2022: 100, 2023: 100 }) };
    const state: LevelSeries = { level: 'state', place: 'KS', series: series({ 2016: 100, 2017: 100, 2018: 100, 2023: 100 }, {}, { 2016: 150, 2017: 150, 2018: 150 }) };
    const r = chooseBaseYield('corn', [county, state], 'irrigated');
    expect(r.baseYield!.level).toBe('county');
    expect(r.baseYield!.practiceRatio!.level).toBe('state');
    expect(r.baseYield!.value).toBeCloseTo(150);
    expect(r.gaps.join()).toMatch(/only 3 years/);
  });

  it('falls back county -> state -> national, naming the level', () => {
    const staleCounty: LevelSeries = { level: 'county', place: 'X County, KS', series: series({ 2008: 50, 2009: 50, 2014: 50 }) };
    const state: LevelSeries = { level: 'state', place: 'KS', series: series({ 2021: 60, 2022: 60, 2023: 60, 2024: 60, 2025: 60 }) };
    const r = chooseBaseYield('oats', [staleCounty, state], 'non-irrigated');
    expect(r.baseYield!.level).toBe('state');
    expect(r.baseYield!.practice).toBe('all');
    expect(r.gaps.join()).toMatch(/using the KS state yield/);
    expect(r.gaps.join()).toMatch(/all-practice yield is used/);
    const none = chooseBaseYield('oats', [], 'non-irrigated');
    expect(none.baseYield).toBeNull();
    expect(none.gaps.join()).toMatch(/using the US average yield/);
  });

  it('the yield model starts from the farm base yield and labels it', () => {
    const farm: Farm = gridFarm(1, 1, 40, { history: ['soybeans'], availableCrops: ['corn'] });
    const local = { ...farm, baseYields: { corn: { value: 84.3, level: 'county' as const, place: 'Saline County, KS', practice: 'non-irrigated' as const, years: [2021, 2025], allPracticeMean: 116.9, practiceRatio: { value: 0.721, years: [2000, 2018], level: 'county' as const }, basis: 'design' as const, sources: ['nassQuickStats'] } } };
    expect(baseYieldFor(farm, CROP_BY_ID['corn']!).value).toBeCloseTo(180.7);
    expect(baseYieldFor(local, CROP_BY_ID['corn']!).value).toBeCloseTo(84.3);
    const r = generatePlans(local, { profit: 50, soilHealth: 50, water: 50, risk: 50 }, {}, [{ label: 'avg', multipliers: {} }], { seed: 1, mcSamples: 20, rankJitterSamples: 10 });
    const terms = Object.values(r.plans).flatMap((p) => p.paddocks.flatMap((x) => x.years.flatMap((y) => y.terms)));
    expect(terms.some((t) => /Saline County, KS Corn.*yield, non-irrigated/.test(t.label) && Math.abs(t.value - 84.3) < 1e-6)).toBe(true);
    expect(r.plans.priority.localReview.join()).toMatch(/NASS county/);
  });
});
