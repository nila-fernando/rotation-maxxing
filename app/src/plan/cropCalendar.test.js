import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import * as C from './cropCalendar.js';
import { SEASONS } from '../vendor/rotation-maxxing/algorithm/croptraits.ts';
import { compareFutures } from './compareFutures.js';
import { demoData, START_YEAR } from '../../test/futuresDemo.mjs';
import {
  pctDates, averageYears, parseH628, rmaRows, reportAverage, readProgressCsv, zipMember, build, stringify, SOURCES,
} from '../../scripts/build-crop-calendar.mjs';

const STORY = { state: 'IA', fips: '19169' };
const IOWA = { state: 'IA', fips: null };
const KANSAS = { state: 'KS', fips: null };
const JSON_PATH = new URL('../../data/crop-calendar.json', import.meta.url);

/** One season of the demo's plan as calendar rows, in the farm's field order. */
function demoRows(kind = 'priority', season = 0, priorities = ['profit']) {
  const cmp = compareFutures(demoData(priorities), { startYear: START_YEAR });
  return cmp.fields.map((f) => {
    const s = f.byKind[kind].seasons[season];
    const before = season > 0 ? f.byKind[kind].seasons[season - 1] : null;
    return { fieldId: f.id, name: f.name, acres: f.acres, crop: s.crop, cover: s.cover, year: cmp.years[season], prevCover: before?.cover ?? null };
  });
}

describe('windowsFor', () => {
  test('Story County corn: the last day for full insurance is the county row', () => {
    const w = C.windowsFor('corn', STORY);
    assert.equal(w.sow.insurance.final, '05-31');
    assert.equal(w.sow.insurance.scope, 'county');
    assert.equal(w.sow.insurance.scopeWords, 'here');
    assert.equal(w.sow.insurance.earliest, '04-10');
    assert.equal(w.sow.insurance.latePlantEnd, '06-25');
  });
  test('the usual windows come from the vendor SEASONS (Handbook 628)', () => {
    const soy = C.windowsFor('soybeans', STORY);
    assert.equal(soy.sow.usual.begin, '05-02');
    assert.equal(soy.sow.usual.begin, SEASONS.soybeans.IA.plant.begin);
    assert.deepEqual(soy.sow.usual.active, ['05-08', '06-02']);
    assert.equal(soy.sow.usual.src, 'h628');
    assert.deepEqual(C.windowsFor('corn', STORY).harvest.usual.active, ['10-05', '11-09']);
  });
  test('corn is best sown Apr 15 to May 9 (Iowa State), with the soil cue', () => {
    const w = C.windowsFor('corn', STORY);
    assert.equal(w.sow.best.from, '04-15');
    assert.equal(w.sow.best.to, '05-09');
    assert.equal(w.sow.best.src, 'isuCorn2010');
    assert.equal(w.sow.soilCue, true);
    assert.deepEqual(w.sow.lossAfter, { date: '05-18', src: 'isuLicht2020' });
    assert.equal(w.sow.recent.p50, '05-06');
    assert.equal(w.harvest.recent.p50, '10-19');
  });
  test('soybeans have only an end to the best window', () => {
    const w = C.windowsFor('soybeans', STORY);
    assert.equal(w.sow.best.from, null);
    assert.equal(w.sow.best.to, '05-20');
  });
  test('Iowa winter wheat: no Story County row, so the state default, "in most of Iowa"', () => {
    const w = C.windowsFor('winter-wheat', STORY);
    assert.equal(w.sow.insurance.scope, 'state');
    assert.equal(w.sow.insurance.final, '10-20');
    assert.equal(w.sow.insurance.scopeWords, 'in most of Iowa');
    assert.equal(w.sow.plantsFallBefore, true);
    assert.equal(w.sow.best.secondary, true);
  });
  test('another Iowa county gets the state rows, and no county insurance for corn', () => {
    const w = C.windowsFor('corn', IOWA);
    assert.equal(w.sow.best.from, '04-15');
    assert.equal(w.sow.insurance, null);
    assert.equal(C.frostFor(IOWA), null);
  });
  test('a crop with no rows at all is null', () => {
    assert.equal(C.windowsFor('sunflower', { state: 'IA' }), null);
    assert.equal(C.windowsFor('corn', { state: 'NE' }), null);
    assert.equal(C.windowsFor('corn', {}), null);
  });
  test('Kansas corn: the 628 begin, no insurance, no best window', () => {
    const w = C.windowsFor('corn', KANSAS);
    assert.equal(w.sow.usual.begin, '04-05');
    assert.equal(w.sow.insurance, null);
    assert.equal(w.sow.best, null);
  });
  test('Kansas winter wheat carries its recent harvest pace', () => {
    assert.equal(C.windowsFor('winter-wheat', KANSAS).harvest.recent.p50, '06-28');
  });
  test('a county row only counts in its own state', () => {
    assert.equal(C.windowsFor('corn', { state: 'KS', fips: '19169' }).sow.insurance, null);
  });
});

