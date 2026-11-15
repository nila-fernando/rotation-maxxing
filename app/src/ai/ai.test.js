import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser, readSse } from './sse.js';
import { stripEmoji, tidyAnswer } from './text.js';
import { buildFarmContext, createClientTools, plansSummary } from './context.js';
import { aiEndpoint, createSession, probeHealth } from './runner.js';

const REPORT = {
  id: 'f1', name: 'Home place', acres: 80.4, irrigated: false, status: 'amber',
  history: [{ year: 2024, crop: 'Corn', label: 'Corn' }, { year: 2025, crop: 'Soybeans', label: 'Soybeans' }],
  soil: { texture: 'Silt loam', drainage: 'well drained', organicMatterPct: 3.24, waterHoldingIn: 10.1 },
  slope: { pct: 2.34, risk: 'low' }, rain: { recentAvg: 508, avg30: 533.4, recentYears: 3 }, ndvi: null,
  shown: [{ text: 'Corn three years running' }], jar: null, planWeather: null,
};
const host = {
  fields: () => [{ id: 'f1', name: 'Home place', acres: 80.4, geometry: { coordinates: [[1, 2]] } }],
  report: (id) => (id === 'f1' ? REPORT : null),
  profile: () => ({ priorities: ['profit'], excludedCrops: [], irrigatedFieldIds: [] }),
  place: () => ({ label: 'Story County, IA', lat: 42 }),
  plansData: () => null,
  savedPlan: () => null,
  today: () => new Date(2026, 10, 15),
};

test('SSE parser: events across chunks, comments, CRLF', () => {
  const got = [];
  const p = createSseParser((e) => got.push(e));
  p.push(': ping\n\nevent: text\ndata: {"del');
  p.push('ta":"Hi"}\r\n\r\nevent: done\ndata: {}\n\n');
  p.end();
  assert.deepEqual(got, [{ event: 'text', data: { delta: 'Hi' } }, { event: 'done', data: {} }]);
});

test('emoji are stripped, words kept', () => {
  assert.equal(stripEmoji('Corn 🌽 then beans 👍🏽!'), 'Corn then beans !');
  assert.equal(stripEmoji('Family 👨‍👩‍👧 and 🇺🇸 flag'), 'Family and flag');
  assert.equal(tidyAnswer('**Home place** grew corn. 🌱\n'), 'Home place grew corn.');
  assert.equal(stripEmoji('−$2k, about $25k'), '−$2k, about $25k');
});

test('farm context: compact, deterministic, no geometry', () => {
  const a = buildFarmContext(host);
  assert.deepEqual(a, buildFarmContext(host));
  assert.equal(a.today, '2026-11-15');
  assert.deepEqual(a.plan_years, [2027, 2028, 2029]);
  assert.equal(a.farm.place, 'Story County, IA');
  assert.deepEqual(a.fields[0], { id: 'f1', name: 'Home place', acres: 80, status: 'amber', last_crop: { year: 2025, crop: 'Soybeans' }, flags: ['Corn three years running'] });
  assert.ok(!JSON.stringify(a).includes('coordinates'));
});

test('tools: get_field, unknown ids and names, plans not ready', async () => {
  const tools = createClientTools(host);
  const f = await tools.run('get_field', { field_id: 'f1' });
  assert.equal(f.is_error, false);
  const d = JSON.parse(f.content);
  assert.equal(d.rain.recent_avg_in, 20);
  assert.equal(d.soil.organic_matter_pct, 3.2);
  assert.deepEqual(d.crop_history[1], { year: 2025, crop: 'Soybeans' });
  assert.equal((await tools.run('get_field', { field_id: 'zz' })).is_error, true);
  assert.equal((await tools.run('nope', {})).is_error, true);
  const p = JSON.parse((await tools.run('GET_PLANS', {})).content);
  assert.equal(p.ready, false);
  assert.match(p.reason, /Plan my next seasons/);
});

test('plans summary: totals said in rounded money, crops by year', () => {
  const plan = (gm) => ({ expectedGM: gm, p10GM: gm / 2, endSoilHealth: 0.62, probBeatsCurrent: 0.7, paddocks: [{ paddockId: 'f1', name: 'Home place', sequence: ['corn', 'soybeans', 'winter-wheat'] }] });
  const s = plansSummary({ result: { plans: { current: plan(412000), maxProfit: plan(440000), priority: plan(430000) } }, weather: { source: 'NASA POWER', years: 24 } }, new Date(2026, 10, 15));
  assert.equal(s.ready, true);
  assert.equal(s.plans[0].cash_margin_said, '$412k');
  assert.equal(s.plans[0].beats_keeping_going_pct, null);
  assert.equal(s.plans[2].soil_health_end, 62);
  assert.deepEqual(s.plans[1].fields[0].seasons[2], { year: 2029, crop: 'Winter wheat' });
});

