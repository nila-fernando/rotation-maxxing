import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NASS_PROXY, baseYieldsFrom, cropsGrown, marketQueries, nassAvailable, nassNumber, nationalYield, pickPrice, priceSeries,
  proxiedFetch, quickStatsUrl, toProxyUrl, toYieldUnit, yieldSeries,
} from './nass.js';
import { quickStatsUrl as vendorUrl, NASS_YIELD_SPECS } from '../vendor/rotation-maxxing/data/nassYields.ts';

// Quick Stats rows, as the API sends them (only the columns the code reads)
const priceRow = (short, year, value, place = 'KANSAS') => ({
  short_desc: short, unit_desc: short.split('MEASURED IN ')[1], reference_period_desc: 'MARKETING YEAR', year: String(year), Value: String(value), state_name: place,
});
const yieldRow = (short, year, value, { state = 'KS', county = '' } = {}) => {
  const practice = /NON-IRRIGATED/.test(short) ? 'NON-IRRIGATED' : /IRRIGATED/.test(short) ? 'IRRIGATED' : 'ALL PRODUCTION PRACTICES';
  return { short_desc: short, unit_desc: short.split('MEASURED IN ')[1], reference_period_desc: 'YEAR', prodn_practice_desc: practice, year: String(year), Value: String(value), state_alpha: state, county_name: county };
};
const censusRow = (short, year, value) => ({ short_desc: short, year: String(year), Value: value });

describe('the NASS proxy', () => {
  it('sends Quick Stats URLs through the proxy, without any key', () => {
    const url = 'https://quickstats.nass.usda.gov/api/api_GET/?key=SECRET123&commodity_desc=CORN&agg_level_desc=STATE&format=JSON';
    const out = toProxyUrl(url, '/nass');
    assert.equal(out, '/nass/api_GET/?commodity_desc=CORN&agg_level_desc=STATE&format=JSON');
    assert.ok(!out.includes('SECRET123') && !/key=/.test(out));
    assert.equal(toProxyUrl(url, 'https://proxy.example.workers.dev/nass'), 'https://proxy.example.workers.dev/nass/api_GET/?commodity_desc=CORN&agg_level_desc=STATE&format=JSON');
    // the vendored builder puts the key in: it is dropped too
    const v = toProxyUrl(vendorUrl('ANOTHERKEY', NASS_YIELD_SPECS.corn, '20', '169'), '/nass');
    assert.match(v, /^\/nass\/api_GET\/\?/);
    assert.ok(!v.includes('ANOTHERKEY') && !/[?&]key=/.test(v));
    assert.match(v, /county_code=169/);
    // anything else is left alone
    assert.equal(toProxyUrl('https://geo.fcc.gov/api/census/block/find?latitude=1', '/nass'), 'https://geo.fcc.gov/api/census/block/find?latitude=1');
  });

  it('a proxied fetch rewrites before asking', async () => {
    const seen = [];
    const f = proxiedFetch('/nass', async (u) => { seen.push(u); return new Response('{}'); });
    await f('https://quickstats.nass.usda.gov/api/api_GET/?key=K&year=2024');
    assert.deepEqual(seen, ['/nass/api_GET/?year=2024']);
  });

  it('is on in dev and tests, off when the build has no proxy', () => {
    assert.equal(NASS_PROXY, '/nass'); // no VITE_NASS_PROXY under node:test
    assert.equal(nassAvailable(''), false);
    assert.equal(nassAvailable('/nass'), true);
  });

  it('builds keyless queries with repeated filters', () => {
    const u = new URL(quickStatsUrl({ commodity_desc: ['CORN', 'SOYBEANS'], year__GE: 2020, county_code: null }));
    assert.deepEqual(u.searchParams.getAll('commodity_desc'), ['CORN', 'SOYBEANS']);
    assert.equal(u.searchParams.get('format'), 'JSON');
    assert.equal(u.searchParams.has('county_code'), false);
    assert.equal(u.searchParams.has('key'), false);
    const q = marketQueries({ stateFips: '20', countyCode: '169', state: 'KS' }, 2026);
    for (const url of Object.values(q)) assert.ok(!new URL(url).searchParams.has('key'));
    assert.equal(new URL(q.statePrices).searchParams.get('state_alpha'), 'KS');
    assert.equal(new URL(q.usPrices).searchParams.get('agg_level_desc'), 'NATIONAL');
    assert.equal(new URL(q.countyYields).searchParams.get('county_code'), '169');
    assert.ok(yieldSeries().includes('SORGHUM, GRAIN, NON-IRRIGATED - YIELD, MEASURED IN BU / ACRE'));
    assert.ok(priceSeries().includes('HAY, ALFALFA - PRICE RECEIVED, MEASURED IN $ / TON'));
    assert.ok(q.stateYields.length < 6000, 'fits the proxy\'s query limit');
  });

  it('reads NASS values, not its symbols', () => {
    assert.equal(nassNumber('1,234.5'), 1234.5);
    assert.equal(nassNumber(' 4.00 '), 4);
    for (const s of ['(D)', '(NA)', '(Z)', '(S)', '', null, '                 (D)']) assert.equal(nassNumber(s), null);
  });
});

