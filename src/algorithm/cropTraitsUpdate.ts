/**
 * Additions for cropTraits.ts (compiled 14 Nov 2026).
 *
 * Merge into src/algorithm/croptraits.ts, or import from here. Contents:
 *   1. SEASONS        Iowa + Kansas planting/harvest dates (NASS Handbook 628)
 *   2. TILLAGE        residue retention per operation + system definitions (NRCS)
 *   3. RESIDUE        extra residue factors (barley, oats, rye) + fragility
 *   4. LAND_SUITABILITY  pH range, drainage, killing temperature (FAO EcoCrop)
 *   5. STATE_PRESENCE whether each crop is a usual crop in IA / KS
 *   6. Updated DATA_GAPS
 *
 * Same rule as before: anything not sourced is null or explicitly tagged
 * 'assumption' / 'design'. Never fill a null with a guess.
 */

// ---------------------------------------------------------------------------
// New sources
// ---------------------------------------------------------------------------

export const SOURCES_ADDITIONS = {
  nassHandbook628: {
    title: 'USDA NASS, Field Crops Usual Planting and Harvesting Dates (Agricultural Handbook 628), Oct 2010',
    url: 'https://esmis.nal.usda.gov/sites/default/release-files/vm40xr56k/dv13zw65p/z603r1055/planting-10-29-2010.txt',
    covers:
      'State-level usual dates from 20 years of crop progress data. Begin = ~5% done, end = ~95% done, most active = 15-85%.',
  },
  nrcsVaResidueNote: {
    title: 'NRCS Virginia Technical Note, Agronomy - Residue Management/Tillage #1 (Jan 2001)',
    url: 'https://efotg.sc.egov.usda.gov/references/Delete/2006-11-18/residuemgt%231TechNote.pdf',
    covers:
      'Residue per unit yield (Table 1), % residue remaining after each tillage operation for fragile and non-fragile residue (Table 2)',
  },
  faoEcocrop: {
    title: 'FAO EcoCrop database, as packaged in the Recocrop R package (inst/parameters/ecocrop.rds)',
    url: 'https://github.com/cropmodels/Recocrop',
    covers:
      'Soil pH min / optimal range / max, drainage class (optimal and absolute), killing temperature. Expert-opinion parameters for 1,710 taxa.',
    note:
      'Recocrop docs warn these are expert opinion and not necessarily optimal. KTMP = 0 is a default in 819 of 1,710 rows (incl. wheat), so 0 is treated as UNKNOWN here.',
  },
} as const;

// ---------------------------------------------------------------------------
// 1. Seasons: Handbook 628, Iowa and Kansas
// ---------------------------------------------------------------------------

/** 'MM-DD'. begin ~5% done, activeStart-activeEnd = 15-85%, end ~95% done. */
export interface DateWindow {
  begin: string;
  activeStart: string | null;
  activeEnd: string | null;
  end: string;
}

export interface StateSeason {
  /** null for perennials (alfalfa): Handbook 628 gives no planting dates. */
  plant: DateWindow | null;
  harvest: DateWindow;
  handbookRow: string;
  note?: string;
}

export type StateCode = 'IA' | 'KS';

const w = (begin: string, activeStart: string | null, activeEnd: string | null, end: string): DateWindow => ({
  begin,
  activeStart,
  activeEnd,
  end,
});

