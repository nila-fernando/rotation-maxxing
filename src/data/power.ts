/**
 * NASA POWER daily point data (keyless). https://power.larc.nasa.gov/
 *
 * The fetch is separate from the parsing so the parser can be tested on a
 * recorded response without the network.
 */
import type { DailyWeather } from '../algorithm/types';

export const POWER_PARAMETERS = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'ALLSKY_SFC_SW_DWN', 'RH2M', 'WS2M'] as const;
const FILL = -999;

export function powerDailyUrl(lat: number, lng: number, startYmd: string, endYmd: string): string {
  const q = new URLSearchParams({
    parameters: POWER_PARAMETERS.join(','),
    community: 'AG',
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    start: startYmd,
    end: endYmd,
    format: 'JSON',
  });
  return `https://power.larc.nasa.gov/api/temporal/daily/point?${q}`;
}

interface PowerResponse {
  geometry?: { coordinates?: number[] };
  properties?: { parameter?: Record<string, Record<string, number>> };
}

export interface ParsedPower {
  weather: DailyWeather;
  /** Days where a value was missing and the previous day's value was carried forward. */
  filledDays: number;
  gaps: string[];
}

/** Turn a POWER daily JSON response into DailyWeather. Missing values carry the previous day forward. */
export function parsePowerDaily(json: unknown, latitude: number): ParsedPower {
  const r = json as PowerResponse;
  const p = r.properties?.parameter;
  if (!p || !p['T2M_MAX']) throw new Error('NASA POWER response has no daily parameters (check the dates and location).');
  const dates = Object.keys(p['T2M_MAX']!).sort();
  let filledDays = 0;
  const series = (name: string): number[] => {
    const src = p[name] ?? {};
    let last = 0;
    return dates.map((d) => {
      const v = src[d];
      if (v === undefined || v === FILL || !Number.isFinite(v)) {
        filledDays++;
        return last;
      }
      last = v;
      return v;
    });
  };
  const weather: DailyWeather = {
    dates: dates.map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`),
    tmaxC: series('T2M_MAX'),
    tminC: series('T2M_MIN'),
    rainMm: series('PRECTOTCORR'),
    solarMJ: series('ALLSKY_SFC_SW_DWN'),
    rhPct: series('RH2M'),
    wind2m: series('WS2M'),
    latitude,
    elevationM: r.geometry?.coordinates?.[2] ?? 0,
    source: 'nasaPower',
  };
  const gaps = filledDays > 0 ? [`NASA POWER had ${filledDays} missing daily values; the previous day was carried forward.`] : [];
  return { weather, filledDays, gaps };
}

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Fetch daily weather for whole calendar years [startYear, endYear]. */
export async function fetchPowerDaily(
  lat: number,
  lng: number,
  startYear: number,
  endYear: number,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<ParsedPower> {
  const res = await fetchFn(powerDailyUrl(lat, lng, `${startYear}0101`, `${endYear}1231`));
  if (!res.ok) throw new Error(`NASA POWER request failed (HTTP ${res.status}).`);
  return parsePowerDaily(await res.json(), lat);
}
