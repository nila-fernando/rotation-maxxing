import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHistory, createConversationStore, transcriptOf } from './conversations.js';

/** A tiny stand-in for supabase-js: from(t).select/insert/eq/is/order/limit, then awaited. */
function fakeClient(tables = {}) {
  const log = [];
  const from = (t) => {
    const rows = (tables[t] ??= []);
    const q = { filters: [], then(res, rej) { return Promise.resolve(run()).then(res, rej); } };
    let op = 'select';
    let payload = null;
    const run = () => {
      log.push({ t, op, filters: q.filters, payload });
      if (op === 'insert') { rows.push(...[].concat(payload).map((r, i) => ({ id: r.id ?? rows.length + i + 1, ...r }))); return { data: null, error: null }; }
      return { data: rows.filter((r) => q.filters.every(([k, v]) => (r[k] ?? null) === v)), error: null };
    };
    q.select = () => q;
    q.insert = (p) => { op = 'insert'; payload = p; return q; };
    q.eq = (k, v) => { q.filters.push([k, v]); return q; };
    q.is = (k, v) => { q.filters.push([k, v]); return q; };
    q.order = () => q;
    q.limit = () => q;
    return q;
  };
  return { from, log, tables };
}

const H = [
  { role: 'user', content: [{ type: 'text', text: '<farm_context kind="start">{}</farm_context>' }, { type: 'text', text: 'What should West grow?' }] },
  { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't1', name: 'get_field', input: { field_id: 'a' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
  { role: 'system', content: 'Stop checking now.' },
  { role: 'assistant', content: [{ type: 'text', text: 'Soybeans next.' }] },
];

test('signed out: nothing saved, nothing loaded', async () => {
  const client = fakeClient();
  const store = createConversationStore({ getClient: async () => client, getUser: () => null });
  assert.equal(await store.save(H, { title: 'x' }), false);
  assert.equal(await store.latest(), null);
  assert.equal(client.log.length, 0);
});

test('signed in: a conversation is started once, messages appended, system notes left out, and it comes back', async () => {
  const client = fakeClient();
  let n = 0;
  const store = createConversationStore({ getClient: async () => client, getUser: () => ({ id: 'u1' }), getFarmId: () => 'farm1', makeId: () => `c${++n}` });
  assert.equal(await store.save(H.slice(0, 3), { title: 'What should West grow?' }), true);
  assert.equal(await store.save(H.slice(3)), true);
  assert.equal(client.tables.ai_conversations.length, 1);
  assert.deepEqual(client.tables.ai_conversations[0], { id: 'c1', owner_id: 'u1', farm_id: 'farm1', title: 'What should West grow?' });
  assert.deepEqual(client.tables.ai_messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  // a fresh store (a reload) finds it again
  const again = createConversationStore({ getClient: async () => client, getUser: () => ({ id: 'u1' }), getFarmId: () => 'farm1' });
  const h = await again.latest();
  assert.equal(h.length, 4);
  assert.equal(again.id, 'c1');
  // another farm: not this one
  const other = createConversationStore({ getClient: async () => client, getUser: () => ({ id: 'u1' }), getFarmId: () => 'farm2' });
  assert.equal(await other.latest(), null);
  // "Start over": the next save is a new conversation
  store.startNew();
  assert.equal(await store.latest(), null);
  await store.save(H.slice(0, 1).concat(H.slice(4)));
  assert.equal(client.tables.ai_conversations.length, 2);
});

test('a failing database never throws', async () => {
  const broken = { from: () => { throw new Error('offline'); } };
  const store = createConversationStore({ getClient: async () => broken, getUser: () => ({ id: 'u1' }) });
  assert.equal(await store.save(H), false);
  assert.equal(await store.latest(), null);
});

test('cleanHistory ends on an answer; the transcript is the farmer’s words and Manami’s answers', () => {
  const cut = cleanHistory([...H.filter((m) => m.role !== 'system'), { role: 'user', content: [{ type: 'text', text: 'And Creek?' }] }]);
  assert.equal(cut.at(-1).role, 'assistant');
  assert.equal(cleanHistory(H.slice(0, 2)).length, 0, 'a tool call with no answer is dropped');
  assert.deepEqual(transcriptOf(cut), [{ who: 'me', text: 'What should West grow?' }, { who: 'manami', text: 'Soybeans next.' }]);
});
