/**
 * Field Shift rotation algorithm: public exports.
 *
 *   generatePlans(farm, priorities, market, scenarios, options)
 *   evaluatePlan(farm, plan, priorities, market, scenarios, options)
 *   checkPlacement(farm, plan, paddockId, yearIndex, cropId, options)
 */
export { generatePlans, evaluatePlan, priceOfPriorities, type GenerateOptions, type EvaluateOptions } from './api';
export { checkPlacement, type PlacementOptions } from './placement';
export {
  createFarmState,
  adoptPlan,
  updateAfterSeason,
  replan,
  calibrate,
  alignedPreviousPlan,
  type FarmState,
  type SeasonReport,
  type PaddockReport,
  type SeasonObservations,
  type SeasonEvent,
  type SeasonLogEntry,
} from './update';
export { describeSource, planSources, DATA_SOURCES } from './evidence';
export { prepareFarm, lngLatToLocal, SQ_M_PER_ACRE } from './geometry';
export { planFromCrops, continueHistory } from './plans';
export { TraitYieldModel, withCalibration, meanScenario, type YieldModel, type YieldContext, type YieldEstimate } from './yieldModel';
export type { ModelOptions } from './farmModel';
export { createRng, type Rng } from './rng';
export { syntheticWeatherForTestsOnly } from './weather';
export * as constants from './constants';
export { CROPS, CROP_BY_ID, DATA_GAPS, SOURCES, PEST_GROUPS, ROTATION_EFFECTS, NITROGEN_PRICE_PER_LB } from './croptraits';
export { SOIL_SOURCES, RESIDUE_FACTORS, TILLAGE_RESIDUE_RETENTION } from './soilData';
export type * from './types';
