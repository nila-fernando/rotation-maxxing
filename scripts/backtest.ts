/**
 * Backtest: does the NASA POWER water balance track real county yields?
 *
 *   npm run backtest                      # model series only (keyless)
 *   NASS_API_KEY=... npm run backtest     # + USDA QuickStats county yields and skill scores
 *
 * For each county: NASA POWER daily weather + SSURGO soil at the county point
 * -> the planner's weather pool -> the model's yield multiplier per year.
 * With a key, QuickStats county yields are detrended (linear trend, so
 * genetics/management gains are removed) and compared year by year:
 *   anomaly(actual) = yield / trend,   anomaly(model) = multiplier
 * Reported: correlation, mean absolute error of anomalies, and the worst year.
 *
 * Network: calls NASA POWER, Soil Data Access and (with a key) QuickStats.
 * The key is read from the environment only and never written anywhere.
 */
import { scenariosFromDailyWeather } from '../src/algorithm/climate';
import type { Farm } from '../src/algorithm/types';
import { fetchPowerDaily } from '../src/data/power';
import { fetchSoilAtPoint } from '../src/data/ssurgo';

interface County {
  name: string;
  state: 'IA' | 'KS';
  county: string;
  lat: number;
  lng: number;
  crops: { cropId: string; commodity: string; util?: string }[];
}

const COUNTIES: County[] = [
  {
    name: 'Story County, IA',
    state: 'IA',
    county: 'STORY',
    lat: 42.03,
    lng: -93.47,
    crops: [
      { cropId: 'corn', commodity: 'CORN', util: 'GRAIN' },
      { cropId: 'soybeans', commodity: 'SOYBEANS' },
    ],
  },
  {
    name: 'Saline County, KS',
    state: 'KS',
    county: 'SALINE',
    lat: 38.78,
    lng: -97.65,
    crops: [
      { cropId: 'winter-wheat', commodity: 'WHEAT' },
      { cropId: 'sorghum', commodity: 'SORGHUM', util: 'GRAIN' },
      { cropId: 'soybeans', commodity: 'SOYBEANS' },
    ],
  },
];

const FIRST = 2001;
const LAST = 2024;

async function quickStatsYields(key: string, c: County, commodity: string, util?: string): Promise<Map<number, number>> {
  const q = new URLSearchParams({
    key,
    source_desc: 'SURVEY',
    sector_desc: 'CROPS',
    commodity_desc: commodity,
    statisticcat_desc: 'YIELD',
    agg_level_desc: 'COUNTY',
    state_alpha: c.state,
    county_name: c.county,
    year__GE: String(FIRST),
    format: 'JSON',
    ...(util ? { util_practice_desc: util } : {}),
  });
  const res = await fetch(`https://quickstats.nass.usda.gov/api/api_GET/?${q}`);
  if (!res.ok) throw new Error(`QuickStats HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Record<string, string>[] };
  const out = new Map<number, number>();
  for (const r of body.data ?? []) {
    if (r['prodn_practice_desc'] && r['prodn_practice_desc'] !== 'ALL PRODUCTION PRACTICES') continue;
    if (commodity === 'WHEAT' && r['class_desc'] && r['class_desc'] !== 'WINTER') continue;
    if (!/BU \/ ACRE/.test(r['unit_desc'] ?? '')) continue;
    const v = Number((r['Value'] ?? '').replace(/,/g, ''));
    if (Number.isFinite(v)) out.set(Number(r['year']), v);
  }
  return out;
}

function detrend(series: Map<number, number>): Map<number, number> {
  const xs = [...series.keys()];
  const ys = xs.map((x) => series.get(x)!);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const out = new Map<number, number>();
  xs.forEach((x, i) => out.set(x, ys[i]! / (my + slope * (x - mx))));
  return out;
}

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

async function main(): Promise<void> {
  const key = process.env['NASS_API_KEY'];
  const lines: string[] = [`# Backtest: NASA POWER water balance vs county yields (${FIRST}-${LAST})`, ''];
  if (!key) {
    lines.push('> **No `NASS_API_KEY` set: only the model series is shown. Set a free QuickStats key to score it against county yields.**', '');
  }
  for (const c of COUNTIES) {
    const power = await fetchPowerDaily(c.lat, c.lng, FIRST - 1, LAST);
    const soil = await fetchSoilAtPoint(c.lng, c.lat);
    const farm: Farm = {
      latitude: c.lat,
      state: c.state,
      paddocks: [
        {
          id: 'x',
          name: c.name,
          acres: 100,
          polygon: { localM: [[0, 0], [100, 0], [100, 100], [0, 100]] },
          land: soil.land,
          history: [],
          availableCrops: c.crops.map((x) => x.cropId),
        },
      ],
    };
    const climate = scenariosFromDailyWeather(farm, power.weather, { crops: c.crops.map((x) => x.cropId) });
    const byYear = new Map(climate.scenarios.map((s) => [Number(s.label!.slice(0, 4)), s]));
    lines.push(`## ${c.name}`, '', `Soil: ${soil.mapUnit} (AWC ${soil.land.awcInPerIn?.toFixed(2)} in/in).`, '');

    for (const crop of c.crops) {
      const model = new Map<number, number>();
      for (const [y, s] of byYear) {
        const m = s.multipliers[crop.cropId];
        if (m !== undefined) model.set(y, m);
      }
      lines.push(`### ${crop.cropId}`, '');
      if (!key) {
        const worst = [...model.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3);
        lines.push(`Model's three worst years: ${worst.map(([y, m]) => `${y} (${m.toFixed(2)})`).join(', ')}.`, '');
        continue;
      }
      const actual = detrend(await quickStatsYields(key, c, crop.commodity, crop.util));
      const years = [...model.keys()].filter((y) => actual.has(y)).sort();
      if (years.length < 5) {
        lines.push(`Too few overlapping years with QuickStats (${years.length}).`, '');
        continue;
      }
      const a = years.map((y) => actual.get(y)!);
      const m = years.map((y) => model.get(y)!);
      const mae = a.reduce((s, v, i) => s + Math.abs(v - m[i]!), 0) / a.length;
      const worstActual = years[a.indexOf(Math.min(...a))]!;
      lines.push(
        `Years: ${years.length}. Correlation of anomalies r = ${correlation(a, m).toFixed(2)}. ` +
          `Mean absolute anomaly error ${(mae * 100).toFixed(0)}%. ` +
          `Worst real year ${worstActual}: actual ${(actual.get(worstActual)! * 100).toFixed(0)}% of trend, model ${(model.get(worstActual)! * 100).toFixed(0)}%.`,
        '',
        '| Year | Actual / trend | Model |',
        '|---|---|---|',
        ...years.map((y) => `| ${y} | ${actual.get(y)!.toFixed(2)} | ${model.get(y)!.toFixed(2)} |`),
        '',
      );
    }
  }
  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
