import { describe, expect, it } from 'vitest';
import { CROP_BY_ID } from '../croptraits';
import { checkPlacement, evaluatePlan, generatePlans, planFromCrops, syntheticWeatherForTestsOnly } from '../index';
import type { CropTable, GenerateResult, PlanResult, Priorities } from '../types';
import { ALL_CROPS, gridFarm, NEUTRAL, paddock, rect } from './fixtures';

const weather = syntheticWeatherForTestsOnly(11, 30, ALL_CROPS);
const PROFIT_ONLY: Priorities = { profit: 100, soilHealth: 0, water: 0, risk: 0 };
const fast = { seed: 3, mcSamples: 60, rankJitterSamples: 50 };

function cropsIn(p: PlanResult): Set<string> {
  return new Set(p.paddocks.flatMap((x) => x.sequence));
}

/** Largest share of farm area in one family in any year. */
function maxFamilyShare(r: PlanResult): number {
  const total = r.paddocks.reduce((a, p) => a + p.acres, 0);
  let max = 0;
  for (let y = 0; y < r.paddocks[0]!.sequence.length; y++) {
    const fam = new Map<string, number>();
    for (const p of r.paddocks) {
      const f = CROP_BY_ID[p.sequence[y]!]!.family;
      fam.set(f, (fam.get(f) ?? 0) + p.acres);
    }
    for (const a of fam.values()) max = Math.max(max, a / total);
  }
  return max;
}

