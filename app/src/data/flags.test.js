import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getFields, getMeta, getWeather } from './farmData.js';
import { buildFieldReport, fieldReportFor, HISTORY_YEARS } from './fieldReport.js';
import { FLAG_CONFIG, erosionRisk, flagsFor, longestRun, shownFlags, statusFor } from './flags.js';
import { fieldData } from '../../test/fieldData.mjs';

const hist = (...crops) => crops.map((crop, i) => ({ year: 2018 + i, crop }));
const ids = (flags) => flags.map((f) => f.id).sort();
const rainOf = (recent, avg30 = 500) => ({ years: recent.map((value, i) => ({ year: 2021 + i, value })), avg30 });

describe('flag rules', () => {
  it('same crop 3+ years in a row', () => {
    assert.deepEqual(ids(flagsFor({ cropHistory: hist('soybeans', 'corn', 'corn', 'corn') })), ['sameCrop']);
    assert.deepEqual(ids(flagsFor({ cropHistory: hist('soybeans', 'corn', 'corn', 'soybeans') })), []);
    const [f] = flagsFor({ cropHistory: hist('soybeans', 'corn', 'corn', 'corn') });
    assert.equal(f.text, 'Corn 3 years running. Rotating could lift yield.');
  });
  it('a past run is named with its years', () => {
    const [f] = flagsFor({ cropHistory: hist('corn', 'corn', 'corn', 'soybeans') });
    assert.equal(f.text, 'Corn 3 years running (2018–2020). Rotating could lift yield.');
  });
  it('a gap in the years breaks a run', () => {
    const h = [{ year: 2018, crop: 'corn' }, { year: 2019, crop: 'corn' }, { year: 2021, crop: 'corn' }];
    assert.equal(longestRun(h).years, 2);
  });
  it('no legume in 8 years (only when 8 years are known)', () => {
    const f = flagsFor({ cropHistory: hist('corn', 'corn', 'oats', 'corn', 'corn', 'wheat', 'corn', 'oats') });
    assert.ok(ids(f).includes('noLegume'));
    assert.equal(f.find((x) => x.id === 'noLegume').text, 'No legume in 8 years. Beans or alfalfa can add nitrogen.');
    assert.ok(!ids(flagsFor({ cropHistory: hist('corn', 'oats', 'corn') })).includes('noLegume'));
    assert.ok(!ids(flagsFor({ cropHistory: hist('corn', 'corn', 'oats', 'corn', 'alfalfa', 'wheat', 'corn', 'oats') })).includes('noLegume'));
    assert.ok(!ids(flagsFor({ cropHistory: hist('corn', 'oats', 'corn', 'Dry Beans', 'corn', 'wheat', 'corn', 'oats') })).includes('noLegume'));
  });
  it('reads CSB names right: "Non Alfalfa" hay is not a legume, a soybean double crop is', () => {
    const nonAlfalfa = hist('Corn', 'Corn', 'Other Hay/Non Alfalfa', 'Corn', 'Corn', 'Oats', 'Corn', 'Corn');
    assert.ok(ids(flagsFor({ cropHistory: nonAlfalfa })).includes('noLegume'));
    const dbl = hist('Corn', 'Dbl Crop Soybeans/Oats', 'Corn', 'Corn', 'Oats', 'Corn', 'Corn', 'Oats');
    assert.ok(!ids(flagsFor({ cropHistory: dbl })).includes('noLegume'));
    const dbl2 = hist('Corn', 'Dbl Crop WinWht/Soybeans', 'Corn', 'Oats', 'Corn', 'Oats', 'Corn', 'Oats');
    assert.ok(!ids(flagsFor({ cropHistory: dbl2 })).includes('noLegume'));
  });
  it('gives no rotation advice for ground that is not cropland', () => {
    const grass = hist(...Array(8).fill('Grassland/Pasture'));
    assert.deepEqual(flagsFor({ cropHistory: grass }), []);
    const built = hist(...Array(6).fill('Developed/Open Space'));
    assert.deepEqual(flagsFor({ cropHistory: built }), []);
    const idle = hist('Corn', 'Fallow/Idle Cropland', 'Fallow/Idle Cropland', 'Fallow/Idle Cropland', 'Soybeans');
    assert.ok(!ids(flagsFor({ cropHistory: idle })).includes('sameCrop'));
  });
  it('a pasture year does not break up the legume window into "8 crop years"', () => {
    const h = hist('Corn', 'Grassland/Pasture', 'Corn', 'Oats', 'Corn', 'Oats', 'Corn', 'Oats');
    assert.ok(!ids(flagsFor({ cropHistory: h })).includes('noLegume')); // only 7 crop years in the 8
  });
  it('steep ground with a row crop last year', () => {
    assert.deepEqual(ids(flagsFor({ cropHistory: hist('oats', 'soybeans'), slopePct: 6.5 })), ['steepRowCrop']);
    assert.deepEqual(ids(flagsFor({ cropHistory: hist('soybeans', 'hay'), slopePct: 9 })), []);
    assert.deepEqual(ids(flagsFor({ cropHistory: hist('oats', 'corn'), slopePct: 6 })), []); // "over 6%"
  });
  it('drier than normal lately: last 5 years more than 10% under the 30-year average', () => {
    assert.deepEqual(ids(flagsFor({ rain: rainOf([440, 440, 440, 440, 440]) })), ['dry']); // 12% under
    assert.deepEqual(ids(flagsFor({ rain: rainOf([450, 450, 450, 450, 450]) })), []); // exactly 10%
    assert.deepEqual(ids(flagsFor({ rain: rainOf([440, 440, 440]) })), []); // not 5 years yet
  });
  it('status: green, amber, red', () => {
    assert.equal(statusFor([]), 'green');
    assert.equal(statusFor([{}]), 'amber');
    assert.equal(statusFor([{}, {}]), 'red');
    assert.equal(statusFor([{}, {}, {}]), 'red');
  });
  it('the farm-wide dry flag is said but does not colour the dot', () => {
    const dry = { id: 'dry', farmWide: true };
    assert.equal(statusFor([dry]), 'green');
    assert.equal(statusFor([{ id: 'sameCrop' }, dry]), 'amber');
    assert.equal(statusFor([{ id: 'sameCrop' }, dry], { ...FLAG_CONFIG, farmWideCountsForStatus: true }), 'red');
  });
  it('Manami says at most 2, the most field-specific first', () => {
    const f = flagsFor({ cropHistory: hist('corn', 'corn', 'corn', 'corn', 'corn', 'corn', 'corn', 'corn'), slopePct: 8, rain: rainOf([300, 300, 300, 300, 300]) });
    assert.equal(f.length, 4);
    assert.deepEqual(shownFlags(f).map((x) => x.id), ['noLegume', 'steepRowCrop']);
  });
  it('erosion risk labels', () => {
    assert.equal(erosionRisk(1.9), 'low');
    assert.equal(erosionRisk(2), 'medium');
    assert.equal(erosionRisk(6), 'medium');
    assert.equal(erosionRisk(6.1), 'high');
    assert.equal(erosionRisk(null), null);
  });
  it('thresholds come from one config object', () => {
    const cfg = { ...FLAG_CONFIG, sameCropRunYears: 2 };
    assert.deepEqual(ids(flagsFor({ cropHistory: hist('soybeans', 'corn', 'corn') }, cfg)), ['sameCrop']);
  });
});

