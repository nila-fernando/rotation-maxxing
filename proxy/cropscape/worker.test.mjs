// node --test proxy/cropscape/worker.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { corsFor, handle, nassUpstreamUrl, upstreamUrl } from './worker.js';

const APP = 'https://nila-fernando.github.io';
const OK_PATH = '/axis2/services/CDLService/GetCDLValue?year=2025&x=264000.0&y=2088000.0';
const ANSWER = '<ns1:GetCDLValueResponse><Result>{x: 264000.0, y: 2088000.0, value: 5, category: "Soybeans", color: "#267300"}</Result></ns1:GetCDLValueResponse>';

/** A Map-backed stand-in for caches.default. */
function memCache() {
  const m = new Map();
  return { m, match: async (req) => (m.has(req.url) ? m.get(req.url).clone() : undefined), put: async (req, res) => { m.set(req.url, res); } };
}
const req = (path, { origin = APP, method = 'GET' } = {}) => new Request(`https://proxy.example.workers.dev${path}`, { method, headers: origin ? { Origin: origin } : {} });
const upstream = (status = 200, body = ANSWER) => {
  const calls = [];
  return { calls, fetchFn: async (url) => { calls.push(url); return new Response(body, { status, headers: { 'Content-Type': 'application/xml;charset=UTF-8' } }); } };
};

describe('CropScape proxy', () => {
  test('only well-formed CDL point lookups are forwarded', () => {
    const u = (p) => upstreamUrl(new URL(`https://p.dev${p}`), 2026);
    assert.equal(u(OK_PATH), 'https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=2025&x=264000.0&y=2088000.0');
    assert.equal(u('/axis2/services/CDLService/GetCDLFile?year=2025&fips=19'), null); // other services
    assert.equal(u('/axis2/services/CDLService/GetCDLValue?year=2025&x=1&y=2&extra=1'), null);
    assert.equal(u('/axis2/services/CDLService/GetCDLValue?year=2030&x=1&y=2'), null); // future
    assert.equal(u('/axis2/services/CDLService/GetCDLValue?year=1999&x=1&y=2'), null);
    assert.equal(u('/axis2/services/CDLService/GetCDLValue?year=2025&x=abc&y=2'), null);
    assert.equal(u('/axis2/services/CDLService/GetCDLValue?year=2025&x=9e9&y=2'), null);
    assert.equal(u('/'), null);
  });

  test('CORS only for the app\'s origins', async () => {
    assert.equal(corsFor(APP)['Access-Control-Allow-Origin'], APP);
    assert.equal(corsFor('https://evil.example'), null);
    const pre = await handle(req(OK_PATH, { method: 'OPTIONS' }), { cache: memCache() });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), APP);
    const { fetchFn, calls } = upstream();
    const bad = await handle(req(OK_PATH, { origin: 'https://evil.example' }), { fetchFn, cache: memCache() });
    assert.equal(bad.status, 403);
    assert.equal(calls.length, 0);
  });

  test('forwards, adds CORS, and caches a good answer at the edge', async () => {
    const cache = memCache();
    const { fetchFn, calls } = upstream();
    const pending = [];
    const a = await handle(req(OK_PATH), { fetchFn, cache, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('Access-Control-Allow-Origin'), APP);
    assert.equal(a.headers.get('X-Proxy-Cache'), 'MISS');
    assert.match(await a.text(), /category: "Soybeans"/);
    const b = await handle(req(OK_PATH), { fetchFn, cache });
    assert.equal(b.headers.get('X-Proxy-Cache'), 'HIT');
    assert.equal(b.headers.get('Access-Control-Allow-Origin'), APP);
    assert.match(await b.text(), /Soybeans/);
    assert.equal(calls.length, 1);
  });

  test('CropScape errors pass through uncached (the app retries), with CORS so the browser can see them', async () => {
    const cache = memCache();
    const { fetchFn, calls } = upstream(503, 'Service Unavailable');
    const r = await handle(req(OK_PATH), { fetchFn, cache });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), APP);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    await handle(req(OK_PATH), { fetchFn, cache });
    assert.equal(calls.length, 2);
    const down = await handle(req(OK_PATH), { fetchFn: async () => { throw new Error('network'); }, cache });
    assert.equal(down.status, 504);
    assert.equal(down.headers.get('Access-Control-Allow-Origin'), APP);
  });

  test('other paths and methods are refused', async () => {
    assert.equal((await handle(req('/anything'), { cache: memCache() })).status, 404);
    assert.equal((await handle(req(OK_PATH, { method: 'POST' }), { cache: memCache() })).status, 405);
  });
});

