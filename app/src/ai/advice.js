// Manami's take on the plans and her read on a field: the client side of POST .../plan and .../field
// (server/ai/advice.js). Pure apart from fetch (passed in for the tests).
//
//   adviceRoutes(endpoint)                 -> Set of the server's routes ('plan', 'field', ...)   never throws
//   askAdvice(endpoint, route, body)       -> { take } | { read } | { error, retryable }        never throws
//   planBody(host)                         the farm, the three plans and every field's check-up
//   takeToPlan(take, data)                 -> { plan, adjusted: Set<fieldId> } in the planner's Plan shape
//
// The model only picks and explains: whatever it proposes is scored by the app's own planner
// (evaluateMix) before the farmer sees a number.
import { buildFarmContext, fieldDetail, plansSummary } from './context.js';

/** The server's routes, from its health (once per endpoint while it answers). Never throws. */
const routesCache = new Map();
export function adviceRoutes(endpoint, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (!endpoint || typeof fetchImpl !== 'function') return Promise.resolve(new Set());
  if (routesCache.has(endpoint)) return routesCache.get(endpoint);
  const p = (async () => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${endpoint}/health`, { signal: ac.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) return new Set();
      const body = await res.json();
      return body?.ai === true && Array.isArray(body.routes) ? new Set(body.routes) : new Set();
    } catch {
      return new Set();
    } finally {
      clearTimeout(t);
    }
  })();
  routesCache.set(endpoint, p);
  p.then((s) => { if (!s.size) routesCache.delete(endpoint); }); // ask again next time if it didn't answer
  return p;
}
/** (tests) */
export const clearAdviceCache = () => routesCache.clear();

/** POSTs to a route. { take } / { read } or { error, retryable }. Never throws. */
export async function askAdvice(endpoint, route, body, { fetchImpl = globalThis.fetch, signal, timeoutMs = 120_000 } = {}) {
  if (!endpoint || typeof fetchImpl !== 'function') return { error: 'unavailable', retryable: false };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  signal?.addEventListener?.('abort', () => ac.abort(), { once: true });
  try {
    const res = await fetchImpl(`${endpoint}/${route}`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ v: 1, ...body }),
    });
    const out = await res.json().catch(() => null);
    const key = route === 'plan' ? 'take' : 'read';
    if (!res.ok || !out?.ok || !out[key]) return { error: out?.error?.code || `http_${res.status}`, retryable: !!out?.error?.retryable };
    return { [key]: out[key] };
  } catch {
    return { error: signal?.aborted ? 'aborted' : 'unreachable', retryable: true };
  } finally {
    clearTimeout(t);
  }
}

const safe = (fn) => { try { return fn() ?? null; } catch { return null; } };

/** What the plan route needs: the farm, the three plans (with planner crop ids), every field's check-up. */
export function planBody(host) {
  const context = buildFarmContext(host);
  const data = safe(() => host.plansData());
  const today = safe(() => host.today()) || new Date();
  const plans = plansSummary(data, today);
  // the planner's own crop ids beside the names, so an adjusted sequence can use them
  if (plans.ready) {
    for (const p of plans.plans) {
      const src = data.result.plans[p.kind];
      for (const f of p.fields) {
        const seq = src?.plan?.sequences?.[f.field_id] || [];
        f.seasons = f.seasons.map((s, i) => ({ ...s, crop_id: seq[i]?.main ?? null, ...(seq[i]?.cover ? { cover: seq[i].cover } : {}) }));
      }
    }
  }
  const fields = (safe(() => host.fields()) || []).map((f) => safe(() => host.report(f.id))).filter(Boolean).map(fieldDetail);
  return { context, plans, fields };
}

/** What the field route needs: the farm and the one field. */
export function fieldBody(host, report) {
  return { context: buildFarmContext(host), field: fieldDetail(report) };
}

/**
 * Manami's take as a plan the planner can score: each field takes the plan she picked, or her own
 * three seasons when she gave them (and `withAdjusted`). Fields she didn't mention keep Manami's pick.
 */
export function takeToPlan(take, data, { withAdjusted = true } = {}) {
  const plans = data.result.plans;
  const by = new Map((take?.fields || []).map((f) => [f.field_id, f]));
  const sequences = {};
  const adjusted = new Set();
  for (const p of plans.priority.paddocks) {
    const id = p.paddockId;
    const f = by.get(id);
    if (withAdjusted && f?.adjusted?.length === 3) {
      sequences[id] = f.adjusted.map((s) => (s.cover ? { main: s.main, cover: s.cover } : { main: s.main }));
      adjusted.add(id);
    } else {
      sequences[id] = (plans[f?.pick] || plans.priority).plan.sequences[id];
    }
  }
  return { plan: { sequences }, adjusted };
}

/** The picks per field from her take (fields she didn't mention: Manami's pick). */
export function takeChoice(take, data) {
  const by = new Map((take?.fields || []).map((f) => [f.field_id, f.pick]));
  return Object.fromEntries(data.result.plans.priority.paddocks.map((p) => [p.paddockId, data.result.plans[by.get(p.paddockId)] ? by.get(p.paddockId) : 'priority']));
}

/** What Manami says when her take or read couldn't be had. */
export function adviceFailLine(code) {
  if (code === 'rate_limited' || code === 'upstream_rate_limited' || code === 'daily_limit') return 'That’s a lot of asking at once. Give me a minute and try again.';
  if (code === 'refused') return 'I can’t help with that one.';
  return 'I couldn’t reach my helper just now. Try again in a moment.';
}
