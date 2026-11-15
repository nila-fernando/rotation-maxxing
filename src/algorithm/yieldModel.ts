/**
 * Yield estimation behind an interface, so the search and Monte Carlo code
 * never care which model is used. Today: TraitYieldModel (national yield x
 * multipliers). Later: an APSIM lookup-table model.
 */
import { baseYieldFor, getCrop, isFallow, salinityRelativeYield } from './cropData';
import { FREEZE_DAMAGE_FACTORS } from './croptraits';
import { FREEZE_GAP, freezeFactor } from './frost';
import { drainageCheck, phCheck } from './landSuitability';
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
  /** Monte Carlo draw (0-1) for freeze damage within its design range; midpoint if absent. */
  freezeDraw?: () => number;
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

/**
 * Wrap any yield model so each field's learned yield factor
 * (paddock.yieldCalibration, from the farmer's season reports) is applied
 * and explained. createContext() always wraps the model with this.
 */
export function withCalibration(inner: YieldModel): YieldModel {
  return {
    name: `${inner.name} + field calibration`,
    yieldFor(paddock, sequence, yearIndex, weather, ctx) {
      const est = inner.yieldFor(paddock, sequence, yearIndex, weather, ctx);
      const cal = paddock.yieldCalibration?.[sequence[yearIndex]!];
      if (!cal || est.value === null || cal.factor === 1) return est;
      const value = est.value * cal.factor;
      const terms = ctx.explain
        ? [
            ...est.terms,
            {
              label: `Your field's record: ${cal.seasons} season(s), ${cal.factor >= 1 ? '+' : ''}${((cal.factor - 1) * 100).toFixed(0)}% vs model (+/-${(cal.logSd * 100).toFixed(0)}%)`,
              value: value - est.value,
              unit: est.terms[0]?.unit ?? 'per ac',
              basis: 'input' as const,
              sources: ['farmerReport'],
            },
          ]
        : est.terms;
      return { ...est, value, terms };
    },
  };
}

function meanOf(records: Record<string, number>[]): Record<string, number> {
  const sums: Record<string, { s: number; n: number }> = {};
  for (const r of records) {
    for (const [id, m] of Object.entries(r)) {
      const e = (sums[id] ??= { s: 0, n: 0 });
      e.s += m;
      e.n++;
    }
  }
  const out: Record<string, number> = {};
  for (const [id, { s, n }] of Object.entries(sums)) out[id] = s / n;
  return out;
}

/**
 * The mean weather year of a pool: each crop's (and each field's) average
 * multiplier and water numbers. Used for every expected value.
 */
