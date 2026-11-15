import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getFields } from '../data/farmData.js';
import { copyPlan, createChecker, emptyCount, emptyPlan, isComplete, setCell, setCover, summarise, worst } from './builder.js';
import { plannerFarm, plannerMarket } from './farmInput.js';
import { fieldData } from '../../test/fieldData.mjs';
import { demoMarket } from '../../test/marketFixture.mjs';

const fields = getFields().map((f) => ({
  id: f.id, name: f.name, acres: f.acres, geometry: f.geometry, sourceIds: [f.sourceId],
  crops: Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])), ...fieldData(f),
}));
const { farm } = plannerFarm({ market: demoMarket, fields, place: { lat: 42.03, demo: true }, firstSeason: 2027 });
const market = plannerMarket(demoMarket);

describe('editing a plan', () => {
  it('starts empty, fills, clears, and never changes the plan it was given', () => {
    const a = emptyPlan(farm);
    assert.equal(emptyCount(a, farm), 15);
    assert.equal(isComplete(a, farm), false);
    const b = setCell(a, 'f1', 0, 'corn');
    assert.equal(a.sequences.f1[0].main, null); // unchanged
    assert.equal(b.sequences.f1[0].main, 'corn');
    assert.equal(emptyCount(b, farm), 14);
    assert.equal(setCell(b, 'f1', 0, null).sequences.f1[0].main, null);
  });
  it('covers go on after a crop, and come off when the season is cleared or made fallow', () => {
    let p = setCell(emptyPlan(farm), 'f2', 1, 'corn');
    p = setCover(p, 'f2', 1, 'cereal-rye');
    assert.equal(p.sequences.f2[1].cover, 'cereal-rye');
    assert.equal(setCell(p, 'f2', 1, 'soybeans').sequences.f2[1].cover, 'cereal-rye'); // a new crop keeps it
    assert.equal(setCell(p, 'f2', 1, 'fallow').sequences.f2[1].cover, undefined);
    assert.equal(setCover(p, 'f2', 1, null).sequences.f2[1].cover, undefined);
    assert.equal(setCover(emptyPlan(farm), 'f2', 1, 'cereal-rye').sequences.f2[1].cover, undefined); // nothing to cover
  });
  it('a kept plan drops crops the farmer has since ruled out (and fields that are gone)', () => {
    const { farm: noOats } = plannerFarm({ market: demoMarket, fields, place: { lat: 42.03, demo: true }, profile: { excludedCrops: ['oats'] }, firstSeason: 2027 });
    const c = copyPlan({ sequences: { f1: [{ main: 'oats' }, { main: 'corn', cover: 'cereal-rye' }, { main: 'fallow' }], gone: [{ main: 'corn' }] } }, noOats);
    assert.deepEqual(c.sequences.f1.map((s) => s.main), [null, 'corn', 'fallow']);
    assert.equal(c.sequences.f1[1].cover, 'cereal-rye');
    assert.equal(c.sequences.gone, undefined);
  });
  it('copies a planner plan onto the farm, filling any gaps', () => {
    const c = copyPlan({ sequences: { f1: [{ main: 'corn' }, { main: 'soybeans', cover: 'cereal-rye' }, { main: 'corn' }] } }, farm);
    assert.deepEqual(c.sequences.f1.map((s) => s.main), ['corn', 'soybeans', 'corn']);
    assert.equal(c.sequences.f1[1].cover, 'cereal-rye');
    assert.equal(c.sequences.f2[0].main, null);
  });
});

describe('instant checks', () => {
  const check = createChecker(farm, market);
  it('flags corn on corn on corn (repeat and pests) and is quiet about a rotation', () => {
    // East place (f5) has grown corn every year
    const w = check.at(emptyPlan(farm), 'f5', 0, 'corn');
    assert.ok(w.some((x) => x.lens === 'repeat' && x.severity >= 2), JSON.stringify(w));
    assert.ok(w.some((x) => x.lens === 'pest'), JSON.stringify(w));
    assert.ok(worst(check.at(emptyPlan(farm), 'f5', 0, 'soybeans')) < worst(w));
  });
  it('flags a crop the farmer said they can\'t grow as avoid', () => {
    const { farm: noOats } = plannerFarm({ market: demoMarket, fields, place: { lat: 42.03, demo: true }, profile: { excludedCrops: ['oats'] }, firstSeason: 2027 });
    const w = createChecker(noOats, market).at(emptyPlan(noOats), 'f1', 0, 'oats');
    assert.equal(worst(w), 3);
  });
  it('checks every filled season of a whole plan, fast', () => {
    let p = emptyPlan(farm);
    for (const f of farm.paddocks) for (let y = 0; y < 3; y++) p = setCell(p, f.id, y, y % 2 ? 'soybeans' : 'corn');
    const t0 = performance.now();
    const all = check.all(p);
    const ms = performance.now() - t0;
    assert.equal(all.size, 15);
    assert.ok(ms < 200, `${ms} ms for 15 seasons`);
  });
  it('summaries', () => {
    assert.equal(summarise([{ severity: 2 }, { severity: 1 }, { severity: 2 }]), '2 careful, 1 note');
    assert.equal(summarise([{ severity: 1 }, { severity: 3 }, { severity: 1 }]), '1 to avoid, 2 notes');
    assert.equal(summarise([]), '');
  });
});

describe('the timing lens (opt-in)', () => {
  const place = { state: 'IA', fips: '19169' };
  const timed = createChecker(farm, market, { timing: place });
  const plain = createChecker(farm, market);
  it('wheat sown right after corn clashes with the last day for full insurance: Careful', () => {
    // East place (f5) grew corn last season
    const w = timed.at(emptyPlan(farm), 'f5', 0, 'winter-wheat');
    const t = w.find((x) => x.lens === 'timing');
    assert.ok(t, JSON.stringify(w));
    assert.equal(t.severity, 2);
    assert.equal(t.reason, 'Corn comes off around mid October, and the last day for full insurance on wheat in most of Iowa is Oct 20. That’s too tight. Wheat fits better after oats.');
  });
  it('wheat after beans is tight (a Note); corn after beans has no timing warning', () => {
    let p = setCell(emptyPlan(farm), 'f5', 0, 'soybeans');
    const t = timed.at(p, 'f5', 1, 'winter-wheat').find((x) => x.lens === 'timing');
    assert.equal(t.severity, 1);
    assert.match(t.reason, /right at the end of wheat’s best window/);
    p = setCell(p, 'f5', 1, 'corn');
    assert.ok(!timed.at(p, 'f5', 1, 'corn').some((x) => x.lens === 'timing'));
  });
  it('is off unless asked for, so the plans’ own warnings don’t move', () => {
    assert.ok(!plain.at(emptyPlan(farm), 'f5', 0, 'winter-wheat').some((x) => x.lens === 'timing'));
    const p = setCell(emptyPlan(farm), 'f5', 0, 'winter-wheat');
    assert.ok(![...plain.all(p).values()].flat().some((x) => x.lens === 'timing'));
  });
});
