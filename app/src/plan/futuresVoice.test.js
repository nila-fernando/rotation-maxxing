// Manami's words for the plan views, on the demo farm's real plans (test/futuresDemo.mjs): the
// exact demo lines, the voice rules on every line she can say, and a phrase for every warning and gap.
// Money from the planner's Monte Carlo (the farm totals, the price, a mix) is built from cmp, so a
// re-vendor only re-pins compareFutures.test.js; the wording stays pinned here word for word.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { demoData, clonedData, coverPickData, kansasLike, wheatData, START_YEAR } from '../../test/futuresDemo.mjs';
import { KINDS, compareFutures, frostIds, mixedPlan, reelStops, viewField, waterWorry } from './compareFutures.js';
import {
  GAP_PHRASE, STAGE_WORD, allLines, captionLine, coverLine, dryLine, farmRiskLines, farmWeatherLine, fieldLine, flipLine, frostCaveat, frostLine, frostPeekLine,
  gapLines, giveUpLine, goodFitLine, lintLine, mixLine, nCarriedLine, nLine, pickedLine, priceLine, reelLine, saveLabel, seasonLabel, sevPhrase,
  skipHintLine, statusLine, tipFor, vsProfitLine, warnCtx, warnEntry, warnLine, watchItems, watchLine, watchRows, weatherLine, weatherRiskLine,
  weightsLine,
} from './futuresVoice.js';
import { ALL_ICONS } from '../ui/futureIcons.js';
import { money, moneyAbout } from '../ui/money.js';

/** Monte Carlo money as Manami says it: "$58k". */
const k = (v) => moneyAbout(Math.abs(v));

const EMOJI = /\p{Extended_Pictographic}/u;