describe('frost and cover', () => {
  test('Story County frost from the Ames normals', () => {
    const f = C.frostFor(STORY);
    assert.equal(f.lastSpring.p50, '04-23');
    assert.equal(f.lastSpring.p90, '05-05');
    assert.equal(f.firstFall.p50, '10-14');
    assert.equal(f.hardFreeze.p50, '10-24');
    assert.equal(f.stationName, 'Ames 8 WSW');
  });
  test('cereal rye seeds Aug 15 to Oct 31 in Iowa, termination zone unconfirmed', () => {
    const c = C.coverFor('cereal-rye', STORY);
    assert.deepEqual(c.seed, ['08-15', '10-31']);
    assert.equal(c.terminate, 'at or before planting');
    assert.equal(c.zoneConfirmed, false);
    assert.equal(C.coverFor('cereal-rye', KANSAS), null);
  });
});

describe('spanFor and handoff', () => {
  test('winter wheat for 2028 is planted in fall 2027', () => {
    const s = C.spanFor('winter-wheat', 2028, STORY);
    assert.equal(s.plant.getFullYear(), 2027);
    assert.equal(s.harvest.getFullYear(), 2028);
    assert.equal(s.bestFrom.getMonth(), 9);
  });
  test('corn for 2027 is planted from the best window start', () => {
    const s = C.spanFor('corn', 2027, STORY);
    assert.equal(s.plant.getFullYear(), 2027);
    assert.equal(s.plant.getMonth(), 3);
    assert.equal(s.plant.getDate(), 15);
  });
  test('soybeans into corn is ok', () => {
    const h = C.handoff('soybeans', 'corn', 2028, STORY);
    assert.equal(h.fit, 'ok');
    assert.equal(h.off, '10-09');
  });
  test('corn into winter wheat is a clash (Oct 19 against a last day of Oct 20)', () => {
    const h = C.handoff('corn', 'winter-wheat', 2028, STORY);
    assert.equal(h.fit, 'clash');
    assert.equal(h.off, '10-19');
    assert.equal(h.final, '10-20');
  });
  test('soybeans into winter wheat is tight (a slow fall runs past the last day)', () => {
    const h = C.handoff('soybeans', 'winter-wheat', 2028, STORY);
    assert.equal(h.fit, 'tight');
    assert.equal(h.prevP90, '10-29');
  });
  test('corn into a rye cover fits, with 12 days to seed', () => {
    const h = C.handoff('corn', 'cereal-rye', 2028, STORY);
    assert.equal(h.coverFits, true);
    assert.equal(h.coverDays, 12);
    assert.equal(h.fit, 'tight');
  });
  test('an unknown crop gives no fit', () => {
    assert.equal(C.handoff('sunflower', 'corn', 2028, STORY).fit, null);
  });
});

describe('jobsByMonth', () => {
  test('demo 2027, my pick: April corn, May beans, both harvests in October', () => {
    const months = C.jobsByMonth(demoRows('priority', 0), STORY);
    const apr = months.find((m) => m.month === 4);
    const corn = apr.jobs.find((j) => j.kind === 'plant' && j.crop === 'corn');
    assert.deepEqual(corn.fieldIds, ['f3', 'f4', 'f5']);
    assert.equal(Math.round(corn.acres), 289);
    assert.equal(corn.from, '04-15');
    const may = months.find((m) => m.month === 5);
    const soy = may.jobs.find((j) => j.kind === 'plant' && j.crop === 'soybeans');
    assert.deepEqual(soy.fieldIds, ['f1', 'f2']);
    assert.equal(Math.round(soy.acres), 253);
    assert.equal(soy.by, true);
    const oct = months.find((m) => m.month === 10);
    assert.deepEqual(oct.jobs.filter((j) => j.kind === 'harvest').map((j) => j.crop).sort(), ['corn', 'soybeans']);
    assert.ok(months.every((m) => m.year === 2027));
  });
  test('the soil-first pick seeds rye in October 2029', () => {
    const months = C.jobsByMonth(demoRows('priority', 2, ['soil-health', 'profit']), STORY);
    const oct = months.find((m) => m.month === 10 && m.year === 2029);
    assert.ok(oct.jobs.some((j) => j.kind === 'coverSeed' && j.crop === 'cereal-rye'));
  });
  test('a cover from last season ends at this crop’s planting; winter wheat plants the fall before', () => {
    const rows = [
      { fieldId: 'a', name: 'A', acres: 10, crop: 'corn', cover: null, prevCover: 'cereal-rye', year: 2028 },
      { fieldId: 'b', name: 'B', acres: 20, crop: 'winter-wheat', cover: null, year: 2028 },
    ];
    const months = C.jobsByMonth(rows, STORY);
    assert.ok(months.find((m) => m.month === 4 && m.year === 2028).jobs.some((j) => j.kind === 'coverEnd'));
    assert.ok(months.find((m) => m.month === 10 && m.year === 2027).jobs.some((j) => j.kind === 'plant' && j.crop === 'winter-wheat'));
    assert.deepEqual(months.map((m) => m.year * 100 + m.month), [...months.map((m) => m.year * 100 + m.month)].sort((a, b) => a - b));
  });
});

