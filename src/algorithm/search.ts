/**
 * Stage 5: plan search.
 *
 * 1. Per paddock, enumerate every allowed sequence and pre-score the parts
 *    that don't depend on other paddocks (sequenceStatics).
 * 2. Reference bounds for normalisation: for each criterion, the sum over
 *    paddocks of that paddock's best and worst sequence.
 * 3. Farm-wide coordinate descent: re-optimise one paddock at a time with the
 *    others fixed, until nothing changes or the iteration cap is hit. This is
 *    where market caps, shade between neighbours and the variety penalty act.
 */
import { MAX_DESCENT_ITERATIONS } from './constants';
import { enumerateSequences } from './filters';
import { farmRevenue, sequenceStatics, type ModelContext, type SequenceStatics } from './farmModel';
import { scoreObjective, varietyExcess, type CriteriaValues, type CriteriaWeights } from './objective';
import type { CropId, Paddock, ReferenceBounds } from './types';

export interface PaddockSpace {
  index: number;
  paddock: Paddock;
  options: SequenceStatics[];
  /** prefixKeys[o][y] = crops of option o up to year y, joined (cache key). */
  prefixKeys: string[][];
}

export function buildSpaces(ctx: ModelContext, allowedByPaddock: CropId[][]): PaddockSpace[] {
  return ctx.paddocks.map((paddock, index) => {
    const seqs = enumerateSequences(ctx.crops, paddock, allowedByPaddock[index]!, ctx.horizon);
    if (seqs.length === 0) {
      throw new Error(
        `No allowed ${ctx.horizon}-year sequence for paddock "${paddock.name}". Check its available crops and land.`,
      );
    }
    const cache = new Map<string, number>();
    const options = seqs.map((s) => sequenceStatics(ctx, paddock, s, cache));
    const prefixKeys = seqs.map((s) => s.map((_, y) => s.slice(0, y + 1).join(',')));
    return { index, paddock, options, prefixKeys };
  });
}

/** Profit of a sequence on its own: local price, no demand cap, no shade. */
function standaloneProfit(ctx: ModelContext, space: PaddockSpace, o: SequenceStatics): number {
  let revenue = 0;
  o.seq.forEach((c, y) => {
    const info = ctx.prices[c];
    if (info) revenue += o.yields[y]! * space.paddock.acres * Math.max(info.localPrice, info.distantNetPrice);
  });
  return revenue - o.cost + o.nCredit + o.endValue;
}

export function referenceBounds(ctx: ModelContext, spaces: PaddockSpace[]): ReferenceBounds {
  const b: ReferenceBounds = {
    profit: { worst: 0, best: 0 },
    soilHealth: { worst: 0, best: 0 },
    water: { worst: 0, best: 0 },
  };
  for (const s of spaces) {
    const share = s.paddock.acres / ctx.totalAcres;
    let pMin = Infinity, pMax = -Infinity, sMin = Infinity, sMax = -Infinity, wMin = Infinity, wMax = -Infinity;
    for (const o of s.options) {
      const p = standaloneProfit(ctx, s, o);
      pMin = Math.min(pMin, p);
      pMax = Math.max(pMax, p);
      sMin = Math.min(sMin, o.soil);
      sMax = Math.max(sMax, o.soil);
      wMin = Math.min(wMin, o.water);
      wMax = Math.max(wMax, o.water);
    }
    b.profit.worst += pMin;
    b.profit.best += pMax;
    b.soilHealth.worst += share * sMin;
    b.soilHealth.best += share * sMax;
    // Water: lower is better, so "best" is the minimum.
    b.water.worst += share * wMax;
    b.water.best += share * wMin;
  }
  return b;
}

export interface SearchState {
  /** Chosen option index per paddock. */
  choice: number[];
}

export interface Searcher {
  spaces: PaddockSpace[];
  bounds: ReferenceBounds;
  /** Expected-value criteria for a full choice vector (shade and market included). */
  criteria(choice: number[]): CriteriaValues & { grossMargin: number; endValue: number };
  /** Coordinate descent from a start point under the given weights. */
  descend(start: number[], w: CriteriaWeights, lambda: number, maxIterations?: number): { choice: number[]; iterations: number };
  /** Per-paddock best option ignoring farm-wide effects (a good starting point). */
  standaloneStart(w: CriteriaWeights): number[];
  sequences(choice: number[]): CropId[][];
  evaluations: number;
}

