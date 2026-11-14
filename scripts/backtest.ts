/**
 * Backtest: does the NASA POWER water balance track real county yields?
 *
 *   npm run backtest                      # model series only (keyless)
 *   NASS_API_KEY=... npm run backtest     # + USDA QuickStats county yields and skill scores
 *
 * Two soil set-ups per county, so changes can be compared:
 *   point:  one SSURGO point at the county centroid (the original method)
 *   sample: ~15 seeded random points on the county's cropland (CDL corn/soy/
 *           wheat/sorghum pixels), each with its own SSURGO soil. Uniform
 *           points make the average area-weighted over cropland soils.
 * Weather: NASA POWER at the county centroid. Actual yields: QuickStats county
 * yields, detrended linearly (anomaly = yield / trend). Reported: correlation r,
 * mean absolute anomaly error, spread (sd) and the worst real year.
 *
 * Story IA and Saline KS were used while developing the model; Boone IA and
 * McPherson KS are held out (never looked at before this run).
 * The key is read from the environment only and never written anywhere.
 */
import { scenariosFromDailyWeather } from '../src/algorithm/climate';
import type { Farm, Land, Paddock } from '../src/algorithm/types';
import { fetchCountyOutline, sampleCroplandSoils } from '../src/data/countySample';
import { fetchPowerDaily } from '../src/data/power';
import { fetchSoilAtPoint } from '../src/data/ssurgo';

interface County {
  geoid: string;
  state: 'IA' | 'KS';
  county: string;
  heldOut: boolean;
  crops: { cropId: string; commodity: string; util?: string }[];
}

