/**
 * Data behind the soilHealthIndex ground-cover and organic-matter components.
 *
 * Residue factors and cover reference points are sourced (NRCS). The tillage
 * retention table is a PLACEHOLDER until a teammate supplies sourced values.
 * Crops with no residue factor are left out on purpose: they become an
 * information gap rather than borrowing another crop's number.
 */
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
  source: keyof typeof SOIL_SOURCES;
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
  // canola, sunflower, dry-beans, cotton, oats, barley, cereal-rye: not sourced yet -> information gap.
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

/**
 * PLACEHOLDER: share of residue left on the surface by tillage system.
 * A teammate will replace these with sourced values. Do not cite them.
 */
export const TILLAGE_RESIDUE_RETENTION: Record<Tillage, { value: number; placeholder: true }> = {
  conventional: { value: 0.3, placeholder: true },
  reduced: { value: 0.6, placeholder: true },
  noTill: { value: 0.9, placeholder: true },
};

export const DEFAULT_TILLAGE: Tillage = 'reduced';
