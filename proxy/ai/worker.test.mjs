// node --test proxy/ai/worker.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { corsFor, createDailyCap, createWorker } from './worker.js';
import { configFromEnv, createAiHandler } from '../../app/server/ai/handler.js';

const APP = 'https://nila-fernando.github.io';
const BASE = 'https://rotation-maxxing-ai.example.workers.dev';

/** A stand-in for the app's handler: records what it got, answers a tiny SSE stream for chat. */
function fakeHandler() {
  const calls = [];
  const handle = async (request, info) => {
    calls.push({ url: request.url, method: request.method, origin: request.headers.get('origin'), ip: info.ip, body: request.body ? await request.text() : '' });
    if (request.url.endsWith('/health')) return new Response(JSON.stringify({ ok: true, ai: true }), { headers: { 'Content-Type': 'application/json' } });
    const enc = new TextEncoder();
    const stream = new ReadableStream({ start(c) { c.enqueue(enc.encode('event: start\ndata: {}\n\n')); c.enqueue(enc.encode('event: done\ndata: {}\n\n')); c.close(); } });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  return { calls, handle };
}
const req = (path, { origin = APP, method = 'GET', ip = '1.2.3.4', body } = {}) => new Request(`${BASE}${path}`, {
  method,
  headers: { ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': ip, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body,
});
const chat = (o = {}) => req('/api/ai/chat', { method: 'POST', body: '{"v":1}', ...o });

describe('Ask Manami Worker', () => {
  test('CORS only for the app origins', () => {
    assert.equal(corsFor(APP)['Access-Control-Allow-Origin'], APP);
    assert.equal(corsFor('http://localhost:5173')['Access-Control-Allow-Origin'], 'http://localhost:5173');
    assert.equal(corsFor('https://evil.example'), null);
    assert.equal(corsFor(null), null);
    assert.match(corsFor(APP)['Access-Control-Allow-Headers'], /Content-Type/);
  });

  test('preflight: 204 for the app, 403 for others', async () => {
    const { handle, calls } = fakeHandler();
    const serve = createWorker({ handle });
    const ok = await serve(req('/api/ai/chat', { method: 'OPTIONS' }));
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), APP);
    const no = await serve(req('/api/ai/chat', { method: 'OPTIONS', origin: 'https://evil.example' }));
    assert.equal(no.status, 403);
    assert.equal(calls.length, 0);
  });

  test('other browser origins get a friendly 403 and never reach the handler', async () => {
    const { handle, calls } = fakeHandler();
    const res = await createWorker({ handle })(chat({ origin: 'https://evil.example' }));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'origin_not_allowed');
    assert.equal(calls.length, 0);
  });

  test('EXTRA_ORIGINS-style allowed list is honoured', async () => {
    const { handle } = fakeHandler();
    const res = await createWorker({ handle, allowed: ['https://farm.example'] })(req('/api/ai/health', { origin: 'https://farm.example' }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://farm.example');
  });

  test('passes chat through with CORS, the stream intact, no Origin and the client IP', async () => {
    const { handle, calls } = fakeHandler();
    const res = await createWorker({ handle })(chat());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), APP);
    assert.equal(res.headers.get('Content-Type'), 'text/event-stream');
    assert.match(await res.text(), /event: start[\s\S]*event: done/);
    assert.equal(calls[0].origin, null);
    assert.equal(calls[0].ip, '1.2.3.4');
    assert.equal(calls[0].body, '{"v":1}');
    assert.equal(new URL(calls[0].url).pathname, '/api/ai/chat');
  });

  test('any /api/ai/ route goes to the handler (jar later); other paths 404', async () => {
    const { handle, calls } = fakeHandler();
    const serve = createWorker({ handle });
    await serve(req('/api/ai/jar', { method: 'POST', body: '{}' }));
    assert.equal(new URL(calls[0].url).pathname, '/api/ai/jar');
    const res = await serve(req('/elsewhere'));
    assert.equal(res.status, 404);
    assert.equal(calls.length, 1);
  });

  test('per-IP limit on POSTs, health stays open', async () => {
    const { handle } = fakeHandler();
    let t = 0;
    const serve = createWorker({ handle, perMinute: 2, now: () => t });
    assert.equal((await serve(chat())).status, 200);
    assert.equal((await serve(chat())).status, 200);
    const third = await serve(chat());
    assert.equal(third.status, 429);
    assert.equal((await third.json()).error.code, 'rate_limited');
    assert.ok(Number(third.headers.get('Retry-After')) > 0);
    assert.equal(third.headers.get('Access-Control-Allow-Origin'), APP);
    assert.equal((await serve(chat({ ip: '5.6.7.8' }))).status, 200); // another farmer
    assert.equal((await serve(req('/api/ai/health'))).status, 200);
    t = 61_000;
    assert.equal((await serve(chat())).status, 200);
  });

  test('daily cap answers 503 daily_limit, and resets the next day', async () => {
    const { handle } = fakeHandler();
    let t = 0;
    const serve = createWorker({ handle, perMinute: 100, daily: 2, now: () => t });
    await serve(chat());
    await serve(chat({ ip: '9.9.9.9' }));
    const res = await serve(chat({ ip: '8.8.8.8' }));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'daily_limit');
    t = 86_400_000;
    assert.equal((await serve(chat())).status, 200);
  });

  test('a handler that throws becomes friendly JSON', async () => {
    const serve = createWorker({ handle: async () => { throw new Error('boom'); } });
    const res = await serve(chat());
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error.code, 'server_error');
  });

  test('daily cap counter', () => {
    const cap = createDailyCap(1, () => 0);
    assert.equal(cap(), true);
    assert.equal(cap(), false);
  });

  test('with the real handler: health through the Worker (cross-site Origin is fine)', async () => {
    const handle = createAiHandler({ config: configFromEnv({}), getClient: () => { throw new Error('no client'); } });
    const res = await createWorker({ handle })(req('/api/ai/health'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), APP);
    assert.deepEqual(await res.json(), { ok: true, v: 1, ai: false, reason: 'no_key' });
  });
});