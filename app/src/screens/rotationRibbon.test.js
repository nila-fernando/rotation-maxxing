import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ribbonHtml, storyHtml, checkHtml, switchHtml, wireRibbon, splitParts, nextIndex, PLAN_NAME } from './rotationRibbon.js';

// A rotation in rotationStory.rotationOf's shape (spec §3), for the demo farm on two plans. Made by
// hand so these tests don't wait on the planner (the panel's tests run the real one).
const season = (year, crop, link, extra = {}) => ({ year, crop, cover: null, key: crop, soil100: 50, cash: 30000, gmAc: 250, warnings: [], link: { kind: link, prev: null, nLb: link === 'nitrogen' ? 35 : 0, nUsd: link === 'nitrogen' ? 20.3 : 0, dragBu: 0, rootworm: false, scnMold: false }, ...extra });
const field = (id, name, acres, past, crops, links, verdict) => ({
  id, name, acres, slopePct: null,
  past: past.map((crop, i) => ({ year: 2025 + i, crop })),
  verdict,
  seasons: crops.map((c, i) => season(2027 + i, c, links[i])),
  total: 90000, diffVsCurrent: 20000,
});
const pick = {
  view: 'priority', years: [2027, 2028, 2029], pastYears: [2025, 2026],
  fields: [
    field('f1', 'Home place', 115, ['corn', 'corn'], ['soybeans', 'corn', 'soybeans'], ['break', 'nitrogen', 'break'], { key: 'nowTurns', words: 'Was corn on corn, now turns' }),
    field('f5', 'East place', 128, ['corn', 'corn'], ['corn', 'soybeans', 'corn'], ['repeat', 'break', 'nitrogen'], { key: 'onceMore', words: 'Corn once more, then turns' }),
    field('f4', 'South 40', 36, ['corn', 'soybeans'], ['corn', 'soybeans', 'corn'], ['nitrogen', 'break', 'nitrogen'], { key: 'alreadyTurns', words: 'Already turns' }),
  ],
  counts: { repeats: 1, nHandoffs: 4, nLb: 35, rootworm: 1, scnMold: 0, coverSeasons: 0, bareMonthsAvg: 5, endSoil100: 57 },
  split: [{ year: 2027, byCrop: { soybeans: 115, corn: 164 }, total: 279 }, { year: 2028, byCrop: { corn: 115, soybeans: 164 }, total: 279 }, { year: 2029, byCrop: { soybeans: 115, corn: 164 }, total: 279 }],
};
const keepGoing = {
  ...pick, view: 'current',
  fields: [
    field('f1', 'Home place', 115, ['corn', 'corn'], ['corn', 'corn', 'corn'], ['repeat', 'repeat', 'repeat'], { key: 'keepsSame', words: 'Corn every season' }),
    field('f5', 'East place', 128, ['corn', 'corn'], ['corn', 'corn', 'corn'], ['repeat', 'repeat', 'repeat'], { key: 'keepsSame', words: 'Corn every season' }),
    field('f4', 'South 40', 36, ['corn', 'soybeans'], ['corn', 'soybeans', 'corn'], ['nitrogen', 'break', 'nitrogen'], { key: 'alreadyTurns', words: 'Already turns' }),
  ],
};
// the comparison the story's pick reads (compareFutures shape, only what the story uses)
const entry = (crops, total) => ({ seasons: crops.map((c) => ({ crop: c, cover: null, key: c, warnings: [], worst: 0 })), total });
const cmp = {
  years: [2027, 2028, 2029],
  fields: [
    { id: 'f1', name: 'Home place', acres: 115, history: ['corn', 'corn', 'corn'], byKind: { current: entry(['corn', 'corn', 'corn'], 69000), maxProfit: entry(['soybeans', 'corn', 'soybeans'], 89000), priority: entry(['soybeans', 'corn', 'soybeans'], 89000) } },
    { id: 'f5', name: 'East place', acres: 128, history: ['corn', 'corn', 'corn'], byKind: { current: entry(['corn', 'corn', 'corn'], 76000), maxProfit: entry(['soybeans', 'corn', 'soybeans'], 99000), priority: entry(['corn', 'soybeans', 'corn'], 93000) } },
  ],
};

/** The text inside the <table class="rib"> … </table>. */
const tableOf = (html) => /<table class="rib[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';