describe('Manami’s lines on the demo farm (profit first)', () => {
  let data, cmp, mix;
  const choice = { f1: 'current' };
  before(() => {
    data = demoData(['profit']);
    cmp = compareFutures(data, { startYear: START_YEAR });
    mix = data.evaluate(mixedPlan(data.result.plans, choice));
  });

  it('walks the demo word for word', () => {
    const said = Object.fromEntries(reelStops(cmp).map((s) => [s.id, reelLine(cmp, s)]));
    const t = cmp.totals;
    assert.deepEqual(said, {
      intro: 'This is 2027 if you keep going. Home place, West 140 and East place grow corn again.',
      flip: `Here’s my pick. It changes 3 fields in 2027. Over 3 seasons it earns about ${k(t.priority.expectedGM - t.current.expectedGM)} more, and beats keeping going in ${Math.round(t.priority.probBeatsCurrent * 100)}% of the weather years I tried.`,
      handoff: 'In 2028 Home place goes to corn after the beans. It gets their nitrogen, about $20 an acre less to buy.',
      repeat: 'North draw grows corn once more in 2027. Watch for rootworm that year.',
      gain: 'West 140 gains the most, about $25k over 3 seasons. Soybeans here in 2027 earn about $73 more an acre than more corn. The beans also leave nitrogen for the 2028 corn.',
      sameCrop: 'Same corn on Home place in 2028, but it earns about $57 more an acre. Corn after beans yields about 9 bu more than corn after corn.',
      giveUp: 'North draw is the one place my pick earns less, about $2k over 3 seasons. It ends on corn after beans, so its soil scores 70 in 2029 instead of 42. Careful: beans in 2028 leave this slope only about a quarter covered.',
      vsProfit: `The most-profit plan earns about ${k(t.maxProfit.expectedGM - t.priority.expectedGM)} more than mine. A bad year is about ${k(t.priority.p10GM - t.maxProfit.p10GM)} worse, and the soil ends 13 points lower.`,
      why: 'Profit matters most to you, so I gave it about two-thirds of the say and soil health the rest. Water’s plentiful here, so I left it out.',
      watch: 'Amber dots are what I’d watch most. In 2027, that’s rootworm on North draw and East place, where corn follows corn. Tap a field, or open Why and watch out for the full list.',
      yourTurn: 'Your turn. Tap a field to pick its plan, then press Use this plan.',
    });
    assert.equal(skipHintLine(cmp), 'Have a look round. West 140 changes the most. Start there if you like.');
  });

  it('says the walk’s repeat without rootworm, and nothing for a handoff that isn’t one', () => {
    const c = structuredClone(cmp);
    const s = c.fields.find((f) => f.id === 'f3').byKind.priority.seasons[0];
    s.warnings = s.warnings.filter((w) => w.lens !== 'pest');
    assert.equal(reelLine(c, { id: 'repeat', fieldId: 'f3', season: 0 }), 'North draw grows corn once more in 2027. So I expect a little less yield that year.');
    assert.equal(reelLine(cmp, { id: 'handoff', fieldId: 'f1', season: 0 }), null, 'beans after corn get no credit');
    assert.equal(reelLine(cmp, { id: 'repeat' }), null);
  });

  it('says the Notes lines', () => {
    assert.equal(priceLine(cmp.price), `Next to the most-profit plan, mine gives up about ${k(cmp.price.cash)} of cash and $5k of nitrogen left in the ground. In return a bad year is ${k(cmp.price.p10)} better, and the soil scores 4 points higher on average. It uses a little more water, about 0.4 in a season.`);
    assert.equal(nLine(cmp, 'priority'), 'Corn follows beans 6 times in my pick, and each time it saves about $20 an acre of nitrogen.');
    assert.equal(nCarriedLine(cmp, 'priority'), 'It also leaves about $5k of nitrogen in the ground for 2030. That isn’t cash, so I don’t count it.');
    assert.equal(weatherLine(cmp.weather), 'I tried each plan against 24 years of real weather from Ames, Iowa.');
    assert.equal(captionLine(10000), 'Each coin is about $10k over 3 seasons. A bad year is farm-wide; I can’t split it by field.');
    const rows = watchRows(cmp, 'priority').map((r) => r.text);
    assert.ok(rows.includes('North draw · 2027 · Careful: corn on corn usually needs rootworm control.'), rows.join('\n'));
    assert.deepEqual(watchRows(cmp, 'priority').map((r) => `${r.id}:${r.season}`), ['f1:2', 'f2:2', 'f3:0', 'f3:1', 'f4:1', 'f5:0']);
  });

  it('says the card, the tooltip and the picks', () => {
    assert.equal(fieldLine(cmp, 'f2', 'priority'), 'My pick grows soybeans, corn, then soybeans here. That earns about $25k more than keeping going.');
    assert.equal(fieldLine(cmp, 'f4', 'priority'), 'South 40 already turns corn and beans, so all three plans leave it be.');
    assert.equal(fieldLine(cmp, 'f3', 'priority'), 'My pick earns about $2k less here, but it ends on corn after beans.');
    assert.equal(fieldLine(cmp, 'f1', 'current'), 'Keeping going means corn all three seasons here.');
    assert.equal(coverLine(cmp, 'f2', 'priority'), null);
    assert.deepEqual(tipFor(cmp, 'f5', 'priority', 0), { title: 'East place · 2027: Corn', note: 'Careful: corn on corn usually needs rootworm control.', sev: 2 });
    assert.deepEqual(tipFor(cmp, 'f2', 'priority', 0), { title: 'West 140 · 2027: Soybeans', note: '$25k more than keeping going over 3 seasons.', sev: 0 });
    assert.equal(tipFor(cmp, 'f4', 'priority', 0).note, 'Same in all three plans.');
    assert.equal(pickedLine('Home place', 'current'), 'Got it: Home place keeps going.');
    assert.equal(pickedLine('Home place', 'maxProfit'), 'Got it: Home place goes for the most profit.');
    assert.equal(pickedLine('Home place', 'priority'), 'Got it: Home place goes with my pick.');
    assert.equal(mixLine(cmp, choice, mix), `Your plan: a mix of plans, about ${money(mix.expectedGM)} over 3 seasons.`);
    assert.equal(seasonLabel(cmp, 'priority', 0), '2027, about $132k, $16k more than keeping going.');
    const t = cmp.totals;
    assert.equal(statusLine(cmp, 'priority', 0), `Manami’s pick, 2027: 3 fields change. About ${money(t.priority.expectedGM)} over 3 seasons, ${k(t.priority.expectedGM - t.current.expectedGM)} more than keeping going. The island shows soybeans on Home place and West 140, and corn on North draw, South 40 and East place.`);
    assert.deepEqual(['current', 'maxProfit', 'priority', 'mix'].map(saveLabel), ['Use Keep going', 'Use Most profit', 'Use my pick', 'Use this plan']);
    const items = watchItems(cmp, 'f3', 'priority');
    assert.deepEqual(items.map((w) => `${w.year} · ${w.label}`).slice(0, 4), ['2027 · Careful', '2027 · Careful', '2027 · Note', '2028 · Careful']);
    assert.ok(items.some((w) => w.text === 'This field has a 6.8% slope, and soybeans leave only about a quarter of the ground covered.'));
  });

  it('phrases the gaps for the farm and for each field', () => {
    const g = gapLines(cmp);
    assert.deepEqual(g.byField.f1, ['I’ve taken 2026 to be corn here, since it isn’t on record yet.', 'The soil drains poorly, so I’ve taken it to be tile drained.']);
    assert.ok(g.byField.f3.includes('It’s worth asking NRCS about contour strips, terraces or more residue for the low-cover years.'));
    assert.ok(g.farm.includes('I’ve taken Home place, West 140 and East place to be tile drained.'));
    assert.ok(g.farm.includes('I don’t have 2026’s crops on record yet, so I’ve taken each field to follow its usual turn.'));
    assert.ok(g.farm.includes('I’m guessing how well soybeans handle shade.'));
    assert.ok(g.unmatched.some((s) => /^Crops to choose from/.test(s)), 'unknown gaps stay word for word');
  });

  it('every per-field gap has a phrase', () => {
    for (const d of [data, demoData(['soil-health', 'profit']), clonedData(data, 15)]) {
      const c = compareFutures(d, { startYear: START_YEAR });
      const g = gapLines(c);
      for (const f of c.fields) {
        for (const raw of [...c.notes.byField[f.id].gaps, ...c.notes.byField[f.id].review]) {
          const e = GAP_PHRASE.find((x) => x.re.test(raw));
          assert.ok(e && e.card, `${f.name}: no card phrase for "${raw}"`);
        }
        assert.ok(g.byField[f.id].length > 0, `${f.name} has a Good to know`);
      }
    }
  });

  it('priceLine says which way the water goes', () => {
    assert.match(priceLine({ ...cmp.price, waterIn: 0.36 }), /more water/);
    assert.match(priceLine({ ...cmp.price, waterIn: -0.36 }), /less water/);
    assert.equal(priceLine({ ...cmp.price, samePlan: true }), 'My pick is the most-profit plan here, so it costs you nothing.');
    // different crops but under $1k of cash and next to no nitrogen: it isn't the most-profit plan, so she doesn't say it is
    assert.equal(priceLine({ ...cmp.price, cash: -400, nCarried: 300, p10: 0, soilAvgPts: 0, waterIn: 0 }), 'My pick earns about as much as the most-profit plan, so it costs you next to nothing.');
    // without real weather the water number is a crop-water index, not inches
    assert.match(priceLine({ ...cmp.price, waterInches: false }), /It needs a little more water\.$/);
    assert.doesNotMatch(priceLine({ ...cmp.price, waterInches: false }), / in a season/);
  });

  it('keeps cash and nitrogen apart in the price', () => {
    // $4k of cash given up, $3.5k more nitrogen left: the planner's profitCost is only $500
    const p = { ...cmp.price, cash: -4000, nCarried: 3500, profitCost: 500, p10: 0, soilAvgPts: 0, waterIn: 0 };
    assert.equal(priceLine(p), 'Next to the most-profit plan, mine gives up about $4k of cash but leaves $4k more nitrogen in the ground.');
    assert.equal(priceLine({ ...p, cash: -300 }), 'My pick earns about as much cash as the most-profit plan, and leaves $4k more nitrogen in the ground.');
    assert.equal(priceLine({ ...p, cash: -300, nCarried: -3500 }), 'My pick earns about as much cash as the most-profit plan, but leaves $4k less nitrogen in the ground.');
    // the walk measures in cash, as the tiles do
    const c = structuredClone(cmp);
    c.totals.priority.expectedGM = c.totals.maxProfit.expectedGM - 4000;
    c.price = { ...c.price, profitCost: 500 };
    assert.match(vsProfitLine(c), /^The most-profit plan earns about \$4k more than mine\./);
    c.totals.priority.expectedGM = c.totals.maxProfit.expectedGM - 300;
    c.price.nCarried = 200;
    assert.equal(vsProfitLine(c), 'My pick earns about as much as the most-profit plan, so it costs you next to nothing.');
  });

  it('says the one place only when no other field earns less', () => {
    const c = structuredClone(cmp);
    c.fields.find((f) => f.id === 'f4').diff.priority = -400;
    assert.match(giveUpLine(c), /^North draw gives up the most on my pick, about \$2k over 3 seasons\./);
    assert.doesNotMatch(giveUpLine(c), /a little/);
  });

  it('never says a per-acre gain of $0', () => {
    const c = structuredClone(cmp);
    const f2 = c.fields.find((f) => f.id === 'f2');
    f2.byKind.priority.seasons[0].gmAc = f2.byKind.current.seasons[0].gmAc;
    assert.equal(reelLine(c, { id: 'gain' }), 'West 140 gains the most, about $25k over 3 seasons. Soybeans here in 2027 earn about as much an acre as more corn. The beans also leave nitrogen for the 2028 corn.');
  });

  it('says a Keep going cover crop as the farmer’s own', () => {
    const c = structuredClone(cmp);
    const s = c.fields.find((f) => f.id === 'f1').byKind.current.seasons[1];
    Object.assign(s, { cover: 'cereal-rye', coverCost: -37 });
    assert.equal(coverLine(c, 'f1', 'current'), `In 2028 you’d sow cereal rye after the corn to cover the ground over winter. It costs about $37 an acre, and the soil scores ${s.soil100} that season.`);
  });

  it('voices the farm-wide risks', () => {
    const fake = { ...cmp, raw: { ...cmp.raw, current: { ...cmp.raw.current, risks: ['In a bad run of years (P10) this plan loses $12,400 over 3 years.', 'Year 2: the farm grows more Corn (grain) than local buyers take; the rest sells at the distant price.', 'Home place, year 1: Corn rootworm: …'] } } };
    const r = farmRiskLines(fake, 'current');
    assert.deepEqual(r.lines, ['In a bad run of years this plan could lose about $12k over 3 seasons.', 'In 2028, the farm grows more corn than local buyers take.']);
    assert.deepEqual(r.unmatched, []);
  });
});

