/**
 * Shared types for the rotation scoring algorithm.
 *
 * Units: acres, US yield units (bu, lb, ton), dollars, lb N. Paddock geometry
 * is metres in a local frame with +y pointing north (lat/lng input is
 * converted on the way in, see geometry.ts).
 */
import type { CropTraits, StateCode } from './croptraits';

export type { CropTraits, StateCode } from './croptraits';

export type CropId = string;
export type PaddockId = string;

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

/**
 * Where a number comes from, so the mascot (and judges) can tell data from
 * modelling choices.
 *  - sourced:     straight from croptraits.ts / soilData.ts with a citation
 *  - input:       supplied by the farmer or the caller (market, weather, land)
 *  - design:      a tunable modelling constant (constants.ts), not data
 *  - placeholder: a stand-in value waiting for a source
 *  - proxy:       a stand-in measure for something we can't model yet
 *  - assumption:  a fallback used because the data is missing (see gaps)
 */
export type Basis = 'sourced' | 'input' | 'design' | 'placeholder' | 'proxy' | 'assumption';

/** One labelled piece of a score. Every number shown to a farmer is a sum or product of these. */
export interface Term {
  label: string;
  value: number;
  unit: string;
  basis: Basis;
  /**
   * Evidence: ids of the sources behind this number (keys of SOURCES in
   * croptraits.ts, SOIL_SOURCES in soilData.ts, or DATA_SOURCES in
   * evidence.ts, e.g. 'nasaPower', 'ssurgo'). Absent for design terms.
   */
  sources?: string[];
}

/** A labelled multiplicative factor, e.g. 0.945 for a 5.5% yield drag. */
export interface Factor {
  label: string;
  factor: number;
  basis: Basis;
  sources?: string[];
}

// ---------------------------------------------------------------------------
// Farm
// ---------------------------------------------------------------------------

export type Tillage = 'conventional' | 'reduced' | 'noTill';
export type Drainage = 'poor' | 'moderate' | 'good' | 'excessive';
export type Texture = 'sand' | 'loam' | 'silt' | 'clay';

export interface Land {
  slopePct: number;
  texture: Texture;
  drainage: Drainage;
  /** Soil salinity as saturated-paste electrical conductivity, dS/m. */
  salinityECe: number;
  /** Soil pH (1:1 water). Null/absent when unknown: pH suitability is then skipped, with a gap. */
  ph?: number | null;
  /** Optional, from SSURGO: root-zone available water capacity, in/in (= cm/cm). Enables the water balance. */
  awcInPerIn?: number;
  /** Optional, from SSURGO: RUSLE soil erodibility K (surface horizon kffact). */
  kFactor?: number;
  /** Optional, from SSURGO: tolerable soil loss T, tons/ac/yr. */
  tFactorTonsPerAcre?: number;
  /** Optional, from SSURGO: surface organic matter, %. */
  organicMatterPct?: number;
  /** Optional, from SSURGO corestrictions: depth of the shallowest root-restricting layer, m (absent = none reported). */
  restrictiveDepthM?: number;
  /** Optional: RUSLE slope length, ft. */
  slopeLengthFt?: number;
}

/** Daily weather for one location (e.g. from NASA POWER). Arrays are aligned with `dates`. */
export interface DailyWeather {
  /** YYYY-MM-DD */
  dates: string[];
  tmaxC: number[];
  tminC: number[];
  rainMm: number[];
  /** Incoming shortwave radiation, MJ/m2/day. */
  solarMJ: number[];
  /** Mean relative humidity at 2 m, %. */
  rhPct: number[];
  /** Wind speed at 2 m, m/s. */
  wind2m: number[];
  latitude: number;
  elevationM: number;
  /** Evidence id, e.g. 'nasaPower'. */
  source: string;
}

/** [longitude, latitude] in degrees. */
export type LngLat = [number, number];
/** [x east, y north] in metres. */
export type XY = [number, number];

/** Paddock outline: either lng/lat degrees (as from a map) or local metres (tests, CAD). */
export type PolygonInput = { lngLat: LngLat[] } | { localM: XY[] };

export interface Paddock {
  id: PaddockId;
  name: string;
  acres: number;
  polygon: PolygonInput;
  land: Land;
  /** Main crop per year, OLDEST FIRST, up to the last 3 years. */
  history: CropId[];
  /** Crops the farmer can actually get seed for. */
  availableCrops: CropId[];
  /** Default 'reduced'. Scales residue retention and therefore ground cover. */
  tillage?: Tillage;
  /** Tile drainage installed: counts as one drainage class better. */
  tileDrained?: boolean;
  diseaseHistory?: { whiteMold?: boolean };
  /**
   * What this field has taught us, per crop: a yield factor learned from the
   * farmer's end-of-season reports (see update.ts). Applied to every yield
   * model's output.
   */
  yieldCalibration?: Record<CropId, CropCalibration>;
}

/** One season's evidence for a field's yield factor. */
export interface CalibrationRecord {
  season: number;
  reported: number;
  /** Model yield for that season's actual crop, weather and neighbours, before calibration. */
  predicted: number;
  /** false when the farmer flagged a one-off event (hail, flood, replant). */
  used: boolean;
  note?: string;
}

