/**
 * soilHealthIndex: a COMPOSITE INDEX (0-1), not a measured soil property.
 *
 *   index = w_cover x groundCover + w_N x nitrogen + w_div x diversity + w_om x organicMatterProxy
 *
 * Weights are SOIL_INDEX_WEIGHTS in constants.ts (a design choice).
 * A component whose data is missing scores 0 and is reported as an
 * information gap: unknown never makes a crop look better.
 *
 * Also here: the water-use index (kc mid x share of the year occupied).
 */
import { BARE_MONTH_COVER_DISCOUNT, DIVERSITY_DEDUCTIONS, SOIL_INDEX_WEIGHTS } from './constants';
import { isFallow, kcMid, nCreditMid, typicalYield } from './cropData';
import { monthsOccupied, seasonFor } from './seasons';
import { ALFALFA_C_FACTOR, COVER_REFERENCE, DEFAULT_TILLAGE, RESIDUE_FACTORS, TILLAGE_RESIDUE_RETENTION } from './soilData';
import type { CropId, CropTable, CropTraits, Paddock, Term, Tillage } from './types';

export interface ComponentScore {
  value: number | null;
  term: Term | null;
  gap: string | null;
}

/** Residue produced at a given yield, lb/ac (null if no residue factor is sourced). */
export function residueLb(crop: CropTraits, yieldPerAcre: number | null): number | null {
  const f = RESIDUE_FACTORS[crop.id];
  if (!f || yieldPerAcre === null) return null;
  return yieldPerAcre * f.lbPerYieldUnit;
}

/**
 * Saturating residue -> cover curve, cover = 1 - exp(-k x residue), with k
 * fitted so it passes through the NRCS reference point for that residue type.
 */
export function residueToCover(residue: number, type: 'coarse' | 'fine'): number {
  const ref = COVER_REFERENCE[type];
  const k = -Math.log(1 - ref.coverFraction) / ref.residueLb;
  return 1 - Math.exp(-k * residue);
}

/** Ground cover / erosion protection component (0-1). */
export function groundCover(
  crop: CropTraits,
  yieldPerAcre: number | null,
  tillage: Tillage,
  state: string | undefined,
): ComponentScore & { bareMonths: number } {
  if (isFallow(crop)) {
    return { value: 0, term: term('Ground cover: fallow leaves bare soil', 0, 'sourced'), gap: null, bareMonths: 12 };
  }
  if (crop.id === 'alfalfa') {
    const v = 1 - ALFALFA_C_FACTOR.value;
    return { value: v, term: term('Ground cover: alfalfa stand (NRCS C factor 0.020)', v, 'sourced'), gap: null, bareMonths: 0 };
  }
  const season = seasonFor(crop, state);
  const bareMonths = 12 - monthsOccupied(season.span);
  const f = RESIDUE_FACTORS[crop.id];
  const residue = residueLb(crop, yieldPerAcre);
  if (!f || residue === null) {
    return {
      value: null,
      term: null,
      gap: `No sourced residue factor for ${crop.name}; its ground cover isn't scored (counts as 0).`,
      bareMonths,
    };
  }
  const retention = TILLAGE_RESIDUE_RETENTION[tillage].value;
  const cover = residueToCover(residue * retention, f.type);
  const v = cover * (1 - (BARE_MONTH_COVER_DISCOUNT * bareMonths) / 12);
  return {
    value: v,
    term: term(
      `Ground cover: ${Math.round(residue)} lb/ac residue x ${tillage} tillage retention (placeholder ${retention}), ${bareMonths} bare month(s)`,
      v,
      'placeholder',
    ),
    gap: null,
    bareMonths,
  };
}

/** Largest residue among crops at their typical yield: the organic-matter proxy's reference. */
export function residueReference(crops: CropTable): number {
  let max = 0;
  for (const c of Object.values(crops)) {
    const r = residueLb(c, typicalYield(c));
    if (r !== null && r > max) max = r;
  }
  return max || 1;
}

/** Largest N credit in the table: the nitrogen component's reference. */
export function nCreditReference(crops: CropTable): number {
  let max = 0;
  for (const c of Object.values(crops)) max = Math.max(max, nCreditMid(c) ?? 0);
  return max || 1;
}

function term(label: string, value: number, basis: Term['basis']): Term {
  return { label, value, unit: 'index 0-1', basis };
}

export interface SoilYearInput {
  crops: CropTable;
  paddock: Paddock;
  /** History + planned crops. */
  timeline: CropId[];
  /** Index into the timeline of the year being scored. */
  index: number;
  yieldPerAcre: number | null;
  state: string | undefined;
  /** Optional component overrides from a process-based yield model. */
  override?: { groundCover?: Term; organicMatter?: Term };
  refs: { residueLb: number; nCreditLb: number };
}

