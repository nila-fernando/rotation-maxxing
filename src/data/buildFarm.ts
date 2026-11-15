/**
 * Drop a pin (or draw fields), get a farm: everything the planner needs,
 * filled from keyless NASA and USDA services.
 *
 *   NASA POWER  -> daily weather -> water balance + erosivity -> weather pool
 *   SSURGO      -> soil per field (AWC, K, T, pH, EC, OM, texture, drainage, slope)
 *   CDL         -> last 3 years of crops per field (the current rotation)
 *   NASS        -> county base yields (precomputed file, or Quick Stats with a key)
 *   Jar test    -> the farmer's soil-jar photo replaces the mapped texture (optional)
 *
 * The farmer still supplies what satellites can't know: seed availability,
 * buyers, equipment, tillage, tile drainage, irrigation. Any field value the
 * caller passes wins over fetched data.
 */
import { buildWeather, type ClimateTrendsFile } from '../algorithm/climateAdjust';
import type { WeatherSource } from '../algorithm/update';
import { lngLatToLocal, polygonArea, SQ_M_PER_ACRE } from '../algorithm/geometry';
import { CROP_BY_ID } from '../algorithm/croptraits';
import { isEnsemble } from '../algorithm/types';
import type { CropId, DailyWeather, Farm, FarmConstraints, Land, LngLat, Paddock, StateCode, Tillage, WeatherInput, WeatherScenario } from '../algorithm/types';
import { fetchCdlHistory } from './cdl';
import { fetchPowerDaily, type FetchFn } from './power';
import { fetchSoilAtPoint } from './ssurgo';
import { fetchCountyAtPoint } from './countySample';
import { fetchBaseYields, type BaseYieldsFile } from './nassYields';
import { landFromJar } from './jarSoil';
import type { JarSoilPayload } from '../jar-test/jar_test';

export interface FieldInput {
  id: string;
  name: string;
  /** Outline in lng/lat degrees. */
  polygon: LngLat[];
  availableCrops: CropId[];
  /** Defaults to the polygon area. */
  acres?: number;
  tillage?: Tillage;
  tileDrained?: boolean;
  /** Overrides CDL (oldest first). */
  history?: CropId[];
  /** Overrides individual soil fields from SSURGO. */
  land?: Partial<Land>;
  /**
   * The field's jar test (toPlannerPayload() from src/jar-test). Its sand/clay %
   * replace SSURGO's texture; a texture typed in `land` still wins.
   */
  jarTest?: JarSoilPayload;
}

export interface BuildFarmInput {
  fields: FieldInput[];
  state?: StateCode;
  confirmedBuyers?: CropId[];
  constraints?: FarmConstraints;
  /** Weather record for the pool, inclusive. More years = better uncertainty. */
  weatherYears: [number, number];
  /** CDL years for history (default: the 3 years before the last weather year + 1). */
  historyYears?: number[];
  /**
   * The season being planned (the frontend passes the current planning season).
   * The weather is adjusted to this year. If missing: last weather year + 1, with a gap.
   */
  targetYear?: number;
  /** Precomputed NEX-GDDP-CMIP6 trends for this location (src/data/cmip6/<site>.json). */
  climateTrends?: ClimateTrendsFile;
  /** Default 'present' when climateTrends are given, otherwise 'none'. */
  weatherAdjustment?: 'none' | 'present';
  /**
   * Precomputed NASS base yields for this county (src/data/baseYields/<site>.json).
   * The non-irrigated or irrigated set is picked from constraints.irrigation.
   */
  baseYields?: BaseYieldsFile;
  /**
   * USDA NASS Quick Stats API key, to fetch county base yields live (server or
   * script use only: never ship a key to the browser). Ignored when baseYields is given.
   */
  nassApiKey?: string;
}

export interface BuiltFarm {
  farm: Farm;
  /** Pass this to generatePlans / evaluatePlan (a raw pool, or a present-climate ensemble). */
  weather: WeatherInput;
  /** The deterministic (mean) pool, for callers that only want WeatherScenario[]. */
  scenarios: WeatherScenario[];
  /** Pass to createFarmState so replan() re-adjusts the weather to each new season. */
  weatherSource: WeatherSource;
  targetYear: number;
  /** The raw NASA POWER daily record. */
  daily: DailyWeather;
  /** Where each field's data came from, for the evidence panel. */
  provenance: Record<string, { soil: string; history: string[] }>;
  gaps: string[];
}

function centroid(points: LngLat[]): LngLat {
  const n = points.length;
  return [points.reduce((a, p) => a + p[0], 0) / n, points.reduce((a, p) => a + p[1], 0) / n];
}

