import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { booleanPointInPolygon } from '@turf/turf';
import { CDL_PROXY, cdlAvailable, fieldPoints, fillCropHistory, majority, withCdlYears } from './cdlHistory.js';

// A ~40 acre square near Ames, IA, and an L-shaped field whose centroid falls outside it.
const square = { type: 'Polygon', coordinates: [[[-93.36, 42.02], [-93.3575, 42.02], [-93.3575, 42.0218], [-93.36, 42.0218], [-93.36, 42.02]]] };
const ell = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 1], [1, 1], [1, 10], [0, 10], [0, 0]]].map((r) => r.map(([x, y]) => [-93.4 + x * 0.001, 42 + y * 0.001])) };

/** A fake CropScape: answers by year from `byYear`, counting calls; `fail` years give a 503. */
function fakeCropScape(byYear, { fail = [] } = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const year = Number(/year=(\d+)/.exec(url)[1]);
    if (fail.includes(year)) return { ok: false, status: 503, text: async () => '' };
    const cat = byYear[year];
    return { ok: true, status: 200, text: async () => `<Result>{x: 1, y: 2, value: 1, category: "${cat}", color: "#fff"}</Result>` };
  };
  return { fetchFn, calls };
}

describe('CDL crop history', () => {
  test('samples points inside the field, even when its centroid is outside', () => {
    for (const g of [square, ell]) {
      const pts = fieldPoints(g);
      assert.ok(pts.length >= 1 && pts.length <= 3);
      for (const p of pts) assert.ok(booleanPointInPolygon(p, g));
    }
  });

  test('majority vote; a tie goes to the first (most central) point', () => {
    assert.equal(majority(['Corn', 'Soybeans', 'Corn']), 'Corn');
    assert.equal(majority(['Soybeans', 'Corn']), 'Soybeans');
    assert.equal(majority([null, null]), null);
  });

  test('fetches only the missing years, and never replaces the outline\'s own years', async () => {
    const { fetchFn, calls } = fakeCropScape({ 2022: 'Soybeans', 2023: 'Soybeans', 2024: 'Corn' });
    const fields = [{ id: 'a', geometry: square, crops: { 2023: 'Corn' } }];
    const filled = await fillCropHistory(fields, { years: [2022, 2023, 2024], fetchFn, base: 'https://x' });
    assert.deepEqual(filled, { a: { 2022: 'Soybeans', 2024: 'Corn' } });
    assert.ok(calls.every((u) => !u.includes('year=2023')));
    const [merged] = withCdlYears(fields, filled);
    assert.deepEqual(merged.crops, { 2022: 'Soybeans', 2023: 'Corn', 2024: 'Corn' });
    assert.deepEqual(merged.cdlYears, [2022, 2024]);
  });

  test('skips fields whose history is complete (outline plus demo data), and fills AI fields from nothing', async () => {
    const { fetchFn, calls } = fakeCropScape({ 2024: 'Corn', 2025: 'Soybeans' });
    const fields = [
      { id: 'full', geometry: square, crops: { 2024: 'Corn' } },
      { id: 'ai', geometry: ell, crops: null },
    ];
    const filled = await fillCropHistory(fields, { years: [2024, 2025], fetchFn, base: 'https://x', known: (f) => (f.id === 'full' ? { 2025: 'Soybeans' } : {}) });
    assert.deepEqual(filled, { ai: { 2024: 'Corn', 2025: 'Soybeans' } });
    assert.ok(calls.length > 0 && calls.length <= 2 * 3);
  });

  test('a year CropScape won\'t answer stays missing (after retries)', async () => {
    const { fetchFn, calls } = fakeCropScape({ 2024: 'Corn' }, { fail: [2025] });
    const filled = await fillCropHistory([{ id: 'a', geometry: square, crops: null }], { years: [2024, 2025], fetchFn, base: 'https://x' });
    assert.deepEqual(filled, { a: { 2024: 'Corn' } });
    assert.equal(calls.filter((u) => u.includes('year=2025')).length, fieldPoints(square).length * 3);
  });

  test('with no proxy (the GitHub Pages build), nothing is asked and nothing comes back', async () => {
    const { fetchFn, calls } = fakeCropScape({ 2024: 'Corn' });
    const filled = await fillCropHistory([{ id: 'a', geometry: square, crops: null }], { years: [2024, 2025], fetchFn, base: '' });
    assert.deepEqual(filled, {});
    assert.equal(calls.length, 0);
    assert.equal(cdlAvailable(''), false);
    assert.equal(cdlAvailable('https://x'), true);
    assert.equal(CDL_PROXY, '/cropscape', 'outside Vite (no VITE_CDL_PROXY) the dev proxy is the default');
  });

  test('unchanged fields come back as the same objects', () => {
    const f = { id: 'a', geometry: square, crops: null };
    assert.equal(withCdlYears([f], {})[0], f);
  });
});
