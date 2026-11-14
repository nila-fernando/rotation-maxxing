/**
 * Data adapters, tested offline on recorded API responses (fixtures/).
 * No test here touches the network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchCdlHistory, parseCdlValue, samplePoints, toAlbers5070 } from '../cdl';
import { parsePowerDaily, powerDailyUrl, type FetchFn } from '../power';
import { mapDrainage, mapTexture, parseSsurgo } from '../ssurgo';

const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('NASA POWER', () => {
  const parsed = parsePowerDaily(JSON.parse(fx('power_ames_2011_2014.json')), 42.03);

  it('parses daily series aligned with dates, with elevation', () => {
    const w = parsed.weather;
    expect(w.dates).toHaveLength(1461);
    expect(w.dates[0]).toBe('2011-01-01');
    for (const s of [w.tmaxC, w.tminC, w.rainMm, w.solarMJ, w.rhPct, w.wind2m]) expect(s).toHaveLength(1461);
    expect(w.elevationM).toBeCloseTo(310.22);
    expect(w.source).toBe('nasaPower');
  });

  it('shows the 2012 drought in summer rainfall', () => {
    const w = parsed.weather;
    const summer = (y: string) =>
      w.rainMm.filter((_, i) => w.dates[i]!.startsWith(y) && ['05', '06', '07', '08'].includes(w.dates[i]!.slice(5, 7))).reduce((a, b) => a + b, 0);
    expect(summer('2012')).toBeLessThan(0.7 * summer('2013'));
  });

  it('carries the previous day forward over fill values and reports it', () => {
    const r = parsePowerDaily(
      { geometry: { coordinates: [0, 0, 5] }, properties: { parameter: { T2M_MAX: { '20200101': 3, '20200102': -999 }, T2M_MIN: {}, PRECTOTCORR: {}, ALLSKY_SFC_SW_DWN: {}, RH2M: {}, WS2M: {} } } },
      40,
    );
    expect(r.weather.tmaxC).toEqual([3, 3]);
    expect(r.gaps[0]).toMatch(/carried forward/);
  });

  it('builds a keyless URL', () => {
    expect(powerDailyUrl(42, -93.6, '20200101', '20201231')).toMatch(/^https:\/\/power\.larc\.nasa\.gov\/api\/temporal\/daily\/point\?parameters=T2M_MAX/);
  });
});

describe('SSURGO', () => {
  it('maps classes', () => {
    expect(mapDrainage('Poorly drained')).toBe('poor');
    expect(mapDrainage('Moderately well drained')).toBe('moderate');
    expect(mapDrainage('Well drained')).toBe('good');
    expect(mapTexture(80, 5)).toBe('sand');
    expect(mapTexture(20, 45)).toBe('clay');
    expect(mapTexture(10, 25)).toBe('silt');
    expect(mapTexture(40, 20)).toBe('loam');
  });

  it('parses a recorded Soil Data Access response into Land', () => {
    const s = parseSsurgo(JSON.parse(fx('ssurgo_ames.json')));
    expect(s.land.awcInPerIn).toBeGreaterThan(0.05);
    expect(s.land.awcInPerIn).toBeLessThan(0.3);
    expect(s.land.ph).toBeGreaterThan(4);
    expect(s.mapUnit.length).toBeGreaterThan(0);
  });

  it('parses the documented column format and weights AWC by horizon thickness', () => {
    const s = parseSsurgo({
      Table: [
        ['mukey', 'muname', 'cokey', 'comppct_r', 'compname', 'drainagecl', 'slope_r', 'tfact', 'hzdept_r', 'hzdepb_r', 'kffact', 'kwfact', 'awc_r', 'ph1to1h2o_r', 'ec_r', 'om_r', 'sandtotal_r', 'claytotal_r'],
        ['1', 'Test loam', '9', '80', 'Test', 'Poorly drained', '4', '5', '0', '50', '.28', '.28', '0.20', '6.1', '0', '3.5', '30', '25'],
        ['1', 'Test loam', '9', '80', 'Test', 'Poorly drained', '4', '5', '50', '150', '.32', '.32', '0.14', '6.8', '0', '1', '30', '30'],
      ],
    });
    expect(s.land).toMatchObject({ slopePct: 4, drainage: 'poor', kFactor: 0.28, tFactorTonsPerAcre: 5, ph: 6.1, organicMatterPct: 3.5 });
    expect(s.land.awcInPerIn).toBeCloseTo((0.2 * 50 + 0.14 * 100) / 150);
    expect(s.gaps).toHaveLength(0);
  });

  it('throws a clear error when there is no soil data', () => {
    expect(() => parseSsurgo({ Table: [] })).toThrow(/No SSURGO soil data/);
  });
});

describe('Cropland Data Layer', () => {
  it('projects lng/lat to EPSG:5070 (checked against pyproj)', () => {
    const cases: [[number, number], [number, number]][] = [
      [[-96, 23], [0, 0]],
      [[-93.6, 42.0], [197418.0039, 2113405.3475]],
      [[-100.5, 38.0], [-391269.6394, 1672090.1675]],
      [[-120, 47], [-1814348.8166, 2898017.0135]],
    ];
    for (const [ll, xy] of cases) {
      const [x, y] = toAlbers5070(ll);
      expect(x).toBeCloseTo(xy[0], 2);
      expect(y).toBeCloseTo(xy[1], 2);
    }
  });

  it('parses GetCDLValue responses', () => {
    expect(parseCdlValue('<Result>{x: 1.0, y: 2.0, value: 1, category: "Corn", color: "#FFD400"}</Result>')).toBe('Corn');
    expect(parseCdlValue('nothing')).toBeNull();
  });

  it('parses recorded CropScape responses', () => {
    const rec = JSON.parse(fx('cdl_ames.json')) as Record<string, string>;
    for (const y of ['2021', '2022', '2023']) expect(parseCdlValue(rec[y]!)).toBe('Grass/Pasture');
  });

  it('retries CropScape 502s, then records the year as unknown instead of failing', async () => {
    let calls = 0;
    const flaky: FetchFn = async () => {
      calls++;
      return { ok: false, status: 502, json: async () => ({}), text: async () => 'Proxy Error' };
    };
    const ring: [number, number][] = [[-93.64, 42.02], [-93.63, 42.02], [-93.63, 42.03], [-93.64, 42.03]];
    const h = await fetchCdlHistory(ring, [2023], flaky);
    expect(h.history).toEqual([null]);
    expect(h.gaps[0]).toMatch(/didn't answer for 2023/);
    expect(calls).toBe(5 * 3);
  });

  it('takes the majority category per year and maps it to crop ids', async () => {
    const answers = ['Corn', 'Corn', 'Soybeans', 'Corn', 'Corn', 'Soybeans', 'Soybeans', 'Soybeans', 'Corn', 'Soybeans', 'Grassland/Pasture', 'Grassland/Pasture', 'Grassland/Pasture', 'Corn', 'Corn'];
    let i = 0;
    const fake: FetchFn = async () => {
      const cat = answers[i++]!;
      return { ok: true, status: 200, json: async () => ({}), text: async () => `{category: "${cat}"}` };
    };
    const ring: [number, number][] = [[-93.64, 42.02], [-93.63, 42.02], [-93.63, 42.03], [-93.64, 42.03]];
    expect(samplePoints(ring)).toHaveLength(5);
    const h = await fetchCdlHistory(ring, [2021, 2022, 2023], fake);
    expect(h.history).toEqual(['corn', 'soybeans', null]);
    expect(h.gaps.join()).toMatch(/Grassland\/Pasture/);
  });
});
