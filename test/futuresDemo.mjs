// The demo farm's plans worked out for real, as the app does (main.js planSeasons and the planner
// worker), for the plan-views tests: src/plan/compareFutures.test.js and futuresVoice.test.js.
// Also synthetic farms of any size, cloned from the demo, for "doesn't fall over" checks, and the wheat
// demo (a spring freeze) with a Kansas-like copy of it, for the weather lines.
import { readFileSync } from 'node:fs';
import { getCounty, getFields, getFarm } from '../src/data/farmData.js';
import { CROP_BY_ID, generatePlans, evaluatePlan } from '../src/vendor/rotation-maxxing/algorithm/index.ts';
import { scenariosFromDailyWeather } from '../src/vendor/rotation-maxxing/algorithm/climate.ts';
import { cropIdsFor } from '../src/plan/cropIds.js';
import { plannerFarm, plannerMarket, plannerPriorities } from '../src/plan/farmInput.js';
import { frostWarning } from '../src/plan/weatherWords.js';
import { worst } from '../src/plan/builder.js';

export const START_YEAR = 2027; // the plans made on 2026-11-15

// the ?hub=5 demo fields, as main.js testFields(5) hands them on
const appFields = () => getFields().map((f) => ({
  id: f.id, demoId: f.id, name: f.name, geometry: f.geometry, acres: f.acres, sourceIds: [f.sourceId],
  crops: Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])), source: 'usda',
}));
const ames = () => JSON.parse(readFileSync(new URL('../src/vendor/rotation-maxxing/fixtures/power_ames_2000_2024.daily.json', import.meta.url), 'utf8'));

const cache = new Map();

/**
 * The plans panel's data for the demo farm with these priorities: { result, weather, gaps, farm, priorities, market }.
 * excludedCrops are the check-in's "crops I can't grow" answers (its keys, e.g. 'soybeans').
 */
export function demoData(priorities = ['profit'], { excludedCrops = [] } = {}) {
  const key = JSON.stringify([priorities, excludedCrops]);
  if (cache.has(key)) return cache.get(key);
  const fm = getFarm();
  const place = { id: 'demo', kind: 'farm', label: fm.name, detail: `Demo farm · ${fm.county} County, ${fm.state}`, lat: fm.center[1], lon: fm.center[0], demo: true };
  const profile = { priorities, irrigatedFieldIds: [], excludedCrops: [...excludedCrops] };
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

/**
 * The demo with Manami's pick made of keeping going plus a cereal rye cover on every field every
 * season, earning `gain` more than keeping going (negative: less) and ending `soilPts` higher.
 * The per-field numbers stay keeping going's; only the farm totals move.
 */
export function coverPickData(data, { gain = 0, soilPts = 0 } = {}) {
  const cur = data.result.plans.current;
  const sequences = Object.fromEntries(Object.entries(cur.plan.sequences).map(([id, slots]) => [id, slots.map((c) => ({ ...c, cover: 'cereal-rye' }))]));
  const soil = (cur.endSoilHealth ?? cur.soilHealth) + soilPts / 100;
  const priority = { ...cur, kind: 'priority', plan: { sequences }, expectedGM: cur.expectedGM + gain, endSoilHealth: soil, probBeatsCurrent: 0 };
  return { ...data, result: { ...data.result, plans: { ...data.result.plans, priority } } };
}

/**
 * The demo farm for a farmer who can't grow soybeans, profit first: Manami's pick sows winter wheat
 * for the 2028 harvest on Home place, West 140 and East place, so the planner's spring freeze shows
 * (13 of 24 years at Ames, at tillering, about 5% of the crop).
 */
export const wheatData = () => demoData(['profit'], { excludedCrops: ['soybeans'] });

/**
 * A copy of a wheat comparison (compareFutures on wheatData) made to look like a dry Kansas farm,
 * for the lines the Iowa demo never says: water is the weather worry, the state is KS, and only
 * Home place (f1) has a freeze: 2 of 4 years, at jointing, taking 10.6% of the crop (a Careful).
 * `cmp` itself is left as it is.
 */
export function kansasLike(cmp) {
  const c = structuredClone(cmp);
  c.weatherRisk = { ...(c.weatherRisk || {}), waterLimited: true, aridityClass: 'semi-arid' };
  c.facts = { ...(c.facts || {}), state: 'KS' };
  const label = 'Freeze risk: in 2 of 4 years, temperatures fell below the jointing threshold (K-State C646); average effect';
  const p = 0.106; // pct = −bu / (yield − bu): the yield already has the cut taken off
  for (const f of c.fields) {
    for (const e of Object.values(f.byKind)) {
      for (const s of e.seasons) {
        if (!s.freeze) continue;
        if (f.id === 'f1') {
          const bu = (-p * s.yield) / (1 - p);
          const price = s.freeze.cashAc / s.freeze.bu;
          s.freeze = { years: 2, of: 4, stage: 'jointing', bu, pct: p * 100, cashAc: bu * price, label };
        } else s.freeze = null;
        const fw = frostWarning(s.freeze);
        s.warnings = [...s.warnings.filter((w) => w.lens !== 'frost'), ...(fw ? [fw] : [])];
        s.worst = worst(s.warnings);
      }
    }
  }
  for (const r of Object.values(c.raw)) {
    r.risks = r.risks.map((x) => (/^Freeze risk: /.test(x) ? 'Freeze risk: in 2 of 4 years, temperatures fell below the jointing threshold (K-State C646).' : x));
  }
  return c;
}