describe('gapsFor: only the gaps that apply where the farm is', () => {
  test('Story County gets the bundled gaps as they are', () => {
    assert.deepEqual(C.gapsFor(STORY), C.CALENDAR.gaps);
  });
  test('another Iowa county is never told about Story County, and is told it has no county rows', () => {
    const g = C.gapsFor(IOWA);
    assert.ok(!g.some((x) => /Story County/.test(x)), g.join(' | '));
    assert.ok(g.some((x) => /Iowa planting pace for winter wheat/.test(x)));
    assert.ok(g.includes('No county insurance or frost dates for this farm yet.'));
  });
  test('Kansas gets no Iowa gaps, and says what Kansas lacks', () => {
    const g = C.gapsFor(KANSAS);
    assert.ok(!g.some((x) => /Iowa|Story/.test(x)), g.join(' | '));
    assert.ok(g.includes('No insurance or frost dates for Kansas yet.'));
    assert.ok(g.includes('No cover crop seeding dates for Kansas yet.'));
  });
  test('a state with no rows, and no state at all', () => {
    assert.deepEqual(C.gapsFor({ state: 'NE' }), ['No sowing dates for Nebraska yet.']);
    assert.equal(C.gapsFor({}).length, 1);
  });
  test('a crop’s own gaps use its name and never say "here" for a state row', () => {
    for (const [crop, place] of [['corn', IOWA], ['winter-wheat', KANSAS], ['oats', STORY]]) {
      for (const g of C.windowsFor(crop, place).gaps) {
        assert.doesNotMatch(g, /\bhere\b|winter-wheat/, g);
      }
    }
    assert.deepEqual(C.windowsFor('corn', IOWA).gaps, ['No insurance dates for corn in Iowa.']);
  });
});

describe('words and the tooltip line', () => {
  test('tipSubFor', () => {
    assert.equal(C.tipSubFor('corn', STORY), 'Best sown Apr 15 – May 9');
    assert.equal(C.tipSubFor('soybeans', STORY), 'Best sown by May 20');
    assert.equal(C.tipSubFor('corn', KANSAS), 'Most farms plant Apr 15 – May 15');
    assert.equal(C.tipSubFor('sunflower', STORY), '');
  });
  test('fmt, rangeWords, partWords', () => {
    assert.equal(C.fmt('05-31'), 'May 31');
    assert.equal(C.rangeWords('04-15', '05-09'), 'Apr 15 to May 9');
    assert.equal(C.partWords('10-05'), 'early October');
    assert.equal(C.partWords('10-15'), 'mid October');
    assert.equal(C.partWords('10-31'), 'late October');
    assert.equal(Object.keys(C.STATE_NAME).length, 51);
    assert.deepEqual(C.placeOf({ state: 'IA', fips: '19169' }), { state: 'IA', fips: '19169' });
    assert.deepEqual(C.placeOf({}), { state: null, fips: null });
  });
});