describe('the ribbon', () => {
  it('is a captioned table whose row headers open the field stories', () => {
    const html = ribbonHtml(pick, { selectedKind: 'priority' });
    assert.match(html, /<table class="rib rib--priority"/);
    assert.match(html, /<caption class="sr-only">Manami’s pick, field by field: what each field grew in 2025 and 2026, then the plan for 2027 to 2029\./);
    const rows = [...html.matchAll(/<th scope="row" class="rib__fieldc"><button type="button" class="rib__open" data-field="(\w+)" aria-expanded="false" aria-controls="story-(\w+)"/g)];
    assert.deepEqual(rows.map((m) => m[1]), ['f1', 'f5', 'f4']); // the rotation's own order
    assert.ok(rows.every((m) => m[1] === m[2]));
    assert.doesNotMatch(html, /role="grid"|tabindex/); // a plain table: no grid, no roving focus in the cells
    // the row button names the crops for the shared tip, the verdict chip rides in it
    assert.match(html, /data-crop-tip-list="2027 Soybeans;2028 Corn;2029 Soybeans"/);
    assert.match(html, /rib__verdict--nowTurns" title="Was corn on corn, now turns">Was corn on corn, now turns</);
  });

  it('shows no money', () => {
    // (only a cell's screen-reader words may say what the beans' nitrogen saves an acre: spec §8.14)
    const seen = (html) => html.replace(/<span class="sr-only">[^<]*<\/span>/g, '');
    for (const rot of [pick, keepGoing]) assert.doesNotMatch(seen(tableOf(ribbonHtml(rot, { selectedKind: rot.view }))), /\$/);
  });

  it('follows the plan on show', () => {
    const a = tableOf(ribbonHtml(pick, { selectedKind: 'priority' }));
    const b = tableOf(ribbonHtml(keepGoing, { selectedKind: 'current' }));
    assert.match(b, /^<table class="rib rib--current" data-kind="current">/);
    assert.match(b, /<caption class="sr-only">Keep going, field by field/);
    // Home place 2027: beans after corn on the pick, corn again on keeping going
    const home = (t) => /<tr class="rib__row" data-field="f1">[\s\S]*?<\/tr>/.exec(t)[0];
    assert.match(home(a), /rib__cell rib__cell--break"><span class="rib__link rib__link--break" aria-hidden="true">/);
    assert.match(home(a), /data-crop-tip="Soybeans" data-crop-sub="2027"/);
    assert.match(home(b), /rib__cell--repeat/);
    assert.doesNotMatch(home(b), /data-crop-tip="Soybeans"/);
  });

  it('marks the two past seasons, and only the older one hides on a phone', () => {
    const html = ribbonHtml(pick, {});
    assert.match(html, /<th scope="col" class="rib__past rib__y--old"><span class="rib__was">was<\/span> 2025<\/th><th scope="col" class="rib__past"><span class="rib__was">was<\/span> 2026<\/th>/);
    // past crops are standalone badges (named for screen readers); planned ones are named by the cell's words
    assert.match(html, /<td class="rib__past rib__y--old"><span class="plan-crop plan-crop--sm" role="img" aria-label="2025: Corn"/);
    assert.match(html, /<span class="sr-only">Home place, 2027: Soybeans, after corn\. Breaks a pest cycle\.<\/span>|<span class="sr-only">Home place, 2027: Soybeans[^<]*<\/span>/);
  });

  it('opens the stories asked for, right under their rows', () => {
    const html = ribbonHtml(pick, { open: new Set(['f5']), stories: { f1: '<p>one</p>', f5: '<p>five</p>' } });
    assert.match(html, /aria-expanded="true" aria-controls="story-f5"/);
    assert.match(html, /data-field="f5">[\s\S]*?<\/tr><tr class="rib__story" id="story-f5"><td colspan="6"><p>five<\/p><\/td><\/tr>/);
    assert.match(html, /<tr class="rib__story" id="story-f1" hidden><td colspan="6"><p>one<\/p>/);
  });

  it('lists only the link kinds that are there', () => {
    const legend = (rot) => [...ribbonHtml(rot, {}).matchAll(/rib-legend__item--([\w-]+)/g)].map((m) => m[1]);
    assert.deepEqual(legend(pick), ['repeat', 'nitrogen', 'break']);
    const allSwap = { ...pick, fields: [pick.fields[0]] };
    assert.deepEqual(legend(allSwap), ['nitrogen', 'break']);
    const covered = { ...pick, fields: [{ ...pick.fields[0], seasons: pick.fields[0].seasons.map((s, i) => (i === 2 ? { ...s, cover: 'cereal-rye' } : s)) }] };
    assert.deepEqual(legend(covered), ['nitrogen', 'break', 'cover']);
    assert.match(ribbonHtml(covered, {}), /<span class="rib__blanket" aria-hidden="true">/);
  });

  it('splits the acres by crop under each season, corn first', () => {
    assert.deepEqual(splitParts(pick.split[0]).map((p) => p.words), ['164 ac corn', '115 ac beans']);
    const html = ribbonHtml(pick, {});
    assert.match(html, /<td class="rib-split"><span class="rib-split__words">164 ac corn<\/span><span class="rib-split__words">115 ac beans<\/span><span class="rib-split__bar" aria-hidden="true">/);
    assert.match(html, /<ul class="rib-splitlist" aria-label="Acres by crop"><li><b>2027<\/b> 164 ac corn · 115 ac beans/);
    assert.equal(ribbonHtml({ ...pick, fields: [] }, {}), '');
  });
});

describe('the rotation check', () => {
  const rows = [
    { key: 'repeats', label: 'Same crop again', value: '2 seasons', base: 9, better: true },
    { key: 'handoffs', label: 'Corn after beans', value: '6 seasons, about 35 lb of free nitrogen an acre each time', base: 3, better: true },
    { key: 'rootworm', label: 'Rootworm control needed', value: '2 seasons', base: 9, better: true },
    { key: 'cover', label: 'Winter cover', value: 'none. The ground sits bare about 5 months each winter.', base: 'none', better: null },
    { key: 'soil', label: 'Soil score in 2029', value: '57/100', base: 45, better: true },
  ];
  it('has 5 rows with an icon, the value and keeping going quieter', () => {
    const html = checkHtml(rows);
    assert.equal(html.match(/<li class="rot-check__row/g).length, 5);
    assert.match(html, /<h3 class="plans__h" id="rotCheckH">Rotation check<\/h3>/);
    assert.match(html, /rot-check__row--repeats is-better"><span class="rot-check__icon" aria-hidden="true"><svg/);
    assert.match(html, /<span class="rot-check__value">2 seasons <span class="rot-check__base"><span class="sr-only">, <\/span>keeping going: 9<\/span><\/span>/);
    assert.doesNotMatch(html, /\$/);
  });
  it('says "my pick" when Keep going is the one on show, and leaves a base that names itself', () => {
    assert.match(checkHtml(rows, { baseLabel: 'my pick' }), />my pick: 9</);
    assert.match(checkHtml([{ key: 'soil', label: 'Soil', value: '45/100', base: 'keeping going: 45' }]), />keeping going: 45</);
    assert.equal(checkHtml([]), '');
  });
});

describe('the plan switch', () => {
  it('is a radiogroup of the three plans with the pick selected and recommended', () => {
    const html = switchHtml(cmp, pick, 'priority', { showMix: false });
    assert.match(html, /^<div class="rib-switch" role="radiogroup" aria-label="Plan to show">/);
    const segs = [...html.matchAll(/data-kind="(\w+)" aria-checked="(true|false)" tabindex="(-?\d)"/g)].map((m) => m.slice(1).join(' '));
    assert.deepEqual(segs, ['current false -1', 'maxProfit false -1', 'priority true 0']);
    assert.match(html, /Manami’s pick<\/span><span class="rib-switch__badge">Recommended<\/span>/);
    assert.match(html, /data-kind="priority"[^>]*data-crop-tip-list="2027 Corn and Soybeans;2028 Corn and Soybeans;2029 Corn and Soybeans"/);
    assert.doesNotMatch(html, /Your plan/);
  });
  it('shows Your plan once the picks differ', () => {
    const html = switchHtml(cmp, pick, 'mix', { showMix: true });
    assert.match(html, /data-kind="mix" aria-checked="true" tabindex="0"[^>]*>.*Your plan/);
    assert.equal(PLAN_NAME.mix, 'Your plan');
    // a selection that isn't on the switch falls back to the pick
    assert.match(switchHtml(cmp, pick, 'mix', { showMix: false }), /data-kind="priority" aria-checked="true"/);
  });
  it('arrows wrap, Home and End jump', () => {
    assert.equal(nextIndex('ArrowRight', 2, 3), 0);
    assert.equal(nextIndex('ArrowLeft', 0, 3), 2);
    assert.equal(nextIndex('ArrowDown', 0, 4), 1);
    assert.equal(nextIndex('Home', 2, 3), 0);
    assert.equal(nextIndex('End', 0, 3), 2);
    assert.equal(nextIndex('Enter', 0, 3), null);
  });
});

describe('a field story', () => {
  it('ends on the per-field pick, the .plan-cell radios the panel listens to', () => {
    const html = storyHtml(pick, cmp, 'f1', { choice: { f1: 'current' }, place: { state: 'IA', fips: '19169' } });
    assert.match(html, /<ol class="story__seasons">/);
    assert.equal(html.match(/<li class="story-card">/g).length, 3);
    assert.match(html, /<h4 class="story-card__h"><span class="plan-crop plan-crop--md" aria-hidden="true" data-crop-tip="Soybeans" data-crop-sub="2027"/);
    assert.match(html, /<h4 class="story__pickh" id="pick-h-f1">Plan for Home place<\/h4>\s*<div class="story__cells" role="radiogroup" aria-labelledby="pick-h-f1">/);
    const cells = [...html.matchAll(/class="plan-cell( is-on)?" role="radio" aria-checked="(\w+)" tabindex="(-?\d)" data-field="f1" data-kind="(\w+)"/g)].map((m) => `${m[4]} ${m[2]} ${m[3]}`);
    assert.deepEqual(cells, ['current true 0', 'maxProfit false -1', 'priority false -1']);
    assert.match(html, /aria-label="Home place: Keep going, Corn, Corn, Corn, about \$69k over 3 seasons"/);
    assert.match(html, /<span class="plan-cell__cash">about \$89k<\/span>/);
    assert.match(html, /<p class="story__picked" id="picked-f1" aria-live="polite"><\/p>/);
    // the pick comes after the cards (money last of the words, then the radios)
    assert.ok(html.indexOf('story__seasons') < html.indexOf('story__pick'));
    assert.equal(storyHtml(pick, cmp, 'nope', {}), '');
  });
  it('still shows the season cards without the comparison (no lead, why-not or pick)', () => {
    const html = storyHtml(pick, null, 'f5', {});
    assert.equal(html.match(/<li class="story-card">/g).length, 3);
    assert.match(html, /data-crop-tip="Corn"/);
    assert.doesNotMatch(html, /story__lead|story__whynot|plan-cell/);
  });
});

test('wireRibbon: a row button opens its story; the switch selects; dispose unhooks', () => {
  assert.equal(typeof wireRibbon(null, {}), 'function');
  const on = {};
  const story = { hidden: true };
  const row = { classList: { toggle() {} } };
  const btn = { dataset: { field: 'f1' }, attrs: { 'aria-expanded': 'false' }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; }, closest: (s) => (s === '.rib__row' ? row : null) };
  const el = {
    addEventListener: (t, fn) => { on[t] = fn; }, removeEventListener: (t) => { delete on[t]; },
    contains: () => true, querySelector: (s) => (s === '[id="story-f1"]' ? story : null),
  };
  const toggles = [], picks = [];
  const dispose = wireRibbon(el, { onToggle: (id, open) => toggles.push([id, open]), onSelect: (k) => picks.push(k) });
  on.click({ target: { closest: (s) => (s === '.rib__open' ? btn : null) } });
  assert.equal(btn.attrs['aria-expanded'], 'true');
  assert.equal(story.hidden, false);
  on.click({ target: { closest: (s) => (s === '.rib__open' ? btn : null) } });
  assert.equal(story.hidden, true);
  assert.deepEqual(toggles, [['f1', true], ['f1', false]]);
  const seg = { dataset: { kind: 'maxProfit' }, getAttribute: () => 'false' };
  on.click({ target: { closest: (s) => (s === '.rib-switch__seg' ? seg : null) } });
  assert.deepEqual(picks, ['maxProfit']);
  dispose();
  assert.deepEqual(Object.keys(on), []);
});
