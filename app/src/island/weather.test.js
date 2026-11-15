import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  blendFor, isStale, LOOKS, lightningAt, liveWords, lookFromReading, MAX_AGE_MS, pickedWeather, PICKS,
  REFRESH_MS, refreshDelay, weatherLine, weatherParam, windiness,
} from './weather.js';
import { createWeatherState } from './weatherState.js';
import { readingFrom, startWeatherFeed } from '../services/weatherFeed.js';

const calm = (code, extra = {}) => ({ code, wind: 4, gusts: 6, ...extra });

describe('weather codes to looks', () => {
  it('maps the WMO codes to the island looks', () => {
    const look = (code) => lookFromReading(calm(code)).look;
    assert.equal(look(0), 'clear');
    assert.equal(look(1), 'clear');
    assert.equal(look(2), 'partly');
    assert.equal(look(3), 'cloudy');
    assert.equal(look(45), 'fog');
    assert.equal(look(48), 'fog');
    for (const c of [51, 53, 55, 56, 57, 61, 63, 66, 67, 80, 81]) assert.equal(look(c), 'rain', `code ${c}`);
    for (const c of [65, 82, 95, 96, 99]) assert.equal(look(c), 'storm', `code ${c}`);
    for (const c of [71, 73, 75, 77, 85, 86]) assert.equal(look(c), 'snow', `code ${c}`);
  });

  it('makes drizzle lighter than rain, and heavy snow heavier than light snow', () => {
    const k = (code) => lookFromReading(calm(code)).intensity;
    assert.ok(k(51) < k(61) && k(61) < k(63));
    assert.ok(k(71) < k(73) && k(73) < k(75));
  });

  it('calls fair weather windy when it blows hard, but keeps rain and snow as they are', () => {
    assert.equal(lookFromReading(calm(0, { wind: 24 })).look, 'wind');
    assert.equal(lookFromReading(calm(2, { gusts: 36 })).look, 'wind');
    assert.equal(lookFromReading(calm(0, { wind: 14, gusts: 22 })).look, 'clear');
    const wetAndWindy = lookFromReading(calm(63, { wind: 28 }));
    assert.equal(wetAndWindy.look, 'rain');
    assert.ok(wetAndWindy.wind > 0.6);
  });

  it('falls back on the cloud cover for a code it does not know, and clear for nothing', () => {
    assert.equal(lookFromReading({ code: 1234, cloud: 95 }).look, 'cloudy');
    assert.equal(lookFromReading({ code: 1234, cloud: 50 }).look, 'partly');
    assert.equal(lookFromReading({ code: 1234 }).look, 'clear');
    assert.deepEqual(lookFromReading(null), { look: 'clear', intensity: 0, wind: 0 });
  });

  it('turns mph into windiness from calm to wild', () => {
    assert.equal(windiness(0), 0);
    assert.equal(windiness(6), 0);
    assert.ok(windiness(20) > 0.4 && windiness(20) < 0.6);
    assert.equal(windiness(60), 1);
    assert.equal(windiness('nonsense'), 0);
  });

  it('reads an Open-Meteo answer', () => {
    const r = readingFrom({ current: { time: '2026-11-15T01:45', weather_code: 63, cloud_cover: 100, precipitation: 1.2, snowfall: 0, wind_speed_10m: 12, wind_gusts_10m: 20, is_day: 0 } });
    assert.deepEqual(r, { code: 63, cloud: 100, wind: 12, gusts: 20, precip: 1.2, snowfall: 0, isDay: false, time: '2026-11-15T01:45' });
    assert.throws(() => readingFrom({}));
    assert.throws(() => readingFrom({ current: { weather_code: null } }));
  });
});

