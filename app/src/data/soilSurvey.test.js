import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { booleanPointInPolygon } from '@turf/turf';
import { displaySoil, fillSoil, soilPoint, textureClass, withSoil } from './soilSurvey.js';
import { buildFieldReport } from './fieldReport.js';
import { landFor } from '../plan/farmInput.js';

const ames = JSON.parse(readFileSync(new URL('../vendor/rotation-maxxing/fixtures/ssurgo_ames.json', import.meta.url), 'utf8'));
const square = { type: 'Polygon', coordinates: [[[-93.36, 42.02], [-93.3575, 42.02], [-93.3575, 42.0218], [-93.36, 42.0218], [-93.36, 42.02]]] };
const ell = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 1], [1, 1], [1, 10], [0, 10], [0, 0]]].map((r) => r.map(([x, y]) => [-93.4 + x * 0.001, 42 + y * 0.001])) };

/** A fake Soil Data Access: `answer` per call ('ok' -> the Ames fixture, 'empty', or an HTTP status). */
function fakeSda(answer = 'ok') {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push(JSON.parse(init.body).query);
    if (answer === 'ok') return { ok: true, status: 200, json: async () => ames };
    if (answer === 'empty') return { ok: true, status: 200, json: async () => ({}) };
    return { ok: false, status: answer, json: async () => ({}) };
  };
  return { fetchFn, calls };
}

describe('SSURGO soil for any field', () => {
  test('USDA texture triangle', () => {
    assert.equal(textureClass(65.4, 19.6, 15), 'sandy loam');
    assert.equal(textureClass(41.1, 36.9, 22), 'loam');
    assert.equal(textureClass(10, 62, 28), 'silty clay loam');
    assert.equal(textureClass(20, 65, 15), 'silt loam');
    assert.equal(textureClass(32, 34, 34), 'clay loam');
    assert.equal(textureClass(90, 5, 5), 'sand');
    assert.equal(textureClass(20, 25, 55), 'clay');
    assert.equal(textureClass(null, 30, 20), null);
  });

  test('the panel soil from a survey answer: largest component, surface texture, water in the top 60 in', () => {
    // Hanlon: 0-99 cm and 99-152 cm, both 0.17 in/in -> 152 cm x 0.17 / 2.54 = 10.2 in
    assert.deepEqual(displaySoil(ames), { texture: 'sandy loam', drainage: 'moderately well drained', organicMatterPct: 2.5, waterHoldingIn: 10.2 });
  });

  test('the query point is inside the field, even when its centroid is not', () => {
    for (const g of [square, ell]) assert.ok(booleanPointInPolygon(soilPoint(g), g));
  });

  test('fills fields without soil, skips ones that have it, and leaves unsurveyed ground empty', async () => {
    const { fetchFn, calls } = fakeSda();
    const fields = [{ id: 'a', geometry: square }, { id: 'b', geometry: ell, soil: { display: {} } }];
    const filled = await fillSoil(fields, { fetchFn });
    assert.deepEqual(Object.keys(filled), ['a']);
    assert.equal(calls.length, 1);
    assert.equal(filled.a.component, 'Hanlon');
    assert.equal(filled.a.land.drainage, 'moderate');
    assert.deepEqual(await fillSoil([{ id: 'c', geometry: ell }], { fetchFn: fakeSda('empty').fetchFn }), {});
    assert.deepEqual(await fillSoil([{ id: 'd', geometry: ell }], { fetchFn: fakeSda(503).fetchFn }), {});
  });

  test('the report and the planner use the field\'s own survey, and nothing else', async () => {
    const { fetchFn } = fakeSda();
    const [field] = withSoil([{ id: 'a', name: 'North', acres: 40, geometry: square }], await fillSoil([{ id: 'a', geometry: square }], { fetchFn }));
    const demo = { soil: { texture: 'clay loam', drainage: 'somewhat poorly drained', organicMatterPct: 4.4, waterHoldingIn: 10.6 }, slopePct: 3 };
    const r = buildFieldReport(field, { demo });
    assert.equal(r.soil.texture, 'sandy loam'); // the survey, not the demo record
    assert.equal(r.slope, null); // no elevation slope fetched: none shown, the demo's 3% isn't used
    const { land, known } = landFor(field);
    assert.equal(known, true);
    assert.equal(land.texture, 'loam'); // the planner's bucket for 65% sand, 15% clay
    assert.equal(land.slopePct, 1); // the survey's map-unit slope, with no elevation slope
    assert.equal(landFor({ ...field, slopePct: 4.2 }).land.slopePct, 4.2); // the field's own slope wins
    assert.equal(land.ph, 6.5);
    assert.ok(land.awcInPerIn > 0.16 && land.awcInPerIn < 0.18);
    assert.equal(buildFieldReport({ id: 'x', name: 'X' }, { demo }).soil, null); // no survey: no soil
  });
});
