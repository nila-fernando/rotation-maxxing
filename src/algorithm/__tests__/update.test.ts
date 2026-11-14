import { describe, expect, it } from 'vitest';
import { evaluatePlan } from '../api';
import { planFromCrops } from '../plans';
import { adoptPlan, calibrate, createFarmState, replan, updateAfterSeason, type SeasonReport } from '../update';
import { syntheticWeatherForTestsOnly } from '../weather';
import type { CalibrationRecord } from '../types';
import { ALL_CROPS, gridFarm, NEUTRAL } from './fixtures';

const rec = (reported: number, predicted: number, used = true): CalibrationRecord => ({ season: 2020, reported, predicted, used });
const pool = syntheticWeatherForTestsOnly(4, 20, ALL_CROPS);
const fast = { seed: 2, mcSamples: 60, rankJitterSamples: 40 };

describe('calibrate (shrinkage)', () => {
  it('starts at 1 and moves only part-way toward a single season', () => {
    expect(calibrate([]).factor).toBe(1);
    const one = calibrate([rec(120, 100)]);
    expect(one.factor).toBeGreaterThan(1);
    expect(one.factor).toBeLessThan(1.2);
    expect(one.seasons).toBe(1);
  });

  it('converges toward a consistent ratio and narrows with more seasons', () => {
    const many = calibrate(Array.from({ length: 10 }, () => rec(120, 100)));
    expect(many.factor).toBeGreaterThan(calibrate([rec(120, 100)]).factor);
    expect(many.factor).toBeCloseTo(1.2, 1);
    expect(many.logSd).toBeLessThan(calibrate([rec(120, 100)]).logSd);
  });

  it('ignores seasons flagged as one-offs', () => {
    expect(calibrate([rec(40, 100, false)]).factor).toBe(1);
  });
});

describe('the season loop', () => {
  const farm = gridFarm(2, 2, 40);
  const start = createFarmState(farm, pool, 2026);

  const report = (factor: number, extra: Partial<SeasonReport['paddocks'][number]> = {}): SeasonReport => ({
    season: 2026,
    paddocks: farm.paddocks.map((p) => ({ paddockId: p.id, cropId: 'soybeans', yieldPerAcre: 52.3 * factor, ...extra })),
  });

  it('rolls history forward, adds the observed weather year, and logs what it learned', () => {
    const observed = { label: '2026 (NASA POWER)', multipliers: { soybeans: 1, corn: 1 } };
    const { state, notes } = updateAfterSeason(start, report(1), { weather: observed });
    expect(state.nextSeason).toBe(2027);
    expect(state.farm.paddocks[0]!.history).toEqual(['soybeans', 'corn', 'soybeans']);
    expect(state.weatherPool).toHaveLength(pool.length + 1);
    expect(state.log[0]!.season).toBe(2026);
    expect(notes.join()).toMatch(/predicted/);
  });

  it('learns a higher field factor when the farmer out-yields the model, and uses it when re-planning', () => {
    const observed = { multipliers: { soybeans: 1 } };
    const { state } = updateAfterSeason(start, report(1.25), { weather: observed });
    const cal = state.farm.paddocks[0]!.yieldCalibration!['soybeans']!;
    expect(cal.factor).toBeGreaterThan(1.05);
    const soyPlan = planFromCrops(Object.fromEntries(farm.paddocks.map((p) => [p.id, ['corn', 'soybeans', 'corn']])));
    const before = evaluatePlan(start.farm, soyPlan, NEUTRAL, {}, pool, fast);
    const after = evaluatePlan(state.farm, soyPlan, NEUTRAL, {}, pool, fast);
    const soyYear = after.paddocks[0]!.years[1]!;
    expect(soyYear.terms.some((t) => t.label.startsWith("Your field's record") && t.sources?.includes('farmerReport'))).toBe(true);
    expect(soyYear.yieldPerAcre!).toBeCloseTo(before.paddocks[0]!.years[1]!.yieldPerAcre! * cal.factor, 6);
  });

  it("doesn't learn from hail or flood years", () => {
    const { state, notes } = updateAfterSeason(start, report(0.4, { events: ['hail'] }), { weather: { multipliers: {} } });
    expect(state.farm.paddocks[0]!.yieldCalibration!['soybeans']!.factor).toBe(1);
    expect(notes.join()).toMatch(/not used to calibrate \(hail\)/);
  });

  it('rejects reports out of order', () => {
    expect(() => updateAfterSeason(start, { ...report(1), season: 2028 })).toThrow(/expects 2026/);
  });

  it('re-plans close to the adopted plan, and says what changed', () => {
    const first = replan(start, NEUTRAL, {}, fast);
    expect(first.replanning).toBeUndefined();
    const adopted = adoptPlan(start, first.plans.priority.plan);
    const grown: SeasonReport = {
      season: 2026,
      paddocks: first.plans.priority.paddocks.map((p) => ({ paddockId: p.paddockId, cropId: p.sequence[0]!, yieldPerAcre: p.years[0]!.yieldPerAcre })),
    };
    const { state } = updateAfterSeason(adopted, grown, { weather: { multipliers: {} } });
    const again = replan(state, NEUTRAL, {}, fast);
    expect(again.replanning).toBeDefined();
    // The switching cost never makes the plan change MORE than it would for free.
    const free = again.replanning!.withoutSwitchingCost;
    expect(again.replanning!.changes.length).toBeLessThanOrEqual(free ? free.changes.length : again.replanning!.changes.length);
    for (const c of again.replanning!.changes) {
      const prev = first.plans.priority.plan.sequences[c.paddockId]![c.year + 1]!.main;
      expect(c.from).toBe(prev);
    }
    // The switching cost shows up in the priority plan's explanation whenever it changes something.
    const hasCostTerm = again.plans.priority.objectiveTerms.some((t) => t.label.startsWith('Switching cost'));
    expect(hasCostTerm).toBe(again.replanning!.changes.length > 0);
  });
});
