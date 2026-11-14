import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePowerDaily } from '../../data/power';
import { annualErosivity, dailyErosivity, scenariosFromDailyWeather } from '../climate';
import { meanScenario } from '../yieldModel';
import { evaluatePlan, generatePlans } from '../api';
import { planFromCrops } from '../plans';
import { waterParamsFor } from '../waterParams';
import type { Farm } from '../types';
import { gridFarm, land, NEUTRAL } from './fixtures';

const weather = parsePowerDaily(JSON.parse(readFileSync(join(__dirname, '../../data/__tests__/fixtures/power_ames_2011_2014.json'), 'utf8')), 42.03).weather;
const farm: Farm = gridFarm(2, 1, 40, { land: land({ awcInPerIn: 0.2 }) });

describe('sourced water parameters', () => {
  it('combines FAO-56 stage lengths/Kc, FAO-66 Ky and croptraits kc mid, p and roots', () => {
    const corn = waterParamsFor('corn').params!;
    expect(corn).toMatchObject({ lIni: 30, lDev: 40, lMid: 50, lLate: 50, kcIni: 0.3, kcMid: 1.2, kcEnd: 0.35, ky: 1.25, p: 0.55, rootIniM: 0.175 });
    expect(corn.rootMaxM).toBeCloseTo(1.35);
  });

  it('returns a gap, not a guess, where Ky or stage lengths are unsourced', () => {
    for (const id of ['oats', 'barley', 'canola', 'cereal-rye', 'alfalfa']) {
      const r = waterParamsFor(id);
      expect(r.params).toBeNull();
      expect(r.gap).toMatch(/No sourced/);
    }
  });
});

describe('weather pool from NASA POWER', () => {
  const res = scenariosFromDailyWeather(farm, weather);

  it('builds one scenario per complete season, with field multipliers, water and erosivity', () => {
    expect(res.scenarios.map((s) => s.label)).toEqual(['2012 (NASA POWER)', '2013 (NASA POWER)', '2014 (NASA POWER)']);
    const s = res.scenarios[0]!;
    expect(s.byPaddock!['p00']!['corn']).toBeDefined();
    expect(s.water!['p00']!['corn']!.demandMm).toBeGreaterThan(300);
    expect(s.erosivityR).toBeGreaterThan(0);
    expect(s.sources).toContain('nasaPower');
    expect(res.gaps.join()).toMatch(/Ky\) for Oats/);
  });

  it('makes 2012 a bad corn year relative to 2014, averaging 1 over the pool for dryland', () => {
    const corn = res.scenarios.map((s) => s.multipliers['corn']!);
    expect(corn[0]).toBeLessThan(corn[2]!);
    expect(meanScenario(res.scenarios).multipliers['corn']).toBeCloseTo(1, 6);
  });

  it('irrigation lifts yields above the dryland average and reports water applied', () => {
    const irr = scenariosFromDailyWeather({ ...farm, constraints: { irrigation: 'irrigated' } }, weather);
    const mean = meanScenario(irr.scenarios);
    expect(mean.multipliers['corn']).toBeGreaterThan(1);
    expect(mean.water!['p00']!['corn']!.irrigationMm).toBeGreaterThan(0);
    const capped = meanScenario(scenariosFromDailyWeather({ ...farm, constraints: { irrigation: 'irrigated', irrigationAllocationIn: 2 } }, weather).scenarios);
    expect(capped.water!['p00']!['corn']!.irrigationMm).toBeLessThanOrEqual(2 * 25.4 + 1e-9);
  });

  it('needs SSURGO available water capacity, and says so', () => {
    const r = scenariosFromDailyWeather(gridFarm(1, 1, 40), weather);
    expect(r.scenarios).toHaveLength(0);
    expect(r.gaps.join()).toMatch(/available-water-capacity/);
  });
});

describe('NASA POWER pool in the planner', () => {
  const soilFarm: Farm = gridFarm(2, 1, 40, {
    land: land({ awcInPerIn: 0.2, kFactor: 0.28, tFactorTonsPerAcre: 5, slopePct: 6, slopeLengthFt: 200 }),
  });
  const pool = scenariosFromDailyWeather(soilFarm, weather).scenarios;
  const plan = planFromCrops({ p00: ['corn', 'soybeans', 'fallow'], p01: ['soybeans', 'corn', 'soybeans'] });
  const r = evaluatePlan(soilFarm, plan, NEUTRAL, {}, pool, { mcSamples: 40 });

  it('scores erosion in tons with RUSLE, and fallow loses the most soil', () => {
    const years = r.paddocks[0]!.years;
    for (const y of years) expect(y.erosionTonsPerAcre).not.toBeNull();
    expect(years[2]!.erosionTonsPerAcre!).toBeGreaterThan(years[0]!.erosionTonsPerAcre!);
    const t = years[0]!.terms.find((x) => x.label.startsWith('Erosion (RUSLE)'))!;
    expect(t.sources).toEqual(expect.arrayContaining(['ah703', 'nasaPower', 'ssurgo']));
  });

  it('scores dryland water as water used (inches), and fallow is no longer free', () => {
    const corn = r.paddocks[0]!.years[0]!;
    const w = corn.terms.find((x) => x.label.startsWith('Water used'))!;
    expect(w.unit).toBe('in');
    expect(corn.waterUseIndex).toBeGreaterThan(5);
    const fallow = r.paddocks[0]!.years[2]!;
    expect(fallow.waterUseIndex).toBeGreaterThan(2); // bare-soil evaporation, May-Sep
    expect(fallow.waterUseIndex).toBeLessThan(corn.waterUseIndex);
    expect(fallow.terms.find((x) => x.label.startsWith('Water lost'))!.sources).toContain('fao56Ch11');
  });

  it('varies yields with the observed weather years in Monte Carlo', () => {
    expect(r.expectedGM - r.p10GM).toBeGreaterThan(0);
  });
});

describe('fallow with real weather (regression)', () => {
  it('neutral priorities on Iowa ground after soy-soy no longer choose fallow', () => {
    const f = gridFarm(4, 2, 40, { history: ['corn', 'soybeans', 'soybeans'], land: land({ awcInPerIn: 0.18, kFactor: 0.28, tFactorTonsPerAcre: 5 }) });
    const pool = scenariosFromDailyWeather(f, weather).scenarios;
    const r = generatePlans(f, NEUTRAL, {}, pool, { seed: 1, mcSamples: 60, rankJitterSamples: 30 });
    expect(r.plans.priority.paddocks.flatMap((p) => p.sequence)).not.toContain('fallow');
  });
});

describe('rainfall erosivity (Richardson 1983)', () => {
  it('weights warm-season rain more, and gives a Midwest-scale annual R', () => {
    expect(dailyErosivity(25, 7)).toBeGreaterThan(dailyErosivity(25, 1));
    expect(dailyErosivity(0, 7)).toBe(0);
    const r = annualErosivity(weather);
    expect(Object.keys(r)).toEqual(['2011', '2012', '2013', '2014']);
    for (const v of Object.values(r)) {
      expect(v).toBeGreaterThan(30);
      expect(v).toBeLessThan(400);
    }
  });
});
