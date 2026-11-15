import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceRoutes, askAdvice, clearAdviceCache, planBody, takeChoice, takeToPlan } from './advice.js';
import { createPlanTake, scoreLine, takeHtml } from '../screens/planTake.js';
import { readHtml } from '../screens/fieldPanel.js';

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const seq = (...m) => m.map((main) => ({ main }));
const DATA = {
  result: {
    plans: {
      current: { expectedGM: 30000, p10GM: 10000, endSoilHealth: 0.5, plan: { sequences: { a: seq('corn', 'corn', 'corn'), b: seq('soybeans', 'corn', 'soybeans') } }, paddocks: [{ paddockId: 'a', name: 'West', sequence: ['corn', 'corn', 'corn'] }, { paddockId: 'b', name: 'Creek', sequence: ['soybeans', 'corn', 'soybeans'] }] },
      maxProfit: { expectedGM: 40000, p10GM: 12000, endSoilHealth: 0.45, plan: { sequences: { a: seq('corn', 'soybeans', 'corn'), b: seq('corn', 'corn', 'soybeans') } }, paddocks: [{ paddockId: 'a', name: 'West', sequence: [] }, { paddockId: 'b', name: 'Creek', sequence: [] }] },
      priority: { expectedGM: 35000, p10GM: 15000, endSoilHealth: 0.62, plan: { sequences: { a: seq('soybeans', 'corn', 'winter-wheat'), b: seq('soybeans', 'corn', 'soybeans') } }, paddocks: [{ paddockId: 'a', name: 'West', sequence: ['soybeans', 'corn', 'winter-wheat'] }, { paddockId: 'b', name: 'Creek', sequence: [] }] },
    },
  },
};
const TAKE = {
  headline: 'Give West a break from corn.',
  fields: [
    { field_id: 'a', pick: 'priority', why: 'Corn three years running.', adjusted: [{ main: 'soybeans' }, { main: 'corn', cover: 'cereal-rye' }, { main: 'oats' }] },
    { field_id: 'b', pick: 'maxProfit', why: 'Beans then corn pays.', adjusted: null },
  ],
  risks: [{ field_id: 'a', text: 'Rootworm after corn on corn.' }],
};

test('routes come from health; nothing when off or unreachable', async () => {
  clearAdviceCache();
  assert.deepEqual([...await adviceRoutes(null)], []);
  assert.deepEqual([...await adviceRoutes('/x', { fetchImpl: async () => { throw new Error('down'); } })], []);
  clearAdviceCache();
  assert.ok((await adviceRoutes('/y', { fetchImpl: async () => res(200, { ai: true, routes: ['chat', 'jar', 'plan', 'field'] }) })).has('plan'));
  // the old Worker (chat and jar only): the new controls stay hidden
  assert.equal((await adviceRoutes('/z', { fetchImpl: async () => res(200, { ai: true, routes: ['chat', 'jar'] }) })).has('plan'), false);
  assert.equal((await adviceRoutes('/w', { fetchImpl: async () => res(200, { ai: false }) })).size, 0);
});

test('askAdvice posts v1 and unwraps; errors never throw', async () => {
  let sent = null;
  const ok = await askAdvice('/api/ai', 'plan', { context: {} }, { fetchImpl: async (url, o) => { sent = { url, body: JSON.parse(o.body) }; return res(200, { ok: true, take: TAKE }); } });
  assert.equal(sent.url, '/api/ai/plan');
  assert.equal(sent.body.v, 1);
  assert.equal(ok.take, TAKE);
  assert.deepEqual(await askAdvice('/api/ai', 'field', {}, { fetchImpl: async () => res(429, { ok: false, error: { code: 'rate_limited', retryable: true } }) }), { error: 'rate_limited', retryable: true });
  assert.equal((await askAdvice('/api/ai', 'field', {}, { fetchImpl: async () => { throw new Error('x'); } })).error, 'unreachable');
  assert.equal((await askAdvice(null, 'plan', {})).error, 'unavailable');
});

