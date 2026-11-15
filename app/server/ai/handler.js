// Ask Manami's server: web-standard Request in, Response out, so the same code can later run as a
// Supabase Edge Function behind a thin wrapper. The server owns the model, system prompt, tools,
// effort and limits; the client sends only its history, the farmer's words or tool results, and a
// compact farm context.
//
//   GET  .../health   { ok, v, ai, model?, reason? }   (never the key)
//   POST .../chat     Server-Sent Events: start, text, tool, fallback, turn, error, done
//   POST .../jar      JSON: the jar test photo read by Claude's vision (server/ai/jar.js)
//   POST .../plan     JSON: Manami's take on the planner's three plans, field by field (server/ai/advice.js)
//   POST .../field    JSON: Manami's read on one field's check-up (server/ai/advice.js)
//
// The client runs the tool loop (src/ai/runner.js): one Messages call per request.

import { CHAT_SYSTEM, FINAL_NOTE } from './prompts.js';
import { CHAT_TOOLS, CHAT_TOOL_NAMES } from './tools.js';
import { JAR_LIMITS, JarBadRequest, buildJarParams, normaliseJarOutput, parseJarMessage, validateJarBody } from './jar.js';
import { ADVICE_LIMITS, AdviceBadRequest, buildFieldParams, buildPlanParams, normaliseFieldOutput, normalisePlanOutput, parseJsonMessage, validateFieldBody, validatePlanBody } from './advice.js';

/** Every POST route the handler answers (health lists them, so the app can tell what this server knows). */
export const ROUTES = ['chat', 'jar', 'plan', 'field'];