export async function buildFarm(input: BuildFarmInput, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<BuiltFarm> {
  if (input.fields.length === 0) throw new Error('Add at least one field.');
  const gaps: string[] = [];
  const [lng0, lat0] = centroid(input.fields.flatMap((f) => f.polygon));
  if (lat0 < 0) throw new Error('Southern-hemisphere farms are not supported yet.');

  const power = await fetchPowerDaily(lat0, lng0, input.weatherYears[0], input.weatherYears[1], fetchFn);
  gaps.push(...power.gaps);

  const lastYear = input.weatherYears[1];
  const historyYears = input.historyYears ?? [lastYear - 2, lastYear - 1, lastYear];
  const provenance: BuiltFarm['provenance'] = {};
  const paddocks: Paddock[] = [];
  for (const f of input.fields) {
    const [lng, lat] = centroid(f.polygon);
    let land: Land;
    let soilNote: string;
    const jar = f.jarTest ? landFromJar(f.jarTest, f.name) : null;
    if (jar) gaps.push(...jar.gaps);
    const entered: Partial<Land> = { ...jar?.land, ...f.land };
    try {
      const soil = await fetchSoilAtPoint(lng, lat, fetchFn);
      land = { ...soil.land, ...entered };
      soilNote = `${soil.mapUnit} (${soil.component})`;
      gaps.push(...soil.gaps.map((g) => `${f.name}: ${g}`));
    } catch (e) {
      if (entered.slopePct === undefined || !entered.texture || !entered.drainage) throw e;
      land = { salinityECe: 0, ...entered } as Land;
      soilNote = 'entered by the farmer (SSURGO unavailable)';
      gaps.push(`${f.name}: SSURGO unavailable (${(e as Error).message}); using the soil values entered.`);
    }

    let history = f.history;
    let historyNote = history ? ['entered by the farmer'] : [];
    if (!history) {
      const cdl = await fetchCdlHistory(f.polygon, historyYears, fetchFn);
      history = cdl.history.filter((c): c is CropId => c !== null);
      historyNote = cdl.categories.map((c, i) => `${historyYears[i]}: ${c}`);
      gaps.push(...cdl.gaps.map((g) => `${f.name}: ${g}`));
    }

    const areaAcres = polygonArea(lngLatToLocal(f.polygon, [lng0, lat0])) / SQ_M_PER_ACRE;
    paddocks.push({
      id: f.id,
      name: f.name,
      acres: f.acres ?? areaAcres,
      polygon: { lngLat: f.polygon },
      land,
      history,
      availableCrops: f.availableCrops,
      ...(f.tillage ? { tillage: f.tillage } : {}),
      ...(f.tileDrained !== undefined ? { tileDrained: f.tileDrained } : {}),
    });
    if (jar?.note && !f.land?.texture) soilNote += `; texture from ${jar.note}`;
    provenance[f.id] = { soil: soilNote, history: historyNote };
  }

  const practice = input.constraints?.irrigation === 'irrigated' ? 'irrigated' : 'non-irrigated';
  const crops = [...new Set(input.fields.flatMap((f) => f.availableCrops))];
  let baseYields: Farm['baseYields'];
  if (input.baseYields) {
    const set = input.baseYields[practice];
    baseYields = Object.fromEntries(crops.filter((c) => set.baseYields[c]).map((c) => [c, set.baseYields[c]!]));
    gaps.push(...set.gaps.filter((g) => crops.some((c) => g.startsWith(`${CROP_BY_ID[c]?.name ?? c}:`))));
  } else if (input.nassApiKey) {
    try {
      const county = await fetchCountyAtPoint(lng0, lat0, fetchFn);
      const r = await fetchBaseYields({ key: input.nassApiKey, stateFips: county.stateFips, countyFips: county.countyFips, crops, practice }, fetchFn);
      baseYields = r.baseYields;
      gaps.push(...r.gaps);
    } catch (e) {
      gaps.push(`County yields unavailable (${(e as Error).message}); base yields are US averages, which include irrigated land.`);
    }
  } else {
    gaps.push('No county yields (precomputed file or NASS API key): base yields are US averages, which include irrigated land and are usually well above dryland yields.');
  }

  const farm: Farm = {
    latitude: lat0,
    paddocks,
    ...(input.state ? { state: input.state } : {}),
    ...(input.confirmedBuyers ? { confirmedBuyers: input.confirmedBuyers } : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
    ...(baseYields && Object.keys(baseYields).length ? { baseYields } : {}),
  };
  const mode = input.weatherAdjustment ?? (input.climateTrends ? 'present' : 'none');
  const built = buildWeather(farm, power.weather, {
    ...(input.climateTrends ? { trends: input.climateTrends } : {}),
    ...(input.targetYear !== undefined ? { targetYear: input.targetYear } : {}),
    weatherAdjustment: mode,
  });
  gaps.push(...built.gaps);
  return {
    farm,
    weather: built.weather,
    scenarios: isEnsemble(built.weather) ? built.weather.mean : built.weather,
    weatherSource: { daily: power.weather, ...(input.climateTrends ? { trends: input.climateTrends } : {}), weatherAdjustment: mode },
    targetYear: built.targetYear,
    daily: power.weather,
    provenance,
    gaps: [...new Set(gaps)],
  };
}
