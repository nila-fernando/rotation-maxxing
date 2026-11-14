/**
 * Sourced parameters for the water balance, rainfall erosivity, RUSLE and the
 * cereal rye cover crop. Every number cites a source; anything we could not
 * source is `null` and becomes an information gap (never a guess).
 *
 * Compiled 14 Nov 2026. Read with care:
 *  - FAO-56 tables were read from FAO's HTML edition; check against the PDF.
 *  - Stage lengths are FAO-56 Table 11 rows chosen per crop (row named below).
 *    There is no Midwest corn row and no US spring small-grain row.
 *  - Ky: FAO-66 Ch. 2 Table 1 (FAO-33 seasonal values). FAO-66 Table 2 lists
 *    winter wheat as 1.00, contradicting Table 1's 1.05; 1.05 is used.
 */
import { CROP_BY_ID } from './croptraits';
import type { CropWaterParams } from './waterBalance';
import type { CropId } from './types';

export const WATER_SOURCES = {
  fao66: {
    title: 'Steduto, Hsiao, Fereres & Raes 2012, FAO Irrigation and Drainage Paper 66, Ch. 2 Table 1 (seasonal Ky from FAO-33)',
    url: 'http://www.fao.org/4/i2800e/i2800e02.pdf',
    covers: 'Seasonal yield response factor Ky',
  },
  fao56Tables: {
    title: 'Allen et al. 1998, FAO-56 Ch. 6 Tables 11 and 12; Annex 8',
    url: 'http://www.fao.org/4/x0490e/x0490e0b.htm',
    covers: 'Crop stage lengths, Kc ini/end; initial rooting depth 0.15-0.20 m (Annex 8)',
  },
  ah703: {
    title: 'Renard et al. 1997, Agriculture Handbook 703 (RUSLE)',
    url: 'https://www.tucson.ars.ag.gov/unit/publications/PDFfiles/717.pdf',
    covers: 'LS factor (eqs. 4-1 to 4-6), surface-cover subfactor (eq. 5-12, b = 0.035), C of tilled fallow = 1, T range',
  },
  richardson1983: {
    title: 'Richardson, Foster & Wright 1983 daily erosivity model, as given in Xie et al. 2016, J. Hydrology 535:547-558 (eq. 11)',
    url: 'https://tucson.ars.ag.gov/unit/publications/PDFfiles/2277.pdf',
    covers: 'Daily EI = a P^1.81 (a = 0.41 Apr-Sep, 0.18 Oct-Mar), SI units',
  },
  arsRusle106: {
    title: 'USDA-ARS, Revised Universal Soil Loss Equation 1.06 bulletins (2020)',
    url: 'https://www.ars.usda.gov/southeast-area/oxford-ms/national-sedimentation-laboratory/watershed-physical-processes-research/docs/revised-universal-soil-loss-equation-106-bulletins/',
    covers: 'R conversion: US units = SI MJ mm/(ha h yr) / 17.02',
  },
  sare2019: {
    title: 'Myers, Weber & Tellatin 2019, SARE "Cover Crop Economics", Table 3',
    url: 'https://www.sare.org/wp-content/uploads/Cover-Crop-Economics.pdf',
    covers: 'Cover crop seed + seeding median $37/ac (all cover crops, 2012 survey)',
  },
  marcillo2017: {
    title: 'Marcillo & Miguez 2017, J. Soil Water Conserv. 72(3):226-239 (meta-analysis)',
    url: 'https://heronetnext.epa.gov/reference/10285810',
    covers: 'Grass cover crops (incl. rye) neither increased nor decreased corn yield',
  },
  unlCropWatch2018: {
    title: 'Lancaster, Koehler-Cole & Elmore 2018, UNL CropWatch',
    url: 'https://cropwatch.unl.edu/2018/rain-fed-corn-growth-and-development-following-cover-crops-2017/',
    covers: 'Rye uses about 1 in of soil water per 1,000 lb/ac biomass; a Nebraska trial used about 2 in',
  },
  isuA120_2026: {
    title: 'Hart 2026, Iowa State Ag Decision Maker A1-20, Estimated Costs of Crop Production in Iowa-2026',
    url: 'https://www.extension.iastate.edu/agdm/crops/pdf/a1-20.pdf',
    covers: 'Alfalfa hay variable cost: established stand (4 t/ac) $242.56/ac; establishment with oats $169.89/ac',
  },
} as const;

/** Initial rooting depth at planting, m: midpoint of FAO-56 Annex 8's 0.15-0.20 m. */
export const ROOT_INITIAL_M = 0.175;

interface RawWater {
  stages: [number, number, number, number];
  kcIni: number;
  kcEnd: number;
  ky: number | null;
  row: string;
}

/**
 * FAO-56 Table 11 stage lengths (row noted), Table 12 Kc ini/end, FAO-66 Ky.
 * Crops absent here have no sourced stage lengths (canola, alfalfa cutting
 * cycles, cereal rye) and are not run through the water balance.
 */
