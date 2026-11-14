import { describe, expect, it } from 'vitest';
import { CROP_BY_ID } from '../croptraits';
import { economicsStatus, kcMid, operatingCost, typicalYield } from '../cropData';
import { prepareFarm } from '../geometry';
import { sell } from '../market';
import { groundCover, nCreditReference, residueReference, residueToCover, soilHealthIndex, waterUseIndex } from '../soilHealth';
import { meanScenario, TraitYieldModel, type YieldContext } from '../yieldModel';
import type { Farm } from '../types';
import { land, paddock, rect } from './fixtures';

const crops = CROP_BY_ID;

function ctxFor(farm: Farm, neighbour: Record<string, string> = {}): YieldContext {
  return { prepared: prepareFarm(farm), crops, neighbourCrop: (id) => neighbour[id] ?? null, explain: true };
}

describe('TraitYieldModel', () => {
  const farm: Farm = { latitude: 42, state: 'IA', paddocks: [paddock('a', rect(0, 0, 400, 400))] };
  const model = new TraitYieldModel();
  const avg = { multipliers: {} };

  it('starts from the national yield and explains every step', () => {
    const p = farm.paddocks[0]!;
    const r = model.yieldFor({ ...p, history: ['corn', 'corn', 'corn'] }, ['corn'], 0, { label: 'dry', multipliers: { corn: 0.8 } }, ctxFor(farm));
    expect(r.value).toBeCloseTo(180.7 * 0.945 * 0.8);
    expect(r.terms[0]!.label).toMatch(/US average/);
    const sum = r.terms.reduce((a, t) => a + t.value, 0);
    expect(sum).toBeCloseTo(r.value!);
  });

  it('applies salinity as land suitability', () => {
    const p = { ...farm.paddocks[0]!, history: ['corn', 'corn', 'soybeans'], land: land({ salinityECe: 3.7 }) };
    const r = model.yieldFor(p, ['corn'], 0, avg, ctxFor(farm));
    expect(r.value).toBeCloseTo(180.7 * (1 - 0.12 * 2.0)); // threshold 1.7, slope 12%/dS/m
  });

  it('returns null yield (not a guess) for crops without a sourced yield', () => {
    const r = model.yieldFor(farm.paddocks[0]!, ['cereal-rye'], 0, avg, ctxFor(farm));
    expect(r.value).toBeNull();
  });

  it('averages weather pools per crop', () => {
    const m = meanScenario([{ multipliers: { corn: 0.8 } }, { multipliers: { corn: 1.2, soybeans: 1 } }]);
    expect(m.multipliers['corn']).toBeCloseTo(1);
    expect(m.multipliers['soybeans']).toBe(1);
  });
});

describe('soilHealthIndex', () => {
  const p = paddock('a', rect(0, 0, 100, 100), { history: ['soybeans', 'corn', 'soybeans'] });
  const refs = { residueLb: residueReference(crops), nCreditLb: nCreditReference(crops) };

  it('fits the cover curve through the NRCS reference points', () => {
    expect(residueToCover(2600, 'coarse')).toBeCloseTo(0.6);
    expect(residueToCover(1500, 'fine')).toBeCloseTo(0.6);
  });

  it('gives more cover with less tillage, full cover for alfalfa, none for fallow', () => {
    const corn = crops['corn']!;
    const conv = groundCover(corn, 180, 'conventional', 'IA').value!;
    const nt = groundCover(corn, 180, 'noTill', 'IA').value!;
    expect(nt).toBeGreaterThan(conv);
    expect(groundCover(crops['alfalfa']!, 3.4, 'reduced', 'IA').value).toBeCloseTo(0.98);
    expect(groundCover(crops['fallow']!, null, 'reduced', 'IA').value).toBe(0);
  });

  it('records a gap (and scores 0) where no residue factor is sourced, rather than borrowing one', () => {
    const g = groundCover(crops['canola']!, 1800, 'reduced', 'IA');
    expect(g.value).toBeNull();
    expect(g.gap).toMatch(/residue factor/);
  });

  it('scores corn after soybean above fallow', () => {
    const t = ['soybeans', 'corn', 'soybeans', 'corn'];
    const corn = soilHealthIndex({ crops, paddock: p, timeline: t, index: 3, yieldPerAcre: 180, state: 'IA', refs });
    const fallow = soilHealthIndex({ crops, paddock: p, timeline: ['soybeans', 'corn', 'soybeans', 'fallow'], index: 3, yieldPerAcre: null, state: 'IA', refs });
    expect(corn.value).toBeGreaterThan(fallow.value);
    expect(corn.value).toBeLessThanOrEqual(1);
    expect(corn.components.some((c) => c.basis === 'proxy')).toBe(true);
  });

  it('lets a process model override cover and organic matter through terms', () => {
    const t = ['soybeans', 'corn', 'soybeans', 'canola'];
    const base = soilHealthIndex({ crops, paddock: p, timeline: t, index: 3, yieldPerAcre: 1800, state: 'IA', refs });
    const over = soilHealthIndex({
      crops, paddock: p, timeline: t, index: 3, yieldPerAcre: 1800, state: 'IA', refs,
      override: {
        groundCover: { label: 'APSIM cover', value: 0.7, unit: 'index 0-1', basis: 'input' },
        organicMatter: { label: 'APSIM SOC', value: 0.5, unit: 'index 0-1', basis: 'input' },
      },
    });
    expect(over.value).toBeGreaterThan(base.value);
    expect(over.gaps.join()).not.toMatch(/residue factor/);
  });
});

describe('water use index', () => {
  it('uses kc x season months; fallow uses none; unknown kc is worst case', () => {
    const corn = waterUseIndex(crops, crops['corn']!, 'IA');
    expect(corn.value).toBeCloseTo(1.2 * (8 / 12)); // Handbook 628 IA: Apr-Nov
    const fallow = waterUseIndex(crops, crops['fallow']!, 'IA');
    expect(fallow.value).toBeCloseTo(0.15 * (5 / 12)); // FAO-56 dry bare-soil minimum, lower bound
    expect(fallow.gap).toMatch(/needs daily weather/);
    const rye = waterUseIndex(crops, crops['cereal-rye']!, 'IA');
    expect(rye.gap).toMatch(/not sourced/);
    expect(rye.value).toBeGreaterThanOrEqual(corn.value);
  });
});

describe('fallow is known values, not missing data', () => {
  it('scores fallow as the BEST water user of every crop (without daily weather: the dry bare-soil minimum)', () => {
    const fallow = waterUseIndex(crops, crops['fallow']!, 'IA');
    expect(fallow.value).toBeGreaterThan(0);
    for (const c of Object.values(crops)) {
      if (c.id !== 'fallow') expect(waterUseIndex(crops, c, 'IA').value).toBeGreaterThan(fallow.value);
    }
  });

  it('has zero yield, zero operating cost and zero kc', () => {
    const f = crops['fallow']!;
    expect(typicalYield(f)).toBe(0);
    expect(operatingCost(f)).toBe(0);
    expect(kcMid(f)).toBe(0);
    expect(economicsStatus(f)).toEqual({ status: 'noRevenue', missing: [] });
  });
});

describe('market', () => {
  it('sells up to local demand locally, the rest at distant price minus freight', () => {
    const info = { localPrice: 5, distantNetPrice: 4, localDemand: 100, fromMarket: true };
    expect(sell(info, 50).revenue).toBe(250);
    const r = sell(info, 150);
    expect(r.revenue).toBe(500 + 200);
    expect(r.effectivePrice).toBeCloseTo(700 / 150);
    expect(sell(info, 150, 2).revenue).toBe(1400);
  });
});
