/**
 * RUSLE soil loss (Renard et al. 1997, Agriculture Handbook 703):
 *
 *   A = R x K x LS x C x P          tons/acre/year (US customary R and K)
 *
 *   R  rainfall erosivity, from NASA POWER daily rain (climate.ts)
 *   K  soil erodibility, SSURGO kffact
 *   LS slope length and steepness (AH703 eqs. 4-1 to 4-5)
 *   C  cover-management: tilled fallow = 1 (by definition), established
 *      alfalfa 0.020 (NRCS), residue crops = surface-cover subfactor
 *      exp(-0.035 x % cover) (AH703 eq. 5-12, smooth surface)
 *   P  support practice: 1 (none) unless the farmer has contours/terraces
 *
 * Simplifications: canopy and residue decay over the year are not modelled
 * (only the residue left after harvest protects the soil), so row-crop A is
 * conservative (too high) in mid-season.
 */
import { isFallow } from './cropData';
import { ALFALFA_C_FACTOR, RESIDUE_FACTORS, TILLAGE_RESIDUE_RETENTION } from './soilData';
import { residueLb, residueToCover } from './soilHealth';
import { SURFACE_COVER_B, UNIT_PLOT_LENGTH_FT } from './waterParams';
import type { CropTraits, Land, Tillage } from './types';

/** AH703 LS factor from slope % and horizontal slope length (ft). */
export function lsFactor(slopePct: number, lengthFt: number): number {
  const theta = Math.atan(slopePct / 100);
  const sin = Math.sin(theta);
  const beta = sin / 0.0896 / (3 * sin ** 0.8 + 0.56); // eq. 4-3
  const m = beta / (1 + beta); // eq. 4-2
  const L = (lengthFt / 72.6) ** m; // eq. 4-1
  const S = slopePct < 9 ? 10.8 * sin + 0.03 : 16.8 * sin - 0.5; // eqs. 4-4, 4-5
  return L * S;
}

export interface CFactor {
  value: number | null;
  label: string;
  sources: string[];
}

/** Cover-management factor for one year of a crop. Null when we can't say. */
export function cFactor(crop: CropTraits, yieldPerAcre: number | null, tillage: Tillage): CFactor {
  if (isFallow(crop)) return { value: 1, label: 'tilled fallow (C = 1 by definition)', sources: ['ah703'] };
  if (crop.id === 'alfalfa') return { value: ALFALFA_C_FACTOR.value, label: 'established alfalfa (C 0.020)', sources: ['nrcsRusleCFactor'] };
  const f = RESIDUE_FACTORS[crop.id];
  const r = residueLb(crop, yieldPerAcre);
  if (!f || r === null) return { value: null, label: `no sourced residue factor for ${crop.name}`, sources: [] };
  const cover = residueToCover(r * TILLAGE_RESIDUE_RETENTION[tillage].value, f.type);
  return {
    value: Math.exp(-SURFACE_COVER_B * cover * 100),
    label: `${Math.round(cover * 100)}% residue cover after ${tillage} tillage`,
    sources: ['ah703', 'nrcsVaResidue1'],
  };
}

export interface SoilLoss {
  /** tons/acre/year, null if K, R or C is unknown. */
  tonsPerAcre: number | null;
  /** Tolerable soil loss T, tons/acre/year (SSURGO tfact), or null. */
  tolerance: number | null;
  /** 0-1 erosion protection score: 1 - A/T, clamped. Null if A or T is unknown. */
  score: number | null;
  label: string;
  sources: string[];
  gaps: string[];
}

export function soilLoss(land: Land, r: number | undefined, c: CFactor): SoilLoss {
  const gaps: string[] = [];
  if (land.kFactor === undefined) gaps.push('Soil erodibility K (SSURGO) not available; erosion not estimated in tons.');
  if (r === undefined) gaps.push('Rainfall erosivity R not available (needs NASA POWER daily rain); erosion not estimated in tons.');
  if (c.value === null) gaps.push(`RUSLE C unknown (${c.label}); erosion not estimated in tons.`);
  if (land.kFactor === undefined || r === undefined || c.value === null) {
    return { tonsPerAcre: null, tolerance: land.tFactorTonsPerAcre ?? null, score: null, label: 'Erosion not estimated', sources: [], gaps };
  }
  if (land.slopeLengthFt === undefined) gaps.push(`Slope length unknown; the RUSLE unit-plot length (${UNIT_PLOT_LENGTH_FT} ft) is assumed.`);
  const ls = lsFactor(land.slopePct, land.slopeLengthFt ?? UNIT_PLOT_LENGTH_FT);
  const a = r * land.kFactor * ls * c.value;
  const t = land.tFactorTonsPerAcre ?? null;
  if (t === null) gaps.push('Tolerable soil loss T (SSURGO tfact) not available; erosion is reported but not scored.');
  return {
    tonsPerAcre: a,
    tolerance: t,
    score: t ? Math.max(0, Math.min(1, 1 - a / t)) : null,
    label: `Erosion (RUSLE): ${a.toFixed(1)} t/ac/yr${t ? ` vs tolerable ${t}` : ''}; ${c.label}`,
    sources: ['ah703', 'richardson1983', 'arsRusle106', 'ssurgo', 'nasaPower', ...c.sources],
    gaps,
  };
}
