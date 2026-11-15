// Fetching the farm's data, source by source, each within its own budget, with a live status the
// loading screen and the field check-up read (src/data/loadStatus.js).
//
//   const load = startFarmLoad({ fields, point, runners, onData, current })
//   current: () => the fields as they are now (with what's been found merged in), for retries
//   load.tracker          the status per source and field
//   load.whenSettled()    resolves once every source is done, has no data here, or has failed
//   load.retry('soil')    asks again, for the fields (or the farm) that failed; resolves when settled
//   load.cancel()         a newer farm replaced this one: nothing more is reported
//
// A runner fetches one source: runner({ fields, point, signal, field, settle }), where
//   field(id, state, value?, reason?)   a field settled ('done' | 'none' | 'failed'); value, when
//                                       there is one, goes to onData(key, { [id]: value })
//   settle(state, value?, reason?)      the whole source settled (farm-wide ones); value -> onData
// and signal aborts when its budget runs out. Whatever hasn't settled by then, or when the runner
// returns or throws, is marked failed: nothing is left loading.
import { SOURCE_BY_KEY, createLoadTracker } from './loadStatus.js';
import { realClock, withBudget } from './net.js';

/**
 * Each source's overall budget (ms). They run side by side, so a farm on a bad day waits at most
 * the longest of them (crop history: CropScape answers one point and year at a time).
 */
export const BUDGETS = { crops: 110000, soil: 60000, slope: 60000, rain: 45000, greenness: 100000, market: 100000 };

export function startFarmLoad({ fields, point, runners, onData = () => {}, current = () => fields, budgets = BUDGETS, clock = realClock }) {
  const ids = fields.map((f) => f.id);
  const keys = Object.keys(runners);
  const tracker = createLoadTracker(ids, { sources: keys.map((k) => SOURCE_BY_KEY[k]) });
  const runs = new Map(); // key -> the latest run's token (an older run's late answers are ignored)
  let cancelled = false;

  function run(key, only = null) {
    const token = {};
    runs.set(key, token);
    const live = () => !cancelled && runs.get(key) === token;
    const perField = SOURCE_BY_KEY[key].perField;
    const want = perField ? (only ?? ids) : null;
    tracker.begin(key, want);
    // the fields as they are now (a retry starts from what the first try already found)
    const now = current() || fields;
    const target = perField ? now.filter((f) => want.includes(f.id)) : now;
    const ctx = (signal) => ({
      fields: target,
      allFields: now,
      point,
      signal,
      field(id, state, value = null, reason = null) {
        if (!live()) return;
        if (value != null) onData(key, { [id]: value });
        tracker.field(key, id, state, reason);
      },
      settle(state, value = null, reason = null) {
        if (!live()) return;
        if (value != null) onData(key, value);
        tracker.settle(key, state, reason);
      },
    });
    return withBudget((signal) => runners[key](ctx(signal)), budgets[key] ?? 60000, { clock })
      .then(
        () => { if (live()) tracker.failRemaining(key, `${SOURCE_BY_KEY[key].name} gave no answer`); },
        (e) => {
          if (!live()) return;
          if (e?.timedOut) console.warn(`${key}: out of time`);
          else console.warn(`${key}:`, e);
          tracker.failRemaining(key, e?.timedOut ? `${SOURCE_BY_KEY[key].name} took too long to answer` : e?.message || `${SOURCE_BY_KEY[key].name} could not be reached`);
        },
      );
  }

  for (const key of keys) run(key);

  return {
    tracker,
    fields,
    point,
    whenSettled: () => tracker.whenSettled(),
    get settled() { return tracker.settled; },
    /** Asks a source again, for whatever of it failed. */
    retry(key) {
      if (cancelled || !runners[key]) return Promise.resolve();
      const r = tracker.get(key);
      if (r.state === 'loading') return tracker.whenSettled();
      const only = SOURCE_BY_KEY[key].perField ? ids.filter((id) => tracker.fieldState(key, id)?.state === 'failed') : null;
      if (only && !only.length) return Promise.resolve();
      return run(key, only);
    },
    cancel() { cancelled = true; },
    get cancelled() { return cancelled; },
  };
}
