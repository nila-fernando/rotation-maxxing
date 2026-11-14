import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatePlans } from '../../algorithm/api';
import { buildFarm } from '../buildFarm';
import type { FetchFn } from '../power';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

/** Offline fake of the three services, answering from recorded responses. */
const fake: FetchFn = async (url) => {
  const ok = (body: string) => ({ ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body });
  if (url.includes('power.larc.nasa.gov')) return ok(fx('power_ames_2011_2014.json'));
  if (url.includes('SDMDataAccess')) return ok(fx('ssurgo_ames.json'));
  if (url.includes('GetCDLValue')) {
    const year = /year=(\d+)/.exec(url)![1]!;
    const cat = { '2012': 'Corn', '2013': 'Soybeans', '2014': 'Corn' }[year] ?? 'Corn';
    return ok(`{x: 0, y: 0, value: 1, category: "${cat}"}`);
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
};

const square = (lng: number, lat: number, d = 0.004): [number, number][] => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d]];

describe('buildFarm (offline, recorded responses)', () => {
  it('fills soil, history, acres and a NASA POWER weather pool, then plans', async () => {
    const built = await buildFarm(
      {
        fields: [
          { id: 'n', name: 'North', polygon: square(-93.63, 42.034), availableCrops: ['corn', 'soybeans', 'oats', 'cereal-rye', 'fallow'] },
          { id: 's', name: 'South', polygon: square(-93.63, 42.03), availableCrops: ['corn', 'soybeans', 'oats', 'cereal-rye', 'fallow'], tileDrained: true },
        ],
        state: 'IA',
        weatherYears: [2011, 2014],
      },
      fake,
    );
    const n = built.farm.paddocks[0]!;
    expect(n.history).toEqual(['corn', 'soybeans', 'corn']);
    expect(n.land.awcInPerIn).toBeCloseTo(0.17);
    expect(n.land.kFactor).toBeCloseTo(0.17);
    expect(n.acres).toBeGreaterThan(30); // 0.004 deg square at 42 N: ~445 m x 330 m = ~36 ac
    expect(n.acres).toBeLessThan(42);
    expect(built.farm.paddocks[1]!.tileDrained).toBe(true);
    expect(built.scenarios.length).toBeGreaterThan(0);
    expect(built.provenance['n']!.soil).toMatch(/Hanlon/);

    const r = generatePlans(built.farm, { profit: 60, soilHealth: 50, water: 30, risk: 40 }, {}, built.scenarios, { seed: 1, mcSamples: 40, rankJitterSamples: 20 });
    const y0 = r.plans.priority.paddocks[0]!.years[0]!;
    expect(y0.erosionTonsPerAcre).not.toBeNull();
    expect(r.plans.priority.paddocks.flatMap((p) => p.years).some((y) => y.terms.some((t) => t.sources?.includes('ssurgo')))).toBe(true);
  });

  it('lets farmer-entered values win over fetched data', async () => {
    const built = await buildFarm(
      {
        fields: [{ id: 'a', name: 'A', polygon: square(-93.63, 42.03), availableCrops: ['corn'], history: ['oats', 'oats', 'oats'], land: { slopePct: 7 }, acres: 50 }],
        weatherYears: [2011, 2014],
      },
      fake,
    );
    expect(built.farm.paddocks[0]).toMatchObject({ history: ['oats', 'oats', 'oats'], acres: 50 });
    expect(built.farm.paddocks[0]!.land.slopePct).toBe(7);
  });
});