/**
 * Field yield factor with shrinkage: a log-normal prior centred on 1 (the
 * model is right), updated by each season's reported/predicted ratio.
 */
export interface CropCalibration {
  /** Multiply model yield by this. */
  factor: number;
  /** Posterior mean and sd of log(factor). */
  logMean: number;
  logSd: number;
  /** Seasons used. */
  seasons: number;
  records: CalibrationRecord[];
}

export interface Farm {
  /** Degrees north. Southern-hemisphere farms are rejected for now. */
  latitude: number;
  /** Two-letter state code, used to look up season spans. */
  state?: StateCode;
  /**
   * Crops the farmer has a confirmed buyer or contract for. Crops marked
   * `requiresBuyer` in croptraits.ts (dry beans, sunflower, canola) are only
   * recommended when listed here.
   */
  confirmedBuyers?: CropId[];
  /** Water and equipment limits. */
  constraints?: FarmConstraints;
  paddocks: Paddock[];
}

/** Harvest/field equipment that some crops need (see EQUIPMENT_NEEDED in constants.ts). */
export type EquipmentId = 'hayEquipment' | 'cottonPicker';

export interface FarmConstraints {
  /** Default 'dryland'. Irrigated farms are scored on irrigation water applied. */
  irrigation?: 'dryland' | 'irrigated';
  /** Seasonal irrigation water available per acre, inches (irrigated farms). Unlimited if absent. */
  irrigationAllocationIn?: number;
  /** Equipment the farmer doesn't have and won't hire; crops that need it are excluded. */
  missingEquipment?: EquipmentId[];
}

/** A neighbour as seen from one paddock. */
export interface Neighbour {
  paddockId: PaddockId;
  /** Total length of shared boundary, m. */
  sharedEdgeM: number;
  /**
   * East-west width of the shared boundary where the neighbour lies to the
   * NORTH of this paddock, m. Noon shadows from this paddock fall across it.
   */
  northEdgeM: number;
  /** Dominant direction of the neighbour from this paddock. */
  side: 'north' | 'south' | 'east' | 'west';
}

/** A farm with geometry resolved once: local polygons, areas and adjacency. */
export interface PreparedFarm {
  farm: Farm;
  polygons: Record<PaddockId, XY[]>;
  areaM2: Record<PaddockId, number>;
  adjacency: Record<PaddockId, Neighbour[]>;
}

// ---------------------------------------------------------------------------
// Inputs: priorities, market, weather
// ---------------------------------------------------------------------------

/** Each 0-100, 50 = neutral. `risk` only sets lambda; it is not a criterion weight. */
export interface Priorities {
  profit: number;
  soilHealth: number;
  water: number;
  risk: number;
}

export interface MarketEntry {
  /** How much the local buyer(s) will take per year, in the crop's yield unit. */
  localDemand: number;
  /** $ per yield unit. */
  localPrice: number;
  /** $ per yield unit at the distant market, before freight. */
  distantPrice: number;
  /** $ per yield unit to get it there. */
  freightPerUnit: number;
  /** Optional multiplier on both prices, e.g. 1.1 for a strong outlook. */
  outlook?: number;
}

export type Market = Record<CropId, MarketEntry>;

/**
 * One weather year: a yield multiplier per crop (1 = average year).
 * Monte Carlo resamples whole years from the pool you pass in, so the
 * correlation between crops within a year is kept.
 */
export interface WeatherScenario {
  label?: string;
  /** Farm-wide yield multiplier per crop (1 = average year). */
  multipliers: Record<CropId, number>;
  /** Field-specific multipliers (soils differ); take precedence over `multipliers`. */
  byPaddock?: Record<PaddockId, Record<CropId, number>>;
  /**
   * Field multipliers given the PREVIOUS crop (soil-water carryover):
   * byPaddockAfter[paddock][previousCrop][crop]. Take precedence over byPaddock.
   */
  byPaddockAfter?: Record<PaddockId, Record<CropId, Record<CropId, number>>>;
  /** Field water results from the water balance, per paddock and crop. */
  water?: Record<PaddockId, Record<CropId, FieldWater>>;
  /** That year's RUSLE rainfall erosivity R (US customary units). */
  erosivityR?: number;
  /** Evidence for this year, e.g. ['nasaPower', 'fao56', 'fao33']. */
  sources?: string[];
}

