import { describe, expect, it } from 'vitest';
import { dayOfYear, et0PenmanMonteith, extraterrestrialRadiation } from '../et0';

describe('FAO-56 Penman-Monteith ET0', () => {
  it('reproduces FAO-56 Example 18 (Brussels, 6 July: ET0 about 3.9 mm/day)', () => {
    // Inputs as given in the example: lat 50 deg 48 min N, 100 m, Tmax 21.5, Tmin 12.3,
    // ea 1.409 kPa, u2 2.078 m/s, Rs 22.07 MJ m-2 day-1, J = 187.
    const r = et0PenmanMonteith({ tmaxC: 21.5, tminC: 12.3, eaKPa: 1.409, solarMJ: 22.07, wind2m: 2.078, latDeg: 50.8, elevationM: 100, dayOfYear: 187 });
    expect(r.ra).toBeCloseTo(41.09, 0);
    expect(r.rnl).toBeCloseTo(3.71, 1);
    expect(r.netRadiation).toBeCloseTo(13.28, 1);
    expect(r.et0Mm).toBeCloseTo(3.9, 1);
  });

  it('gives FAO-56 Example 8 extraterrestrial radiation (20 S, 3 Sept: 32.2 MJ)', () => {
    expect(extraterrestrialRadiation(-20, 246)).toBeCloseTo(32.2, 1);
  });

  it('computes day of year', () => {
    expect(dayOfYear('2024-01-01')).toBe(1);
    expect(dayOfYear('2023-07-06')).toBe(187);
    expect(dayOfYear('2024-12-31')).toBe(366);
  });
});
