import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatePlans } from '../../algorithm/api';
import { buildFarm } from '../buildFarm';
import type { FetchFn } from '../power';
import type { BaseYieldsFile } from '../nassYields';

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
    expect(built.farm.baseYields).toBeUndefined();
    expect(built.gaps.join()).toMatch(/No county yields .* US averages/);
  });

  it('uses the jar test texture over SSURGO, and a typed texture over both', async () => {
    const jar = (sand: number | null, clay: number | null, confidence: 'high' | 'low' = 'high') => ({
      source: 'jar-photo' as const, sandPct: sand, siltPct: sand === null || clay === null ? null : 100 - sand - clay, clayPct: clay,
      textureClass: 'Sandy loam', drainage: null, waterHolding: null, organicMatterLevel: 'Little' as const, organicMatterPct: 2,
      stoneLevel: 'None seen' as const, gravelPct: 0, siltClayCombined: sand === null, cloudyWater: false, teaColouredWater: false, foam: false,
      layers: [], confidence, adjustedByFarmer: false, photoTakenAfter: 'ok' as const,
    });
    const base = { id: 'a', name: 'A', polygon: square(-93.63, 42.03), availableCrops: ['corn'], history: ['oats', 'oats', 'oats'] };
    const ssurgoOnly = await buildFarm({ fields: [base], weatherYears: [2011, 2014] }, fake);
    expect(ssurgoOnly.farm.paddocks[0]!.land.texture).not.toBe('sand');

    const withJar = await buildFarm({ fields: [{ ...base, jarTest: jar(75, 10) }], weatherYears: [2011, 2014] }, fake);
    expect(withJar.farm.paddocks[0]!.land.texture).toBe('sand');
    expect(withJar.provenance['a']!.soil).toMatch(/texture from jar test: Sandy loam \(75% sand, 15% silt, 10% clay; confidence high\)/);
    expect(withJar.farm.paddocks[0]!.land.awcInPerIn).toBe(ssurgoOnly.farm.paddocks[0]!.land.awcInPerIn);

    const typed = await buildFarm({ fields: [{ ...base, jarTest: jar(75, 10), land: { texture: 'clay' } }], weatherYears: [2011, 2014] }, fake);
    expect(typed.farm.paddocks[0]!.land.texture).toBe('clay');

    const low = await buildFarm({ fields: [{ ...base, jarTest: jar(75, 10, 'low') }], weatherYears: [2011, 2014] }, fake);
    expect(low.farm.paddocks[0]!.land.texture).toBe(ssurgoOnly.farm.paddocks[0]!.land.texture);
    expect(low.gaps.join()).toMatch(/confidence is low/);

    const combined = await buildFarm({ fields: [{ ...base, jarTest: jar(null, null) }], weatherYears: [2011, 2014] }, fake);
    expect(combined.gaps.join()).toMatch(/silt and clay settled as one layer/);
  });

  it('uses the precomputed county base yields for the farm practice', async () => {
    const by = (value: number, practice: 'non-irrigated' | 'irrigated') => ({ value, level: 'county' as const, place: 'Story County, IA', practice, years: [2021, 2025], allPracticeMean: 200, basis: 'design' as const, sources: ['nassQuickStats'] });
    const file: BaseYieldsFile = {
      site: 'story-ia', geoid: '19169', place: 'Story County, IA', retrieved: '2026-11-15',
      'non-irrigated': { baseYields: { corn: by(195, 'non-irrigated'), oats: by(70, 'non-irrigated') }, gaps: ['Oats: example gap.', 'Barley: not grown here.'] },
      irrigated: { baseYields: { corn: by(230, 'irrigated') }, gaps: [] },
      series: {},
    };
    const field = { id: 'a', name: 'A', polygon: square(-93.63, 42.03), availableCrops: ['corn', 'oats'], history: ['oats', 'oats', 'oats'] };
    const dry = await buildFarm({ fields: [field], weatherYears: [2011, 2014], baseYields: file }, fake);
    expect(dry.farm.baseYields?.['corn']?.value).toBe(195);
    expect(dry.gaps).toContain('Oats: example gap.');
    expect(dry.gaps).not.toContain('Barley: not grown here.');
    const irr = await buildFarm({ fields: [field], weatherYears: [2011, 2014], baseYields: file, constraints: { irrigation: 'irrigated' } }, fake);
    expect(irr.farm.baseYields?.['corn']?.value).toBe(230);
    expect(irr.farm.baseYields?.['oats']).toBeUndefined();
  });
});
