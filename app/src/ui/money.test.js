// Money as it is written and spoken: the card amounts, the rounded "about" amounts, and per acre.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { money, moneyAbout, perAcre } from './money.js';
import { money as panelMoney } from '../screens/plansPanel.js';

describe('money', () => {
  it('reads as it always has', () => {
    assert.equal(money(417300), '$417k');
    assert.equal(money(999600), '$1.0M');
    assert.equal(money(-12400), '−$12k');
    assert.equal(money(950), '$950');
    assert.equal(money(NaN), '–');
  });

  it('is still the plans panel’s money', () => {
    assert.equal(panelMoney, money);
  });

  it('rounds for saying out loud', () => {
    assert.equal(moneyAbout(7210), '$7k');
    assert.equal(moneyAbout(2237), '$2k');
    assert.equal(moneyAbout(-2237), '−$2k');
    assert.equal(moneyAbout(9091), '$9k');
    assert.equal(moneyAbout(5138), '$5k');
    assert.equal(moneyAbout(24726), '$25k');
    assert.equal(moneyAbout(60180), '$60k');
    assert.equal(moneyAbout(640), '$640');
    assert.equal(moneyAbout(-644), '−$640');
    assert.equal(moneyAbout(4), '$0');
    assert.equal(moneyAbout(1234567), '$1.2M');
    assert.equal(moneyAbout(Infinity), '–');
  });

  it('never writes a spoken amount to the dollar with a thousands comma', () => {
    for (let v = -20000; v <= 20000; v += 37) assert.doesNotMatch(moneyAbout(v), /\$\d{1,3},\d{3}/, `${v}`);
    // just under $10k reads as $10k, the same as $10k itself
    assert.equal(moneyAbout(9700), '$10k');
    assert.equal(moneyAbout(950), '$1k');
  });

  it('per acre, in whole dollars', () => {
    assert.equal(perAcre(73.4), '$73');
    assert.equal(perAcre(57.5), '$58');
    assert.equal(perAcre(-12.2), '−$12');
    assert.equal(perAcre(-0.2), '$0');
    assert.equal(perAcre(NaN), '–');
  });
});
