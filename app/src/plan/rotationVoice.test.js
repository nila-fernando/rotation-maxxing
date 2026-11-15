// Manami's rotation lines on the demo farm's real plans (test/futuresDemo.mjs): the demo lines word
// for word, the voice rules on every line, and money said last and only where it belongs. Monte
// Carlo money is built with moneyAbout from cmp, so a re-vendor only re-pins compareFutures.test.js.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { demoData, clonedData, coverPickData, wheatData, START_YEAR } from '../../test/futuresDemo.mjs';
import { compareFutures, mixedPlan } from './compareFutures.js';
import { lintLine } from './futuresVoice.js';
import { moneyAbout } from '../ui/money.js';
import { rotationOf } from './rotationStory.js';
import {
  allRotationLines, cellSr, changeReason, checkRows, chipAfterWords, fieldLead, fieldMoneyLine, headline, moneyLine, patternNote,
  reasonFor, swapPair, whyNotLine,
} from './rotationVoice.js';

const k = (v) => moneyAbout(Math.abs(v));
const fieldIn = (rot, id) => rot.fields.find((f) => f.id === id);
const reasons = (rot, id) => fieldIn(rot, id).seasons.map((s, i) => reasonFor(fieldIn(rot, id), i));

describe('Manami’s rotation lines on the demo farm (profit first)', () => {
  let data, cmp, pri, cur, max;
  before(() => {
    data = demoData(['profit']);
    cmp = compareFutures(data, { startYear: START_YEAR });
    pri = rotationOf(cmp, 'priority');
    cur = rotationOf(cmp, 'current');
    max = rotationOf(cmp, 'maxProfit');
  });

  it('leads with the rotation, not the money', () => {
    const h = headline(cmp);
    assert.equal(h, 'Home place, West 140 and East place have grown corn three years running. My pick swaps corn and beans on every field, with one more corn first on North draw and East place. The beans leave nitrogen for the next corn, and the swap breaks the rootworm cycle.');
    assert.doesNotMatch(h, /\$/);
  });

  it('notes each plan’s pattern', () => {
    assert.equal(patternNote(pri), 'Corn and beans swap on every field. About half your acres are in each crop every season.');
    assert.equal(patternNote(max), 'Corn and beans swap on every field. In 2027, nearly all of your acres are in beans.');
    assert.equal(patternNote(cur), 'Corn stays every season on Home place, West 140 and East place. Corn and beans swap on 2 of 5 fields. In 2027, about three-quarters of your acres are in corn.');
    for (const rot of [pri, max, cur]) assert.doesNotMatch(patternNote(rot), /\$/);
  });

  it('gives a reason for every change of crop', () => {
    assert.deepEqual(reasons(pri, 'f1'), [
      'Beans after corn break the rootworm cycle, so you skip rootworm control.',
      'Corn after beans gets their nitrogen, about $20 an acre less to buy.',
      'Beans after corn break the rootworm cycle.',
    ]);
    assert.deepEqual(reasons(pri, 'f5'), [
      'Corn again after corn, so I expect about 10 bu an acre less. Corn on corn usually needs rootworm control.',
      'Beans after corn break the rootworm cycle, so you skip rootworm control.',
      'Corn after beans gets their nitrogen, about $20 an acre less to buy.',
    ]);
    // the context can be given by hand, as the field story does
    const f = fieldIn(pri, 'f1');
    assert.equal(changeReason(f.seasons[0], { field: f, history: f.history, prevSeason: null }), reasons(pri, 'f1')[0]);
  });

  it('starts each field story with what it has grown', () => {
    assert.equal(fieldLead(pri, cmp, 'f1'), 'Home place has grown corn three years running. I’d turn it to soybeans, then corn, then beans.');
    assert.equal(fieldLead(pri, cmp, 'f5'), 'East place has grown corn three years running. I’d grow corn once more, then soybeans, then corn.');
    assert.equal(fieldLead(pri, cmp, 'f3'), 'North draw already turns corn and beans. I’d grow corn once more, then soybeans, then corn.');
    assert.equal(fieldLead(pri, cmp, 'f4'), 'South 40 already turns corn and beans, so all three plans leave it be.');
    assert.equal(fieldLead(cur, cmp, 'f1'), 'Keeping going means corn every season here.');
  });

  it('says why not the most-profit plan only when the facts allow', () => {
    const north = whyNotLine(cmp, 'f3');
    // the spec's draft said $3k; the real plans differ by $2,279, which Manami says as $2k
    assert.equal(north, `Beans first earns about ${k(cmp.fields[2].byKind.maxProfit.total - cmp.fields[2].byKind.priority.total)} more here. My pick ends on corn instead, and the soil scores 70 that season, not 42.`);
    assert.match(north, /70/);
    assert.match(north, /42/);
    assert.equal(whyNotLine(cmp, 'f5'), 'Beans first earns about $6k more here. My pick ends on corn instead, and the soil scores 70 that season, not 42.');
    assert.equal(whyNotLine(cmp, 'f1'), null, 'the same crops on both plans');
    assert.equal(whyNotLine(cmp, 'f4'), null);
  });

  it('says nothing when no fact holds (same soil, same balance, same bad year)', () => {
    const c = structuredClone(cmp);
    // the pick and the most-profit plan level everywhere but the crops on North draw
    c.totals.priority = { ...c.totals.maxProfit };
    for (const f of c.fields) {
      f.byKind.priority = structuredClone(f.byKind.maxProfit);
      f.byKind.priority.kind = 'priority';
    }
    const f3 = c.fields.find((f) => f.id === 'f3');
    const swap = { corn: 'soybeans', soybeans: 'corn' };
    f3.byKind.priority.seasons = f3.byKind.priority.seasons.map((s) => ({ ...s, crop: swap[s.crop] ?? s.crop }));
    f3.byKind.priority.total -= 1000;
    // the balance: give the most-profit plan an even split, as the pick has
    for (const id of ['f1', 'f2']) {
      const f = c.fields.find((x) => x.id === id);
      for (const kind of ['maxProfit', 'priority']) f.byKind[kind].seasons = f.byKind[kind].seasons.map((s) => ({ ...s, crop: swap[s.crop] }));
    }
    assert.equal(whyNotLine(c, 'f3'), null);
  });

  it('puts the money last, in its own lines', () => {
    assert.equal(fieldMoneyLine(pri, 'f1'), 'Over 3 seasons it earns about $89k here, about $20k more than keeping going.');
    assert.equal(fieldMoneyLine(pri, 'f4'), 'Over 3 seasons it earns about $27k here, about the same as keeping going.');
    assert.equal(fieldMoneyLine(pri, 'f3'), 'Over 3 seasons it earns about $92k here, about $2k less than keeping going.');
    assert.equal(fieldMoneyLine(cur, 'f1'), 'Over 3 seasons it earns about $69k here.');
    const t = cmp.totals;
    assert.equal(moneyLine(cmp, 'priority'), `About ${moneyAbout(t.priority.expectedGM)} over 3 seasons, about ${moneyAbout(t.priority.expectedGM - t.current.expectedGM)} more than keeping going. In a bad year, 1 in 10, about ${moneyAbout(t.priority.p10GM)}.`);
    assert.equal(moneyLine(cmp, 'priority'), 'About $408k over 3 seasons, about $58k more than keeping going. In a bad year, 1 in 10, about $263k.');
    assert.equal(moneyLine(cmp, 'current'), `About ${moneyAbout(t.current.expectedGM)} over 3 seasons if you keep going. In a bad year, 1 in 10, about ${moneyAbout(t.current.p10GM)}.`);
    assert.equal(moneyLine(cmp, 'mix', null, { f1: 'current', f2: 'maxProfit' }), 'I’m still working out what your plan earns.');
  });

  it('checks the rotation in 5 rows', () => {
    const rows = checkRows(pri, cur);
    assert.deepEqual(rows.map((r) => r.key), ['repeats', 'handoffs', 'rootworm', 'cover', 'soil']);
    assert.deepEqual(rows.map((r) => [r.label, r.value, r.base, r.better]), [
      ['Same crop again', '2 seasons', 'keeping going: 9', true],
      ['Corn after beans', '6 seasons, about 35 lb of free nitrogen an acre each time', 'keeping going: 3', true],
      ['Rootworm control needed', '2 seasons', 'keeping going: 9', true],
      ['Winter cover', 'none. The ground sits bare about 5 months each winter.', 'keeping going: none', null],
      ['Soil score in 2029', '57/100', 'keeping going: 45', true],
    ]);
    // keeping going on show: the comparison is my pick
    assert.deepEqual(checkRows(cur, pri).map((r) => r.base), ['my pick: 2', 'my pick: 6', 'my pick: 2', 'my pick: none', 'my pick: 57']);
    assert.equal(checkRows(cur, pri)[0].value, '9 seasons');
    assert.equal(checkRows(cur, pri)[0].better, false);
  });

  it('says a chip’s link, and a ribbon cell to a screen reader', () => {
    const f1 = fieldIn(pri, 'f1'), f5 = fieldIn(pri, 'f5');
    assert.equal(chipAfterWords(f1.seasons[1].link), 'after beans');
    assert.equal(chipAfterWords(f5.seasons[0].link), 'corn again');
    assert.equal(chipAfterWords({ kind: null, prev: null }), '');
    assert.equal(cellSr(f1, f1.seasons[1]), 'Home place, 2028: Corn, after soybeans. Corn after beans gets their nitrogen, about $20 an acre less to buy.');
    assert.equal(cellSr(f5, f5.seasons[0]), 'East place, 2027: Corn, again after corn. Corn again after corn, so I expect about 10 bu an acre less. Corn on corn usually needs rootworm control.');
  });

  it('says a plural crop with a plural verb', () => {
    const fld = (id, crops) => ({ id, name: id, index: 0, seasons: crops.map((crop) => ({ crop })) });
    const rot = { view: 'priority', fields: [fld('A', ['soybeans', 'soybeans', 'soybeans']), fld('B', ['soybeans', 'soybeans', 'soybeans'])], split: [] };
    assert.equal(patternNote(rot), 'Soybeans stay every season on every field.');
    const dry = { crop: 'dry-beans', warnings: [], link: { kind: 'same-family', prev: 'soybeans' } };
    assert.equal(changeReason(dry, { history: ['soybeans'] }), 'Dry beans follow soybeans, another legume.');
    const rye = { crop: 'corn', cover: 'cereal-rye', warnings: [], link: { kind: 'nitrogen', prev: 'soybeans', nUsd: 20.3 } };
    assert.match(changeReason(rye, {}), /Cereal rye after harvest keeps the ground covered over winter\.$/);
  });

  it('knows a swap', () => {
    assert.deepEqual(swapPair([{ crop: 'soybeans' }, { crop: 'corn' }, { crop: 'soybeans' }]), ['corn', 'soybeans']);
    assert.equal(swapPair([{ crop: 'corn' }, { crop: 'corn' }, { crop: 'soybeans' }]), null);
  });

  it('every line passes the voice rules, on every plan and a mix', () => {
    const choice = { f1: 'current', f3: 'maxProfit' };
    const mixScore = data.evaluate(mixedPlan(data.result.plans, choice));
    for (const lines of [allRotationLines(cmp), allRotationLines(cmp, { choice, mixScore }), allRotationLines(cmp, { choice })]) {
      assert.ok(lines.length > 50);
      for (const line of lines) assert.deepEqual(lintLine(line), [], line);
    }
  });
});

