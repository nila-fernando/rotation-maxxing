import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configFromEnv, createAiHandler, FALLBACK_BETA } from './handler.js';
import { buildJarParams, JAR_SCHEMA, normaliseJarOutput, parseJarMessage, toHundred, validateJarBody } from './jar.js';

const config = configFromEnv({ ANTHROPIC_API_KEY: 'sk-test-not-real', AI_MODEL: 'claude-sonnet-5-5' });
const DATA = 'A'.repeat(400);
const GOOD = { v: 1, image: { mediaType: 'image/jpeg', data: DATA }, elapsed: 'ok', fieldName: 'West 140' };
const READING = {
  usable: true, problems: [],
  box: { x0: 0.35, y0: 0.1, x1: 0.65, y1: 0.9 },
  layers: [
    { type: 'air', y0: 0.1, y1: 0.15 }, { type: 'water', y0: 0.15, y1: 0.5 },
    { type: 'clay', y0: 0.5, y1: 0.6 }, { type: 'silt', y0: 0.6, y1: 0.7 }, { type: 'sand', y0: 0.7, y1: 0.9 },
  ],
  sandPct: 50, siltPct: 25, clayPct: 25, confidence: 'high', note: 'Nice clear lines. Your sand sits thick at the bottom.',
};
const fakeClient = (message) => {
  const calls = [];
  return { calls, beta: { messages: { create: async (params, opts) => { calls.push({ params, opts }); if (message instanceof Error) throw message; return message; } } } };
};
const post = (body, headers = {}) => new Request('http://localhost:5173/api/ai/jar', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const msg = (obj, extra = {}) => ({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }], usage: {}, ...extra });

test('jar request validation', () => {
  assert.equal(validateJarBody(GOOD).fieldName, 'West 140');
  assert.equal(validateJarBody({ ...GOOD, elapsed: undefined }).elapsed, 'ok');
  for (const b of [null, { ...GOOD, v: 2 }, { ...GOOD, image: null }, { ...GOOD, image: { mediaType: 'image/gif', data: DATA } },
    { ...GOOD, image: { mediaType: 'image/jpeg', data: 'short' } }, { ...GOOD, image: { mediaType: 'image/jpeg', data: `${'A'.repeat(399)}!` } },
    { ...GOOD, elapsed: 'week' }, { ...GOOD, fieldName: 5 }]) {
    assert.throws(() => validateJarBody(b), /./);
  }
  assert.equal(validateJarBody({ ...GOOD, fieldName: '<b>Home</b>' }).fieldName, 'bHome/b');
});

test('jar params: vision block, structured output, medium effort, fallbacks, no forced tool or prefill', () => {
  const p = buildJarParams(config, validateJarBody(GOOD));
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.deepEqual(p.output_config, { effort: 'medium', format: { type: 'json_schema', schema: JAR_SCHEMA } });
  assert.deepEqual(p.thinking, { type: 'adaptive' });
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, [FALLBACK_BETA]);
  assert.equal(p.tool_choice, undefined);
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].role, 'user');
  assert.deepEqual(p.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: DATA } });
  assert.match(p.messages[0].content[1].text, /a day or more.*West 140/);
  const off = buildJarParams({ ...config, fallbacks: false }, validateJarBody(GOOD));
  assert.equal(off.betas, undefined);
});