const IA_CROPS = [
  { cropId: 'corn', commodity: 'CORN', util: 'GRAIN' },
  { cropId: 'soybeans', commodity: 'SOYBEANS' },
];
const KS_CROPS = [
  { cropId: 'winter-wheat', commodity: 'WHEAT' },
  { cropId: 'sorghum', commodity: 'SORGHUM', util: 'GRAIN' },
  { cropId: 'soybeans', commodity: 'SOYBEANS' },
];
const COUNTIES: County[] = [
  { geoid: '19169', state: 'IA', county: 'STORY', heldOut: false, crops: IA_CROPS },
  { geoid: '19015', state: 'IA', county: 'BOONE', heldOut: true, crops: IA_CROPS },
  { geoid: '20169', state: 'KS', county: 'SALINE', heldOut: false, crops: KS_CROPS },
  { geoid: '20113', state: 'KS', county: 'MCPHERSON', heldOut: true, crops: KS_CROPS },
];
const CROPLAND = ['Corn', 'Soybeans', 'Winter Wheat', 'Sorghum', 'Dbl Crop WinWht/Soybeans'];
const FIRST = 2001;
const LAST = 2024;
const SAMPLE_N = 15;
const CDL_YEAR = 2020;

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

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
function correlation(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

function farmFrom(c: County, lat: number, lands: Land[]): Farm {
  const paddocks: Paddock[] = lands.map((land, i) => ({
    id: `s${i}`,
    name: `${c.county} sample ${i + 1}`,
    acres: 1,
    // Separate 1-acre squares (no shared edges, so no shade between samples).
    polygon: { localM: [[i * 200, 0], [i * 200 + 63.6, 0], [i * 200 + 63.6, 63.6], [i * 200, 63.6]] },
    land,
    history: [],
    availableCrops: c.crops.map((x) => x.cropId),
  }));
  return { latitude: lat, state: c.state, paddocks };
}

async function main(): Promise<void> {
  const key = process.env['NASS_API_KEY'];
  const lines: string[] = [`# Backtest: NASA POWER water balance vs county yields (${FIRST}-${LAST})`, ''];
  if (!key) lines.push('> **No `NASS_API_KEY` set: only model series are shown.**', '');
  const summary: string[] = ['| County | Crop | Soils | r | Mean abs. error | Spread model / actual | Worst real year (actual / model) |', '|---|---|---|---|---|---|---|'];

  for (const c of COUNTIES) {
    const outline = await fetchCountyOutline(c.geoid);
    const [lng, lat] = outline.centroid;
    const power = await fetchPowerDaily(lat, lng, FIRST - 2, LAST);
    const pointSoil = await fetchSoilAtPoint(lng, lat);
    const sample = await sampleCroplandSoils(outline, { n: SAMPLE_N, year: CDL_YEAR, categories: CROPLAND, seed: 1 });
    const units = new Map<string, number>();
    for (const p of sample.points) units.set(p.soil.mapUnit, (units.get(p.soil.mapUnit) ?? 0) + 1);

    lines.push(
      `## ${outline.name}, ${c.state}${c.heldOut ? ' (held out)' : ''}`,
      '',
      `- Point soil (centroid): ${pointSoil.mapUnit} (AWC ${pointSoil.land.awcInPerIn?.toFixed(2)}).`,
      `- Cropland sample: ${sample.points.length} points from ${sample.draws} draws (CDL ${CDL_YEAR}); mean AWC ` +
        `${mean(sample.points.map((p) => p.soil.land.awcInPerIn ?? 0)).toFixed(2)}; ${units.size} map units: ` +
        [...units.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u, n]) => `${u} (${n})`).join('; ') + '.',
      ...sample.gaps.map((g) => `- ${g}`),
      '',
    );

    const modes: [string, Land[]][] = [
      ['point', [pointSoil.land]],
      ['sample', sample.points.map((p) => p.soil.land)],
    ];
    const models: Record<string, Map<string, Map<number, number>>> = {};
    for (const [mode, lands] of modes) {
      const climate = scenariosFromDailyWeather(farmFrom(c, lat, lands), power.weather, { crops: c.crops.map((x) => x.cropId) });
      const byCrop = new Map<string, Map<number, number>>();
      for (const s of climate.scenarios) {
        const y = Number(s.label!.slice(0, 4));
        for (const crop of c.crops) {
          const m = s.multipliers[crop.cropId];
          if (m === undefined) continue;
          if (!byCrop.has(crop.cropId)) byCrop.set(crop.cropId, new Map());
          byCrop.get(crop.cropId)!.set(y, m);
        }
      }
      models[mode] = byCrop;
    }

    for (const crop of c.crops) {
      lines.push(`### ${crop.cropId}`, '');
      if (!key) {
        for (const mode of ['point', 'sample']) {
          const m = models[mode]!.get(crop.cropId) ?? new Map();
          const worst = [...m.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3);
          lines.push(`- ${mode}: model's worst years ${worst.map(([y, v]) => `${y} (${v.toFixed(2)})`).join(', ')}`);
        }
        lines.push('');
        continue;
      }
      const actual = detrend(await quickStatsYields(key, c, crop.commodity, crop.util));
      const rows: string[] = ['| Year | Actual / trend | Model (point) | Model (sample) |', '|---|---|---|---|'];
      for (const mode of ['point', 'sample']) {
        const model = models[mode]!.get(crop.cropId) ?? new Map<number, number>();
        const years = [...model.keys()].filter((y) => actual.has(y)).sort();
        if (years.length < 5) {
          summary.push(`| ${outline.name} | ${crop.cropId} | ${mode} | too few years (${years.length}) | | | |`);
          continue;
        }
        const a = years.map((y) => actual.get(y)!);
        const m = years.map((y) => model.get(y)!);
        const worst = years[a.indexOf(Math.min(...a))]!;
        summary.push(
          `| ${outline.name}${c.heldOut ? ' *' : ''} | ${crop.cropId} | ${mode} | ${correlation(a, m).toFixed(2)} | ` +
            `${((a.reduce((s, v, i) => s + Math.abs(v - m[i]!), 0) / a.length) * 100).toFixed(0)}% | ` +
            `${sd(m).toFixed(2)} / ${sd(a).toFixed(2)} | ${worst}: ${actual.get(worst)!.toFixed(2)} / ${model.get(worst)!.toFixed(2)} |`,
        );
      }
      const pm = models['point']!.get(crop.cropId) ?? new Map<number, number>();
      const sm = models['sample']!.get(crop.cropId) ?? new Map<number, number>();
      for (const y of [...actual.keys()].sort()) {
        if (pm.has(y) || sm.has(y)) rows.push(`| ${y} | ${actual.get(y)!.toFixed(2)} | ${pm.get(y)?.toFixed(2) ?? ''} | ${sm.get(y)?.toFixed(2) ?? ''} |`);
      }
      lines.push(...rows, '');
    }
  }
  if (key) lines.splice(2, 0, '## Summary (* = held-out county)', '', ...summary, '');
  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
