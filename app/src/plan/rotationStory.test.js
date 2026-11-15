// The rotation story on the demo farm's real plans (test/futuresDemo.mjs): link kinds, verdicts,
// the ribbon's field order, the acre split and the counts the rotation check shows.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { demoData, clonedData, START_YEAR } from '../../test/futuresDemo.mjs';
import { compareFutures, mixedPlan, tiles } from './compareFutures.js';
import { FAMILY, LINK_KINDS, histRun, linkLabel, linkOf, orderFields, rotationOf, rotationTiles } from './rotationStory.js';

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const fieldIn = (rot, id) => rot.fields.find((f) => f.id === id);
const links = (rot, id) => fieldIn(rot, id).seasons.map((s) => s.link.kind);

describe('the rotation story on the demo farm (profit first)', () => {
  let data, cmp;
  before(() => {
    data = demoData(['profit']);
    cmp = compareFutures(data, { startYear: START_YEAR });
  });

  it('has the spec’s constants', () => {
    assert.deepEqual(LINK_KINDS, ['repeat', 'nitrogen', 'break', 'same-family']);
    assert.equal(FAMILY.corn, 'grass');
    assert.equal(FAMILY.soybeans, 'legume');
    assert.equal(linkLabel('repeat'), 'Same crop again');
    assert.equal(linkLabel('nitrogen'), 'Beans feed the corn');
    assert.equal(linkLabel('nitrogen', { generic: true }), 'Nitrogen from the crop before');
    assert.equal(linkLabel('break'), 'Breaks a pest cycle');
    assert.equal(linkLabel('same-family'), 'Another grain');
    assert.equal(linkLabel('cover'), 'Winter cover');
  });

  it('counts each plan’s rotation', () => {
    const keys = ['repeats', 'nHandoffs', 'rootworm', 'endSoil100'];
    assert.deepEqual(pick(rotationOf(cmp, 'current').counts, keys), { repeats: 9, nHandoffs: 3, rootworm: 9, endSoil100: 45 });
    assert.deepEqual(pick(rotationOf(cmp, 'maxProfit').counts, keys), { repeats: 0, nHandoffs: 6, rootworm: 0, endSoil100: 44 });
    const pri = rotationOf(cmp, 'priority').counts;
    assert.deepEqual(pick(pri, keys), { repeats: 2, nHandoffs: 6, rootworm: 2, endSoil100: 57 });
    assert.equal(pri.nLb, 35);
    assert.equal(pri.coverSeasons, 0);
    assert.equal(Math.round(pri.bareMonthsAvg), 5);
    assert.equal(pri.scnMold, 4);
    assert.equal(pri.endSoil100, cmp.totals.priority.endSoil100);
  });

  it('links each season to the one before', () => {
    const pri = rotationOf(cmp, 'priority');
    assert.deepEqual(links(pri, 'f1'), ['break', 'nitrogen', 'break']);
    assert.deepEqual(links(pri, 'f5'), ['repeat', 'break', 'nitrogen']);
    assert.equal(links(pri, 'f3')[0], 'repeat');
    const n = fieldIn(pri, 'f1').seasons[1].link;
    assert.deepEqual(pick(n, ['kind', 'prev', 'nLb']), { kind: 'nitrogen', prev: 'soybeans', nLb: 35 });
    assert.ok(Math.abs(n.nUsd - 20.3) < 1e-9);
    const r = fieldIn(pri, 'f5').seasons[0].link;
    assert.deepEqual(pick(r, ['kind', 'prev', 'rootworm', 'scnMold']), { kind: 'repeat', prev: 'corn', rootworm: true, scnMold: false });
    assert.ok(r.dragBu > 9 && r.dragBu < 11, 'corn on corn drags about 10 bu');
    assert.deepEqual(links(rotationOf(cmp, 'current'), 'f1'), ['repeat', 'repeat', 'repeat']);
    // the beans after a host carry the cyst nematode and white mold notes
    assert.equal(fieldIn(pri, 'f1').seasons[2].link.scnMold, true);
  });

  it('a link with nothing before it, and a same-family one', () => {
    assert.equal(linkOf({ crop: 'corn', warnings: [] }, null).kind, null);
    assert.equal(linkOf({ crop: 'oats', warnings: [], diversity: 0 }, 'corn').kind, 'same-family');
    assert.equal(linkOf({ crop: 'oats', warnings: [], diversity: 1 }, 'corn').kind, 'break');
    assert.equal(linkOf({ crop: 'corn', warnings: [], nCredit: 20 }, 'soybeans').kind, 'nitrogen');
  });

  it('gives each field a verdict', () => {
    const pri = rotationOf(cmp, 'priority');
    const v = (rot, id) => fieldIn(rot, id).verdict;
    assert.equal(v(pri, 'f1').key, 'nowTurns');
    assert.equal(v(pri, 'f2').key, 'nowTurns');
    assert.equal(v(pri, 'f3').key, 'onceMore');
    assert.equal(v(pri, 'f5').key, 'onceMore');
    assert.equal(v(pri, 'f4').key, 'alreadyTurns');
    assert.deepEqual(v(rotationOf(cmp, 'current'), 'f1'), { key: 'keepsSame', words: 'Corn every season' });
    assert.equal(v(pri, 'f1').words, 'Was corn on corn, now turns');
    assert.equal(v(pri, 'f5').words, 'Corn once more, then turns');
    assert.equal(v(pri, 'f4').words, 'Already turns');
    assert.equal(histRun(['corn', 'soybeans', 'corn']), 1);
    assert.equal(histRun(['corn', 'corn', 'corn']), 3);
    assert.equal(histRun([]), 0);
  });

  it('keeps the past two seasons for the ribbon', () => {
    const f = fieldIn(rotationOf(cmp, 'priority'), 'f3');
    assert.deepEqual(rotationOf(cmp, 'priority').pastYears, [2025, 2026]);
    assert.deepEqual(rotationOf(cmp, 'priority').years, [2027, 2028, 2029]);
    assert.deepEqual(f.past, [{ year: 2025, crop: 'soybeans' }, { year: 2026, crop: 'corn' }]);
    assert.equal(f.seasons[0].year, 2027);
    assert.equal(f.slopePct, 6.8);
  });

  it('splits the acres each season', () => {
    assert.deepEqual(rotationOf(cmp, 'priority').split[0], { year: 2027, byCrop: { corn: 289, soybeans: 253 }, total: 542 });
    assert.deepEqual(rotationOf(cmp, 'maxProfit').split[0].byCrop, { soybeans: 506, corn: 36 });
  });

  it('orders the ribbon: the most repeats saved first, the unchanged field last', () => {
    assert.deepEqual(orderFields(cmp), ['f1', 'f2', 'f5', 'f3', 'f4']);
    assert.deepEqual(rotationOf(cmp, 'priority').fields.map((f) => f.id), ['f1', 'f2', 'f5', 'f3', 'f4']);
  });

  it('works out each field’s money against keeping going', () => {
    const f = fieldIn(rotationOf(cmp, 'priority'), 'f1');
    assert.equal(f.total, cmp.fields[0].byKind.priority.total);
    assert.equal(f.diffVsCurrent, cmp.fields[0].diff.priority);
    assert.equal(fieldIn(rotationOf(cmp, 'current'), 'f1').diffVsCurrent, 0);
  });

  it('the rotation tiles', () => {
    const t = rotationTiles(cmp, 'priority');
    const money = tiles(cmp, 'priority');
    assert.deepEqual(t, [
      { key: 'repeats', value: 2, base: 9 },
      { key: 'handoffs', value: 6, base: 3 },
      { key: 'soil', value: 57, diff: 12 },
      { key: 'cash', value: money[0].value, diff: money[0].diff },
    ]);
    assert.deepEqual(rotationTiles(cmp, 'current').slice(0, 2), [{ key: 'repeats', value: 9, base: 9 }, { key: 'handoffs', value: 3, base: 3 }]);
  });

  it('follows the farmer’s picks on the mix', () => {
    const choice = { f1: 'current' };
    const mix = rotationOf(cmp, 'mix', choice);
    assert.deepEqual(fieldIn(mix, 'f1').seasons.map((s) => s.crop), ['corn', 'corn', 'corn']);
    assert.equal(fieldIn(mix, 'f1').kind, 'current');
    assert.deepEqual(fieldIn(mix, 'f2').seasons.map((s) => s.crop), ['soybeans', 'corn', 'soybeans']);
    assert.equal(mix.counts.repeats, 5);
    assert.equal(mix.counts.endSoil100, null, 'a real mix with no score yet: the soil isn’t known');
    const score = data.evaluate(mixedPlan(data.result.plans, choice));
    assert.equal(rotationOf(cmp, 'mix', choice, score).counts.endSoil100, Math.round(score.endSoilHealth * 100));
    // nothing picked yet: the mix is Manami's pick
    assert.equal(rotationOf(cmp, 'mix').counts.endSoil100, 57);
    assert.deepEqual(rotationTiles(cmp, 'mix', null, choice).slice(0, 2), [{ key: 'repeats', value: 5, base: 9 }, { key: 'handoffs', value: 5, base: 3 }]);
  });
});

describe('the soil-first rotation', () => {
  it('sows rye on every field in 2029', () => {
    const cmp = compareFutures(demoData(['soil-health', 'profit']), { startYear: START_YEAR });
    const pri = rotationOf(cmp, 'priority');
    assert.equal(pri.counts.coverSeasons, 5);
    for (const f of pri.fields) {
      assert.deepEqual(f.seasons.map((s) => s.cover), [null, null, 'cereal-rye'], f.id);
    }
    assert.deepEqual(orderFields(cmp), ['f1', 'f2', 'f5', 'f4', 'f3'], 'a cover is a change: South 40 isn’t last any more');
  });
});

describe('farms of other sizes', () => {
  for (const n of [1, 15]) {
    it(`${n} field${n === 1 ? '' : 's'}`, () => {
      const cmp = compareFutures(clonedData(demoData(['profit']), n), { startYear: START_YEAR });
      for (const view of ['current', 'maxProfit', 'priority', 'mix']) {
        const rot = rotationOf(cmp, view);
        assert.equal(rot.fields.length, n);
        assert.equal(rot.split[0].total, Math.round(cmp.fields.reduce((a, f) => a + f.acres, 0)));
      }
      assert.equal(orderFields(cmp).length, n);
    });
  }
});
