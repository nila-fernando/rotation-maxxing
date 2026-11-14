/**
 * Sourced US crop traits for the rotation-maxxing scoring algorithm.
 *
 * Compiled 14 Nov 2026. Every number points at an entry in SOURCES.
 * Anything we could NOT source is `null` and listed in DATA_GAPS. Do not fill
 * those in with guesses: add a source first.
 *
 * Read before using:
 *  - Yields are NATIONAL averages. Regional variation is huge (2025 corn:
 *    Kansas 145 bu/ac vs Iowa 210). Swap in state or county yields from
 *    NASS Quick Stats before trusting any paddock-level profit number.
 *  - 2026 yields are NASS forecasts as of 1 Nov 2026, not final.
 *  - 2025 prices are preliminary marketing-year averages (Feb 2026).
 *  - Price ranges cover only 3 marketing years (2023-2025), so they understate
 *    long-run volatility. Treat low/high as a floor on uncertainty.
 *  - Operating costs mix two sources (see costSource per crop). ERS costs are
 *    US averages that exclude crop insurance; NDSU costs are one North Dakota
 *    region and include crop insurance. They are close but not identical.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const SOURCES = {
  nassCropSummary2025: {
    title: 'USDA NASS, Crop Production 2025 Summary (Jan 2026)',
    url: 'https://esmis.nal.usda.gov/sites/default/release-files/795725/cropan26.txt',
    covers: '2023-2025 US yields for corn, sorghum, oats, barley, wheat classes, soybeans, cotton',
  },
  nassCropProductionNov2026: {
    title: 'USDA NASS, Crop Production (released 10 Nov 2026)',
    url: 'https://esmis.nal.usda.gov/sites/default/release-files/796144/crop1126.pdf',
    covers: 'Final 2025 and forecast 2026 US yields for all field crops incl. canola, sunflower, dry beans, alfalfa',
  },
  nassCropProductionAnnual2024: {
    title: 'USDA NASS, Crop Production 2024 Summary (Jan 2025)',
    url: 'https://esmis.nal.usda.gov/sites/default/release-files/k3569432s/nk324887m/vx023905r/cropan25.txt',
    covers: '2024 US canola and sunflower yields',
  },
  nassCropValues2025: {
    title: 'USDA NASS, Crop Values 2025 Summary (Feb 2026)',
    url: 'https://esmis.nal.usda.gov/sites/default/release-files/795791/cpvl0226.pdf',
    covers: '2023-2025 US marketing-year average prices received by farmers',
  },
  ersCostForecast2027: {
    title: 'USDA ERS, Cost-of-production forecasts for major U.S. field crops, 2026F-2027F (updated 10 Nov 2026)',
    url: 'https://www.ers.usda.gov/data-products/commodity-costs-and-returns',
    covers: 'US operating costs per planted acre: corn, soybeans, wheat, cotton, sorghum, oats, barley',
  },
  ndsuBudgets2026: {
    title: 'NDSU Extension, Projected 2026 Crop Budgets, East Central North Dakota (EC1658)',
    url: 'https://www.ndsu.edu/agriculture/sites/default/files/2026-02/ec1658.pdf',
    covers: 'Direct costs for canola, oil sunflower, dry beans; nitrogen price $0.58/lb',
  },
  fao56: {
    title: 'Allen et al. 1998, FAO Irrigation and Drainage Paper 56 (Tables 12 and 22), as transcribed in the pyfao56 package v1.4.3',
    url: 'https://www.fao.org/4/X0490e/x0490e0e.htm',
    covers: 'Max crop height, mid-season crop coefficient (Kc mid), max root depth, depletion fraction p',
  },
  fao61Salinity: {
    title: 'FAO Irrigation and Drainage Paper 61, Annex 1 (Maas & Grattan 1999 salt tolerance data)',
    url: 'https://www.fao.org/4/Y4263E/y4263e0e.htm',
    covers: 'Salinity threshold (ECe, dS/m), yield loss slope (% per dS/m) and rating',
  },
  seifert2017: {
    title: 'Seifert et al. 2017, Continuous corn and soybean yield penalties across hundreds of thousands of fields, Agronomy Journal 109',
    url: 'https://mssoy.org/sites/default/files/documents/seifert-et-al-agron-j-109-2017.pdf',
    covers: 'Field-scale continuous corn (4.3%) and continuous soybean (10.3%) yield penalties',
  },
  unlCropWatch2020: {
    title: 'UNL CropWatch 2020, Yield penalties for continuous corn and soybean in the Midwest',
    url: 'https://cropwatch.unl.edu/2020/yield-penalties-continuous-corn-and-soybean-midwest-us',
    covers: 'Penalty by years of continuous corn (about 2% year 1, about 5.5% for 2-4+ years)',
  },
  isuTillageRotation: {
    title: 'Iowa State University 10-year tillage x rotation study, 7 locations, 2003-2013 (Al-Kaisi), via Farm Progress',
    url: 'https://www.farmprogress.com/farming-equipment/tillage-study-corn-soybean-rotation-wins-0',
    covers: 'Plot-trial continuous corn yield drag of 11-28% vs corn-soybean',
  },
  uwLegumeCredits: {
    title: 'University of Wisconsin, Using Legumes as a Nitrogen Source (A3517)',
    url: 'https://ipcm.wisc.edu/wp-content/uploads/sites/54/2022/11/Usinglegumes.pdf',
    covers: 'First-year N credits: soybean 40, alfalfa 130-190 by stand, dry bean 20 lb N/ac',
  },
  mdaLegumeCredits: {
    title: 'Minnesota Dept. of Agriculture, N credits for previous crops (first-year corn)',
    url: 'https://www.mda.state.mn.us/sites/default/files/inline-files/gwprsonarappendixes.pdf',
    covers: 'First-year N credits: soybean 30, harvested alfalfa 100, edible bean 20 lb N/ac',
  },
  cpnWhiteMold: {
    title: 'Crop Protection Network, An Overview of White Mold',
    url: 'https://cropprotectionnetwork.org/publications/an-overview-of-white-mold',
    covers: 'Broadleaf hosts; 2-3 years of non-host (corn, small grains) to reduce sclerotia',
  },
  ndsuWhiteMoldHosts: {
    title: 'NDSU Extension, White mold (Sclerotinia stem rot) disease focus',
    url: 'https://www.ag.ndsu.edu/greenhouse/willistonrec/DISEASETOKEEPANEYEONupdate.pdf',
    covers: 'Hosts incl. sunflower, dry bean, soybean, canola, alfalfa',
  },
  manitobaScn: {
    title: 'Manitoba Agriculture, disease update (east): soybean cyst nematode hosts',
    url: 'https://prodtracs.gov.mb.ca/agriculture/crops/seasonal-reports/pubs/update-diseases-east.pdf',
    covers: 'SCN host crops: soybean, dry edible beans, field peas',
  },
  isuRotationEcon: {
    title: 'Iowa State Ag Decision Maker newsletter (Dec 2011), corn/soybean rotation economics',
    url: 'https://pubdev.silo.lib.ia.us/16704/1/nldec11.pdf',
    covers: 'Corn after soybean generally needs no rootworm control and less N',
  },
  isuA120_2026: {
    title: 'Hart 2026, Iowa State University Ag Decision Maker A1-20, Estimated Costs of Crop Production in Iowa-2026 (pp. 9-10)',
    url: 'https://www.extension.iastate.edu/agdm/crops/pdf/a1-20.pdf',
    covers: 'Alfalfa hay variable cost: established stand, 4 t/ac, large round bales $242.56/ac; establishment with oat companion $169.89/ac',
  },
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

export type SourceId = keyof typeof SOURCES;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type YieldUnit = 'bu' | 'lb' | 'ton';

/** Two-letter USPS state code, e.g. 'IA', 'KS'. */
export type StateCode = string;

