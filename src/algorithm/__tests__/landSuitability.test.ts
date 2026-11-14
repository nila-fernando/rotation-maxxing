import { describe, expect, it } from 'vitest';
import { CROP_BY_ID } from '../croptraits';
import { screenCrops } from '../filters';
import { checkPlacement } from '../placement';
import { planFromCrops } from '../plans';
import { drainageCheck, effectiveDrainage, phCheck, phPlateau } from '../landSuitability';
import { TraitYieldModel } from '../yieldModel';
import { prepareFarm } from '../geometry';
import { land, paddock, rect } from './fixtures';

const corn = CROP_BY_ID['corn']!; // EcoCrop pH 5.0 / 5.5-7.0 / 8.0; drainage W only
const pad = (over = {}) => paddock('a', rect(0, 0, 100, 100), { history: ['soybeans', 'corn', 'soybeans'], ...over });

describe('pH plateau curve (FAO EcoCrop)', () => {
  const p = { min: 5.0, optMin: 5.5, optMax: 7.0, max: 8.0 };
  it('is 1 on the plateau, linear on the shoulders, 0 outside min..max', () => {
    expect(phPlateau(p, 6.2)).toBe(1);
    expect(phPlateau(p, 5.5)).toBe(1);
    expect(phPlateau(p, 5.25)).toBeCloseTo(0.5);
    expect(phPlateau(p, 7.5)).toBeCloseTo(0.5);
    expect(phPlateau(p, 4.9)).toBe(0);
    expect(phPlateau(p, 8.1)).toBe(0);
  });

  it('is a soft yield multiplier inside min..max and a hard exclusion outside', () => {
    expect(phCheck(corn, 7.5)).toMatchObject({ factor: 0.5, excluded: false });
    expect(phCheck(corn, 7.5).term!.sources).toContain('faoEcocrop');
    expect(phCheck(corn, 7.5).term!.label).toMatch(/expert opinion/);
    expect(phCheck(corn, 8.3).excluded).toBe(true);
    const s = screenCrops(CROP_BY_ID, pad({ land: land({ ph: 8.3 }) }));
    expect(s.allowed).not.toContain('corn');
    expect(s.exclusions.find((e) => e.cropId === 'corn')).toMatchObject({ kind: 'land' });
    expect(s.allowed).toContain('soybeans'); // soybean max 8.4
  });

  it('skips unknown paddock pH with a gap', () => {
    const r = phCheck(corn, null);
    expect(r).toMatchObject({ factor: 1, excluded: false });
    expect(r.gap).toMatch(/pH is unknown/);
  });

  it('applies the pH factor to yield', () => {
    const p = pad({ land: land({ ph: 7.5 }) });
    const farm = { latitude: 42, state: 'IA', paddocks: [p] };
    const ctx = { prepared: prepareFarm(farm), crops: CROP_BY_ID, neighbourCrop: () => null, explain: true };
    const y = new TraitYieldModel().yieldFor(p, ['corn'], 0, { multipliers: {} }, ctx);
    expect(y.value).toBeCloseTo(180.7 * 0.5);
  });
});

describe('drainage (FAO EcoCrop) and tile drainage', () => {
  it('excludes corn on poorly drained ground unless tiled', () => {
    expect(drainageCheck(corn, pad({ land: land({ drainage: 'poor' }) })).excluded).toBe(true);
    expect(drainageCheck(corn, pad({ land: land({ drainage: 'poor' }), tileDrained: true })).excluded).toBe(false);
    const s = screenCrops(CROP_BY_ID, pad({ land: land({ drainage: 'poor' }) }));
    expect(s.exclusions.find((e) => e.cropId === 'corn')!.reason).toMatch(/Tile drainage would count/);
    expect(s.allowed).toContain('soybeans'); // tolerates I
    expect(screenCrops(CROP_BY_ID, pad({ land: land({ drainage: 'poor' }), tileDrained: true })).allowed).toContain('corn');
  });

  it('counts tile drainage as one class better', () => {
    expect(effectiveDrainage('poor', true)).toBe('moderate');
    expect(effectiveDrainage('moderate', true)).toBe('good');
    expect(effectiveDrainage('poor', false)).toBe('poor');
  });

  it('applies a soft penalty when tolerated but not optimal', () => {
    const r = drainageCheck(CROP_BY_ID['soybeans']!, pad({ land: land({ drainage: 'poor' }) }));
    expect(r.excluded).toBe(false);
    expect(r.factor).toBeLessThan(1);
    expect(r.term!.basis).toBe('design');
  });
});

describe('state presence (Handbook 628)', () => {
  it('warns (severity 1, land) for a crop that is not usual in the state, without excluding it', () => {
    const farm = { latitude: 42, state: 'IA', paddocks: [pad()] };
    const plan = planFromCrops({ a: ['corn', 'soybeans', 'corn'] });
    const w = checkPlacement(farm, plan, 'a', 1, 'sorghum');
    expect(w.find((x) => x.lens === 'land' && x.severity === 1)!.reason).toMatch(/isn't a usual crop in Iowa/);
    expect(checkPlacement(farm, plan, 'a', 1, 'oats').some((x) => /usual crop/.test(x.reason))).toBe(false);
    expect(screenCrops(CROP_BY_ID, pad()).allowed).toContain('sorghum');
  });
});
