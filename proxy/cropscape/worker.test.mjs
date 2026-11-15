// node --test proxy/cropscape/worker.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { corsFor, handle, upstreamUrl } from './worker.js';

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