describe('Manami’s rotation lines on other farms', () => {
  const lint = (cmp) => { for (const line of allRotationLines(cmp)) assert.deepEqual(lintLine(line), [], line); };

  it('soil first: rye in 2029 on every field', () => {
    const cmp = compareFutures(demoData(['soil-health', 'profit']), { startYear: START_YEAR });
    lint(cmp);
    const pri = rotationOf(cmp, 'priority');
    assert.equal(checkRows(pri, rotationOf(cmp, 'current'))[3].value, '5 seasons of rye');
    assert.equal(checkRows(rotationOf(cmp, 'current'), pri)[3].base, 'my pick: 5', 'a count, like the other rows');
    // the same crops, only the pick's rye: the farm's balance is no reason on this field
    assert.equal(whyNotLine(cmp, 'f1'), null);
    // the same last crop: the line names the rye it ends with
    assert.equal(whyNotLine(cmp, 'f4'), `The most-profit plan earns about ${k(cmp.fields[3].byKind.maxProfit.total - cmp.fields[3].byKind.priority.total)} more here. My pick ends on corn with a rye cover instead, and the soil scores 76 that season, not 70.`);
    const f3 = fieldIn(pri, 'f3');
    assert.equal(reasonFor(f3, 2), 'Corn after beans gets their nitrogen, about $20 an acre less to buy. Cereal rye after harvest keeps the ground covered over winter.');
    assert.doesNotMatch(headline(cmp), /\$/);
  });

  it('a good fit says so in one breath', () => {
    const cmp = compareFutures(coverPickData(demoData(['profit']), { gain: -500 }), { startYear: START_YEAR });
    assert.equal(headline(cmp), 'Your rotation is already a good swap. My pick changes little.');
    lint(cmp);
  });

  it('a pick that only adds covers', () => {
    const cmp = compareFutures(coverPickData(demoData(['profit']), { gain: -15000, soilPts: 6 }), { startYear: START_YEAR });
    assert.equal(headline(cmp), 'Home place, West 140 and East place have grown corn three years running. My pick keeps your crops and adds a rye cover on every field. Cereal rye keeps the ground covered over winter.');
    assert.equal(fieldLead(rotationOf(cmp, 'priority'), cmp, 'f1'), 'Home place has grown corn three years running. My pick grows corn every season here, with a rye cover each winter.');
    lint(cmp);
  });

  it('wheat in the run, and farms of 1 and 15 fields', () => {
    const cmp = compareFutures(wheatData(), { startYear: START_YEAR });
    lint(cmp);
    const pri = rotationOf(cmp, 'priority'), max = rotationOf(cmp, 'maxProfit');
    // a run of one crop is said once, never "corn, then corn, then corn"
    assert.equal(fieldLead(pri, cmp, 'f4'), 'South 40 already turns corn and beans. I’d grow corn every season.');
    assert.equal(fieldLead(pri, cmp, 'f3'), 'North draw already turns corn and beans. My pick grows corn every season here.');
    assert.equal(fieldLead(max, cmp, 'f1'), 'Home place has grown corn three years running. The most-profit plan grows corn every season here.');
    // both plans end on corn: what differs is the wheat before it
    assert.equal(whyNotLine(cmp, 'f1'), `The most-profit plan earns about ${k(cmp.fields[0].byKind.maxProfit.total - cmp.fields[0].byKind.priority.total)} more here. My pick ends on corn after wheat instead, and the soil scores 58 that season, not 44.`);
    for (const n of [1, 15]) lint(compareFutures(clonedData(demoData(['profit']), n), { startYear: START_YEAR }));
  });
});