test('endpoint and health probe', async () => {
  assert.equal(aiEndpoint('', '/'), '/api/ai');
  assert.equal(aiEndpoint('', '/rotation-maxxing/'), '/rotation-maxxing/api/ai');
  assert.equal(aiEndpoint('off'), null);
  assert.equal(aiEndpoint('https://x.supabase.co/functions/v1/ai/'), 'https://x.supabase.co/functions/v1/ai');
  assert.deepEqual(await probeHealth(null), { ai: false, reason: 'no_endpoint' });
  const ok = await probeHealth('/api/ai', { fetchImpl: async () => new Response(JSON.stringify({ ok: true, ai: true, model: 'm' })) });
  assert.equal(ok.ai, true);
  const no = await probeHealth('/api/ai', { fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(no, { ai: false, reason: 'unreachable' });
});

const sseResponse = (events) => new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

test('tool loop: runs tools here, sends results back, grows history only on finished steps', async () => {
  const bodies = [];
  const replies = [
    sseResponse([
      ['start', { appended: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }] }],
      ['tool', { id: 't1', name: 'get_field' }],
      ['turn', { message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_field', input: { field_id: 'f1' } }] }, stop_reason: 'tool_use', tool_calls: [{ id: 't1', name: 'get_field', input: { field_id: 'f1' } }] }],
      ['done', {}],
    ]),
    sseResponse([
      ['start', { appended: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] }] }],
      ['text', { delta: 'Home place had soybeans 🌱 last year.' }],
      ['turn', { message: { role: 'assistant', content: [{ type: 'text', text: 'Home place had soybeans 🌱 last year.' }] }, stop_reason: 'end_turn', tool_calls: [] }],
      ['done', {}],
    ]),
  ];
  const session = createSession({
    endpoint: '/api/ai', getContext: () => buildFarmContext(host), tools: createClientTools(host),
    fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); return replies.shift(); },
  });
  const updates = [];
  const answer = await session.ask('What do I grow on Home place?', { onUpdate: (u) => updates.push(u), statusFor: (n) => `status ${n}` });
  assert.equal(answer, 'Home place had soybeans last year.');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].input.text, 'What do I grow on Home place?');
  assert.equal(bodies[1].input.tool_results[0].tool_use_id, 't1');
  assert.equal(JSON.parse(bodies[1].input.tool_results[0].content).name, 'Home place');
  assert.equal(bodies[1].history.length, 2);
  assert.equal(session.history.length, 4);
  assert.ok(updates.some((u) => u.status === 'status get_field'));
  assert.ok(!updates.some((u) => u.text && /🌱/.test(u.text)));
});

test('tool loop: capped, the last step is final, owed tool calls answered next time; errors keep history', async () => {
  const bodies = [];
  const toolTurn = (id) => sseResponse([
    ['start', { appended: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }],
    ['turn', { message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'get_plans', input: {} }] }, stop_reason: 'tool_use', tool_calls: [{ id, name: 'get_plans', input: {} }] }],
  ]);
  let n = 0;
  const session = createSession({
    endpoint: '/api/ai', getContext: () => ({}), tools: createClientTools(host), maxSteps: 3,
    fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); n++; return n <= 3 ? toolTurn(`t${n}`) : sseResponse([['start', { appended: [] }], ['error', { code: 'rate_limited', retryable: true }]]); },
  });
  await session.ask('plans?');
  assert.equal(bodies.length, 3);
  assert.equal(bodies[2].input.final, true);
  assert.equal(bodies[0].input.final, undefined);
  const before = session.history.length;
  await assert.rejects(session.ask('again'), (e) => e.code === 'rate_limited');
  assert.equal(bodies[3].input.tool_results[0].tool_use_id, 't3');
  assert.equal(session.history.length, before);
});

test('readSse reads a byte stream', async () => {
  const got = [];
  await readSse(new Response('event: a\ndata: 1\n\n').body, (e) => got.push(e));
  assert.deepEqual(got, [{ event: 'a', data: 1 }]);
});
