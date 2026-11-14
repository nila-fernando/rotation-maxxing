import { describe, expect, it } from 'vitest';
import { CROP_BY_ID } from '../croptraits';
import { enumerateSequences, screenCrops } from '../filters';
import { nitrogenCreditReceived, productOf, rotationEffect, sequenceViolation, timelineOf } from '../rotation';
import { land, paddock, rect } from './fixtures';

const crops = CROP_BY_ID;
const pad = (history: string[], over = {}) => paddock('a', rect(0, 0, 100, 100), { history, ...over });

function yieldFactor(history: string[], crop: string, over = {}): number {
  const p = pad(history, over);
  const t = timelineOf(p, [crop]);
  return productOf(rotationEffect(crops, p, t, t.length - 1).factors);
}

describe('soft rotation rules', () => {
  it('penalises corn on corn (2% first year, 5.5% after) but not corn after soybean', () => {
    expect(yieldFactor(['soybeans', 'corn', 'soybeans'], 'corn')).toBe(1);
    expect(yieldFactor(['soybeans', 'soybeans', 'corn'], 'corn')).toBeCloseTo(0.98);
    expect(yieldFactor(['soybeans', 'corn', 'corn'], 'corn')).toBeCloseTo(0.945);
  });

  it('penalises soy on soy by 10.3%', () => {
    expect(yieldFactor(['corn', 'corn', 'soybeans'], 'soybeans')).toBeCloseTo(0.897);
    expect(yieldFactor(['corn', 'soybeans', 'corn'], 'soybeans')).toBeLessThan(1); // white mold host 2 yrs ago
  });

  it('scales white mold by host years and doubles it with a white-mold history flag', () => {
    const one = yieldFactor(['corn', 'corn', 'soybeans'], 'sunflower');
    const two = yieldFactor(['corn', 'canola', 'soybeans'], 'sunflower');
    const flagged = yieldFactor(['corn', 'corn', 'soybeans'], 'sunflower', { diseaseHistory: { whiteMold: true } });
    expect(one).toBeLessThan(1);
    expect(two).toBeLessThan(one);
    expect(1 - flagged).toBeCloseTo(2 * (1 - one));
  });

  it('treats continuous cotton as a soft repeat, not a hard rule', () => {
    expect(yieldFactor(['corn', 'cotton', 'cotton'], 'cotton')).toBeLessThan(1);
    expect(sequenceViolation(crops, pad(['cotton', 'cotton', 'cotton']), ['cotton', 'cotton', 'cotton'])).toBeNull();
  });

  it('wheat after soybean is fine, and small grains break the soy pest cycle', () => {
    expect(yieldFactor(['corn', 'corn', 'soybeans'], 'winter-wheat')).toBe(1);
    const afterBreak = yieldFactor(['soybeans', 'winter-wheat', 'oats'], 'soybeans');
    const afterSoy = yieldFactor(['winter-wheat', 'oats', 'soybeans'], 'soybeans');
    expect(afterBreak).toBeGreaterThan(afterSoy);
    expect(yieldFactor(['oats', 'winter-wheat', 'oats'], 'soybeans')).toBe(1);
  });
});

