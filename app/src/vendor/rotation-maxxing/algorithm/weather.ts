/**
 * ============================  TEST ONLY  ============================
 * SYNTHETIC weather years for tests and demos. NOT real data and not derived
 * from any dataset. Real scenarios (e.g. from NASA POWER + a crop model) are
 * passed into the API by the caller.
 * =====================================================================
 */
import { createRng, normal } from './rng';
import type { CropId, WeatherScenario } from './types';

export interface SyntheticWeatherOptions {
  /** Spread of the farm-wide year effect (log scale). Default 0.12. */
  yearSd?: number;
  /** Extra crop-specific noise (log scale). Default 0.06. */
  cropSd?: number;
}

/**
 * `n` synthetic years: one shared good/bad-year shock plus a little noise per
 * crop, so crops move together within a year (as real weather does).
 */
export function syntheticWeatherForTestsOnly(
  seed: number,
  n: number,
  cropIds: CropId[],
  options: SyntheticWeatherOptions = {},
): WeatherScenario[] {
  const rng = createRng(seed);
  const yearSd = options.yearSd ?? 0.12;
  const cropSd = options.cropSd ?? 0.06;
  const out: WeatherScenario[] = [];
  for (let i = 0; i < n; i++) {
    const shock = normal(rng) * yearSd;
    const multipliers: Record<CropId, number> = {};
    for (const id of cropIds) {
      const sd2 = yearSd * yearSd + cropSd * cropSd;
      multipliers[id] = Math.max(0.1, Math.exp(shock + normal(rng) * cropSd - sd2 / 2));
    }
    out.push({ label: `Synthetic year ${i + 1} (TEST ONLY)`, multipliers });
  }
  return out;
}
