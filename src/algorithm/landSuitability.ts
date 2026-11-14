/**
 * Land suitability from FAO EcoCrop (croptraits.ts LAND_SUITABILITY):
 * soil pH and drainage. EcoCrop parameters are EXPERT OPINION (global, not
 * US-calibrated); every term says so.
 *
 *  pH:       plateau curve: 1 between optMin and optMax, linear down to 0 at
 *            min / max. Outside min..max the crop is excluded. Unknown
 *            paddock pH -> skipped, with an information gap.
 *  drainage: SSURGO class -> EcoCrop code (design mapping below); tile drainage
 *            counts as one class better. Outside `tolerated` -> excluded; inside
 *            `tolerated` but not `optimal` -> DRAINAGE_SUBOPTIMAL_FACTOR.
 *  Killing temperature is deliberately NOT used as a frost filter.
 */
import { DRAINAGE_SUBOPTIMAL_FACTOR } from './constants';
import { LAND_SUITABILITY, type EcocropDrainage } from './croptraits';
import { isFallow } from './cropData';
import type { CropTraits, Drainage, Factor, Paddock } from './types';

export interface SuitabilityCheck {
  /** Yield factor (1 = no effect). */
  factor: number;
  excluded: boolean;
  reason: string | null;
  gap: string | null;
  term: Factor | null;
}

const NONE: SuitabilityCheck = { factor: 1, excluded: false, reason: null, gap: null, term: null };

/** Plateau curve value at pH (0 outside min..max). */
export function phPlateau(p: { min: number; optMin: number; optMax: number; max: number }, ph: number): number {
  if (ph < p.min || ph > p.max) return 0;
  if (ph < p.optMin) return (ph - p.min) / (p.optMin - p.min);
  if (ph > p.optMax) return (p.max - ph) / (p.max - p.optMax);
  return 1;
}

export function phCheck(crop: CropTraits, ph: number | null | undefined): SuitabilityCheck {
  if (isFallow(crop)) return NONE;
  const s = LAND_SUITABILITY[crop.id];
  if (!s) return { ...NONE, gap: `No EcoCrop pH range for ${crop.name}; pH not checked.` };
  if (ph === null || ph === undefined) return { ...NONE, gap: 'Paddock soil pH is unknown; pH suitability not checked.' };
  const v = phPlateau(s.ph, ph);
  if (v === 0) {
    return {
      factor: 0,
      excluded: true,
      reason: `Soil pH ${ph} is outside the range ${crop.name} tolerates (${s.ph.min}-${s.ph.max}, FAO EcoCrop, expert opinion).`,
      gap: null,
      term: null,
    };
  }
  return {
    ...NONE,
    factor: v,
    term:
      v < 1
        ? { label: `Soil pH ${ph} (optimal ${s.ph.optMin}-${s.ph.optMax}; FAO EcoCrop, expert opinion)`, factor: v, basis: 'sourced', sources: ['faoEcocrop'] }
        : null,
  };
}

/** One class better when tile-drained. */
export function effectiveDrainage(d: Drainage, tileDrained: boolean | undefined): Drainage {
  if (!tileDrained) return d;
  return d === 'poor' ? 'moderate' : d === 'moderate' ? 'good' : d;
}

/** SSURGO-derived class -> EcoCrop code. A design mapping (EcoCrop "I" still needs its definition confirmed). */
export function toEcocrop(d: Drainage): EcocropDrainage {
  return d === 'excessive' ? 'E' : d === 'poor' ? 'I' : 'W';
}

export function drainageCheck(crop: CropTraits, paddock: Paddock): SuitabilityCheck {
  if (isFallow(crop)) return NONE;
  const s = LAND_SUITABILITY[crop.id];
  if (!s) return { ...NONE, gap: `No EcoCrop drainage tolerance for ${crop.name}; drainage not checked.` };
  const cls = effectiveDrainage(paddock.land.drainage, paddock.tileDrained);
  const code = toEcocrop(cls);
  const tiled = paddock.tileDrained && cls !== paddock.land.drainage ? ' (tile-drained)' : '';
  if (!s.drainage.tolerated.includes(code)) {
    return {
      factor: 0,
      excluded: true,
      reason:
        `${paddock.name} is ${cls}ly drained${tiled}; ${crop.name} needs ${s.drainage.tolerated.map(label).join(' or ')} ground ` +
        '(FAO EcoCrop, expert opinion). Tile drainage would count as one class better.',
      gap: null,
      term: null,
    };
  }
  if (!s.drainage.optimal.includes(code)) {
    return {
      ...NONE,
      factor: DRAINAGE_SUBOPTIMAL_FACTOR,
      term: {
        label: `Drainage: ${cls}${tiled}, tolerated but not optimal for ${crop.name} (EcoCrop, expert opinion; penalty size is a design choice)`,
        factor: DRAINAGE_SUBOPTIMAL_FACTOR,
        basis: 'design',
        sources: ['faoEcocrop'],
      },
    };
  }
  return NONE;
}

function label(c: EcocropDrainage): string {
  return c === 'E' ? 'excessively drained' : c === 'W' ? 'well-drained' : 'imperfectly/poorly drained';
}
