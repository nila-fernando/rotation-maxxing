/**
 * checkPlacement: instant feedback while the farmer drags a crop onto a
 * paddock-year in the 3D planner. No Monte Carlo, no search: just the rules,
 * so it stays well under 5 ms.
 */
import { CROP_BY_ID } from './croptraits';
import {
  EROSION_WARNING_LEVELS,
  MARKET_WARNING_EXCESS,
  SALINITY_MIN_RELATIVE_YIELD,
  SHADE_WARNING_FRACTIONS,
  WATER_HIGH_KC,
  WATER_SENSITIVE_P,
} from './constants';
import { depletionP, getCrop, isFallow, kcMid, nCreditMid, salinityRelativeYield, typicalYield } from './cropData';
import { prepareFarm } from './geometry';
import { hardRuleViolation, rotationEffect } from './rotation';
import { computeShade } from './shade';
import { DEFAULT_TILLAGE } from './soilData';
import { groundCover } from './soilHealth';
import type { CropId, CropTable, Farm, Market, Paddock, PaddockId, Plan, PreparedFarm, Warning } from './types';

export interface PlacementOptions {
  /** Needed for the 'market' lens; without it market warnings are skipped. */
  market?: Market;
  crops?: CropTable;
}

function level<T extends readonly number[]>(x: number, levels: T, strict = false): 0 | 1 | 2 | 3 {
  let s: 0 | 1 | 2 | 3 = 0;
  levels.forEach((l, i) => {
    if (strict ? x > l : x >= l) s = (i + 1) as 1 | 2 | 3;
  });
  return s;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
}

/**
 * Warnings for putting `cropId` on `paddockId` in `yearIndex` (0-based) of
 * `plan`. Other cells of the plan may be empty (main: null).
 */