describe('the demo fields (Part 3.1 cases)', () => {
  const cases = getMeta().requiredCases;
  const reports = Object.fromEntries(getFields().map((f) => {
    const app = { id: f.id, name: f.name, acres: f.acres, sourceIds: [f.sourceId], crops: Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])), ...fieldData(f) };
    return [f.id, fieldReportFor(app, { profile: { irrigatedFieldIds: ['f2'] } })];
  }));
  it('every field that had corn 3 years running says so', () => {
    for (const id of cases.cornThreeYearsInARow) assert.ok(ids(reports[id].flags).includes('sameCrop'), id);
  });
  it('the no-legume field and the steep field show their flag in "Manami says"', () => {
    for (const id of cases.noLegumeEightYears) assert.ok(reports[id].shown.some((f) => f.id === 'noLegume'), id);
    for (const id of cases.slopeAboveSixPct) assert.ok(reports[id].shown.some((f) => f.id === 'steepRowCrop'), id);
  });
  it('fields without a special case show the rotation flag', () => {
    for (const id of ['f1', 'f2', 'f4']) assert.ok(reports[id].shown.some((f) => f.id === 'sameCrop'), id);
  });
  it('the demo rain is drier than normal lately, so every field has the dry flag', () => {
    const w = getWeather();
    const recent = [...w.growingSeasonRainMm].sort((a, b) => a.year - b.year).slice(-5);
    const avg = recent.reduce((s, r) => s + r.value, 0) / 5;
    assert.ok(avg < w.avg30yrRainMm * 0.9);
    for (const r of Object.values(reports)) assert.ok(ids(r.flags).includes('dry'), r.id);
  });
  it('dots: amber for one field flag (the dry flag aside), red for two', () => {
    assert.deepEqual(Object.fromEntries(Object.values(reports).map((r) => [r.id, r.status])), { f1: 'amber', f2: 'amber', f3: 'red', f4: 'amber', f5: 'red' });
    assert.ok(reports.f1.shown.some((f) => f.id === 'dry')); // still said in "Manami says"
  });
  it('the field with no imagery has no greenness; the others do', () => {
    for (const id of cases.ndviNull) assert.equal(reports[id].ndvi, null, id);
    for (const r of Object.values(reports)) if (!cases.ndviNull.includes(r.id)) assert.ok(r.ndvi.length > 5, r.id);
  });
  it('8 years of history, soil, slope with risk, 10 years of rain, irrigation', () => {
    const r = reports.f3;
    assert.deepEqual(r.history.map((h) => h.year), HISTORY_YEARS);
    assert.ok(r.history.every((h) => h.key && h.label));
    assert.equal(r.slope.risk, 'high');
    assert.equal(r.soil.texture, 'loam');
    assert.equal(r.rain.years.length, 10);
    assert.equal(r.rain.years.at(-1).year, 2025);
    assert.equal(reports.f2.irrigated, true);
    assert.equal(reports.f3.irrigated, false);
  });
});

describe('a field on another farm', () => {
  it('has its CSB years and nothing else, and no made-up flags', () => {
    const r = buildFieldReport({ id: 'field-1', name: 'Back 80', acres: 80, crops: { 2023: 'Corn' } });
    assert.equal(r.history.filter((h) => h.crop).length, 1);
    assert.equal(r.history.find((h) => h.year === 2023).label, 'Corn');
    assert.equal(r.soil, null);
    assert.equal(r.slope, null);
    assert.equal(r.rain, null);
    assert.equal(r.ndvi, null);
    assert.deepEqual(r.flags, []);
    assert.equal(r.status, 'green');
  });
  it('with nothing known at all, stays grey', () => {
    assert.equal(buildFieldReport({ id: 'field-2', name: 'New ground', acres: 10 }).status, 'unknown');
  });
});