/** Month numbers 1-12. A span may wrap the new year (winter wheat: 10 -> 7). */
export interface SeasonSpan {
  plantMonth: number;
  harvestMonth: number;
  /** Exact dates when known ('MM-DD'), e.g. from Handbook 628. */
  plantDate?: string;
  harvestDate?: string;
  /** Evidence id for the span. */
  source?: string;
}

/**
 * Broad season class. Used only to pick a fallback span when the farm's state
 * has no Handbook 628 entry yet (see seasons.ts). This is a classification,
 * not a measured value.
 */
export type SeasonType = 'summer' | 'winter' | 'perennial' | 'none';

export interface Sourced<T> {
  value: T;
  source: SourceId | SourceId[] | null;
  note?: string;
}

export interface CropTraits {
  id: string;
  name: string;
  family: 'grain' | 'oilseed' | 'legume' | 'forage' | 'fiber' | 'cover' | 'fallow';
  yieldUnit: YieldUnit | null;

  /** US average yield per harvested acre; `byYear` keeps the raw numbers. */
  yieldPerAcre: Sourced<{ typical: number; min: number; max: number; byYear: Record<string, number> }> | null;

  /** US marketing-year average price per yieldUnit, 2023-2025. */
  pricePerUnit: Sourced<{ typical: number; low: number; high: number; byYear: Record<string, number> }> | null;

  /** Operating (variable) cost, $ per planted acre. */
  operatingCostPerAcre: Sourced<number> | null;

  /** FAO-56 Table 12 maximum crop height, metres. */
  maxHeightM: Sourced<number> | null;

  /** FAO-56 Table 12 mid-season crop coefficient (relative water use at full canopy). */
  kcMid: Sourced<number> | null;

  /** FAO-56 Table 22 maximum effective root depth range, metres. */
  rootDepthM: Sourced<{ min: number; max: number }> | null;

  /** FAO-56 Table 22 depletion fraction p: higher = tolerates drier soil before stress. */
  depletionFractionP: Sourced<number> | null;