describe('NASS Quick Stats proxy', () => {
  const KEY = 'test-key-0000';
  const Q = '/nass/api_GET/?commodity_desc=CORN&commodity_desc=SOYBEANS&agg_level_desc=STATE&state_alpha=KS&year__GE=2020&format=JSON';
  const DATA = '{"data":[{"short_desc":"CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU","Value":"4.00"}]}';
  const nassUpstream = (status = 200, body = DATA) => {
    const calls = [];
    return { calls, fetchFn: async (url) => { calls.push(url); return new Response(body, { status, headers: { 'Content-Type': 'application/json' } }); } };
  };

  test('adds the key server side, drops the client\'s, and passes only allowed filters', () => {
    const u = (p, key = KEY) => nassUpstreamUrl(new URL(`https://p.dev${p}`), key);
    const t = u(`${Q}&key=CLIENTKEY`);
    const up = new URL(t.url);
    assert.equal(up.origin + up.pathname, 'https://quickstats.nass.usda.gov/api/api_GET/');
    assert.deepEqual(up.searchParams.getAll('key'), [KEY]);
    assert.ok(!t.url.includes('CLIENTKEY'));
    assert.deepEqual(up.searchParams.getAll('commodity_desc'), ['CORN', 'SOYBEANS']);
    assert.equal(up.searchParams.get('format'), 'JSON');
    assert.ok(!t.cacheKey.includes(KEY), 'the cache key has no key in it');
    assert.equal(u('/nass/api_GET?year=2024&format=CSV').url.endsWith('format=JSON'), true); // JSON only
    assert.equal(u('/nass/get_counts/?commodity_desc=CORN'), null); // other Quick Stats calls
    assert.equal(u('/nass/api_GET/?callback=x&commodity_desc=CORN'), null); // unknown parameter
    assert.equal(u('/nass/api_GET/?year__GE=20x0'), null);
    assert.equal(u('/nass/api_GET/?key=K'), null); // nothing to filter on
    assert.equal(u('/nass/api_GET/'), null);
    assert.equal(u(`/nass/api_GET/?commodity_desc=${'A'.repeat(121)}`), null);
    assert.equal(u(`/nass/api_GET/?${Array.from({ length: 81 }, (_, i) => `year=${2000 + (i % 20)}`).join('&')}`), null);
    assert.equal(u(Q, ''), null); // no secret set
    // NASS's own names go through: $, /, parentheses, commas, &
    const names = u('/nass/api_GET/?short_desc=SORGHUM%2C+GRAIN+-+PRICE+RECEIVED%2C+MEASURED+IN+%24+%2F+CWT&short_desc=BEANS%2C+DRY+EDIBLE%2C+(EXCL+CHICKPEAS+%26+LIMA)+-+ACRES+HARVESTED');
    assert.deepEqual(new URL(names.url).searchParams.getAll('short_desc'), ['SORGHUM, GRAIN - PRICE RECEIVED, MEASURED IN $ / CWT', 'BEANS, DRY EDIBLE, (EXCL CHICKPEAS & LIMA) - ACRES HARVESTED']);
  });

  test('forwards with the secret, adds CORS, caches good answers for a day', async () => {
    const cache = memCache();
    const { fetchFn, calls } = nassUpstream();
    const pending = [];
    const a = await handle(req(Q), { fetchFn, cache, nassKey: KEY, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('Access-Control-Allow-Origin'), APP);
    assert.equal(a.headers.get('Cache-Control'), 'public, max-age=86400');
    assert.equal(await a.text(), DATA);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]).searchParams.get('key'), KEY);
    for (const k of cache.m.keys()) assert.ok(!k.includes(KEY));
    const b = await handle(req(Q), { fetchFn, cache, nassKey: KEY });
    assert.equal(b.headers.get('X-Proxy-Cache'), 'HIT');
    assert.equal(b.headers.get('Access-Control-Allow-Origin'), APP);
    assert.equal(calls.length, 1);
  });

  test('"no data", errors and timeouts pass through uncached; no secret is a 503', async () => {
    const cache = memCache();
    const none = nassUpstream(400, '{"error":["no data"]}');
    const r = await handle(req(Q), { fetchFn: none.fetchFn, cache, nassKey: KEY });
    assert.equal(r.status, 400);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.equal(cache.m.size, 0);
    const down = await handle(req(Q), { fetchFn: async () => { throw new Error('network'); }, cache, nassKey: KEY });
    assert.equal(down.status, 504);
    const unset = await handle(req(Q), { fetchFn: none.fetchFn, cache, nassKey: '' });
    assert.equal(unset.status, 503);
    assert.equal(unset.headers.get('Access-Control-Allow-Origin'), APP);
  });

  test('refuses other origins, methods and queries', async () => {
    const { fetchFn, calls } = nassUpstream();
    assert.equal((await handle(req(Q, { origin: 'https://evil.example' }), { fetchFn, cache: memCache(), nassKey: KEY })).status, 403);
    assert.equal((await handle(req(Q, { method: 'POST' }), { fetchFn, cache: memCache(), nassKey: KEY })).status, 405);
    assert.equal((await handle(req('/nass/api_GET/?callback=alert'), { fetchFn, cache: memCache(), nassKey: KEY })).status, 403);
    assert.equal(calls.length, 0);
  });
});
