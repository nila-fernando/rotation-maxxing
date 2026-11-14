/**
 * Yield estimation behind an interface, so the search and Monte Carlo code
 * never care which model is used. Today: TraitYieldModel (national yield x
 * multipliers). Later: an APSIM lookup-table model.
 */
import { getCrop, isFallow, salinityRelativeYield, typicalYield } from './cropData';
import { productOf, rotationEffect, timelineOf } from './rotation';
import { computeShade, type ShadeResult } from './shade';
import type { CropId, CropTable, Factor, Paddock, PaddockId, PreparedFarm, Term, WeatherScenario } from './types';

export interface YieldContext {
  prepared: PreparedFarm;
  crops: CropTable;
  /** Crop on an ADJACENT paddock in the same year (null if unknown). Models must not look further. */
  neighbourCrop: (paddockId: PaddockId) => CropId | null;
  /** Monte Carlo draw of shade tolerance for crops whose tolerance is not sourced. */
  shadeToleranceDraw?: (cropId: CropId) => number | undefined;
  /** When false the model may return no terms (used in hot loops). */
  explain: boolean;
}

export interface YieldEstimate {
  /** Yield per acre in the crop's unit; null if the crop has no harvest or no sourced yield. */
  value: number | null;
  unit: string | null;
  terms: Term[];
  gaps: string[];
  risks: string[];
  /** Share of the paddock in shade this year (for warnings and explanations). */
  shadedFraction: number;
  /**
   * Optional soil components a process model can supply (0-1 each). If set,
   * they replace the residue-based ground cover and organic-matter proxy in
   * soilHealthIndex. TraitYieldModel leaves these unset.
   */
  soil?: { groundCover?: Term; organicMatter?: Term };
}

export interface YieldModel {
  readonly name: string;
  /**
   * Yield of sequence[yearIndex] on this paddock. Contract: the result may
   * depend only on the paddock, its history, sequence[0..yearIndex], the
   * weather year and adjacent paddocks' crops that year. The search caches
   * on exactly those inputs.
   */
  yieldFor(
    paddock: Paddock,
    sequence: CropId[],
    yearIndex: number,
    weather: WeatherScenario,
    ctx: YieldContext,
  ): YieldEstimate;
}

/** The mean weather year of a pool: each crop's average multiplier. Used for expected values. */
export function meanScenario(pool: WeatherScenario[]): WeatherScenario {
  const sums: Record<CropId, { s: number; n: number }> = {};
  for (const w of pool) {
    for (const [id, m] of Object.entries(w.multipliers)) {
      const e = (sums[id] ??= { s: 0, n: 0 });
      e.s += m;
      e.n++;
    }
  }
  const multipliers: Record<CropId, number> = {};
  for (const [id, { s, n }] of Object.entries(sums)) multipliers[id] = s / n;
  return { label: 'Mean of supplied weather years', multipliers };
}

/**
 * yield = national average x land suitability x rotation effect x (1 - shade loss) x weather multiplier
 */
export class TraitYieldModel implements YieldModel {
  readonly name = 'TraitYieldModel (national yield x multipliers)';

  yieldFor(
    paddock: Paddock,
    sequence: CropId[],
    yearIndex: number,
    weather: WeatherScenario,
    ctx: YieldContext,
  ): YieldEstimate {
    const { crops, prepared, explain } = ctx;
    const cropId = sequence[yearIndex]!;
    const crop = getCrop(crops, cropId);
    const gaps: string[] = [];
    if (isFallow(crop)) {
      const terms: Term[] = explain ? [{ label: 'Fallow: no harvest', value: 0, unit: 'per ac', basis: 'sourced' }] : [];
      return { value: 0, unit: null, terms, gaps, risks: [], shadedFraction: 0 };
    }
    const base = typicalYield(crop);
    if (base === null) {
      return { value: null, unit: crop.yieldUnit, terms: [], gaps, risks: [], shadedFraction: 0 };
    }
    const unit = `${crop.yieldUnit ?? 'unit'}/ac`;

    const factors: Factor[] = [];
    const sal = salinityRelativeYield(crop, paddock.land.salinityECe);
    if (sal.gap) gaps.push(sal.gap);
    if (sal.value < 1) {
      factors.push({ label: `Salinity (ECe ${paddock.land.salinityECe} dS/m)`, factor: sal.value, basis: 'sourced' });
    }

    const timeline = timelineOf(paddock, sequence.slice(0, yearIndex + 1));
    const rot = rotationEffect(crops, paddock, timeline, timeline.length - 1);
    factors.push(...rot.factors);
    gaps.push(...rot.gaps);

    const shade: ShadeResult = computeShade(
      prepared,
      paddock.id,
      crop,
      (id) => {
        const n = ctx.neighbourCrop(id);
        return n ? (crops[n] ?? null) : null;
      },
      ctx.shadeToleranceDraw?.(cropId),
    );
    gaps.push(...shade.gaps);
    if (shade.yieldLoss > 0) {
      factors.push({
        label: shade.toleranceKnown
          ? `Shade from the south neighbour (${pct(shade.shadedFraction)} of paddock shaded)`
          : `Shade (tolerance unknown, ${ctx.shadeToleranceDraw ? 'sampled' : 'midpoint assumed'}; ${pct(shade.shadedFraction)} shaded)`,
        factor: 1 - shade.yieldLoss,
        basis: shade.toleranceKnown ? 'sourced' : 'assumption',
      });
    }

    const w = weather.multipliers[cropId];
    if (w === undefined) gaps.push(`No weather multiplier for ${crop.name} in the supplied scenarios; using 1.`);
    const weatherFactor = w ?? 1;
    if (weatherFactor !== 1) {
      factors.push({ label: `Weather (${weather.label ?? 'scenario'})`, factor: weatherFactor, basis: 'input' });
    }

    const value = base * productOf(factors);

    const terms: Term[] = [];
    if (explain) {
      terms.push({ label: `US average ${crop.name} yield`, value: base, unit, basis: 'sourced' });
      let running = base;
      for (const f of factors) {
        if (f.factor === 1) {
          terms.push({ label: f.label, value: 0, unit, basis: f.basis });
          continue;
        }
        const next = running * f.factor;
        terms.push({ label: f.label, value: next - running, unit, basis: f.basis });
        running = next;
      }
    }
    return { value, unit: crop.yieldUnit, terms, gaps, risks: rot.risks, shadedFraction: shade.shadedFraction };
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