describe('the soil-first plans', () => {
  it('says the cover crop and the price', () => {
    const cmp = compareFutures(demoData(['soil-health', 'profit']), { startYear: START_YEAR });
    assert.equal(coverLine(cmp, 'f3', 'priority'), 'In 2029 I’d sow cereal rye after the corn to cover the ground over winter. It costs about $37 an acre, and the soil scores 76 that season.');
    assert.equal(reelLine(cmp, { id: 'why' }), 'Soil health matters most to you, so I gave it about half of the say and profit the rest. Water’s plentiful here, so I left it out.');
    assert.equal(priceLine(cmp.price), `Next to the most-profit plan, mine gives up about ${k(cmp.price.cash)} of cash and $5k of nitrogen left in the ground. In return the soil scores 6 points higher on average, but a bad year is ${k(cmp.price.p10)} worse. It uses a little more water, about 0.4 in a season.`);
    assert.equal(tipFor(cmp, 'f3', 'priority', 2).title, 'North draw · 2029: Corn + rye cover');
  });
});

describe('the say each priority got', () => {
  const w = (o) => weightsLine({ top: 'profit', topPct: 0, pcts: {}, waterPlentiful: true, asked: null, ...o });
  it('says what the farmer put first only when it got the most say', () => {
    assert.equal(w({ pcts: { profit: 68, soilHealth: 32, water: 0 }, asked: 'profit' }), 'Profit matters most to you, so I gave it about two-thirds of the say and soil health the rest. Water’s plentiful here, so I left it out.');
    // asked for soil health, but profit got more say: say it as what I did
    assert.equal(w({ pcts: { profit: 68, soilHealth: 32, water: 0 }, asked: 'soilHealth' }), 'I gave profit about two-thirds of the say and soil health the rest. Water’s plentiful here, so I left it out.');
    assert.equal(w({ pcts: { profit: 68, soilHealth: 32, water: 0 } }), 'I gave profit about two-thirds of the say and soil health the rest. Water’s plentiful here, so I left it out.');
  });
  it('leads with water when the farmer asked to save it and it’s plentiful', () => {
    assert.equal(w({ pcts: { profit: 50, soilHealth: 50, water: 0 }, asked: 'water' }), 'You asked me to save water, but water’s plentiful here, so I left it out. I gave profit and soil health about half of the say each.');
  });
  it('says a tie as a tie', () => {
    assert.equal(w({ pcts: { profit: 50, soilHealth: 50, water: 0 }, asked: 'soilHealth', waterPlentiful: false }), 'I gave soil health and profit about half of the say each.');
    assert.equal(w({ pcts: { profit: 40, soilHealth: 40, water: 20 }, waterPlentiful: false }), 'I gave profit and soil health about a third of the say each and water the rest.');
  });
  it('says low risk as bad years counting more', () => {
    assert.equal(w({ pcts: { profit: 68, soilHealth: 32, water: 0 }, asked: 'risk' }), 'You asked me to keep risk low, so I count a bad year more. I gave profit about two-thirds of the say and soil health the rest. Water’s plentiful here, so I left it out.');
  });
  it('on the water-first demo farm', () => {
    const cmp = compareFutures(demoData(['saving-water']), { startYear: START_YEAR });
    assert.equal(cmp.weights.asked, 'water');
    assert.doesNotMatch(reelLine(cmp, { id: 'why' }), /matters most to you/);
    assert.match(reelLine(cmp, { id: 'why' }), /^You asked me to save water, but water’s plentiful here, so I left it out\./);
    assert.deepEqual(lintLine(reelLine(cmp, { id: 'why' })), []);
  });
});

