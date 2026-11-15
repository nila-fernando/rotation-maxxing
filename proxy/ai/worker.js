// Ask Manami's server as a Cloudflare Worker, so the live site (GitHub Pages, no server of its own)
// can use the chat before Supabase is set up. It runs the app's own handler (app/server/ai/handler.js)
// unchanged and adds what a public endpoint with no sign-in needs:
//
//   - CORS for the app's own origins only; other browser origins get a 403
//   - a per-IP limit on POSTs (10 a minute by default), per isolate
//   - a soft daily cap on POSTs (DAILY_REQUEST_LIMIT, per isolate)
//
// Routes: everything under /api/ai/ goes to the handler (health, chat, and any route it adds later,
// such as jar). The key is the Worker secret ANTHROPIC_API_KEY and never reaches the page.
//
// Deploy: see README.md next to this file.

import { configFromEnv, createAiHandler, createRateLimiter } from '../../app/server/ai/handler.js';

export const PREFIX = '/api/ai/';

/** Origins allowed to use the Worker (exact match). EXTRA_ORIGINS adds more. */
export const ALLOWED_ORIGINS = [
  'https://nila-fernando.github.io',
  'http://localhost:5173',
  'http://localhost:4173', // npm run preview
];

export const DEFAULTS = Object.freeze({ perMinute: 10, daily: 500 });

/** The CORS headers for an allowed origin, or null. */
export function corsFor(origin, allowed = ALLOWED_ORIGINS) {
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
const fail = (status, code, message, { retryable = false, headers = {} } = {}) => json(status, { ok: false, error: { code, message, retryable } }, headers);

/** A soft cap per UTC day (per isolate: a fresh isolate starts at zero). */
export function createDailyCap(limit, now = () => Date.now()) {
  let day = null, n = 0;
  return () => {
    const d = Math.floor(now() / 86_400_000);
    if (d !== day) { day = d; n = 0; }
    if (n >= limit) return false;
    n++;
    return true;
  };
}

function withHeaders(res, extra) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  // the body passes through as is, so a Server-Sent Events stream keeps streaming
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/**
 * The Worker's logic around a web-standard handler. Pure enough to test with a fake handler.
 * @param {object} o
 * @param {(request: Request, info: { ip: string }) => Promise<Response>} o.handle
 * @param {string[]} [o.allowed]
 * @param {number} [o.perMinute]
 * @param {number} [o.daily]
 * @param {() => number} [o.now]
 */
export function createWorker({ handle, allowed = ALLOWED_ORIGINS, perMinute = DEFAULTS.perMinute, daily = DEFAULTS.daily, now = () => Date.now() }) {
  const limiter = createRateLimiter({ perMinute, now });
  const dailyOk = createDailyCap(daily, now);
  return async function serve(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsFor(origin, allowed);
    // Browsers always send Origin on cross-site fetches; refusing other origins keeps it to our app.
    if (origin && !cors) return fail(403, 'origin_not_allowed', 'This site can’t use Manami’s helper.');
    const c = cors || {};
    if (request.method === 'OPTIONS') return cors ? new Response(null, { status: 204, headers: cors }) : fail(403, 'origin_not_allowed', 'This site can’t use Manami’s helper.');
    if (!url.pathname.startsWith(PREFIX)) return fail(404, 'not_found', 'No such route.', { headers: c });

    if (request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = limiter(`ip:${ip}`);
      if (!rl.ok) return fail(429, 'rate_limited', 'That’s a lot of questions at once. Give it a minute and ask again.', { retryable: true, headers: { ...c, 'Retry-After': String(rl.retryAfter) } });
      if (!dailyOk()) return fail(503, 'daily_limit', 'Manami has answered all the questions she can for today. Ask again tomorrow.', { headers: c });
    }

    // The handler refuses requests whose Origin isn't its own host; this Worker checked it above,
    // so the handler gets the request without it.
    const headers = new Headers(request.headers);
    headers.delete('Origin');
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const inner = new Request(url, { method: request.method, headers, body: hasBody ? request.body : undefined, duplex: hasBody ? 'half' : undefined, signal: request.signal });
    let res;
    try {
      res = await handle(inner, { ip: request.headers.get('CF-Connecting-IP') || 'unknown' });
    } catch (err) {
      console.warn('[ai worker]', err?.name || 'error');
      return fail(500, 'server_error', 'Something went wrong on Manami’s side. Try again.', { headers: c });
    }
    return cors ? withHeaders(res, cors) : res;
  };
}

/** Builds the handler and Worker once per isolate (env doesn't change within one). */
let built = null;
async function build(env) {
  const config = configFromEnv({
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    AI_MODEL: env.AI_MODEL || 'claude-sonnet-5-5',
    AI_ENABLED: env.AI_ENABLED,
    AI_FALLBACKS: env.AI_FALLBACKS,
    AI_RATE_LIMIT_PER_MIN: env.AI_RATE_LIMIT_PER_MIN || String(DEFAULTS.perMinute),
  });
  let client = null;
  if (config.ai) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 120_000 });
  }
  const getClient = () => {
    if (!client) throw new Error('AI client not ready');
    return client;
  };
  const handle = createAiHandler({ config, getClient, getUser: async () => null });
  const extra = String(env.EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const daily = Math.max(1, Number.parseInt(env.DAILY_REQUEST_LIMIT, 10) || DEFAULTS.daily);
  const perMinute = Math.max(1, Number.parseInt(env.AI_RATE_LIMIT_PER_MIN, 10) || DEFAULTS.perMinute);
  return createWorker({ handle, allowed: [...ALLOWED_ORIGINS, ...extra], perMinute, daily });
}

export default {
  async fetch(request, env) {
    if (!built) built = build(env);
    try {
      return await (await built)(request);
    } catch (err) {
      built = null;
      console.warn('[ai worker] setup', err?.name || 'error');
      return fail(500, 'server_error', 'Something went wrong on Manami’s side. Try again.');
    }
  },
};