describe('data/crop-calendar.json', () => {
  const text = readFileSync(JSON_PATH, 'utf8');
  const json = JSON.parse(text);
  const walk = (o, fn, key = null) => {
    if (Array.isArray(o)) o.forEach((x) => walk(x, fn, key));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { fn(k, v); walk(v, fn, k); }
    else fn(key, o, true);
  };
  test('is small (under 10 KB)', () => {
    assert.ok(Buffer.byteLength(text) < 10 * 1024, `${Buffer.byteLength(text)} bytes`);
  });
  test('every source id it uses is in sources, with a licence and a URL', () => {
    const used = new Set();
    walk(json, (k, v) => { if (['src', 'soilCue', 'termSrc'].includes(k) && typeof v === 'string') used.add(v); });
    assert.ok(used.size >= 7);
    for (const id of used) {
      assert.ok(json.sources[id], `missing source ${id}`);
      assert.ok(json.sources[id].licence && json.sources[id].url && json.sources[id].title, id);
    }
  });
  test('every date is MM-DD', () => {
    const DATE_KEYS = new Set(['p10', 'p50', 'p90', 'from', 'to', 'final', 'earliest', 'latePlantEnd', 'salesClosing', 'endInsurance', 'date', 'springFinal', 'lateSummerFinal', 'seed']);
    let n = 0;
    walk(json, (k, v, leaf) => {
      if (!leaf || !DATE_KEYS.has(k) || v == null) return;
      n++;
      assert.match(v, /^\d\d-\d\d$/, `${k}: ${v}`);
    });
    assert.ok(n > 30);
  });
  test('Handbook 628 rows are not copied (they come from the vendor)', () => {
    walk(json, (k, v) => {
      assert.notEqual(k, 'handbookRow');
      if ((k === 'plant' || k === 'harvest') && v && typeof v === 'object') assert.ok(!('begin' in v) && !('activeStart' in v), k);
    });
  });
  test('the API notice is only set when the API was used', () => {
    assert.equal(json.sources.nassProgress.apiNotice, undefined);
  });
});

