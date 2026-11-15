// Ask Manami's conversations, kept in the farmer's account (ai_conversations, ai_messages in
// supabase/migrations) when they are signed in. Signed out, nothing is kept (as before).
//
//   const store = createConversationStore({ getClient, getUser, getFarmId })
//   await store.latest()          -> the last conversation's messages for this farm, or null
//   await store.save(messages, { title })   adds this question's messages (starts a conversation first)
//   store.startNew()              "Start over": the next save starts a new conversation
//
// Each ai_messages row is one message of the Messages API history as the chat keeps it (role user or
// assistant, its content blocks), so a reopened conversation carries on where it stopped. The
// server's own system notes are not kept. Every failure is quiet: the chat never waits on saving.
import { newId } from './rows.js';

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const keepable = (m) => isObj(m) && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content));

/** A history loaded back: only user and assistant turns, starting with a user turn, not ending mid tool call. */
export function cleanHistory(rows) {
  const out = (rows || []).map((r) => ({ role: r.role, content: r.content })).filter(keepable);
  while (out.length && out[0].role !== 'user') out.shift();
  // a question cut off before its answer (or mid tool call) is dropped: the history ends on an answer
  const answered = (m) => m.role === 'assistant' && !(Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_use'));
  while (out.length && !answered(out[out.length - 1])) out.pop();
  return out;
}

/** What the farmer said and what Manami answered, from a history (for drawing it again). */
export function transcriptOf(history) {
  const lines = [];
  for (const m of history || []) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || [];
    const texts = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string' && !/^<(farm_context|asked_from)/.test(b.text)).map((b) => b.text.trim()).filter(Boolean);
    if (!texts.length) continue;
    const who = m.role === 'user' ? 'me' : 'manami';
    const text = texts.join('\n\n');
    // tool steps: an answer in several assistant turns shows as one
    if (who === 'manami' && lines.at(-1)?.who === 'manami') lines.at(-1).text = text;
    else lines.push({ who, text });
  }
  return lines;
}

export function createConversationStore({ getClient, getUser, getFarmId = () => null, makeId = newId }) {
  let convId = null;
  let fresh = false; // "Start over" was pressed: don't reopen the old one

  const farmFilter = (q) => { const f = getFarmId(); return f ? q.eq('farm_id', f) : q.is('farm_id', null); };

  async function latest() {
    const user = getUser();
    if (!user || fresh) return null;
    try {
      const client = await getClient();
      const conv = await farmFilter(client.from('ai_conversations').select('id').eq('owner_id', user.id)).order('created_at', { ascending: false }).limit(1);
      if (conv.error || !conv.data?.length) return null;
      const id = conv.data[0].id;
      const msgs = await client.from('ai_messages').select('role,content').eq('conversation_id', id).order('id', { ascending: true }).limit(200);
      if (msgs.error) return null;
      const history = cleanHistory(msgs.data);
      if (!history.length) return null;
      convId = id;
      return history;
    } catch {
      return null;
    }
  }

  async function save(messages, { title = '' } = {}) {
    const user = getUser();
    const rows = (messages || []).filter(keepable);
    if (!user || !rows.length) return false;
    try {
      const client = await getClient();
      if (!convId) {
        const id = makeId();
        const ins = await client.from('ai_conversations').insert({ id, owner_id: user.id, farm_id: getFarmId() || null, title: String(title).slice(0, 80) || null });
        if (ins.error) return false;
        convId = id;
        fresh = false;
      }
      const res = await client.from('ai_messages').insert(rows.map((m) => ({ conversation_id: convId, role: m.role, content: m.content })));
      return !res.error;
    } catch {
      return false;
    }
  }

  return {
    latest,
    save,
    startNew() { convId = null; fresh = true; },
    /** Signed out, or another farm: forget which conversation was open. */
    forget() { convId = null; fresh = false; },
    get id() { return convId; },
  };
}