test('output normalisation: clamps, sorts, drops bad layers, reworks percentages', () => {
  const r = normaliseJarOutput({
    ...READING,
    box: { x0: 0.7, y0: -0.2, x1: 0.3, y1: 1.4 },
    layers: [
      { type: 'sand', y0: 0.7, y1: 1.2 }, { type: 'mud', y0: 0.1, y1: 0.2 }, { type: 'water', y0: 0, y1: 0.5 },
      { type: 'clay', y0: 0.45, y1: 0.6 }, { type: 'silt', y0: 'x', y1: 0.7 }, { type: 'silt', y0: 0.62, y1: 0.7 },
    ],
    sandPct: 90, siltPct: 90, clayPct: 90, confidence: 'certain', note: '**Great** jar 😀',
    problems: [{ code: 'weird', text: 'Tilted a bit' }, 'nope'],
  });
  assert.deepEqual(r.box, { x0: 0.3, y0: 0, x1: 0.7, y1: 1 });
  assert.deepEqual(r.layers.map((l) => l.type), ['water', 'clay', 'silt', 'sand']);
  assert.equal(r.layers[0].y0, 0);
  assert.equal(r.layers.at(-1).y1, 1);
  for (let i = 1; i < r.layers.length; i++) assert.equal(r.layers[i].y0, r.layers[i - 1].y1);
  assert.equal(r.sandPct + r.siltPct + r.clayPct, 100);
  assert.ok(r.sandPct > r.clayPct);
  assert.equal(r.confidence, 'low');
  assert.equal(r.note, 'Great jar');
  assert.deepEqual(r.problems, [{ code: 'other', text: 'Tilted a bit' }]);
  assert.equal(normaliseJarOutput('x'), null);
  const none = normaliseJarOutput({ ...READING, layers: [{ type: 'water', y0: 0.1, y1: 0.9 }] });
  assert.equal(none.usable, false);
  assert.ok(none.problems.length);
  assert.deepEqual(toHundred([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(toHundred([0, 0, 0]), [null, null, null]);
  assert.equal(parseJarMessage({ content: [{ type: 'text', text: 'not json' }] }), null);
});

test('POST /jar: reads the photo once and gives back the checked reading', async () => {
  const client = fakeClient(msg(READING));
  const handle = createAiHandler({ config, getClient: () => client });
  const res = await handle(post(GOOD));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reading.usable, true);
  assert.deepEqual(body.reading.layers.map((l) => l.type), ['air', 'water', 'clay', 'silt', 'sand']);
  assert.deepEqual([body.reading.sandPct, body.reading.siltPct, body.reading.clayPct], [50, 25, 25]);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].params.output_config.format.type, 'json_schema');
  // health lists the route
  const h = await (await handle(new Request('http://localhost/api/ai/health'))).json();
  assert.ok(h.routes.includes('jar'));
});

test('POST /jar: errors and limits', async () => {
  const handle = createAiHandler({ config, getClient: () => fakeClient(msg(READING)) });
  assert.equal((await handle(new Request('http://localhost/api/ai/jar'))).status, 405);
  assert.equal((await handle(post({ ...GOOD, v: 3 }))).status, 400);
  assert.equal((await handle(post('{bad'))).status, 400);
  assert.equal((await handle(post({ ...GOOD, image: { mediaType: 'image/jpeg', data: 'A'.repeat(2_600_000) } }))).status, 413);
  assert.equal((await handle(post(GOOD, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await handle(post(GOOD, { origin: 'https://evil.example' }))).status, 403);
  const off = createAiHandler({ config: configFromEnv({}), getClient: () => null });
  assert.equal((await off(post(GOOD))).status, 503);
  const junk = createAiHandler({ config, getClient: () => fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] }) });
  assert.equal((await (await junk(post(GOOD))).json()).error.code, 'bad_output');
  const refused = createAiHandler({ config, getClient: () => fakeClient(msg({}, { stop_reason: 'refusal' })) });
  assert.equal((await (await refused(post(GOOD))).json()).error.code, 'refused');
  const err = Object.assign(new Error('x'), { status: 529 });
  const down = createAiHandler({ config, getClient: () => fakeClient(err) });
  const r = await down(post(GOOD));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.retryable, true);
  let n = 0;
  const limited = createAiHandler({ config, getClient: () => fakeClient(msg(READING)), limiter: () => (++n > 1 ? { ok: false, retryAfter: 9 } : { ok: true }) });
  assert.equal((await limited(post(GOOD))).status, 200);
  assert.equal((await limited(post(GOOD))).status, 429);
});
