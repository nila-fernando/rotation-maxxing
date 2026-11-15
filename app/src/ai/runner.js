// Ask Manami's client side: where to ask, whether she can answer, and the tool loop.
//
// The server runs one Messages call per request (server/ai/handler.js). This runner keeps the
// conversation, runs any tool calls here in the browser (where the farm lives) and sends the results
// back, at most MAX_STEPS requests per question. History only grows when a step finishes cleanly.

import { readSse } from './sse.js';
import { stripEmojiDelta, tidyAnswer } from './text.js';

export const MAX_STEPS = 5;

/** The AI endpoint base: VITE_AI_ENDPOINT, else this site's /api/ai; null when off (GitHub Pages). */
export function aiEndpoint(raw, base = '/') {
  const v = String(raw ?? '').trim();
  if (v === 'off') return null;
  if (v) return v.replace(/\/+$/, '');
  return `${String(base || '/').replace(/\/+$/, '')}/api/ai`;
}

/** { ai: true } or { ai: false, reason }. Never throws. */
export async function probeHealth(endpoint, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  if (!endpoint) return { ai: false, reason: 'no_endpoint' };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${endpoint}/health`, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { ai: false, reason: 'unreachable' };
    const body = await res.json();
    return body?.ai === true ? { ai: true, model: body.model ?? null } : { ai: false, reason: body?.reason || 'disabled' };
  } catch {
    return { ai: false, reason: 'unreachable' };
  } finally {
    clearTimeout(t);
  }
}

export class AiError extends Error {
  constructor(code, retryable = false) { super(code); this.code = code; this.retryable = retryable; }
}

/** What Manami says when a question can't be answered (plain, no codes). */
export function errorLine(code) {
  if (code === 'rate_limited' || code === 'upstream_rate_limited') return 'That’s a lot of questions at once. Give me a minute and ask again.';
  if (code === 'refused') return 'I can’t help with that one. Ask me about your fields, the plans or the app.';
  if (code === 'too_long') return 'We’ve talked a long while. Press “Start over” and ask me again.';
  if (code === 'upstream_auth' || code === 'upstream_config' || code === 'ai_unavailable') return 'I can’t reach my helper just now. The key or the model may need a look.';
  if (code === 'upstream_overloaded' || code === 'upstream_unreachable' || code === 'upstream_timeout') return 'My helper is busy just now. Try again in a moment.';
  return 'Something went wrong on my side. Try asking again.';
}

/**
 * One conversation.
 * @param {object} o
 * @param {string} o.endpoint
 * @param {() => object} o.getContext            buildFarmContext(host)
 * @param {{ run: (name, input) => Promise<{content, is_error}> }} o.tools
 * @param {typeof fetch} [o.fetchImpl]
 */
export function createSession({ endpoint, getContext, tools, fetchImpl = (...a) => fetch(...a), maxSteps = MAX_STEPS }) {
  let history = [];
  let pending = []; // tool calls the last step asked for but the step limit left unrun
  let busy = null;

  async function step(input, { signal, onText }) {
    const res = await fetchImpl(`${endpoint}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ v: 1, history, input, context: getContext() }),
      signal,
    });
    if (!res.ok || !res.body) {
      let code = 'server_error', retryable = false;
      try { const b = await res.json(); code = b?.error?.code || code; retryable = !!b?.error?.retryable; } catch { /* not JSON */ }
      throw new AiError(code, retryable);
    }
    let appended = null, turn = null, error = null;
    await readSse(res.body, ({ event, data }) => {
      if (event === 'start') appended = data?.appended || null;
      else if (event === 'text') onText?.(stripEmojiDelta(data?.delta ?? ''));
      else if (event === 'tool') onText?.(null, { tool: data?.name });
      else if (event === 'turn') turn = data;
      else if (event === 'error') error = data;
    });
    if (error) throw new AiError(error.code || 'server_error', !!error.retryable);
    if (!appended || !turn?.message) throw new AiError('incomplete', true);
    history = [...history, ...appended, turn.message]; // atomic: only a finished step joins the history
    return turn;
  }

  /**
   * Asks one question. onUpdate({ text, status }) streams the answer (text of the current step) and a
   * status line while tools run. Resolves to the tidy final answer.
   */
  async function ask(text, { focus = null, signal, onUpdate = () => {}, statusFor = () => 'Thinking…' } = {}) {
    if (busy) throw new AiError('busy');
    const run = (async () => {
      let input = { text, ...(focus ? { focus } : {}) };
      if (pending.length) {
        input.tool_results = pending.map((c) => ({ tool_use_id: c.id, content: '{"not_run":"step limit"}', is_error: true }));
      }
      for (let n = 1; n <= maxSteps; n++) {
        const last = n === maxSteps;
        if (last) input.final = true;
        let shown = '';
        onUpdate({ text: '', status: 'Thinking…' });
        const turn = await step(input, {
          signal,
          onText: (delta, meta) => {
            if (meta?.tool) { onUpdate({ text: '', status: statusFor(meta.tool, null) }); return; }
            shown += delta;
            onUpdate({ text: shown, status: null });
          },
        });
        pending = []; // the step carried any answers owed; a failed step leaves them owed
        const calls = Array.isArray(turn.tool_calls) && turn.stop_reason === 'tool_use' ? turn.tool_calls : [];
        if (!calls.length) {
          const answer = tidyAnswer(textOf(turn.message) || shown);
          return answer || 'I couldn’t find the words for that one. Try asking another way.';
        }
        if (last) { pending = calls; return tidyAnswer(textOf(turn.message) || shown) || 'I ran out of time looking. Ask me again and I’ll pick up from there.'; }
        pending = calls; // owed until the next step goes through
        const results = [];
        for (const c of calls) {
          onUpdate({ text: '', status: statusFor(c.name, c.input) });
          const r = await tools.run(c.name, c.input);
          results.push({ tool_use_id: c.id, content: r.content, is_error: !!r.is_error });
        }
        input = { tool_results: results };
      }
      return '';
    })();
    busy = run;
    try { return await run; } finally { busy = null; }
  }

  return {
    ask,
    reset() { history = []; pending = []; },
    get history() { return history; },
    get busy() { return !!busy; },
  };
}

const textOf = (message) => (message?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
