import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCropEdits, restoreCrops, CROP_CHOICES, latestCropName } from './cropEdits.js';
import { cropKeyFor, CROP_KEYS } from '../island/crops.js';
import { buildFieldReport } from '../data/fieldReport.js';
import { historyRunFor } from '../plan/farmInput.js';
import { historyEdits } from '../screens/fieldPanel.js';
import { fieldDetail } from '../ai/context.js';

const field = () => ({ id: 'f1', name: 'West 140', crops: { 2022: 'Corn', 2023: 'Corn', 2024: 'Soybeans', 2025: 'Corn' } });

test('every crop is offered once, the usual ones first, fallow and other last', () => {
  const keys = CROP_CHOICES.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual([...keys].sort(), [...CROP_KEYS].sort());
  assert.deepEqual(keys.slice(0, 2), ['corn', 'soybeans']);
  assert.deepEqual(keys.slice(-2), ['fallow', 'other']);
});

test('a crop name kept in field.crops reads back as the same crop', () => {
  for (const { key } of CROP_CHOICES) {
    const f = applyCropEdits(field(), { 2023: key });
    assert.equal(cropKeyFor(f.crops[2023]), key, key);
  }
});

test('an edit changes the year, keeps USDA’s record and marks the year as the farmer’s', () => {
  const f = applyCropEdits(field(), { 2023: 'soybeans' });
  assert.equal(f.crops[2023], 'Soybeans');
  assert.deepEqual(f.cropsOriginal, field().crops);
  assert.deepEqual(f.cropsByFarmer, [2023]);
  // a second edit keeps the first record, not the edited one
  const g = applyCropEdits(f, { 2021: 'oats' });
  assert.deepEqual(g.cropsOriginal, field().crops);
  assert.deepEqual(g.cropsByFarmer, [2021, 2023]);
});

test('nothing changed: the same field back; changed back to USDA’s crop: no marks left', () => {
  const f = field();
  assert.equal(applyCropEdits(f, { 2023: 'corn' }), f);
  assert.equal(applyCropEdits(f, { 2023: 'not-a-crop', x: 'corn' }), f);
  const back = applyCropEdits(applyCropEdits(f, { 2023: 'soybeans' }), { 2023: 'corn' });
  assert.deepEqual(back, f);
});

test('"not sure" takes the year off the record, and the demo data does not fill it back in', () => {
  const demo = { cropHistory: [{ year: 2023, crop: 'Corn' }, { year: 2024, crop: 'Soybeans' }] };
  const f = applyCropEdits(field(), { 2024: null });
  assert.equal(f.crops[2024], undefined);
  assert.deepEqual(f.cropsCleared, [2024]);
  const r = buildFieldReport(f, { demo, cdl: false });
  const h2024 = r.history.find((h) => h.year === 2024);
  assert.equal(h2024.crop, null);
  assert.equal(h2024.byFarmer, true);
  assert.equal(r.cropsEdited, true);
  // the planner's last-3-years run stops at the gap
  assert.deepEqual(historyRunFor(f, demo).history, ['corn']);
  // and a crop put back in that year is the farmer's again
  const g = applyCropEdits(f, { 2024: 'soybeans' });
  assert.equal(g.cropsCleared, undefined);
  assert.equal(g.crops[2024], 'Soybeans');
});

test('restore puts USDA’s record back', () => {
  const f = applyCropEdits(applyCropEdits(field(), { 2023: 'soybeans' }), { 2024: null });
  assert.deepEqual(restoreCrops(f), field());
  const plain = field();
  assert.equal(restoreCrops(plain), plain);
});

test('the planner and the report use the farmer’s years', () => {
  const f = applyCropEdits(field(), { 2025: 'soybeans', 2024: 'corn' });
  assert.deepEqual(historyRunFor(f, null).history, ['corn', 'corn', 'soybeans']);
  const r = buildFieldReport(f, { cdl: false });
  assert.equal(r.history.find((h) => h.year === 2025).label, 'Soybeans');
  assert.equal(r.history.find((h) => h.year === 2022).byFarmer, false);
  assert.equal(latestCropName(f.crops), 'Soybeans');
});

test('Ask Manami is told which years came from the farmer', () => {
  const r = buildFieldReport(applyCropEdits(field(), { 2025: 'soybeans' }), { cdl: false });
  const ctx = fieldDetail(r);
  assert.equal(ctx.crop_history.find((h) => h.year === 2025).set_by_farmer, true);
  assert.equal(ctx.crop_history.find((h) => h.year === 2024).set_by_farmer, undefined);
});

test('the editor sends only the years the farmer changed', () => {
  const r = buildFieldReport(field(), { cdl: false });
  const draft = Object.fromEntries(r.history.map((h) => [h.year, h.crop == null ? '' : h.key]));
  assert.deepEqual(historyEdits(r.history, draft), {});
  draft[2025] = 'soybeans';
  draft[2024] = '';
  draft[2018] = 'oats';
  assert.deepEqual(historyEdits(r.history, draft), { 2025: 'soybeans', 2024: null, 2018: 'oats' });
});
