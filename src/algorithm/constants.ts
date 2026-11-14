/**
 * Every tunable modelling constant in one place.
 *
 * These are DESIGN CHOICES, not data. Sourced numbers live in croptraits.ts
 * and soilData.ts. Where a constant stands in for a magnitude we have not
 * sourced yet, it says "UNSOURCED MAGNITUDE" and is listed in ALGORITHM.md.
 */

// ---------------------------------------------------------------------------
// Horizon
// ---------------------------------------------------------------------------

export const HORIZON_YEARS = 3;

// ---------------------------------------------------------------------------
// Hard rules (stage 1): sequences that break these are never recommended
// ---------------------------------------------------------------------------

/** These crops may not follow themselves (white mold build-up). */
export const NO_BACK_TO_BACK_CROPS: readonly string[] = ['sunflower', 'canola', 'dry-beans'];

/** Longest alfalfa stand, years. A longer run would mean replanting alfalfa straight after alfalfa (autotoxicity). */
export const ALFALFA_MAX_STAND_YEARS = 4;

/**
 * Below this Maas-Hoffman relative yield (0-1) a crop is excluded for salinity.
 * Between this and 1 it is allowed with a yield penalty.
 */
export const SALINITY_MIN_RELATIVE_YIELD = 0.5;

// ---------------------------------------------------------------------------
// Soft rotation rules (stage 2): yield multipliers
// Sourced effects (continuous corn / soybean) come from ROTATION_EFFECTS in croptraits.ts.
// ---------------------------------------------------------------------------

export const ROTATION_RULES = {
  /** Yield drag when a crop hosting a pest group follows another host of that group. UNSOURCED MAGNITUDE. */
  pestRepeatBackToBack: 0.05,
  /** Yield drag per host year in the two years before last. UNSOURCED MAGNITUDE. */
  pestRepeatPerEarlierHostYear: 0.02,
  /** Years looked back for pest repeats and white mold host counts. */
  pestWindowYears: 3,
  /** White mold: yield drag per host year in the last 3 years. UNSOURCED MAGNITUDE. */
  whiteMoldPerHostYear: 0.03,
  /** White mold penalty multiplier when the paddock has a white-mold history flag. */
  whiteMoldHistoryMultiplier: 2,
  /**
   * Same crop back-to-back where we have NO sourced penalty (e.g. cotton,
   * wheat, sorghum). UNSOURCED MAGNITUDE. Corn and soybean use the sourced
   * ROTATION_EFFECTS instead; alfalfa (a continuing stand) and fallow are exempt.
   */
  sameCropRepeatUnsourced: 0.03,
  /**
   * Pest groups where a one-year break is enough, so only last year counts.
   * Corn rootworm: corn after soybean generally needs no rootworm control (isuRotationEcon).
   */
  oneYearBreakGroups: ['cornRootworm'] as readonly string[],
} as const;

/**
 * Alfalfa establishment-year yield as a share of a full-stand year.
 * null = not sourced yet: no adjustment is made and an information gap is
 * recorded (so establishment-year yield is overstated until this is filled in).
 */
export const ALFALFA_ESTABLISHMENT_YIELD_FACTOR: number | null = null;

// ---------------------------------------------------------------------------
// Shade (stage 4)
// ---------------------------------------------------------------------------

/** Used in the deterministic search when a crop's shade tolerance is null (midpoint of 0-1). */
export const SHADE_TOLERANCE_UNKNOWN_DETERMINISTIC = 0.5;

/** Floor on sun elevation so the shadow length stays finite at high latitudes. */
export const MIN_SUN_ELEVATION_DEG = 5;

/** checkPlacement 'shade' lens: shaded share of the paddock for severity 1, 2, 3. */
export const SHADE_WARNING_FRACTIONS = [0.02, 0.05, 0.15] as const;

// ---------------------------------------------------------------------------
// Soil health index
// ---------------------------------------------------------------------------

/** Component weights of soilHealthIndex. A design choice, not data. Must sum to 1. */
export const SOIL_INDEX_WEIGHTS = {
  groundCover: 0.35,
  nitrogen: 0.2,
  diversity: 0.25,
  organicMatter: 0.2,
} as const;

/** Share of residue cover lost per fully bare month in the year (0-1). Design choice. */
export const BARE_MONTH_COVER_DISCOUNT = 0.5;

/** Diversity component: deductions when this year repeats last year's family / a pest group. */
export const DIVERSITY_DEDUCTIONS = {
  sameFamily: 0.5,
  sharedPestGroup: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Objective and plan search (stage 5)
// ---------------------------------------------------------------------------

/** lambda = (risk / 100) * LAMBDA_MAX. risk = 100 means optimise P10. */
export const LAMBDA_MAX = 1;

/**
 * Crop-variety penalty: no family should exceed this share of farm area in
 * one year. Scaled by lambda (concentration is a risk), so it is off at
 * risk = 0 and the max-profit plan is never constrained by it.
 */
export const VARIETY_MAX_FAMILY_SHARE = 0.6;
/** Objective units lost per unit of excess family share (per year, averaged). */
export const VARIETY_PENALTY_WEIGHT = 1;

/** End-of-horizon: extra weight on the final year's soil health (1 = final year counts double). */
export const END_SOIL_WEIGHT = 1;

/** Coordinate-descent iteration cap. */
export const MAX_DESCENT_ITERATIONS = 20;

/** Candidate weight vectors: farmer weights shifted this many slider points toward each criterion. */
export const CANDIDATE_WEIGHT_SHIFT = 25;

// ---------------------------------------------------------------------------
// Monte Carlo (stage 6)
// ---------------------------------------------------------------------------

export const MC_SAMPLES = 200;
/** How many top candidate plans get Monte Carlo (plus max-profit and current). */
export const MC_TOP_K = 4;
/** Rank stability: each slider is jittered uniformly by +/- this many points. */
export const RANK_JITTER = 15;
export const RANK_JITTER_SAMPLES = 200;
/** Percentile reported as the bad-year gross margin. */
export const P_LOW = 0.1;

// ---------------------------------------------------------------------------
// checkPlacement thresholds
// ---------------------------------------------------------------------------

/** Erosion lens: slopePct x (1 - cover score) at or above these gives severity 1, 2, 3. */
export const EROSION_WARNING_LEVELS = [2, 4, 8] as const;
/** Market lens: share of production above local demand for severity 1, 2, 3. */
export const MARKET_WARNING_EXCESS = [0, 0.25, 0.5] as const;
/** Water lens: kc mid at or above this on sandy soil is flagged. */
export const WATER_HIGH_KC = 1.15;
/** Water lens: depletion fraction p at or below this (drought-sensitive) on sandy soil is flagged. */
export const WATER_SENSITIVE_P = 0.45;