/** Keyed by cropTraits ids. A missing state means the crop has no row for that state. */
export const SEASONS: Record<string, Partial<Record<StateCode, StateSeason>>> = {
  corn: {
    IA: { plant: w('04-19', '04-25', '05-18', '05-26'), harvest: w('09-21', '10-05', '11-09', '11-21'), handbookRow: 'Corn for grain' },
    KS: { plant: w('04-05', '04-15', '05-15', '05-25'), harvest: w('09-01', '09-10', '10-25', '11-10'), handbookRow: 'Corn for grain' },
  },
  soybeans: {
    IA: { plant: w('05-02', '05-08', '06-02', '06-16'), harvest: w('09-21', '09-28', '10-20', '10-31'), handbookRow: 'Soybeans' },
    KS: {
      plant: w('05-05', '05-15', '06-20', '07-01'),
      harvest: w('09-20', '10-01', '11-01', '11-15'),
      handbookRow: 'Soybeans',
      note: 'The late planting end (Jul 1) likely includes double-crop soybean after wheat; the handbook does not split them.',
    },
  },
  'winter-wheat': {
    IA: { plant: w('09-06', '09-26', '10-15', '10-30'), harvest: w('06-24', '07-06', '07-22', '08-07'), handbookRow: 'Wheat, winter' },
    KS: { plant: w('09-10', '09-15', '10-20', '11-01'), harvest: w('06-15', '06-20', '07-05', '07-15'), handbookRow: 'Wheat, winter' },
  },
  sorghum: {
    KS: { plant: w('05-05', '05-15', '06-20', '07-15'), harvest: w('09-10', '09-25', '11-10', '11-25'), handbookRow: 'Sorghum for grain' },
  },
  cotton: {
    KS: { plant: w('05-10', '05-20', '06-15', '06-25'), harvest: w('10-15', '10-25', '12-15', '12-30'), handbookRow: 'Cotton, all' },
  },
  sunflower: {
    KS: { plant: w('05-15', '05-25', '06-30', '07-10'), harvest: w('09-15', '10-01', '11-15', '11-30'), handbookRow: 'Sunflower, all' },
  },
  oats: {
    IA: { plant: w('03-25', '04-02', '05-02', '05-13'), harvest: w('07-09', '07-17', '08-05', '08-11'), handbookRow: 'Oats, spring' },
    KS: { plant: w('02-20', '03-05', '04-01', '05-01'), harvest: w('07-10', '07-15', '08-01', '08-10'), handbookRow: 'Oats, spring' },
  },
  barley: {
    KS: {
      plant: w('03-01', '03-05', '04-01', '05-01'),
      harvest: w('06-20', '06-25', '07-01', '07-10'),
      handbookRow: 'Barley, spring',
      note:
        'Kansas also lists fall barley: plant 09-15 / 10-01-10-15 / 11-01, harvest begin 06-20, active 06-15-07-01, end 07-05 (the handbook prints an active start before the begin date). Small acreage.',
    },
  },
  alfalfa: {
    IA: { plant: null, harvest: w('05-24', '05-30', '09-15', '09-29'), handbookRow: 'Hay, alfalfa', note: 'Cutting window for an established stand.' },
    KS: { plant: null, harvest: w('05-10', '05-20', '10-15', '11-01'), handbookRow: 'Hay, alfalfa', note: 'Cutting window for an established stand.' },
  },
  // No IA or KS rows in Handbook 628: spring-wheat, canola, dry-beans, cereal-rye.
  // fallow: no season.
};

/**
 * The algorithm needs months in the field. Suggested derivation (design, not data):
 * field span = plant.activeStart -> harvest.activeEnd, falling back to begin/end
 * when the active range is null.
 */
export const SEASON_SPAN_RULE = 'plant.activeStart -> harvest.activeEnd (fallback begin -> end)' as const;

// ---------------------------------------------------------------------------
// 2. Tillage residue retention (NRCS VA Technical Note, Table 2)
// ---------------------------------------------------------------------------

/** % of surface residue remaining after one operation, as 0-1 ranges. */
export const TILLAGE_OPERATIONS = {
  chiselStraightShanks: { nonFragile: [0.6, 0.8], fragile: [0.4, 0.6] },
  chiselTwistedShanks: { nonFragile: [0.5, 0.7], fragile: [0.3, 0.4] },
  fieldCultivatorSweeps: { nonFragile: [0.7, 0.8], fragile: [0.5, 0.6] },
  tandemDiskAfterHarvest: { nonFragile: [0.7, 0.8], fragile: [0.4, 0.5] },
  tandemDiskAfterTillage: { nonFragile: [0.4, 0.7], fragile: [0.25, 0.4] },
  moldboardPlow: { nonFragile: [0.0, 0.1], fragile: [0.0, 0.05] },
  noTillPlanting: { nonFragile: [0.85, 0.95], fragile: [0.75, 0.85] },
  /** Not tillage: apply to every system between harvest and planting. */
  overWinterDecomposition: { nonFragile: [0.8, 0.95], fragile: [0.7, 0.8] },
} as const satisfies Record<string, { nonFragile: readonly [number, number]; fragile: readonly [number, number] }>;

