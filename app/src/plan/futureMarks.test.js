// The outlines "See them on the farm" puts on the fields, and which one wins: on the demo farm
// (no frost: the same as before the freeze model) and on the wheat demo (a freeze in 2028 on
// Home place, West 140 and East place).
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { demoData, wheatData, START_YEAR } from '../../test/futuresDemo.mjs';
import { compareFutures, seasonChanges } from './compareFutures.js';
import { marksFor } from './futureMarks.js';

// planFutures.js's paintMarks before the frost marks, for comparing against
function oldMarks(cmp, view, season, choice, { marksBase = null, focusId = null, cardId = null } = {}) {
  const m = new Map();
  if (marksBase && marksBase !== view) for (const [id, k] of seasonChanges(cmp, view, choice, marksBase)[season]) m.set(id, k);
  if (focusId) m.set(focusId, 'focus');
  if (cardId) m.set(cardId, 'focus');
  return m;
}
const asObject = (m) => Object.fromEntries(m);

describe('the outlines on the demo farm (no frost)', () => {
  let cmp;
  before(() => { cmp = compareFutures(demoData(['profit']), { startYear: START_YEAR }); });

  it('are what they were: crop, margin and focus', () => {
    const cases = [
      ['priority', { marksBase: 'current' }],
      ['priority', { marksBase: 'current', focusId: 'f2' }],
      ['priority', { marksBase: 'current', cardId: 'f4' }],
      ['maxProfit', { marksBase: 'priority' }],
      ['current', { marksBase: null }],
      ['current', { marksBase: 'current', focusId: 'f1', cardId: 'f3' }],
      ['mix', { marksBase: 'current' }, { f1: 'current' }],
    ];
    for (const [view, o, choice] of cases) {
      for (const y of [0, 1, 2]) {
        for (const frostLens of [false, true]) {
          assert.deepEqual(asObject(marksFor(cmp, view, y, choice, { ...o, frostLens })), asObject(oldMarks(cmp, view, y, choice, o)), `${view} ${y} ${JSON.stringify(o)}`);
        }
      }
    }
    assert.deepEqual(asObject(marksFor(cmp, 'priority', 1, null, { marksBase: 'current' })), { f1: 'margin', f2: 'margin', f3: 'crop', f5: 'crop' });
    assert.equal(marksFor(cmp, 'priority', 0).size, 0, 'no base and no focus: no outlines');
  });
});

describe('the frost outlines on the wheat demo, 2028', () => {
  let cmp;
  before(() => { cmp = compareFutures(wheatData(), { startYear: START_YEAR }); });

  it('lens on: the frost fields are ice blue, even where the crop changed', () => {
    const changes = seasonChanges(cmp, 'priority')[1];
    assert.equal(changes.get('f1'), 'crop', 'wheat instead of corn');
    const m = marksFor(cmp, 'priority', 1, null, { marksBase: 'current', frostLens: true });
    for (const id of ['f1', 'f2', 'f5']) assert.equal(m.get(id), 'frost', id);
    for (const [id, k] of changes) if (!['f1', 'f2', 'f5'].includes(id)) assert.equal(m.get(id), k, id);
    // the walk's frost stop: no change outlines, just the frost
    assert.deepEqual(asObject(marksFor(cmp, 'priority', 1, null, { marksBase: null, frostLens: true })), { f1: 'frost', f2: 'frost', f5: 'frost' });
  });

  it('lens off: a change mark wins, and frost shows only where nothing changed', () => {
    const m = marksFor(cmp, 'priority', 1, null, { marksBase: 'current' });
    for (const id of ['f1', 'f2', 'f5']) assert.equal(m.get(id), 'crop', id);
    // measured against Manami's own pick, nothing changes, so the frost shows through
    assert.deepEqual(asObject(marksFor(cmp, 'priority', 1, null, { marksBase: 'priority' })), { f1: 'frost', f2: 'frost', f5: 'frost' });
    assert.deepEqual(asObject(marksFor(cmp, 'priority', 1)), { f1: 'frost', f2: 'frost', f5: 'frost' });
    // no frost in other seasons, nor on keeping going
    assert.ok(![...marksFor(cmp, 'priority', 0, null, { marksBase: 'current' }).values()].includes('frost'));
    assert.equal(marksFor(cmp, 'current', 1).size, 0);
  });

  it('the focus and card fields are gold whatever else they are', () => {
    for (const frostLens of [false, true]) {
      const m = marksFor(cmp, 'priority', 1, null, { marksBase: 'current', frostLens, focusId: 'f1', cardId: 'f5' });
      assert.equal(m.get('f1'), 'focus');
      assert.equal(m.get('f5'), 'focus');
      assert.equal(m.get('f2'), frostLens ? 'frost' : 'crop');
    }
  });

  it('follows the mix', () => {
    const m = marksFor(cmp, 'mix', 1, { f1: 'current' }, { marksBase: null, frostLens: true });
    assert.deepEqual(asObject(m), { f2: 'frost', f5: 'frost' });
  });
});
