import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getFarm, getFields } from '../data/farmData.js';
import { generatePlans, checkPlacement, evaluatePlan, planFromCrops } from '../vendor/rotation-maxxing/algorithm/index.ts';
import { scenariosFromDailyWeather } from '../vendor/rotation-maxxing/algorithm/climate.ts';
import { historyFor, historyUpTo, landFor, outerRing, plannerFarm, plannerMarket, plannerPriorities, stateOf, textureBucket, usableJar } from './farmInput.js';
import { plansKey } from './planner.js';
import { analysePhoto, toRecord, verdict } from './jarTest.js';
import { paintSampleJar } from './jarSample.js';
import { fieldData } from '../../test/fieldData.mjs';
import { demoMarket } from '../../test/marketFixture.mjs';

// the app's demo fields, as the field step hands them on
const appFields = () => getFields().map((f) => ({
  id: f.id, name: f.name, acres: f.acres, geometry: f.geometry, sourceIds: [f.sourceId],
  crops: Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])), ...fieldData(f),
}));
const DEMO_PLACE = { lat: 42.0255, lon: -93.3555, label: 'Sheeeep Hollow', detail: 'Demo farm · Story County, IA', demo: true };
const ames = () => JSON.parse(readFileSync(new URL('../vendor/rotation-maxxing/fixtures/power_ames_2000_2024.daily.json', import.meta.url), 'utf8'));

describe('the planner farm from the app', () => {
  it('maps every demo field: outline, acres, soil, slope, last 3 years oldest first', () => {
    const { farm, gaps } = plannerFarm({ market: demoMarket, fields: appFields(), place: DEMO_PLACE, profile: { priorities: ['profit'], irrigatedFieldIds: [], excludedCrops: [] } });
    assert.equal(farm.state, 'IA');
    assert.equal(farm.paddocks.length, 5);
    assert.equal(farm.constraints.irrigation, 'dryland');
    const f3 = farm.paddocks.find((p) => p.id === 'f3');
    assert.equal(f3.land.slopePct, 6.8);
    assert.equal(f3.land.drainage, 'good'); // "well drained"
    assert.deepEqual(f3.history, ['soybeans', 'corn', 'soybeans']); // 2023, 2024, 2025
    assert.ok(f3.land.awcInPerIn > 0.1 && f3.land.awcInPerIn < 0.2);
    const f2 = farm.paddocks.find((p) => p.id === 'f2');
    assert.equal(f2.land.drainage, 'poor');
    assert.equal(f2.tileDrained, true); // poorly drained, but growing corn every year: tiled
    assert.equal(f3.tileDrained, undefined);
    assert.equal(f2.land.texture, 'silt'); // silty clay loam
    for (const p of farm.paddocks) {
      assert.ok(p.polygon.lngLat.length >= 3);
      assert.ok(p.availableCrops.includes('corn') && p.availableCrops.includes('fallow'));
    }
    assert.ok(gaps.some((g) => /^Crops to choose from/.test(g))); // the market's own lines come first
  });
  it('drops crops the farmer said they can\'t grow, and marks an all-irrigated farm', () => {
    const fields = appFields();
    const { farm } = plannerFarm({ market: demoMarket, fields, place: DEMO_PLACE, profile: { excludedCrops: ['wheat', 'alfalfa'], irrigatedFieldIds: fields.map((f) => f.id) } });
    assert.ok(!farm.paddocks[0].availableCrops.includes('winter-wheat'));
    assert.ok(!farm.paddocks[0].availableCrops.includes('alfalfa'));
    assert.equal(farm.constraints.irrigation, 'irrigated');
  });
  it('a field with no soil data gets no stand-in: it is left out of the plans, and says so', () => {
    const field = { id: 'field-1', name: 'Back 80', acres: 80, crops: { 2023: 'Corn' }, geometry: { type: 'Polygon', coordinates: [[[-97, 40], [-96.99, 40], [-96.99, 40.01], [-97, 40.01], [-97, 40]]] } };
    const place = { lat: 40, lon: -97, label: 'Seward County', detail: 'Nebraska, United States' };
    assert.throws(() => plannerFarm({ market: demoMarket, fields: [field], place }), /No soil data is available for this field/);
    const { farm, gaps } = plannerFarm({ market: demoMarket, fields: [...appFields(), field], place: DEMO_PLACE });
    assert.equal(farm.paddocks.length, 5);
    assert.ok(!farm.paddocks.some((p) => p.id === 'field-1'));
    assert.ok(gaps.includes('Back 80: no soil data is available (the soil survey has nothing at this spot), so this field is left out of the plans.'), gaps.join(' | '));
    // a survey but no slope from the elevation tiles or the survey: also left out
    const noSlope = { ...field, soil: { ...appFields()[0].soil, gaps: ['SSURGO reports no slope for this map unit; enter it manually.'] } };
    const r = plannerFarm({ market: demoMarket, fields: [...appFields(), noSlope], place: DEMO_PLACE });
    assert.ok(r.gaps.some((g) => /Back 80: no slope data is available/.test(g)));
  });
  it('helpers', () => {
    assert.deepEqual(outerRing({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }), [[0, 0], [1, 0], [1, 1]]);
    assert.equal(stateOf({ detail: 'Story County, IA' }), 'IA');
    assert.equal(stateOf({ label: 'Ames, Iowa' }), 'IA');
    assert.equal(landFor(null).known, false);
    // a hay or pasture year, or a missing year, breaks the run (an older crop must not look like last year's)
    assert.deepEqual(historyFor({ crops: { 2021: 'Corn', 2022: 'Grassland/Pasture', 2023: 'Soybeans' } }, null), ['soybeans']);
    assert.deepEqual(historyFor({ crops: { 2023: 'Corn', 2024: 'Other Hay/Non Alfalfa', 2025: 'Soybeans' } }, null), ['soybeans']);
    assert.deepEqual(historyFor({ crops: { 2021: 'Corn', 2022: 'Oats', 2024: 'Soybeans', 2025: 'Corn' } }, null), ['soybeans', 'corn']);
    assert.deepEqual(historyFor({ crops: { 2022: 'Oats', 2023: 'Corn', 2024: 'Soybeans', 2025: 'Corn' } }, null), ['corn', 'soybeans', 'corn']);
    assert.deepEqual(plannerPriorities({ priorities: ['soil-health', 'profit'] }), { profit: 70, soilHealth: 85, water: 40, risk: 40 });
    assert.deepEqual(plannerPriorities(null), { profit: 85, soilHealth: 40, water: 40, risk: 40 });
    const m = plannerMarket(demoMarket);
    assert.equal(m.corn.localPrice, 4.2);
    assert.equal(m['winter-wheat'].localPrice, 5.3);
    assert.equal(m.hay, undefined);
  });
});

