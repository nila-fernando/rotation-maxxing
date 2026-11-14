import { describe, expect, it } from 'vitest';
import { CROP_BY_ID } from '../croptraits';
import { prepareFarm, SQ_M_PER_ACRE } from '../geometry';
import { seasonFor, seasonMidpointDay, seasonOverlapShare, shadeSensitiveWindow, solarDeclinationDeg } from '../seasons';
import { computeShade, heightInMonth, sunElevationForCrop } from '../shade';
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
    const s = seasonFor(corn, 'NE');
    expect(s.fallback).toBe(true);
    expect(s.span).toEqual({ plantMonth: 5, harvestMonth: 9 });
    expect(s.gap).toMatch(/not entered yet/);
    expect(seasonFor(CROP_BY_ID['spring-wheat']!, 'IA').fallback).toBe(true); // no IA row in Handbook 628
  });

  it('uses Handbook 628 for IA and KS instead of the fallback (plant.activeStart -> harvest.activeEnd)', () => {
    const ia = seasonFor(corn, 'IA');
    expect(ia.fallback).toBe(false);
    expect(ia.gap).toBeNull();
    expect(ia.span).toMatchObject({ plantMonth: 4, harvestMonth: 11, plantDate: '04-25', harvestDate: '11-09', source: 'nassHandbook628' });
    expect(seasonFor(wheat, 'KS').span).toMatchObject({ plantMonth: 9, harvestMonth: 7, plantDate: '09-15' });
    // Alfalfa: cutting window only.
    expect(seasonFor(CROP_BY_ID['alfalfa']!, 'IA').span).toMatchObject({ plantMonth: 5, harvestMonth: 9, harvestDate: '09-15' });
    expect(seasonFor(CROP_BY_ID['alfalfa']!, 'IA').span!.plantDate).toBeUndefined();
  });

  it('uses about +20 degrees for summer crops', () => {
    const summer = solarDeclinationDeg(seasonMidpointDay(seasonFor(corn, 'IA').span!));
    expect(summer).toBeGreaterThan(18);
    expect(summer).toBeLessThan(23.5);
  });

  it('takes winter wheat\'s sun angle from its sensitive months (Apr-Jun), not its season midpoint', () => {
    expect(shadeSensitiveWindow(wheat, 'IA')).toEqual({ plantMonth: 4, harvestMonth: 6 });
    const decl = solarDeclinationDeg(seasonMidpointDay(shadeSensitiveWindow(wheat, 'IA')!));
    expect(decl).toBeGreaterThan(15); // mid-May, not ~ -8 deg (1 March)
    const elev = sunElevationForCrop(42, wheat, 'IA');
    expect(elev).toBeCloseTo(90 - 42 + decl, 5);
  });

  it('ramps crop height from planting to full height at mid-season', () => {
    const span = { plantMonth: 5, harvestMonth: 9 };
    expect(heightInMonth(2, span, 4)).toBe(0);
    expect(heightInMonth(2, span, 5)).toBeCloseTo(0.4);
    expect(heightInMonth(2, span, 6)).toBeCloseTo(1.2);
    expect(heightInMonth(2, span, 8)).toBe(2);
    expect(seasonOverlapShare({ plantMonth: 4, harvestMonth: 6 }, span)).toBeCloseTo(2 / 3);
    expect(seasonOverlapShare({ plantMonth: 10, harvestMonth: 3 }, span)).toBe(0);
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
    expect(r.shadedFraction).toBeGreaterThan(0.03); // ~0.36 m mean shadow across a 10 m strip
    expect(r.yieldLoss).toBeGreaterThan(0.015);
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

  it('needs overlapping seasons: corn next to winter wheat gives near-zero shade', () => {
    const prep = prepareFarm(stack(200, 10));
    const onWheat = computeShade(prep, 'north', wheat, (id) => (id === 'middle' ? corn : null));
    const onSoy = computeShade(prep, 'north', soy, (id) => (id === 'middle' ? corn : null));
    expect(onWheat.shadedFraction).toBeLessThan(0.005); // corn is still short in May-June
    expect(onSoy.shadedFraction).toBeGreaterThan(10 * onWheat.shadedFraction);
  });

  it('casts no shade between crops of the same height', () => {
    const prep = prepareFarm(stack(200, 10));
    expect(computeShade(prep, 'north', corn, () => corn).shadedFraction).toBe(0);
  });
});