export type TillageOperation = keyof typeof TILLAGE_OPERATIONS;

/**
 * DESIGN: which operations each system means. The per-operation numbers are
 * sourced; these sequences are our choice and should be documented as such.
 */
export const TILLAGE_SYSTEMS: Record<'noTill' | 'reduced' | 'conventional', TillageOperation[]> = {
  noTill: ['noTillPlanting'],
  reduced: ['chiselStraightShanks', 'fieldCultivatorSweeps'],
  conventional: ['moldboardPlow', 'tandemDiskAfterTillage'],
};

/** Retention for a system (midpoint of each range, multiplied). Overwinter decomposition applied separately. */
export function tillageRetention(system: keyof typeof TILLAGE_SYSTEMS, fragile: boolean, at: 'low' | 'mid' | 'high' = 'mid'): number {
  return TILLAGE_SYSTEMS[system].reduce((acc, op) => {
    const [lo, hi] = TILLAGE_OPERATIONS[op][fragile ? 'fragile' : 'nonFragile'];
    const v = at === 'low' ? lo : at === 'high' ? hi : (lo + hi) / 2;
    return acc * v;
  }, 1);
}
// Midpoints: noTill 0.90 / 0.80, reduced 0.525 / 0.275, conventional ~0.03 / ~0.01 (non-fragile / fragile).
// These replace the 0.9 / 0.6 / 0.3 placeholder. Use the low/high values in Monte Carlo if you want the spread.

// ---------------------------------------------------------------------------
// 3. Residue factors and fragility
// ---------------------------------------------------------------------------

/** lb of residue per unit of yield. Adds to corn 75/bu, sorghum 1.35/lb, soybean 60/bu, wheat 100/bu. */
export const RESIDUE_FACTOR_ADDITIONS = {
  barley: { lbPerUnit: 70, unit: 'bu', source: 'nrcsVaResidueNote' },
  oats: { lbPerUnit: 80, unit: 'bu', source: 'nrcsVaResidueNote' },
  'cereal-rye': { lbPerUnit: 90, unit: 'bu', source: 'nrcsVaResidueNote', note: 'Grain basis. A cover crop is not harvested, so this is a lower bound at best.' },
  // cotton: listed as "bale 5" in the note with unclear units: not used.
  // canola, sunflower, dry-beans, alfalfa: still no factor.
} as const;

/**
 * Fragile residue decomposes and is buried faster, so it retains less after
 * tillage. The note names soybean as fragile and corn / small grain as
 * non-fragile. Everything else is tagged.
 */
export const RESIDUE_FRAGILITY: Record<string, { fragile: boolean; basis: 'sourced' | 'assumption' }> = {
  corn: { fragile: false, basis: 'sourced' },
  'winter-wheat': { fragile: false, basis: 'sourced' },
  'spring-wheat': { fragile: false, basis: 'sourced' },
  oats: { fragile: false, basis: 'sourced' },
  barley: { fragile: false, basis: 'sourced' },
  'cereal-rye': { fragile: false, basis: 'sourced' },
  soybeans: { fragile: true, basis: 'sourced' },
  sorghum: { fragile: false, basis: 'assumption' }, // corn-like stalks; not named in the note
  // Conservative: unknown counts as fragile (less cover), so missing data never helps a crop.
  canola: { fragile: true, basis: 'assumption' },
  sunflower: { fragile: true, basis: 'assumption' },
  'dry-beans': { fragile: true, basis: 'assumption' },
  cotton: { fragile: true, basis: 'assumption' },
};