describe('history lined up with the first planned season', () => {
  it("fills the seasons the record doesn't reach yet with the rotation continued, and says so", () => {
    // the demo record ends in 2025; planning from 2027 means 2026 is filled in
    const fields = appFields();
    const { farm, gaps } = plannerFarm({ market: demoMarket, fields, place: DEMO_PLACE, firstSeason: 2027 });
    const f4 = farm.paddocks.find((p) => p.id === 'f4'); // corn 2023, soybeans 2024, corn 2025
    assert.deepEqual(f4.history, ['soybeans', 'corn', 'soybeans']); // 2024, 2025, then 2026 continued
    const f5 = farm.paddocks.find((p) => p.id === 'f5'); // corn every year
    assert.deepEqual(f5.history, ['corn', 'corn', 'corn']);
    assert.ok(gaps.some((g) => /South 40: 2026's crop isn't on record yet/.test(g)), gaps.join(' | '));
    // planning from 2026 needs nothing filled in
    const same = plannerFarm({ market: demoMarket, fields, place: DEMO_PLACE, firstSeason: 2026 });
    assert.deepEqual(same.farm.paddocks.find((p) => p.id === 'f4').history, ['corn', 'soybeans', 'corn']);
    assert.ok(!same.gaps.some((g) => /isn't on record yet/.test(g)));
  });
  it('helpers', () => {
    assert.deepEqual(historyUpTo(['corn', 'soybeans'], 2025, 2028, 'A'), { history: ['soybeans', 'corn', 'soybeans'], filled: 2 });
    assert.deepEqual(historyUpTo([], null, 2027), { history: [], filled: 0 });
  });
});

describe('the planner on the demo farm (real NASA POWER weather for Ames, offline)', () => {
  const { farm } = plannerFarm({ market: demoMarket, fields: appFields(), place: DEMO_PLACE, profile: { priorities: ['profit', 'soil-health'] } });
  const t0 = performance.now();
  const climate = scenariosFromDailyWeather(farm, ames());
  const poolMs = performance.now() - t0;
  const t1 = performance.now();
  const result = generatePlans(farm, plannerPriorities({ priorities: ['profit', 'soil-health'] }), plannerMarket(demoMarket), climate.scenarios, { seed: 7 });
  const planMs = performance.now() - t1;

  it('builds a weather pool from the bundled 2000-2024 record', () => {
    assert.ok(climate.scenarios.length >= 20, `${climate.scenarios.length} weather years`);
  });
  it('returns three 3-year plans for every field, with explained numbers', () => {
    for (const kind of ['current', 'maxProfit', 'priority']) {
      const p = result.plans[kind];
      assert.equal(p.paddocks.length, 5, kind);
      for (const pd of p.paddocks) {
        assert.equal(pd.sequence.length, 3);
        assert.ok(pd.years[0].terms.length > 0);
      }
      assert.ok(Number.isFinite(p.expectedGM) && Number.isFinite(p.p10GM));
    }
    assert.ok(result.plans.maxProfit.expectedGM >= result.plans.current.expectedGM - 1e-6);
    // the farm makes money on its usual crops (corn isn't ruled out on its tiled fields)
    assert.ok(result.plans.current.expectedGM > 0, `current ${result.plans.current.expectedGM}`);
    for (const pd of result.plans.current.paddocks) for (const y of pd.years) if (y.cropId === 'corn') assert.ok(y.yieldPerAcre > 100, `${pd.name} corn ${y.yieldPerAcre}`);
    assert.equal(typeof result.priceOfPriorities.summary, 'string');
  });
  it('drag-and-drop checks and a farmer-built plan work on the same farm', () => {
    const plan = planFromCrops(Object.fromEntries(farm.paddocks.map((p) => [p.id, ['corn', 'corn', 'corn']])));
    const w = checkPlacement(farm, plan, 'f5', 0, 'corn', { market: plannerMarket(demoMarket) });
    assert.ok(w.some((x) => x.lens === 'repeat' || x.lens === 'pest'), JSON.stringify(w));
    const mine = evaluatePlan(farm, plan, plannerPriorities(null), plannerMarket(demoMarket), climate.scenarios, { seed: 7 });
    assert.equal(mine.kind, 'custom');
  });
  it(`is quick enough to run off the main thread (pool ${Math.round(poolMs)} ms, plans ${Math.round(planMs)} ms)`, () => {
    assert.ok(poolMs + planMs < 20000);
  });
});

describe('a jar test sets the field\u2019s soil texture, and nothing else', () => {
  // the sample jar, used on West 140 (f2): clay loam by the jar, silty clay loam on the soil map
  const sampleRecord = (fieldId = 'f2') => {
    const { img, box } = paintSampleJar({ seed: 1 });
    const { analysis } = analysePhoto(img, box, 'ok');
    const v = verdict(analysis, { isDemoFarm: true, sample: true });
    return toRecord(analysis, v.result, { fieldId, sample: true, at: '2026-11-15T20:14:00.000Z' });
  };
  const withJar = (fields, id, jar) => fields.map((f) => (f.id === id ? { ...f, jar } : f));
  const paddock = (farm, id) => farm.paddocks.find((p) => p.id === id);
  const KEPT = ['drainage', 'awcInPerIn', 'organicMatterPct', 'ph', 'slopePct', 'salinityECe'];

  it('West 140: silt by the soil survey, loam by the sample jar; drainage, water, organic matter, pH and slope unchanged', () => {
    const fields = appFields();
    const plain = plannerFarm({ market: demoMarket, fields, place: DEMO_PLACE });
    const jarred = plannerFarm({ market: demoMarket, fields: withJar(fields, 'f2', sampleRecord()), place: DEMO_PLACE });
    assert.equal(paddock(plain.farm, 'f2').land.texture, 'silt');
    assert.equal(paddock(jarred.farm, 'f2').land.texture, 'loam');
    for (const k of KEPT) assert.deepEqual(paddock(jarred.farm, 'f2').land[k], paddock(plain.farm, 'f2').land[k], k);
    assert.deepEqual(Object.keys(paddock(jarred.farm, 'f2').land).sort(), Object.keys(paddock(plain.farm, 'f2').land).sort());
    assert.equal(paddock(jarred.farm, 'f2').tileDrained, true);
    // the other fields are untouched
    for (const id of ['f1', 'f3', 'f4', 'f5']) assert.deepEqual(paddock(jarred.farm, id), paddock(plain.farm, id));
    const l = landFor(fields[1], sampleRecord());
    assert.equal(l.jar, true);
    assert.equal(l.known, true);
  });
  it('a record that isn\u2019t fit to plan with gives the survey texture back', () => {
    const good = sampleRecord();
    const bad = {
      low: { ...good, confidence: 'low' },
      short: { ...good, elapsed: 'short' },
      nan: { ...good, sandPct: NaN },
      single: { ...good, layers: good.layers.map((x) => (['clay', 'silt'].includes(x.type) ? { ...x, type: 'sand' } : x)) },
      sum103: { ...good, sandPct: good.sandPct + 3 },
      version: { ...good, v: 2 },
      noClass: { ...good, textureClass: null },
      none: null,
    };
    const west = appFields()[1];
    assert.equal(usableJar(good), true);
    for (const [name, jar] of Object.entries(bad)) {
      assert.equal(usableJar(jar), false, name);
      const l = landFor(west, jar);
      assert.equal(l.land.texture, 'silt', name);
      assert.equal(l.jar, undefined, name);
      const { farm, gaps } = plannerFarm({ market: demoMarket, fields: withJar(appFields(), 'f2', jar), place: DEMO_PLACE });
      assert.equal(paddock(farm, 'f2').land.texture, 'silt', name);
      assert.ok(!gaps.some((g) => /jar test/.test(g)), name);
    }
  });
  it('says so in the gaps, word for word', () => {
    const { gaps } = plannerFarm({ market: demoMarket, fields: withJar(appFields(), 'f2', sampleRecord()), place: DEMO_PLACE });
    assert.ok(gaps.includes('West 140: soil texture from your jar test (clay loam, a sample jar) instead of the soil survey (silty clay loam).'), gaps.join(' | '));
    const adjusted = { ...sampleRecord(), adjusted: true, confidence: 'adjusted', sample: false };
    const g2 = plannerFarm({ market: demoMarket, fields: withJar(appFields(), 'f2', adjusted), place: DEMO_PLACE }).gaps;
    assert.ok(g2.includes('West 140: soil texture from your jar test (clay loam, adjusted by you) instead of the soil survey (silty clay loam).'), g2.join(' | '));
  });
  it('a field with no soil survey: a jar test alone isn\u2019t enough to plan with (no drainage or water holding)', () => {
    const loam = {
      v: 1, fieldId: 'field-9', at: '2026-11-15T20:14:00.000Z', sample: false, elapsed: 'ok',
      textureClass: 'Loam', sandPct: 40, siltPct: 40, clayPct: 20, confidence: 'adjusted', adjusted: true,
      layers: [{ type: 'water', rgb: [200, 220, 230], share: 0.4 }, { type: 'clay', rgb: [140, 110, 85], share: 0.12 }, { type: 'silt', rgb: [170, 140, 105], share: 0.24 }, { type: 'sand', rgb: [200, 180, 130], share: 0.24 }],
      warnings: [],
    };
    const field = { id: 'field-9', name: 'Field 9', acres: 40, crops: { 2025: 'Corn' }, geometry: { type: 'Polygon', coordinates: [[[-97, 40], [-96.99, 40], [-96.99, 40.01], [-97, 40.01], [-97, 40]]] } };
    const { farm, gaps } = plannerFarm({ market: demoMarket, fields: [...appFields(), { ...field, jar: loam }], place: DEMO_PLACE });
    assert.ok(!farm.paddocks.some((p) => p.id === 'field-9'));
    assert.ok(gaps.some((g) => /^Field 9: no soil data is available/.test(g)), gaps.join(' | '));
    assert.equal(landFor({ ...field, jar: loam }).land, null);
  });
  it('the plans are worked out again after a jar test, even where the texture bucket stays the same', () => {
    const P = plannerPriorities(null), M = plannerMarket(demoMarket);
    for (const id of ['f2', 'f1']) {
      const plain = plannerFarm({ market: demoMarket, fields: appFields(), place: DEMO_PLACE });
      const jarred = plannerFarm({ market: demoMarket, fields: withJar(appFields(), id, sampleRecord(id)), place: DEMO_PLACE });
      assert.notEqual(plansKey(jarred.farm, jarred.gaps, P, M, 1), plansKey(plain.farm, plain.gaps, P, M, 1), id);
      assert.notEqual(JSON.stringify([jarred.farm, jarred.gaps, P, M, 1]), JSON.stringify([plain.farm, plain.gaps, P, M, 1]), id);
    }
    // Home place (f1): clay loam on the map and by the jar, the same bucket, so only the gaps differ
    const plain = plannerFarm({ market: demoMarket, fields: appFields(), place: DEMO_PLACE });
    const jarred = plannerFarm({ market: demoMarket, fields: withJar(appFields(), 'f1', sampleRecord('f1')), place: DEMO_PLACE });
    assert.equal(textureBucket('clay loam'), 'loam');
    assert.deepEqual(jarred.farm, plain.farm);
    assert.notDeepEqual(jarred.gaps, plain.gaps);
  });
  it('textureBucket', () => {
    assert.equal(textureBucket('Silty clay loam'), 'silt');
    assert.equal(textureBucket('loam'), 'loam');
    assert.equal(textureBucket('Sand'), 'sand');
    assert.equal(textureBucket(''), null);
    assert.equal(textureBucket(null), null);
  });
});

describe('the farm’s county (FIPS) for the crop calendar', () => {
  it('the demo farm carries Story County, 19169, onto the planner farm', async () => {
    assert.equal(getFarm().fips, '19169');
    const { farm } = plannerFarm({ market: demoMarket, fields: appFields(), place: DEMO_PLACE });
    assert.equal(farm.fips, '19169');
    assert.equal(farm.state, 'IA');
  });
  it('a place with its own FIPS keeps it; a place without one gets none', () => {
    const field = { id: 'field-1', name: 'Back 80', acres: 80, crops: { 2023: 'Corn' }, soil: appFields()[0].soil, geometry: { type: 'Polygon', coordinates: [[[-97, 40], [-96.99, 40], [-96.99, 40.01], [-97, 40.01], [-97, 40]]] } };
    assert.equal(plannerFarm({ market: demoMarket, fields: [field], place: { lat: 40, lon: -97, detail: 'Nebraska, United States', fips: '31159' } }).farm.fips, '31159');
    assert.equal('fips' in plannerFarm({ market: demoMarket, fields: [field], place: { lat: 40, lon: -97, detail: 'Nebraska, United States' } }).farm, false);
    assert.equal('fips' in plannerFarm({ market: demoMarket, fields: [field], place: { lat: 40, lon: -97, fips: 'Story' } }).farm, false);
  });
  it('the planner ignores it: the demo plans’ pinned totals are unchanged', async () => {
    const { demoData, START_YEAR } = await import('../../test/futuresDemo.mjs');
    const { compareFutures } = await import('./compareFutures.js');
    const data = demoData(['profit']);
    assert.equal(data.farm.fips, '19169');
    const { totals } = compareFutures(data, { startYear: START_YEAR });
    assert.equal(Math.round(totals.current.expectedGM), 346469);
    assert.equal(Math.round(totals.maxProfit.expectedGM), 413859);
    assert.equal(Math.round(totals.priority.expectedGM), 406649);
    assert.equal(Math.round(totals.priority.p10GM), 273704);
    assert.equal(totals.priority.endSoil100, 57);
  });
});
