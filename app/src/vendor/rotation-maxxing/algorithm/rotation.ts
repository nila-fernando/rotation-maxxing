/**
 * Rotation rules: hard rules (never recommended), soft yield effects, and
 * nitrogen credits.
 *
 * A "timeline" is the paddock's history (oldest first) followed by the
 * planned years, so rules look back across the history/plan boundary.
 */
import { PEST_GROUPS, ROTATION_EFFECTS, NITROGEN_PRICE_PER_LB } from './croptraits';
import {
  ALFALFA_ESTABLISHMENT_YIELD_FACTOR,
  ALFALFA_MAX_STAND_YEARS,
  NO_BACK_TO_BACK_CROPS,
  ROTATION_RULES,
} from './constants';
import { nCreditMid } from './cropData';
import { sourceIds } from './evidence';
import type { CropId, CropTable, Factor, Paddock, Term } from './types';

/** History (last 3 years, oldest first) followed by the planned crops. */
export function timelineOf(paddock: Paddock, planned: CropId[]): CropId[] {
  return [...paddock.history.slice(-3), ...planned];
}

function hosts(crops: CropTable, cropId: CropId | undefined, group: string): boolean {
  if (!cropId) return false;
  return crops[cropId]?.hostsPestGroups.includes(group) ?? false;
}

function groupName(group: string): string {
  return (PEST_GROUPS as Record<string, { name: string }>)[group]?.name ?? group;
}

function cropName(crops: CropTable, id: CropId | undefined): string {
  return (id && crops[id]?.name) || id || 'nothing';
}

