import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// plansPanel.js touches the DOM only inside createPlansPanel; its helpers are plain functions
globalThis.document ??= { getElementById: () => null };
const { firstSeason, money } = await import('./plansPanel.js');

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
});