  /** Maas-Hoffman salt tolerance: yield % = 100 - slope * (ECe - threshold). */
  salinity: Sourced<{ thresholdECe: number | null; slopePctPerDsM: number | null; rating: 'S' | 'MS' | 'MT' | 'T' }> | null;

  /** N credit to the FOLLOWING corn crop, lb N/acre. */
  nCreditToNextCornLbPerAcre: Sourced<{ low: number; high: number }> | null;

  /** Pest/disease groups this crop hosts (keys of PEST_GROUPS). */
  hostsPestGroups: string[];

  /** Broad season class (fallback when `season` has no entry for the state). */
  seasonType: SeasonType;

  /**
   * Usual planting and harvest months BY STATE, from USDA Ag Handbook 628.
   * Empty until a teammate enters values (IA and KS first).
   */
  season: Record<StateCode, SeasonSpan>;

  /**
   * Optional: the months when shade hurts this crop most. When present, shade
   * uses these months (not the whole season) for the sun angle and for the
   * season-overlap check. A design choice, not sourced data.
   */
  sensitiveMonths?: SeasonSpan;

  /**
   * DESIGN DECISION (not data): true for specialty crops that should only be
   * recommended when the farmer has a confirmed buyer or contract
   * (Farm.confirmedBuyers). Thin local markets make an uncontracted crop risky.
   */
  requiresBuyer?: boolean;

  /** Not yet sourced. Keep null until a source is added. */
  shadeTolerance: null;
  frostTolerance: null;
  waterloggingTolerance: null;
  phRange: null;
}

const unsourced = {
  shadeTolerance: null,
  frostTolerance: null,
  waterloggingTolerance: null,
  phRange: null,
} as const;

const YIELD_SRC: SourceId[] = ['nassCropSummary2025', 'nassCropProductionNov2026'];

// ---------------------------------------------------------------------------
// Crops
// ---------------------------------------------------------------------------