describe('hard rotation rules', () => {
  it('bans back-to-back sunflower, canola and dry beans, including across history', () => {
    for (const c of ['sunflower', 'canola', 'dry-beans']) {
      expect(sequenceViolation(crops, pad(['corn', 'corn', 'corn']), [c, c, 'corn'])).toMatch(/can't follow/);
      expect(sequenceViolation(crops, pad(['corn', 'corn', c]), [c, 'corn', 'corn'])).toMatch(/Year 1/);
    }
  });

  it('caps alfalfa stands and bans replanting alfalfa straight after alfalfa', () => {
    expect(sequenceViolation(crops, pad(['corn', 'alfalfa', 'alfalfa']), ['alfalfa', 'alfalfa', 'corn'])).toBeNull();
    expect(sequenceViolation(crops, pad(['alfalfa', 'alfalfa', 'alfalfa']), ['alfalfa', 'alfalfa', 'corn'])).toMatch(
      /autotoxicity/,
    );
  });

  it('enumerates only sequences that pass the hard rules', () => {
    const p = pad(['corn', 'soybeans', 'sunflower']);
    const seqs = enumerateSequences(crops, p, ['corn', 'sunflower', 'soybeans'], 3);
    expect(seqs.length).toBeGreaterThan(0);
    expect(seqs.every((s) => s[0] !== 'sunflower')).toBe(true);
    expect(seqs.every((s) => !(s[1] === 'sunflower' && s[2] === 'sunflower'))).toBe(true);
  });
});

describe('nitrogen credits', () => {
  it('credits corn after soybean and alfalfa, valued at the N price', () => {
    const afterSoy = nitrogenCreditReceived(crops, ['soybeans', 'corn'], 1, 0.58);
    expect(afterSoy.lbPerAcre).toBe(35);
    expect(afterSoy.dollarsPerAcre).toBeCloseTo(35 * 0.58);
    expect(nitrogenCreditReceived(crops, ['alfalfa', 'corn'], 1, 0.58).lbPerAcre).toBe(145);
    expect(nitrogenCreditReceived(crops, ['corn', 'corn'], 1, 0.58).lbPerAcre).toBe(0);
    expect(nitrogenCreditReceived(crops, ['soybeans', 'winter-wheat'], 1, 0.58).lbPerAcre).toBe(0);
  });
});

describe('stage 1 filters', () => {
  it('excludes unavailable crops with a reason', () => {
    const p = pad(['corn', 'soybeans', 'corn'], { availableCrops: ['corn', 'soybeans'] });
    const s = screenCrops(crops, p);
    expect(s.allowed.sort()).toEqual(['corn', 'soybeans']);
    expect(s.exclusions.find((e) => e.cropId === 'cotton')?.reason).toMatch(/isn't available/);
  });

  it('excludes crops that are too salt-sensitive', () => {
    const p = pad(['corn', 'soybeans', 'corn'], { land: land({ salinityECe: 6 }) });
    const s = screenCrops(crops, p, true, ['dry-beans']);
    expect(s.allowed).not.toContain('dry-beans');
    expect(s.allowed).toContain('barley');
    expect(s.exclusions.find((e) => e.cropId === 'dry-beans')?.kind).toBe('land');
  });

  it('gates dry beans, sunflower and canola on a confirmed buyer (recommendations only)', () => {
    const p = pad(['corn', 'soybeans', 'corn']);
    const none = screenCrops(crops, p);
    for (const c of ['dry-beans', 'sunflower', 'canola']) {
      expect(none.allowed).not.toContain(c);
      const e = none.exclusions.find((x) => x.cropId === c)!;
      expect(e.kind).toBe('buyer');
      expect(e.reason).toMatch(/^Needs a confirmed buyer/);
    }
    const withBuyer = screenCrops(crops, p, true, ['sunflower']);
    expect(withBuyer.allowed).toContain('sunflower');
    expect(withBuyer.allowed).not.toContain('canola');
    expect(screenCrops(crops, p, false).allowed).toContain('dry-beans'); // farmer's own plan
  });

  it('excludes crops that need equipment the farmer lacks, in recommendations and own plans', () => {
    const p = pad(['corn', 'soybeans', 'corn']);
    for (const rec of [true, false]) {
      const s = screenCrops(crops, p, rec, [], ['cottonPicker']);
      expect(s.allowed).not.toContain('cotton');
      expect(s.exclusions.find((e) => e.cropId === 'cotton')).toMatchObject({ kind: 'equipment' });
      expect(s.exclusions.find((e) => e.cropId === 'cotton')!.reason).toMatch(/cotton picker/);
    }
    expect(screenCrops(crops, p, true, [], []).allowed).toContain('cotton');
  });

  it('excludes crops with incomplete economics from recommendations only', () => {
    const p = pad(['corn', 'soybeans', 'corn']);
    expect(screenCrops(crops, p).exclusions.find((e) => e.cropId === 'alfalfa')?.kind).toBe('economics');
    expect(screenCrops(crops, p, false).allowed).toContain('alfalfa');
    expect(screenCrops(crops, p).allowed).toContain('fallow');
  });
});
