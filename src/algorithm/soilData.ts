/**
 * Data behind the soilHealthIndex ground-cover and organic-matter components.
 *
 * Residue factors and cover reference points are sourced (NRCS). The tillage
 * retention table is a PLACEHOLDER until a teammate supplies sourced values.
 * Crops with no residue factor are left out on purpose: they become an
 * information gap rather than borrowing another crop's number.
 */
import { RESIDUE_FACTOR_ADDITIONS, RESIDUE_FRAGILITY, TILLAGE_OPERATIONS, TILLAGE_SYSTEMS, tillageRetention } from './cropTraitsUpdate';
import type { CropId, Tillage } from './types';

export const SOIL_SOURCES = {
  nrcsVaResidue1: {
    title: 'USDA NRCS Virginia, Agronomy Technical Note: Residue Management #1',
    url: null,
    covers: 'Residue produced per unit yield; residue weight to % ground cover reference points',
  },
  nrcsRusleCFactor: {
    title: 'USDA NRCS RUSLE cover-management (C) factor tables',
    url: null,
    covers: 'Legume meadow (established alfalfa) C factor 0.020',
  },
} as const;

/** Residue texture decides which cover curve applies. */
export type ResidueType = 'coarse' | 'fine';

export interface ResidueFactor {
  /** lb of residue per unit of the crop's yield unit (per bu here). */
  lbPerYieldUnit: number;
  type: ResidueType;
  /** Evidence id (SOIL_SOURCES or SOURCES_ADDITIONS in cropTraitsUpdate.ts). */
  source: string;
  note?: string;
}

/**
 * Residue produced per unit yield (NRCS VA Residue Management #1).
 * Sorghum is given as 1.35 lb residue per lb grain; converted at 56 lb/bu.
 */
export const RESIDUE_FACTORS: Partial<Record<CropId, ResidueFactor>> = {
  corn: { lbPerYieldUnit: 75, type: 'coarse', source: 'nrcsVaResidue1' },
  sorghum: {
    lbPerYieldUnit: 1.35 * 56,
    type: 'coarse',
    source: 'nrcsVaResidue1',
    note: '1.35 lb/lb x 56 lb/bu. Using the corn (coarse) cover curve for sorghum is an assumption',
  },
  soybeans: { lbPerYieldUnit: 60, type: 'fine', source: 'nrcsVaResidue1' },
  'winter-wheat': { lbPerYieldUnit: 100, type: 'fine', source: 'nrcsVaResidue1' },
  'spring-wheat': { lbPerYieldUnit: 100, type: 'fine', source: 'nrcsVaResidue1' },
  barley: { lbPerYieldUnit: RESIDUE_FACTOR_ADDITIONS.barley.lbPerUnit, type: 'fine', source: RESIDUE_FACTOR_ADDITIONS.barley.source },
  oats: { lbPerYieldUnit: RESIDUE_FACTOR_ADDITIONS.oats.lbPerUnit, type: 'fine', source: RESIDUE_FACTOR_ADDITIONS.oats.source },
  'cereal-rye': {
    lbPerYieldUnit: RESIDUE_FACTOR_ADDITIONS['cereal-rye'].lbPerUnit,
    type: 'fine',
    source: RESIDUE_FACTOR_ADDITIONS['cereal-rye'].source,
    note: RESIDUE_FACTOR_ADDITIONS['cereal-rye'].note,
  },
  // canola, sunflower, dry-beans, cotton, alfalfa: not sourced yet -> information gap.
};

/**
 * NRCS reference points for residue -> % cover: about 2,600 lb of corn
 * residue or 1,500 lb of small-grain/soybean residue gives about 60% cover.
 * The cover curve is fitted through these (see soilHealth.ts).
 */
export const COVER_REFERENCE: Record<ResidueType, { residueLb: number; coverFraction: number }> = {
  coarse: { residueLb: 2600, coverFraction: 0.6 },
  fine: { residueLb: 1500, coverFraction: 0.6 },
};

/** Established alfalfa (legume meadow) RUSLE C factor. Cover score = 1 - C. */
export const ALFALFA_C_FACTOR = { value: 0.02, source: 'nrcsRusleCFactor' as const };

export interface Retention {
  /** Share of residue left on the surface at planting (0-1). */
  value: number;
  low: number;
  high: number;
  fragile: boolean;
  fragilityBasis: 'sourced' | 'assumption';
  label: string;
}

/**
 * Residue left on the surface at planting:
 *   tillage system retention (NRCS VA Tech Note Table 2, per operation, multiplied)
 *   x over-winter decomposition (same table, applied to every system)
 * Which operations each system means (TILLAGE_SYSTEMS) is a DESIGN choice.
 * Unknown fragility counts as fragile (less cover), so missing data never helps.
 * @param at position between the low and high ends (0-1); default the midpoint values
 */
export function residueRetention(cropId: CropId, tillage: Tillage, at?: number): Retention {
  const frag = RESIDUE_FRAGILITY[cropId] ?? { fragile: true, basis: 'assumption' as const };
  const winter = TILLAGE_OPERATIONS.overWinterDecomposition[frag.fragile ? 'fragile' : 'nonFragile'];
  const low = tillageRetention(tillage, frag.fragile, 'low') * winter[0];
  const high = tillageRetention(tillage, frag.fragile, 'high') * winter[1];
  const mid = tillageRetention(tillage, frag.fragile, 'mid') * ((winter[0] + winter[1]) / 2);
  const value = at === undefined ? mid : low + at * (high - low);
  return {
    value,
    low,
    high,
    fragile: frag.fragile,
    fragilityBasis: frag.basis,
    label: `${tillage} tillage (${TILLAGE_SYSTEMS[tillage].join(' + ')}; system definition is a design choice) keeps ${Math.round(value * 100)}% of ${frag.fragile ? 'fragile' : 'non-fragile'} residue after over-winter decomposition`,
  };
}

export const DEFAULT_TILLAGE: Tillage = 'reduced';
