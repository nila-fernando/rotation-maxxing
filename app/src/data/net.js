// Every data source's requests settle in bounded time: a timeout per try, a few tries with backoff,
// and an overall budget per source (src/data/farmLoad.js), so the loading screen can wait for all
// of them without ever hanging.
//
//   fetchRetry(fetchFn, url, init, { timeoutMs, attempts, backoffMs, signal, clock })
//     -> the Response (ok, a 4xx, or the last try's 5xx), or throws Unreachable (network error,
//        timeout, or the source's budget ran out: `signal` aborted)
//   withBudget((signal) => work, ms, { clock })   the work, or Unreachable('took too long') at ms
//   pool(n)   at most n jobs in flight
//
// `clock` ({ setTimeout, clearTimeout }) is injectable so tests can run timeouts on a fake clock.

export const realClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (t) => globalThis.clearTimeout(t),
};

/** A source couldn't be reached (as opposed to answering that it has no data here). */
export class Unreachable extends Error {
  constructor(message, { timedOut = false, status = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.code = 'unreachable';
    this.timedOut = timedOut;
    this.status = status;
  }
}

/** Waits ms (on the clock); throws Unreachable if the signal aborts first. */
export function sleep(ms, { signal = null, clock = realClock } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Unreachable('stopped', { timedOut: true })); return; }
    const t = clock.setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clock.clearTimeout(t); reject(new Unreachable('stopped', { timedOut: true })); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const serverError = (res) => res.status >= 500 || res.status === 429;

/**
 * One request with a timeout per try and retries with exponential backoff (backoffMs, then twice
 * that...). A 5xx or 429 is tried again; the last try's answer is returned as it is, so the caller
 * can read its status. Network errors and timeouts on every try throw Unreachable.
 */
export async function fetchRetry(fetchFn, url, init = {}, { timeoutMs = 15000, attempts = 3, backoffMs = 500, signal = null, clock = realClock, retryable = serverError } = {}) {
  let last = null;
  for (let a = 0; a < attempts; a++) {
    if (signal?.aborted) throw new Unreachable('stopped', { timedOut: true });
    if (a > 0 && backoffMs > 0) await sleep(backoffMs * 2 ** (a - 1), { signal, clock });
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = clock.setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onOuter = () => ctrl.abort();
    signal?.addEventListener('abort', onOuter, { once: true });
    try {
      const res = await fetchFn(url, { ...init, signal: ctrl.signal });
      if (!res.ok && retryable(res) && a < attempts - 1) { last = new Unreachable(`HTTP ${res.status}`, { status: res.status }); continue; }
      return res;
    } catch (e) {
      const stopped = !!signal?.aborted;
      last = new Unreachable(stopped ? 'stopped' : timedOut ? 'timed out' : 'no answer', { timedOut: timedOut || stopped, cause: e });
      if (stopped) throw last;
    } finally {
      clock.clearTimeout(timer);
      signal?.removeEventListener('abort', onOuter);
    }
  }
  throw last;
}

/** A 5xx that survived its retries is a source that couldn't be reached, not one with no data. */
export function assertAnswered(res, what = 'the source') {
  if (res.status >= 500 || res.status === 429) throw new Unreachable(`${what} answered HTTP ${res.status}`, { status: res.status });
  return res;
}

/**
 * Runs work(signal) with an overall budget. At ms the signal aborts (every request still in
 * flight stops) and this throws Unreachable(timedOut), whether or not the work has finished
 * unwinding: a source can't keep the farm waiting past its budget.
 */
export function withBudget(work, ms, { clock = realClock } = {}) {
  const ctrl = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = clock.setTimeout(() => {
      ctrl.abort();
      reject(new Unreachable('took too long', { timedOut: true }));
    }, ms);
    Promise.resolve()
      .then(() => work(ctrl.signal))
      .then((v) => { clock.clearTimeout(timer); resolve(v); }, (e) => { clock.clearTimeout(timer); reject(e); });
  });
}

/** A small pool: at most n jobs in flight; run(fn) resolves or rejects with fn's result. */
export function pool(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
