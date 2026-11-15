import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { calendarTabHtml, wireCalendarTab, seasonRows, MCCC_URL } from './cropCalendarView.js';
import { compareFutures } from '../plan/compareFutures.js';
import { placeOf } from '../plan/cropCalendar.js';
import { lintLine } from '../plan/futuresVoice.js';
import { demoData, START_YEAR } from '../../test/futuresDemo.mjs';

const data = demoData(['profit']);
const cmp = compareFutures(data, { startYear: START_YEAR });
const PLACE = placeOf(data.farm);
/** A rotation story with only what the tab reads (Track A's rotationOf gives the full one). */
const rotOf = (kind, c = cmp) => ({
  view: kind, years: c.years,
  fields: c.fields.map((f) => ({ id: f.id, name: f.name, acres: f.acres, past: f.history.slice(-2).map((crop, i) => ({ year: c.years[0] - 2 + i, crop })), seasons: f.byKind[kind].seasons.map((s, i) => ({ year: c.years[i], crop: s.crop, cover: s.cover })) })),
});
const textOf = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '’').replace(/\s+/g, ' ');

describe('the When to sow tab', () => {
  test('the demo farm carries its county to the calendar', () => {
    assert.deepEqual(PLACE, { state: 'IA', fips: '19169' });
  });
  test('rows follow the farm’s field order, whatever order the story uses', () => {
    const rot = rotOf('priority');
    rot.fields.reverse();
    assert.deepEqual(seasonRows(rot, cmp, 0).map((r) => r.fieldId), ['f1', 'f2', 'f3', 'f4', 'f5']);
    assert.deepEqual(seasonRows(rot, cmp, 1).map((r) => r.prev), ['soybeans', 'soybeans', 'corn', 'corn', 'corn']);
    // with no story fields yet, the compared plans are read
    assert.deepEqual(seasonRows({ view: 'priority', years: cmp.years, fields: [] }, cmp, 0).map((r) => r.crop), ['soybeans', 'soybeans', 'corn', 'corn', 'corn']);
  });
  test('2027 jobs by month: an h4 per month, April corn, May beans, October harvests', () => {
    const html = calendarTabHtml({ rot: rotOf('priority'), cmp, place: PLACE, season: 0 });
    const months = [...html.matchAll(/<h4 class="cal-month"[^>]*>([^<]+)<\/h4>/g)].map((m) => m[1]);
    assert.deepEqual(months, ['April 2027', 'May 2027', 'October 2027']);
    assert.match(textOf(html), /Apr 15 to May 9 · Plant corn · North draw, South 40 and East place \(289 ac\)/);
    assert.match(textOf(html), /by May 20 · Plant soybeans · Home place and West 140 \(253 ac\)/);
    assert.match(html, /Plant corn first: North draw, South 40 and East place, Apr 15 to May 9\. Then beans on Home place and West 140, by May 20\./);
  });
  test('source chips, honest labels, the frost line, the handoffs and the MCCC link', () => {
    const html = calendarTabHtml({ rot: rotOf('priority'), cmp, place: PLACE, season: 0 });
    for (const src of ['isuCorn2010', 'isuLicht2020', 'h628', 'nassProgress', 'rma2026', 'noaaNormals']) assert.match(html, new RegExp(`class="src-chip cal-src" data-src="${src}"`), src);
    assert.match(html, /<dt>Last day for full insurance<\/dt><dd>May 31, here /);
    assert.match(html, /<dt>Best sown<\/dt><dd>Apr 15 to May 9 /);
    assert.match(html, /<dt>Most farms plant<\/dt>/);
    assert.match(html, /<dt>Lately half are in by<\/dt><dd>May 6 \(2021–2025, state-wide\)/);
    assert.match(html, /The last spring frost at Ames is usually around Apr 23\./);
    assert.match(html, /class="cal-handoff cal-handoff--ok"/);
    assert.match(html, /Corn comes off Home place and West 140 around mid October\./);
    assert.match(html, new RegExp(`<a class="cal-mccc" href="${MCCC_URL.replace(/[./]/g, '\\$&')}" target="_blank" rel="noopener">Midwest Cover Crops Council selector`));
    assert.match(html, /<summary>Where these dates come from<\/summary>/);
    assert.doesNotMatch(html, /title=/);
  });
  test('every crop icon carries the shared tooltip, and every line passes lintLine', () => {
    for (let s = 0; s < 3; s++) {
      const html = calendarTabHtml({ rot: rotOf('priority'), cmp, place: PLACE, season: s });
      const badges = html.match(/class="plan-crop plan-crop--md"[^>]*>/g) ?? [];
      assert.ok(badges.length >= 4);
      for (const b of badges) assert.match(b, /data-crop-tip="[^"]+"/);
      for (const m of html.matchAll(/<p class="cal-(?:say|month__say|crop__say)">([^<]+)<\/p>/g)) {
        const line = m[1].replace(/&#39;/g, '’').replace(/&amp;/g, '&');
        // the tab's opening paragraph is two of Manami's lines side by side
        for (const part of line.split(/(?<=NOAA\.|USDA\.|Iowa State\.) /)) assert.deepEqual(lintLine(part), [], part);
      }
    }
  });
  test('the season radios: 2028 shows 2028’s jobs, and the soil-first pick seeds rye in October 2029', () => {
    const html = calendarTabHtml({ rot: rotOf('priority'), cmp, place: PLACE, season: 1 });
    assert.match(html, /role="radio" aria-checked="true" tabindex="0" data-season="1">2028</);
    assert.match(html, /April 2028/);
    const soil = compareFutures(demoData(['soil-health', 'profit']), { startYear: START_YEAR });
    const h29 = calendarTabHtml({ rot: rotOf('priority', soil), cmp: soil, place: PLACE, season: 2 });
    assert.match(textOf(h29), /October 2029 .*Drill the rye cover/);
    assert.match(h29, /class="cal-crop cal-crop--cover" data-crop="cereal-rye"/);
  });
  test('a state with no dates gets the gap card, still with the sources and the MCCC link', () => {
    const html = calendarTabHtml({ rot: rotOf('priority'), cmp, place: { state: 'NE', fips: null }, season: 0 });
    assert.match(html, /class="cal-gap" role="note"/);
    assert.match(html, /I don’t have sowing dates for soybeans in Nebraska yet\./);
    assert.doesNotMatch(html, /cal-month/);
    assert.match(html, /cal-mccc/);
  });
  test('Iowa without a county: no frost line, no "here" insurance', () => {
    const html = calendarTabHtml({ rot: rotOf('priority'), cmp, place: { state: 'IA', fips: null }, season: 0 });
    assert.doesNotMatch(html, /cal-frost/);
    assert.doesNotMatch(html, /full insurance<\/dt><dd>[^<]*here/);
  });
  test('nothing to show without years, or without any plan rows (never a false gap)', () => {
    assert.equal(calendarTabHtml({}), '');
    assert.equal(calendarTabHtml({ rot: { view: 'priority', years: cmp.years, fields: [] }, cmp: { years: cmp.years, fields: [] }, place: PLACE }), '');
  });
  test('the source list names only the sources behind the dates shown', () => {
    const srcList = (html) => /<ul class="cal-sources__list">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
    const story = srcList(calendarTabHtml({ rot: rotOf('priority'), cmp, place: PLACE, season: 0 }));
    for (const t of ['Usual Planting', 'Crop Progress', 'Iowa State University', 'RMA', 'NOAA']) assert.match(story, new RegExp(t), t);
    assert.doesNotMatch(story, /Practical Farmers|Cereal Rye/); // no wheat or rye in the 2027 pick
    const kansas = calendarTabHtml({ rot: rotOf('priority'), cmp, place: { state: 'KS', fips: null }, season: 0 });
    const ks = srcList(kansas);
    assert.match(ks, /Field Crops Usual Planting and Harvesting Dates/);
    assert.doesNotMatch(ks, /Iowa State|Ames|Practical Farmers|RMA/);
    assert.doesNotMatch(kansas, /Story County|Iowa/);
  });
});

describe('wireCalendarTab', () => {
  /** A tiny stand-in for the tab's element and its 3 radios. */
  function fakeTab() {
    const listeners = {};
    const radios = [0, 1, 2].map((i) => ({
      dataset: { season: String(i) }, attrs: {}, tabIndex: i ? -1 : 0, focused: false,
      setAttribute(k, v) { this.attrs[k] = v; }, focus() { radios.forEach((r) => { r.focused = r === this; }); },
      closest() { return this; },
    }));
    const el = {
      addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener: (t) => { delete listeners[t]; },
      querySelectorAll: () => radios, querySelector: (sel) => radios.find((r) => sel.includes(`"${r.dataset.season}"`)) ?? null,
      contains: () => true,
    };
    return { el, radios, listeners };
  }
  test('arrows, Home and End move and pick the season; clicks pick too; dispose unhooks', () => {
    const { el, radios, listeners } = fakeTab();
    const picked = [];
    const dispose = wireCalendarTab(el, { onSeason: (i) => picked.push(i) });
    const key = (target, k) => { let prevented = false; listeners.keydown({ target, key: k, preventDefault: () => { prevented = true; } }); return prevented; };
    assert.ok(key(radios[0], 'ArrowRight'));
    assert.ok(key(radios[1], 'End'));
    assert.ok(key(radios[2], 'ArrowRight')); // wraps
    assert.ok(key(radios[0], 'ArrowLeft'));
    assert.ok(key(radios[2], 'Home'));
    assert.equal(key(radios[0], 'Tab'), false);
    listeners.click({ target: radios[1] });
    assert.deepEqual(picked, [1, 2, 0, 2, 0, 1]);
    assert.equal(radios[1].focused, true);
    assert.equal(radios[1].attrs['aria-checked'], 'true');
    assert.equal(radios[0].tabIndex, -1);
    dispose();
    assert.equal(listeners.keydown, undefined);
    assert.equal(typeof wireCalendarTab(null, {}), 'function');
  });
});
