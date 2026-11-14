// "See them on the farm": the plain helpers behind the island view (which crops each field shows,
// which fields grow back in, which chips show when they'd overlap), on the demo farm's real plans.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { demoData, START_YEAR } from '../../test/futuresDemo.mjs';
import { compareFutures, seasonChanges } from '../plan/compareFutures.js';

// planFutures.js touches the DOM only inside createPlanFutures; these are plain functions
globalThis.document ??= { getElementById: () => null };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { keysFor, cellsFor, changedIds, overlaps, declutter, focusHome, VIEWS } = await import('./planFutures.js');

describe('the plans on the island (demo farm)', () => {
  let cmp;
  // the demo fields' middles, west to east: West 140, South 40, Home place, North draw, East place
  const X = { f1: 1.44, f2: -4.66, f3: 1.6, f4: -0.65, f5: 4.79 };
  before(() => { cmp = compareFutures(demoData(['profit']), { startYear: START_YEAR }); });

  it('has a view for each plan and the farmer’s own', () => {
    assert.deepEqual(VIEWS, ['current', 'maxProfit', 'priority', 'mix']);
  });

  it('shows each plan’s crops, season by season', () => {
    const cur = keysFor(cmp, 'current');
    const pick = keysFor(cmp, 'priority');
    assert.equal(cur.length, 3);
    assert.deepEqual(Object.fromEntries(cur[0]), { f1: 'corn', f2: 'corn', f3: 'soybeans', f4: 'corn', f5: 'corn' });
    assert.deepEqual(Object.fromEntries(pick[0]), { f1: 'soybeans', f2: 'soybeans', f3: 'corn', f4: 'corn', f5: 'corn' });
    // the mix follows the farmer's pick per field (Manami's pick until picked)
    const mix = keysFor(cmp, 'mix', { f1: 'current' });
    assert.equal(mix[0].get('f1'), 'corn');
    assert.equal(mix[0].get('f2'), 'soybeans');
  });

  it('grows back in the fields whose crops change, west to east', () => {
    const before0 = cellsFor(cmp, 'current', 0);
    const after0 = cellsFor(cmp, 'priority', 0);
    const grown = changedIds(before0, after0, (id) => X[id]);
    assert.deepEqual(grown, ['f2', 'f1', 'f3']);
    // the same fields the outlines light as 'crop' changes
    const crop = [...seasonChanges(cmp, 'priority')[0]].filter(([, k]) => k === 'crop').map(([id]) => id).sort();
    assert.deepEqual([...grown].sort(), crop);
    // nothing grows when nothing changes, nor on the first look (nothing shown before)
    assert.deepEqual(changedIds(after0, cellsFor(cmp, 'priority', 0)), []);
    assert.deepEqual(changedIds(new Map(), after0), []);
  });

  it('tells a cover crop apart', () => {
    const soil = compareFutures(demoData(['soil-health', 'profit']), { startYear: START_YEAR });
    const cells = cellsFor(soil, 'priority', 2);
    assert.equal(cells.get('f3'), 'corn|cereal-rye');
    assert.equal(cellsFor(soil, 'current', 2).get('f3'), 'soybeans|'); // (keeping going ends on beans there)
  });
});

describe('chips that would overlap', () => {
  const box = (x, y, w = 80, h = 30) => ({ x, y, w, h });

  it('sees an overlap, with some air', () => {
    assert.ok(overlaps(box(0, 0), box(50, 10)));
    assert.ok(!overlaps(box(0, 0), box(81, 0)));
    assert.ok(overlaps(box(0, 0), box(82, 0), 4));
    assert.ok(!overlaps(box(0, 0), box(0, 40)));
  });

  it('keeps changed fields first, then the bigger difference', () => {
    const shown = declutter([
      { id: 'a', box: box(0, 0), changed: false, weight: 30000 },
      { id: 'b', box: box(40, 5), changed: true, weight: 1000 },
      { id: 'c', box: box(300, 0), changed: false, weight: 0 },
      { id: 'd', box: box(320, 10), changed: false, weight: 5000 },
    ]);
    assert.deepEqual([...shown].sort(), ['b', 'd']);
  });

  it('shows them all when none overlap', () => {
    const items = [0, 1, 2, 3, 4].map((i) => ({ id: `f${i}`, box: box(i * 100, 0), changed: false, weight: i }));
    assert.equal(declutter(items).size, 5);
    assert.equal(declutter([]).size, 0);
  });
});

describe('where focus goes back to in the dock', () => {
  const el = (shown, disabled = false) => ({ disabled, getClientRects: () => (shown ? [{}] : []) });

  it('takes the first one on screen (the title is hidden on smaller screens)', () => {
    const title = el(false), plan = el(true), more = el(true);
    assert.equal(focusHome([title, plan, more]), plan);
    const shownTitle = el(true);
    assert.equal(focusHome([shownTitle, plan]), shownTitle);
  });

  it('skips missing and greyed ones, and gives null when none is on screen', () => {
    const plan = el(true, true), more = el(true);
    assert.equal(focusHome([null, plan, more]), more);
    assert.equal(focusHome([el(false), null]), null);
  });
});
