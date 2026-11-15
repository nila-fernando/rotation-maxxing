import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildUpdates, dayName, fetchForecast, forecastFrom, unseenCount } from './updates.js';

const TODAY = new Date(2026, 10, 15); // a Sunday
const day = (date, o = {}) => ({ date, minF: 40, maxF: 60, rainIn: 0, gustMph: 15, ...o });
const week = (over = {}) => ({ days: ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'].map((d) => day(d, over[d])) });

describe('farm updates', () => {
  it('flag the week’s frost, heavy rain, wind and heat at the farm, with plain words', () => {
    const u = buildUpdates({ today: TODAY, forecast: week({ '2026-11-17': { minF: 26 }, '2026-11-18': { rainIn: 1.4, gustMph: 52 } }) });
    const byKind = Object.fromEntries(u.map((x) => [x.kind, x]));
    assert.equal(byKind.frost.title, 'Frost Tuesday night');
    assert.match(byKind.frost.body, /^A low of 26°F at the farm\. A hard freeze/);
    assert.equal(byKind.rain.title, 'Heavy rain Wednesday');
    assert.match(byKind.rain.body, /About 1\.4 in/);
    assert.equal(byKind.wind.title, 'Strong wind Wednesday');
    assert.equal(byKind.heat, undefined);
  });
  it('say nothing about a quiet week', () => {
    assert.deepEqual(buildUpdates({ today: TODAY, forecast: week() }), []);
  });
  it('a dry week only in the growing season', () => {
    const june = new Date(2026, 5, 1);
    const dry = { days: ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map((d) => day(d)) };
    assert.equal(buildUpdates({ today: june, forecast: dry })[0].kind, 'dry');
  });
  it('ask for the season check-in when it’s due, with a button', () => {
    const [u] = buildUpdates({ today: TODAY, seasonsDue: [2026] });
    assert.equal(u.title, 'How did 2026 go?');
    assert.deepEqual(u.action, { label: 'Tell Manami', act: 'season' });
  });
  it('the rain trend from NASA POWER: recent seasons against the 30-year normal', () => {
    const rain = { avg30yrRainMm: 500, growingSeasonRainMm: [{ year: 2023, value: 380 }, { year: 2024, value: 400 }, { year: 2025, value: 390 }] };
    const [u] = buildUpdates({ today: TODAY, fields: [{ rain }] });
    assert.equal(u.title, 'Drier than normal lately');
    assert.match(u.body, /averaged 15\.4 in of rain, against 19\.7 in normally/);
  });
  it('count the new ones', () => {
    const u = buildUpdates({ today: TODAY, seasonsDue: [2026], forecast: week({ '2026-11-16': { minF: 30 } }) });
    assert.equal(unseenCount(u, new Set()), 2);
    assert.equal(unseenCount(u, new Set(u.map((x) => x.id))), 0);
  });
  it('name days as a farmer would', () => {
    assert.equal(dayName('2026-11-15', TODAY), 'today');
    assert.equal(dayName('2026-11-16', TODAY), 'tomorrow');
    assert.equal(dayName('2026-11-19', TODAY), 'Thursday');
  });
  it('read Open-Meteo’s daily forecast, and stay quiet if it fails', async () => {
    const json = { daily: { time: ['2026-11-15'], temperature_2m_min: [30.1], temperature_2m_max: [48], precipitation_sum: [0.2], wind_gusts_10m_max: [20] } };
    assert.deepEqual(forecastFrom(json).days[0], { date: '2026-11-15', minF: 30.1, maxF: 48, rainIn: 0.2, gustMph: 20 });
    let asked = '';
    const ok = await fetchForecast({ lat: 42.02, lon: -93.36 }, { fetchImpl: async (url) => { asked = url; return { ok: true, json: async () => json }; } });
    assert.match(asked, /api\.open-meteo\.com\/v1\/forecast\?latitude=42\.020&longitude=-93\.360.*temperature_unit=fahrenheit/);
    assert.equal(ok.days.length, 1);
    assert.equal(await fetchForecast({ lat: 1, lon: 1 }, { fetchImpl: async () => { throw new Error('offline'); } }), null);
  });
});
