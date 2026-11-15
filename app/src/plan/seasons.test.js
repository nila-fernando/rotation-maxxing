import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getFields } from '../data/farmData.js';
import { generatePlans } from '../vendor/rotation-maxxing/algorithm/index.ts';
import { scenariosFromDailyWeather } from '../vendor/rotation-maxxing/algorithm/climate.ts';
import { fieldData } from '../../test/fieldData.mjs';
import { demoMarket } from '../../test/marketFixture.mjs';
import { plannerFarm, plannerMarket, plannerPriorities } from './farmInput.js';
import { cropIdsFor } from './cropIds.js';
import { learnFrom, tuned } from './learn.js';
import {
  SEASON_EVENTS, assessmentLines, cleanReports, fieldsBefore, lastFinishedSeason, normalizeReport, plannerReports,
  seasonsDue, seasonsOpen, tunedLine, unitFor, withReportCrops, yieldOk,
} from './seasons.js';
import { draftFor, draftProblem, likelyCrop } from '../screens/seasonCheckin.js';

const appFields = () => getFields().map((f) => ({
  id: f.id, name: f.name, acres: f.acres, geometry: f.geometry, sourceIds: [f.sourceId],
  crops: Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])), ...fieldData(f),
}));
const DEMO_PLACE = { lat: 42.0255, lon: -93.3555, label: 'Sheeeep Hollow', detail: 'Demo farm', demo: true };
const ames = () => JSON.parse(readFileSync(new URL('../vendor/rotation-maxxing/fixtures/power_ames_2000_2024.daily.json', import.meta.url), 'utf8'));
const NOV_2026 = new Date(2026, 10, 15);
const PROFILE = { priorities: ['profit'], irrigatedFieldIds: [], excludedCrops: [] };

describe('which seasons can be reported', () => {
  it('is this year’s from November (the harvest is in), else last year’s', () => {
    assert.equal(lastFinishedSeason(NOV_2026), 2026);
    assert.equal(lastFinishedSeason(new Date(2026, 5, 1)), 2025);
  });
  it('asks about the seasons after the newest crop on record, up to the last finished one', () => {
    const fields = appFields(); // crops on record to 2025
    assert.deepEqual(seasonsDue(NOV_2026, fields, []), [2026]);
    assert.deepEqual(seasonsDue(new Date(2028, 10, 1), fields, []), [2026, 2027, 2028]);
    assert.deepEqual(seasonsDue(new Date(2031, 10, 1), fields, []), [2029, 2030, 2031], 'at most the last three');
  });
  it('stops asking once a season is reported, but keeps it open to change', () => {
    const fields = withReportCrops(appFields(), { season: 2026, fields: { f1: { crop: 'soybeans' } } });
    const reports = [{ season: 2026, fields: {} }];
    assert.deepEqual(seasonsDue(NOV_2026, fields, reports), []);
    assert.deepEqual(seasonsOpen(NOV_2026, fields, reports), [2026]);
  });
});

describe('a season report', () => {
  it('keeps only what makes sense: known crops and events, a yield in range, short notes', () => {
    const r = normalizeReport({ season: 2026, fields: {
      f1: { crop: 'corn', yield: '204.36', events: ['drought', 'aliens'], notes: '  a   dry July  ' },
      f2: { crop: 'not-a-crop', yield: 50 },
      f3: { crop: 'soybeans', yield: 4000 }, // a typo, not a harvest
      f4: { crop: 'hay', yield: 3 }, // no planner unit for hay: kept as the crop, no yield
    } });
    assert.deepEqual(r.fields.f1, { crop: 'corn', yield: 204.4, events: ['drought'], notes: 'a dry July' });
    assert.equal(r.fields.f2.crop, null);
    assert.equal(r.fields.f3.yield, null);
    assert.equal(r.fields.f4.crop, 'hay');
    assert.equal(r.fields.f4.yield, null);
    assert.equal(normalizeReport({ season: 'x' }), null);
  });
  it('one per season, the newest save winning, oldest season first', () => {
    const list = cleanReports([
      { season: 2026, savedAt: '2026-11-15T10:00:00Z', fields: { f1: { crop: 'corn' } } },
      { season: 2025, savedAt: '2026-11-15T09:00:00Z', fields: {} },
      { season: 2026, savedAt: '2026-11-15T11:00:00Z', fields: { f1: { crop: 'soybeans' } } },
    ]);
    assert.deepEqual(list.map((r) => r.season), [2025, 2026]);
    assert.equal(list[1].fields.f1.crop, 'soybeans');
  });
  it('yields in each crop’s own unit, with a sanity check', () => {
    assert.equal(unitFor('corn'), 'bu');
    assert.equal(unitFor('hay'), null);
    assert.ok(yieldOk(210, 'bu'));
    assert.ok(!yieldOk(0, 'bu'));
    assert.ok(!yieldOk(5000, 'bu'));
  });
  it('lists the problems in plain words', () => {
    assert.deepEqual(SEASON_EVENTS.map((e) => e.key), ['drought', 'flood', 'hail', 'pest', 'disease', 'replant', 'other']);
    for (const e of SEASON_EVENTS) assert.match(e.label, /^[A-Z][a-z ]+$/);
  });
});

