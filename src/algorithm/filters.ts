/**
 * Stage 1: hard filters. Decide which crops can go on a paddock at all, and
 * which 3-year sequences are allowed. Every exclusion gets a plain-English
 * reason: these are the mascot's "why not X?" answers.
 */
import { EQUIPMENT_NAMES, EQUIPMENT_NEEDED, SALINITY_MIN_RELATIVE_YIELD } from './constants';
import { economicsStatus, salinityRelativeYield } from './cropData';
import { hardRuleViolation, sequenceViolation, timelineOf } from './rotation';
import type { CropId, CropTable, EquipmentId, Exclusion, Paddock } from './types';

export interface CropScreen {
  allowed: CropId[];
  exclusions: Exclusion[];
  gaps: string[];
}

/** Land checks we would like to run but can't until the traits are sourced. */
export const UNSOURCED_LAND_CHECKS =
  'pH, drainage/waterlogging, frost and slope suitability are not sourced for any crop yet, so only salinity is checked.';

/** The "why not X?" text for the contract-market gate (requiresBuyer is a design decision). */
export function needsBuyerReason(cropName: string): string {
  return `Needs a confirmed buyer: ${cropName} is a specialty crop with thin local markets, so we only recommend it when you've marked a buyer or contract for it.`;
}

/**
 * Screen every crop the farmer listed for this paddock.
 * @param forRecommendation if true, crops whose gross margin can't be computed, and
 *   requiresBuyer crops without a confirmed buyer, are excluded too.
 * @param confirmedBuyers crops the farmer has a buyer/contract for (Farm.confirmedBuyers).
 */
/** Equipment the crop needs that the farmer lacks (empty if none). */
export function missingEquipmentFor(cropId: CropId, missing: readonly EquipmentId[] = []): EquipmentId[] {
  return (EQUIPMENT_NEEDED[cropId] ?? []).filter((e) => missing.includes(e));
}

export function equipmentReason(cropName: string, missing: EquipmentId[]): string {
  return `${cropName} needs ${missing.map((e) => EQUIPMENT_NAMES[e]).join(' and ')}, which you've said you don't have.`;
}

export function screenCrops(
  crops: CropTable,
  paddock: Paddock,
  forRecommendation = true,
  confirmedBuyers: readonly CropId[] = [],
  missingEquipment: readonly EquipmentId[] = [],
): CropScreen {
  const allowed: CropId[] = [];
  const exclusions: Exclusion[] = [];
  const gaps = new Set<string>([UNSOURCED_LAND_CHECKS]);
  const available = new Set(paddock.availableCrops);
  const buyers = new Set(confirmedBuyers);

  for (const id of Object.keys(crops)) {
    const c = crops[id]!;
    if (!available.has(id)) {
      exclusions.push({ cropId: id, kind: 'availability', reason: `${c.name} seed isn't available locally for ${paddock.name}.` });
      continue;
    }
    const noKit = missingEquipmentFor(id, missingEquipment);
    if (noKit.length > 0) {
      exclusions.push({ cropId: id, kind: 'equipment', reason: equipmentReason(c.name, noKit) });
      continue;
    }
    if (forRecommendation && c.requiresBuyer && !buyers.has(id)) {
      exclusions.push({ cropId: id, kind: 'buyer', reason: needsBuyerReason(c.name) });
      continue;
    }
    const sal = salinityRelativeYield(c, paddock.land.salinityECe);
    if (sal.gap) gaps.add(sal.gap);
    if (sal.value < SALINITY_MIN_RELATIVE_YIELD) {
      exclusions.push({
        cropId: id,
        kind: 'land',
        reason:
          `${paddock.name} is too salty for ${c.name}: at ECe ${paddock.land.salinityECe} dS/m it would yield about ` +
          `${Math.round(sal.value * 100)}% of normal (cut-off ${Math.round(SALINITY_MIN_RELATIVE_YIELD * 100)}%).`,
      });
      continue;
    }
    if (forRecommendation) {
      const econ = economicsStatus(c);
      if (econ.status === 'incomplete') {
        exclusions.push({
          cropId: id,
          kind: 'economics',
          reason:
            `We don't have a sourced ${econ.missing.join(' and ')} for ${c.name} yet, so we can't work out its profit ` +
            'and won\'t recommend it. You can still place it in your own plan.',
        });
        continue;
      }
    }
    allowed.push(id);
  }

  // Unknown crop ids the farmer listed.
  for (const id of available) {
    if (!crops[id]) exclusions.push({ cropId: id, kind: 'availability', reason: `"${id}" is not in the crop table.` });
  }

  // Year-1 rotation exclusions that follow from history (informational: the crop is fine in later years).
  const last = paddock.history.length;
  for (const id of allowed) {
    const v = hardRuleViolation(crops, timelineOf(paddock, [id]), last);
    if (v) exclusions.push({ cropId: id, kind: 'rotation', reason: `Not in year 1: ${v}` });
  }

  return { allowed, exclusions, gaps: [...gaps] };
}

/** Every sequence of `years` crops from `allowed` that passes the hard rotation rules. */
export function enumerateSequences(crops: CropTable, paddock: Paddock, allowed: CropId[], years: number): CropId[][] {
  const out: CropId[][] = [];
  const seq: CropId[] = [];
  const recurse = (): void => {
    if (seq.length === years) {
      out.push(seq.slice());
      return;
    }
    for (const id of allowed) {
      seq.push(id);
      // Check only the newly added year: earlier years were checked on the way down.
      const t = timelineOf(paddock, seq);
      if (!hardRuleViolation(crops, t, t.length - 1)) recurse();
      seq.pop();
    }
  };
  recurse();
  return out;
}

export { sequenceViolation };
