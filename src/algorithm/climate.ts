/**
 * From daily weather (NASA POWER) to the planner's weather pool: one
 * WeatherScenario per historical season, with field-level yield multipliers
 * and water numbers from the FAO-56 water balance, and that year's RUSLE
 * rainfall erosivity.
 *
 *   relative yield (field, crop, year) = FAO-33 Ya/Ym from the water balance
 *   multiplier = relative yield / mean DRYLAND relative yield over all years
 *
 * Dividing by the dryland mean keeps "national average yield" meaning an
 * average year, and lets irrigated fields come out above average.
 */
import { CROP_BY_ID } from './croptraits';
import { seasonFor } from './seasons';
import { dailyEt0, indexOfDate, simulateSeason } from './waterBalance';
import { DAILY_EROSIVITY, R_SI_TO_US, waterParamsFor } from './waterParams';
import type { CropId, DailyWeather, Farm, FieldWater, PaddockId, WeatherScenario } from './types';

export interface ClimateOptions {
  /** Season years to build (default: every complete season in the data). */
  years?: number[];
  /** Crops to run (default: every crop with sourced water parameters). */
  crops?: CropId[];
}

export interface ClimateResult {
  scenarios: WeatherScenario[];
  /** Mean annual RUSLE R (US customary units) over the years in the data. */
  meanErosivityR: number;
  gaps: string[];
}

const ALL = ['corn', 'soybeans', 'winter-wheat', 'spring-wheat', 'sorghum', 'cotton', 'alfalfa', 'oats', 'barley', 'sunflower', 'canola', 'dry-beans', 'cereal-rye'];

/** Daily erosivity EI (SI) by Richardson et al. 1983. */
export function dailyErosivity(rainMm: number, month: number): number {
  const a = (DAILY_EROSIVITY.warmMonths as readonly number[]).includes(month) ? DAILY_EROSIVITY.aWarm : DAILY_EROSIVITY.aCool;
  return rainMm > 0 ? a * rainMm ** DAILY_EROSIVITY.b : 0;
}

/** Annual R (US customary) per calendar year in the series (complete years only). */
export function annualErosivity(w: DailyWeather): Record<number, number> {
  const sums: Record<number, { ei: number; days: number }> = {};
  w.dates.forEach((d, i) => {
    const y = Number(d.slice(0, 4));
    const e = (sums[y] ??= { ei: 0, days: 0 });
    e.ei += dailyErosivity(w.rainMm[i]!, Number(d.slice(5, 7)));
    e.days++;
  });
  const out: Record<number, number> = {};
  for (const [y, s] of Object.entries(sums)) if (s.days >= 365) out[Number(y)] = s.ei / R_SI_TO_US;
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function scenariosFromDailyWeather(farm: Farm, weather: DailyWeather, options: ClimateOptions = {}): ClimateResult {
  const gaps = new Set<string>();
  const et0 = dailyEt0(weather);
  const irrigated = farm.constraints?.irrigation === 'irrigated';
  const allocationMm = farm.constraints?.irrigationAllocationIn !== undefined ? farm.constraints.irrigationAllocationIn * 25.4 : Infinity;
  const cropIds = (options.crops ?? ALL).filter((id) => {
    const r = waterParamsFor(id);
    if (r.gap) gaps.add(r.gap);
    return r.params !== null;
  });
  const firstYear = Number(weather.dates[0]!.slice(0, 4));
  const lastYear = Number(weather.dates[weather.dates.length - 1]!.slice(0, 4));
  const candidateYears = options.years ?? Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);

  // relative yields [paddock][crop][year] for dryland and the farm's actual management
  type Run = { dry: number; actual: number; water: FieldWater };
  const runs = new Map<string, Map<number, Run>>();
  const fieldsWithSoil = farm.paddocks.filter((p) => {
    if (p.land.awcInPerIn === undefined) gaps.add(`${p.name} has no available-water-capacity (SSURGO awc); its yields use the farm average.`);
    return p.land.awcInPerIn !== undefined;
  });
  if (fieldsWithSoil.length === 0) {
    gaps.add('No paddock has soil water capacity (SSURGO awc), so the water balance could not run.');
    return { scenarios: [], meanErosivityR: 0, gaps: [...gaps] };
  }

  const usableYears: number[] = [];
  for (const year of candidateYears) {
    let complete = true;
    const yearRuns: [string, Run][] = [];
    for (const p of fieldsWithSoil) {
      for (const cropId of cropIds) {
        const params = waterParamsFor(cropId).params!;
        const span = seasonFor(CROP_BY_ID[cropId]!, farm.state).span;
        if (!span) continue;
        const winter = span.plantMonth > span.harvestMonth;
        const start = indexOfDate(weather, `${winter ? year - 1 : year}-${pad2(span.plantMonth)}-15`);
        const base = { startIndex: start, awc: p.land.awcInPerIn!, et0 };
        const dry = start >= 0 ? simulateSeason(weather, params, base) : null;
        if (!dry) {
          complete = false;
          break;
        }
        const actual = irrigated ? simulateSeason(weather, params, { ...base, irrigated: true, allocationMm })! : dry;
        yearRuns.push([`${p.id}|${cropId}`, {
          dry: dry.yieldRatio,
          actual: actual.yieldRatio,
          water: { demandMm: actual.etmMm, deficitMm: actual.deficitMm, irrigationMm: actual.irrigationMm },
        }]);
      }
      if (!complete) break;
    }
    if (!complete) continue;
    usableYears.push(year);
    for (const [k, r] of yearRuns) {
      if (!runs.has(k)) runs.set(k, new Map());
      runs.get(k)!.set(year, r);
    }
  }
  if (usableYears.length === 0) {
    gaps.add('The weather record is too short for a complete season of every crop.');
    return { scenarios: [], meanErosivityR: 0, gaps: [...gaps] };
  }

  const meanDry = new Map<string, number>();
  for (const [k, byYear] of runs) {
    const vals = [...byYear.values()].map((r) => r.dry);
    meanDry.set(k, vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  const erosivity = annualErosivity(weather);
  const totalAcres = fieldsWithSoil.reduce((a, p) => a + p.acres, 0);
  const scenarios: WeatherScenario[] = usableYears.map((year) => {
    const byPaddock: Record<PaddockId, Record<CropId, number>> = {};
    const water: Record<PaddockId, Record<CropId, FieldWater>> = {};
    const farmSum: Record<CropId, number> = {};
    for (const p of fieldsWithSoil) {
      byPaddock[p.id] = {};
      water[p.id] = {};
      for (const cropId of cropIds) {
        const k = `${p.id}|${cropId}`;
        const r = runs.get(k)?.get(year);
        const md = meanDry.get(k);
        if (!r || !md) continue;
        const m = md > 0 ? r.actual / md : 1;
        byPaddock[p.id]![cropId] = m;
        water[p.id]![cropId] = r.water;
        farmSum[cropId] = (farmSum[cropId] ?? 0) + m * p.acres;
      }
    }
    const multipliers: Record<CropId, number> = {};
    for (const [c, s] of Object.entries(farmSum)) multipliers[c] = s / totalAcres;
    const r = erosivity[year];
    return {
      label: `${year} (NASA POWER)`,
      multipliers,
      byPaddock,
      water,
      ...(r !== undefined ? { erosivityR: r } : {}),
      sources: [weather.source, 'fao56Tables', 'fao66'],
    };
  });
  const rs = Object.values(erosivity);
  return { scenarios, meanErosivityR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0, gaps: [...gaps] };
}