describe('prices in the planner\'s units', () => {
  it('converts NASS price units to each crop\'s yield unit', () => {
    // sorghum $/cwt -> $/bu at 56 lb/bu (croptraits: 6.45 $/cwt is 3.61 $/bu)
    assert.ok(Math.abs(toYieldUnit(6.45, '$ / CWT', 'sorghum') - 3.612) < 1e-9);
    // sunflower, canola and dry beans: $/cwt -> $/lb
    assert.ok(Math.abs(toYieldUnit(22.9, '$ / CWT', 'sunflower') - 0.229) < 1e-12);
    assert.ok(Math.abs(toYieldUnit(20.5, '$ / CWT', 'canola') - 0.205) < 1e-12);
    assert.ok(Math.abs(toYieldUnit(30.2, '$ / CWT', 'dry-beans') - 0.302) < 1e-12);
    // same units pass through exactly
    assert.equal(toYieldUnit(4.0, '$ / BU', 'corn'), 4.0);
    assert.equal(toYieldUnit(0.595, '$ / LB', 'cotton'), 0.595);
    assert.equal(toYieldUnit(170, '$ / TON', 'alfalfa'), 170);
    // a bushel price for a crop with a bushel weight, the other way round
    assert.ok(Math.abs(toYieldUnit(4.2, '$ / BU', 'sorghum') - 4.2) < 1e-12);
    assert.ok(Math.abs(toYieldUnit(7.5, '$ / CWT', 'corn') - 4.2) < 1e-12); // 7.5/100*56
    assert.ok(Math.abs(toYieldUnit(10, '$ / CWT', 'oats') - 3.2) < 1e-12); // 32 lb/bu
    assert.ok(Math.abs(toYieldUnit(10, '$ / CWT', 'barley') - 4.8) < 1e-12); // 48 lb/bu
    assert.ok(Math.abs(toYieldUnit(10, '$ / CWT', 'soybeans') - 6) < 1e-12); // 60 lb/bu
    // ton <-> lb
    assert.ok(Math.abs(toYieldUnit(0.1, '$ / LB', 'alfalfa') - 200) < 1e-9);
    assert.ok(Math.abs(toYieldUnit(240, '$ / TON', 'cotton') - 0.12) < 1e-12);
    // what can't be matched is null, never a guess
    assert.equal(toYieldUnit(5, '$ / BU', 'cotton'), null); // no bushel weight
    assert.equal(toYieldUnit(5, '$ / BOX', 'corn'), null);
    assert.equal(toYieldUnit(5, '$ / BU', 'fallow'), null);
    assert.equal(toYieldUnit(NaN, '$ / BU', 'corn'), null);
  });

  const CORN = 'CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU';
  const WW = 'WHEAT, WINTER - PRICE RECEIVED, MEASURED IN $ / BU';
  const WHEAT = 'WHEAT - PRICE RECEIVED, MEASURED IN $ / BU';
  const SORG = 'SORGHUM, GRAIN - PRICE RECEIVED, MEASURED IN $ / CWT';

  it('takes the state\'s latest marketing-year price, with where and when it is from', () => {
    const st = [priceRow(CORN, 2024, 4.28), priceRow(CORN, 2025, '4.00'), { ...priceRow(CORN, 2025, 3.9), reference_period_desc: 'MONTHLY' }];
    const us = [priceRow(CORN, 2025, 4.1, 'US TOTAL')];
    const p = pickPrice('corn', st, us);
    assert.deepEqual({ price: p.price, year: p.year, level: p.level, place: p.place, unit: p.unit, nassUnit: p.nassUnit }, { price: 4, year: 2025, level: 'state', place: 'Kansas', unit: 'bu', nassUnit: '$ / BU' });
    assert.match(p.source, /USDA NASS/);
  });

  it('falls back to the US price when the state has none, or only an old one', () => {
    const us = [priceRow(SORG, 2025, 6.45, 'US TOTAL')];
    const p = pickPrice('sorghum', [], us);
    assert.equal(p.level, 'national');
    assert.equal(p.place, 'US');
    assert.ok(Math.abs(p.price - 3.612) < 1e-9);
    assert.equal(p.nassValue, 6.45);
    // a state price two years behind the US one is stale
    const stale = pickPrice('sorghum', [priceRow(SORG, 2023, 8.0)], us);
    assert.equal(stale.level, 'national');
    // one year behind is still the state's
    assert.equal(pickPrice('sorghum', [priceRow(SORG, 2024, 7.0)], us).level, 'state');
    // "(D)" is no price
    assert.equal(pickPrice('sorghum', [priceRow(SORG, 2025, '(D)')], us).level, 'national');
  });

  it('prefers the crop\'s own class, then the commodity as a whole', () => {
    const st = [priceRow(WHEAT, 2025, 5.0), priceRow(WW, 2025, 5.2)];
    assert.equal(pickPrice('winter-wheat', st, []).price, 5.2);
    assert.equal(pickPrice('winter-wheat', [priceRow(WHEAT, 2025, 5.0)], []).price, 5.0);
    // a newer all-wheat price beats an older winter-wheat one
    assert.equal(pickPrice('winter-wheat', [priceRow(WHEAT, 2025, 5.0), priceRow(WW, 2024, 5.9)], []).price, 5.0);
  });

  it('no price anywhere is null (the crop is left out, not priced with a guess)', () => {
    assert.equal(pickPrice('canola', [], []), null);
    assert.equal(pickPrice('fallow', [priceRow(CORN, 2025, 4)], []), null);
  });
});