describe('the blend amounts', () => {
  const all = LOOKS.map((look) => [look, blendFor(pickedWeather(look))]);

  it('keeps every amount between 0 and 1', () => {
    for (const [look, b] of all) for (const [k, v] of Object.entries(b)) assert.ok(v >= 0 && v <= 1, `${look}.${k} = ${v}`);
    for (const [look, b] of LOOKS.map((l) => [l, blendFor({ look: l, intensity: 5, wind: 9 })])) for (const v of Object.values(b)) assert.ok(v >= 0 && v <= 1, look);
  });

  it('mixes nothing in for clear and calm weather', () => {
    const b = blendFor({ look: 'clear', intensity: 0, wind: 0 });
    for (const [k, v] of Object.entries(b)) assert.equal(v, 0, k);
    assert.deepEqual(blendFor(), b);
  });

  it('rains only when it rains and snows only when it snows', () => {
    for (const [look, b] of all) {
      assert.equal(b.rain > 0, look === 'rain' || look === 'storm', look);
      assert.equal(b.snow > 0, look === 'snow', look);
      assert.equal(b.settle > 0, look === 'snow', look);
      assert.equal(b.lightning > 0, look === 'storm', look);
    }
  });

  it('only a broken sky casts moving cloud shadows; overcast is flat', () => {
    const b = Object.fromEntries(all);
    assert.ok(b.partly.shadows > 0 && b.wind.shadows > 0);
    assert.equal(b.cloudy.shadows, 0);
    assert.equal(b.rain.shadows, 0);
  });

  it('gets darker from cloudy to rain to storm, and fog is the mistiest', () => {
    const b = Object.fromEntries(all);
    assert.ok(b.cloudy.dim < b.rain.dim && b.rain.dim < b.storm.dim);
    assert.ok(b.clear.cloud < b.partly.cloud && b.partly.cloud < b.cloudy.cloud);
    for (const [look, x] of all) if (look !== 'fog') assert.ok(x.fog < b.fog.fog, look);
  });

  it('rains and snows harder the heavier it is', () => {
    assert.ok(blendFor({ look: 'rain', intensity: 0.25 }).rain < blendFor({ look: 'rain', intensity: 0.9 }).rain);
    assert.ok(blendFor({ look: 'snow', intensity: 0.3 }).snow < blendFor({ look: 'snow', intensity: 1 }).snow);
  });

  it('blows hardest in a storm or when it is windy, and keeps a reading’s own wind', () => {
    const b = Object.fromEntries(all);
    assert.ok(b.wind.wind >= 0.8 && b.storm.wind >= 0.7);
    assert.ok(b.clear.wind < 0.3);
    assert.equal(blendFor({ look: 'rain', intensity: 0.5, wind: 0.9 }).wind, 0.9);
  });

  it('only flashes lightning in a full thunderstorm, not heavy rain', () => {
    assert.equal(blendFor({ look: 'storm', intensity: 1 }).lightning, 1);
    assert.equal(blendFor(lookFromReading(calm(65))).lightning, 0);
    assert.equal(blendFor(lookFromReading(calm(95))).lightning, 1);
  });
});

describe('the lightning', () => {
  it('is dark nearly all the time, with a flash now and then', () => {
    let lit = 0, flashes = 0, was = false;
    const step = 1 / 60, span = 130;
    for (let t = 0; t < span; t += step) {
      const v = lightningAt(t);
      assert.ok(v >= 0 && v <= 1);
      if (v > 0) lit++;
      if (v > 0.5 && !was) flashes++;
      was = v > 0.5;
    }
    assert.ok(lit * step < span * 0.08, `lit ${(lit * step).toFixed(1)} s of ${span}`);
    assert.ok(flashes >= 8 && flashes <= 30, `${flashes} bright moments`);
  });

  it('never flashes brightly more than twice in any second (well under three)', () => {
    for (let start = 0; start < 130; start += 0.25) {
      let n = 0, was = false;
      for (let t = start; t < start + 1; t += 1 / 120) {
        const on = lightningAt(t) > 0.5;
        if (on && !was) n++;
        was = on;
      }
      assert.ok(n <= 2, `${n} flashes in the second from ${start}`);
    }
  });

  it('is 0 for nonsense times', () => {
    assert.equal(lightningAt(-1), 0);
    assert.equal(lightningAt(NaN), 0);
  });
});

describe('the refresh timing', () => {
  it('asks every 20 minutes (between 15 and 30)', () => {
    assert.equal(refreshDelay(0), REFRESH_MS);
    assert.ok(REFRESH_MS >= 15 * 60e3 && REFRESH_MS <= 30 * 60e3);
  });

  it('tries again soon after a failure, then backs off to the usual 20 minutes', () => {
    const d = [1, 2, 3, 4, 5, 6, 50].map(refreshDelay);
    assert.equal(d[0], 60e3);
    for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1], `${d[i]} after ${d[i - 1]}`);
    assert.equal(d[d.length - 1], REFRESH_MS);
    assert.equal(refreshDelay(-3), REFRESH_MS);
  });

  it('knows when a reading is due again', () => {
    const now = 1e12;
    assert.equal(isStale(0, now), true);
    assert.equal(isStale(now - 5 * 60e3, now), false);
    assert.equal(isStale(now - REFRESH_MS, now), true);
    assert.ok(MAX_AGE_MS > REFRESH_MS);
  });
});

