/**
 * Report: how much does the present-climate adjustment change the plans?
 *
 *   npm run climate-compare             # all sites with a trends file
 *   npm run climate-compare -- saline   # one site
 *
 * For each site: NASA POWER 2000-2024 at the county centroid, SSURGO at the
 * centroid, a 4-paddock demo farm, and the three plans with weatherAdjustment
 * 'none' vs 'present' (target = PLANNING_SEASON). Prints the shift applied to
 * the oldest pool year per variable (flagging trends < 2x their standard
 * error), and each plan's expected margin, P10 and rank.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePlans } from '../src/algorithm/api';
import { buildWeather, meanTrends, shiftTable, type ClimateTrendsFile } from '../src/algorithm/climateAdjust';
import { SQ_M_PER_ACRE } from '../src/algorithm/geometry';
import type { CropId, Farm, PlanResult, Priorities } from '../src/algorithm/types';
import { fetchCountyOutline } from '../src/data/countySample';
import { fetchPowerDaily } from '../src/data/power';
import { fetchSoilAtPoint } from '../src/data/ssurgo';

const PLANNING_SEASON = 2027;
const NEUTRAL: Priorities = { profit: 50, soilHealth: 50, water: 50, risk: 50 };
const SITES: { site: string; geoid: string; state: 'IA' | 'KS'; history: CropId[]; crops: CropId[] }[] = [
  { site: 'saline-ks', geoid: '20169', state: 'KS', history: ['sorghum', 'winter-wheat', 'soybeans'], crops: ['winter-wheat', 'sorghum', 'soybeans', 'corn', 'oats', 'fallow', 'cereal-rye'] },
  { site: 'mcpherson-ks', geoid: '20113', state: 'KS', history: ['sorghum', 'winter-wheat', 'soybeans'], crops: ['winter-wheat', 'sorghum', 'soybeans', 'corn', 'oats', 'fallow', 'cereal-rye'] },
  { site: 'story-ia', geoid: '19169', state: 'IA', history: ['corn', 'soybeans', 'corn'], crops: ['corn', 'soybeans', 'oats', 'winter-wheat', 'fallow', 'cereal-rye'] },
  { site: 'boone-ia', geoid: '19015', state: 'IA', history: ['corn', 'soybeans', 'corn'], crops: ['corn', 'soybeans', 'oats', 'winter-wheat', 'fallow', 'cereal-rye'] },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function main(): Promise<void> {
  const only = process.argv[2];
  const out: string[] = [`# Present-climate adjustment: effect on plans (planning season ${PLANNING_SEASON})`, ''];
  for (const s of SITES.filter((x) => !only || x.site.startsWith(only))) {
    const file = join(process.cwd(), 'src', 'data', 'cmip6', `${s.site}.json`);
    if (!existsSync(file)) {
      out.push(`## ${s.site}`, '', 'No trends file yet (run `npm run cmip6-trends`).', '');
      continue;
    }
    const trends = JSON.parse(readFileSync(file, 'utf8')) as ClimateTrendsFile;
    const county = await fetchCountyOutline(s.geoid);
    const [lng, lat] = county.centroid;
    const power = await fetchPowerDaily(lat, lng, 2000, 2024);
    const soil = await fetchSoilAtPoint(lng, lat);
    const side = Math.sqrt(40 * SQ_M_PER_ACRE);
    const farm: Farm = {
      latitude: lat,
      state: s.state,
      paddocks: [0, 1, 2, 3].map((i) => ({
        id: `p${i}`,
        name: `Field ${i + 1}`,
        acres: 40,
        polygon: { localM: [[(i % 2) * side, Math.floor(i / 2) * side], [(i % 2 + 1) * side, Math.floor(i / 2) * side], [(i % 2 + 1) * side, (Math.floor(i / 2) + 1) * side], [(i % 2) * side, (Math.floor(i / 2) + 1) * side]] },
        land: soil.land,
        history: i % 2 === 0 ? s.history : [...s.history.slice(1), s.history[0]!],
        availableCrops: s.crops,
      })),
    };
    const none = buildWeather(farm, power.weather, { trends, targetYear: PLANNING_SEASON, weatherAdjustment: 'none' });
    const present = buildWeather(farm, power.weather, { trends, targetYear: PLANNING_SEASON, weatherAdjustment: 'present' });
    const opts = { seed: 1, mcSamples: 300, rankJitterSamples: 100 };
    const rNone = generatePlans(farm, NEUTRAL, {}, none.weather, opts);
    const rPres = generatePlans(farm, NEUTRAL, {}, present.weather, opts);

    const mean = meanTrends(trends);
    const oldest = 2001;
    const rows = shiftTable(mean, oldest, PLANNING_SEASON);
    out.push(`## ${county.name}, ${s.state}`, '', `Grid cell ${trends.gridCell.lat}, ${trends.gridCell.lng}; soil ${soil.mapUnit}; models ${trends.models.map((m) => m.model).join(', ')}.`, '');
    out.push(`### Shift applied to the oldest pool year (${oldest} -> ${PLANNING_SEASON}), 5-model mean`, '', '| Variable | Unit | ' + MONTHS.join(' | ') + ' |', '|---|---|' + MONTHS.map(() => '---').join('|') + '|');
    for (const v of ['tasmax', 'tasmin', 'pr', 'hurs', 'rsds', 'sfcWind']) {
      const r = rows.filter((x) => x.variable === v);
      out.push(`| ${v} | ${r[0]!.unit} | ` + r.map((x) => `${x.shift >= 0 ? '+' : ''}${x.shift.toFixed(v === 'pr' || v === 'rsds' || v === 'sfcWind' ? 1 : 2)}${x.likelyNoise ? '*' : ''}`).join(' | ') + ' |');
    }
    const noise = rows.filter((x) => x.likelyNoise).length;
    out.push('', `\\* = trend smaller than 2x its standard error (likely noise): ${noise} of ${rows.length} month-variable shifts.`, '');

    const fmt = (p: PlanResult) => `$${Math.round(p.expectedGM).toLocaleString('en-US')} | $${Math.round(p.p10GM).toLocaleString('en-US')}`;
    const rank = (r: typeof rNone) => {
      const ps = Object.entries(r.plans).sort((a, b) => b[1].objective - a[1].objective).map(([k]) => k);
      return (k: string) => ps.indexOf(k) + 1;
    };
    const rn = rank(rNone), rp = rank(rPres);
    out.push('### Plans: none vs present', '', '| Plan | Sequence (field 1), none -> present | Expected GM (none) | P10 (none) | Expected GM (present) | P10 (present) | Rank none -> present |', '|---|---|---|---|---|---|---|');
    for (const k of ['current', 'maxProfit', 'priority'] as const) {
      const a = rNone.plans[k], b = rPres.plans[k];
      out.push(
        `| ${k} | ${a.paddocks[0]!.sequence.join('>')} -> ${b.paddocks[0]!.sequence.join('>')} | ${fmt(a).replace(' | ', ' | ')} | ${fmt(b)} | ${rn(k)} -> ${rp(k)} |`,
      );
    }
    out.push('', `Explanation shown: "${rPres.plans.priority.reasons.find((x) => /adjusted to today/.test(x)) ?? ''}"`, '');
  }
  console.log(out.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