export const CROPS: CropTraits[] = [
  {
    id: 'corn',
    name: 'Corn (grain)',
    family: 'grain',
    yieldUnit: 'bu',
    yieldPerAcre: {
      value: { typical: 180.7, min: 177.3, max: 186.5, byYear: { '2023': 177.3, '2024': 179.3, '2025': 186.5, '2026F': 179.6 } },
      source: YIELD_SRC,
    },
    pricePerUnit: {
      value: { typical: 4.30, low: 4.10, high: 4.55, byYear: { '2023': 4.55, '2024': 4.24, '2025': 4.10 } },
      source: 'nassCropValues2025',
    },
    operatingCostPerAcre: { value: 505.98, source: 'ersCostForecast2027', note: '2027 forecast, US total; fertilizer alone is $203.40' },
    maxHeightM: { value: 2.0, source: 'fao56' },
    kcMid: { value: 1.20, source: 'fao56' },
    rootDepthM: { value: { min: 1.0, max: 1.7 }, source: 'fao56' },
    depletionFractionP: { value: 0.55, source: 'fao56' },
    salinity: { value: { thresholdECe: 1.7, slopePctPerDsM: 12, rating: 'MS' }, source: 'fao61Salinity' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: ['cornRootworm'],
    seasonType: 'summer',
    season: {
      IA: { plantMonth: 4, harvestMonth: 11, plantDate: '04-25', harvestDate: '11-09', source: 'nassHandbook628' },
      KS: { plantMonth: 4, harvestMonth: 10, plantDate: '04-15', harvestDate: '10-25', source: 'nassHandbook628' },
    }, // Handbook 628 span: plant.activeStart -> harvest.activeEnd (SEASON_SPAN_RULE)
    ...unsourced,
  },
  {
    id: 'soybeans',
    name: 'Soybeans',
    family: 'legume',
    yieldUnit: 'bu',
    yieldPerAcre: {
      value: { typical: 52.3, min: 50.7, max: 53.3, byYear: { '2024': 50.7, '2025': 53.0, '2026F': 53.3 } },
      source: YIELD_SRC,
      note: '2024 derived from the report text (2025 was "up 2.3 bushels from 2024")',
    },
    pricePerUnit: {
      value: { typical: 10.87, low: 10.00, high: 12.40, byYear: { '2023': 12.40, '2024': 10.00, '2025': 10.20 } },
      source: 'nassCropValues2025',
    },
    operatingCostPerAcre: { value: 273.92, source: 'ersCostForecast2027', note: '2027 forecast, US total' },
    maxHeightM: { value: 0.75, source: 'fao56', note: 'FAO range 0.5-1.0 m; pyfao56 uses 0.75' },
    kcMid: { value: 1.15, source: 'fao56' },
    rootDepthM: { value: { min: 0.6, max: 1.3 }, source: 'fao56' },
    depletionFractionP: { value: 0.50, source: 'fao56' },
    salinity: { value: { thresholdECe: 5.0, slopePctPerDsM: 20, rating: 'MT' }, source: 'fao61Salinity' },
    nCreditToNextCornLbPerAcre: { value: { low: 30, high: 40 }, source: ['mdaLegumeCredits', 'uwLegumeCredits'] },
    hostsPestGroups: ['soybeanCystNematode', 'whiteMold'],
    seasonType: 'summer',
    season: {
      IA: { plantMonth: 5, harvestMonth: 10, plantDate: '05-08', harvestDate: '10-20', source: 'nassHandbook628' },
      KS: { plantMonth: 5, harvestMonth: 11, plantDate: '05-15', harvestDate: '11-01', source: 'nassHandbook628' },
    }, // Handbook 628 span: plant.activeStart -> harvest.activeEnd (SEASON_SPAN_RULE)
    ...unsourced,
  },
  {
    id: 'winter-wheat',
    name: 'Winter wheat',
    family: 'grain',
    yieldUnit: 'bu',
    yieldPerAcre: {
      value: { typical: 51.5, min: 48.8, max: 54.9, byYear: { '2023': 50.6, '2024': 51.7, '2025': 54.9, '2026F': 48.8 } },
      source: YIELD_SRC,
    },
    pricePerUnit: {
      value: { typical: 5.61, low: 4.75, high: 6.69, byYear: { '2023': 6.69, '2024': 5.39, '2025': 4.75 } },
      source: 'nassCropValues2025',
    },
    operatingCostPerAcre: { value: 182.55, source: 'ersCostForecast2027', note: 'ERS reports all wheat together' },
    maxHeightM: { value: 1.0, source: 'fao56' },
    kcMid: { value: 1.15, source: 'fao56' },
    rootDepthM: { value: { min: 1.5, max: 1.8 }, source: 'fao56' },
    depletionFractionP: { value: 0.55, source: 'fao56' },
    salinity: { value: { thresholdECe: 6.0, slopePctPerDsM: 7.1, rating: 'MT' }, source: 'fao61Salinity', note: 'Semi-dwarf wheat is more tolerant: 8.6 / 3.0, T' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: [],
    seasonType: 'winter',
    season: {
      IA: { plantMonth: 9, harvestMonth: 7, plantDate: '09-26', harvestDate: '07-22', source: 'nassHandbook628' },
      KS: { plantMonth: 9, harvestMonth: 7, plantDate: '09-15', harvestDate: '07-05', source: 'nassHandbook628' },
    }, // Handbook 628 span: plant.activeStart -> harvest.activeEnd (SEASON_SPAN_RULE)
    sensitiveMonths: { plantMonth: 4, harvestMonth: 6 }, // design choice: spring growth to grain fill (Apr-Jun)
    ...unsourced,
  },
  {
    id: 'spring-wheat',
    name: 'Spring wheat (other spring)',
    family: 'grain',
    yieldUnit: 'bu',
    yieldPerAcre: {
      value: { typical: 49.5, min: 46.0, max: 52.4, byYear: { '2023': 46.0, '2024': 52.4, '2025': 51.6, '2026F': 48.0 } },
      source: YIELD_SRC,
    },
    pricePerUnit: {
      value: { typical: 6.01, low: 5.20, high: 7.15, byYear: { '2023': 7.15, '2024': 5.68, '2025': 5.20 } },
      source: 'nassCropValues2025',
    },
    operatingCostPerAcre: { value: 182.55, source: 'ersCostForecast2027', note: 'ERS reports all wheat together' },
    maxHeightM: { value: 1.0, source: 'fao56' },
    kcMid: { value: 1.15, source: 'fao56' },
    rootDepthM: { value: { min: 1.0, max: 1.5 }, source: 'fao56' },
    depletionFractionP: { value: 0.55, source: 'fao56' },
    salinity: { value: { thresholdECe: 6.0, slopePctPerDsM: 7.1, rating: 'MT' }, source: 'fao61Salinity' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: [],
    seasonType: 'summer',
    season: {}, // no IA/KS row in Handbook 628
    ...unsourced,
  },
  {
    id: 'sorghum',
    name: 'Grain sorghum',
    family: 'grain',
    yieldUnit: 'bu',
    yieldPerAcre: {
      value: { typical: 59.6, min: 52.0, max: 72.6, byYear: { '2023': 52.0, '2024': 61.3, '2025': 72.6, '2026F': 52.4 } },
      source: YIELD_SRC,
    },
    pricePerUnit: {
      value: { typical: 4.21, low: 3.61, high: 4.93, byYear: { '2023': 4.93, '2024': 4.07, '2025': 3.61 } },
      source: 'nassCropValues2025',
      note: 'NASS reports $/cwt (8.81, 7.27, 6.45); converted at 56 lb/bu',
    },
    operatingCostPerAcre: { value: 203.51, source: 'ersCostForecast2027' },
    maxHeightM: { value: 1.5, source: 'fao56', note: 'FAO range 1-2 m; pyfao56 uses 1.5' },
    kcMid: { value: 1.05, source: 'fao56' },
    rootDepthM: { value: { min: 1.0, max: 2.0 }, source: 'fao56' },
    depletionFractionP: { value: 0.55, source: 'fao56' },
    salinity: { value: { thresholdECe: 6.8, slopePctPerDsM: 16, rating: 'MT' }, source: 'fao61Salinity' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: [],
    seasonType: 'summer',
    season: {
      KS: { plantMonth: 5, harvestMonth: 11, plantDate: '05-15', harvestDate: '11-10', source: 'nassHandbook628' },
    }, // Handbook 628 span: plant.activeStart -> harvest.activeEnd (SEASON_SPAN_RULE)
    ...unsourced,
  },
  {
    id: 'cotton',
    name: 'Cotton (upland)',
    family: 'fiber',
    yieldUnit: 'lb',
    yieldPerAcre: {
      value: { typical: 837.7, min: 775, max: 886, byYear: { '2024': 886, '2025': 852, '2026F': 775 } },
      source: YIELD_SRC,
      note: 'Lint, all cotton. Cottonseed revenue (~$240/ton in 2025) is NOT included in this price',
    },
    pricePerUnit: {
      value: { typical: 0.663, low: 0.595, high: 0.761, byYear: { '2023': 0.761, '2024': 0.632, '2025': 0.595 } },
      source: 'nassCropValues2025',
      note: 'Upland lint; 2025 based on Aug-Dec 2025 marketings only',
    },
    operatingCostPerAcre: { value: 617.40, source: 'ersCostForecast2027' },
    maxHeightM: { value: 1.35, source: 'fao56', note: 'FAO range 1.2-1.5 m' },
    kcMid: { value: 1.17, source: 'fao56' },
    rootDepthM: { value: { min: 1.0, max: 1.7 }, source: 'fao56' },
    depletionFractionP: { value: 0.65, source: 'fao56' },
    salinity: { value: { thresholdECe: 7.7, slopePctPerDsM: 5.2, rating: 'T' }, source: 'fao61Salinity' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: [],
    seasonType: 'summer',
    season: {
      KS: { plantMonth: 5, harvestMonth: 12, plantDate: '05-20', harvestDate: '12-15', source: 'nassHandbook628' },
    }, // Handbook 628 span: plant.activeStart -> harvest.activeEnd (SEASON_SPAN_RULE)
    ...unsourced,
  },
  {
    id: 'alfalfa',
    name: 'Alfalfa (hay)',
    family: 'forage',
    yieldUnit: 'ton',
    yieldPerAcre: {
      value: { typical: 3.43, min: 3.42, max: 3.44, byYear: { '2025': 3.42, '2026F': 3.44 } },
      source: 'nassCropProductionNov2026',
      note: 'Dry hay. Perennial: model as a multi-year stand with establishment-year losses',
    },
    pricePerUnit: {
      value: { typical: 190, low: 170, high: 225, byYear: { '2023': 225, '2024': 175, '2025': 170 } },
      source: 'nassCropValues2025',
      note: 'Baled alfalfa hay, $/ton',
    },
    operatingCostPerAcre: {
      value: 242.56,
      source: 'isuA120_2026',
      note: 'Iowa 2026 variable cost, established stand at 4 t/ac. Establishment year ($169.89 with oats) is not modelled separately',
    },
    maxHeightM: { value: 0.7, source: 'fao56' },
    kcMid: { value: 0.95, source: 'fao56', note: 'Averaged over cutting cycles' },
    rootDepthM: { value: { min: 1.0, max: 2.0 }, source: 'fao56' },
    depletionFractionP: { value: 0.55, source: 'fao56' },
    salinity: { value: { thresholdECe: 2.0, slopePctPerDsM: 7.3, rating: 'MS' }, source: 'fao61Salinity' },
    nCreditToNextCornLbPerAcre: {
      value: { low: 100, high: 190 },
      source: ['mdaLegumeCredits', 'uwLegumeCredits'],
      note: 'Depends on stand density; UW gives 190/160/130 for good/fair/poor stands, plus ~50 in year 2',
    },
    hostsPestGroups: ['whiteMold'],
    seasonType: 'perennial',
    season: {
      IA: { plantMonth: 5, harvestMonth: 9, harvestDate: '09-15', source: 'nassHandbook628' },
      KS: { plantMonth: 5, harvestMonth: 10, harvestDate: '10-15', source: 'nassHandbook628' },
    }, // Handbook 628 span: plant.activeStart -> harvest.activeEnd (SEASON_SPAN_RULE)
    ...unsourced,
  },
  {
    id: 'oats',
    name: 'Oats',
    family: 'grain',
    yieldUnit: 'bu',
    yieldPerAcre: {
      value: { typical: 73.5, min: 68.6, max: 76.4, byYear: { '2023': 68.6, '2024': 76.4, '2025': 73.8, '2026F': 75.3 } },
      source: YIELD_SRC,
    },
    pricePerUnit: {
      value: { typical: 3.49, low: 3.20, high: 3.92, byYear: { '2023': 3.92, '2024': 3.35, '2025': 3.20 } },
      source: 'nassCropValues2025',
    },
    operatingCostPerAcre: { value: 197.58, source: 'ersCostForecast2027' },
    maxHeightM: { value: 1.0, source: 'fao56' },
    kcMid: { value: 1.15, source: 'fao56' },
    rootDepthM: { value: { min: 1.0, max: 1.5 }, source: 'fao56' },
    depletionFractionP: { value: 0.55, source: 'fao56' },
    salinity: { value: { thresholdECe: null, slopePctPerDsM: null, rating: 'T' }, source: 'fao61Salinity', note: 'Rated tolerant; no threshold/slope published' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: [],
    seasonType: 'summer',
    season: {
      IA: { plantMonth: 4, harvestMonth: 8, plantDate: '04-02', harvestDate: '08-05', source: 'nassHandbook628' },
      KS: { plantMonth: 3, harvestMonth: 8, plantDate: '03-05', harvestDate: '08-01', source: 'nassHandbook628' },
    }, // Handbook 628 span: plant.activeStart -> harvest.activeEnd (SEASON_SPAN_RULE)
    ...unsourced,
  },
  {
    id: 'barley',
    name: 'Barley',
    family: 'grain',
    yieldUnit: 'bu',
    yieldPerAcre: {
      value: { typical: 75.2, min: 72.1, max: 79.9, byYear: { '2023': 72.3, '2024': 76.6, '2025': 79.9, '2026F': 72.1 } },
      source: YIELD_SRC,
    },
    pricePerUnit: {
      value: { typical: 6.37, low: 5.40, high: 7.39, byYear: { '2023': 7.39, '2024': 6.31, '2025': 5.40 } },
      source: 'nassCropValues2025',
      note: 'US average includes malting premiums. NDSU uses ~$3.00 if malting quality is missed',
    },
    operatingCostPerAcre: { value: 219.09, source: 'ersCostForecast2027' },
    maxHeightM: { value: 1.0, source: 'fao56' },
    kcMid: { value: 1.15, source: 'fao56' },
    rootDepthM: { value: { min: 1.0, max: 1.5 }, source: 'fao56' },
    depletionFractionP: { value: 0.55, source: 'fao56' },
    salinity: { value: { thresholdECe: 8.0, slopePctPerDsM: 5.0, rating: 'T' }, source: 'fao61Salinity', note: 'Less tolerant as a seedling: keep ECe under 4-5' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: [],
    seasonType: 'summer',
    season: {
      KS: { plantMonth: 3, harvestMonth: 7, plantDate: '03-05', harvestDate: '07-01', source: 'nassHandbook628' },
    }, // Handbook 628 span: plant.activeStart -> harvest.activeEnd (SEASON_SPAN_RULE)
    ...unsourced,
  },
  {
    id: 'sunflower',
    name: 'Sunflower (oil)',
    family: 'oilseed',
    yieldUnit: 'lb',
    yieldPerAcre: {
      value: { typical: 1764, min: 1670, max: 1861, byYear: { '2024': 1670, '2025': 1861, '2026F': 1761 } },
      source: ['nassCropProductionAnnual2024', 'nassCropProductionNov2026'],
    },
    pricePerUnit: {
      value: { typical: 0.2263, low: 0.212, high: 0.238, byYear: { '2023': 0.212, '2024': 0.238, '2025': 0.229 } },
      source: 'nassCropValues2025',
      note: 'All sunflower; NASS reports $/cwt (21.20, 23.80, 22.90)',
    },
    operatingCostPerAcre: { value: 227.96, source: 'ndsuBudgets2026', note: 'East Central ND, oil sunflower, includes crop insurance' },
    maxHeightM: { value: 2.0, source: 'fao56' },
    kcMid: { value: 1.10, source: 'fao56' },
    rootDepthM: { value: { min: 0.8, max: 1.5 }, source: 'fao56' },
    depletionFractionP: { value: 0.45, source: 'fao56' },
    salinity: { value: { thresholdECe: 4.8, slopePctPerDsM: 5.0, rating: 'MT' }, source: 'fao61Salinity' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: ['whiteMold'],
    seasonType: 'summer',
    season: {
      KS: { plantMonth: 5, harvestMonth: 11, plantDate: '05-25', harvestDate: '11-15', source: 'nassHandbook628' },
    }, // Handbook 628 span: plant.activeStart -> harvest.activeEnd (SEASON_SPAN_RULE)
    requiresBuyer: true, // design decision: needs a confirmed buyer
    ...unsourced,
  },
  {
    id: 'canola',
    name: 'Canola',
    family: 'oilseed',
    yieldUnit: 'lb',
    yieldPerAcre: {
      value: { typical: 1871, min: 1784, max: 2017, byYear: { '2024': 1784, '2025': 2017, '2026F': 1811 } },
      source: ['nassCropProductionAnnual2024', 'nassCropProductionNov2026'],
    },
    pricePerUnit: {
      value: { typical: 0.2167, low: 0.202, high: 0.243, byYear: { '2023': 0.243, '2024': 0.202, '2025': 0.205 } },
      source: 'nassCropValues2025',
      note: 'NASS reports $/cwt (24.30, 20.20, 20.50)',
    },
    operatingCostPerAcre: { value: 252.24, source: 'ndsuBudgets2026', note: 'East Central ND, includes crop insurance' },
    maxHeightM: { value: 0.6, source: 'fao56' },
    kcMid: { value: 1.10, source: 'fao56' },
    rootDepthM: { value: { min: 1.0, max: 1.5 }, source: 'fao56' },
    depletionFractionP: { value: 0.60, source: 'fao56' },
    salinity: { value: { thresholdECe: 11.0, slopePctPerDsM: 13, rating: 'T' }, source: 'fao61Salinity', note: 'B. napus; B. rapa is 9.7 / 14' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: ['whiteMold'],
    seasonType: 'summer',
    season: {}, // no IA/KS row in Handbook 628
    requiresBuyer: true, // design decision: needs a confirmed buyer
    ...unsourced,
  },
  {
    id: 'dry-beans',
    name: 'Dry edible beans',
    family: 'legume',
    yieldUnit: 'lb',
    yieldPerAcre: {
      value: { typical: 1974, min: 1935, max: 2012, byYear: { '2025': 2012, '2026F': 1935 } },
      source: 'nassCropProductionNov2026',
    },
    pricePerUnit: {
      value: { typical: 0.363, low: 0.302, high: 0.418, byYear: { '2023': 0.418, '2024': 0.369, '2025': 0.302 } },
      source: 'nassCropValues2025',
      note: 'NASS reports $/cwt (41.80, 36.90, 30.20). Prices vary a lot by market class (pinto, navy, black)',
    },
    operatingCostPerAcre: { value: 296.59, source: 'ndsuBudgets2026', note: 'East Central ND, includes crop insurance' },
    maxHeightM: { value: 0.4, source: 'fao56' },
    kcMid: { value: 1.15, source: 'fao56' },
    rootDepthM: { value: { min: 0.6, max: 0.9 }, source: 'fao56' },
    depletionFractionP: { value: 0.45, source: 'fao56' },
    salinity: { value: { thresholdECe: 1.0, slopePctPerDsM: 19, rating: 'S' }, source: 'fao61Salinity' },
    nCreditToNextCornLbPerAcre: { value: { low: 20, high: 20 }, source: ['mdaLegumeCredits', 'uwLegumeCredits'] },
    hostsPestGroups: ['soybeanCystNematode', 'whiteMold'],
    seasonType: 'summer',
    season: {}, // no IA/KS row in Handbook 628
    requiresBuyer: true, // design decision: needs a confirmed buyer
    ...unsourced,
  },
  {
    id: 'cereal-rye',
    name: 'Cereal rye (cover crop)',
    family: 'cover',
    yieldUnit: null,
    yieldPerAcre: null,
    pricePerUnit: null,
    operatingCostPerAcre: null,
    maxHeightM: null,
    kcMid: null,
    rootDepthM: null,
    depletionFractionP: null,
    salinity: { value: { thresholdECe: 11.4, slopePctPerDsM: 10.8, rating: 'T' }, source: 'fao61Salinity', note: 'Grain-yield basis' },
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: [],
    seasonType: 'winter',
    season: {}, // no IA/KS row in Handbook 628
    ...unsourced,
  },
  {
    id: 'fallow',
    name: 'Fallow',
    family: 'fallow',
    yieldUnit: null,
    yieldPerAcre: null,
    pricePerUnit: null,
    operatingCostPerAcre: null,
    maxHeightM: null,
    kcMid: null,
    rootDepthM: null,
    depletionFractionP: null,
    salinity: null,
    nCreditToNextCornLbPerAcre: null,
    hostsPestGroups: [],
    seasonType: 'none',
    season: {}, // no IA/KS row in Handbook 628
    ...unsourced,
  },
];

export const CROP_BY_ID: Record<string, CropTraits> = Object.fromEntries(CROPS.map((c) => [c.id, c]));

/** Optional: cereal rye harvested for GRAIN instead of as a cover. */
export const CEREAL_RYE_GRAIN = {
  yieldPerAcre: { value: { typical: 36.8, byYear: { '2025': 36.6, '2026F': 37.0 } }, source: 'nassCropProductionNov2026' as SourceId },
  pricePerUnit: { value: { typical: 5.73, low: 4.75, high: 6.61, byYear: { '2023': 6.61, '2024': 5.82, '2025': 4.75 } }, source: 'nassCropValues2025' as SourceId },
  operatingCostPerAcre: { value: 167.16, source: 'ndsuBudgets2026' as SourceId, note: 'Grain rye, East Central ND' },
};

// ---------------------------------------------------------------------------
// Economics constants
// ---------------------------------------------------------------------------

export const NITROGEN_PRICE_PER_LB: Sourced<number> = {
  value: 0.58,
  source: 'ndsuBudgets2026',
  note: 'Use to value N credits: credit lb x price = $ saved per acre',
};

// ---------------------------------------------------------------------------
// Rotation effects (yield multipliers)
// ---------------------------------------------------------------------------

export const ROTATION_EFFECTS = {
  /** Corn after corn, vs corn after soybean. Field-scale numbers are the default. */
  continuousCornPenalty: {
    value: { firstYear: 0.02, secondYearPlus: 0.055, average: 0.043, plotTrialRange: [0.11, 0.28] as const },
    source: ['seifert2017', 'unlCropWatch2020', 'isuTillageRotation'] as SourceId[],
    note: 'Field data (748k records) show smaller penalties than plot trials. Penalty is larger in dry, low-yield areas',
  },
  /** Soybean after soybean, vs rotated soybean. */
  continuousSoybeanPenalty: {
    value: { average: 0.103 },
    source: 'seifert2017' as SourceId,
    note: 'Worse in low-yield years and keeps increasing up to 5 years of continuous soybean',
  },
};

// ---------------------------------------------------------------------------
// Pest and disease groups
// ---------------------------------------------------------------------------

export const PEST_GROUPS = {
  whiteMold: {
    name: 'White mold (Sclerotinia sclerotiorum)',
    hosts: ['soybeans', 'dry-beans', 'canola', 'sunflower', 'alfalfa'],
    nonHosts: ['corn', 'winter-wheat', 'spring-wheat', 'oats', 'barley'],
    recommendedBreakYears: { value: { min: 2, max: 3 }, source: 'cpnWhiteMold' as SourceId },
    source: ['cpnWhiteMold', 'ndsuWhiteMoldHosts'] as SourceId[],
    note: 'Sunflower is very susceptible and fungicides are generally not effective on it',
  },
  soybeanCystNematode: {
    name: 'Soybean cyst nematode (SCN)',
    hosts: ['soybeans', 'dry-beans'],
    source: 'manitobaScn' as SourceId,
    note: 'Field peas are also hosts (not in this crop list). Spread by soil on equipment',
  },
  cornRootworm: {
    name: 'Corn rootworm',
    hosts: ['corn'],
    source: 'isuRotationEcon' as SourceId,
    note: 'Corn after soybean generally needs no rootworm control; continuous corn does',
  },
};

// ---------------------------------------------------------------------------
// What we could not source 
// ---------------------------------------------------------------------------

export const DATA_GAPS = [
  'Shade tolerance for every crop: no standard field-crop dataset found. Needs literature per crop.',
  'Frost tolerance / winter hardiness: not sourced (EcoCrop killing temperatures are unusable).',
  'Alfalfa cost is an Iowa budget (established stand, 4 t/ac) set against a national yield; establishment-year cost and yield are not modelled separately.',
  'Cereal rye cover crop cost is the SARE median for all cover crops; fallow field operations are not costed.',
  'Cereal rye cover crop: height, root depth, water use (FAO-56 has no cereal rye row).',
  'Cottonseed revenue is missing from cotton gross margin.',
  'Rotation yield effects beyond corn and soybean (e.g. wheat after soybean, sorghum, sunflower).',
  'Fusarium head blight risk for wheat/barley after corn: widely cited, but no source captured here yet.',
  'Canola, sunflower and dry bean costs are North Dakota only, and include crop insurance (ERS costs do not).',
  'Price volatility: only 3 marketing years. Pull 10+ years from NASS Quick Stats for the Monte Carlo.',
  'All yields are national. Replace with state or county yields for the farm location.',
  'Season spans by state: only Iowa and Kansas are entered (Handbook 628); other states use fallback spans.',
  'Dry bean margin compares a national yield and US price against a North Dakota cost, so it is likely overstated.',
  'Legume N credits to wheat and sorghum are not modelled (credits currently go to following corn only).',
  'Fallow field operations (weed control, tillage passes) are not costed: fallow cost is shown as $0.',
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

// ===========================================================================
// Merged from the Nov 2026 traits update (Handbook 628, NRCS residue/tillage,
// FAO EcoCrop, state presence). Same rule: unsourced values are null or tagged
// 'assumption' / 'design'.
// ===========================================================================

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

/** States with Handbook 628 rows entered so far. */
export type HandbookState = 'IA' | 'KS';

const w = (begin: string, activeStart: string | null, activeEnd: string | null, end: string): DateWindow => ({
  begin,
  activeStart,
  activeEnd,
  end,
});

/** Keyed by cropTraits ids. A missing state means the crop has no row for that state. */
export const SEASONS: Record<string, Partial<Record<HandbookState, StateSeason>>> = {
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
export const STATE_PRESENCE: Record<string, Record<HandbookState, boolean>> = {
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

// Gaps closed by the update (kept for the record).
export const DATA_GAPS_RESOLVED = [
  'Season spans for IA and KS (Handbook 628).',
  'Tillage residue retention (NRCS VA Technical Note Table 2) replaces the 0.3 / 0.6 / 0.9 placeholder.',
  'Residue factors for barley, oats and rye.',
  'pH ranges and drainage tolerance for all 13 crops (FAO EcoCrop, expert opinion).',
];
