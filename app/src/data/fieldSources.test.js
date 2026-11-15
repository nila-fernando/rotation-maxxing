import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTerrarium, fieldSlope } from './terrain.js';
import { farmRain, seasonTotals } from './rain.js';
import { fillNdvi, lastSeason, ndviFromStats, pickPasses } from './greenness.js';

const square = { type: 'Polygon', coordinates: [[[-93.36, 42.02], [-93.3575, 42.02], [-93.3575, 42.0218], [-93.36, 42.0218], [-93.36, 42.02]]] };

describe('slope from elevation tiles', () => {
  /** A fake tile set: elevation rises `gradePct` % going east (metres per metre of ground). */
  function plane(gradePct) {
    const SIZE = 256, Z = 14;
    const decode = async (blob) => blob; // the fake fetch hands back RGBA already
    const fetchFn = async (url) => {
      const [, x, y] = /terrarium\/14\/(\d+)\/(\d+)/.exec(url).map(Number);
      const lat = 42.02;
      const cell = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (SIZE * 2 ** Z);
      const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
      for (let py = 0; py < SIZE; py++) for (let px = 0; px < SIZE; px++) {
        const m = 300 + ((x - 3900) * SIZE + px) * cell * (gradePct / 100) + 32768;
        const i = (py * SIZE + px) * 4;
        rgba[i] = Math.floor(m / 256); rgba[i + 1] = Math.floor(m % 256); rgba[i + 2] = Math.round((m % 1) * 256); rgba[i + 3] = 255;
      }
      return { ok: true, blob: async () => rgba };
    };
    return { fetchFn, decode };
  }
  test('terrarium decoding', () => {
    const e = decodeTerrarium(new Uint8ClampedArray([129, 44, 128, 255].concat(Array(256 * 256 * 4 - 4).fill(0))));
    assert.ok(Math.abs(e[0] - 300.5) < 1e-6);
  });
  test('a 4% plane reads about 4%, a flat one 0%', async () => {
    assert.ok(Math.abs((await fieldSlope(square, plane(4))) - 4) < 0.3);
    assert.equal(await fieldSlope(square, plane(0)), 0);
  });
  test('no tiles: no slope', async () => {
    assert.equal(await fieldSlope(square, { fetchFn: async () => ({ ok: false }), decode: async () => null }), null);
  });
});

describe('growing-season rain from NASA POWER', () => {
  const monthly = (fn) => {
    const m = {};
    for (let y = 1991; y <= 2026; y++) for (let mo = 1; mo <= 13; mo++) m[`${y}${String(mo).padStart(2, '0')}`] = fn(y, mo);
    return { properties: { parameter: { PRECTOTCORR_SUM: m } } };
  };
  test('April-September totals, the 1991-2020 average, and only whole seasons', () => {
    const r = seasonTotals(monthly((y, mo) => (y === 2026 && mo > 8 ? -999 : 100)));
    assert.equal(r.avg30yrRainMm, 600);
    assert.equal(r.growingSeasonRainMm.at(-1).year, 2025); // 2026 has no September yet
    assert.equal(r.growingSeasonRainMm[0].value, 600);
  });
  test('no answer or a short record: null, not a guess', async () => {
    assert.equal(await farmRain([-93, 42], { fetchFn: async () => ({ ok: false }) }), null);
    assert.equal(seasonTotals(monthly((y) => (y < 2010 ? -999 : 100))), null);
  });
});

describe('greenness from NASA HLS', () => {
  const item = (collection, date, cloud) => ({ collection, id: `${collection}-${date}`, properties: { datetime: `${date}T17:00:00Z`, 'eo:cloud_cover': cloud } });
  test('the latest finished season', () => {
    assert.equal(lastSeason(new Date(2026, 10, 15)).year, 2026);
    assert.equal(lastSeason(new Date(2026, 5, 1)).year, 2025);
  });
  test('the clearest pass in each 3-week window', () => {
    const p = pickPasses([item('hls2-s30', '2026-04-05', 10), item('hls2-l30', '2026-04-09', 2), item('hls2-s30', '2026-05-01', 5)], '2026-04-01T00:00:00Z');
    assert.deepEqual(p.map((x) => x.id), ['hls2-l30-2026-04-09', 'hls2-s30-2026-05-01']);
  });
  test('NDVI from mean red and near-infrared', () => {
    assert.equal(ndviFromStats({ properties: { statistics: { B04_b1: { mean: 500, count: 9 }, B8A_b1: { mean: 3500, count: 9 } } } }, 'B8A'), 0.75);
    assert.equal(ndviFromStats({ properties: { statistics: { B04_b1: { mean: 500, count: 0 }, B8A_b1: { mean: 3500, count: 0 } } } }, 'B8A'), null);
  });
  test('a season curve per field; too few clear passes: none', async () => {
    const dates = ['2026-04-10', '2026-05-05', '2026-06-01', '2026-06-25', '2026-07-20', '2026-08-15'];
    const fetchFn = async (url) => {
      if (url.endsWith('/search')) return { ok: true, json: async () => ({ features: dates.map((d) => item('hls2-s30', d, 1)) }) };
      return { ok: true, json: async () => ({ properties: { statistics: { B04_b1: { mean: 600, count: 9 }, B8A_b1: { mean: 2400, count: 9 } } } }) };
    };
    const out = await fillNdvi([{ id: 'a', geometry: square }], { fetchFn, now: new Date(2026, 10, 15) });
    assert.equal(out.a.length, 6);
    assert.equal(out.a[0].value, 0.6);
    const few = async (url) => (url.endsWith('/search') ? { ok: true, json: async () => ({ features: dates.slice(0, 2).map((d) => item('hls2-s30', d, 1)) }) } : fetchFn(url));
    assert.deepEqual(await fillNdvi([{ id: 'a', geometry: square }], { fetchFn: few, now: new Date(2026, 10, 15) }), {});
  });
});