describe('a pick of covers alone', () => {
  it('says a cheap cover-only pick as a good fit, and names the covers', () => {
    const cmp = compareFutures(coverPickData(demoData(['profit']), { gain: -500 }), { startYear: START_YEAR });
    assert.deepEqual(reelStops(cmp).map((s) => s.id), ['intro', 'goodFit', 'yourTurn']);
    assert.equal(reelLine(cmp, { id: 'goodFit' }), 'Your rotation is already a good fit. My pick keeps your crops and only adds a winter cover on 5 fields, which costs under $1k over 3 seasons.');
  });
  it('says what a dear one costs and what it buys', () => {
    const cmp = compareFutures(coverPickData(demoData(['profit']), { gain: -15000, soilPts: 6 }), { startYear: START_YEAR });
    assert.equal(flipLine(cmp), 'Here’s my pick. It changes 5 fields in 2027. Over 3 seasons it earns about $15k less, and in return the soil ends 6 points higher and 5 fields get a winter cover.');
    for (const s of reelStops(cmp)) {
      const line = reelLine(cmp, s);
      if (line != null) assert.deepEqual(lintLine(line), [], line);
    }
    // every corn field keeps its corn: the walk's repeat is corn again, not "once more"
    const rep = reelStops(cmp).find((s) => s.id === 'repeat');
    assert.equal(reelLine(cmp, rep), 'Home place grows corn again in 2027. Watch for rootworm that year.');
    assert.equal(goodFitLine(compareFutures(demoData(['profit']), { startYear: START_YEAR })), 'Your rotation is already a good fit. My pick changes little over the 3 seasons.');
  });
});

