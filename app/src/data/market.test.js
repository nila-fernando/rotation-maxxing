import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { costLine, createMarkets, loadMarketRows, marketFor, marketPriceLine, marketSummary, priceText, standInMarket } from './market.js';
import { gapLines } from '../plan/futuresVoice.js';
import { countyUrl, parseCounty } from './countyLookup.js';
import { plannerFarm, plannerMarket, NoMarketData } from '../plan/farmInput.js';

const SALINE = { fips: '20169', stateFips: '20', countyCode: '169', name: 'Saline County', state: 'KS', stateName: 'Kansas' };
const FCC_OK = { Block: { FIPS: '201690001023034' }, County: { FIPS: '20169', name: 'Saline County' }, State: { FIPS: '20', code: 'KS', name: 'Kansas' }, status: 'OK' };

const price = (short, year, value, state = 'KANSAS') => ({ short_desc: short, unit_desc: short.split('MEASURED IN ')[1], reference_period_desc: 'MARKETING YEAR', year: String(year), Value: String(value), state_name: state });
const yld = (short, year, value, county = '') => ({
  short_desc: short, unit_desc: short.split('MEASURED IN ')[1], reference_period_desc: 'YEAR', year: String(year), Value: String(value), state_alpha: 'KS', county_name: county,
  prodn_practice_desc: /NON-IRRIGATED/.test(short) ? 'NON-IRRIGATED' : /IRRIGATED/.test(short) ? 'IRRIGATED' : 'ALL PRODUCTION PRACTICES',
});
const years = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** NASS rows for a Saline County, KS-like farm (made up, in NASS's shapes). */
function salineRows() {
  const C = 'CORN, GRAIN - YIELD, MEASURED IN BU / ACRE', CN = 'CORN, GRAIN, NON-IRRIGATED - YIELD, MEASURED IN BU / ACRE';
  const S = 'SORGHUM, GRAIN - YIELD, MEASURED IN BU / ACRE';
  const W = 'WHEAT, WINTER - YIELD, MEASURED IN BU / ACRE';
  const B = 'BARLEY - YIELD, MEASURED IN BU / ACRE';
  return {
    census: [
      { short_desc: 'CORN, GRAIN - ACRES HARVESTED', year: '2022', Value: '7,971' },
      { short_desc: 'SORGHUM, GRAIN - ACRES HARVESTED', year: '2022', Value: '22,958' },
      { short_desc: 'WHEAT, WINTER - ACRES HARVESTED', year: '2022', Value: '83,309' },
      { short_desc: 'BARLEY - ACRES HARVESTED', year: '2022', Value: '(D)' },
    ],
    censusLevel: 'county',
    countyYields: [
      ...years(2020, 2024).map((y) => yld(C, y, 120, 'SALINE')),
      ...years(2008, 2012).flatMap((y) => [yld(C, y, 100, 'SALINE'), yld(CN, y, 90, 'SALINE')]),
      ...years(2020, 2024).map((y) => yld(S, y, 80, 'SALINE')),
      ...years(2020, 2024).map((y) => yld(W, y, 45, 'SALINE')),
    ],
    stateYields: years(2018, 2024).map((y) => yld(B, y, 50)),
    usYields: [],
    statePrices: [
      price('CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU', 2025, '4.00'),
      price('SORGHUM, GRAIN - PRICE RECEIVED, MEASURED IN $ / CWT', 2025, '6.80'),
      price('WHEAT, WINTER - PRICE RECEIVED, MEASURED IN $ / BU', 2025, '5.10'),
    ],
    usPrices: [price('CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU', 2025, '4.10', 'US TOTAL')], // no barley price anywhere
  };
}

describe('the farm\'s county', () => {
  it('reads the FCC answer, and says nothing for a point outside the US', () => {
    assert.deepEqual(parseCounty(FCC_OK), SALINE);
    assert.equal(parseCounty({ County: { FIPS: null }, State: { code: null }, status: 'OK' }), null);
    assert.equal(parseCounty(null), null);
    assert.equal(countyUrl([-97.61, 38.84]), 'https://geo.fcc.gov/api/census/block/find?latitude=38.84000&longitude=-97.61000&format=json');
  });
});

describe('the farm\'s market data', () => {
  it('local crops with prices and yields, and where every number is from', () => {
    const m = marketFor({ county: SALINE, rows: salineRows(), thisYear: 2026 }, { practice: 'non-irrigated' });
    assert.equal(m.ok, true);
    assert.deepEqual(m.crops, ['corn', 'winter-wheat', 'sorghum']); // barley: grown, but no price anywhere
    assert.equal(m.prices.corn.price, 4);
    assert.equal(m.prices.corn.level, 'state');
    assert.ok(Math.abs(m.prices.sorghum.price - 6.8 * 0.56) < 1e-9);
    assert.equal(m.baseYields.corn.level, 'county');
    assert.equal(m.baseYields.corn.practice, 'non-irrigated');
    assert.ok(Math.abs(m.baseYields.corn.value - 120 * 0.9) < 1e-9);
    const text = m.gaps.join('\n');
    assert.match(text, /^Crops to choose from: those grown in Saline County, KS \(USDA 2022 Census of Agriculture and NASS county surveys\): corn, winter wheat, sorghum, plus fallow and a cereal-rye cover crop\./m);
    assert.match(text, /Barley is grown here, but USDA NASS has no price for it in Kansas or the US, so it’s left out\./);
    assert.match(text, /Prices: USDA NASS prices received, Kansas marketing year 2025 \(corn \$4\.00\/bu, winter wheat \$5\.10\/bu, sorghum \$3\.81\/bu from \$6\.80\/cwt\)/);
    assert.match(text, /Yields: USDA NASS averages, Saline County, KS 2020-2024, non-irrigated \(corn\); Saline County, KS 2020-2024, all practices \(winter wheat, sorghum\)\./);
    assert.match(text, /NASS publishes no non-irrigated yield split for winter wheat, sorghum here/);
    assert.match(text, /Costs: operating costs per planted acre aren’t local yet: USDA ERS 2026F-2027F cost-of-production forecast \(US average\) for corn, winter wheat, sorghum\./);
  });

  it('goes into the planner\'s farm and market: the local crops, base yields and state', () => {
    const m = marketFor({ county: SALINE, rows: salineRows(), thisYear: 2026 });
    const field = {
      id: 'k1', name: 'North', acres: 80, crops: { 2023: 'Winter Wheat', 2024: 'Sorghum', 2025: 'Soybeans' },
      geometry: { type: 'Polygon', coordinates: [[[-97.62, 38.84], [-97.61, 38.84], [-97.61, 38.85], [-97.62, 38.85], [-97.62, 38.84]]] },
      soil: { land: { slopePct: 1, texture: 'silt', drainage: 'good', salinityECe: 0, ph: 6.5 }, gaps: [] },
    };
    const { farm, gaps } = plannerFarm({ fields: [field], place: { lat: 38.84, label: 'Salina' }, market: m, profile: { excludedCrops: ['wheat'] } });
    assert.equal(farm.state, 'KS');
    assert.deepEqual(farm.paddocks[0].availableCrops, ['corn', 'sorghum', 'cereal-rye', 'fallow']); // wheat excluded by the farmer
    assert.equal(farm.baseYields.corn.place, 'Saline County, KS');
    assert.equal(gaps[0], m.gaps[0]);
    const market = plannerMarket(m);
    assert.equal(market.sorghum.localPrice, m.prices.sorghum.price);
    assert.equal(market.barley, undefined);
  });

  it('no market data: no plans, and a plain reason', () => {
    const field = { id: 'a', name: 'A', acres: 1, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
    assert.throws(() => plannerFarm({ fields: [field], market: { ok: false, reason: 'the county lookup (FCC Census API) did not answer' } }),
      (e) => e instanceof NoMarketData && e.code === 'no-market' && /^No price or yield data is available for this farm: the county lookup/.test(e.message));
    assert.throws(() => plannerFarm({ fields: [field] }), NoMarketData);
    assert.deepEqual(plannerMarket(null), {});
    // nothing grown on record, or nothing priced
    const rows = salineRows();
    assert.equal(marketFor({ county: SALINE, rows: { ...rows, census: [], countyYields: [] }, thisYear: 2026 }).ok, false);
    const unpriced = marketFor({ county: SALINE, rows: { ...rows, statePrices: [], usPrices: [] }, thisYear: 2026 });
    assert.equal(unpriced.ok, false);
    assert.match(unpriced.reason, /no current prices or yields/);
  });

  it('formats prices and says what costs are based on', () => {
    assert.equal(priceText(4, 'bu'), '$4.00/bu');
    assert.equal(priceText(0.2291, 'lb'), '$0.229/lb');
    assert.equal(priceText(170.4, 'ton'), '$170/ton');
    assert.match(costLine(['alfalfa', 'sunflower', 'corn']), /Iowa State University 2026 budget \(Iowa\) for alfalfa; NDSU 2026 crop budgets \(East Central North Dakota\) for sunflowers; USDA ERS/);
    assert.equal(costLine([]), null);
  });
});

/** A fake network: the FCC answer, and NASS answers by what's asked for. */
function network({ fcc = FCC_OK, nass = (url) => ({ data: [] }), status = () => 200 } = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.startsWith('https://geo.fcc.gov/')) return fcc instanceof Error ? Promise.reject(fcc) : new Response(JSON.stringify(fcc));
    const s = status(url);
    return new Response(s === 200 ? JSON.stringify(nass(url)) : '{"error":["no data"]}', { status: s });
  };
  return { calls, fetchFn };
}

