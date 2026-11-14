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
import { typicalYield } from './cropData';
import { DEFAULT_TILLAGE, RESIDUE_FACTORS, residueRetention } from './soilData';
import { residueLb, residueToCover } from './soilHealth';
import { seasonFor } from './seasons';
import { FALLBACK_SEASONS } from './seasons';
import { dailyEt0, indexOfDate, simulateBareSoil, simulateOffSeason, simulateSeason } from './waterBalance';
import { BARE_SOIL_EVAPORATION, DAILY_EROSIVITY, KC_MAX_BARE_SOIL, R_SI_TO_US, waterParamsFor } from './waterParams';
import type { CropId, DailyWeather, Farm, FieldWater, PaddockId, Tillage, WeatherScenario } from './types';

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

/** Calendar-year precipitation and ET0 totals (complete years only). */
export function annualTotals(w: DailyWeather, et0: number[]): Record<number, { precipMm: number; et0Mm: number }> {
  const sums: Record<number, { precipMm: number; et0Mm: number; days: number }> = {};
  w.dates.forEach((d, i) => {
    const y = Number(d.slice(0, 4));
    const e = (sums[y] ??= { precipMm: 0, et0Mm: 0, days: 0 });
    e.precipMm += w.rainMm[i]!;
    e.et0Mm += et0[i]!;
    e.days++;
  });
  const out: Record<number, { precipMm: number; et0Mm: number }> = {};
  for (const [y, s] of Object.entries(sums)) if (s.days >= 365) out[Number(y)] = { precipMm: s.precipMm, et0Mm: s.et0Mm };
  return out;
}

/** Index of a crop's planting day for season `year` (winter crops are planted the year before). */
function plantIndex(weather: DailyWeather, cropId: CropId, state: string | undefined, year: number): number {
  const span = seasonFor(CROP_BY_ID[cropId]!, state).span;
  if (!span) return -1;
  const winter = span.plantMonth > span.harvestMonth;
  const md = span.plantDate ?? `${pad2(span.plantMonth)}-15`;
  return indexOfDate(weather, `${winter ? year - 1 : year}-${md}`);
}

export interface CarryoverInput {
  weather: DailyWeather;
  et0: number[];
  state: string | undefined;
  awc: number;
  texture: keyof typeof BARE_SOIL_EVAPORATION;
  irrigated: boolean;
  allocationMm: number;
  /** Tillage system (residue left on the surface reduces off-season evaporation). Default 'reduced'. */
  tillage?: Tillage;
  /** SSURGO restrictive-layer depth, m (caps root depth). */
  restrictiveDepthM?: number;
}

/**
 * FAO-56 Ch. 11: with an organic mulch, reduce TEW by 5% for each 10% of the
 * surface covered (and keep REW <= TEW). Residue cover comes from the
 * previous crop's residue at its typical yield and the tillage retention;
 * crops with no sourced residue factor get no reduction (conservative).
 */
export function mulchedEvaporationLayer(prev: CropId, texture: keyof typeof BARE_SOIL_EVAPORATION, tillage: Tillage): { rewMm: number; tewMm: number; cover: number } {
  const bare = BARE_SOIL_EVAPORATION[texture];
  const crop = CROP_BY_ID[prev];
  const f = RESIDUE_FACTORS[prev];
  const residue = crop ? residueLb(crop, typicalYield(crop)) : null;
  const cover = f && residue !== null ? residueToCover(residue * residueRetention(prev, tillage).value, f.type) : 0;
  const tewMm = bare.tewMm * (1 - 0.5 * cover);
  return { tewMm, rewMm: Math.min(bare.rewMm, tewMm), cover };
}

/**
 * Root-zone depletion (share of the NEXT crop's full root-zone capacity) when
 * `next` is planted for season `year`, after `prev` in the year before:
 *  - prev crop: its own season (starting at field capacity: one season of
 *    memory), cut short if the next crop goes in before harvest, then the
 *    off-season (bare-soil evaporation vs rain) until planting
 *  - fallow: bare soil from 1 Jan of the fallow year until planting
 * Null if `prev` has no water-balance parameters or the data doesn't reach.
 */
