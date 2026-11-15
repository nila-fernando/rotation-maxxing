// The weather the planner counts, read off its plans and said in Manami's words: the wheat's
// spring freeze, the farm's weather risk and the field check-up's captions, on the wheat demo
// (test/futuresDemo.mjs: the demo farm for a farmer who can't grow soybeans).
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { wheatData, demoData, START_YEAR } from '../../test/futuresDemo.mjs';
import {
  FREEZE_EVENT, FREEZE_TERM, FROST_CAREFUL_PCT, STAGE_WORD, fieldWeatherNote, freezeOf, frostCaveat, frostNumbers, frostWarning, weatherRiskLine, weatherKey,
} from './weatherWords.js';
import { lintLine } from './futuresVoice.js';
import { LENS_ICONS } from '../ui/futureIcons.js';

const near = (actual, expected, tol, what) => assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} not within ${tol} of ${expected}`);
const EMOJI = /\p{Extended_Pictographic}/u;

const HUMID = 'Water isn’t the big weather worry here. Wet springs, floods and wind matter more, and I can’t count most of those yet.';
const CHECK = 'My frost rule comes from Kansas, so check it with someone who grows wheat near you.';

describe('the wheat’s spring freeze', () => {
  let data, year;
  before(() => {
    data = wheatData();
    year = data.result.plans.priority.paddocks.find((p) => p.paddockId === 'f1').years[1];
  });

  it('reads the planner’s freeze term and the wheat price', () => {
    const fz = freezeOf(year.terms, year.yieldPerAcre);
    assert.deepEqual([fz.years, fz.of, fz.stage], [6, 24, 'tillering']);
    near(fz.bu, -2.80, 0.02, 'bu/ac');
    near(fz.pct, 5.5, 0.1, '% of the crop');
    near(fz.cashAc, -14.8, 0.2, '$/ac');
    assert.match(fz.label, FREEZE_TERM);
    assert.equal(FREEZE_TERM.exec(fz.label)[4], 'heading', 'the worst freeze’s stage');
    assert.deepEqual(frostNumbers(fz), [['Spring freezes', '6 of 24 springs'], ['Freeze cut', '−2.8 bu/ac, about −$15/ac']]);
  });

  it('reads the freeze term in the older planner’s words too', () => {
    const m = FREEZE_TERM.exec('Freeze risk: in 2 of 4 years, temperatures fell below the jointing threshold (K-State C646); average effect');
    assert.deepEqual(m.slice(1), ['2', '4', 'jointing', undefined]);
    const n = FREEZE_TERM.exec('Freeze risk: in 3 of 24 years, temperatures fell to or below the jointing threshold (K-State C646); average effect');
    assert.deepEqual(n.slice(1), ['3', '24', 'jointing', undefined]);
  });

  it('gives null with no freeze term', () => {
    const corn = data.result.plans.priority.paddocks.find((p) => p.paddockId === 'f1').years[0];
    assert.equal(freezeOf(corn.terms, corn.yieldPerAcre), null);
    assert.equal(freezeOf([], 50), null);
    assert.equal(freezeOf(undefined, 50), null);
    assert.equal(freezeOf([{ label: 'Freeze risk: in 2 of 4 years, temperatures fell below the jointing threshold (K-State C646); average effect', value: NaN }], 50), null);
    assert.deepEqual(frostNumbers(null), []);
  });

  it('reads one weather year’s freeze too', () => {
    const label = 'Spring freeze at jointing (23 F on 04-12, injury below 24 F, K-State C646: moderate to severe; design range x0.5-0.9)';
    const m = FREEZE_EVENT.exec(label);
    assert.deepEqual(m.slice(1), ['jointing', '23', '04-12', '24', 'moderate to severe']);
    const fz = freezeOf([{ label, value: -6 }, { label: 'Effective Winter wheat price', value: 5.3 }], 44);
    assert.deepEqual([fz.years, fz.of, fz.stage], [null, null, 'jointing']);
    near(fz.pct, 12, 0.01, '% of the crop');
    near(fz.cashAc, -31.8, 0.01, '$/ac');
  });

  it('is a Note under 10% and a Careful from 10%', () => {
    assert.equal(FROST_CAREFUL_PCT, 10);
    assert.equal(frostWarning({ pct: 9.9, label: 'x' }).severity, 1);
    assert.equal(frostWarning({ pct: 10, label: 'x' }).severity, 2);
    assert.deepEqual(frostWarning({ pct: 5, label: 'Freeze risk: …' }), { lens: 'frost', severity: 1, reason: 'Freeze risk: …', app: true });
    assert.equal(frostWarning(null), null);
  });

  it('says the stage as a farmer sees it', () => {
    assert.equal(STAGE_WORD.tillering, 'while it was still short and leafy');
    assert.equal(STAGE_WORD.jointing, 'as its stems began to grow');
  });
});

describe('the Kansas caveat', () => {
  it('in each case', () => {
    // the planner counts from green-up (warm days), so she no longer says it may count dormant nights
    assert.equal(frostCaveat('KS'), null);
    assert.equal(frostCaveat('IA'), CHECK);
    assert.equal(frostCaveat(null), CHECK);
  });
});

describe('the weather risk line', () => {
  it('in every case', () => {
    assert.equal(weatherRiskLine({ waterLimited: false }), HUMID);
    assert.equal(weatherRiskLine({ waterLimited: false }, { wheat: true }), `${HUMID} I do count spring freezes on wheat.`);
    assert.equal(weatherRiskLine({ waterLimited: true }), 'Water is the big weather worry here, since the rain falls short of what crops could use. So dry years are the ones to plan for.');
    assert.equal(weatherRiskLine({ waterLimited: true }, { irrigated: true }), 'Water is the big weather worry here, since the rain falls short of what crops could use. Your fields are watered, so the real worry is your water supply.');
    assert.equal(weatherRiskLine({ waterLimited: null }), 'I couldn’t get real weather here, so I can’t say what the big weather worry is.');
    assert.equal(weatherRiskLine(null), weatherRiskLine({ waterLimited: null }));
  });

  it('reads the demo farm as humid', () => {
    assert.equal(weatherRiskLine(demoData(['profit']).result.plans.priority.weatherRisk), HUMID);
  });
});

describe('the field check-up’s weather captions', () => {
  it('on the wheat demo', () => {
    const data = wheatData();
    const f1 = fieldWeatherNote(data, 'f1', { startYear: START_YEAR });
    assert.equal(f1.water, HUMID);
    assert.equal(f1.frost, `In my pick this field grows winter wheat for the 2028 harvest. In 6 of 24 springs here, a night got cold enough to hurt it. ${CHECK}`);
    assert.deepEqual(fieldWeatherNote(data, 'f3', { startYear: START_YEAR }), { water: HUMID, frost: null });
    assert.deepEqual(fieldWeatherNote(demoData(['profit']), 'f1', { startYear: START_YEAR }), { water: HUMID, frost: null });
    assert.deepEqual(fieldWeatherNote(null, 'f1', { startYear: START_YEAR }), { water: weatherRiskLine(null), frost: null });
  });

  // a dry farm's plans, by hand: water-limited, the farm planned as dryland
  const dryData = (terms = []) => ({
    result: { plans: { priority: { weatherRisk: { waterLimited: true }, objectiveTerms: terms, paddocks: [] } } },
    farm: { constraints: { irrigation: 'dryland' }, paddocks: [] },
  });
  const DRY = 'Water is the big weather worry here, since the rain falls short of what crops could use.';

  it('on a partly watered farm: a watered field hears that the plans take it as dryland for now', () => {
    assert.equal(fieldWeatherNote(dryData(), 'f1').water, `${DRY} So dry years are the ones to plan for.`);
    assert.equal(fieldWeatherNote(dryData(), 'f1', { irrigated: true }).water, `${DRY} This field is watered, but until every field is, I plan the whole farm as dryland. So dry years are the ones to plan for.`);
    const all = { ...dryData(), farm: { constraints: { irrigation: 'irrigated' }, paddocks: [] } };
    assert.equal(fieldWeatherNote(all, 'f1', { irrigated: true }).water, `${DRY} Your fields are watered, so the real worry is your water supply.`);
  });

  it('just under the dry line, where the planner calls water plentiful, she says so too', () => {
    const edge = dryData([{ label: 'Water is plentiful here (aridity index 0.64), so water use counts for little', value: 0 }]);
    assert.equal(fieldWeatherNote(edge, 'f1').water, HUMID);
    assert.equal(weatherRiskLine({ waterLimited: true }, { plentiful: true }), HUMID);
  });

  it('weatherKey: what the captions hang on (watered or not, the state, each field’s ground), not the names', () => {
    const farm = demoData(['profit']).farm;
    const key = weatherKey(farm);
    const renamed = structuredClone(farm);
    renamed.paddocks[0].name = 'Somewhere else';
    assert.equal(weatherKey(renamed), key);
    const watered = structuredClone(farm);
    watered.constraints.irrigation = 'irrigated';
    assert.notEqual(weatherKey(watered), key);
    const jarred = structuredClone(farm);
    jarred.paddocks[1].land = { ...jarred.paddocks[1].land, texture: 'sandy loam' };
    assert.notEqual(weatherKey(jarred), key);
    const fewer = structuredClone(farm);
    fewer.paddocks.pop();
    assert.notEqual(weatherKey(fewer), key);
    assert.equal(weatherKey(null), '');
  });
});

describe('the weather lines in Manami’s voice, and the frost icon', () => {
  it('every line passes the voice rules', () => {
    const data = wheatData();
    const lines = [
      ...[false, true].flatMap((wheat) => [false, true].flatMap((irrigated) => [true, false, null].map((waterLimited) => weatherRiskLine({ waterLimited }, { wheat, irrigated })))),
      weatherRiskLine({ waterLimited: true }, { fieldWatered: true }),
      ...['KS', 'IA', null].map((st) => frostCaveat(st)),
      ...['f1', 'f2', 'f3', 'f4', 'f5'].flatMap((id) => Object.values(fieldWeatherNote(data, id, { startYear: START_YEAR }))),
    ].filter((s) => s != null);
    for (const line of lines) assert.deepEqual(lintLine(line), [], line);
  });

  it('draws the frost as a 24×24 snowflake, in the text colour', () => {
    const svg = LENS_ICONS.frost;
    assert.match(svg, /^<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"/);
    assert.match(svg, /stroke="currentColor"/);
    assert.doesNotMatch(svg, EMOJI);
  });
});