// ---------------------------------------------------------------------------
// 4. Land suitability: FAO EcoCrop
// ---------------------------------------------------------------------------

/**
 * EcoCrop drainage codes as stored: E = excessively drained, W = well drained,
 * I = the wettest class EcoCrop records (imperfectly/poorly drained; confirm the
 * exact definition before mapping to SSURGO drainage classes).
 */
export type EcocropDrainage = 'E' | 'W' | 'I';

export interface LandSuitability {
  ecocropName: string;
  /** Plateau curve: 0 below min, 1 between optMin and optMax, 0 above max. Presumably pH in water. */
  ph: { min: number; optMin: number; optMax: number; max: number };
  drainage: { optimal: EcocropDrainage[]; tolerated: EcocropDrainage[] };
  /** °C. null where EcoCrop stores the 0 default. */
  killingTempC: number | null;
}

const ph = (min: number, optMin: number, optMax: number, max: number) => ({ min, optMin, optMax, max });

export const LAND_SUITABILITY: Record<string, LandSuitability> = {
  corn: { ecocropName: 'Dent maize (Zea mays v. indentata)', ph: ph(5.0, 5.5, 7.0, 8.0), drainage: { optimal: ['W'], tolerated: ['W'] }, killingTempC: null },
  soybeans: { ecocropName: 'Soyabean (Glycine max)', ph: ph(4.5, 5.5, 6.5, 8.4), drainage: { optimal: ['W'], tolerated: ['I', 'W', 'E'] }, killingTempC: null },
  'winter-wheat': { ecocropName: 'Wheat, common (Triticum aestivum)', ph: ph(5.5, 6.0, 7.0, 8.5), drainage: { optimal: ['W'], tolerated: ['W'] }, killingTempC: null },
  'spring-wheat': { ecocropName: 'Wheat, common (Triticum aestivum)', ph: ph(5.5, 6.0, 7.0, 8.5), drainage: { optimal: ['W'], tolerated: ['W'] }, killingTempC: null },
  sorghum: { ecocropName: 'Sorghum (Sorghum bicolor)', ph: ph(5.0, 6.0, 7.0, 8.5), drainage: { optimal: ['W'], tolerated: ['I', 'W', 'E'] }, killingTempC: null },
  cotton: { ecocropName: 'Cotton, American upland (Gossypium hirsutum)', ph: ph(5.0, 6.0, 7.5, 9.5), drainage: { optimal: ['W'], tolerated: ['W'] }, killingTempC: null },
  alfalfa: { ecocropName: 'Alfalfa (Medicago sativa)', ph: ph(5.5, 6.5, 7.5, 8.0), drainage: { optimal: ['W'], tolerated: ['W', 'E'] }, killingTempC: -25 },
  oats: { ecocropName: 'Oats (Avena sativa)', ph: ph(4.5, 5.0, 6.0, 7.5), drainage: { optimal: ['W'], tolerated: ['W'] }, killingTempC: -15 },
  barley: { ecocropName: 'Barley (Hordeum vulgare)', ph: ph(6.0, 6.5, 7.5, 8.0), drainage: { optimal: ['W'], tolerated: ['W'] }, killingTempC: -4 },
  sunflower: { ecocropName: 'Sunflower (Helianthus annuus)', ph: ph(5.5, 6.0, 7.5, 8.0), drainage: { optimal: ['W'], tolerated: ['W'] }, killingTempC: -10 },
  canola: { ecocropName: 'Swede rape (Brassica napus)', ph: ph(5.5, 6.5, 7.6, 8.0), drainage: { optimal: ['W'], tolerated: ['W'] }, killingTempC: -6 },
  'dry-beans': { ecocropName: 'Bean, common (Phaseolus vulgaris)', ph: ph(4.0, 5.5, 7.5, 9.0), drainage: { optimal: ['W'], tolerated: ['W'] }, killingTempC: null },
  'cereal-rye': { ecocropName: 'Rye (Secale cereale)', ph: ph(4.5, 5.5, 6.0, 8.0), drainage: { optimal: ['W'], tolerated: ['I', 'W', 'E'] }, killingTempC: null },
  // fallow: no suitability limits.
};