export function startDepletionFraction(c: CarryoverInput, prev: CropId, next: CropId, year: number): number | null {
  const np = waterParamsFor(next, c.restrictiveDepthM).params;
  if (!np) return null;
  const nextStart = plantIndex(c.weather, next, c.state, year);
  if (nextStart < 0) return null;
  const taw = 1000 * c.awc * np.rootMaxM;
  // Fallow is tilled bare; after a crop, its residue mulches the surface.
  const layer = prev === 'fallow' ? BARE_SOIL_EVAPORATION[c.texture] : mulchedEvaporationLayer(prev, c.texture, c.tillage ?? DEFAULT_TILLAGE);
  const off = (from: number, depletionMm: number) =>
    from >= nextStart
      ? depletionMm
      : simulateOffSeason(c.weather, { startIndex: from, endIndex: nextStart, depletionMm, tawMm: taw, rewMm: layer.rewMm, tewMm: layer.tewMm, kcMax: KC_MAX_BARE_SOIL, et0: c.et0 });
  if (prev === 'fallow') {
    const from = indexOfDate(c.weather, `${year - 1}-01-01`);
    if (from < 0) return null;
    const dr = off(from, 0);
    return dr === null ? null : dr / taw;
  }
  const pp = waterParamsFor(prev, c.restrictiveDepthM).params;
  if (!pp) return null;
  const prevStart = plantIndex(c.weather, prev, c.state, year - 1);
  if (prevStart < 0 || prevStart >= nextStart) return null;
  const run = simulateSeason(c.weather, pp, {
    startIndex: prevStart,
    awc: c.awc,
    et0: c.et0,
    maxDays: nextStart - prevStart,
    ...(c.irrigated ? { irrigated: true, allocationMm: c.allocationMm } : {}),
  });
  if (!run) return null;
  const dr = off(run.endIndex, run.endDepletionFraction * taw);
  return dr === null ? null : dr / taw;
}

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
  const predecessors = [...cropIds, 'fallow'];
  const firstYear = Number(weather.dates[0]!.slice(0, 4));
  const lastYear = Number(weather.dates[weather.dates.length - 1]!.slice(0, 4));
  const candidateYears = options.years ?? Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);

  type Run = { dry: number; actual: number; water: FieldWater };
  /** runs[paddock|crop][year][prev] */
  const runs = new Map<string, Map<number, Map<CropId, Run>>>();
  const fallowWater = new Map<string, Map<number, FieldWater>>();
  const fieldsWithSoil = farm.paddocks.filter((p) => {
    if (p.land.awcInPerIn === undefined) gaps.add(`${p.name} has no available-water-capacity (SSURGO awc); its yields use the farm average.`);
    return p.land.awcInPerIn !== undefined;
  });
  if (fieldsWithSoil.length === 0) {
    gaps.add('No paddock has soil water capacity (SSURGO awc), so the water balance could not run.');
    return { scenarios: [], meanErosivityR: 0, gaps: [...gaps] };
  }
  gaps.add('Soil water carries over one season (previous crop or fallow, then the off-season; residue mulch per FAO-56 Ch. 11); frozen soil, snow, runoff and capillary rise are not modelled.');

  const usableYears: number[] = [];
  for (const year of candidateYears) {
    let complete = true;
    const yearRuns: [string, CropId, Run][] = [];
    const yearFallow: [string, FieldWater][] = [];
    for (const p of fieldsWithSoil) {
      const carry: CarryoverInput = {
        weather,
        et0,
        state: farm.state,
        awc: p.land.awcInPerIn!,
        texture: p.land.texture,
        irrigated,
        allocationMm,
        tillage: p.tillage ?? DEFAULT_TILLAGE,
        ...(p.land.restrictiveDepthM !== undefined ? { restrictiveDepthM: p.land.restrictiveDepthM } : {}),
      };
      for (const cropId of cropIds) {
        const params = waterParamsFor(cropId, p.land.restrictiveDepthM).params!;
        const start = plantIndex(weather, cropId, farm.state, year);
        let any = false;
        for (const prev of predecessors) {
          const f = start >= 0 ? startDepletionFraction(carry, prev, cropId, year) : null;
          if (f === null) continue;
          const base = { startIndex: start, awc: carry.awc, et0, initialDepletionFraction: f, subsoilDepletionFraction: f };
          const dry = simulateSeason(weather, params, base);
          if (!dry) continue;
          const actual = irrigated ? simulateSeason(weather, params, { ...base, irrigated: true, allocationMm })! : dry;
          yearRuns.push([`${p.id}|${cropId}`, prev, {
            dry: dry.yieldRatio,
            actual: actual.yieldRatio,
            water: { demandMm: actual.etmMm, deficitMm: actual.deficitMm, irrigationMm: actual.irrigationMm, etMm: actual.etaMm },
          }]);
          any = true;
        }
        if (!any) {
          complete = false;
          break;
        }
      }
      if (!complete) break;
      // Fallow's own water score: FAO-56 bare-soil evaporation over the summer window crops are scored on.
      const bare = BARE_SOIL_EVAPORATION[p.land.texture];
      const fs = FALLBACK_SEASONS.summer!;
      const fStart = indexOfDate(weather, `${year}-${pad2(fs.plantMonth)}-01`);
      const fEnd = indexOfDate(weather, `${year}-${pad2(fs.harvestMonth)}-30`);
      const fallow =
        fStart >= 0 && fEnd > fStart
          ? simulateBareSoil(weather, { startIndex: fStart, days: fEnd - fStart + 1, rewMm: bare.rewMm, tewMm: bare.tewMm, kcMax: KC_MAX_BARE_SOIL, et0 })
          : null;
      if (fallow) yearFallow.push([p.id, { demandMm: fallow.evaporationMm, deficitMm: 0, irrigationMm: 0, etMm: fallow.evaporationMm }]);
    }
    if (!complete) continue;
    usableYears.push(year);
    for (const [k, prev, r] of yearRuns) {
      if (!runs.has(k)) runs.set(k, new Map());
      const byYear = runs.get(k)!;
      if (!byYear.has(year)) byYear.set(year, new Map());
      byYear.get(year)!.set(prev, r);
    }
    for (const [pid, w] of yearFallow) {
      if (!fallowWater.has(pid)) fallowWater.set(pid, new Map());
      fallowWater.get(pid)!.set(year, w);
    }
  }
  if (usableYears.length === 0) {
    gaps.add('The weather record is too short for a complete season of every crop (with the year before it).');
    return { scenarios: [], meanErosivityR: 0, gaps: [...gaps] };
  }

  // Normalise by the mean over years of each year's average (over predecessors) dryland relative yield,
  // so the average year's multiplier is exactly 1 even when early years lack some predecessors.
  const meanDry = new Map<string, number>();
  for (const [k, byYear] of runs) {
    const perYear = [...byYear.values()].map((m) => [...m.values()].reduce((a, r) => a + r.dry, 0) / m.size);
    meanDry.set(k, perYear.reduce((a, b) => a + b, 0) / perYear.length);
  }

  const erosivity = annualErosivity(weather);
  const annualClimate = annualTotals(weather, et0);
  const totalAcres = fieldsWithSoil.reduce((a, p) => a + p.acres, 0);
  const scenarios: WeatherScenario[] = usableYears.map((year) => {
    const byPaddock: Record<PaddockId, Record<CropId, number>> = {};
    const byPaddockAfter: Record<PaddockId, Record<CropId, Record<CropId, number>>> = {};
    const water: Record<PaddockId, Record<CropId, FieldWater>> = {};
    const farmSum: Record<CropId, number> = {};
    for (const p of fieldsWithSoil) {
      byPaddock[p.id] = {};
      byPaddockAfter[p.id] = {};
      water[p.id] = {};
      const fw = fallowWater.get(p.id)?.get(year);
      if (fw) water[p.id]!['fallow'] = fw;
      for (const cropId of cropIds) {
        const k = `${p.id}|${cropId}`;
        const byPrev = runs.get(k)?.get(year);
        const md = meanDry.get(k);
        if (!byPrev || !md) continue;
        let mSum = 0;
        const wSum: FieldWater = { demandMm: 0, deficitMm: 0, irrigationMm: 0, etMm: 0 };
        for (const [prev, r] of byPrev) {
          const m = md > 0 ? r.actual / md : 1;
          (byPaddockAfter[p.id]![prev] ??= {})[cropId] = m;
          mSum += m;
          for (const key of Object.keys(wSum) as (keyof FieldWater)[]) wSum[key] += r.water[key];
        }
        const n = byPrev.size;
        // Without knowing the previous crop: the average over predecessors.
        byPaddock[p.id]![cropId] = mSum / n;
        water[p.id]![cropId] = { demandMm: wSum.demandMm / n, deficitMm: wSum.deficitMm / n, irrigationMm: wSum.irrigationMm / n, etMm: wSum.etMm / n };
        farmSum[cropId] = (farmSum[cropId] ?? 0) + (mSum / n) * p.acres;
      }
    }
    const multipliers: Record<CropId, number> = {};
    for (const [c, s] of Object.entries(farmSum)) multipliers[c] = s / totalAcres;
    const r = erosivity[year];
    return {
      label: `${year} (NASA POWER)`,
      multipliers,
      byPaddock,
      byPaddockAfter,
      water,
      ...(r !== undefined ? { erosivityR: r } : {}),
      ...(annualClimate[year] ? { climate: annualClimate[year]! } : {}),
      sources: [weather.source, 'fao56Tables', 'fao66', 'fao56Ch7', 'fao56Ch11'],
    };
  });
  const rs = Object.values(erosivity);
  return { scenarios, meanErosivityR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0, gaps: [...gaps] };
}
