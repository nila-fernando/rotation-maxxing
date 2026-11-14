import { describe, expect, it } from 'vitest';
import { createContext, explainPlan } from '../farmModel';
import { screenCrops } from '../filters';
import { probBeats, quantile } from '../montecarlo';
import { criteriaWeights, normalise, riskAdjusted, riskLambda, scoreObjective, varietyExcess } from '../objective';
import { continueHistory } from '../plans';
import { buildSpaces, createSearcher } from '../search';
import { syntheticWeatherForTestsOnly } from '../weather';
import { ALL_CROPS, gridFarm, paddock, rect } from './fixtures';

describe('objective', () => {
  it('turns sliders into weights; risk only sets lambda; all-zero falls back to equal weights', () => {
    expect(criteriaWeights({ profit: 50, soilHealth: 50, water: 50, risk: 100 })).toEqual({ profit: 1 / 3, soilHealth: 1 / 3, water: 1 / 3 });
    expect(criteriaWeights({ profit: 0, soilHealth: 0, water: 0, risk: 80 })).toEqual({ profit: 1 / 3, soilHealth: 1 / 3, water: 1 / 3 });
    expect(criteriaWeights({ profit: 100, soilHealth: 0, water: 0, risk: 0 }).profit).toBe(1);
    expect(riskLambda({ profit: 0, soilHealth: 0, water: 0, risk: 100 })).toBe(1);
    expect(riskAdjusted(100, 60, 1)).toBe(60);
    expect(riskAdjusted(100, 60, 0)).toBe(100);
  });

  it('normalises against fixed bounds, including lower-is-better criteria', () => {
    expect(normalise({ worst: 0, best: 10 }, 5)).toBe(0.5);
    expect(normalise({ worst: 1, best: 0.2 }, 0.2)).toBe(1); // water: lower is better
    expect(normalise({ worst: 3, best: 3 }, 3)).toBe(0);
  });

  it('measures crop-family concentration above the cap', () => {
    const allOne = [new Map([['grain', 100]])];
    const split = [new Map([['grain', 50], ['legume', 50]])];
    expect(varietyExcess(allOne, 100)).toBeCloseTo(0.4);
    expect(varietyExcess(split, 100)).toBe(0);
  });
});

describe('search', () => {
  const farm = gridFarm(2, 2, 40);
  const ctx = createContext(farm, {}, syntheticWeatherForTestsOnly(2, 20, ALL_CROPS));
  const spaces = buildSpaces(ctx, ctx.paddocks.map((p) => screenCrops(ctx.crops, p).allowed));
  const s = createSearcher(ctx, spaces);

  it('computes reference bounds once from the per-paddock enumeration', () => {
    expect(s.bounds.profit.best).toBeGreaterThan(s.bounds.profit.worst);
    expect(s.bounds.soilHealth.best).toBeGreaterThan(s.bounds.soilHealth.worst);
    expect(s.bounds.water.best).toBeLessThan(s.bounds.water.worst);
  });

  it("the search's incremental scoring matches the full explained evaluation", () => {
    const w = { profit: 0.5, soilHealth: 0.3, water: 0.2 };
    const { choice } = s.descend(s.standaloneStart(w), w, 0.5);
    const crit = s.criteria(choice);
    const explained = explainPlan(ctx, s.sequences(choice));
    expect(crit.grossMargin).toBeCloseTo(explained.grossMargin, 6);
    expect(crit.soilHealth).toBeCloseTo(explained.soil, 9);
    expect(crit.water).toBeCloseTo(explained.water, 9);
    expect(crit.endValue).toBeCloseTo(explained.endValue, 6);
  });

  it('coordinate descent never makes the objective worse than its start', () => {
    const w = { profit: 1, soilHealth: 0, water: 0 };
    const start = s.standaloneStart(w);
    const end = s.descend(start, w, 0).choice;
    const score = (c: number[]) => scoreObjective(s.criteria(c), s.bounds, w, 0).value;
    expect(score(end)).toBeGreaterThanOrEqual(score(start) - 1e-9);
  });
});

describe('Monte Carlo helpers', () => {
  it('computes quantiles and paired win rates', () => {
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 0.1)).toBe(2);
    expect(probBeats([3, 3, 3, 3], [1, 5, 1, 5])).toBe(0.5);
  });
});

describe('current rotation continued', () => {
  const p = (h: string[]) => paddock('a', rect(0, 0, 10, 10), { history: h });
  it('carries the shortest repeating pattern forward', () => {
    expect(continueHistory(p(['corn', 'soybeans', 'corn']), 3).seq).toEqual(['soybeans', 'corn', 'soybeans']);
    expect(continueHistory(p(['corn', 'corn', 'corn']), 3).seq).toEqual(['corn', 'corn', 'corn']);
    expect(continueHistory(p(['corn', 'soybeans', 'winter-wheat']), 3).seq).toEqual(['corn', 'soybeans', 'winter-wheat']);
    expect(continueHistory(p([]), 3).gap).toMatch(/no crop history/);
  });
});
