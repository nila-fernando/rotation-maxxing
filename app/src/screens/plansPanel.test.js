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

describe('the plans panel leads with the rotation', async () => {
  const { demoData } = await import('../../test/futuresDemo.mjs');
  const { nextTab, TABS } = await import('./plansPanel.js');
  const today = () => new Date(2026, 10, 15); // plans from 2027

  // a fresh set of stand-in elements per panel (the earlier panels' listeners stay on the old ones)
  const freshPanel = (opts = {}) => {
    for (const k of Object.keys(els)) delete els[k];
    const body = els.plansBody = fakeEl();
    const parts = {}; // selector -> stand-in element the panel will find
    body.querySelector = (sel) => parts[sel] ?? null;
    let cells = [];
    body.querySelectorAll = (sel) => (sel.startsWith('.plan-cell') ? cells.filter((c) => sel === '.plan-cell' || sel.includes(`"${c.dataset.field}"`)) : []);
    const data = demoData(['profit']);
    const panel = createPlansPanel({ planSeasons: async () => data, evaluateMix: async (plan) => data.evaluate(plan), today, ...opts });
    const key = (k) => { for (const fn of body.on.keydown) fn({ key: k, target: { closest: (s) => (s === '.plans__tab' ? {} : null) }, preventDefault() {} }); };
    const setCells = (list) => { cells = list; };
    return { panel, body, parts, key, setCells, data };
  };
  const cell = (field, kind) => {
    const c = fakeEl();
    c.dataset = { field, kind };
    c.attrs = {};
    c.setAttribute = (k, v) => { c.attrs[k] = v; };
    return c;
  };
  const selectedTab = (html) => /data-view="(\w+)" aria-selected="true"/.exec(html)?.[1];

  it('the tab arrows cycle Your rotation, When to sow and Build your own', async () => {
    assert.deepEqual(TABS.map((t) => t.label), ['Your rotation', 'When to sow', 'Build your own']);
    assert.equal(nextTab('rotation', 'ArrowRight'), 'calendar');
    assert.equal(nextTab('build', 'ArrowRight'), 'rotation');
    assert.equal(nextTab('rotation', 'ArrowLeft'), 'build');
    assert.equal(nextTab('calendar', 'Home'), 'rotation');
    assert.equal(nextTab('rotation', 'End'), 'build');
    assert.equal(nextTab('rotation', 'Enter'), null);
    const { panel, body, key } = freshPanel();
    await panel.open();
    assert.equal(selectedTab(body.innerHTML), 'rotation'); // it opens on the rotation
    assert.match(body.innerHTML, /role="tablist" aria-label="Plans">.*plansTab-rotation.*plansTab-calendar.*plansTab-build/s);
    const seen = [];
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'Home', 'End']) { key(k); seen.push(selectedTab(body.innerHTML)); }
    assert.deepEqual(seen, ['calendar', 'build', 'rotation', 'build', 'rotation', 'build']);
    // When to sow says which plan its dates follow (the one on show on Your rotation)
    key('Home'); key('ArrowRight');
    assert.equal(selectedTab(body.innerHTML), 'calendar');
    assert.match(body.innerHTML, /<p class="plans__calfor">Dates for <b>Manami’s pick<\/b>\. Change the plan on Your rotation\.<\/p>/);
    key('End');
    assert.match(body.innerHTML, /role="tabpanel" id="plansView" aria-labelledby="plansTab-build"/);
    panel.close();
  });

  it('puts the money second, behind a closed Money detail', async () => {
    const { panel, body } = freshPanel({ onFutures: () => {} });
    await panel.open();
    const html = body.innerHTML;
    // (the field stories sit under their ribbon rows, closed; their money is the last of their words)
    // (a ribbon cell's screen-reader words may say what the beans' nitrogen saves an acre: spec §8.14)
    const shown = html.replace(/<tr class="rib__story"[\s\S]*?<\/td><\/tr>/g, '').replace(/<span class="sr-only">[^<]*<\/span>/g, '');
    const moneyAt = shown.indexOf('id="rotMoneyH"');
    assert.ok(moneyAt > 0);
    assert.ok(shown.indexOf('$') > moneyAt, `no money above the Money heading: ${shown.slice(Math.max(0, shown.indexOf('$') - 300), shown.indexOf('$') + 40)}`);
    assert.match(html, /<details class="plans__more rot-money__detail"><summary>Money detail<\/summary>/);
    assert.doesNotMatch(html, /<details[^>]* open/); // every disclosure starts closed
    // the four numbers for the three plans, and the price in Manami's words, not the planner's summary
    for (const n of ['Cash margin, 3 seasons', 'In a bad year (1 in 10)', 'Soil score in 2029', 'Beats keeping going']) assert.ok(html.includes(n), n);
    assert.match(html, /<th scope="row">Keep going<\/th><td>\$350k<\/td><td>\$183k<\/td><td>45\/100<\/td><td>–<\/td>/);
    assert.match(html, /<th scope="row">Manami’s pick<span class="sr-only"> \(on show\)<\/span><\/th><td>\$408k<\/td><td>\$263k<\/td><td>57\/100<\/td><td>98% of years<\/td>/);
    // nothing lost: the planner's own words, word for word
    for (const s of ['Why my pick', 'Watch out', 'Good to know', 'The planner’s own words', 'Price of priorities']) assert.ok(html.includes(s), s);
    // "See it on the farm" on Manami's pick runs her walk; "Use this plan" stays in the footer
    assert.match(html, /class="btn btn--primary btn--small plans__farm" type="button" data-act="futures">/);
    assert.match(html, /<span id="plansMix">Your plan: <b>Manami’s pick on every field<\/b>/);
    panel.close();
  });

  it('setChoice flips the story radios and shows the "Your plan" segment', async () => {
    const { panel, parts, setCells } = freshPanel();
    await panel.open();
    const cells = ['current', 'maxProfit', 'priority'].map((k) => cell('f3', k));
    const other = cell('f1', 'priority');
    setCells([...cells, other]);
    const sw = parts['.rot-host--switch'] = fakeEl();
    panel.setChoice({ f3: 'current' });
    assert.deepEqual(panel.getChoice().f3, 'current');
    assert.deepEqual(cells.map((c) => [c.dataset.kind, c.attrs['aria-checked'], c.tabIndex]), [['current', 'true', 0], ['maxProfit', 'false', -1], ['priority', 'false', -1]]);
    assert.equal(other.attrs['aria-checked'], 'true'); // the other fields keep their pick
    assert.match(sw.innerHTML, /data-kind="mix" aria-checked="false" tabindex="-1"[^>]*>.*Your plan/);
    // back on one plan everywhere, the segment goes again
    panel.setChoice({ f3: 'priority' });
    assert.doesNotMatch(sw.innerHTML, /Your plan/);
    panel.close();
  });

  // the plan switch and the story pick, driven through the panel's own (delegated) click handlers
  const hosts = (parts) => {
    for (const p of ['farm', 'switch', 'ribbon', 'check', 'money', 'detail', 'watch']) parts[`.rot-host--${p}`] = fakeEl();
    return (p) => parts[`.rot-host--${p}`].innerHTML;
  };
  const clickOn = (body, sel, dataset) => {
    const t = { dataset, getAttribute: () => 'false' };
    for (const fn of body.on.click) fn({ target: { closest: (s) => (s === sel ? t : null) } });
  };
  const textOf = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  it('leads with the real demo rotation: the row order, the 2027 split and the check', async () => {
    const { panel, body } = freshPanel();
    await panel.open();
    const html = body.innerHTML;
    assert.deepEqual([...html.matchAll(/class="rib__open" data-field="(\w+)"/g)].map((m) => m[1]), ['f1', 'f2', 'f5', 'f3', 'f4']);
    assert.match(html, /<li><b>2027<\/b> 289 ac corn · 253 ac beans/);
    assert.match(html, /<table class="rib rib--priority"/);
    // the check, for Manami's pick against keeping going (§6.7)
    const check = textOf(/<section class="rot-check"[\s\S]*?<\/section>/.exec(html)[0]);
    for (const s of ['Same crop again : 2 seasons , keeping going: 9', 'Corn after beans : 6 seasons', 'keeping going: 3', 'Rootworm control needed : 2 seasons , keeping going: 9', 'Soil score in 2029 : 57/100 , keeping going: 45']) assert.ok(check.includes(s), `${s} in ${check}`);
    panel.close();
  });

  it('the switch changes the ribbon, the check, the money line and the farm button, never the picks', async () => {
    const { panel, body, parts } = freshPanel({ onFutures: () => {} });
    body.contains = () => true;
    await panel.open();
    const part = hosts(parts);
    const { moneyLine } = await import('../plan/rotationVoice.js');
    const { compareFutures } = await import('../plan/compareFutures.js');
    const cmp = compareFutures(demoData(['profit']), { startYear: 2027 });
    clickOn(body, '.rib-switch__seg', { kind: 'maxProfit' });
    assert.match(part('ribbon'), /<table class="rib rib--maxProfit"/);
    assert.match(part('ribbon'), /<li><b>2027<\/b> 36 ac corn · 506 ac beans/);
    assert.match(part('switch'), /data-kind="maxProfit" aria-checked="true" tabindex="0"/);
    assert.match(part('switch'), /In 2027, nearly all of your acres are in beans\./);
    assert.equal(textOf(part('money')), moneyLine(cmp, 'maxProfit', null, {}));
    assert.match(part('farm'), /data-show="maxProfit"/);
    assert.match(part('detail'), /<tr class="is-on"><th scope="row">Most profit/);
    // Keep going on show: the check compares with my pick instead
    clickOn(body, '.rib-switch__seg', { kind: 'current' });
    assert.match(textOf(part('check')), /Same crop again : 9 seasons , my pick: 2/);
    assert.match(part('watch'), /On Keep going\./);
    assert.deepEqual(new Set(Object.values(panel.getChoice())), new Set(['priority'])); // the picks stay
    // back on Manami's pick, "See it on the farm" runs her walk again
    clickOn(body, '.rib-switch__seg', { kind: 'priority' });
    assert.match(part('farm'), /data-act="futures"/);
    panel.close();
  });

  it('a story pick says so, brings "Your plan" and sends the mix to the farm', async () => {
    const futures = [];
    const { panel, body, parts } = freshPanel({ onFutures: (k, o) => futures.push([k, o]) });
    body.contains = () => true;
    await panel.open();
    const part = hosts(parts);
    const said = parts['[id="picked-f3"]'] = fakeEl();
    clickOn(body, '.plan-cell', { field: 'f3', kind: 'current' });
    assert.equal(panel.getChoice().f3, 'current');
    assert.match(part('switch'), /data-kind="mix" aria-checked="false"[^>]*>.*Your plan/);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(said.textContent, 'Got it: North draw keeps going.');
    // on show: the mix (scored), and "See it on the farm" opens it without the walk
    clickOn(body, '.rib-switch__seg', { kind: 'mix' });
    await new Promise((r) => setTimeout(r, 300));
    assert.match(part('ribbon'), /<table class="rib rib--mix"/);
    assert.match(part('detail'), /<tr class="is-on"><th scope="row">Your plan/);
    assert.doesNotMatch(textOf(part('money')), /working out/i);
    assert.match(part('farm'), /data-show="mix"/);
    clickOn(body, '[data-show]', { show: 'mix' });
    assert.deepEqual(futures, [['mix', { reel: false }]]);
    panel.close();
  });

  it("every line Manami says on the rotation tab passes lintLine, and her headline has no money", async () => {
    const { lintLine } = await import('../plan/futuresVoice.js');
    const { panel, body } = freshPanel();
    await panel.open();
    const html = body.innerHTML;
    const said = [...html.matchAll(/<p class="(?:rib-switch__note|rot-money__line|rot-money__note|rot-why|story__lead|story__whynot|story__money|story-card__row)">([\s\S]*?)<\/p>/g)]
      .map((m) => textOf(m[1]).replace(/^(Why|When) /, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
    const headline = textOf(/<div class="plans__manami">([\s\S]*?)<\/p>/.exec(html)[1]);
    assert.doesNotMatch(headline, /\$/);
    said.push(headline);
    assert.ok(said.length > 20, `${said.length} lines`);
    for (const l of said) assert.deepEqual(lintLine(l), [], l);
    panel.close();
  });
});
