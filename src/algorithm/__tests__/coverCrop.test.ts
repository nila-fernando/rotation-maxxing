import { describe, expect, it } from 'vitest';
import { evaluatePlan, generatePlans } from '../api';
import { planFromCrops } from '../plans';
import { syntheticWeatherForTestsOnly } from '../weather';
import type { Plan, Priorities } from '../types';
import { ALL_CROPS, gridFarm, NEUTRAL } from './fixtures';

const pool = syntheticWeatherForTestsOnly(9, 15, ALL_CROPS);
const fast = { seed: 4, mcSamples: 40, rankJitterSamples: 20 };
const SOIL: Priorities = { profit: 20, soilHealth: 100, water: 0, risk: 0 };
const PROFIT: Priorities = { profit: 100, soilHealth: 0, water: 0, risk: 0 };
const covers = (p: Plan) => Object.values(p.sequences).flatMap((s) => s.map((x) => x.cover ?? null)).filter(Boolean);

describe('winter cover crop slot', () => {
  const farm = gridFarm(2, 1, 40);

  it('is chosen when soil health matters, never by the max-profit plan', () => {
    const soil = generatePlans(farm, SOIL, {}, pool, fast);
    expect(covers(soil.plans.priority.plan).length).toBeGreaterThan(0);
    expect(covers(soil.plans.maxProfit.plan)).toHaveLength(0);
    expect(covers(generatePlans(farm, PROFIT, {}, pool, fast).plans.priority.plan)).toHaveLength(0);
  });

  it('only goes where it fits: never after winter wheat or before it', () => {
    const r = generatePlans(farm, SOIL, {}, pool, fast);
    for (const seq of Object.values(r.plans.priority.plan.sequences)) {
      seq.forEach((slot, y) => {
        if (!slot.cover) return;
        expect(slot.main).not.toBe('winter-wheat');
        expect(seq[y + 1]?.main).not.toBe('winter-wheat');
      });
    }
  });

  it('needs cereal rye seed to be available', () => {
    const noRye = gridFarm(2, 1, 40, { availableCrops: ALL_CROPS.filter((c) => c !== 'cereal-rye') });
    expect(covers(generatePlans(noRye, SOIL, {}, pool, fast).plans.priority.plan)).toHaveLength(0);
  });

  it('is never a main crop in recommendations', () => {
    const r = generatePlans(farm, SOIL, {}, pool, fast);
    expect(r.plans.priority.paddocks.flatMap((p) => p.sequence)).not.toContain('cereal-rye');
    expect(r.exclusions['p00']!.find((e) => e.cropId === 'cereal-rye')!.reason).toMatch(/winter cover crop/);
  });

  it('costs $37/ac, raises the soil index, and explains its sourced effects and gaps', () => {
    const bare = planFromCrops({ p00: ['corn', 'soybeans', 'corn'], p01: ['soybeans', 'corn', 'soybeans'] });
    const withCover: Plan = JSON.parse(JSON.stringify(bare));
    withCover.sequences['p00']![1]!.cover = 'cereal-rye'; // after soybeans, before corn
    const a = evaluatePlan(farm, bare, NEUTRAL, {}, pool, fast);
    const b = evaluatePlan(farm, withCover, NEUTRAL, {}, pool, fast);
    expect(a.expectedGM - b.expectedGM).toBeCloseTo(37 * farm.paddocks[0]!.acres, 0);
    expect(b.paddocks[0]!.years[1]!.soilHealthIndex).toBeGreaterThan(a.paddocks[0]!.years[1]!.soilHealthIndex);
    expect(b.plan.sequences['p00']![1]!.cover).toBe('cereal-rye');
    const terms = b.paddocks[0]!.years[1]!.terms;
    expect(terms.find((t) => t.label.startsWith('Winter cover crop'))!.sources).toContain('sare2019');
    expect(terms.find((t) => t.label.startsWith('Next corn yield'))!.sources).toContain('marcillo2017');
    expect(b.informationGaps.join()).toMatch(/spring soil-water use/);
  });

  it('rejects a non-cover crop in the cover slot', () => {
    const bad: Plan = planFromCrops({ p00: ['corn', 'soybeans', 'corn'], p01: ['soybeans', 'corn', 'soybeans'] });
    bad.sequences['p00']![0]!.cover = 'oats';
    expect(() => evaluatePlan(farm, bad, NEUTRAL, {}, pool, fast)).toThrow(/isn't a cover crop/);
  });
});
