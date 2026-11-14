import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCountyOutline, pointInRings, sampleCroplandSoils, type CountyOutline } from '../countySample';
import type { FetchFn } from '../power';

const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const hole: [number, number][] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];

describe('county sampling', () => {
  it('tests points against rings, including holes', () => {
    expect(pointInRings([5, 1], [square])).toBe(true);
    expect(pointInRings([11, 1], [square])).toBe(false);
    expect(pointInRings([5, 5], [square, hole])).toBe(false);
  });

  it('parses a TIGERweb county response', () => {
    const c = parseCountyOutline({ features: [{ attributes: { GEOID: '19169', NAME: 'Story County', CENTLAT: '+42.03', CENTLON: '-093.46' }, geometry: { rings: [square] } }] });
    expect(c).toMatchObject({ geoid: '19169', name: 'Story County', centroid: [-93.46, 42.03] });
  });

  it('keeps only target-crop points, is reproducible for a seed, and fetches soil for each', async () => {
    const ssurgo = readFileSync(join(__dirname, 'fixtures', 'ssurgo_ames.json'), 'utf8');
    let cdlCalls = 0;
    const fake: FetchFn = async (url) => {
      const ok = (b: string) => ({ ok: true, status: 200, json: async () => JSON.parse(b), text: async () => b });
      if (url.includes('GetCDLValue')) return ok(`{category: "${cdlCalls++ % 3 === 0 ? 'Grass/Pasture' : 'Corn'}"}`);
      return ok(ssurgo);
    };
    const county: CountyOutline = { geoid: 'x', name: 'Test', centroid: [-93.5, 42], rings: [[[-93.6, 41.9], [-93.4, 41.9], [-93.4, 42.1], [-93.6, 42.1], [-93.6, 41.9]]] };
    const a = await sampleCroplandSoils(county, { n: 6, year: 2020, categories: ['Corn', 'Soybeans'], seed: 7 }, fake);
    expect(a.points).toHaveLength(6);
    expect(a.points.every((p) => p.cdlCategory === 'Corn')).toBe(true);
    expect(a.points[0]!.soil.land.awcInPerIn).toBeGreaterThan(0);
    cdlCalls = 0;
    const b = await sampleCroplandSoils(county, { n: 6, year: 2020, categories: ['Corn', 'Soybeans'], seed: 7 }, fake);
    expect(b.points.map((p) => p.lngLat)).toEqual(a.points.map((p) => p.lngLat));
  });
});
