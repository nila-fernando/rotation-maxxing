/**
 * Precompute NEX-GDDP-CMIP6 monthly trends for the demo farm sites.
 *
 *   npm run cmip6-trends            # all sites
 *   npm run cmip6-trends -- saline  # one site
 *
 * Writes src/data/cmip6/<site>.json. Every point response is cached under
 * .cache/cmip6/ (gitignored), so re-runs don't repeat requests. At most 4
 * requests are in flight at once (polite to NASA NCCS).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchSiteTrends, type ResponseCache } from '../src/data/cmip6';
import { fetchCountyOutline } from '../src/data/countySample';

const SITES: { site: string; geoid: string }[] = [
  { site: 'saline-ks', geoid: '20169' },
  { site: 'mcpherson-ks', geoid: '20113' },
  { site: 'story-ia', geoid: '19169' },
  { site: 'boone-ia', geoid: '19015' },
];

const CACHE_DIR = join(process.cwd(), '.cache', 'cmip6');
const OUT_DIR = join(process.cwd(), 'src', 'data', 'cmip6');

const fileCache: ResponseCache = {
  async get(key) {
    const f = join(CACHE_DIR, createHash('sha256').update(key).digest('hex') + '.txt');
    return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
  },
  async set(key, value) {
    writeFileSync(join(CACHE_DIR, createHash('sha256').update(key).digest('hex') + '.txt'), value);
  },
};

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const only = process.argv[2];
  const retrieved = new Date().toISOString().slice(0, 10);
  for (const s of SITES.filter((x) => !only || x.site.startsWith(only))) {
    const county = await fetchCountyOutline(s.geoid);
    const [lng, lat] = county.centroid;
    let last = 0;
    const t = await fetchSiteTrends(s.site, lat, lng, retrieved, fileCache, undefined, (done, total) => {
      const pct = Math.floor((done / total) * 10);
      if (pct > last) {
        last = pct;
        console.log(`${s.site}: ${done}/${total}`);
      }
    });
    writeFileSync(join(OUT_DIR, `${s.site}.json`), JSON.stringify(t, (_, v) => (typeof v === 'number' ? Number(v.toPrecision(5)) : v), 1));
    console.log(`${s.site}: wrote ${s.site}.json (grid cell ${t.gridCell.lat}, ${t.gridCell.lng})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
