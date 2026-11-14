import { describe, expect, it } from 'vitest';
import { CROP_BY_ID } from '../croptraits';
import { prepareFarm, SQ_M_PER_ACRE } from '../geometry';
import { seasonFor, seasonMidpointDay, solarDeclinationDeg } from '../seasons';
import { computeShade } from '../shade';
import type { CropTraits, Farm } from '../types';
import { paddock, rect } from './fixtures';

const corn = CROP_BY_ID['corn']!;
const soy = CROP_BY_ID['soybeans']!;
const wheat = CROP_BY_ID['winter-wheat']!;

/** Three paddocks stacked south -> north: south, middle, north. */
function stack(widthM: number, depthM: number): Farm {
  return {
    latitude: 42,
    state: 'IA',
    paddocks: [
      paddock('south', rect(0, 0, widthM, depthM)),
      paddock('middle', rect(0, depthM, widthM, depthM)),
      paddock('north', rect(0, 2 * depthM, widthM, depthM)),
    ],
  };
}

const onlyMiddleCorn = (id: string): CropTraits | null => (id === 'middle' ? corn : soy);

describe('seasons', () => {
  it('falls back to default spans when the state has no Handbook 628 entry', () => {
    const s = seasonFor(corn, 'IA');
    expect(s.fallback).toBe(true);
    expect(s.span).toEqual({ plantMonth: 5, harvestMonth: 9 });
    expect(s.gap).toMatch(/not entered yet/);
  });

  it('uses about +20 degrees for summer crops and the winter-wheat season midpoint for wheat', () => {
    const summer = solarDeclinationDeg(seasonMidpointDay(seasonFor(corn, 'IA').span!));
    expect(summer).toBeGreaterThan(18);
    expect(summer).toBeLessThan(23.5);
    const winter = solarDeclinationDeg(seasonMidpointDay(seasonFor(wheat, 'IA').span!));
    expect(winter).toBeLessThan(summer);
  });
});

describe('shade', () => {
  it('is under 1% loss on a 40-acre square', () => {
    const side = Math.sqrt(40 * SQ_M_PER_ACRE);
    const prep = prepareFarm(stack(side, side));
    const r = computeShade(prep, 'north', soy, onlyMiddleCorn);
    expect(r.shadedFraction).toBeGreaterThan(0);
    expect(r.yieldLoss).toBeLessThan(0.01);
  });

  it('is significant on 0.5-acre east-west strips', () => {
    const depth = 10; // 10 m deep strip, ~202 m long = 0.5 ac
    const width = (0.5 * SQ_M_PER_ACRE) / depth;
    const prep = prepareFarm(stack(width, depth));
    const r = computeShade(prep, 'north', soy, onlyMiddleCorn);
    const side = Math.sqrt(40 * SQ_M_PER_ACRE);
    const big = computeShade(prepareFarm(stack(side, side)), 'north', soy, onlyMiddleCorn);
    expect(r.shadedFraction).toBeGreaterThan(0.04); // ~0.5 m shadow across a 10 m strip
    expect(r.yieldLoss).toBeGreaterThan(0.02);
    expect(r.yieldLoss).toBeGreaterThan(30 * big.yieldLoss);
  });

  it('only applies to the NORTH neighbour of the tall crop', () => {
    const prep = prepareFarm(stack(200, 10));
    expect(computeShade(prep, 'north', soy, onlyMiddleCorn).yieldLoss).toBeGreaterThan(0);
    expect(computeShade(prep, 'south', soy, onlyMiddleCorn).yieldLoss).toBe(0);
  });

  it('uses the 0.5 midpoint for unknown tolerance, and a Monte Carlo override when given', () => {
    const prep = prepareFarm(stack(200, 10));
    const det = computeShade(prep, 'north', soy, onlyMiddleCorn);
    expect(det.toleranceKnown).toBe(false);
    expect(det.yieldLoss).toBeCloseTo(det.shadedFraction * 0.5);
    expect(det.gaps.join()).toMatch(/not yet sourced/);
    const full = computeShade(prep, 'north', soy, onlyMiddleCorn, 1);
    expect(full.yieldLoss).toBe(0);
    expect(full.shadedFraction).toBeCloseTo(det.shadedFraction);
  });

  it('casts no shade between crops of the same height', () => {
    const prep = prepareFarm(stack(200, 10));
    expect(computeShade(prep, 'north', corn, () => corn).shadedFraction).toBe(0);
  });
});