export const LIMITS = Object.freeze({ chatBytes: 200_000, textChars: 4000, historyMax: 80, toolResults: 10, toolResultChars: 16_000, contextChars: 24_000 });
export const MAX_TOKENS = 8000;
export const EFFORT = 'low';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Server config from env (process.env or Vite's loadEnv result). Never echoes the key. */
export function configFromEnv(env = {}) {
  const key = String(env.ANTHROPIC_API_KEY || '').trim();
  const enabled = String(env.AI_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  const perMinute = Math.max(1, Number.parseInt(env.AI_RATE_LIMIT_PER_MIN, 10) || 20);
  return {
    hasKey: key.length > 0,
    apiKey: key,
    ai: enabled && key.length > 0,
    reason: !enabled ? 'disabled' : key ? null : 'no_key',
    model: String(env.AI_MODEL || '').trim() || 'claude-sonnet-5-5',
    fallbacks: String(env.AI_FALLBACKS ?? 'default').trim().toLowerCase() !== 'off',
    perMinute,
  };
}

/** A fixed one-minute window per key. */
export function createRateLimiter({ perMinute = 20, now = () => Date.now() } = {}) {
  const hits = new Map();
  return (key) => {
    const t = now();
    let h = hits.get(key);
    if (!h || t - h.start >= 60_000) { h = { start: t, n: 0 }; hits.set(key, h); }
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start >= 60_000) hits.delete(k);
    if (h.n >= perMinute) return { ok: false, retryAfter: Math.max(1, Math.ceil((h.start + 60_000 - t) / 1000)) };
    h.n++;
    return { ok: true };
  };
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
const fail = (status, code, message, { retryable = false, headers } = {}) => json(status, { ok: false, error: { code, message, retryable } }, headers);

class BadRequest extends Error {}
const bad = (msg) => { throw new BadRequest(msg); };
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Reads the body up to `limit` bytes; null when over. */
async function readBody(request, limit) {
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

const USER_BLOCKS = new Set(['text', 'tool_result']);
const ASSISTANT_BLOCKS = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use', 'fallback']);

/** Removes every cache_control key, at any depth (the server places its own breakpoints). */
export function stripCacheControl(v) {
  if (Array.isArray(v)) return v.map(stripCacheControl);
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (k !== 'cache_control') out[k] = stripCacheControl(x);
  return out;
}

/** The client's history: only what earlier responses gave it. A client never writes a system message. */
export function validateHistory(history) {
  if (!Array.isArray(history)) bad('history must be an array');
  if (history.length > LIMITS.historyMax) bad('history is too long');
  history.forEach((m, i) => {
    if (!isObj(m)) bad(`history[${i}] is not an object`);
    if (i === 0 && m.role !== 'user') bad('history must start with a user message');
    if (m.role === 'system') {
      if (m.content !== FINAL_NOTE) bad(`history[${i}]: system messages are the server's own`);
      return;
    }
    const allowed = m.role === 'user' ? USER_BLOCKS : m.role === 'assistant' ? ASSISTANT_BLOCKS : null;
    if (!allowed) bad(`history[${i}].role is not allowed`);
    if (m.role === 'user' && typeof m.content === 'string') return;
    if (!Array.isArray(m.content)) bad(`history[${i}].content must be an array`);
    m.content.forEach((b, j) => {
      if (!isObj(b) || !allowed.has(b.type)) bad(`history[${i}].content[${j}] type is not allowed`);
      if (b.type === 'tool_result' && typeof b.content !== 'string' && !(Array.isArray(b.content) && b.content.every((c) => isObj(c) && c.type === 'text'))) bad(`history[${i}].content[${j}] tool_result content`);
    });
  });
  return stripCacheControl(history);
}

/** The chat body: { v: 1, history, input: { text?, focus?, tool_results?, final? }, context }. */
export function validateChatBody(body) {
  if (!isObj(body)) bad('body must be an object');
  if (body.v !== 1) bad('v must be 1');
  const history = validateHistory(body.history ?? []);
  const input = body.input;
  if (!isObj(input)) bad('input must be an object');
  const text = input.text == null ? '' : typeof input.text === 'string' ? input.text.trim() : bad('input.text must be a string');
  if (text.length > LIMITS.textChars) bad('input.text is too long');
  const results = input.tool_results ?? [];
  if (!Array.isArray(results) || results.length > LIMITS.toolResults) bad('input.tool_results must be an array of at most 10');
  const toolResults = results.map((r, i) => {
    if (!isObj(r) || typeof r.tool_use_id !== 'string' || !r.tool_use_id) bad(`input.tool_results[${i}].tool_use_id`);
    if (typeof r.content !== 'string' || r.content.length > LIMITS.toolResultChars) bad(`input.tool_results[${i}].content`);
    return { type: 'tool_result', tool_use_id: r.tool_use_id, content: r.content, is_error: r.is_error === true };
  });
  if (!text && !toolResults.length) bad('input needs text or tool_results');
  const focus = input.focus == null ? null : isObj(input.focus) ? input.focus : bad('input.focus must be an object');
  if (!isObj(body.context)) bad('context must be an object');
  return { history, text, toolResults, focus, final: input.final === true, context: body.context };
}

/** JSON with keys sorted (deterministic, so an unchanged farm renders byte-identically). */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const cleanStrings = (v) => (typeof v === 'string' ? v.replace(/</g, '‹').replace(/>/g, '›')
  : Array.isArray(v) ? v.map(cleanStrings) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanStrings(x)])) : v);

export function renderContext(context, isFirst) {
  return `<farm_context kind="${isFirst ? 'start' : 'update'}">\n${stableStringify(cleanStrings(context))}\n</farm_context>`;
}
export function renderFocus(focus) {
  const name = String(focus?.name ?? '').replace(/</g, '‹').replace(/>/g, '›').slice(0, 60);
  const words = focus?.kind === 'field' && focus.field_id ? `the field check-up for ${name} (field_id ${String(focus.field_id).slice(0, 40)})` : 'the farm';
  return `<asked_from>${words}</asked_from>`;
}

const lastContextText = (history) => {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const b = m.content[j];
      if (b.type === 'text' && typeof b.text === 'string' && b.text.startsWith('<farm_context')) return b.text;
    }
  }
  return null;
};

