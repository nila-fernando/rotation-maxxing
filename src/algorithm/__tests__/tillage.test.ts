import { describe, expect, it } from 'vitest';
import { generatePlans } from '../api';
import { CROP_BY_ID } from '../croptraits';
import { tillageRetention } from '../croptraits';
import { residueRetention } from '../soilData';
import { groundCover } from '../soilHealth';
import { syntheticWeatherForTestsOnly } from '../weather';
import { ALL_CROPS, gridFarm, NEUTRAL } from './fixtures';

describe('tillage residue retention (NRCS VA Tech Note Table 2)', () => {
  it('multiplies per-operation retention and applies over-winter decomposition to every system', () => {
    expect(tillageRetention('noTill', false)).toBeCloseTo(0.9);
    expect(tillageRetention('reduced', false)).toBeCloseTo(0.7 * 0.75);
    const nt = residueRetention('corn', 'noTill');
    expect(nt.value).toBeCloseTo(0.9 * 0.875);
    expect(nt.low).toBeCloseTo(0.85 * 0.8);
    expect(nt.high).toBeCloseTo(0.95 * 0.95);
    expect(residueRetention('corn', 'conventional').value).toBeLessThan(0.05);
  });

  it('fragile residue (soybean) keeps less; unknown fragility counts as fragile', () => {
    expect(residueRetention('soybeans', 'reduced').value).toBeLessThan(residueRetention('corn', 'reduced').value);
    expect(residueRetention('soybeans', 'reduced').fragile).toBe(true);
    expect(residueRetention('some-new-crop', 'noTill')).toMatchObject({ fragile: true, fragilityBasis: 'assumption' });
  });

  it('scores barley and oats cover now that their residue factors are sourced', () => {
    expect(groundCover(CROP_BY_ID['barley']!, 75, 'noTill', 'KS').value).toBeGreaterThan(0);
    expect(groundCover(CROP_BY_ID['oats']!, 73, 'noTill', 'IA').value).toBeGreaterThan(0);
    expect(groundCover(CROP_BY_ID['canola']!, 1800, 'noTill', 'IA').value).toBeNull();
  });

  it('reports a soil-health range from the low/high retention values', () => {
    const r = generatePlans(gridFarm(2, 1, 40), NEUTRAL, {}, syntheticWeatherForTestsOnly(1, 10, ALL_CROPS), { seed: 1, mcSamples: 30, rankJitterSamples: 10 });
    const p = r.plans.priority;
    expect(p.soilHealthRange.p10).toBeLessThanOrEqual(p.soilHealth + 1e-9);
    expect(p.soilHealthRange.p90).toBeGreaterThanOrEqual(p.soilHealthRange.p10);
  });
});