describe('the build script helpers', () => {
  test('pctDates interpolates, with 0% a week before the first report', () => {
    // Iowa oats planted, the 2020–2024 average column of the 2025 weekly reports
    const series = [['04-06', 16], ['04-13', 39], ['04-20', 60], ['04-27', 78], ['05-04', 89], ['05-11', 94]].map(([d, pct]) => ({ date: `2025-${d}`, pct }));
    assert.deepEqual(pctDates(series), { p10: '04-03', p50: '04-17', p90: '05-05' });
    assert.equal(pctDates([]).p50, null);
  });
  test('averageYears takes the mean day over the years', () => {
    const y = (yr, d50) => [{ date: `${yr}-04-01`, pct: 0 }, { date: `${yr}-${d50}`, pct: 50 }, { date: `${yr}-06-01`, pct: 100 }];
    const avg = averageYears({ 2021: y(2021, '05-01'), 2022: y(2022, '05-11'), 2019: y(2019, '06-01') });
    assert.equal(avg.p50, '05-06');
    assert.equal(avg.years, '2021–2022');
  });
  test('parseH628 fixes the typos and matches the vendor IA corn row', () => {
    const text = [
      'Usual Planting and Harvesting Dates by Crop - Iowa',
      'Corn for grain .........:  13,400    Apr 19 Apr 25 - May 18 May 26  Sep 21 Oct 5 - Nov 9   Nov 21 ',
      'Winter, wheat ..........:      22    Sep 6  Sep 26 - Oct 15 Oct 30  Jun 24 Jul 6 - Jul 22  Aug 7  ',
      'Sorhgum for grain ......:  2,550     May 5  May 15 - Jun 20 Jul 15  Sep 10 Sep 25 - Nov 10 Nov 25 ',
      'Hay, alfalfa ...........:     920    (NA)   (NA)            (NA)    May 24 May 30 - Sep 15 Sep 29 ',
    ].join('\n');
    const out = parseH628(text);
    const v = SEASONS.corn.IA;
    const pick = (x) => ({ begin: x.begin, activeStart: x.activeStart, activeEnd: x.activeEnd, end: x.end });
    assert.deepEqual(out.IA.corn, { plant: pick(v.plant), harvest: pick(v.harvest) });
    assert.deepEqual(out.IA['winter-wheat'].plant, pick(SEASONS['winter-wheat'].IA.plant));
    assert.equal(out.IA.sorghum.plant.begin, '05-05');
    assert.equal(out.IA.alfalfa.plant, null);
    assert.deepEqual(out.IA.alfalfa.harvest, pick(SEASONS.alfalfa.IA.harvest));
  });
  test('rmaRows collapses a county to its mode, and the state to the county mode', async () => {
    const head = 'Record Type Code|Record Category Code|ADM Insurance Offer ID|Reinsurance Year|Commodity Year|Commodity Code|Insurance Plan Code|State Code|County Code|Sub County Code|Type Code';
    const row = (county, code, plan, type, { sc = '20260315', early = '20260410', final = '20260531', late = '20260625', eoi = '20261210' } = {}) => {
      const f = Array(50).fill('');
      Object.assign(f, { 0: 'A00200', 5: code, 6: plan, 7: '19', 8: county, 10: type, 23: sc, 26: early, 27: final, 31: eoi, 38: late });
      return f.join('|');
    };
    const lines = [head,
      row('169', '0041', '01', '016'), row('169', '0041', '02', '016'), row('169', '0041', '01', '026', { final: '20260605' }),
      row('001', '0041', '01', '016'), row('003', '0041', '01', '016', { final: '20260525' }),
      row('169', '0041', '04', '016', { final: '20260101' }), // plan 04 is not read
      row('001', '0011', '01', '011', { early: '', final: '20251020', late: '20251104', sc: '20250930' }),
      row('003', '0011', '01', '011', { early: '', final: '20251010', late: '20251025', sc: '20250930' }),
      row('005', '0011', '01', '011', { early: '', final: '20251020', late: '20251104', sc: '20250930' }),
    ];
    const { counties, rmaState } = await rmaRows(lines, { state: '19' });
    assert.deepEqual(counties['19169'].corn, { earliest: '04-10', final: '05-31', latePlantEnd: '06-25', salesClosing: '03-15', endInsurance: '12-10' });
    assert.equal(rmaState.corn.final, '05-31');
    assert.equal(rmaState.corn.counties, 2);
    assert.equal(rmaState['winter-wheat'].final, '10-20');
    assert.equal(rmaState['winter-wheat'].earliest, null);
    assert.equal(rmaState['winter-wheat'].counties, 2);
  });
  test('reportAverage reads the 5-year average column of a weekly report', () => {
    const text = [
      'Oats Planted - Selected States',
      '[These 9 States planted 75% of the 2024 oat acreage]',
      '      State      : April 13, : April 6,  : April 13, : 2020-2024 ',
      '                 :   2024    :   2025    :   2025    :  Average  ',
      'Iowa ............:     61          20          47          39    ',
    ].join('\n');
    assert.deepEqual(reportAverage(text, { table: 'Oats Planted', state: 'Iowa' }), { date: '2025-04-13', pct: 39 });
    assert.equal(reportAverage('nothing here'), null);
  });
  test('readProgressCsv groups the weekly rows by year', () => {
    const by = readProgressCsv('year,week_ending,num_value,day_of_year,yeari\n2021,2021-04-04,0.0,94,42\n2021,2021-04-11,1.0,101,42\n2022,2022-04-10,3.0,100,43\n');
    assert.deepEqual(by['2021'], [{ date: '2021-04-04', pct: 0 }, { date: '2021-04-11', pct: 1 }]);
    assert.equal(by['2022'].length, 1);
  });
  test('zipMember pulls one deflated member out of a zip by ranged reads', async () => {
    const zip = makeZip([['a.txt', 'first member'], ['2026_A00200_Date_YTD.txt', 'A00200|01|x\n'.repeat(50)]]);
    const reads = [];
    const read = async (s, e) => { reads.push([s, e]); return zip.subarray(s, e + 1); };
    const out = await zipMember(read, zip.length, '2026_A00200_Date_YTD.txt');
    assert.equal(out.toString(), 'A00200|01|x\n'.repeat(50));
    assert.ok(reads.length >= 3);
    await assert.rejects(zipMember(read, zip.length, 'missing.txt'), /not in the zip/);
  });
  test('every source in the script has a licence and caveat', () => {
    for (const [id, s] of Object.entries(SOURCES)) assert.ok(s.licence && s.caveat && s.url && s.year, id);
  });
  // The full rebuild reads the saved downloads (the RMA dates file alone is 677 MB), so it only runs
  // when CROP_CALENDAR_DOWNLOADS points at them.
  const dir = process.env.CROP_CALENDAR_DOWNLOADS;
  test('a rebuild from the downloads reproduces the committed JSON exactly', { skip: !dir || !existsSync(dir) }, async () => {
    const { json } = await build(dir);
    assert.equal(stringify(json), readFileSync(JSON_PATH, 'utf8'));
  });
});

/** A minimal zip (deflate, no zip64) of [name, text] members, for the zipMember test. */
function makeZip(members) {
  const locals = [], centrals = [];
  let off = 0;
  for (const [name, text] of members) {
    const data = deflateRawSync(Buffer.from(text));
    const nameB = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(Buffer.byteLength(text), 22); lh.writeUInt16LE(nameB.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(Buffer.byteLength(text), 24); cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt32LE(off, 42);
    locals.push(lh, nameB, data);
    centrals.push(cd, nameB);
    off += 30 + nameB.length + data.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(members.length, 8); eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}