describe('generatePlans', () => {
  const farm = gridFarm(3, 2, 40);
  const res: GenerateResult = generatePlans(farm, NEUTRAL, {}, weather, fast);

  it('returns current, max-profit and priority plans with the reported fields', () => {
    for (const p of Object.values(res.plans)) {
      expect(p.paddocks).toHaveLength(6);
      expect(Number.isFinite(p.expectedGM)).toBe(true);
      expect(p.p10GM).toBeLessThanOrEqual(p.expectedGM);
      expect(p.endSoilHealth).toBeGreaterThan(0);
      expect(p.informationGaps.length).toBeGreaterThan(0);
      expect(p.objectiveTerms.length).toBeGreaterThan(0);
    }
    expect(res.plans.current.probBeatsCurrent).toBeNull();
    expect(res.plans.maxProfit.probBeatsCurrent).toBeGreaterThanOrEqual(0);
    expect(res.plans.priority.rankStability).toBeGreaterThan(0);
    expect(res.priceOfPriorities.summary).toMatch(/\$/);
  });

  it('max-profit has the highest expected GM + end value of the three', () => {
    const v = (p: PlanResult) => p.expectedGM + p.endOfHorizonValue;
    expect(v(res.plans.maxProfit)).toBeGreaterThanOrEqual(v(res.plans.priority) - 1e-6);
    expect(res.priceOfPriorities.profitCost).toBeGreaterThanOrEqual(-1e-6);
  });

  it('explains every year with labelled terms that add up to the gross margin', () => {
    const yr = res.plans.priority.paddocks[0]!.years[0]!;
    expect(yr.terms.find((t) => t.label === 'Gross margin')!.value).toBeCloseTo(yr.grossMarginPerAcre);
    const money = yr.terms.filter((t) => t.label === 'Revenue' || t.label.startsWith('Operating cost') || t.label.startsWith('N credit'));
    expect(money.reduce((a, t) => a + t.value, 0)).toBeCloseTo(yr.grossMarginPerAcre);
  });

  it('profit = 100 with the others at 0 makes the priority plan the max-profit plan', () => {
    const r = generatePlans(farm, PROFIT_ONLY, {}, weather, fast);
    expect(r.plans.priority.plan).toEqual(r.plans.maxProfit.plan);
    expect(r.priceOfPriorities.profitCost).toBeCloseTo(0);
  });

  it('gives identical results for the same seed, and different Monte Carlo for a different seed', () => {
    const a = generatePlans(farm, NEUTRAL, {}, weather, fast);
    const b = generatePlans(farm, NEUTRAL, {}, weather, fast);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = generatePlans(farm, NEUTRAL, {}, weather, { ...fast, seed: 99 });
    expect(c.plans.current.expectedGM).not.toBe(a.plans.current.expectedGM);
  });

  it('never puts unavailable crops in a recommended plan', () => {
    const avail = ['corn', 'winter-wheat', 'oats', 'fallow'];
    const f = gridFarm(2, 2, 40, { availableCrops: avail });
    const r = generatePlans(f, NEUTRAL, {}, weather, fast);
    for (const p of [r.plans.maxProfit, r.plans.priority]) {
      for (const c of cropsIn(p)) expect(avail).toContain(c);
    }
    expect(r.exclusions['p00']!.find((e) => e.cropId === 'soybeans')?.reason).toMatch(/isn't available/);
  });

  it('never recommends crops with incomplete economics (alfalfa has no sourced cost)', () => {
    for (const p of [res.plans.maxProfit, res.plans.priority]) expect(cropsIn(p).has('alfalfa')).toBe(false);
    expect(res.exclusions['p00']!.find((e) => e.cropId === 'alfalfa')?.kind).toBe('economics');
  });

  it('the market cap stops the farm going all-in on the highest-margin crop', () => {
    const f = gridFarm(2, 2, 40);
    const open = generatePlans(f, PROFIT_ONLY, {}, weather, fast);
    const allIn = open.plans.maxProfit.paddocks.every((p) => p.sequence[0] === 'dry-beans');
    expect(allIn).toBe(true); // without a market, dry beans everywhere in year 1

    // Local buyers take about one paddock's worth; the distant market barely covers freight.
    const capped = generatePlans(
      f,
      PROFIT_ONLY,
      { 'dry-beans': { localDemand: 1974 * 40, localPrice: 0.363, distantPrice: 0.363, freightPerUnit: 0.25 } },
      weather,
      fast,
    );
    for (let y = 0; y < 3; y++) {
      const n = capped.plans.maxProfit.paddocks.filter((p) => p.sequence[y] === 'dry-beans').length;
      expect(n).toBeLessThan(4);
    }
    expect(capped.plans.maxProfit.paddocks.some((p) => p.sequence.includes('dry-beans'))).toBe(true);
  });

  it('the variety penalty stops the whole farm planting one family in one year', () => {
    const f = gridFarm(2, 2, 40);
    const noRisk = generatePlans(f, PROFIT_ONLY, {}, weather, fast);
    expect(maxFamilyShare(noRisk.plans.priority)).toBe(1);
    const cautious = generatePlans(f, { profit: 100, soilHealth: 0, water: 0, risk: 100 }, {}, weather, fast);
    expect(maxFamilyShare(cautious.plans.priority)).toBeLessThan(1);
    expect(maxFamilyShare(cautious.plans.maxProfit)).toBe(1); // max-profit is never constrained by it
  });

  it('the end-of-horizon value changes the final-year choice', () => {
    // (a) Soil weight: the final year counts extra, so a high-residue crop is left behind.
    const f = gridFarm(1, 1, 80, { availableCrops: ['corn', 'soybeans', 'barley', 'winter-wheat', 'oats', 'sorghum'] });
    const pr: Priorities = { profit: 50, soilHealth: 50, water: 0, risk: 0 };
    const on = generatePlans(f, pr, {}, [], fast).plans.priority.paddocks[0]!.sequence;
    const off = generatePlans(f, pr, {}, [], { ...fast, endOfHorizon: false }).plans.priority.paddocks[0]!.sequence;
    expect(on[2]).not.toBe(off[2]);

    // (b) Profit only: N left behind. Synthetic barley price makes barley edge out soybean
    // by less than the soybean N credit (35 lb x $0.58 = $20.30/ac).
    const barley = CROP_BY_ID['barley']!;
    const soyGm = 52.3 * 10.87 - 273.92;
    const price = (soyGm + 10 + 219.09) / 75.2;
    const crops: CropTable = {
      ...CROP_BY_ID,
      barley: { ...barley, pricePerUnit: { ...barley.pricePerUnit!, value: { ...barley.pricePerUnit!.value, typical: price } } },
    };
    const g = gridFarm(1, 1, 80, { availableCrops: ['corn', 'soybeans', 'barley'], history: ['soybeans', 'corn', 'barley'] });
    const withEnd = generatePlans(g, PROFIT_ONLY, {}, [], { ...fast, crops }).plans.maxProfit.paddocks[0]!.sequence;
    const noEnd = generatePlans(g, PROFIT_ONLY, {}, [], { ...fast, crops, endOfHorizon: false }).plans.maxProfit.paddocks[0]!.sequence;
    expect(noEnd[2]).toBe('barley');
    expect(withEnd[2]).toBe('soybeans');
  });

  it('rejects southern-hemisphere farms clearly', () => {
    expect(() => generatePlans({ ...farm, latitude: -35 }, NEUTRAL, {}, weather, fast)).toThrow(/southern hemisphere/);
  });
});

describe('Monte Carlo and shade uncertainty', () => {
  // Flat prices (one price year -> no volatility) and no weather pool, so shade is the only randomness.
  const flat: CropTable = Object.fromEntries(
    Object.entries(CROP_BY_ID).map(([id, c]) => [
      id,
      c.pricePerUnit
        ? { ...c, pricePerUnit: { ...c.pricePerUnit, value: { ...c.pricePerUnit.value, byYear: { '2025': c.pricePerUnit.value.typical } } } }
        : c,
    ]),
  );
  // shadeTolerance is typed `null` in croptraits.ts until sourced; tests inject a value.
  const tolerant: CropTable = { ...flat, soybeans: { ...flat['soybeans']!, shadeTolerance: 1 as unknown as null } };

  function strips(depth: number, width: number) {
    return {
      latitude: 42,
      state: 'IA',
      paddocks: [
        paddock('south', rect(0, 0, width, depth), { history: ['soybeans', 'corn', 'soybeans'] }),
        paddock('north', rect(0, depth, width, depth), { history: ['corn', 'soybeans', 'corn'] }),
      ],
    };
  }
  const plan = planFromCrops({ south: ['corn', 'soybeans', 'corn'], north: ['soybeans', 'corn', 'soybeans'] });
  const opts = { seed: 5, mcSamples: 200 };

  it('null tolerance: nonzero expected loss and a wider P10 spread on a 0.5-acre strip than tolerance = 1', () => {
    const farm = strips(10, (0.5 * 4046.86) / 10);
    const unknown = evaluatePlan(farm, plan, NEUTRAL, {}, [], { ...opts, crops: flat });
    const known = evaluatePlan(farm, plan, NEUTRAL, {}, [], { ...opts, crops: tolerant });
    expect(unknown.expectedGM).toBeLessThan(known.expectedGM);
    expect(unknown.expectedGM - unknown.p10GM).toBeGreaterThan(known.expectedGM - known.p10GM);
    expect(unknown.informationGaps.join()).toMatch(/Shade tolerance for Soybeans is not yet sourced/);
    const north = unknown.paddocks.find((p) => p.paddockId === 'north')!;
    expect(north.years[0]!.terms.some((t) => t.label.startsWith('Shade (tolerance unknown, midpoint assumed'))).toBe(true);
  });

  it('a 40-acre square still shows under 1% shade loss', () => {
    const side = Math.sqrt(40 * 4046.86);
    const farm = strips(side, side);
    const unknown = evaluatePlan(farm, plan, NEUTRAL, {}, [], { ...opts, crops: flat });
    const known = evaluatePlan(farm, plan, NEUTRAL, {}, [], { ...opts, crops: tolerant });
    const soyRevenue = 52.3 * 10.87 * 40 * 2; // soybean years on the north paddock
    expect((known.expectedGM - unknown.expectedGM) / soyRevenue).toBeLessThan(0.01);
  });

  it('uses common random numbers: the same plan scored twice gives identical totals', () => {
    const farm = gridFarm(2, 1, 40);
    const p = planFromCrops({ p00: ['corn', 'soybeans', 'corn'], p01: ['soybeans', 'corn', 'soybeans'] });
    const a = evaluatePlan(farm, p, NEUTRAL, {}, weather, opts);
    const b = evaluatePlan(farm, p, NEUTRAL, {}, weather, opts);
    expect(a.expectedGM).toBe(b.expectedGM);
    expect(a.p10GM).toBe(b.p10GM);
  });
});

describe('evaluatePlan', () => {
  const farm = gridFarm(2, 1, 40);

  it('scores corn-on-corn and soy-on-soy below a rotation', () => {
    const rot = evaluatePlan(farm, planFromCrops({ p00: ['corn', 'soybeans', 'corn'], p01: ['corn', 'soybeans', 'corn'] }), NEUTRAL, {}, weather);
    const cc = evaluatePlan(farm, planFromCrops({ p00: ['corn', 'corn', 'corn'], p01: ['corn', 'corn', 'corn'] }), NEUTRAL, {}, weather);
    const ss = evaluatePlan(farm, planFromCrops({ p00: ['soybeans', 'soybeans', 'soybeans'], p01: ['soybeans', 'soybeans', 'soybeans'] }), NEUTRAL, {}, weather);
    expect(cc.expectedGM).toBeLessThan(rot.expectedGM);
    expect(cc.risks.join()).toMatch(/rootworm/i);
    expect(ss.risks.join()).toMatch(/cyst nematode/i);
    const ssYear2 = ss.paddocks[0]!.years[1]!.terms.find((t) => t.label === 'Soybean after soybean yield drag');
    expect(ssYear2!.value).toBeLessThan(0);
  });

  it('reports hard-rule breaks as risks and incomplete economics as gaps', () => {
    const r = evaluatePlan(
      farm,
      planFromCrops({ p00: ['sunflower', 'sunflower', 'corn'], p01: ['alfalfa', 'alfalfa', 'alfalfa'] }),
      NEUTRAL,
      {},
      weather,
    );
    expect(r.risks.join()).toMatch(/Sunflower \(oil\) can't follow Sunflower/);
    expect(r.informationGaps.join()).toMatch(/Operating cost for Alfalfa \(hay\) is not sourced/);
    expect(r.rankStability).toBeNull();
    expect(r.kind).toBe('custom');
  });

  it('throws a clear error for an incomplete plan', () => {
    expect(() => evaluatePlan(farm, planFromCrops({ p00: ['corn', 'soybeans', 'corn'] }), NEUTRAL, {}, weather)).toThrow(/no sequence for paddock/);
  });
});

describe('checkPlacement', () => {
  const farm = {
    latitude: 42,
    state: 'IA',
    paddocks: [
      paddock('south', rect(0, 0, 200, 10), { history: ['corn', 'soybeans', 'sunflower'] }),
      paddock('north', rect(0, 10, 200, 10), { history: ['corn', 'soybeans', 'corn'], land: { slopePct: 10, texture: 'sand', drainage: 'good', salinityECe: 0.5, ph: 6.5 } }),
    ],
  };
  const empty = planFromCrops({ south: ['soybeans', 'corn', 'soybeans'], north: ['soybeans', 'corn', 'soybeans'] });
  const lenses = (w: { lens: string }[]) => w.map((x) => x.lens);

  it('flags back-to-back sunflower as a severity-3 repeat', () => {
    const w = checkPlacement(farm, empty, 'south', 0, 'sunflower');
    expect(w[0]).toMatchObject({ lens: 'repeat', severity: 3 });
  });

  it('flags corn on corn (repeat + rootworm)', () => {
    const w = checkPlacement(farm, empty, 'north', 0, 'corn');
    expect(lenses(w)).toContain('repeat');
    expect(w.find((x) => x.lens === 'pest')?.reason).toMatch(/rootworm/);
  });

  it('flags fallow on a steep paddock as erosion, and a thirsty crop on sand as water', () => {
    expect(checkPlacement(farm, empty, 'north', 1, 'fallow').find((x) => x.lens === 'erosion')?.severity).toBe(3);
    expect(lenses(checkPlacement(farm, empty, 'north', 1, 'corn'))).toContain('water');
  });

  it('flags shade on the north strip when tall corn goes south of it, and not the other way', () => {
    const w = checkPlacement(farm, empty, 'south', 1, 'corn'); // year 2: south corn, north corn -> no
    expect(lenses(w)).not.toContain('shade');
    const w2 = checkPlacement(farm, empty, 'south', 0, 'corn'); // year 1: north has soybeans
    expect(w2.find((x) => x.lens === 'shade')?.reason).toMatch(/of north \(to the north\) in noon shade/);
    const w3 = checkPlacement(farm, empty, 'north', 0, 'corn'); // corn north of soybeans shades nothing on the farm
    expect(lenses(w3)).not.toContain('shade');
  });

  it('flags unavailable crops (land) and over-supply (market)', () => {
    const f = { ...farm, paddocks: farm.paddocks.map((p) => ({ ...p, availableCrops: ['corn', 'soybeans'] })) };
    expect(checkPlacement(f, empty, 'south', 0, 'cotton')[0]).toMatchObject({ lens: 'land', severity: 3 });
    const market = { soybeans: { localDemand: 10, localPrice: 10, distantPrice: 9, freightPerUnit: 1 } };
    expect(checkPlacement(farm, empty, 'south', 0, 'soybeans', { market }).find((x) => x.lens === 'market')?.severity).toBe(3);
  });

  it('is fast enough for drag-and-drop (< 5 ms)', () => {
    const big = gridFarm(4, 2, 40);
    const plan = planFromCrops(Object.fromEntries(big.paddocks.map((p) => [p.id, ['corn', 'soybeans', 'corn']])));
    checkPlacement(big, plan, 'p00', 1, 'corn'); // warm-up
    const t0 = performance.now();
    const n = 50;
    for (let i = 0; i < n; i++) checkPlacement(big, plan, 'p11', i % 3, ALL_CROPS[i % ALL_CROPS.length]!);
    expect((performance.now() - t0) / n).toBeLessThan(5);
  });
});

describe('performance', () => {
  it('8 paddocks x 14 crops: generatePlans in under 2 s', () => {
    const farm = gridFarm(4, 2, 40);
    const t0 = performance.now();
    const r = generatePlans(farm, NEUTRAL, {}, weather, { seed: 1 });
    const ms = performance.now() - t0;
    expect(r.plans.priority.paddocks).toHaveLength(8);
    expect(ms).toBeLessThan(2000);
  });
});
