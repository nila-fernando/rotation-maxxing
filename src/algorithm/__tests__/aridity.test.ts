import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePowerDaily } from '../../data/power';
import { generatePlans } from '../api';
import { aridityClass, scarcityFromAridity, waterScarcity } from '../aridity';
import { scenariosFromDailyWeather } from '../climate';
import { criteriaWeights } from '../objective';
import { meanScenario } from '../yieldModel';
import type { DailyWeather, Farm } from '../types';
import { gridFarm, land, NEUTRAL } from './fixtures';

const fx = (n: string) => join(__dirname, '../../data/__tests__/fixtures', n);
const ames = JSON.parse(readFileSync(fx('power_ames_2000_2024.daily.json'), 'utf8')) as DailyWeather;
const saline = parsePowerDaily(JSON.parse(readFileSync(fx('power_saline_ks_2010_2014.json'), 'utf8')), 38.78).weather;

describe('aridity index and water scarcity', () => {
  it('uses the UNEP classes (Zomer et al. 2022), boundaries to the wetter class', () => {
    expect(aridityClass(0.02)).toBe('hyper-arid');
    expect(aridityClass(0.03)).toBe('arid');
    expect(aridityClass(0.35)).toBe('semi-arid');
    expect(aridityClass(0.6)).toBe('dry sub-humid');
    expect(aridityClass(0.65)).toBe('humid');
  });

  it('scarcity is 0 when humid, 1 from the arid boundary, linear between (design)', () => {
    expect(scarcityFromAridity(1.1)).toBe(0);
    expect(scarcityFromAridity(0.65)).toBe(0);
    expect(scarcityFromAridity(0.2)).toBe(1);
    expect(scarcityFromAridity(0.425)).toBeCloseTo(0.5);
    expect(waterScarcity(500, 1000, true).scarcity).toBe(1); // irrigated: real cost
    expect(waterScarcity(null, null, false).scarcity).toBe(1);
  });

  it('scales the water slider before normalising the weights', () => {
    expect(criteriaWeights(NEUTRAL, 0)).toEqual({ profit: 0.5, soilHealth: 0.5, water: 0 });
    expect(criteriaWeights(NEUTRAL, 1).water).toBeCloseTo(1 / 3);
  });

  it('finds Ames humid and Saline KS drier, from NASA POWER', () => {
    const f = gridFarm(1, 1, 40, { land: land({ awcInPerIn: 0.18 }) });
    const ia = meanScenario(scenariosFromDailyWeather(f, ames).scenarios).climate!;
    const ks = meanScenario(scenariosFromDailyWeather({ ...f, state: 'KS' }, saline).scenarios).climate!;
    const aIa = waterScarcity(ia.precipMm, ia.et0Mm, false);
    const aKs = waterScarcity(ks.precipMm, ks.et0Mm, false);
    expect(aIa.aridityClass).toBe('humid');
    expect(aIa.scarcity).toBe(0);
    expect(aIa.explanation).toMatch(/Water is plentiful here/);
    expect(aKs.aridityIndex!).toBeLessThan(aIa.aridityIndex!);
    expect(aKs.scarcity).toBeGreaterThan(0);
  });
});

describe('fallow regressions with water scarcity', () => {
  it('neutral Iowa plans after soy-soy choose no fallow (24-year NASA POWER record)', () => {
    const f = gridFarm(4, 2, 40, { history: ['corn', 'soybeans', 'soybeans'], land: land({ awcInPerIn: 0.18, kFactor: 0.28, tFactorTonsPerAcre: 5 }) });
    const pool = scenariosFromDailyWeather(f, ames).scenarios;
    const r = generatePlans(f, NEUTRAL, {}, pool, { seed: 1, mcSamples: 100, rankJitterSamples: 30 });
    expect(r.plans.priority.paddocks.flatMap((p) => p.sequence)).not.toContain('fallow');
    expect(r.plans.priority.objectiveTerms.some((t) => /Water is plentiful here/.test(t.label))).toBe(true);
  });

  it('a high water slider in Saline County KS can still choose fallow', () => {
    const f: Farm = { ...gridFarm(2, 2, 40, { history: ['sorghum', 'winter-wheat', 'sorghum'], land: land({ awcInPerIn: 0.18, texture: 'silt', kFactor: 0.32, tFactorTonsPerAcre: 5 }) }), state: 'KS', latitude: 38.78 };
    const pool = scenariosFromDailyWeather(f, saline).scenarios;
    const r = generatePlans(f, { profit: 10, soilHealth: 10, water: 100, risk: 50 }, {}, pool, { seed: 1, mcSamples: 60, rankJitterSamples: 20 });
    expect(r.plans.priority.paddocks.flatMap((p) => p.sequence)).toContain('fallow');
  });
});
