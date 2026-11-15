// The three plans compared field by field, on the demo farm's real plans (worked out here as the
// app does: test/futuresDemo.mjs), plus a soil-first run, the wheat demo (a spring freeze) and
// synthetic 1- and 15-field farms. The planner's Monte Carlo totals are pinned in one block at the
// end, so a re-vendor that moves them is re-pinned in one place.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { demoData, clonedData, coverPickData, kansasLike, wheatData, START_YEAR } from '../../test/futuresDemo.mjs';
import {
  KINDS, coinPlan, compareFutures, coverAddFields, coverOnlyFields, dryIds, fineprint, flagsFor, frostIds, frostStop, headline, isGoodFit,
  mixedPlan, reelStops, seasonChanges, termsOf, tiles, viewField,
} from './compareFutures.js';

const near = (actual, expected, tol, what) => assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} not within ${tol} of ${expected}`);
const asObject = (m) => Object.fromEntries(m);

describe('the three plans compared field by field (demo farm, profit first)', () => {
  let data, cmp;
  before(() => {
    data = demoData(['profit']);
    cmp = compareFutures(data, { startYear: START_YEAR });
  });

  it('adds up the fields', () => {
    assert.deepEqual(cmp.years, [2027, 2028, 2029]);
    const diff = Object.fromEntries(cmp.fields.map((f) => [f.id, f.diff.priority]));
    near(diff.f1, 20269, 1, 'Home place');
    near(diff.f2, 24726, 1, 'West 140');
    near(diff.f3, -2237, 1, 'North draw');
    near(diff.f4, 0, 1, 'South 40');
    near(diff.f5, 16600, 1, 'East place');
    for (const k of KINDS) {
      const sum = cmp.fields.reduce((a, f) => a + f.byKind[k].total, 0);
      assert.ok(Math.abs(sum - cmp.totals[k].expectedGM) / cmp.totals[k].expectedGM < 0.01, `${k}: fields ${sum} vs farm ${cmp.totals[k].expectedGM}`);
    }
    near(cmp.seasonCash.priority[0], 132135, 1, '2027');
    near(cmp.seasonCash.priority[1], 139334, 1, '2028');
    near(cmp.seasonCash.priority[2], 136549, 1, '2029');
    assert.equal(cmp.fields.find((f) => f.id === 'f1').isRepeat0, true);
    assert.equal(cmp.fields.find((f) => f.id === 'f3').isRepeat0, false);
  });

  it('reads the farm numbers, the price of priorities and the weights', () => {
    assert.equal(cmp.totals.priority.endSoil100, 57);
    assert.equal(cmp.totals.current.endSoil100, 45);
    assert.ok(cmp.price.cash < 0, 'the pick gives up some cash'); // the amount: the Monte Carlo block below
    near(cmp.price.nCarried, -5137.9, 0.1, 'nitrogen carried');
    near(cmp.price.soilAvgPts, 3.5, 0.01, 'soil points');
    assert.ok(cmp.price.waterIn > 0.35, 'the pick uses more water');
    assert.equal(cmp.price.samePlan, false);
    assert.equal(cmp.price.waterInches, true, 'real daily weather: the water numbers are inches');
    assert.deepEqual(cmp.weights, { top: 'profit', topPct: 68, second: 'soilHealth', secondPct: 32, pcts: { profit: 68, soilHealth: 32, water: 0 }, waterPlentiful: true, asked: 'profit' });
    assert.equal(cmp.weather.place, 'Ames, Iowa');
    assert.equal(cmp.weather.years, 24);
  });

  it('reads a season’s terms', () => {
    const f5 = viewField(cmp, 'f5', 'current');
    near(f5.seasons[0].drag, -9.9, 0.05, 'continuous corn drag');
    assert.equal(f5.seasons[0].nCredit, 0);
    assert.equal(f5.seasons[0].bareMonths, 4);
    assert.equal(f5.seasons[0].waterShort > 0, true);
    const f2 = viewField(cmp, 'f2', 'priority');
    near(f2.seasons[1].nCredit, 20.3, 0.01, 'N credit after beans');
    assert.deepEqual(termsOf({ terms: [{ label: 'Water used: 18.4 in crop ET', value: 18.4 }] }).water, 18.4);
  });

  it('sees what changes', () => {
    const ch = seasonChanges(cmp, 'priority').map(asObject);
    assert.deepEqual(ch, [
      { f1: 'crop', f2: 'crop', f3: 'crop' },
      { f1: 'margin', f2: 'margin', f3: 'crop', f5: 'crop' },
      { f1: 'crop', f2: 'crop', f3: 'crop', f5: 'margin' },
    ]);
    // the most-profit plan measured against the pick (the vsProfit stop)
    assert.deepEqual(asObject(seasonChanges(cmp, 'maxProfit', null, 'priority')[0]), { f3: 'crop', f5: 'crop' });
  });

  it('counts coins', () => {
    const coins = coinPlan(cmp);
    assert.equal(coins.value, 10000);
    assert.deepEqual(asObject(coins.counts.current), { f1: 7, f2: 8, f3: 9, f4: 3, f5: 8 });
    assert.deepEqual(asObject(coins.counts.maxProfit), { f1: 9, f2: 11, f3: 9, f4: 3, f5: 10 });
    assert.deepEqual(asObject(coins.counts.priority), { f1: 9, f2: 11, f3: 9, f4: 3, f5: 9 });
    for (const k of KINDS) for (const n of coins.counts[k].values()) assert.ok(n >= 0 && n <= 12);
    assert.deepEqual(asObject(coins.countsFor('mix', { f1: 'current', f5: 'maxProfit' })), { f1: 7, f2: 11, f3: 9, f4: 3, f5: 10 });
  });

  it('fills the tiles, for a whole plan and for a mix', () => {
    const [cash, bad, soil, beats] = tiles(cmp, 'priority');
    // the cash and the bad year are Monte Carlo numbers (pinned below); here only which way they go
    assert.ok(cash.diff > 0 && bad.diff > 0);
    assert.deepEqual([soil.value, soil.diff], [57, 12]);
    assert.ok(beats.value >= 90, `the pick beats keeping going in ${beats.value}%`);
    assert.equal(tiles(cmp, 'current')[3].value, null);
    const choice = { f1: 'current' };
    assert.equal(tiles(cmp, 'mix', null, choice)[0].value, null, 'still working');
    const mix = data.evaluate(mixedPlan(data.result.plans, choice));
    const t = tiles(cmp, 'mix', mix, choice);
    assert.equal(t[0].value, mix.expectedGM, 'a real mix: its own score');
    assert.equal(t[0].diff, mix.expectedGM - cmp.totals.current.expectedGM);
    assert.equal(t[3].value, Math.round(mix.probBeatsCurrent * 100));
    assert.equal(tiles(cmp, 'mix', mix)[0].value, mix.expectedGM, 'a score with no choice is the mix’s');
    assert.equal(tiles(cmp, 'mix')[0].value, cmp.totals.priority.expectedGM, 'nothing picked yet: the pick');
    assert.equal(tiles(cmp, 'mix', null, { f1: 'maxProfit', f2: 'maxProfit', f3: 'maxProfit', f4: 'maxProfit', f5: 'maxProfit' })[0].value, cmp.totals.maxProfit.expectedGM);
  });

  it('flags', () => {
    const flags = [0, 1, 2].map((y) => Object.fromEntries(flagsFor(cmp, 'priority', null, y).map((x) => [x.id, x.worst])));
    assert.deepEqual(flags, [{ f3: 2, f5: 2 }, { f3: 2, f4: 1 }, { f1: 1, f2: 1 }]);
    const lead = flagsFor(cmp, 'priority', null, 0).find((x) => x.id === 'f3');
    assert.equal(lead.lens, 'pest'); // rootworm leads, ahead of the repeat
    assert.equal(lead.count, 3);
  });

  it('walks the right stops', () => {
    const stops = reelStops(cmp);
    assert.deepEqual(stops.map((s) => s.id), ['intro', 'flip', 'gain', 'sameCrop', 'giveUp', 'vsProfit', 'why', 'watch', 'yourTurn']); // no frost, no dry stop
    const by = Object.fromEntries(stops.map((s) => [s.id, s]));
    assert.deepEqual([by.gain.fieldId, by.gain.season], ['f2', 0]);
    assert.deepEqual([by.sameCrop.fieldId, by.sameCrop.season], ['f1', 1]); // f2 2028 gains more, but f2 is the gain stop
    assert.deepEqual([by.giveUp.fieldId, by.giveUp.season], ['f3', 2]);
    assert.equal(by.watch.season, 0);
    assert.equal(by.intro.view, 'current');
    assert.equal(by.vsProfit.marksBase, 'priority');
    assert.equal(by.flip.growStagger, 0.12);
    assert.equal(by.yourTurn.view, 'mix');
    // when the pick is the current rotation, the walk is one line
    const same = { ...data, result: { ...data.result, plans: { ...data.result.plans, priority: { ...data.result.plans.current, kind: 'priority' } } } };
    assert.deepEqual(reelStops(compareFutures(same, { startYear: START_YEAR })).map((s) => s.id), ['intro', 'goodFit', 'yourTurn']);
  });

  it('is a good fit only when the pick keeps the crops', () => {
    // rye on every field for $500 less: same main crops, a cheap change
    const cheap = compareFutures(coverPickData(data, { gain: -500 }), { startYear: START_YEAR });
    assert.equal(isGoodFit(cheap), true);
    assert.equal(coverOnlyFields(cheap).length, 5);
    assert.equal(coverAddFields(cheap).length, 5);
    // the same rye for $15k less is a real change: the full walk says what it costs
    const dear = compareFutures(coverPickData(data, { gain: -15000, soilPts: 6 }), { startYear: START_YEAR });
    assert.equal(isGoodFit(dear), false);
    assert.equal(reelStops(dear)[1].id, 'flip');
    // a pick that changes crops is never a good fit, whatever it earns
    const poor = { ...data, result: { ...data.result, plans: { ...data.result.plans, priority: { ...data.result.plans.priority, expectedGM: data.result.plans.current.expectedGM - 20000 } } } };
    assert.equal(isGoodFit(compareFutures(poor, { startYear: START_YEAR })), false);
  });

  it('keeps every word the planner said', () => {
    for (const kind of [...KINDS, 'mix']) {
      const fp = Object.values(fineprint(cmp, kind)).flat();
      const plan = data.result.plans[kind === 'mix' ? 'priority' : kind];
      const said = [...plan.reasons, ...plan.risks, ...plan.informationGaps, ...plan.localReview, ...data.gaps,
        data.result.priceOfPriorities.summary, data.weather.source];
      for (const s of said) assert.ok(fp.includes(s), `${kind} fine print is missing: ${s}`);
      assert.deepEqual(fineprint(cmp, kind)['Weather risk'], [data.result.plans.priority.weatherRisk.message]);
    }
    const choice = { f1: 'current' };
    const mix = data.evaluate(mixedPlan(data.result.plans, choice));
    const fp = Object.values(fineprint(cmp, 'mix', mix, choice)).flat();
    for (const s of [...mix.reasons, ...mix.risks]) assert.ok(fp.includes(s), s);
    // a mix still being scored has no words of its own yet; every field on one plan has that plan's
    assert.deepEqual(fineprint(cmp, 'mix', null, choice).Reasons, []);
    const allCurrent = Object.fromEntries(cmp.fields.map((f) => [f.id, 'current']));
    assert.deepEqual(fineprint(cmp, 'mix', null, allCurrent).Risks, data.result.plans.current.risks);
  });

  it('splits the notes into the ones about one field and the rest', () => {
    assert.equal(cmp.notes.byField.f1.gaps.length, 2);
    assert.match(cmp.notes.byField.f3.review[0], /^North draw is sloped/);
    assert.ok(cmp.notes.farm.gaps.every((g) => !/^(Home place|West 140|North draw|South 40|East place): /.test(g)));
  });

  it('mixedPlan never changes its input', () => {
    const before = JSON.stringify(data.result.plans);
    const choice = { f1: 'current', f2: 'maxProfit' };
    const mix = mixedPlan(data.result.plans, choice);
    mix.sequences.f1[0].main = 'oats';
    mix.sequences.f3.push({ main: 'oats' });
    assert.equal(JSON.stringify(data.result.plans), before);
    assert.deepEqual(choice, { f1: 'current', f2: 'maxProfit' });
    assert.equal(mixedPlan(data.result.plans, choice).sequences.f1[0].main, 'corn');
  });

  it('checks the mix again (a neighbour season can change a warning)', () => {
    const choice = { f3: 'current' };
    const f3 = viewField(cmp, 'f3', 'mix', choice);
    assert.equal(f3.kind, 'current');
    assert.deepEqual(f3.seasons.map((s) => s.worst), viewField(cmp, 'f3', 'current').seasons.map((s) => s.worst));
    assert.deepEqual(viewField(cmp, 'f2', 'mix', choice).seasons.map((s) => s.crop), ['soybeans', 'corn', 'soybeans']);
  });
});

describe('the weather on the demo farm (no wheat)', () => {
  let cmp;
  before(() => { cmp = compareFutures(demoData(['profit']), { startYear: START_YEAR }); });

  it('reads the weather risk and the farm facts', () => {
    assert.equal(cmp.weatherRisk.waterLimited, false);
    assert.equal(cmp.weatherRisk.aridityClass, 'humid');
    assert.deepEqual(cmp.facts, { state: 'IA', irrigated: false });
  });

  it('has no freeze anywhere, so no frost stop and no frost marks', () => {
    for (const f of cmp.fields) for (const k of KINDS) for (const s of f.byKind[k].seasons) {
      assert.equal(s.freeze, null);
      assert.ok(!s.warnings.some((w) => w.lens === 'frost'));
    }
    assert.equal(frostStop(cmp), null);
    assert.ok(!reelStops(cmp).some((s) => s.id === 'frost' || s.id === 'dry'));
    for (const y of [0, 1, 2]) assert.equal(frostIds(cmp, 'priority', y).size, 0);
  });

  it('shows no dry fields on a humid farm, and some where water is the worry', () => {
    for (const y of [0, 1, 2]) assert.equal(dryIds(cmp, 'priority', y).size, 0);
    const dry = { ...cmp, weatherRisk: { ...cmp.weatherRisk, waterLimited: true } };
    assert.ok(dryIds(dry, 'priority', 0).size > 0);
  });
});

describe('the wheat demo (can’t grow soybeans): a spring freeze in 2028', () => {
  let data, cmp;
  before(() => {
    data = wheatData();
    cmp = compareFutures(data, { startYear: START_YEAR });
  });

  it('sows winter wheat for 2028 on Home place, West 140 and East place, and reads its freeze', () => {
    for (const f of cmp.fields) {
      const s = f.byKind.priority.seasons[1];
      const wheat = ['f1', 'f2', 'f5'].includes(f.id);
      assert.equal(s.crop, wheat ? 'winter-wheat' : 'corn', f.id);
      if (!wheat) { assert.equal(s.freeze, null, f.id); continue; }
      assert.deepEqual([s.freeze.years, s.freeze.of, s.freeze.stage], [13, 24, 'tillering']);
      near(s.freeze.bu, -2.74, 0.02, 'freeze bu/ac');
      const fw = s.warnings.find((w) => w.lens === 'frost');
      assert.equal(fw.severity, 1, 'about 5%: a Note');
      assert.equal(fw.reason, s.freeze.label);
    }
    for (const f of cmp.fields) for (const y of [0, 2]) assert.equal(f.byKind.priority.seasons[y].freeze, null);
    for (const k of ['current', 'maxProfit']) for (const f of cmp.fields) assert.ok(f.byKind[k].seasons.every((s) => !s.freeze), k);
  });

  it('knows which fields have frost, and where the walk stops for it', () => {
    assert.deepEqual([...frostIds(cmp, 'priority', 1)].sort(), ['f1', 'f2', 'f5']);
    assert.equal(frostIds(cmp, 'priority', 0).size, 0);
    assert.equal(frostIds(cmp, 'current', 1).size, 0);
    assert.deepEqual(frostStop(cmp), { season: 1, ids: ['f1', 'f2', 'f5'] });
    const stops = reelStops(cmp);
    assert.deepEqual(stops.map((s) => s.id).slice(-4), ['why', 'frost', 'watch', 'yourTurn']);
    const frost = stops.find((s) => s.id === 'frost');
    assert.deepEqual(
      [frost.view, frost.season, frost.camera, frost.marksBase, frost.frostLens, frost.noFocus, frost.growStagger, frost.fieldId],
      ['priority', 1, 'overview', null, true, true, 0, undefined],
    );
    // among warnings of the same severity, frost leads after water and before market, rotation, shade and nitrogen
    assert.equal(headline([{ lens: 'frost', severity: 1 }, { lens: 'nitrogen', severity: 1 }]).lens, 'frost');
    assert.equal(headline([{ lens: 'frost', severity: 1 }, { lens: 'water', severity: 1 }]).lens, 'water');
  });

  it('keeps the freeze in the mix, after checking the mix again', () => {
    const choice = { f3: 'current' };
    const s = viewField(cmp, 'f1', 'mix', choice).seasons[1];
    assert.ok(s.freeze);
    assert.equal(s.warnings.filter((w) => w.lens === 'frost').length, 1);
    assert.deepEqual([...frostIds(cmp, 'mix', 1, choice)].sort(), ['f1', 'f2', 'f5']);
    assert.deepEqual([...frostIds(cmp, 'mix', 1, { f1: 'current' })].sort(), ['f2', 'f5']);
  });

  it('a Kansas-like copy: one field, a Careful, a field stop, and a dry stop', () => {
    const ks = kansasLike(cmp);
    assert.deepEqual(frostStop(ks), { season: 1, ids: ['f1'] });
    const s = ks.fields[0].byKind.priority.seasons[1];
    assert.equal(s.warnings.find((w) => w.lens === 'frost').severity, 2);
    const stops = reelStops(ks);
    const frost = stops.find((x) => x.id === 'frost');
    assert.deepEqual([frost.camera, frost.fieldId], ['field', 'f1']);
    assert.deepEqual(stops.map((x) => x.id).slice(-5), ['why', 'frost', 'dry', 'watch', 'yourTurn']);
    assert.ok(dryIds(ks, 'priority', 0).size > 0);
    assert.equal(dryIds(cmp, 'priority', 0).size, 0, 'the copy leaves the comparison as it is');
  });
});

describe('the soil-first plans', () => {
  it('shows the rye cover, its cost and its soil score', () => {
    const cmp = compareFutures(demoData(['soil-health', 'profit']), { startYear: START_YEAR });
    const s = viewField(cmp, 'f3', 'priority').seasons[2];
    assert.equal(s.crop, 'corn');
    assert.equal(s.cover, 'cereal-rye');
    assert.equal(s.key, 'corn'); // the island grows the summer crop; the cover shows as the dot
    assert.equal(s.coverCost, -37);
    assert.equal(s.coverName, 'Cereal rye');
    assert.equal(s.soil100, 76);
    assert.equal(s.coverMonths, 7);
    assert.equal(cmp.weights.top, 'soilHealth');
    assert.equal(cmp.weights.asked, 'soilHealth', 'the farmer put soil health first');
    assert.equal(seasonChanges(cmp, 'priority')[2].get('f4'), 'crop', 'a cover alone is a change');
  });
});

describe('farms of other sizes', () => {
  for (const n of [1, 15]) {
    it(`${n} field${n === 1 ? '' : 's'}: no throw, at most 9 stops`, () => {
      const data = clonedData(demoData(['profit']), n);
      const cmp = compareFutures(data, { startYear: START_YEAR });
      assert.equal(cmp.fields.length, n);
      const stops = reelStops(cmp);
      assert.ok(stops.length <= 9 && stops[0].id === 'intro' && stops[stops.length - 1].id === 'yourTurn');
      const coins = coinPlan(cmp);
      for (const k of KINDS) for (const c of coins.counts[k].values()) assert.ok(c >= 0 && c <= 12);
      for (const y of [0, 1, 2]) flagsFor(cmp, 'mix', { [cmp.fields[0].id]: 'current' }, y);
    });
  }
  it('needs the first season', () => {
    assert.throws(() => compareFutures(demoData(['profit'])), /startYear/);
  });
});

describe('Monte Carlo numbers on the demo (planner 7f805d2, seed 1): re-pin on re-vendor', () => {
  // The farm totals (cash over 3 seasons, the bad year, beats keeping going, the price of
  // priorities, a scored mix) come from the planner's seeded Monte Carlo, so any change to the
  // planner's random draws moves them. They are pinned only here; the tests above check which way
  // they go. On a re-vendor: run this block, check the new numbers make sense, and pin them.
  let data, cmp;
  before(() => {
    data = demoData(['profit']);
    cmp = compareFutures(data, { startYear: START_YEAR });
  });

  it('the three plans', () => {
    const want = {
      current: { expectedGM: 349948, p10GM: 183182, beats: null },
      maxProfit: { expectedGM: 416354, p10GM: 261440, beats: 0.885 },
      priority: { expectedGM: 407813, p10GM: 263359, beats: 0.975 },
    };
    for (const [k, w] of Object.entries(want)) {
      near(cmp.totals[k].expectedGM, w.expectedGM, 1, `${k} cash`);
      near(cmp.totals[k].p10GM, w.p10GM, 1, `${k} bad year`);
      assert.equal(cmp.totals[k].probBeatsCurrent, w.beats, `${k} beats keeping going`);
    }
    const [cash, bad, , beats] = tiles(cmp, 'priority');
    near(cash.diff, 57865, 1, 'cash diff');
    near(bad.diff, 80177, 1, 'bad year diff');
    assert.equal(beats.value, 98);
  });

  it('the price of the farmer’s priorities', () => {
    near(cmp.price.cash, -8540.2, 1, 'cash given up');
    near(cmp.price.p10, 1919, 1, 'bad year');
  });

  it('a mix: Home place keeps going', () => {
    const choice = { f1: 'current' };
    const mix = data.evaluate(mixedPlan(data.result.plans, choice));
    const t = tiles(cmp, 'mix', mix, choice);
    near(t[0].value, 387943, 1, 'mix cash');
    near(t[0].diff, 37995, 1, 'mix diff');
    assert.equal(t[3].value, 93);
    near(tiles(cmp, 'mix', mix)[0].value, 387943, 1, 'a score with no choice is the mix’s');
  });

  it('soil first', () => {
    const soil = compareFutures(demoData(['soil-health', 'profit']), { startYear: START_YEAR });
    near(soil.totals.priority.expectedGM, 387767, 1, 'soil-first pick');
    near(soil.price.cash, -28586.8, 1, 'cash given up');
    near(soil.price.p10, -18127.2, 1, 'bad year');
  });

  it('the wheat’s spring freeze at Ames: 13 of 24 years', () => {
    const wheat = compareFutures(wheatData(), { startYear: START_YEAR });
    const fz = frostStop(wheat);
    const s = wheat.fields.find((f) => f.id === fz.ids[0]).byKind.priority.seasons[fz.season];
    assert.deepEqual([s.freeze.years, s.freeze.of], [13, 24]);
    assert.ok(wheat.raw.priority.risks.includes('Freeze risk: in 13 of 24 years, temperatures fell below the tillering threshold (K-State C646).'));
  });
});
