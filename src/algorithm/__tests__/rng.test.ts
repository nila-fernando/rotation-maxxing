import { describe, expect, it } from 'vitest';
import { createRng, lognormalMultiplier, normal } from '../rng';

describe('rng', () => {
  it('is reproducible for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('gives a standard normal and a mean-one log-normal', () => {
    const rng = createRng(7);
    let s = 0;
    let s2 = 0;
    let ln = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const z = normal(rng);
      s += z;
      s2 += z * z;
      ln += lognormalMultiplier(rng, 0.2);
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
    expect(Math.abs(ln / n - 1)).toBeLessThan(0.01);
  });
});