describe('fetching it', () => {

  it('asks the county, then NASS through the proxy (never with a key), all at once', async () => {
    const rows = salineRows();
    const pick = (url) => {
      const q = new URL(url, 'http://x').searchParams;
      if (q.get('source_desc') === 'CENSUS') return { data: rows.census };
      if (q.get('reference_period_desc') === 'MARKETING YEAR') return { data: q.get('agg_level_desc') === 'STATE' ? rows.statePrices : rows.usPrices };
      return { data: { COUNTY: rows.countyYields, STATE: rows.stateYields, NATIONAL: rows.usYields }[q.get('agg_level_desc')] };
    };
    const { calls, fetchFn } = network({ nass: pick });
    const raw = await loadMarketRows([-97.61, 38.84], { fetchFn, base: '/nass', thisYear: 2026 });
    assert.deepEqual(raw.county, SALINE);
    const nass = calls.filter((u) => !u.startsWith('https://geo.fcc.gov/'));
    assert.equal(nass.length, 6);
    for (const u of nass) { assert.match(u, /^\/nass\/api_GET\/\?/); assert.ok(!/[?&]key=/.test(u)); }
    assert.equal(marketFor(raw).crops.length, 3);
  });

  it('NASS "no data" (HTTP 400) is an empty answer; a county with no Census rows uses the state\'s', async () => {
    const { calls, fetchFn } = network({ status: (u) => (/source_desc=CENSUS/.test(u) && /COUNTY/.test(u) ? 400 : 200) });
    const raw = await loadMarketRows([-97.61, 38.84], { fetchFn, base: '/nass', thisYear: 2026 });
    assert.equal(raw.rows.censusLevel, 'state');
    assert.equal(calls.filter((u) => /source_desc=CENSUS/.test(u)).length, 2);
  });

  it('says why when there is no data: no proxy, no county, NASS down', async () => {
    const off = await createMarkets({ base: '', fetchFn: network().fetchFn }).forFarm([-97.6, 38.8]);
    assert.equal(off.ok, false);
    assert.match(off.reason, /no connection to USDA NASS/);
    const lost = await createMarkets({ base: '/nass', fetchFn: network({ fcc: new Error('offline') }).fetchFn }).forFarm([-97.6, 38.8]);
    assert.match(lost.reason, /county lookup \(FCC Census API\) did not answer/);
    const abroad = await createMarkets({ base: '/nass', fetchFn: network({ fcc: { County: { FIPS: null }, State: {}, status: 'OK' } }).fetchFn }).forFarm([2.35, 48.85]);
    assert.match(abroad.reason, /isn’t inside a US county/);
    const down = network({ status: () => 500 });
    const r = await createMarkets({ base: '/nass', fetchFn: down.fetchFn }).forFarm([-97.6, 38.8]);
    assert.match(r.reason, /USDA NASS answered HTTP 500/);
    assert.equal(down.calls.filter((u) => u.startsWith('/nass/')).length, 6 * 3, 'a 5xx is tried 3 times');
    const noKey = await createMarkets({ base: '/nass', fetchFn: network({ status: () => 503 }).fetchFn }).forFarm([-97.6, 38.8]);
    assert.match(noKey.reason, /isn’t set up/);
    assert.equal((await createMarkets({ base: '/nass' }).forFarm(null)).ok, false);
  });

  it('keeps a county\'s answers for the session, but not a failure', async () => {
    let fail = true;
    const net = network({ status: () => (fail ? 500 : 200) });
    const markets = createMarkets({ base: '/nass', fetchFn: net.fetchFn, thisYear: () => 2026 });
    assert.equal((await markets.forFarm([-97.6, 38.8])).ok, false);
    fail = false;
    await markets.forFarm([-97.6, 38.8]);
    const n = net.calls.length;
    await markets.forFarm([-97.6, 38.8], { practice: 'irrigated' }); // another practice: worked out again, not fetched again
    assert.equal(net.calls.length, n);
  });
});