export function checkPlacement(
  farm: Farm | PreparedFarm,
  plan: Plan,
  paddockId: PaddockId,
  yearIndex: number,
  cropId: CropId,
  options: PlacementOptions = {},
): Warning[] {
  const prepared = 'adjacency' in farm ? farm : prepareFarm(farm);
  const crops = options.crops ?? CROP_BY_ID;
  const paddocks = prepared.farm.paddocks;
  const paddock = paddocks.find((p) => p.id === paddockId);
  if (!paddock) throw new Error(`Unknown paddock "${paddockId}".`);
  const crop = getCrop(crops, cropId);
  const out: Warning[] = [];
  const add = (lens: Warning['lens'], severity: 0 | 1 | 2 | 3, reason: string) => {
    if (severity > 0) out.push({ lens, severity: severity as 1 | 2 | 3, reason });
  };

  /** Crop in a given plan year on a paddock, with this placement applied. */
  const cropAt = (p: Paddock, y: number): CropId | null => {
    if (p.id === paddockId && y === yearIndex) return cropId;
    return plan.sequences[p.id]?.[y]?.main ?? null;
  };
  const history = paddock.history.slice(-3);
  const planned = Array.from({ length: Math.max(yearIndex + 2, plan.sequences[paddockId]?.length ?? 0) }, (_, y) =>
    cropAt(paddock, y),
  );
  // Unknown (empty) cells become '' so rules treat them as "nothing known".
  const timeline: CropId[] = [...history, ...planned.map((c) => c ?? '')];
  const i = history.length + yearIndex;
  const prevId = timeline[i - 1] || null;
  const nextId = timeline[i + 1] || null;

  // land
  if (!paddock.availableCrops.includes(cropId)) add('land', 3, `${crop.name} seed isn't available locally for ${paddock.name}.`);
  const sal = salinityRelativeYield(crop, paddock.land.salinityECe);
  if (sal.value < 1) {
    add(
      'land',
      sal.value < SALINITY_MIN_RELATIVE_YIELD ? 3 : sal.value < 0.9 ? 2 : 1,
      `Salinity (ECe ${paddock.land.salinityECe} dS/m) cuts ${crop.name} yield to about ${pct(sal.value)} of normal.`,
    );
  }

  // repeat (hard rules here and for next year's crop, then soft repeats)
  const hard = hardRuleViolation(crops, timeline, i);
  if (hard) add('repeat', 3, hard);
  const hardNext = nextId ? hardRuleViolation(crops, timeline, i + 1) : null;
  if (hardNext) add('repeat', 3, `Next year: ${hardNext}`);
  const rot = rotationEffect(crops, paddock, timeline.slice(0, i + 1), i);
  if (!hard && prevId === cropId && cropId !== 'alfalfa' && !isFallow(crop)) {
    const drag = rot.factors.filter((f) => f.basis === 'sourced' && f.factor < 1).map((f) => 1 - f.factor)[0];
    add('repeat', 2, `${crop.name} again after ${crop.name}${drag ? `: about ${pct(drag)} yield drag` : ''}.`);
  }

  // pest
  for (const f of rot.factors) {
    if (f.basis !== 'design' || f.factor >= 1 || f.label.includes('repeat drag')) continue;
    add('pest', f.factor <= 0.9 ? 3 : f.factor <= 0.95 ? 2 : 1, `${f.label}: about ${pct(1 - f.factor)} yield loss.`);
  }
  if (cropId === 'corn' && prevId === 'corn') add('pest', 2, 'Corn rootworm: corn on corn usually needs rootworm control.');

  // nitrogen
  if (cropId === 'corn' && prevId) {
    const prev = crops[prevId];
    const credit = prev ? nCreditMid(prev) : 0;
    if (!credit) add('nitrogen', 1, `No legume before this corn: no N credit, so budget the full N rate.`);
  }
  const credit = nCreditMid(crop);
  if (credit && nextId && nextId !== 'corn' && !(cropId === 'alfalfa' && nextId === 'alfalfa')) {
    add('nitrogen', 1, `${crop.name} leaves about ${credit} lb N/ac that only counts if corn follows; next year is ${crops[nextId]?.name ?? nextId}.`);
  }

  // water
  if (paddock.land.texture === 'sand') {
    const kc = kcMid(crop);
    const p = depletionP(crop);
    if ((kc !== null && kc >= WATER_HIGH_KC) || (p !== null && p <= WATER_SENSITIVE_P)) {
      add('water', 2, `${crop.name} is thirsty or drought-sensitive (kc ${kc ?? '?'}, p ${p ?? '?'}) and ${paddock.name} is sandy.`);
    }
  }

  // erosion: slope x uncovered share
  const yieldGuess = typicalYield(crop) !== null ? typicalYield(crop)! * sal.value : null;
  const gc = groundCover(crop, yieldGuess, paddock.tillage ?? DEFAULT_TILLAGE, prepared.farm.state);
  const cover = gc.value ?? 0;
  const erosion = paddock.land.slopePct * (1 - cover);
  add(
    'erosion',
    level(erosion, EROSION_WARNING_LEVELS),
    gc.value === null
      ? `${paddock.name} has a ${paddock.land.slopePct}% slope and ${crop.name}'s residue cover isn't sourced, so we assume little cover.`
      : `${paddock.name} has a ${paddock.land.slopePct}% slope and ${crop.name} leaves about ${pct(cover)} ground cover.`,
  );

  // shade: on this paddock from the south, and from this crop onto the north neighbour
  const byId = new Map(paddocks.map((p) => [p.id, p]));
  const nbCrop = (id: PaddockId) => {
    const p = byId.get(id);
    const c = p ? cropAt(p, yearIndex) : null;
    return c ? (crops[c] ?? null) : null;
  };
  const onMe = computeShade(prepared, paddockId, crop, nbCrop);
  const s1 = level(onMe.shadedFraction, SHADE_WARNING_FRACTIONS);
  if (s1 > 0) {
    const from = onMe.contributions.map((c) => `${crops[c.fromCropId]?.name ?? c.fromCropId} on ${byId.get(c.fromPaddockId)?.name}`).join(', ');
    add('shade', s1, `${pct(onMe.shadedFraction)} of ${paddock.name} is in noon shade from ${from} to the south; the yield impact needs local checking.`);
  }
  for (const nb of prepared.adjacency[paddockId] ?? []) {
    if (nb.northEdgeM <= 0) continue;
    const north = byId.get(nb.paddockId);
    const northCrop = north ? cropAt(north, yearIndex) : null;
    if (!north || !northCrop || !crops[northCrop]) continue;
    const r = computeShade(prepared, north.id, crops[northCrop]!, nbCrop);
    const s2 = level(r.shadedFraction, SHADE_WARNING_FRACTIONS);
    if (s2 > 0) {
      add('shade', s2, `${crop.name} here would put ${pct(r.shadedFraction)} of ${north.name} (to the north) in noon shade; the yield impact needs local checking.`);
    }
  }

  // market
  const m = options.market?.[cropId];
  const y0 = typicalYield(crop);
  if (m && y0 !== null) {
    let production = 0;
    for (const p of paddocks) if (cropAt(p, yearIndex) === cropId) production += y0 * p.acres;
    const excess = production > m.localDemand ? 1 - m.localDemand / production : 0;
    add(
      'market',
      level(excess, MARKET_WARNING_EXCESS, true),
      `Planned ${crop.name.toLowerCase()} in year ${yearIndex + 1} is about ${Math.round(production).toLocaleString('en-US')} ${crop.yieldUnit}; ` +
        `local buyers take ${Math.round(m.localDemand).toLocaleString('en-US')}, so ${pct(excess)} would sell at the distant price less freight.`,
    );
  }

  return out.sort((a, b) => b.severity - a.severity);
}
