import { describe, expect, it } from 'vitest';
import { describeSource, planSources } from '../evidence';
import { generatePlans, syntheticWeatherForTestsOnly } from '../index';
import { ALL_CROPS, gridFarm, NEUTRAL } from './fixtures';

describe('evidence', () => {
  const farm = { ...gridFarm(2, 1, 40, { land: { slopePct: 8, texture: 'loam', drainage: 'good', salinityECe: 0.5, ph: 6.5 } }), confirmedBuyers: ['dry-beans', 'sunflower', 'canola'] };
  const r = generatePlans(farm, { ...NEUTRAL, profit: 100, soilHealth: 0, water: 0, risk: 0 }, {}, syntheticWeatherForTestsOnly(1, 10, ALL_CROPS), { seed: 1, mcSamples: 40, rankJitterSamples: 20 });

  it('every sourced term carries source ids that resolve to a real source entry', () => {
    for (const plan of Object.values(r.plans)) {
      for (const p of plan.paddocks) {
        for (const y of p.years) {
          for (const t of y.terms.filter((x) => x.basis === 'sourced')) {
            expect(t.sources?.length, t.label).toBeGreaterThan(0);
            for (const id of t.sources!) expect(describeSource(id), `${t.label}: ${id}`).not.toBeNull();
          }
        }
      }
      expect(planSources(plan.paddocks)).toContain('fao56');
    }
  });

  it('lists things to check locally, including contracts for buyer-gated crops and slopes', () => {
    const mp = r.plans.maxProfit;
    expect(mp.localReview.some((x) => /US averages/.test(x))).toBe(true);
    expect(mp.localReview.some((x) => /local prices/.test(x))).toBe(true);
    expect(mp.localReview.some((x) => /is sloped/.test(x))).toBe(true);
    const buyerCrop = mp.paddocks.flatMap((p) => p.sequence).find((c) => ['dry-beans', 'sunflower', 'canola'].includes(c));
    if (buyerCrop) expect(mp.localReview.some((x) => /contract terms/.test(x))).toBe(true);
  });
});
