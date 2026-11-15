/**
 * Precompute NASS base yields for the demo counties, so the demo needs no key.
 *
 *   NASS_API_KEY=... npm run nass-base-yields            # all sites
 *   NASS_API_KEY=... npm run nass-base-yields -- saline  # one site
 *   npm run nass-base-yields                             # re-pick from the saved series (no key, no requests)
 *   NASS_API_KEY=... npm run nass-base-yields -- --refetch
 *
 * Writes src/data/baseYields/<site>.json with both the non-irrigated and the
 * irrigated base yields, plus the raw NASS series they came from. The key is
 * read from the environment only and is never written anywhere.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chooseBaseYield, fetchBaseYields, NASS_YIELD_SPECS, type BaseYieldsFile, type BaseYieldsResult, type LevelSeries } from '../src/data/nassYields';

function recompute(series: BaseYieldsFile['series'], crops: string[]): BaseYieldsResult {
  const out: BaseYieldsResult = { baseYields: {}, gaps: [], series: {} };
  for (const c of crops) {
    const levels: LevelSeries[] = (series[c] ?? []).map((l) => ({ ...l, place: l.level === 'county' ? l.place.replace(/\bMc(\w)/gi, (_, x: string) => `Mc${x.toUpperCase()}`) : l.place }));
    out.series[c] = levels;
    const pick = chooseBaseYield(c, levels, 'non-irrigated');
    out.gaps.push(...pick.gaps);
    if (pick.baseYield) out.baseYields[c] = pick.baseYield;
  }
  return out;
}

const SITES: { site: string; geoid: string }[] = [
  { site: 'saline-ks', geoid: '20169' },
  { site: 'mcpherson-ks', geoid: '20113' },
  { site: 'story-ia', geoid: '19169' },
  { site: 'boone-ia', geoid: '19015' },
];
const OUT_DIR = join(process.cwd(), 'src', 'data', 'baseYields');

async function main(): Promise<void> {
  const key = () => {
    const k = process.env['NASS_API_KEY'];
    if (!k) throw new Error('Set NASS_API_KEY in the environment.');
    return k;
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const refetch = process.argv.includes('--refetch');
  const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const crops = Object.keys(NASS_YIELD_SPECS);
  for (const s of SITES.filter((x) => !only || x.site.startsWith(only))) {
    const stateFips = s.geoid.slice(0, 2), countyFips = s.geoid.slice(2);
    // Re-use the series already saved (no new requests) unless --refetch.
    const prev = join(OUT_DIR, `${s.site}.json`);
    const dry = !refetch && existsSync(prev)
      ? recompute((JSON.parse(readFileSync(prev, 'utf8')) as BaseYieldsFile).series, crops)
      : await fetchBaseYields({ key: key(), stateFips, countyFips, crops, practice: 'non-irrigated' });
    // Same series, other practice: no second download.
    const irr = { baseYields: {} as BaseYieldsFile['irrigated']['baseYields'], gaps: [] as string[] };
    for (const c of crops) {
      const pick = chooseBaseYield(c, dry.series[c] ?? [], 'irrigated');
      irr.gaps.push(...pick.gaps);
      if (pick.baseYield) irr.baseYields[c] = pick.baseYield;
    }
    const place = Object.values(dry.series).flatMap((l) => l ?? []).find((l) => l.level === 'county')?.place ?? s.site;
    const file: BaseYieldsFile = {
      site: s.site,
      geoid: s.geoid,
      place,
      retrieved: new Date().toISOString().slice(0, 10),
      'non-irrigated': { baseYields: dry.baseYields, gaps: dry.gaps },
      irrigated: irr,
      series: dry.series,
    };
    writeFileSync(join(OUT_DIR, `${s.site}.json`), JSON.stringify(file, (_, v) => (typeof v === 'number' ? Number(v.toPrecision(5)) : v), 1));
    console.log(`${s.site} (${place}):`);
    for (const c of crops) {
      const d = dry.baseYields[c], i = irr.baseYields[c];
      console.log(`  ${c}: non-irrigated ${d ? `${d.value.toFixed(1)} (${d.level}, ${d.practice})` : 'US avg'}; irrigated ${i ? `${i.value.toFixed(1)} (${i.level}, ${i.practice})` : 'US avg'}`);
    }
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