test('takeToPlan: picks per field, her own seasons when given, Manami’s pick for the rest', () => {
  const { plan, adjusted } = takeToPlan(TAKE, DATA);
  assert.deepEqual(plan.sequences.a, [{ main: 'soybeans' }, { main: 'corn', cover: 'cereal-rye' }, { main: 'oats' }]);
  assert.deepEqual(plan.sequences.b, DATA.result.plans.maxProfit.plan.sequences.b);
  assert.deepEqual([...adjusted], ['a']);
  const plain = takeToPlan(TAKE, DATA, { withAdjusted: false });
  assert.deepEqual(plain.plan.sequences.a, DATA.result.plans.priority.plan.sequences.a);
  assert.equal(plain.adjusted.size, 0);
  assert.deepEqual(takeToPlan({ fields: [] }, DATA).plan.sequences.b, DATA.result.plans.priority.plan.sequences.b);
  assert.deepEqual(takeChoice(TAKE, DATA), { a: 'priority', b: 'maxProfit' });
});

test('planBody: the plans carry the planner’s crop ids beside the names', () => {
  const host = {
    fields: () => [{ id: 'a', name: 'West' }], report: (id) => ({ id, name: 'West', acres: 40, history: [], shown: [] }),
    profile: () => ({ priorities: ['soil-health'] }), place: () => ({ label: 'Story County, IA' }), plansData: () => DATA, savedPlan: () => null, today: () => new Date(2026, 10, 15),
  };
  const b = planBody(host);
  assert.equal(b.plans.ready, true);
  const west = b.plans.plans.find((p) => p.kind === 'priority').fields.find((f) => f.field_id === 'a');
  assert.deepEqual(west.seasons.map((s) => s.crop_id), ['soybeans', 'corn', 'winter-wheat']);
  assert.equal(b.fields[0].id, 'a');
});

test('the take shows only the planner’s numbers, and asks the planner to score her plan', async () => {
  const done = { status: 'done', take: TAKE, adjusted: new Set(['a']), score: { expectedGM: 36000, p10GM: 14000, endSoilHealth: 0.66, risks: ['West, year 3: tight window.'] } };
  const html = takeHtml(done, DATA);
  assert.match(html, /The planner’s numbers for my take/);
  assert.match(html, /\$36k/);
  assert.match(html, /Soil health 66 out of 100/);
  assert.match(html, /My own three seasons: Soybeans, Corn then cereal rye over winter, Oats/);
  assert.match(html, /The planner flags: West, year 3/);
  assert.match(html, /data-take="use"/);
  assert.doesNotMatch(takeHtml({ ...done, score: null }, DATA), /\$36k/);
  assert.equal(scoreLine(null), null);
  assert.match(takeHtml({ status: 'idle' }, DATA), /data-take="ask"/);

  // the flow: fetch the take, score it with evaluate, the plan saved is the one scored
  const evaluated = [];
  const fetchImpl = async (url) => (url.endsWith('/health') ? res(200, { ai: true, routes: ['plan'] }) : res(200, { ok: true, take: TAKE }));
  const take = createPlanTake({ endpoint: '/t', buildBody: () => ({}), evaluate: async (plan) => { evaluated.push(plan); if (plan.sequences.a[2].main === 'oats') throw new Error('oats not allowed'); return { expectedGM: 1, p10GM: 1 }; }, fetchImpl });
  const listeners = {};
  const host = { hidden: true, innerHTML: '', addEventListener: (t, f) => { listeners[t] = f; }, querySelector: () => null };
  let saved = null;
  take.mount(host, { data: DATA, save: (p) => { saved = p; } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(host.hidden, false);
  listeners.click({ target: { closest: () => ({ dataset: { take: 'ask' } }) }, stopPropagation() {} });
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(take.state.status, 'done');
  assert.equal(evaluated.length, 2, 'her own seasons the planner can’t score are dropped, then scored again');
  assert.equal(take.state.dropped, true);
  listeners.click({ target: { closest: () => ({ dataset: { take: 'use' } }) }, stopPropagation() {} });
  assert.deepEqual(saved, evaluated[1]);
});

test('Manami’s read in the check-up', () => {
  assert.match(readHtml({ status: 'idle' }), /data-read/);
  assert.match(readHtml({ status: 'idle', stale: true }), /changed since/);
  const html = readHtml({ status: 'done', read: { summary: 'Corn on corn.', good: ['Deep loam'], watch: [], next_step: 'Try a jar test.' } });
  assert.match(html, /Corn on corn/);
  assert.match(html, /Going well/);
  assert.doesNotMatch(html, /Keep an eye on/);
  assert.match(html, /Try a jar test/);
});
