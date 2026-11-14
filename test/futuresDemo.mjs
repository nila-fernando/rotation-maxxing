// The demo farm's plans worked out for real, as the app does (main.js planSeasons and the planner
// worker), for the plan-views tests: src/plan/compareFutures.test.js and futuresVoice.test.js.
// Also synthetic farms of any size, cloned from the demo, for "doesn't fall over" checks.
import { readFileSync } from 'node:fs';
import { getCounty, getFields, getFarm } from '../src/data/farmData.js';
import { CROP_BY_ID, generatePlans, evaluatePlan } from '../src/vendor/rotation-maxxing/algorithm/index.ts';
import { scenariosFromDailyWeather } from '../src/vendor/rotation-maxxing/algorithm/climate.ts';
import { cropIdsFor } from '../src/plan/cropIds.js';
import { plannerFarm, plannerMarket, plannerPriorities } from '../src/plan/farmInput.js';

export const START_YEAR = 2027; // the plans made on 2026-11-15

// the ?hub=5 demo fields, as main.js testFields(5) hands them on
const appFields = () => getFields().map((f) => ({
  id: f.id, demoId: f.id, name: f.name, geometry: f.geometry, acres: f.acres, sourceIds: [f.sourceId],
  crops: Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])), source: 'usda',
}));
const ames = () => JSON.parse(readFileSync(new URL('../src/vendor/rotation-maxxing/fixtures/power_ames_2000_2024.daily.json', import.meta.url), 'utf8'));

const cache = new Map();

/** The plans panel's data for the demo farm with these priorities: { result, weather, gaps, farm, priorities, market }. */
export function demoData(priorities = ['profit']) {
  const key = priorities.join(',');
  if (cache.has(key)) return cache.get(key);
  const fm = getFarm();
  const place = { id: 'demo', kind: 'farm', label: fm.name, detail: `Demo farm · ${fm.county} County, ${fm.state}`, lat: fm.center[1], lon: fm.center[0], demo: true };
  const profile = { priorities, irrigatedFieldIds: [], excludedCrops: [] };
  const { farm, gaps } = plannerFarm({ fields: appFields(), place, profile, firstSeason: START_YEAR });
  const prio = plannerPriorities(profile);
  const market = plannerMarket(getCounty());
  const cropIds = cropIdsFor(farm);
  const climate = scenariosFromDailyWeather(farm, ames(), { crops: cropIds });
  const result = generatePlans(farm, prio, market, climate.scenarios, { seed: 1 });
  // the worker's dropOtherCropNotes
  const names = new Set(cropIds.map((id) => CROP_BY_ID[id]?.name).filter(Boolean));
  const keep = (g) => { const m = /^No local market data for (.+?);/.exec(g); return !m || names.has(m[1]); };
  for (const p of Object.values(result.plans)) p.informationGaps = p.informationGaps.filter(keep);
  const weather = { source: 'NASA POWER daily weather for Ames, Iowa (2000-2024), bundled', years: climate.scenarios.length, gaps: climate.gaps, fallback: false };
  const data = {
    result, weather, gaps: [...gaps, ...climate.gaps], farm, priorities: prio, market,
    // scores a mixed plan the way the panel's evaluateMix does
    evaluate: (plan) => evaluatePlan(farm, plan, prio, market, climate.scenarios, { seed: 1 }),
  };
  cache.set(key, data);
  return data;
}

/**
 * A farm of `n` fields made from the demo's (cycled, renamed "Home place 2" and so on, ids f1-2),
 * with every plan, gap and note renamed to match. The farm totals stay the demo's.
 */
export function clonedData(data, n) {
  const src = data.farm.paddocks;
  const pick = Array.from({ length: n }, (_, i) => ({ from: src[i % src.length], k: Math.floor(i / src.length) + 1 }));
  const idOf = (p, k) => (k === 1 && n <= src.length ? p.id : `${p.id}-${k}`);
  const nameOf = (p, k) => (k === 1 && n <= src.length ? p.name : `${p.name} ${k}`);
  const farm = {
    ...data.farm,
    paddocks: pick.map(({ from, k }, i) => ({
      ...from, id: idOf(from, k), name: nameOf(from, k),
      // nudge each copy east so no two outlines sit on top of each other
      polygon: { lngLat: from.polygon.lngLat.map(([x, y]) => [x + 0.02 * (k - 1), y]) },
      _i: i,
    })).map(({ _i, ...p }) => p),
  };
  const plans = {};
  for (const [kind, p] of Object.entries(data.result.plans)) {
    const sequences = {};
    const paddocks = pick.map(({ from, k }) => {
      const pd = p.paddocks.find((x) => x.paddockId === from.id);
      sequences[idOf(from, k)] = p.plan.sequences[from.id].map((c) => ({ ...c }));
      return { ...pd, paddockId: idOf(from, k), name: nameOf(from, k) };
    });
    plans[kind] = { ...p, plan: { sequences }, paddocks };
  }
  const gaps = [];
  for (const g of data.gaps) {
    const from = src.find((p) => g.startsWith(`${p.name}: `));
    if (!from) { gaps.push(g); continue; }
    for (const { from: f, k } of pick) if (f === from) gaps.push(g.replace(from.name, nameOf(f, k)));
  }
  return { ...data, farm, gaps, result: { ...data.result, plans } };
}
