// A tiny CORS proxy for USDA CropScape (Cropland Data Layer), as a Cloudflare Worker.
//
// CropScape answers point lookups but sends no Access-Control-Allow-Origin header, so the app (on
// GitHub Pages) can't call it from the browser. This Worker forwards exactly one kind of request,
//
//   GET /axis2/services/CDLService/GetCDLValue?year=YYYY&x=<metres>&y=<metres>
//
// to https://nassgeodata.gmu.edu and adds the CORS header for the app's own origins. Anything else
// gets a 404 or 403, so it isn't an open proxy. A CDL value for one point in one year never changes,
// so good answers are cached at Cloudflare's edge (and in the browser) for a year.
//
// Deploy: see README.md next to this file. Then set the repository variable VITE_CDL_PROXY to the
// Worker's address (no trailing slash) and re-run the GitHub Pages deploy.

const UPSTREAM = 'https://nassgeodata.gmu.edu';
const PATH = '/axis2/services/CDLService/GetCDLValue';
const TIMEOUT_MS = 15000;
const YEAR_MIN = 2008; // first year CDL covers the whole lower 48
const CACHE_SECONDS = 60 * 60 * 24 * 365;

/** Origins allowed to use the proxy. Add yours here (exact match), e.g. a custom domain. */
export const ALLOWED_ORIGINS = [
  'https://nila-fernando.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173', // npm run preview
  'http://127.0.0.1:4173',
];

/** The CORS headers for an allowed origin, or null. */
export function corsFor(origin, allowed = ALLOWED_ORIGINS) {
  if (!origin || !allowed.includes(origin)) return null;
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}

/** The upstream URL for a request, or null if it isn't a well-formed CDL point lookup. */
export function upstreamUrl(url, thisYear = new Date().getUTCFullYear()) {
  if (url.pathname !== PATH) return null;
  const p = url.searchParams;
  const keys = [...p.keys()];
  if (keys.length !== 3 || !['year', 'x', 'y'].every((k) => p.has(k))) return null;
  const year = Number(p.get('year'));
  const x = Number(p.get('x'));
  const y = Number(p.get('y'));
  if (!Number.isInteger(year) || year < YEAR_MIN || year > thisYear) return null;
  // EPSG:5070 metres for the contiguous US, with a margin
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 3.0e6 || y < 0 || y > 3.5e6) return null;
  return `${UPSTREAM}${PATH}?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`;
}

const text = (body, status, headers = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers } });

export async function handle(request, { fetchFn = fetch, cache = globalThis.caches?.default, allowed = ALLOWED_ORIGINS, waitUntil = () => {} } = {}) {
  const origin = request.headers.get('Origin');
  const cors = corsFor(origin, allowed);
  // Browsers always send Origin on cross-site fetches; refusing other origins keeps it to our app.
  if (origin && !cors) return text('Origin not allowed', 403);
  if (request.method === 'OPTIONS') return cors ? new Response(null, { status: 204, headers: cors }) : text('Origin not allowed', 403);
  if (request.method !== 'GET') return text('Method not allowed', 405, { ...(cors || {}), Allow: 'GET, OPTIONS' });

  const target = upstreamUrl(new URL(request.url));
  if (!target) return text('Not found', 404, cors || {});

  const key = new Request(target, { method: 'GET' });
  const hit = cache ? await cache.match(key) : null;
  if (hit) return withHeaders(hit, { ...(cors || {}), 'X-Proxy-Cache': 'HIT' });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetchFn(target, { signal: ctrl.signal, headers: { Accept: 'application/xml, text/xml, */*' } });
  } catch {
    return text('CropScape did not answer', 504, cors || {});
  } finally {
    clearTimeout(timer);
  }
  const body = await res.text();
  // Only a real answer is cached: CropScape's 5xx and errors pass through uncached, so the app retries.
  const good = res.ok && /category:\s*"/.test(body);
  const headers = {
    'Content-Type': res.headers.get('Content-Type') || 'application/xml; charset=utf-8',
    'Cache-Control': good ? `public, max-age=${CACHE_SECONDS}, immutable` : 'no-store',
    ...(cors || {}),
    'X-Proxy-Cache': 'MISS',
  };
  const out = new Response(body, { status: res.status, headers });
  if (good && cache) waitUntil(cache.put(key, new Response(body, { status: 200, headers: { 'Content-Type': headers['Content-Type'], 'Cache-Control': headers['Cache-Control'] } })));
  return out;
}

function withHeaders(res, extra) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  fetch(request, env, ctx) {
    const extra = (env?.EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    return handle(request, { allowed: [...ALLOWED_ORIGINS, ...extra], waitUntil: (p) => ctx.waitUntil(p) });
  },
};
