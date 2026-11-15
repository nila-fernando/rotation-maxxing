// Debounced saving with retries: many changes in a row make one save, a save never runs twice at
// once, and a failed one is tried again later (waiting longer each time), so a dropped connection
// never turns into a flood of requests.
//
//   const s = createScheduler(run, { delay: 800 })
//   s.schedule()   a change happened: save after `delay` of quiet
//   s.flush()      save now (the page is being hidden, the connection came back)
//   s.cancel()     forget anything waiting
//
// run() may return a promise; a rejection means "try again later".

/**
 * @param {() => any} run
 * @param {{ delay?: number, retryBase?: number, retryMax?: number, timers?: { setTimeout: Function, clearTimeout: Function },
 *   onError?: (e: unknown, attempt: number) => void }} [o]
 */
export function createScheduler(run, { delay = 800, retryBase = 2000, retryMax = 60000, timers = globalThis, onError = () => {} } = {}) {
  let timer = null;
  let running = null; // the save in progress
  let again = false; // a change came in while saving: save once more after
  let attempt = 0; // failures in a row

  const clear = () => { if (timer) timers.clearTimeout(timer); timer = null; };
  const wait = (ms) => { clear(); timer = timers.setTimeout(() => { timer = null; go(); }, ms); };

  async function go() {
    if (running) { again = true; return running; }
    clear();
    again = false;
    running = (async () => {
      try {
        await run();
        attempt = 0;
      } catch (e) {
        attempt++;
        onError(e, attempt);
        if (!again) wait(Math.min(retryMax, retryBase * 2 ** (attempt - 1)));
      }
    })();
    try { await running; } finally { running = null; }
    if (again) wait(delay);
  }

  return {
    schedule() {
      if (running) { again = true; return; }
      wait(delay);
    },
    flush() { return go(); },
    cancel() { clear(); again = false; },
    /** 'idle' | 'waiting' | 'running' */
    get state() { return running ? 'running' : timer ? 'waiting' : 'idle'; },
    get failures() { return attempt; },
  };
}