describe('the weather: spring freezes on the wheat, and water', () => {
  let cmp, ks;
  before(() => {
    cmp = compareFutures(wheatData(), { startYear: START_YEAR });
    ks = kansasLike(cmp);
  });

  it('says the frost stop: 3 fields, 1 field, and under 1%', () => {
    const frost = reelStops(cmp).find((s) => s.id === 'frost');
    assert.equal(reelLine(cmp, frost), 'My pick sows winter wheat on Home place, West 140 and East place for the 2028 harvest. In 6 of 24 springs here, a night got cold enough to hurt it, so I take about 6% off. My frost rule comes from Kansas, so check it with someone who grows wheat near you.');
    assert.equal(frostLine(ks), 'My pick sows winter wheat on Home place for the 2028 harvest. In 2 of 4 springs here, a night got cold enough to hurt it, so I take about 11% off.');
    const light = structuredClone(ks);
    light.fields[0].byKind.priority.seasons[1].freeze.pct = 0.4;
    assert.equal(frostLine(light), 'My pick sows winter wheat on Home place for the 2028 harvest. In 2 of 4 springs here, a night got cold enough to hurt it, so I take a little off.');
    assert.equal(frostLine(compareFutures(demoData(['profit']), { startYear: START_YEAR })), null);
  });

  it('says the freeze as a farm risk, in her words, with the Kansas caveat', () => {
    const r = farmRiskLines(cmp, 'priority');
    assert.deepEqual(r.lines, ['In 6 of 24 springs here, a freeze got cold enough to hurt the wheat, most often while it was still short and leafy. The worst one hit it as the heads came out. My frost rule comes from Kansas, so check it with someone who grows wheat near you.']);
    assert.deepEqual(r.unmatched, []);
    assert.deepEqual(farmRiskLines(ks, 'priority').lines, ['In 2 of 4 springs here, a freeze got cold enough to hurt the wheat as its stems began to grow.']);
    assert.equal(STAGE_WORD.tillering, 'while it was still short and leafy');
  });

  it('says the freeze on the card, the tooltip and the Notes', () => {
    const line = 'Spring freezes can hurt the wheat. One got cold enough in 6 of 24 springs here, so I take about 6% off.';
    assert.ok(watchItems(cmp, 'f1', 'priority').some((w) => w.lens === 'frost' && w.year === 2028 && w.label === 'Note' && w.text === line));
    assert.equal(tipFor(cmp, 'f1', 'priority', 1).note, `Note: ${line.charAt(0).toLowerCase()}${line.slice(1)}`);
    assert.ok(watchRows(cmp, 'priority').some((r) => r.text === 'Home place · 2028 · Note: spring freezes can hurt the wheat. One got cold enough in 6 of 24 springs here, so I take about 6% off.'));
    const careful = watchItems(ks, 'f1', 'priority').find((w) => w.lens === 'frost');
    assert.deepEqual([careful.label, careful.text], ['Careful', 'Spring freezes can hurt the wheat. One got cold enough in 2 of 4 springs here, so I take about 11% off.']);
    // a season with frost as its only careful warning: the watch stop says it
    const only = structuredClone(ks);
    for (const f of only.fields) for (const e of Object.values(f.byKind)) for (const s of e.seasons) { s.warnings = s.warnings.filter((w) => w.lens === 'frost'); s.worst = s.warnings.length ? 2 : 0; }
    assert.equal(watchLine(only), 'Amber dots are what I’d watch most. In 2028, that’s spring freezes on the wheat on Home place. Tap a field, or open Why and watch out for the full list.');
  });

  it('labels the season radio, and says the freeze peek', () => {
    assert.equal(seasonLabel(cmp, 'priority', 1), '2028, about $61k, $57k less than keeping going. Frost risk on the wheat.');
    assert.doesNotMatch(seasonLabel(cmp, 'priority', 0), /Frost/);
    assert.doesNotMatch(seasonLabel(cmp, 'current', 1), /Frost/);
    assert.equal(frostPeekLine(cmp, 1, frostIds(cmp, 'priority', 1)), 'A spring freeze on the farm in 2028. It could hurt the wheat on Home place, West 140 and East place.');
  });

  it('says the freeze gap, and the water line in every case', () => {
    assert.ok(gapLines(cmp).farm.includes('Once the wheat greens up after a spring warm spell, I count a freeze when a night gets as cold as it can take. I use weather for the wider area, so low spots may get colder, and I don’t count snow cover.'));
    assert.deepEqual(gapLines(cmp).unmatched.filter((g) => /reeze/.test(g)), []);
    assert.equal(weatherRiskLine(cmp.weatherRisk, { wheat: true }), 'Water isn’t the big weather worry here. Wet springs, floods and wind matter more, and I can’t count most of those yet. I do count spring freezes on wheat.');
    assert.equal(frostCaveat('KS'), null);
  });

  it('says the dry stop where water is the worry', () => {
    const dry = reelStops(ks).find((s) => s.id === 'dry');
    assert.equal(reelLine(ks, dry), 'Water is the big weather worry here, so dry years are the ones to plan for. The drops show that my pick leaves every field short of water in 2027.');
    assert.equal(dryLine(ks, 1), 'Water is the big weather worry here, so dry years are the ones to plan for. The drops show that my pick leaves every field short of water in 2028.');
    assert.equal(dryLine(cmp, 1), null, 'a humid farm has no dry stop');
  });

  it('names the fields the dry stop and the season radios mean (the drops are hidden from screen readers)', () => {
    // only two fields short of water in 2027
    const two = structuredClone(ks);
    for (const f of two.fields) if (!['f1', 'f3'].includes(f.id)) for (const e of Object.values(f.byKind)) e.seasons[0].waterShort = 0;
    const [a, b] = ['f1', 'f3'].map((id) => two.fields.find((f) => f.id === id).name);
    assert.equal(dryLine(two, 0), `Water is the big weather worry here, so dry years are the ones to plan for. The drops show ${a} and ${b}, which my pick leaves short of water in 2027.`);
    assert.ok(seasonLabel(two, 'priority', 0).endsWith(` Short of water on ${a} and ${b}.`));
    assert.match(seasonLabel(ks, 'priority', 0), / Short of water on every field\.$/);
    assert.doesNotMatch(seasonLabel(cmp, 'priority', 0), /water/, 'not on a humid farm');
  });

  it('never calls water plentiful and the big worry in one walk (just under the dry line)', () => {
    // the planner: water-limited, but its weights call water plentiful (an aridity just under 0.65)
    const edge = { ...ks, weights: { ...ks.weights, waterPlentiful: true } };
    assert.equal(waterWorry(edge), false);
    assert.equal(dryLine(edge, 0), null);
    assert.ok(!reelStops(edge).some((s) => s.id === 'dry'));
    assert.match(farmWeatherLine(edge), /^Water isn’t the big weather worry here\./);
    assert.match(farmWeatherLine(ks), /^Water is the big weather worry here/);
  });
});