describe('the crops grown locally', () => {
  it('reads the latest Census of Agriculture, counting withheld "(D)" acres as grown', () => {
    const census = [
      censusRow('CORN, GRAIN - ACRES HARVESTED', 2022, '7,971'),
      censusRow('CORN, GRAIN - ACRES HARVESTED', 2017, '7,267'),
      censusRow('SORGHUM, GRAIN - ACRES HARVESTED', 2022, '22,958'),
      censusRow('OATS - ACRES HARVESTED', 2022, '                 (D)'),
      censusRow('SUNFLOWER - ACRES HARVESTED', 2017, '168'), // only in the older census: not grown now
      censusRow('HAY, ALFALFA - ACRES HARVESTED', 2022, '10,303'),
      censusRow('BEANS, DRY EDIBLE, (EXCL CHICKPEAS & LIMA) - ACRES HARVESTED', 2022, '0'),
    ];
    const g = cropsGrown({ censusRows: census, yieldRows: [], thisYear: 2026 });
    assert.equal(g.censusYear, 2022);
    assert.deepEqual(g.crops, ['corn', 'sorghum', 'oats', 'alfalfa']);
    assert.equal(g.acres.corn, 7971);
    assert.equal(g.acres.oats, 'D');
  });

  it('adds a crop with a recent NASS county yield, and nothing from long ago', () => {
    const yields = [
      yieldRow('BARLEY - YIELD, MEASURED IN BU / ACRE', 2024, 60, { county: 'SALINE' }),
      yieldRow('CANOLA - YIELD, MEASURED IN LB / ACRE', 2012, 1500, { county: 'SALINE' }),
    ];
    const g = cropsGrown({ censusRows: [], yieldRows: yields, thisYear: 2026 });
    assert.deepEqual(g.crops, ['barley']);
    assert.equal(g.surveyed.barley, 2024);
    assert.equal(g.censusYear, null);
  });

  it('nothing on record is no crops (the caller says so)', () => {
    assert.deepEqual(cropsGrown({ thisYear: 2026 }).crops, []);
  });
});