/**
 * HOW TO USE (design guidance, not data):
 *  - pH: soft yield multiplier from the plateau curve (1 inside opt range, linear
 *    down to 0 at min/max). Hard-exclude only outside min..max. If the paddock pH
 *    is unknown, skip and add an information gap.
 *  - Drainage: soft penalty when outside `optimal`, hard-exclude outside
 *    `tolerated`. Add a paddock input `tileDrained: boolean`; tiled ground should
 *    count as one class better drained, since much poorly drained US cropland is tiled.
 *  - killingTempC: do NOT use as a frost filter. It is null for most crops,
 *    including wheat (EcoCrop default), and is expert opinion. Frost risk for summer
 *    crops is better computed from NASA POWER daily minimum temperatures against
 *    the SEASONS span (frost-free window >= field span). Winter-crop hardiness
 *    stays a data gap.
 *  - EcoCrop wheat is one entry for both winter and spring wheat.
 */

// ---------------------------------------------------------------------------
// 5. State presence (Handbook 628)
// ---------------------------------------------------------------------------

/**
 * true = the crop has a row in Handbook 628 for that state. Absence does NOT mean
 * it cannot grow there, only that it is not a usual crop. Suggested use: a
 * severity-1 'land' warning ("Not a usual crop in Iowa; check local agronomy and
 * markets"), not an exclusion.
 */
export const STATE_PRESENCE: Record<string, Record<StateCode, boolean>> = {
  corn: { IA: true, KS: true },
  soybeans: { IA: true, KS: true },
  'winter-wheat': { IA: true, KS: true },
  'spring-wheat': { IA: false, KS: false },
  sorghum: { IA: false, KS: true },
  cotton: { IA: false, KS: true },
  alfalfa: { IA: true, KS: true },
  oats: { IA: true, KS: true },
  barley: { IA: false, KS: true },
  sunflower: { IA: false, KS: true },
  canola: { IA: false, KS: false },
  'dry-beans': { IA: false, KS: false },
  'cereal-rye': { IA: false, KS: false }, // as a grain crop; cover-crop use is not tracked by NASS here
};

// ---------------------------------------------------------------------------
// 6. Data gaps: replace / add to DATA_GAPS
// ---------------------------------------------------------------------------

export const DATA_GAPS_RESOLVED = [
  'Season spans for IA and KS (Handbook 628).',
  'Tillage residue retention (NRCS VA Technical Note Table 2) replaces the 0.3 / 0.6 / 0.9 placeholder.',
  'Residue factors for barley, oats and rye.',
  'pH ranges and drainage tolerance for all 13 crops (FAO EcoCrop, expert opinion).',
];

export const DATA_GAPS_ADDITIONS = [
  'Handbook 628 dates are from 2010; planting has trended earlier in some states. NASS Crop Progress 5-year averages would be more current.',
  'No IA/KS season rows for spring wheat, canola, dry beans or cereal rye (not usual crops there).',
  'Tillage system definitions (which operations each system means) are a design choice.',
  'Residue fragility for sorghum, canola, sunflower, dry beans and cotton is assumed (unknown counted as fragile).',
  'Residue factors still missing for canola, sunflower, dry beans, cotton and alfalfa.',
  'EcoCrop pH/drainage are expert opinion, global (not US-calibrated), and wheat is one entry for winter and spring.',
  'EcoCrop drainage class "I" needs its exact definition confirmed before mapping to SSURGO drainage classes.',
  'Frost/winter hardiness: EcoCrop killing temperatures are unusable for most crops (0 default). Summer-crop frost risk should come from NASA POWER minimum temperatures vs the season span.',
  'Slope has no crop-specific limit; it belongs in the erosion term (RUSLE LS factor), not crop suitability.',
];
