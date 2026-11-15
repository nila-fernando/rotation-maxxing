/**
 * Drop a pin (or draw fields), get a farm: everything the planner needs,
 * filled from keyless NASA and USDA services.
 *
 *   NASA POWER  -> daily weather -> water balance + erosivity -> weather pool
 *   SSURGO      -> soil per field (AWC, K, T, pH, EC, OM, texture, drainage, slope)
 *   CDL         -> last 3 years of crops per field (the current rotation)
 *
 * The farmer still supplies what satellites can't know: seed availability,
 * buyers, equipment, tillage, tile drainage, irrigation. Any field value the
 * caller passes wins over fetched data.
 */
import { scenariosFromDailyWeather } from '../algorithm/climate';
import { lngLatToLocal, polygonArea, SQ_M_PER_ACRE } from '../algorithm/geometry';
import type { CropId, DailyWeather, Farm, FarmConstraints, Land, LngLat, Paddock, StateCode, Tillage, WeatherScenario } from '../algorithm/types';
import { fetchCdlHistory } from './cdl';
import { fetchPowerDaily, type FetchFn } from './power';
import { fetchSoilAtPoint } from './ssurgo';

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
}

export interface BuiltFarm {
  farm: Farm;
  scenarios: WeatherScenario[];
  weather: DailyWeather;
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
    try {
      const soil = await fetchSoilAtPoint(lng, lat, fetchFn);
      land = { ...soil.land, ...f.land };
      soilNote = `${soil.mapUnit} (${soil.component})`;
      gaps.push(...soil.gaps.map((g) => `${f.name}: ${g}`));
    } catch (e) {
      if (!f.land || f.land.slopePct === undefined || !f.land.texture || !f.land.drainage) throw e;
      land = { salinityECe: 0, ...f.land } as Land;
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
    provenance[f.id] = { soil: soilNote, history: historyNote };
  }

  const farm: Farm = {
    latitude: lat0,
    paddocks,
    ...(input.state ? { state: input.state } : {}),
    ...(input.confirmedBuyers ? { confirmedBuyers: input.confirmedBuyers } : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
  };
  const climate = scenariosFromDailyWeather(farm, power.weather);
  gaps.push(...climate.gaps);
  return { farm, scenarios: climate.scenarios, weather: power.weather, provenance, gaps: [...new Set(gaps)] };
}
