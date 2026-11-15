// "See them on the farm": the plain helpers behind the island view (which crops each field shows,
// which fields grow back in, which chips show when they'd overlap), on the demo farm's real plans.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { demoData, wheatData, kansasLike, START_YEAR } from '../../test/futuresDemo.mjs';
import { compareFutures, seasonChanges, viewField, frostIds, dryIds } from '../plan/compareFutures.js';
import { LENS_ICONS } from '../ui/futureIcons.js';

// planFutures.js touches the DOM only inside createPlanFutures; these are plain functions
globalThis.document ??= { getElementById: () => null };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { keysFor, cellsFor, changedIds, overlaps, declutter, focusHome, chipHtml, seasonYearHtml, frostRowWords, dryRowWords, VIEWS } = await import('./planFutures.js');

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

describe('spring freezes on the chips, the season radios and the card (wheat demo)', () => {
  let wheat, plain;
  // a chip as paintChips writes it, for a field, view and season
  const chip = (cmp, id, view, season) => {
    const f = cmp.fields.find((x) => x.id === id);
    const e = viewField(cmp, id, view, {});
    const d = e.total - f.byKind.current.total;
    return chipHtml({ s: e.seasons[season], total: e.total, diff: d, showDiff: true, dry: dryIds(cmp, view, season, {}).has(id) });
  };
  const flakes = (html) => (html.match(/fut-chip__frost/g) || []).length;
  before(() => {
    wheat = compareFutures(wheatData(), { startYear: START_YEAR });
    plain = compareFutures(demoData(['profit']), { startYear: START_YEAR });
  });

  it('puts a snowflake on a chip only where that season’s wheat has a freeze', () => {
    for (const id of ['f1', 'f2', 'f5']) {
      const html = chip(wheat, id, 'priority', 1);
      assert.equal(flakes(html), 1, id);
      assert.ok(html.includes(`<span class="fut-chip__frost" aria-hidden="true">${LENS_ICONS.frost}</span>`));
    }
    assert.equal(flakes(chip(wheat, 'f3', 'priority', 1)), 0); // corn that season
    assert.equal(flakes(chip(wheat, 'f1', 'priority', 0)), 0); // the year before the wheat
    assert.equal(flakes(chip(wheat, 'f1', 'current', 1)), 0); // keeping going grows no wheat
    for (const view of ['current', 'maxProfit', 'priority', 'mix']) {
      for (const f of plain.fields) for (const y of [0, 1, 2]) assert.equal(flakes(chip(plain, f.id, view, y)), 0, `${view} ${f.id} ${y}`);
    }
  });

  it('puts a drop on a chip only where water is the weather worry and the field runs short', () => {
    const drops = (cmp, id, season) => (chip(cmp, id, 'priority', season).match(/fut-chip__dry/g) || []).length;
    for (const f of wheat.fields) for (const y of [0, 1, 2]) assert.equal(drops(wheat, f.id, y), 0); // humid Iowa: none
    const dry = kansasLike(wheat);
    const ids = dryIds(dry, 'priority', 0, {});
    assert.ok(ids.size > 0);
    for (const f of dry.fields) assert.equal(drops(dry, f.id, 0), ids.has(f.id) ? 1 : 0, f.id);
  });

  it('shows the season radio’s snowflake only in a season with a freeze', () => {
    const shown = (cmp, view) => [0, 1, 2].map((i) => !/fut-season__frost" aria-hidden="true" hidden/.test(seasonYearHtml(cmp.years[i], frostIds(cmp, view, i, {}).size > 0)));
    assert.deepEqual(shown(wheat, 'priority'), [false, true, false]);
    assert.deepEqual(shown(wheat, 'current'), [false, false, false]);
    for (const view of ['current', 'maxProfit', 'priority', 'mix']) assert.deepEqual(shown(plain, view), [false, false, false], view);
    // the glyph is always there (paintDock flips hidden in place) and carries no words of its own
    const html = seasonYearHtml(2028, false);
    assert.ok(html.includes('2028'));
    assert.ok(html.includes(LENS_ICONS.frost));
    assert.ok(/class="fut-season__frost" aria-hidden="true" hidden/.test(html));
    assert.ok(!/ hidden>/.test(seasonYearHtml(2028, true)));
  });

  it('says the freeze in the plan row’s label', () => {
    const pick = wheat.fields.find((f) => f.id === 'f1').byKind.priority.seasons;
    assert.equal(frostRowWords(pick, wheat.years), ' Spring freeze risk on the wheat in 2028.');
    assert.equal(frostRowWords(wheat.fields.find((f) => f.id === 'f3').byKind.priority.seasons, wheat.years), '');
    const twice = pick.map((s, y) => (y === 1 ? s : { ...s, freeze: y === 2 ? s.freeze ?? pick[1].freeze : null }));
    assert.equal(frostRowWords(twice, wheat.years), ' Spring freeze risk on the wheat in 2028 and 2029.');
  });

  it('says a water shortfall in the plan row’s label, only where water is the worry (the drop is hidden from screen readers)', () => {
    const seasons = [{ waterShort: 1.4 }, { waterShort: 0.3 }, { waterShort: 2 }];
    assert.equal(dryRowWords(seasons, wheat.years, true), ' Short of water in 2027 and 2029.');
    assert.equal(dryRowWords(seasons, wheat.years, false), '', 'a humid farm');
    assert.equal(dryRowWords([{ waterShort: 0 }, {}, { waterShort: 0.9 }], wheat.years, true), '');
  });

  it('keeps the chip as it was where there is no freeze or drop', () => {
    const s = { crop: 'corn', cover: null, worst: 1 };
    const html = chipHtml({ s, total: 81234, diff: -2400, showDiff: true });
    assert.ok(html.startsWith('<span class="fut-chip__crop plan-crop">'));
    assert.ok(html.includes('<span class="fut-chip__diff is-down">−'));
    assert.ok(html.endsWith('<span class="fut-chip__dot sev-1"></span>'));
    assert.ok(!/fut-chip__(frost|dry)/.test(html));
    assert.ok(!/fut-chip__diff/.test(chipHtml({ s, total: 81234, diff: 0 })));
  });
});
