/**
 * Seeded random numbers. All randomness in the algorithm flows from an Rng
 * created here, so the same seed always gives the same plans.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
}

/** mulberry32: small, fast, good enough for Monte Carlo. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Standard normal via Box-Muller. */
export function normal(rng: Rng): number {
  let u = rng.next();
  while (u <= Number.EPSILON) u = rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Mean-one log-normal multiplier: exp(sigma*Z - sigma^2/2).
 * Its expected value is 1, so prices are unbiased on average.
 */
export function lognormalMultiplier(rng: Rng, sigma: number): number {
  if (sigma <= 0) return 1;
  return Math.exp(sigma * normal(rng) - (sigma * sigma) / 2);
}

export function uniformInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng.next() * n));
}
