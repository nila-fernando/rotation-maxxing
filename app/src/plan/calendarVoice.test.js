import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as V from './calendarVoice.js';
import { handoff, jobsByMonth } from './cropCalendar.js';
import { lintLine } from './futuresVoice.js';

const STORY = { state: 'IA', fips: '19169' };
const IOWA = { state: 'IA', fips: null };
const KANSAS = { state: 'KS', fips: null };
const NOWHERE = { state: 'NE', fips: null };
const CROPS = ['corn', 'soybeans', 'oats', 'winter-wheat', 'alfalfa', 'cereal-rye'];
const PLACES = [STORY, IOWA, KANSAS, NOWHERE, { state: null, fips: null }];
const sentences = (s) => String(s).split(/(?<=[.!?])\s+/).filter(Boolean);

const DEMO_ROWS = [['f1', 'Home place', 114.8, 'soybeans'], ['f2', 'West 140', 138.3, 'soybeans'], ['f3', 'North draw', 125.3, 'corn'], ['f4', 'South 40', 35.6, 'corn'], ['f5', 'East place', 127.8, 'corn']]
  .map(([fieldId, name, acres, crop]) => ({ fieldId, name, acres, crop, cover: null, year: 2027 }));

/** Every line for a place: the module's own list, plus handoffs, month lines and the work order. */
function linesFor(place) {
  const out = [...V.allCalendarLines(place, CROPS)];
  for (const a of CROPS) {
    for (const b of CROPS) {
      if (a === b) continue;
      const h = handoff(a, b, 2028, place);
      out.push(V.handoffLine(h, { field: 'Home place and West 140', prev: a, next: b, betterAfter: 'oats' }));
    }
  }
  const rows = DEMO_ROWS.map((r) => ({ ...r, cover: r.crop === 'corn' ? 'cereal-rye' : null, prevCover: r.crop === 'soybeans' ? 'cereal-rye' : null }));
  const months = jobsByMonth(rows, place);
  for (const m of months) out.push(V.monthLine(m.month, m.jobs, place));
  out.push(V.workOrderLine(months));
  return out.filter(Boolean);
}