describe('when the farm’s NASS data can’t be had: the stand-in, named as one', () => {
  const gapsOnly = (gaps) => gapLines({ fields: [], gaps, notes: { byField: {}, farm: { informationGaps: [], localReview: [] } } });

  it('out of reach or not set up is "failed" (the stand-in may step in); NASS having nothing is not', async () => {
    assert.equal((await createMarkets({ base: '', fetchFn: network().fetchFn }).forFarm([-97.6, 38.8])).failed, true);
    assert.equal((await createMarkets({ base: '/nass', fetchFn: network({ status: () => 503 }).fetchFn }).forFarm([-97.6, 38.8])).failed, true);
    assert.equal((await createMarkets({ base: '/nass', fetchFn: network({ fcc: new Error('offline') }).fetchFn }).forFarm([-97.6, 38.8])).failed, true);
    const abroad = await createMarkets({ base: '/nass', fetchFn: network({ fcc: { County: { FIPS: null }, State: {}, status: 'OK' } }).fetchFn }).forFarm([2.35, 48.85]);
    assert.equal(abroad.failed, false);
  });

  it('plans with the bundled late-2025 Iowa price levels, and every line says they are stand-ins', () => {
    const m = standInMarket('USDA NASS could not be reached');
    assert.equal(m.ok, true);
    assert.equal(m.standIn, true);
    assert.equal(m.source, 'stand-in');
    assert.deepEqual(m.crops, ['corn', 'soybeans', 'oats', 'winter-wheat', 'alfalfa']);
    assert.deepEqual(m.prices.corn, { price: 4.2, unit: 'bu', year: 2025, level: 'stand-in', place: 'Iowa', source: 'stand-in' });
    assert.equal(m.prices.alfalfa.unit, 'ton');
    assert.deepEqual(m.baseYields, {}); // the planner's own US base yields (it says so itself)
    assert.equal(m.gaps[0], 'Prices: I couldn’t get this farm’s USDA NASS prices (USDA NASS could not be reached), so these are stand-ins: late-2025 Iowa cash price levels bundled with the app (corn $4.20/bu, soybeans $10.50/bu, oats $3.10/bu, winter wheat $5.30/bu, alfalfa $210/ton), not your local market.');
    assert.match(m.gaps[1], /^Crops to choose from: the demo county’s usual crops/);
    assert.match(m.gaps[2], /^Costs: /);
    const fields = [{ id: 'f', name: 'F', acres: 40, crops: { 2025: 'Corn' }, soil: { land: { texture: 'loam', drainage: 'well', slopePct: 2, organicMatterPct: 3, waterHoldingMm: 200 }, gaps: [] }, slopePct: 2, geometry: { type: 'Polygon', coordinates: [[[-93.6, 42], [-93.59, 42], [-93.59, 42.01], [-93.6, 42.01], [-93.6, 42]]] } }];
    const { farm, gaps } = plannerFarm({ market: m, fields, place: { lat: 42, lon: -93.6, detail: 'Iowa, United States' } });
    assert.ok(farm.paddocks[0]?.availableCrops.includes('soybeans'));
    assert.equal(gaps[0], m.gaps[0]);
    assert.equal(plannerMarket(m).corn.localPrice, 4.2);
  });

  it('says where the prices are from in the Money detail and to Ask Manami', () => {
    const nass = marketFor({ county: SALINE, rows: salineRows(), thisYear: 2026 });
    assert.equal(marketPriceLine(nass), 'Priced with USDA NASS prices received: Kansas, marketing year 2025 (corn $4.00/bu, winter wheat $5.10/bu, sorghum $3.81/bu).');
    // a crop on the US price is said apart from the state's
    const mixed = { ...nass, prices: { ...nass.prices, sorghum: { ...nass.prices.sorghum, level: 'national', place: 'US' } } };
    assert.equal(marketPriceLine(mixed), 'Priced with USDA NASS prices received: Kansas, marketing year 2025 (corn $4.00/bu, winter wheat $5.10/bu); US, marketing year 2025 (sorghum $3.81/bu).');
    assert.deepEqual(marketSummary(nass), {
      source: 'usda-nass', said: 'USDA NASS prices received, Kansas marketing year 2025', county: 'Saline County, KS',
      prices: [{ crop: 'corn', price: '$4.00/bu', year: 2025, where: 'Kansas' }, { crop: 'winter wheat', price: '$5.10/bu', year: 2025, where: 'Kansas' }, { crop: 'sorghum', price: '$3.81/bu', year: 2025, where: 'Kansas' }],
    });
    const stand = standInMarket('this site has no connection to USDA NASS set up');
    assert.match(marketPriceLine(stand), /^Priced with stand-ins: late-2025 Iowa cash price levels bundled with the app \(corn \$4\.20\/bu, .*\), because I couldn’t get this farm’s USDA NASS prices\.$/);
    const sum = marketSummary(stand);
    assert.equal(sum.source, 'stand-in');
    assert.equal(sum.why, 'this site has no connection to USDA NASS set up');
    assert.equal(sum.prices[0].where, 'Iowa');
    assert.equal(marketPriceLine({ ok: false }), null);
    assert.equal(marketSummary(null), null);
  });

  it('Manami says every market line in "Good to know", NASS or stand-in', () => {
    const nass = gapsOnly(marketFor({ county: SALINE, rows: salineRows(), thisYear: 2026 }).gaps);
    assert.deepEqual(nass.unmatched, []);
    assert.ok(nass.farm.includes('I picked from the crops grown in Saline County, KS, plus fallow and a rye cover crop.'), nass.farm.join(' | '));
    assert.ok(nass.farm.includes('My prices are what farmers were paid, from USDA NASS: Kansas marketing year 2025 (corn $4.00/bu, winter wheat $5.10/bu, sorghum $3.81/bu from $6.80/cwt). That’s one price everywhere, with no local basis or freight.'), nass.farm.join(' | '));
    assert.ok(nass.farm.includes('I left out barley: grown here, but USDA has no price or yield for it.'));
    assert.ok(nass.farm.includes('USDA doesn’t publish dryland yields for winter wheat, sorghum here, so I used the average over all acres.'));
    assert.ok(nass.farm.includes('My yields are USDA NASS averages for your area, so check them against your own records.'));
    const stand = gapsOnly(standInMarket('USDA NASS could not be reached (it timed out)').gaps);
    assert.deepEqual(stand.unmatched, []);
    assert.equal(stand.farm[0], 'I couldn’t get your local prices from USDA, so I used stand-in late-2025 Iowa prices (corn $4.20/bu, soybeans $10.50/bu, oats $3.10/bu, winter wheat $5.30/bu, alfalfa $210/ton). Treat the money as a rough guide.');
    assert.equal(stand.farm[1], 'I don’t have your county’s crop list, so I picked from the demo county’s usual crops.');
  });
});