const RAW: Partial<Record<CropId, RawWater>> = {
  corn: { stages: [30, 40, 50, 50], kcIni: 0.3, kcEnd: 0.35, ky: 1.25, row: 'Idaho, USA; Kc end for field-dried grain' },
  soybeans: { stages: [20, 32.5, 60, 25], kcIni: 0.4, kcEnd: 0.5, ky: 0.85, row: 'Central USA (L_dev 30-35, midpoint used)' },
  'winter-wheat': { stages: [160, 75, 75, 25], kcIni: 0.4, kcEnd: 0.25, ky: 1.05, row: 'Idaho, USA (L_ini includes dormancy); Kc ini for frozen soils' },
  'spring-wheat': { stages: [20, 25, 60, 30], kcIni: 0.3, kcEnd: 0.25, ky: 1.15, row: 'Barley/Oats/Wheat, 35-45 deg L' },
  oats: { stages: [20, 25, 60, 30], kcIni: 0.3, kcEnd: 0.25, ky: null, row: 'Barley/Oats/Wheat, 35-45 deg L' },
  barley: { stages: [20, 25, 60, 30], kcIni: 0.3, kcEnd: 0.25, ky: null, row: 'Barley/Oats/Wheat, 35-45 deg L' },
  sorghum: { stages: [20, 35, 40, 30], kcIni: 0.3, kcEnd: 0.55, ky: 0.9, row: 'USA, Pakistan, Med.' },
  cotton: { stages: [30, 50, 55, 45], kcIni: 0.35, kcEnd: 0.6, ky: 0.85, row: 'Texas; Kc end midpoint of 0.70-0.50' },
  sunflower: { stages: [25, 35, 45, 25], kcIni: 0.35, kcEnd: 0.35, ky: 0.95, row: 'Medit.; California' },
  'dry-beans': { stages: [25, 25, 30, 20], kcIni: 0.4, kcEnd: 0.35, ky: 1.15, row: 'Idaho, USA' },
};

export interface ResolvedWaterParams {
  params: CropWaterParams | null;
  gap: string | null;
  row: string | null;
}

/** Water-balance parameters for a crop: stage lengths + Kc + Ky from here, kc mid / p / roots from croptraits. */
export function waterParamsFor(cropId: CropId): ResolvedWaterParams {
  const raw = RAW[cropId];
  const c = CROP_BY_ID[cropId];
  const name = c?.name ?? cropId;
  if (!raw || !c) {
    return { params: null, gap: `No sourced FAO-56 stage lengths for ${name}; weather years don't vary its yield.`, row: null };
  }
  if (raw.ky === null) {
    return { params: null, gap: `No sourced FAO-33 yield response factor (Ky) for ${name}; weather years don't vary its yield.`, row: raw.row };
  }
  const kcMid = c.kcMid?.value;
  const p = c.depletionFractionP?.value;
  const roots = c.rootDepthM?.value;
  if (kcMid === undefined || p === undefined || !roots) {
    return { params: null, gap: `FAO-56 kc/p/root depth missing for ${name}.`, row: raw.row };
  }
  const [lIni, lDev, lMid, lLate] = raw.stages;
  return {
    params: {
      lIni,
      lDev,
      lMid,
      lLate,
      kcIni: raw.kcIni,
      kcMid,
      kcEnd: raw.kcEnd,
      ky: raw.ky,
      p,
      rootIniM: ROOT_INITIAL_M,
      // Midpoint of FAO-56 Table 22's range (the range reflects soil and management).
      rootMaxM: (roots.min + roots.max) / 2,
    },
    gap: null,
    row: raw.row,
  };
}

// ---------------------------------------------------------------------------
// Erosion (RUSLE, AH703) and erosivity
// ---------------------------------------------------------------------------

/** Richardson et al. 1983 daily erosivity EI = a P^b (P mm, EI MJ mm ha-1 h-1). */
export const DAILY_EROSIVITY = { aWarm: 0.41, aCool: 0.18, b: 1.81, warmMonths: [4, 5, 6, 7, 8, 9] } as const;
/** US customary R = SI R / 17.02 (ARS RUSLE 1.06). */
export const R_SI_TO_US = 17.02;
/** AH703 surface-cover subfactor coefficient for typical cropland. */
export const SURFACE_COVER_B = 0.035;
/** AH703 unit-plot slope length, ft. Used when the paddock's slope length is unknown (assumption, flagged). */
export const UNIT_PLOT_LENGTH_FT = 72.6;

// ---------------------------------------------------------------------------
// Cereal rye cover crop
// ---------------------------------------------------------------------------

export const RYE_COVER = {
  /** Seed + seeding, median, all cover crops (SARE 2019 Table 3). */
  costPerAcre: { value: 37, sources: ['sare2019'] },
  /** Following corn yield change for grass cover crops: none (Marcillo & Miguez 2017). */
  nextCornYieldChange: { value: 0, sources: ['marcillo2017'] },
  /** Not sourced: RUSLE C for rye cover after corn/soy; Kc; biomass. */
  rusleC: null,
  kc: null,
} as const;