/** Consecutive years of `cropId` ending at index `i` (inclusive). */
export function runLength(timeline: CropId[], i: number, cropId: CropId): number {
  let n = 0;
  for (let j = i; j >= 0 && timeline[j] === cropId; j--) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Hard rules
// ---------------------------------------------------------------------------

/** Reason the crop at timeline[i] breaks a hard rule, or null. */
export function hardRuleViolation(crops: CropTable, timeline: CropId[], i: number): string | null {
  const crop = timeline[i];
  const prev = timeline[i - 1];
  if (!crop) return null;
  if (NO_BACK_TO_BACK_CROPS.includes(crop) && prev === crop) {
    return `${cropName(crops, crop)} can't follow ${cropName(crops, crop)}: back-to-back hosts build up white mold.`;
  }
  if (crop === 'alfalfa') {
    const run = runLength(timeline, i, 'alfalfa');
    if (run > ALFALFA_MAX_STAND_YEARS) {
      return (
        `Alfalfa would reach ${run} years; stands are capped at ${ALFALFA_MAX_STAND_YEARS}, and replanting ` +
        'alfalfa straight after alfalfa is not allowed (autotoxicity).'
      );
    }
  }
  return null;
}

/** First hard-rule violation in the planned part of the timeline, or null. */
export function sequenceViolation(crops: CropTable, paddock: Paddock, planned: CropId[]): string | null {
  const t = timelineOf(paddock, planned);
  const offset = t.length - planned.length;
  for (let y = 0; y < planned.length; y++) {
    const v = hardRuleViolation(crops, t, offset + y);
    if (v) return `Year ${y + 1}: ${v}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Soft rules: yield factors
// ---------------------------------------------------------------------------

export interface RotationEffect {
  factors: Factor[];
  /** Agronomic risks worth telling the farmer (not yield numbers). */
  risks: string[];
  gaps: string[];
}

/**
 * Yield factors for the crop at timeline[i] from what came before it.
 * Each factor is labelled so the mascot can explain it.
 */
export function rotationEffect(crops: CropTable, paddock: Paddock, timeline: CropId[], i: number): RotationEffect {
  const factors: Factor[] = [];
  const risks: string[] = [];
  const gaps: string[] = [];
  const crop = timeline[i]!;
  const prev = timeline[i - 1];
  const R = ROTATION_RULES;

  let sourcedRepeat = false;

  // Sourced: continuous corn (Seifert 2017, UNL CropWatch 2020).
  if (crop === 'corn' && prev === 'corn') {
    const yearsBefore = runLength(timeline, i - 1, 'corn');
    const cc = ROTATION_EFFECTS.continuousCornPenalty.value;
    const p = yearsBefore >= 2 ? cc.secondYearPlus : cc.firstYear;
    factors.push({
      label:
        yearsBefore >= 2
          ? `Continuous corn (year ${yearsBefore + 1} in a row) yield drag`
          : 'Corn after corn (year 2 in a row) yield drag',
      factor: 1 - p,
      basis: 'sourced',
      sources: ['seifert2017', 'unlCropWatch2020'],
    });
    risks.push('Corn rootworm: continuous corn usually needs rootworm control (corn after soybean does not).');
    sourcedRepeat = true;
  } else if (crop === 'corn' && prev === 'soybeans') {
    // The national yield already reflects mostly-rotated corn; the "boost" is
    // avoiding the continuous-corn drag, so no extra factor is applied.
    factors.push({ label: 'Corn after soybean (rotation effect: no corn-on-corn drag)', factor: 1, basis: 'sourced', sources: ['seifert2017', 'isuRotationEcon'] });
  }

  // Sourced: continuous soybean (Seifert 2017).
  if (crop === 'soybeans' && prev === 'soybeans') {
    factors.push({
      label: 'Soybean after soybean yield drag',
      factor: 1 - ROTATION_EFFECTS.continuousSoybeanPenalty.value.average,
      basis: 'sourced',
      sources: ['seifert2017'],
    });
    risks.push('Soybean on soybean builds soybean cyst nematode and white mold.');
    sourcedRepeat = true;
  }

  // Alfalfa stand: consecutive years are one stand.
  const continuingStand = crop === 'alfalfa' && prev === 'alfalfa';
  if (crop === 'alfalfa' && !continuingStand) {
    if (ALFALFA_ESTABLISHMENT_YIELD_FACTOR !== null) {
      factors.push({ label: 'Alfalfa establishment year', factor: ALFALFA_ESTABLISHMENT_YIELD_FACTOR, basis: 'design' });
    } else {
      gaps.push('Alfalfa establishment-year yield loss is not sourced; the first year is shown at full-stand yield.');
    }
  }

  // Pest and disease groups. Skipped when a sourced same-crop penalty already
  // applies (those field numbers include disease effects) and for a continuing stand.
  if (!sourcedRepeat && !continuingStand) {
    const c = crops[crop];
    for (const group of c?.hostsPestGroups ?? []) {
      if (group === 'whiteMold') {
        let hostYears = 0;
        for (let j = Math.max(0, i - R.pestWindowYears); j < i; j++) if (hosts(crops, timeline[j], group)) hostYears++;
        if (hostYears > 0) {
          const flagged = paddock.diseaseHistory?.whiteMold === true;
          const p = R.whiteMoldPerHostYear * hostYears * (flagged ? R.whiteMoldHistoryMultiplier : 1);
          factors.push({
            label: `White mold: ${hostYears} host crop year(s) in the last ${R.pestWindowYears}${flagged ? ' (paddock has white-mold history)' : ''}`,
            factor: Math.max(0, 1 - p),
            basis: 'design',
          });
          risks.push(`White mold risk: ${cropName(crops, crop)} after ${hostYears} recent host year(s).`);
        }
        continue;
      }
      if (hosts(crops, prev, group)) {
        factors.push({
          label: `${groupName(group)} carried over from ${cropName(crops, prev)} last year`,
          factor: 1 - R.pestRepeatBackToBack,
          basis: 'design',
        });
        risks.push(`${groupName(group)}: ${cropName(crops, crop)} follows another host.`);
      } else if (!R.oneYearBreakGroups.includes(group)) {
        let earlier = 0;
        for (let j = Math.max(0, i - R.pestWindowYears); j < i - 1; j++) if (hosts(crops, timeline[j], group)) earlier++;
        if (earlier > 0) {
          factors.push({
            label: `${groupName(group)}: ${earlier} host year(s) earlier in the last ${R.pestWindowYears}`,
            factor: 1 - R.pestRepeatPerEarlierHostYear * earlier,
            basis: 'design',
          });
        }
      }
    }
  }

  // Same crop again where we have no sourced penalty (cotton, wheat, sorghum...).
  if (crop === prev && !sourcedRepeat && !continuingStand && crop !== 'fallow') {
    factors.push({
      label: `${cropName(crops, crop)} after ${cropName(crops, crop)} (repeat drag, magnitude not sourced)`,
      factor: 1 - R.sameCropRepeatUnsourced,
      basis: 'design',
    });
  }

  return { factors, risks, gaps };
}

export function productOf(factors: Factor[]): number {
  return factors.reduce((a, f) => a * f.factor, 1);
}

// ---------------------------------------------------------------------------
// Nitrogen
// ---------------------------------------------------------------------------

export const DEFAULT_N_PRICE = NITROGEN_PRICE_PER_LB.value;

export interface NitrogenCredit {
  lbPerAcre: number;
  dollarsPerAcre: number;
  term: Term | null;
  gap: string | null;
}

/**
 * N credit the crop at timeline[i] receives from the previous crop. The
 * sourced credits are to FOLLOWING CORN, so only corn receives a credit;
 * other crops get none (documented gap).
 */
export function nitrogenCreditReceived(
  crops: CropTable,
  timeline: CropId[],
  i: number,
  nPricePerLb: number,
): NitrogenCredit {
  const crop = timeline[i];
  const prev = timeline[i - 1];
  const none: NitrogenCredit = { lbPerAcre: 0, dollarsPerAcre: 0, term: null, gap: null };
  if (crop !== 'corn' || !prev) return none;
  const pc = crops[prev];
  if (!pc) return none;
  const lb = nCreditMid(pc);
  if (lb === null) return { ...none, gap: `N credit from ${pc.name} to corn is not sourced.` };
  if (lb === 0) return none;
  const dollars = lb * nPricePerLb;
  return {
    lbPerAcre: lb,
    dollarsPerAcre: dollars,
    term: {
      label: `N credit from ${pc.name} (${lb} lb N/ac x $${nPricePerLb.toFixed(2)}/lb)`,
      value: dollars,
      unit: '$/ac',
      basis: 'sourced',
      sources: sourceIds(pc.nCreditToNextCornLbPerAcre?.source).concat('ndsuBudgets2026'),
    },
    gap: null,
  };
}

/** N the final crop leaves for a following corn crop, $/ac (end-of-horizon value). */
export function nitrogenLeftBehind(crops: CropTable, lastCrop: CropId, nPricePerLb: number): { lb: number; dollars: number } {
  const c = crops[lastCrop];
  const lb = c ? (nCreditMid(c) ?? 0) : 0;
  return { lb, dollars: lb * nPricePerLb };
}