describe('base yields for the farm', () => {
  const C = 'CORN, GRAIN - YIELD, MEASURED IN BU / ACRE';
  const CN = 'CORN, GRAIN, NON-IRRIGATED - YIELD, MEASURED IN BU / ACRE';
  const O = 'OATS - YIELD, MEASURED IN BU / ACRE';
  const county = (s, y, v) => yieldRow(s, y, v, { county: 'SALINE' });

  it('county first, with the non-irrigated ratio when NASS has the split', () => {
    const countyRows = [2020, 2021, 2022, 2023, 2024].map((y, i) => county(C, y, 100 + i));
    for (const y of [2010, 2011, 2012]) { countyRows.push(county(C, y, 100), county(CN, y, 80)); }
    const { baseYields, missing } = baseYieldsFrom({ countyRows, stateRows: [], usRows: [], crops: ['corn'], practice: 'non-irrigated', thisYear: 2026 });
    assert.deepEqual(missing, []);
    const b = baseYields.corn;
    assert.equal(b.level, 'county');
    assert.equal(b.place, 'Saline County, KS');
    assert.equal(b.practice, 'non-irrigated');
    assert.deepEqual([...b.years].sort(), [2020, 2021, 2022, 2023, 2024]);
    assert.ok(Math.abs(b.value - 102 * 0.8) < 1e-9);
    assert.deepEqual(b.sources, ['nassQuickStats']);
  });

  it('then the state, then the US NASS average', () => {
    const stateRows = [2021, 2022, 2023].map((y) => yieldRow(O, y, 70));
    const usRows = [2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => yieldRow(C, y, 170 + (y - 2019), { state: 'US' }));
    const { baseYields, missing } = baseYieldsFrom({ countyRows: [], stateRows, usRows, crops: ['oats', 'corn', 'barley'], practice: 'non-irrigated', thisYear: 2026 });
    assert.equal(baseYields.oats.level, 'state');
    assert.equal(baseYields.oats.practice, 'all'); // no split published
    assert.equal(baseYields.corn.level, 'national');
    assert.deepEqual([...baseYields.corn.years].sort(), [2021, 2022, 2023, 2024, 2025]);
    assert.equal(baseYields.corn.value, 174);
    assert.deepEqual(missing, ['barley']); // nothing at any level: no yield, no guess
  });

  it('a state series that stopped long ago gives way to the US one', () => {
    const S = 'SORGHUM, GRAIN - YIELD, MEASURED IN BU / ACRE';
    const stateRows = [2004, 2005, 2006, 2007, 2008].map((y) => yieldRow(S, y, 93, { state: 'CA' }));
    const usRows = [2021, 2022, 2023, 2024, 2025].map((y) => yieldRow(S, y, 70, { state: 'US' }));
    const { baseYields } = baseYieldsFrom({ stateRows, usRows, crops: ['sorghum'], practice: 'irrigated', thisYear: 2026 });
    assert.equal(baseYields.sorghum.level, 'national');
    assert.equal(baseYields.sorghum.value, 70);
    // a recent one is kept (2017-2019 for a county that stopped in 2019)
    const recent = [2017, 2018, 2019].map((y) => yieldRow(S, y, 80, { state: 'CA' }));
    assert.equal(baseYieldsFrom({ stateRows: recent, usRows, crops: ['sorghum'], practice: 'irrigated', thisYear: 2026 }).baseYields.sorghum.level, 'state');
  });

  it('a US series too short or too old is no yield', () => {
    assert.equal(nationalYield('corn', [yieldRow(C, 2024, 180, { state: 'US' }), yieldRow(C, 2025, 185, { state: 'US' })]), null);
  });
});