describe('the feed', () => {
  const answer = (code) => ({ ok: true, json: async () => ({ current: { weather_code: code, cloud_cover: 90, wind_speed_10m: 5, wind_gusts_10m: 8, is_day: 1, time: 'x' } }) });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('asks for the farm’s place, rounded, and hands the reading on', async () => {
    const urls = [], got = [];
    const feed = startWeatherFeed({ place: () => ({ lat: 42.034567, lon: -93.461234 }), onReading: (r) => got.push(r), fetchImpl: async (u) => { urls.push(u); return answer(61); } });
    await tick(); await tick();
    feed.stop();
    assert.equal(got.length, 1);
    assert.equal(got[0].code, 61);
    assert.match(urls[0], /latitude=42\.035&longitude=-93\.461/);
    assert.match(urls[0], /wind_speed_unit=mph/);
  });

  it('fails quietly offline, and asks nothing without a place', async () => {
    const got = [];
    let asked = 0;
    const down = startWeatherFeed({ place: () => ({ lat: 42, lon: -93 }), onReading: (r) => got.push(r), fetchImpl: async () => { asked++; throw new TypeError('Failed to fetch'); } });
    const bad = startWeatherFeed({ place: () => ({ lat: 42, lon: -93 }), onReading: (r) => got.push(r), fetchImpl: async () => { asked++; return { ok: false, status: 503 }; } });
    const nowhere = startWeatherFeed({ place: () => null, onReading: (r) => got.push(r), fetchImpl: async () => { asked++; return answer(0); } });
    await tick(); await tick();
    down.stop(); bad.stop(); nowhere.stop();
    assert.equal(asked, 2);
    assert.deepEqual(got, []);
  });
});

describe('the weather state', () => {
  it('starts as fair weather with no reading, then follows the live weather', () => {
    const w = createWeatherState({ now: () => 5 });
    assert.equal(w.state.look, 'clear');
    assert.equal(w.state.source, 'none');
    const seen = [];
    w.subscribe((s, prev) => seen.push([prev.look, s.look, s.source]));
    w.setLive({ code: 63, wind: 5, gusts: 8 });
    assert.equal(w.state.look, 'rain');
    assert.equal(w.state.source, 'live');
    assert.equal(w.state.live.reading.code, 63);
    assert.deepEqual(seen, [['clear', 'rain', 'live']]);
    assert.ok(Object.isFrozen(w.state));
  });

  it('previews a picked look over the live one, and goes back to Live', () => {
    const w = createWeatherState();
    w.setLive({ code: 0, wind: 3 });
    const seen = [];
    const off = w.subscribe((s) => seen.push(`${s.look}/${s.source}`));
    w.pick('snow');
    assert.equal(w.state.picked, 'snow');
    w.setLive({ code: 3, wind: 3 }); // the live weather moves on under the preview
    assert.equal(w.state.look, 'snow');
    assert.equal(w.state.live.look, 'cloudy');
    w.pick(null);
    assert.equal(w.state.look, 'cloudy');
    off();
    w.pick('rain');
    assert.deepEqual(seen, ['snow/preview', 'snow/preview', 'cloudy/live']);
  });

  it('says nothing when nothing changed, and a listener’s error does not stop the others', () => {
    const w = createWeatherState();
    let n = 0;
    w.subscribe(() => { throw new Error('boom'); });
    w.subscribe(() => n++);
    const err = console.error;
    console.error = () => {};
    try {
      w.pick(null);
      assert.equal(n, 0);
      w.pick('fog');
      w.pick('fog');
      assert.equal(n, 1);
    } finally { console.error = err; }
  });
});

describe('the words', () => {
  it('reads ?weather= values, with a few everyday names', () => {
    for (const p of ['rain', 'snow', 'storm', 'fog', 'clear', 'cloudy', 'wind', 'partly']) assert.equal(weatherParam(p), p);
    assert.equal(weatherParam('Windy'), 'wind');
    assert.equal(weatherParam('overcast'), 'cloudy');
    assert.equal(weatherParam('drizzle'), 'rain');
    assert.equal(weatherParam('thunderstorm'), 'storm');
    assert.equal(weatherParam('live'), null);
    assert.equal(weatherParam(null), null);
    assert.equal(weatherParam('lava'), null);
  });

  it('lets every pick in the popover be previewed', () => {
    for (const p of PICKS) assert.equal(pickedWeather(p).look, p);
    assert.equal(pickedWeather('lava').look, 'clear');
  });

  it('gives Manami one plain line for weather worth mentioning, and none for fair weather', () => {
    assert.equal(weatherLine('rain'), 'It’s raining at your farm right now, so it’s raining here too.');
    assert.equal(weatherLine('clear'), null);
    assert.equal(weatherLine('partly'), null);
    for (const look of ['cloudy', 'fog', 'rain', 'storm', 'snow', 'wind']) {
      const line = weatherLine(look);
      assert.ok(line && line.length < 110, look);
      assert.doesNotMatch(line, /[\u{1F300}-\u{1FAFF}☀-➿]/u); // no emoji
    }
  });

  it('names the live weather for the popover', () => {
    assert.equal(liveWords({ look: 'rain' }), 'Raining at your farm now');
    assert.match(liveWords(null), /fair weather/);
  });
});
