import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// plansPanel.js touches the DOM only inside createPlansPanel; its helpers are plain functions. The
// panel itself runs on a few stand-in elements here (enough for its clicks and ensureData).
const fakeEl = () => {
  const on = {};
  const cls = new Set();
  return {
    hidden: true, innerHTML: '', textContent: '', dataset: {}, on,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, v = !cls.has(c)) => (v ? cls.add(c) : cls.delete(c), v) },
    addEventListener(type, fn) { (on[type] ||= []).push(fn); },
    setAttribute() {}, focus() {}, contains: () => false, prepend() {},
    querySelector: () => null, querySelectorAll: () => [], getClientRects: () => [],
  };
};
const els = {};
globalThis.document ??= { getElementById: (id) => (els[id] ??= fakeEl()), addEventListener() {}, activeElement: null, body: fakeEl() };
globalThis.removeEventListener ??= () => {};
const { firstSeason, money, pickNote, createPlansPanel } = await import('./plansPanel.js');

describe('plans panel helpers', () => {
  it('money', () => {
    assert.equal(money(417300), '$417k');
    assert.equal(money(999600), '$1.0M');
    assert.equal(money(1234567), '$1.2M');
    assert.equal(money(9960000), '$10M');
    assert.equal(money(-12400), '−$12k');
    assert.equal(money(-0.3), '$0');
    assert.equal(money(950), '$950');
    assert.equal(money(NaN), '–');
  });
  it("first season: next year once this year's harvest is in (from August)", () => {
    assert.equal(firstSeason(new Date(2026, 10, 15)), 2027);
    assert.equal(firstSeason(new Date(2026, 6, 31)), 2026);
    assert.equal(firstSeason(new Date(2026, 7, 1)), 2027);
  });
  it("Manami's line says what her pick earns, or what it costs", () => {
    assert.match(pickNote(25300, 71), /earns about <b>\$25k<\/b> more .* <b>71%<\/b>/);
    // a pick that earns less (a cover crop on every field, say): the cost is said, not "changes little"
    const cost = pickNote(-15200, 0);
    assert.doesNotMatch(cost, /good fit/); // (it changes things, and costs money: not a "good fit")
    assert.match(cost, /earns about <b>\$15k<\/b> less than keeping going over 3 seasons/);
    assert.doesNotMatch(cost, /changes little/);
    assert.equal(pickNote(0, 50), 'Your rotation is already a good fit. My pick changes little.');
  });
});

describe('the plans panel hands its plans to the island', () => {
  const plansData = () => ({ result: { plans: { priority: { paddocks: [{ paddockId: 'f1' }] } } } });
  const setup = () => {
    let asked = 0;
    const futures = [];
    const panel = createPlansPanel({
      planSeasons: async () => { asked++; return plansData(); },
      onFutures: (kind, opts) => futures.push([kind, opts]),
    });
    const click = (match) => {
      const target = { closest: (sel) => (sel === match ? { dataset: { show: 'maxProfit' } } : null) };
      for (const fn of els.plansBody.on.click) fn({ target });
    };
    return { panel, click, futures, asked: () => asked };
  };

  it('"Show on the island" uses the plans on show, without working them out again', async () => {
    const { panel, click, futures, asked } = setup();
    const shown = await panel.ensureData();
    assert.equal(asked(), 1);
    click('[data-show]');
    assert.deepEqual(futures, [['maxProfit', { reel: false }]]);
    assert.equal(await panel.ensureData(), shown);
    assert.equal(asked(), 1);
    // only the once: after that it asks again (the farm may have changed since)
    await panel.ensureData();
    assert.equal(asked(), 2);
  });

  it('asks again when new plans were still being worked out', async () => {
    const { panel, click, asked } = setup();
    await panel.ensureData();
    els.plansBody.classList.add('is-busy');
    click('[data-act="futures"]');
    els.plansBody.classList.remove('is-busy');
    await panel.ensureData();
    assert.equal(asked(), 2);
  });
});