describe('the jar test in the gaps', () => {
  const JAR = 'West 140: soil texture from your jar test (clay loam, a sample jar) instead of the soil survey (silty clay loam).';
  const JAR_NO_SURVEY = 'Field 9: no soil survey yet, but soil texture from your jar test (loam), with typical drainage and water holding (0.17 in per inch) on a gentle slope.';
  const entry = (g) => GAP_PHRASE.find((x) => x.re.test(g));

  it('says a field’s jar test on its card, and for the farm', () => {
    assert.equal(entry(JAR).key, 'jar');
    assert.equal(entry(JAR).card(entry(JAR).re.exec(JAR)), 'Your jar test says clay loam here, so I planned with that instead of the soil map’s silty clay loam.');
    assert.equal(entry(JAR_NO_SURVEY).key, 'jarNoSurvey', 'not the plain no-survey line (“a typical loam”)');
    assert.equal(entry(JAR_NO_SURVEY).card(entry(JAR_NO_SURVEY).re.exec(JAR_NO_SURVEY)), 'I don’t have a soil survey here, so I used your jar test: loam.');
    assert.equal(entry(JAR).card(entry(JAR).re.exec('West 140: soil texture from your jar test (clay loam, adjusted by you) instead of the soil survey (silty clay loam).')), 'Your jar test says clay loam here, so I planned with that instead of the soil map’s silty clay loam.');
  });

  it('puts them on the right fields, in her voice', () => {
    const base = compareFutures(demoData(['profit']), { startYear: START_YEAR });
    const cmp = { ...base, gaps: [...base.gaps, JAR], notes: structuredClone(base.notes) };
    cmp.notes.byField.f2.gaps.push(JAR);
    const g = gapLines(cmp);
    assert.ok(g.byField.f2.includes('Your jar test says clay loam here, so I planned with that instead of the soil map’s silty clay loam.'));
    assert.ok(g.farm.includes('I’ve used your jar test for West 140 instead of the soil map.'));
    // a field the comparison doesn't know (Field 9) keeps its line farm-wide
    const lone = gapLines({ ...cmp, gaps: [...cmp.gaps, JAR_NO_SURVEY] });
    assert.ok(lone.farm.includes('I’ve used your jar test for Field 9 instead of the soil map.'));
    for (const line of [...g.farm, ...Object.values(g.byField).flat(), ...lone.farm]) assert.deepEqual(lintLine(line), [], line);
    for (const raw of [JAR, JAR_NO_SURVEY]) {
      const e = entry(raw), m = e.re.exec(raw);
      assert.deepEqual(lintLine(e.card(m)), []);
      assert.deepEqual(lintLine(e.farm([m])), []);
    }
  });
});

