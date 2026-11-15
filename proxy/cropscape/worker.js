// A tiny proxy for two USDA services the app can't call from the browser, as a Cloudflare Worker.
//
// 1. CropScape (Cropland Data Layer) answers point lookups but sends no Access-Control-Allow-Origin
//    header. This Worker forwards exactly one kind of request,
//
//      GET /axis2/services/CDLService/GetCDLValue?year=YYYY&x=<metres>&y=<metres>
//
//    to https://nassgeodata.gmu.edu. A CDL value for one point in one year never changes, so good
//    answers are cached at Cloudflare's edge (and in the browser) for a year.
//
// 2. USDA NASS Quick Stats needs an API key and sends no CORS header either. This Worker forwards
//
//      GET /nass/api_GET/?<Quick Stats filters>
//
//    to https://quickstats.nass.usda.gov/api/api_GET/ with the key from the Worker secret
//    NASS_API_KEY (`wrangler secret put NASS_API_KEY`), so the key never reaches the browser. Any
//    key the client sends is dropped; only a fixed set of filter parameters is passed on (see
//    NASS_PARAMS), and only JSON. Good answers are cached for a day (NASS revises figures now and then).
//
// Both routes add the CORS header for the app's own origins only. Anything else gets a 403, 404 or
// 405, so it isn't an open proxy.
//
// Deploy: see README.md next to this file. Then set the repository variables VITE_CDL_PROXY (the
// Worker's address, no trailing slash) and VITE_NASS_PROXY (the same address + /nass) and re-run
// the GitHub Pages deploy.

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

// ---------------------------------------------------------------------------
// USDA NASS Quick Stats
// ---------------------------------------------------------------------------

const NASS_UPSTREAM = 'https://quickstats.nass.usda.gov/api/api_GET/';
const NASS_TIMEOUT_MS = 30000; // Quick Stats is slow: 5-10 s is normal
const NASS_CACHE_SECONDS = 60 * 60 * 24;
/** Quick Stats filter parameters the proxy passes on (the `__GE`-style operators only on year). */
export const NASS_PARAMS = new Set([
  'source_desc', 'sector_desc', 'group_desc', 'commodity_desc', 'class_desc', 'prodn_practice_desc', 'util_practice_desc',
  'statisticcat_desc', 'unit_desc', 'short_desc', 'domain_desc', 'domaincat_desc', 'agg_level_desc',
  'state_alpha', 'state_fips_code', 'state_name', 'asd_code', 'county_code', 'county_name',
  'year', 'year__GE', 'year__LE', 'year__GT', 'year__LT', 'freq_desc', 'reference_period_desc', 'format',
]);
const NASS_MAX_PARAMS = 80;
const NASS_MAX_QUERY = 6000;
const NASS_VALUE = /^[\x20-\x7E]{1,120}$/; // printable ASCII, as in NASS's own names ("$ / CWT", "(EXCL ALFALFA)")

/**
 * The Quick Stats URL for a /nass request, with `key` set server side, or null if the request isn't a
 * plain api_GET with allowed parameters. Any key the client sent is dropped; the format is always JSON.
 */
export function nassUpstreamUrl(url, key) {
  if (!key || !/^\/nass\/api_GET\/?$/.test(url.pathname)) return null;
  if (url.search.length > NASS_MAX_QUERY) return null;
  const out = new URLSearchParams();
  let n = 0;
  for (const [k, v] of url.searchParams) {
    if (k === 'key') continue;
    if (!NASS_PARAMS.has(k) || !NASS_VALUE.test(v) || ++n > NASS_MAX_PARAMS) return null;
    if (k === 'format') continue;
    if (/^year/.test(k) && !/^\d{4}$/.test(v)) return null;
    out.append(k, v);
  }
  if (!n) return null; // an unfiltered query would ask for the whole database
  out.set('format', 'JSON');
  return { cacheKey: `https://nass-cache.invalid/api_GET/?${out}`, url: `${NASS_UPSTREAM}?key=${encodeURIComponent(key)}&${out}` };
}

async function handleNass(request, cors, { fetchFn, cache, waitUntil, nassKey }) {
  if (!nassKey) return text('NASS key not configured', 503, cors || {});
  const target = nassUpstreamUrl(new URL(request.url), nassKey);
  if (!target) return text('Not allowed', 403, cors || {});
  // cached under a URL without the key
  const key = new Request(target.cacheKey, { method: 'GET' });
  const hit = cache ? await cache.match(key) : null;
  if (hit) return withHeaders(hit, { ...(cors || {}), 'X-Proxy-Cache': 'HIT' });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NASS_TIMEOUT_MS);
  let res;
  try {
    res = await fetchFn(target.url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } catch {
    return text('USDA NASS did not answer', 504, cors || {});
  } finally {
    clearTimeout(timer);
  }
  const body = await res.text();
  // only real data is cached; "no data" (400), errors and 5xx pass through uncached
  const good = res.ok && body.startsWith('{"data"');
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': good ? `public, max-age=${NASS_CACHE_SECONDS}` : 'no-store',
    ...(cors || {}),
    'X-Proxy-Cache': 'MISS',
  };
  if (good && cache) waitUntil(cache.put(key, new Response(body, { status: 200, headers: { 'Content-Type': headers['Content-Type'], 'Cache-Control': headers['Cache-Control'] } })));
  return new Response(body, { status: res.status, headers });
}

export async function handle(request, { fetchFn = fetch, cache = globalThis.caches?.default, allowed = ALLOWED_ORIGINS, waitUntil = () => {}, nassKey = '' } = {}) {
  const origin = request.headers.get('Origin');
  const cors = corsFor(origin, allowed);
  // Browsers always send Origin on cross-site fetches; refusing other origins keeps it to our app.
  if (origin && !cors) return text('Origin not allowed', 403);
  if (request.method === 'OPTIONS') return cors ? new Response(null, { status: 204, headers: cors }) : text('Origin not allowed', 403);
  if (request.method !== 'GET') return text('Method not allowed', 405, { ...(cors || {}), Allow: 'GET, OPTIONS' });

  if (new URL(request.url).pathname.startsWith('/nass/')) return handleNass(request, cors, { fetchFn, cache, waitUntil, nassKey });

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
    return handle(request, { allowed: [...ALLOWED_ORIGINS, ...extra], waitUntil: (p) => ctx.waitUntil(p), nassKey: env?.NASS_API_KEY || '' });
  },
};