export interface SoilHealthResult {
  value: number;
  components: Term[];
  gaps: string[];
}

export function soilHealthIndex(input: SoilYearInput): SoilHealthResult {
  const { crops, paddock, timeline, index, yieldPerAcre, state, override, refs } = input;
  const crop = crops[timeline[index]!]!;
  const prevId = timeline[index - 1];
  const prev = prevId ? crops[prevId] : undefined;
  const W = SOIL_INDEX_WEIGHTS;
  const gaps: string[] = [];
  const components: Term[] = [];

  // (a) ground cover / erosion
  let cover: number;
  if (override?.groundCover) {
    cover = override.groundCover.value;
    components.push(override.groundCover);
  } else {
    const gc = groundCover(crop, yieldPerAcre, paddock.tillage ?? DEFAULT_TILLAGE, state);
    cover = gc.value ?? 0;
    if (gc.term) components.push(gc.term);
    if (gc.gap) gaps.push(gc.gap);
  }

  // (b) nitrogen contribution
  const n = nCreditMid(crop);
  let nScore = 0;
  if (n === null) gaps.push(`N credit from ${crop.name} is not sourced; nitrogen component counts as 0.`);
  else {
    nScore = Math.min(1, n / refs.nCreditLb);
    components.push(term(`Nitrogen left for the next crop (${n} lb N/ac)`, nScore, 'sourced'));
  }

  // (c) rotation diversity / pest break
  let diversity = 1;
  const continuingStand = crop.id === 'alfalfa' && prevId === 'alfalfa';
  if (prev && !continuingStand && !isFallow(crop)) {
    if (prev.family === crop.family) diversity -= DIVERSITY_DEDUCTIONS.sameFamily;
    if (crop.hostsPestGroups.some((g) => prev.hostsPestGroups.includes(g))) diversity -= DIVERSITY_DEDUCTIONS.sharedPestGroup;
  }
  diversity = Math.max(0, diversity);
  components.push(
    term(
      diversity === 1 ? 'Rotation diversity: breaks family and pest cycles' : 'Rotation diversity: repeats a family or pest host',
      diversity,
      'design',
    ),
  );

  // (d) organic matter, PROXY: residue returned to the soil
  let om = 0;
  if (override?.organicMatter) {
    om = override.organicMatter.value;
    components.push(override.organicMatter);
  } else if (isFallow(crop)) {
    components.push(term('Organic matter (proxy: residue): none from fallow', 0, 'proxy'));
  } else {
    const r = residueLb(crop, yieldPerAcre);
    if (r === null) gaps.push(`Organic-matter proxy for ${crop.name} needs a residue factor; counts as 0.`);
    else {
      om = Math.min(1, r / refs.residueLb);
      components.push(term(`Organic matter (proxy: ${Math.round(r)} lb/ac residue)`, om, 'proxy'));
    }
  }

  const value = W.groundCover * cover + W.nitrogen * nScore + W.diversity * diversity + W.organicMatter * om;
  return { value, components, gaps };
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/**
 * Water-use index = kc mid (FAO-56) x share of the year the crop occupies.
 * Lower is better. Fallow uses no crop water. Unknown kc gets the worst
 * (highest) value in the table so it never looks like a water saver.
 */
export function waterUseIndex(
  crops: CropTable,
  crop: CropTraits,
  state: string | undefined,
): { value: number; term: Term; gap: string | null } {
  if (isFallow(crop)) {
    return { value: 0, term: { label: 'Water use: fallow (no crop)', value: 0, unit: 'index', basis: 'sourced' }, gap: null };
  }
  const months = monthsOccupied(seasonFor(crop, state).span);
  const kc = kcMid(crop);
  if (kc === null) {
    const worst = Math.max(...Object.values(crops).map((c) => (kcMid(c) ?? 0) * (monthsOccupied(seasonFor(c, state).span) / 12)));
    return {
      value: worst,
      term: { label: `Water use: kc for ${crop.name} not sourced (worst case assumed)`, value: worst, unit: 'index', basis: 'assumption' },
      gap: `Crop water use (FAO-56 kc) for ${crop.name} is not sourced; the worst case in the table is assumed.`,
    };
  }
  const v = kc * (months / 12);
  return {
    value: v,
    term: { label: `Water use: kc ${kc} x ${months} month season`, value: v, unit: 'index', basis: 'sourced' },
    gap: null,
  };
}