export interface FieldWater {
  /** Crop water demand over the season, mm. */
  demandMm: number;
  /** Demand not met (dryland stress), mm. */
  deficitMm: number;
  /** Irrigation applied, mm (irrigated farms). */
  irrigationMm: number;
  /** Water actually used from the field, mm: crop ET, or bare-soil evaporation for fallow. */
  etMm: number;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * One year on one paddock. Only `main` is used for now; `cover` is reserved
 * for a winter cover crop or a double crop (e.g. soybean after wheat), which
 * the season spans in croptraits.ts are there to support.
 */
export interface SeasonSlot {
  main: CropId | null;
  cover?: CropId | null;
}

export interface Plan {
  /** One slot per horizon year, per paddock. */
  sequences: Record<PaddockId, SeasonSlot[]>;
}

export type Lens = 'nitrogen' | 'pest' | 'water' | 'erosion' | 'repeat' | 'shade' | 'market' | 'land';

export interface Warning {
  lens: Lens;
  severity: 1 | 2 | 3;
  reason: string;
}

export interface Exclusion {
  cropId: CropId;
  kind: 'availability' | 'buyer' | 'equipment' | 'land' | 'economics' | 'rotation';
  reason: string;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface YearResult {
  year: number;
  cropId: CropId;
  yieldPerAcre: number | null;
  yieldUnit: string | null;
  grossMarginPerAcre: number;
  soilHealthIndex: number;
  /** RUSLE soil loss, tons/acre/year (null when K, R or C is unknown). */
  erosionTonsPerAcre: number | null;
  /** Inches of shortfall (dryland) or irrigation (irrigated) when NASA POWER data is used; otherwise a kc index. */
  waterUseIndex: number;
  /** Yield, price, revenue, cost, N credit, soil and water terms. */
  terms: Term[];
}

export interface PaddockResult {
  paddockId: PaddockId;
  name: string;
  acres: number;
  sequence: CropId[];
  years: YearResult[];
}

export interface PlanResult {
  kind: 'current' | 'maxProfit' | 'priority' | 'custom';
  plan: Plan;
  paddocks: PaddockResult[];
  /**
   * Expected CASH margin: mean over Monte Carlo samples of farm gross margin
   * summed over the horizon, $. Includes N credits used within the plan
   * (fertiliser you don't have to buy). Excludes nitrogenCarriedForward.
   */
  expectedGM: number;
  /** 10th percentile of the same cash margin, $. */
  p10GM: number;
  /** Share of samples where this plan's GM beats the current rotation's (same weather and prices). */
  probBeatsCurrent: number | null;
  /**
   * NOT CASH: fertiliser value of the N left in the soil after the final
   * year, $ (only realised if corn follows). Kept separate so leftover N is
   * never read as cash.
   */
  nitrogenCarriedForward: number;
  /** Cash margin vs nitrogen carried forward, as labelled terms for display. */
  marginBreakdown: Term[];
  /** expected - lambda * (expected - P10) + nitrogen carried forward, $ (used for ranking). */
  riskAdjustedProfit: number;
  /** Acre-weighted mean soilHealthIndex (0-1) over the horizon, final year weighted up. */
  soilHealth: number;
  /** Acre-weighted soilHealthIndex in the final year (0-1). */
  endSoilHealth: number;
  /** Soil health under tillage-retention uncertainty (NRCS low..high ranges): P10 and P90. */
  soilHealthRange: { p10: number; p90: number };
  /** Acre-weighted mean water-use index (lower is better). */
  waterUse: number;
  /** Weighted objective (normalised criteria) and its terms. */
  objective: number;
  objectiveTerms: Term[];
  /** Things a farmer or extension agent should check locally before acting on this plan. */
  localReview: string[];
  /** Share of priority jitters (+/-15) where this plan ranks first. Null for custom plans. */
  rankStability: number | null;
  reasons: string[];
  risks: string[];
  informationGaps: string[];
}

export interface PriceOfPriorities {
  /** Expected-GM cost of the priority plan vs max-profit, $ over the horizon (positive = costs money). */
  profitCost: number;
  /** What the farmer gets for it. Positive numbers are improvements. */
  soilHealthGain: number;
  waterUseReduction: number;
  p10Change: number;
  terms: Term[];
  summary: string;
}

export interface ReferenceBounds {
  profit: { worst: number; best: number };
  soilHealth: { worst: number; best: number };
  water: { worst: number; best: number };
}

export interface GenerateResult {
  plans: { current: PlanResult; maxProfit: PlanResult; priority: PlanResult };
  priceOfPriorities: PriceOfPriorities;
  /** "Why not X?" answers per paddock. */
  exclusions: Record<PaddockId, Exclusion[]>;
  referenceBounds: ReferenceBounds;
  stats: { candidatesScored: number; descentIterations: number; monteCarloSamples: number };
  /** Re-planning only (options.previousPlan): how the priority plan relates to last season's plan. */
  replanning?: Replanning;
}

export interface PlanChange {
  paddockId: PaddockId;
  /** 0-based horizon year. */
  year: number;
  from: CropId;
  to: CropId;
}

export interface Replanning {
  /** Acre-weighted share of last season's planned paddock-years that the priority plan changes. */
  changedShare: number;
  changes: PlanChange[];
  /** The plan that would win if changes were free, when that differs ("what it would take to switch"). */
  withoutSwitchingCost?: {
    plan: Plan;
    changes: PlanChange[];
    /** Expected cash margin gained by switching anyway, $. */
    expectedGMGain: number;
    /** Objective points gained before the switching cost. */
    objectiveGain: number;
  };
}

/** Crop lookup used throughout. Defaults to CROP_BY_ID from croptraits.ts. */
export type CropTable = Record<CropId, CropTraits>;
