import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePowerDaily } from '../../data/power';
import { annualErosivity, dailyErosivity, scenariosFromDailyWeather } from '../climate';
import { meanScenario } from '../yieldModel';
import { waterParamsFor } from '../waterParams';
import type { Farm } from '../types';
import { gridFarm, land } from './fixtures';

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
