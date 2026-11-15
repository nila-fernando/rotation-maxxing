import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getCounty, getFields } from '../data/farmData.js';
import { generatePlans, checkPlacement, evaluatePlan, planFromCrops } from '../vendor/rotation-maxxing/algorithm/index.ts';
import { scenariosFromDailyWeather } from '../vendor/rotation-maxxing/algorithm/climate.ts';
import { DEFAULT_LAND, historyFor, historyUpTo, landFor, outerRing, plannerFarm, plannerMarket, plannerPriorities, stateOf } from './farmInput.js';

// the app's demo fields, as the field step hands them on
const appFields = () => getFields().map((f) => ({
  id: f.id, name: f.name, acres: f.acres, geometry: f.geometry, sourceIds: [f.sourceId],
  crops: Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])),
}));
const DEMO_PLACE = { lat: 42.0255, lon: -93.3555, label: 'Sheeeep Hollow', detail: 'Demo farm · Story County, IA', demo: true };
const ames = () => JSON.parse(readFileSync(new URL('../vendor/rotation-maxxing/fixtures/power_ames_2000_2024.daily.json', import.meta.url), 'utf8'));

describe('the planner farm from the app', () => {
  it('maps every demo field: outline, acres, soil, slope, last 3 years oldest first', () => {
    const { farm, gaps } = plannerFarm({ fields: appFields(), place: DEMO_PLACE, profile: { priorities: ['profit'], irrigatedFieldIds: [], excludedCrops: [] } });
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
    assert.ok(gaps.some((g) => /Corn Belt crops/.test(g)));
  });
  it('drops crops the farmer said they can\'t grow, and marks an all-irrigated farm', () => {
    const fields = appFields();
    const { farm } = plannerFarm({ fields, place: DEMO_PLACE, profile: { excludedCrops: ['wheat', 'alfalfa'], irrigatedFieldIds: fields.map((f) => f.id) } });
    assert.ok(!farm.paddocks[0].availableCrops.includes('winter-wheat'));
    assert.ok(!farm.paddocks[0].availableCrops.includes('alfalfa'));
    assert.equal(farm.constraints.irrigation, 'irrigated');
  });
  it('a field on another farm gets the stand-in soil, and says so', () => {
    const field = { id: 'field-1', name: 'Back 80', acres: 80, crops: { 2023: 'Corn' }, geometry: { type: 'Polygon', coordinates: [[[-97, 40], [-96.99, 40], [-96.99, 40.01], [-97, 40.01], [-97, 40]]] } };
    const { farm, gaps } = plannerFarm({ fields: [field], place: { lat: 40, lon: -97, label: 'Seward County', detail: 'Nebraska, United States' } });
    assert.deepEqual(farm.paddocks[0].land, DEFAULT_LAND);
    assert.ok(scenariosFromDailyWeather(farm, ames()).scenarios.length > 0, 'stand-in soil still gets weather years');
    assert.deepEqual(farm.paddocks[0].history, ['corn']);
    assert.equal(farm.state, 'NE');
    assert.ok(gaps.some((g) => /no soil survey/.test(g)));
    assert.ok(gaps.some((g) => /only 1 of the last 3/.test(g)));
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
    const m = plannerMarket(getCounty());
    assert.equal(m.corn.localPrice, 4.2);
    assert.equal(m['winter-wheat'].localPrice, 5.3);
    assert.equal(m.hay, undefined);
  });
});

describe('history lined up with the first planned season', () => {
  it("fills the seasons the record doesn't reach yet with the rotation continued, and says so", () => {
    // the demo record ends in 2025; planning from 2027 means 2026 is filled in
    const fields = appFields();
    const { farm, gaps } = plannerFarm({ fields, place: DEMO_PLACE, firstSeason: 2027 });
    const f4 = farm.paddocks.find((p) => p.id === 'f4'); // corn 2023, soybeans 2024, corn 2025
    assert.deepEqual(f4.history, ['soybeans', 'corn', 'soybeans']); // 2024, 2025, then 2026 continued
    const f5 = farm.paddocks.find((p) => p.id === 'f5'); // corn every year
    assert.deepEqual(f5.history, ['corn', 'corn', 'corn']);
    assert.ok(gaps.some((g) => /South 40: 2026's crop isn't on record yet/.test(g)), gaps.join(' | '));
    // planning from 2026 needs nothing filled in
    const same = plannerFarm({ fields, place: DEMO_PLACE, firstSeason: 2026 });
    assert.deepEqual(same.farm.paddocks.find((p) => p.id === 'f4').history, ['corn', 'soybeans', 'corn']);
    assert.ok(!same.gaps.some((g) => /isn't on record yet/.test(g)));
  });
  it('helpers', () => {
    assert.deepEqual(historyUpTo(['corn', 'soybeans'], 2025, 2028, 'A'), { history: ['soybeans', 'corn', 'soybeans'], filled: 2 });
    assert.deepEqual(historyUpTo([], null, 2027), { history: [], filled: 0 });
  });
});

describe('the planner on the demo farm (real NASA POWER weather for Ames, offline)', () => {
  const { farm } = plannerFarm({ fields: appFields(), place: DEMO_PLACE, profile: { priorities: ['profit', 'soil-health'] } });
  const t0 = performance.now();
  const climate = scenariosFromDailyWeather(farm, ames());
  const poolMs = performance.now() - t0;
  const t1 = performance.now();
  const result = generatePlans(farm, plannerPriorities({ priorities: ['profit', 'soil-health'] }), plannerMarket(getCounty()), climate.scenarios, { seed: 7 });
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
    const w = checkPlacement(farm, plan, 'f5', 0, 'corn', { market: plannerMarket(getCounty()) });
    assert.ok(w.some((x) => x.lens === 'repeat' || x.lens === 'pest'), JSON.stringify(w));
    const mine = evaluatePlan(farm, plan, plannerPriorities(null), plannerMarket(getCounty()), climate.scenarios, { seed: 7 });
    assert.equal(mine.kind, 'custom');
  });
  it(`is quick enough to run off the main thread (pool ${Math.round(poolMs)} ms, plans ${Math.round(planMs)} ms)`, () => {
    assert.ok(poolMs + planMs < 20000);
  });
});