describe('Manami’s calendar lines', () => {
  test('every line passes lintLine (Story County, Iowa, Kansas, a state with no rows, no state)', () => {
    let n = 0;
    for (const place of PLACES) {
      for (const line of linesFor(place)) {
        n++;
        assert.deepEqual(lintLine(line), [], `${JSON.stringify(place)}: ${line}`);
      }
    }
    assert.ok(n > 80, `${n} lines`);
  });
  test('every insurance sentence says "last day for full insurance" and never "best"', () => {
    let n = 0;
    for (const place of PLACES) {
      for (const line of linesFor(place)) {
        for (const s of sentences(line)) {
          if (!/insur/i.test(s)) continue;
          n++;
          assert.match(s, /last day for full insurance/, s);
          assert.doesNotMatch(s, /\bbest\b/i, s);
        }
      }
    }
    assert.ok(n >= 5, `${n} insurance sentences`);
  });
  test('no line names Story County, and state rows are never "here"', () => {
    for (const place of PLACES) {
      for (const line of linesFor(place)) assert.doesNotMatch(line, /Story County/, line);
    }
    for (const place of [IOWA, KANSAS]) {
      for (const line of linesFor(place)) {
        for (const s of sentences(line)) {
          if (/insurance|frost/i.test(s)) assert.doesNotMatch(s, /\bhere\b/, s);
        }
      }
    }
    assert.match(V.cropWindowLine('winter-wheat', STORY), /in most of Iowa is Oct 20/);
    assert.match(V.cropWindowLine('corn', STORY), /The last day for full insurance here is May 31\./);
  });
  test('the work order for the demo’s 2027 pick, word for word', () => {
    assert.equal(V.workOrderLine(jobsByMonth(DEMO_ROWS, STORY)),
      'Plant corn first: North draw, South 40 and East place, Apr 15 to May 9. Then beans on Home place and West 140, by May 20.');
  });
  test('crop windows and season When lines', () => {
    assert.equal(V.cropWindowLine('corn', STORY),
      'Corn yields best sown Apr 15 to May 9, once the soil is 50°F and warming. Lately half of Iowa’s corn is in by May 6. The last day for full insurance here is May 31.');
    assert.match(V.cropWindowLine('soybeans', STORY), /^Soybeans yield best sown by May 20/);
    assert.match(V.cropWindowLine('corn', KANSAS), /^I don’t have a best sowing window for corn in Kansas yet\. Most farms there plant Apr 15 to May 15\.$/);
    assert.equal(V.seasonWhenLine('corn', 2027, STORY), 'Sow Apr 15 to May 9. Harvest early October to early November.');
    assert.equal(V.seasonWhenLine('soybeans', 2027, STORY), 'Sow by May 20. Harvest late September to mid October.');
    assert.equal(V.seasonWhenLine('oats', 2027, STORY), 'Sow Apr 2 to May 2, as most farms do. Harvest mid July to early August.');
    assert.equal(V.seasonWhenLine('winter-wheat', 2028, STORY), 'Sow Oct 1 to Oct 10 the fall before. Harvest early July to late July.');
    assert.equal(V.seasonWhenLine('sunflower', 2027, STORY), null);
  });
  test('handoff lines: ok with a rye cover, tight, clash', () => {
    assert.equal(V.handoffLine(handoff('soybeans', 'corn', 2028, STORY), { field: 'Home place', prev: 'soybeans', next: 'corn' }),
      'Beans come off Home place around early October. If you want a rye cover, drill it right after, by late October. End it at or before planting the corn.');
    assert.equal(V.handoffLine(handoff('corn', 'soybeans', 2028, STORY), { field: 'East place', prev: 'corn', next: 'soybeans' }),
      'Corn comes off East place around mid October. After corn a rye cover is tight, so seed it right behind the combine, by late October. End it at or before planting the beans.');
    assert.equal(V.handoffLine(handoff('soybeans', 'winter-wheat', 2028, STORY), { prev: 'soybeans', next: 'winter-wheat' }),
      'Beans come off around early October, right at the end of wheat’s best window. In a slow fall that’s too late, so have the drill ready.');
    assert.equal(V.handoffLine(handoff('corn', 'winter-wheat', 2028, STORY), { prev: 'corn', next: 'winter-wheat', betterAfter: 'oats' }),
      'Corn comes off around mid October, and the last day for full insurance on wheat in most of Iowa is Oct 20. That’s too tight. Wheat fits better after oats.');
    assert.equal(V.handoffLine(handoff('sunflower', 'corn', 2028, STORY), { prev: 'sunflower', next: 'corn' }), '');
  });
  test('month lines', () => {
    const months = jobsByMonth(DEMO_ROWS, STORY);
    assert.equal(V.monthLine(4, months.find((m) => m.month === 4).jobs, STORY),
      'Plant corn from mid April. It yields best sown by May 9, and the last frost here is usually about Apr 23.');
    assert.equal(V.monthLine(10, months.find((m) => m.month === 10).jobs, STORY),
      'Beans come off first, mostly late September to mid October. Corn follows, mostly early October to early November.');
    // no best window: what most farms do, and the insured last day when the usual run goes past it
    const oats = jobsByMonth([{ fieldId: 'a', name: 'A', acres: 10, crop: 'oats', cover: null, year: 2028 }], STORY);
    assert.equal(V.monthLine(4, oats.find((m) => m.month === 4).jobs, STORY),
      'Most farms plant oats from early April to early May, and the last frost here is usually about Apr 23. The last day for full insurance here is Apr 25.');
    // a farmer group's wheat window is advice, not Manami's "best"
    const wheat = jobsByMonth([{ fieldId: 'a', name: 'A', acres: 10, crop: 'winter-wheat', cover: null, year: 2028 }], STORY);
    assert.equal(V.monthLine(10, wheat.find((m) => m.month === 10).jobs, STORY), 'Plant wheat from early October. A farmer group advises sowing by Oct 10.');
    // no frost words without a county row
    assert.doesNotMatch(V.monthLine(4, jobsByMonth(DEMO_ROWS, IOWA).find((m) => m.month === 4).jobs, IOWA), /frost/);
  });
  test('frost, intro and gap lines', () => {
    assert.equal(V.frostLine(STORY),
      'The last spring frost at Ames is usually around Apr 23. One spring in ten it comes after May 5. The first fall frost is usually around Oct 14, and a hard freeze around Oct 24.');
    assert.equal(V.frostLine(IOWA), null);
    assert.equal(V.calendarIntroLine(STORY), 'Here’s when the work falls in central Iowa. The dates are from USDA, Iowa State and NOAA.');
    assert.equal(V.calendarIntroLine(KANSAS), 'Here’s when the work usually falls in Kansas. The dates are from USDA.');
    assert.equal(V.gapLine('sunflower', NOWHERE), 'I don’t have sowing dates for sunflowers in Nebraska yet. Your state’s extension office will have local ones.');
  });
  test('gap lines with and without a state; alfalfa is cut, not harvested', () => {
    assert.equal(V.gapLine('corn', { state: null }), 'I don’t have sowing dates for corn in your state yet. Your local extension office will have them.');
    const alf = jobsByMonth([{ fieldId: 'a', name: 'Hay field', acres: 40, crop: 'alfalfa', cover: null, year: 2027 }], STORY);
    const line = V.monthLine(alf[0].month, alf[0].jobs, STORY);
    assert.equal(line, 'Alfalfa cuttings run mostly late May to mid September.');
    assert.deepEqual(lintLine(line), []);
  });
  test('the source list: every source with a caveat, insurance never called best', () => {
    assert.equal(V.SOURCE_LINES.length, 7);
    for (const s of V.SOURCE_LINES) assert.ok(s.title && s.caveat && s.ids.length, s.title);
    assert.match(V.SOURCE_LINES.find((s) => s.ids.includes('rma2026')).caveat, /not best dates/);
  });
});