/** The new messages this request adds to the conversation. */
export function buildAppended({ history, text, toolResults, focus, final, context }) {
  const content = [...toolResults];
  if (text) {
    const prev = lastContextText(history);
    const ctx = renderContext(context, prev == null);
    if (ctx.length > LIMITS.contextChars) bad('context is too large');
    const sameAsBefore = prev != null && prev.slice(prev.indexOf('\n')) === ctx.slice(ctx.indexOf('\n'));
    if (!sameAsBefore) content.push({ type: 'text', text: ctx });
    if (focus) content.push({ type: 'text', text: renderFocus(focus) });
    content.push({ type: 'text', text });
  }
  const out = [{ role: 'user', content }];
  if (final) out.push({ role: 'system', content: FINAL_NOTE });
  return out;
}

/** The Messages request. Pure, for tests. */
export function buildTurnParams(config, messages) {
  const copy = structuredClone(messages);
  // a breakpoint on the latest farm context (a copy only; the client's history never carries it)
  outer: for (let i = copy.length - 1; i >= 0; i--) {
    const m = copy[i];
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const b = m.content[j];
      if (b.type === 'text' && b.text?.startsWith('<farm_context')) { b.cache_control = { type: 'ephemeral' }; break outer; }
    }
  }
  return {
    model: config.model,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    system: [{ type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: CHAT_TOOLS,
    messages: copy,
    cache_control: { type: 'ephemeral' },
    ...(config.fallbacks ? { fallbacks: 'default', betas: [FALLBACK_BETA] } : {}),
  };
}

/** The final content as the API gave it, minus blocks a fallback superseded (the fallback echo rule). */
export function echoContent(content = []) {
  let last = -1;
  content.forEach((b, i) => { if (b?.type === 'fallback') last = i; });
  if (last < 0) return content;
  return content.filter((b, i) => i >= last || !['thinking', 'redacted_thinking', 'tool_use'].includes(b?.type));
}
export function toolCallsOf(content) {
  const names = new Map(CHAT_TOOL_NAMES.map((n) => [n.toLowerCase(), n]));
  return content.filter((b) => b?.type === 'tool_use' && isObj(b.input))
    .map((b) => ({ id: b.id, name: names.get(String(b.name).toLowerCase()) ?? b.name, input: b.input }));
}

/** SDK errors to our codes, by class name and status (never by message text). */
export function classifyError(err) {
  const name = err?.constructor?.name || err?.name || '';
  if (name === 'APIUserAbortError') return { status: 499, code: 'aborted', retryable: false };
  if (name === 'APIConnectionTimeoutError') return { status: 504, code: 'upstream_timeout', retryable: true };
  if (name === 'APIConnectionError') return { status: 502, code: 'upstream_unreachable', retryable: true };
  const s = Number(err?.status);
  if (s === 401) return { status: 502, code: 'upstream_auth', retryable: false };
  if (s === 403 || s === 404) return { status: 502, code: 'upstream_config', retryable: false };
  if (s === 400) return { status: 502, code: 'upstream_bad_request', retryable: false };
  if (s === 413) return { status: 413, code: 'too_large', retryable: false };
  if (s === 429) return { status: 429, code: 'upstream_rate_limited', retryable: true };
  if (s >= 500) return { status: 503, code: 'upstream_overloaded', retryable: true };
  if (Number.isFinite(s) && s > 0) return { status: 502, code: 'upstream_error', retryable: true };
  return { status: 500, code: 'server_error', retryable: false };
}

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * @param {object} o
 * @param {object} o.config            configFromEnv()
 * @param {() => object} o.getClient    the Anthropic client (made on first use; tests pass a fake)
 * @param {(request: Request) => Promise<object|null>} [o.getUser]   sign-in later (Supabase); null = open
 * @param {number} [o.pingMs]
 * @returns {(request: Request, info?: { ip?: string }) => Promise<Response>}
 */
export function createAiHandler({ config, getClient, getUser = async () => null, pingMs = 15_000, limiter = createRateLimiter({ perMinute: config.perMinute }) }) {
  return async function handle(request, info = {}) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return fail(403, 'origin_not_allowed', 'Cross-site requests are not allowed.');
    const route = url.pathname.replace(/\/+$/, '').split('/').pop();

    if (route === 'health') {
      if (request.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET.', { headers: { Allow: 'GET' } });
      const user = await getUser(request).catch(() => null);
      return json(200, config.ai
        ? { ok: true, v: 1, ai: true, model: config.model, fallbacks: !!config.fallbacks, routes: ROUTES, auth: { required: false, signedIn: !!user } }
        : { ok: true, v: 1, ai: false, reason: config.reason || 'disabled' });
    }
    if (!ROUTES.includes(route)) return fail(404, 'not_found', 'No such route.');
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', { headers: { Allow: 'POST' } });
    if (!config.ai) return fail(503, 'ai_unavailable', 'AI is off or has no key.');

    const user = await getUser(request).catch(() => null);
    const rl = limiter(user ? `u:${user.id}` : `ip:${info.ip || 'unknown'}`);
    if (!rl.ok) return fail(429, 'rate_limited', 'Too many requests.', { retryable: true, headers: { 'Retry-After': String(rl.retryAfter) } });
    if (!String(request.headers.get('content-type') || '').includes('application/json')) return fail(415, 'json_only', 'Send application/json.');
    if (route === 'jar') return handleJar(request, { config, getClient });
    if (route === 'plan') return handleAdvice(request, { config, getClient }, PLAN_ROUTE);
    if (route === 'field') return handleAdvice(request, { config, getClient }, FIELD_ROUTE);
    const raw = await readBody(request, LIMITS.chatBytes);
    if (raw == null) return fail(413, 'too_large', 'The request is too large.');

    let body, appended, params;
    try {
      body = validateChatBody(JSON.parse(raw));
      appended = buildAppended(body);
      params = buildTurnParams(config, [...body.history, ...appended]);
    } catch (e) {
      if (e instanceof SyntaxError) return fail(400, 'bad_request', 'Bad JSON.');
      if (e instanceof BadRequest) return fail(e.message === 'context is too large' ? 413 : 400, e.message === 'context is too large' ? 'context_too_large' : 'bad_request', e.message);
      throw e;
    }

    const enc = new TextEncoder();
    let ping = null;
    let sdkStream = null;
    const stream = new ReadableStream({
      async start(ctrl) {
        let open = true;
        const send = (ev, data) => { if (open) ctrl.enqueue(enc.encode(sse(ev, data))); };
        const close = () => { if (open) { open = false; clearInterval(ping); ctrl.close(); } };
        ping = setInterval(() => { if (open) ctrl.enqueue(enc.encode(': ping\n\n')); }, pingMs);
        send('start', { route: 'chat', appended });
        try {
          sdkStream = getClient().beta.messages.stream(params, { signal: request.signal });
          for await (const ev of sdkStream) {
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') send('text', { delta: ev.delta.text });
            else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') send('tool', { id: ev.content_block.id, name: ev.content_block.name });
            else if (ev.type === 'content_block_start' && ev.content_block?.type === 'fallback') send('fallback', { from: ev.content_block.from?.model ?? null, to: ev.content_block.to?.model ?? null });
          }
          const final = await sdkStream.finalMessage();
          const content = echoContent(final.content);
          const calls = toolCallsOf(content);
          const stop = final.stop_reason;
          if (stop === 'refusal') send('error', { code: 'refused', message: 'The model declined.', retryable: false });
          else if (stop === 'model_context_window_exceeded') send('error', { code: 'too_long', message: 'The conversation is too long.', retryable: false });
          else if (stop === 'max_tokens' && calls.length) send('error', { code: 'incomplete', message: 'Ran out of room mid tool call.', retryable: true });
          else {
            const u = final.usage || {};
            send('turn', {
              message: { role: 'assistant', content },
              stop_reason: stop,
              tool_calls: calls,
              model: final.model,
              served_by_fallback: (u.iterations ?? []).some((e) => e?.type === 'fallback_message'),
              usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_read_input_tokens: u.cache_read_input_tokens ?? 0, cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0 },
            });
            send('done', {});
          }
        } catch (err) {
          const c = classifyError(err);
          if (c.code !== 'aborted') {
            const code = c.code === 'server_error' && sdkStream ? 'bad_tool_input' : c.code;
            console.warn('[ai]', 'chat', code, err?.status ?? '', err?.requestID ?? '');
            send('error', { code, message: 'The request failed.', retryable: code === 'bad_tool_input' || c.retryable });
          }
        }
        close();
      },
      cancel() { clearInterval(ping); try { sdkStream?.abort?.(); } catch { /* already done */ } },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  };
}

/** POST .../jar: one structured-output vision call; the photo is not kept or logged. */
export async function handleJar(request, { config, getClient }) {
  const raw = await readBody(request, JAR_LIMITS.bytes);
  if (raw == null) return fail(413, 'too_large', 'The photo is too large.');
  let input;
  try {
    input = validateJarBody(JSON.parse(raw));
  } catch (e) {
    if (e instanceof SyntaxError) return fail(400, 'bad_request', 'Bad JSON.');
    if (e instanceof JarBadRequest) return fail(400, 'bad_request', e.message);
    throw e;
  }
  try {
    const msg = await getClient().beta.messages.create(buildJarParams(config, input), { signal: request.signal });
    if (msg.stop_reason === 'refusal') return fail(502, 'refused', 'The model declined.');
    if (msg.stop_reason === 'max_tokens') return fail(502, 'incomplete', 'The reading was cut short.', { retryable: true });
    const reading = normaliseJarOutput(parseJarMessage(msg));
    if (!reading) return fail(502, 'bad_output', 'The reading could not be understood.', { retryable: true });
    const u = msg.usage || {};
    return json(200, {
      ok: true, v: 1, reading, model: msg.model,
      served_by_fallback: (u.iterations ?? []).some((e) => e?.type === 'fallback_message'),
    });
  } catch (err) {
    const c = classifyError(err);
    if (c.code !== 'aborted') console.warn('[ai]', 'jar', c.code, err?.status ?? '', err?.requestID ?? '');
    return fail(c.status, c.code, 'The request failed.', { retryable: c.retryable });
  }
}

const PLAN_ROUTE = {
  name: 'plan', key: 'take',
  validate: validatePlanBody,
  params: buildPlanParams,
  normalise: (raw, input) => normalisePlanOutput(raw, input.fieldIds),
};
const FIELD_ROUTE = {
  name: 'field', key: 'read',
  validate: validateFieldBody,
  params: buildFieldParams,
  normalise: (raw) => normaliseFieldOutput(raw),
};

/** POST .../plan and .../field: one structured-output call, checked before it goes back. */
export async function handleAdvice(request, { config, getClient }, spec) {
  const raw = await readBody(request, ADVICE_LIMITS.bytes);
  if (raw == null) return fail(413, 'too_large', 'The request is too large.');
  let input, params;
  try {
    input = spec.validate(JSON.parse(raw));
    params = spec.params(config, input);
  } catch (e) {
    if (e instanceof SyntaxError) return fail(400, 'bad_request', 'Bad JSON.');
    if (e instanceof AdviceBadRequest) return fail(e.message === 'farm data is too large' ? 413 : 400, e.message === 'farm data is too large' ? 'context_too_large' : 'bad_request', e.message);
    throw e;
  }
  try {
    const msg = await getClient().beta.messages.create(params, { signal: request.signal });
    if (msg.stop_reason === 'refusal') return fail(502, 'refused', 'The model declined.');
    if (msg.stop_reason === 'max_tokens') return fail(502, 'incomplete', 'The answer was cut short.', { retryable: true });
    const out = spec.normalise(parseJsonMessage(msg), input);
    if (!out) return fail(502, 'bad_output', 'The answer could not be understood.', { retryable: true });
    const u = msg.usage || {};
    return json(200, {
      ok: true, v: 1, [spec.key]: out, model: msg.model,
      served_by_fallback: (u.iterations ?? []).some((e) => e?.type === 'fallback_message'),
      usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_read_input_tokens: u.cache_read_input_tokens ?? 0 },
    });
  } catch (err) {
    const c = classifyError(err);
    if (c.code !== 'aborted') console.warn('[ai]', spec.name, c.code, err?.status ?? '', err?.requestID ?? '');
    return fail(c.status, c.code, 'The request failed.', { retryable: c.retryable });
  }
}
