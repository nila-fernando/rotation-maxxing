import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cachedText, fitTrend, monthlyMeans, olsSlope, parseCatalog, parseNcssCsv, pool, scenarioFor, toModelUnits, type ResponseCache } from '../cmip6';
import type { FetchFn } from '../power';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

describe('NEX-GDDP-CMIP6 access', () => {
  it('parses a recorded NCSS point CSV (one year, one variable, nearest 0.25 deg cell)', () => {
    const s = parseNcssCsv(fx('ncss_miroc6_pr_2000.csv'));
    expect(s.dates).toHaveLength(366);
    expect(s.dates[0]).toBe('2000-01-01');
    expect(s.gridLat).toBeCloseTo(38.875);
    expect(s.gridLng).toBeCloseTo(-97.625);
    expect(s.values.every((v) => v >= 0)).toBe(true);
  });

  it('picks the highest file version per year from the THREDDS catalog', () => {
    const real = parseCatalog(fx('thredds_catalog_miroc6_pr.xml'));
    expect(real.get(2000)).toMatch(/_2000_v2\.0\.nc$/);
    const mixed = parseCatalog('urlPath="a/x_gn_1999.nc" urlPath="a/x_gn_1999_v2.0.nc" urlPath="a/x_gn_1999_v1.1.nc" urlPath="a/x_gn_2001.nc"');
    expect(mixed.get(1999)).toBe('a/x_gn_1999_v2.0.nc');
    expect(mixed.get(2001)).toBe('a/x_gn_2001.nc');
  });

  it('joins historical (<= 2014) to ssp245 (>= 2015)', () => {
    expect(scenarioFor(2014)).toBe('historical');
    expect(scenarioFor(2015)).toBe('ssp245');
  });

  it('converts units: K -> C, kg m-2 s-1 -> mm/day, W m-2 -> MJ m-2 day-1', () => {
    expect(toModelUnits('tasmax', 300)).toBeCloseTo(26.85);
    expect(toModelUnits('pr', 1 / 86400)).toBeCloseTo(1);
    expect(toModelUnits('rsds', 250)).toBeCloseTo(21.6);
    expect(toModelUnits('hurs', 65)).toBe(65);
    expect(toModelUnits('sfcWind', 3.2)).toBe(3.2);
  });
});

describe('trend fitting (3-month centred windows)', () => {
  it('OLS slope and standard error', () => {
    const r = olsSlope([0, 1, 2, 3, 4], [1, 3, 5, 7, 9]);
    expect(r.slope).toBeCloseTo(2);
    expect(r.se).toBeCloseTo(0);
    const noisy = olsSlope([0, 1, 2, 3, 4, 5], [0, 2, 1, 3, 2, 4]);
    expect(noisy.se).toBeGreaterThan(0);
  });

  it('recovers a known warming trend and a relative precipitation trend, wrapping Dec-Jan', () => {
    const byYear = new Map<number, number[]>();
    const pr = new Map<number, number[]>();
    for (let y = 1995; y <= 2035; y++) {
      byYear.set(y, Array.from({ length: 12 }, (_, m) => 10 + m + 0.03 * (y - 1995)));
      pr.set(y, Array.from({ length: 12 }, () => 2 * (1 + 0.01 * (y - 2015))));
    }
    const t = fitTrend(byYear, false);
    for (let m = 0; m < 12; m++) expect(t.slope[m]).toBeCloseTo(0.03, 6);
    const p = fitTrend(pr, true);
    expect(p.slope[6]).toBeCloseTo(0.01, 3); // relative to the series mean (2 at 2015)
  });

  it('computes monthly means from daily values', () => {
    const s = parseNcssCsv(fx('ncss_miroc6_pr_2000.csv'));
    const m = monthlyMeans({ ...s, values: s.values.map((v) => toModelUnits('pr', v)) });
    expect(m).toHaveLength(12);
    expect(m.every((v) => v >= 0 && v < 20)).toBe(true);
  });
});

describe('polite fetching', () => {
  it('serves repeats from the cache and caps concurrency at 4', async () => {
    const store = new Map<string, string>();
    const cache: ResponseCache = { get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v) };
    let calls = 0, inFlight = 0, maxInFlight = 0;
    const fake: FetchFn = async () => {
      calls++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true, status: 200, json: async () => ({}), text: async () => 'ok' };
    };
    await pool(Array.from({ length: 12 }, (_, i) => () => cachedText(`u${i % 6}`, cache, fake)), 4);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(calls).toBeLessThanOrEqual(12);
    const before = calls;
    await cachedText('u0', cache, fake);
    expect(calls).toBe(before); // cached
  });
});