describe('the planner’s reports', () => {
  it('are the consecutive seasons ending at the newest, in planner crop ids', () => {
    const reports = [
      { season: 2023, fields: { f1: { crop: 'corn', yield: 200 } } },
      { season: 2025, fields: { f1: { crop: 'wheat', yield: 70, events: ['hail'] } } },
      { season: 2026, fields: { f1: { crop: 'soybeans', yield: 58 }, f2: { crop: 'hay', yield: 3 }, f3: { crop: null } } },
    ];
    const out = plannerReports(reports);
    assert.deepEqual(out.map((r) => r.season), [2025, 2026], '2023 is cut off by the missing 2024');
    assert.deepEqual(out[0].paddocks, [{ paddockId: 'f1', cropId: 'winter-wheat', yieldPerAcre: 70, events: ['hail'] }]);
    assert.deepEqual(out[1].paddocks.map((p) => p.paddockId), ['f1'], 'hay and "not sure" are left out');
  });
  it('replay on the fields as they were: years from the first report on taken off', () => {
    const before = fieldsBefore(appFields(), 2024);
    assert.ok(before.every((f) => Object.keys(f.crops).every((y) => Number(y) < 2024)));
  });
  it('the report’s crops become the farmer’s own years in the fields’ history', () => {
    const [f1] = withReportCrops(appFields(), { season: 2026, fields: { f1: { crop: 'soybeans' } } });
    assert.equal(f1.crops[2026], 'Soybeans');
    assert.deepEqual(f1.cropsByFarmer, [2026]);
  });
});

describe('learning from a season on the demo farm (bundled Ames weather)', () => {
  // The demo fields as they stood before 2024, and a 2024 report: Home place (f1) grew corn and did
  // far better than the planner expected; West 140 (f2) had hail, so its yield isn't learned from.
  const fields = appFields();
  const SEASON = 2024;
  const report = { season: SEASON, fields: {
    f1: { crop: 'corn', yield: 260, events: [], notes: '' },
    f2: { crop: 'corn', yield: 120, events: ['hail'], notes: 'hail in July' },
  } };
  const { farm: farmBefore } = plannerFarm({ market: demoMarket, fields: fieldsBefore(fields, SEASON), place: DEMO_PLACE, profile: PROFILE, firstSeason: SEASON });
  const { farm: farmNow } = plannerFarm({ market: demoMarket, fields: withReportCrops(fields, report), place: DEMO_PLACE, profile: PROFILE, firstSeason: 2027 });
  const cropIds = cropIdsFor(farmNow);
  const pool = scenariosFromDailyWeather(farmNow, ames(), { crops: cropIds }).scenarios;
  const reports = plannerReports([report]);
  const learning = learnFrom({ farmBefore, reports }, pool, cropIds, async () => ames());

  it('compares each yield with what the planner expected for that season’s real weather', async () => {
    const learned = await learning;
    assert.deepEqual(learned.observed, [{ season: SEASON, ok: true }]);
    const [entry] = learned.log;
    const home = entry.calibration.find((c) => c.paddockId === 'f1');
    assert.ok(home.predicted > 0 && home.reported === 260 && home.used);
    assert.ok(home.factorAfter > 1, `Home place's corn factor ${home.factorAfter} goes up`);
    assert.ok(home.factorAfter < 260 / home.predicted, 'damped: one season can’t move it all the way');
    const west = entry.calibration.find((c) => c.paddockId === 'f2');
    assert.equal(west.used, false, 'a hail year isn’t learned from');
  });

  it('plans the next seasons on the tuned farm, with the season’s weather in the pool', async () => {
    const learned = await learning;
    assert.equal(learned.weathers.length, 1);
    const farm = tuned(farmNow, learned);
    assert.ok(farm.paddocks.find((p) => p.id === 'f1').yieldCalibration?.corn?.factor > 1);
    assert.equal(farm.paddocks.find((p) => p.id === 'f2').yieldCalibration?.corn?.factor ?? 1, 1);
    const result = generatePlans(farm, plannerPriorities(PROFILE), plannerMarket(demoMarket), [...pool, ...learned.weathers], { seed: 7 });
    assert.ok(result.plans.priority.plan.sequences.f1.length === 3);
  });

  it('Manami says what she took from each field, in plain words', async () => {
    const learned = await learning;
    const lines = assessmentLines(learned.log[0], { names: new Map(fields.map((f) => [f.id, f.name])), events: { f2: ['hail'] } });
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^Home place: corn came in at 260 bu, against the \d+ I expected for that weather, \d+% better\. I’ll count on about \d+% more/);
    assert.match(lines[1], /^West 140: corn came in at 120 bu.*With hail that year, I won’t read much into it\.$/);
    for (const l of lines) assert.doesNotMatch(l, /NaN|undefined|null/);
  });

  it('the plans say what they were tuned with', () => {
    assert.equal(tunedLine([{ season: 2026 }]), 'I tuned these plans with your 2026 season: what each field really yielded, against that year’s weather.');
    assert.match(tunedLine([2025, 2026]), /your 2025 to 2026 seasons/);
    assert.equal(tunedLine([]), null);
  });
});

describe('the check-in’s cards', () => {
  it('start from what’s on record for the season, or a saved report', () => {
    const fields = withReportCrops(appFields(), { season: 2026, fields: { f1: { crop: 'soybeans' } } });
    assert.equal(likelyCrop(fields[0], 2026), 'soybeans');
    assert.equal(likelyCrop(fields[1], 2026), null);
    const d = draftFor(fields, 2026, { fields: { f2: { crop: 'corn', yield: 199, events: ['pest'], notes: 'rootworm' } } });
    assert.equal(d.f1.crop, 'soybeans');
    assert.deepEqual(d.f2, { crop: 'corn', yield: 199, events: ['pest'], notes: 'rootworm' });
  });
  it('catch a yield that can’t be right before saving', () => {
    const names = new Map([['f1', 'Home place']]);
    assert.equal(draftProblem({ f1: { crop: 'corn', yield: '' } }, names), null);
    assert.match(draftProblem({ f1: { crop: 'corn', yield: '2400' } }, names), /^Home place: 2400 bu an acre doesn’t look right/);
    assert.match(draftProblem({ f1: { crop: 'hay', yield: '3' } }, names), /can’t take a yield for that crop/);
  });
});