export function meanScenario(pool: WeatherScenario[]): WeatherScenario {
  const out: WeatherScenario = { label: 'Mean of supplied weather years', multipliers: meanOf(pool.map((w) => w.multipliers)) };
  const cl = pool.flatMap((w) => (w.climate ? [w.climate] : []));
  if (cl.length) {
    out.climate = {
      precipMm: cl.reduce((a, c) => a + c.precipMm, 0) / cl.length,
      et0Mm: cl.reduce((a, c) => a + c.et0Mm, 0) / cl.length,
    };
  }
  const frozen = pool.filter((w) => w.freeze !== undefined);
  if (frozen.length) {
    out.freezeRisk = {};
    const crops = [...new Set(frozen.flatMap((w) => Object.keys(w.freeze!)))];
    for (const c of crops) {
      const checked = frozen.filter((w) => c in w.freeze!);
      const hits = checked.map((w) => w.freeze![c]).filter((e): e is NonNullable<typeof e> => !!e);
      const stages = new Map<string, number>();
      for (const h of hits) stages.set(h.stage, (stages.get(h.stage) ?? 0) + 1);
      const typical = [...stages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const meanFactor = checked.reduce((a, w) => a + (w.freeze![c] ? freezeFactor(w.freeze![c]!.effect) : 1), 0) / checked.length;
      out.freezeRisk[c] = { years: hits.length, of: checked.length, typicalStage: typical, meanFactor };
    }
  }
  const rs = pool.flatMap((w) => (w.erosivityR !== undefined ? [w.erosivityR] : []));
  if (rs.length) out.erosivityR = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sources = [...new Set(pool.flatMap((w) => w.sources ?? []))];
  if (sources.length) out.sources = sources;
  const paddockIds = [...new Set(pool.flatMap((w) => Object.keys(w.byPaddock ?? {})))];
  if (paddockIds.length) {
    out.byPaddock = {};
    for (const p of paddockIds) out.byPaddock[p] = meanOf(pool.flatMap((w) => (w.byPaddock?.[p] ? [w.byPaddock[p]] : [])));
  }
  const afterIds = [...new Set(pool.flatMap((w) => Object.keys(w.byPaddockAfter ?? {})))];
  if (afterIds.length) {
    out.byPaddockAfter = {};
    for (const p of afterIds) {
      const prevs = [...new Set(pool.flatMap((w) => Object.keys(w.byPaddockAfter?.[p] ?? {})))];
      out.byPaddockAfter[p] = {};
      for (const prev of prevs) {
        out.byPaddockAfter[p][prev] = meanOf(pool.flatMap((w) => (w.byPaddockAfter?.[p]?.[prev] ? [w.byPaddockAfter[p][prev]] : [])));
      }
    }
  }
  const waterIds = [...new Set(pool.flatMap((w) => Object.keys(w.water ?? {})))];
  if (waterIds.length) {
    out.water = {};
    for (const p of waterIds) {
      const crops = [...new Set(pool.flatMap((w) => Object.keys(w.water?.[p] ?? {})))];
      out.water[p] = {};
      for (const c of crops) {
        const vals = pool.flatMap((w) => (w.water?.[p]?.[c] ? [w.water[p][c]] : []));
        const avg = (k: 'demandMm' | 'deficitMm' | 'irrigationMm' | 'etMm') => vals.reduce((a, v) => a + v[k], 0) / vals.length;
        out.water[p][c] = { demandMm: avg('demandMm'), deficitMm: avg('deficitMm'), irrigationMm: avg('irrigationMm'), etMm: avg('etMm') };
      }
    }
  }
  return out;
}

/**
 * yield = base yield (local NASS county/state, else US average) x land suitability x rotation effect x (1 - shade loss) x weather multiplier
 */
export class TraitYieldModel implements YieldModel {
  readonly name = 'TraitYieldModel (base yield x multipliers)';

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
    const baseInfo = baseYieldFor(ctx.prepared.farm, crop);
    const base = baseInfo.value;
    if (base === null) {
      return { value: null, unit: crop.yieldUnit, terms: [], gaps, risks: [], shadedFraction: 0 };
    }
    const unit = `${crop.yieldUnit ?? 'unit'}/ac`;

    const factors: Factor[] = [];
    const sal = salinityRelativeYield(crop, paddock.land.salinityECe);
    if (sal.gap) gaps.push(sal.gap);
    if (sal.value < 1) {
      factors.push({ label: `Salinity (ECe ${paddock.land.salinityECe} dS/m)`, factor: sal.value, basis: 'sourced', sources: ['fao61Salinity'] });
    }

    for (const chk of [phCheck(crop, paddock.land.ph), drainageCheck(crop, paddock)]) {
      if (chk.gap) gaps.push(chk.gap);
      if (chk.term) factors.push(chk.term);
      else if (chk.excluded) factors.push({ label: chk.reason!, factor: 0, basis: 'sourced', sources: ['faoEcocrop'] });
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
        sources: ['fao56'],
      });
    }

    const prevCrop = timeline[timeline.length - 2];
    const afterPrev = prevCrop ? weather.byPaddockAfter?.[paddock.id]?.[prevCrop]?.[cropId] : undefined;
    const w = afterPrev ?? weather.byPaddock?.[paddock.id]?.[cropId] ?? weather.multipliers[cropId];
    if (w === undefined) gaps.push(`No weather multiplier for ${crop.name} in the supplied scenarios; using 1.`);
    const weatherFactor = w ?? 1;
    if (weatherFactor !== 1) {
      factors.push({
        label: `Weather (${weather.label ?? 'scenario'}${afterPrev !== undefined ? `, soil water after ${crops[prevCrop!]?.name.toLowerCase() ?? prevCrop}` : ''})`,
        factor: weatherFactor,
        basis: 'input',
        ...(weather.sources ? { sources: weather.sources } : {}),
      });
    }

    // Spring freeze (winter wheat): a specific season's event, or the pool's average risk.
    const ev = weather.freeze?.[cropId];
    const risk = weather.freezeRisk?.[cropId];
    if (ev) {
      const f = freezeFactor(ev.effect, ctx.freezeDraw?.());
      const r = FREEZE_DAMAGE_FACTORS[ev.effect];
      factors.push({
        label: `Spring freeze at ${ev.stage} (${Math.round(ev.tminF)} F on ${ev.date.slice(5)}, injury below ${ev.thresholdF} F, K-State C646: ${ev.effect}; design range x${r.low}-${r.high})`,
        factor: f,
        basis: 'design',
        sources: ['ksuC646', 'ksuMesonetWheatGdd', 'nasaPower'],
      });
      gaps.push(FREEZE_GAP);
    } else if (risk && risk.years > 0 && ev === undefined) {
      factors.push({
        label: `Freeze risk: in ${risk.years} of ${risk.of} years, temperatures fell below the ${risk.typicalStage ?? 'stage'} threshold (K-State C646); average effect`,
        factor: risk.meanFactor,
        basis: 'design',
        sources: ['ksuC646', 'ksuMesonetWheatGdd', 'nasaPower'],
      });
      gaps.push(FREEZE_GAP);
    }

    const value = base * productOf(factors);

    const terms: Term[] = [];
    if (explain) {
      terms.push({ label: baseInfo.label, value: base, unit, basis: baseInfo.basis, sources: baseInfo.sources });
      let running = base;
      for (const f of factors) {
        if (f.factor === 1) {
          terms.push({ label: f.label, value: 0, unit, basis: f.basis, ...(f.sources ? { sources: f.sources } : {}) });
          continue;
        }
        const next = running * f.factor;
        terms.push({ label: f.label, value: next - running, unit, basis: f.basis, ...(f.sources ? { sources: f.sources } : {}) });
        running = next;
      }
    }
    return { value, unit: crop.yieldUnit, terms, gaps, risks: rot.risks, shadedFraction: shade.shadedFraction };
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