export function createSearcher(ctx: ModelContext, spaces: PaddockSpace[], bounds?: ReferenceBounds): Searcher {
  const refBounds = bounds ?? referenceBounds(ctx, spaces);
  const P = spaces.length;
  const Y = ctx.horizon;
  const neighbours: number[][] = ctx.paddocks.map((p) =>
    (ctx.prepared.adjacency[p.id] ?? []).map((n) => ctx.paddockIndex.get(n.paddockId)!).filter((i) => i !== undefined),
  );
  const yieldCaches: Map<string, number>[] = spaces.map(() => new Map());
  const counter = { evaluations: 0 };

  /** Yield of paddock p in year y under `choice`, cached on (prefix, year, neighbours' crops). */
  function yieldAt(p: number, choice: number[], y: number): number {
    const o = choice[p]!;
    let key = spaces[p]!.prefixKeys[o]![y]! + '|' + y;
    for (const q of neighbours[p]!) key += '|' + spaces[q]!.options[choice[q]!]!.seq[y];
    const cache = yieldCaches[p]!;
    let v = cache.get(key);
    if (v === undefined) {
      const seq = spaces[p]!.options[o]!.seq;
      const est = ctx.model.yieldFor(spaces[p]!.paddock, seq, y, ctx.expectedWeather, {
        prepared: ctx.prepared,
        crops: ctx.crops,
        neighbourCrop: (id) => {
          const q = ctx.paddockIndex.get(id);
          return q === undefined ? null : (spaces[q]!.options[choice[q]!]!.seq[y] ?? null);
        },
        explain: false,
      });
      v = est.value ?? 0;
      cache.set(key, v);
    }
    return v;
  }

  const row = (p: number, choice: number[]): number[] => {
    const r = new Array<number>(Y);
    for (let y = 0; y < Y; y++) r[y] = yieldAt(p, choice, y);
    return r;
  };

  const sequences = (choice: number[]): CropId[][] => choice.map((o, p) => spaces[p]!.options[o]!.seq);

  function criteriaFrom(choice: number[], yields: number[][]): CriteriaValues & { grossMargin: number; endValue: number } {
    counter.evaluations++;
    const seqs = sequences(choice);
    const revenue = farmRevenue(ctx, seqs, yields);
    let cost = 0, credit = 0, endValue = 0, soil = 0, water = 0;
    const fam: Map<string, number>[] = Array.from({ length: Y }, () => new Map());
    for (let p = 0; p < P; p++) {
      const o = spaces[p]!.options[choice[p]!]!;
      const acres = spaces[p]!.paddock.acres;
      const share = acres / ctx.totalAcres;
      cost += o.cost;
      credit += o.nCredit;
      endValue += o.endValue;
      soil += share * o.soil;
      water += share * o.water;
      for (let y = 0; y < Y; y++) fam[y]!.set(o.families[y]!, (fam[y]!.get(o.families[y]!) ?? 0) + acres);
    }
    const grossMargin = revenue - cost + credit;
    return {
      profit: grossMargin + endValue,
      grossMargin,
      endValue,
      soilHealth: soil,
      water,
      varietyExcess: varietyExcess(fam, ctx.totalAcres),
    };
  }

  function descend(start: number[], w: CriteriaWeights, lambda: number, maxIterations = MAX_DESCENT_ITERATIONS) {
    const choice = start.slice();
    const yields = choice.map((_, p) => row(p, choice));
    const score = () => scoreObjective(criteriaFrom(choice, yields), refBounds, w, lambda).value;
    let iterations = 0;
    for (; iterations < maxIterations; iterations++) {
      let changed = false;
      for (let p = 0; p < P; p++) {
        const original = choice[p]!;
        let bestOpt = original;
        let bestVal = score();
        const n = spaces[p]!.options.length;
        for (let o = 0; o < n; o++) {
          if (o === original) continue;
          choice[p] = o;
          // Only this paddock and its neighbours' yields can change.
          yields[p] = row(p, choice);
          for (const q of neighbours[p]!) yields[q] = row(q, choice);
          const v = score();
          if (v > bestVal + 1e-9) {
            bestVal = v;
            bestOpt = o;
          }
        }
        choice[p] = bestOpt;
        yields[p] = row(p, choice);
        for (const q of neighbours[p]!) yields[q] = row(q, choice);
        if (bestOpt !== original) changed = true;
      }
      if (!changed) {
        iterations++;
        break;
      }
    }
    return { choice, iterations };
  }

  function standaloneStart(w: CriteriaWeights): number[] {
    const rP = refBounds.profit.best - refBounds.profit.worst || 1;
    const rS = refBounds.soilHealth.best - refBounds.soilHealth.worst || 1;
    const rW = refBounds.water.best - refBounds.water.worst || -1;
    return spaces.map((s) => {
      const share = s.paddock.acres / ctx.totalAcres;
      let best = 0;
      let bestVal = -Infinity;
      s.options.forEach((o, i) => {
        const v =
          (w.profit * standaloneProfit(ctx, s, o)) / rP + (w.soilHealth * share * o.soil) / rS + (w.water * share * o.water) / rW;
        if (v > bestVal) {
          bestVal = v;
          best = i;
        }
      });
      return best;
    });
  }

  return {
    spaces,
    bounds: refBounds,
    criteria: (choice) => criteriaFrom(choice, choice.map((_, p) => row(p, choice))),
    descend,
    standaloneStart,
    sequences,
    get evaluations() {
      return counter.evaluations;
    },
  };
}
