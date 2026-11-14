/**
 * Read numbers out of croptraits.ts, with null handling in ONE place.
 *
 * Rule: a null is a real data gap. Accessors return null (never a guess) and
 * the caller decides what to do: skip the term and record an information gap.
 */
import { CROP_BY_ID } from './croptraits';
import type { CropId, CropTable, CropTraits } from './types';

export const DEFAULT_CROPS: CropTable = CROP_BY_ID;

export function getCrop(crops: CropTable, id: CropId): CropTraits {
  const c = crops[id];
  if (!c) throw new Error(`Unknown crop id "${id}". Known: ${Object.keys(crops).join(', ')}`);
  return c;
}

export function typicalYield(c: CropTraits): number | null {
  return c.yieldPerAcre?.value.typical ?? null;
}

export function typicalPrice(c: CropTraits): number | null {
  return c.pricePerUnit?.value.typical ?? null;
}

export function operatingCost(c: CropTraits): number | null {
  return c.operatingCostPerAcre?.value ?? null;
}

export function heightM(c: CropTraits): number | null {
  return c.maxHeightM?.value ?? null;
}

export function kcMid(c: CropTraits): number | null {
  return c.kcMid?.value ?? null;
}

export function depletionP(c: CropTraits): number | null {
  return c.depletionFractionP?.value ?? null;
}

/** Shade tolerance 0-1. Always null in the current data; the branch is kept so a sourced value just works. */
export function shadeTolerance(c: CropTraits): number | null {
  const v: unknown = c.shadeTolerance;
  return typeof v === 'number' ? v : null;
}

/** Fallow has no crop at all: zero height, zero water use, zero residue, by definition (not a data gap). */
export function isFallow(c: CropTraits): boolean {
  return c.family === 'fallow';
}

/**
 * Midpoint of the N credit range to the following corn crop, lb N/ac.
 * Crops that aren't legumes get 0 (null there means "no credit", not a gap).
 * Returns null only for a legume/forage with no sourced credit.
 */
export function nCreditMid(c: CropTraits): number | null {
  const r = c.nCreditToNextCornLbPerAcre?.value;
  if (r) return (r.low + r.high) / 2;
  if (c.family === 'legume' || c.id === 'alfalfa') return null;
  return 0;
}

/**
 * Price volatility: sample standard deviation of ln(price) over the years in
 * pricePerUnit.byYear. Only 3 years are available, so this understates
 * long-run volatility (see DATA_GAPS). Null if fewer than 2 years.
 */
export function priceVolatility(c: CropTraits): number | null {
  const ys = c.pricePerUnit ? Object.values(c.pricePerUnit.value.byYear) : [];
  if (ys.length < 2) return null;
  const logs = ys.map((p) => Math.log(p));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const v = logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1);
  return Math.sqrt(v);
}

/**
 * Maas-Hoffman relative yield (0-1) at a given ECe.
 * Returns { value, gap } where gap explains any assumption made.
 */
export function salinityRelativeYield(c: CropTraits, ece: number): { value: number; gap: string | null } {
  if (isFallow(c)) return { value: 1, gap: null };
  const s = c.salinity?.value;
  if (!s) return { value: 1, gap: `Salinity tolerance for ${c.name} is not sourced; no salinity effect applied.` };
  if (s.thresholdECe === null || s.slopePctPerDsM === null) {
    return {
      value: 1,
      gap: `${c.name} is rated salt-${s.rating === 'T' ? 'tolerant' : s.rating} but has no published threshold; no salinity effect applied.`,
    };
  }
  if (ece <= s.thresholdECe) return { value: 1, gap: null };
  return { value: Math.max(0, 1 - (s.slopePctPerDsM / 100) * (ece - s.thresholdECe)), gap: null };
}

/**
 * Can we compute a gross margin for this crop?
 *  - complete: yield, price and cost all sourced
 *  - noRevenue: fallow / cover (no harvest): revenue is 0, cost may be unknown
 *  - incomplete: a cash crop with something missing -> not recommended
 */
export function economicsStatus(c: CropTraits): { status: 'complete' | 'noRevenue' | 'incomplete'; missing: string[] } {
  if (c.family === 'fallow' || c.family === 'cover') {
    return { status: 'noRevenue', missing: operatingCost(c) === null ? ['operating cost'] : [] };
  }
  const missing: string[] = [];
  if (typicalYield(c) === null) missing.push('yield');
  if (typicalPrice(c) === null) missing.push('price');
  if (operatingCost(c) === null) missing.push('operating cost');
  return { status: missing.length ? 'incomplete' : 'complete', missing };
}