describe('the voice rules', () => {
  it('lintLine catches what Manami wouldn’t say', () => {
    assert.deepEqual(lintLine('Here’s my pick.'), []);
    assert.ok(lintLine("Here's my pick.").length);
    assert.ok(lintLine('Risk lambda 0.40 on paddock 2.').length);
    assert.ok(lintLine('It costs $12,349 in year 2.').length);
    assert.ok(lintLine('One. Two. Three. Four.').length);
    assert.ok(lintLine(`${'word '.repeat(25)}end.`).length);
    assert.ok(lintLine('That loses -$2k.').length);
    assert.ok(lintLine('Nice work \u{1F33D}').length);
  });

  it('speaks plainly: every line, both profiles, the mix, a good fit, 1 and 15 fields', () => {
    const profit = demoData(['profit']);
    const goodFit = { ...profit, result: { ...profit.result, plans: { ...profit.result.plans, priority: { ...profit.result.plans.current, kind: 'priority', probBeatsCurrent: 0.5 } } } };
    const farms = [profit, demoData(['soil-health', 'profit']), goodFit, clonedData(profit, 1), clonedData(profit, 15)];
    let n = 0;
    const wheat = wheatData();
    const cmps = [...farms, wheat].map((d) => ({ d, cmp: compareFutures(d, { startYear: START_YEAR }) }));
    // the Kansas-like copy has no planner to score a mix with
    cmps.push({ d: null, cmp: kansasLike(cmps[cmps.length - 1].cmp) });
    for (const { d, cmp } of cmps) {
      const choice = { [cmp.fields[0].id]: 'current', [cmp.fields[cmp.fields.length - 1].id]: 'maxProfit' };
      // the cloned farms can't be scored by the planner (their fields aren't the demo farm's)
      const mixScore = d && (d.farm === profit.farm || d === farms[1] || d === wheat) ? d.evaluate(mixedPlan(d.result.plans, choice)) : null;
      for (const line of [...allLines(cmp), ...allLines(cmp, { choice, mixScore }), ...reelStops(cmp).map((s) => reelLine(cmp, s))]) {
        if (line == null) continue;
        n++;
        assert.deepEqual(lintLine(line), [], line);
      }
    }
    assert.ok(n > 2000, `${n} lines checked`);
  });

  it('every warning has a phrase', () => {
    const cmps = [demoData(['profit']), demoData(['soil-health', 'profit']), clonedData(demoData(['profit']), 15), wheatData()]
      .map((d) => compareFutures(d, { startYear: START_YEAR }));
    cmps.push(kansasLike(cmps[3]));
    let frost = 0;
    for (const cmp of cmps) {
      const ids = cmp.fields.map((f) => f.id);
      const choice = { [ids[0]]: 'current', [ids[2]]: 'maxProfit' };
      for (const view of [...KINDS, 'mix']) {
        for (const f of cmp.fields) {
          viewField(cmp, f.id, view, choice).seasons.forEach((s, y) => {
            for (const w of s.warnings) {
              assert.ok(warnEntry(w), `no phrase for ${w.lens}: ${w.reason}`);
              if (w.lens === 'frost') { frost++; assert.notEqual(warnEntry(w).re.source, '(?:)', 'the freeze has its own phrase'); }
              const ctx = warnCtx(cmp, f.id, view, y, choice);
              assert.doesNotMatch(warnLine(w, ctx), /fine print/);
              assert.match(sevPhrase(w, ctx), /^(Note|Careful|Avoid): /);
            }
          });
        }
      }
    }
    assert.ok(frost > 0, 'the wheat farms have freeze warnings');
  });

  it('phrases the warnings the demo doesn’t have', () => {
    const ctx = { field: 'Back 80', crop: 'soybeans', prev: 'soybeans', drag: 0 };
    const say = (lens, reason, c = ctx) => warnLine({ lens, severity: 2, reason }, c);
    assert.equal(say('repeat', "Soybeans can't follow Soybeans: back-to-back hosts build up white mold."), 'Soybeans can’t follow soybeans, since back-to-back crops build up white mold.');
    assert.equal(say('nitrogen', 'Soybeans leaves about 35 lb N/ac that only counts if corn follows; next year is Oats.'), 'The beans leave nitrogen that next year’s crop won’t use.');
    assert.equal(say('shade', '3.1% of Back 80 is in noon shade from Corn on Home place to the south; the yield impact needs local checking.'), 'About 3% of the field is shaded at noon, which trims yield a little.');
    assert.equal(say('market', 'Planned soybeans in year 1 is about 9,000 bu; local buyers take 5,000, so 44% would sell at the distant price less freight.'), 'Local buyers may not take this much soybeans.');
    assert.equal(say('repeat', 'Corn (grain) again after Corn (grain): about 5.5% yield drag.', { ...ctx, crop: 'corn', prev: 'corn', drag: -9.9 }), 'Corn again after corn, so I expect about 10 bu an acre less.');
    // the planner's land and buyer checks (placement.ts), each said for what it is
    const corn = { ...ctx, crop: 'corn' };
    assert.equal(say('market', "Needs a confirmed buyer: Corn (grain) is a specialty crop with thin local markets, so we only recommend it when you've marked a buyer or contract for it.", corn), 'Corn needs a buyer lined up first, since few local buyers take it.');
    assert.equal(say('land', "Corn (grain) seed isn't available locally for Back 80.", corn), 'Corn seed isn’t sold near here.');
    assert.equal(say('land', "Alfalfa (hay) needs hay equipment (mower-conditioner, rake, baler), which you've said you don't have.", { ...ctx, crop: 'alfalfa' }), 'Alfalfa needs hay equipment, which you don’t have yet.');
    assert.equal(say('land', "Cotton isn't a usual crop in Iowa (no Handbook 628 row): check local agronomy and markets.", { ...ctx, crop: 'cotton' }), 'Cotton isn’t a usual crop in Iowa, so check with local advisers first.');
    assert.equal(say('land', 'Salinity (ECe 4 dS/m) cuts Corn (grain) yield to about 85% of normal.', corn), 'Salty ground here cuts corn yield to about 85% of normal.');
    assert.equal(say('land', 'Drainage: poor, tolerated but not optimal for Corn (grain): about 10% yield loss.', corn), 'This ground doesn’t suit corn well.');
    for (const l of ['Corn needs a buyer lined up first, since few local buyers take it.', 'Alfalfa needs hay equipment, which you don’t have yet.']) assert.deepEqual(lintLine(l), []);
    assert.equal(warnLine({ lens: 'mystery', severity: 1, reason: 'Something new.' }), 'A planner note here. The details are in the fine print.');
    // the freeze's other shapes: one weather year's event (with its cut, or without), and anything else on the frost lens
    const event = 'Spring freeze at jointing (23 F on 04-12, injury below 24 F, K-State C646: moderate to severe; design range x0.5-0.9)';
    const frostSaid = [
      [say('frost', event, { ...ctx, freeze: { pct: 12 } }), 'A spring freeze can hurt the wheat here, so I take about 12% off.'],
      [say('frost', event), 'A spring freeze can hurt the wheat here, so I take a little off.'],
      [say('frost', 'Freeze risk: in 2 of 4 years, temperatures fell to or below the boot threshold (K-State C646); average effect'), 'Spring freezes can hurt the wheat. One got cold enough in 2 of 4 springs here.'],
      [say('frost', 'Something new about frost.'), 'Spring freezes can hurt the wheat here.'],
    ];
    for (const [got, want] of frostSaid) { assert.equal(got, want); assert.deepEqual(lintLine(got), [], got); }
  });

  it('no emoji in any icon or line', () => {
    for (const [name, svg] of Object.entries(ALL_ICONS)) {
      assert.doesNotMatch(svg, EMOJI, name);
      assert.match(svg, /^<(svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"|img src="\/manami.svg" alt="")/, name);
    }
    const cmp = compareFutures(demoData(['profit']), { startYear: START_YEAR });
    for (const line of allLines(cmp)) assert.doesNotMatch(line, EMOJI, line);
  });
});
