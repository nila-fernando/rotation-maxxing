// Where each of the farm's data sources has got to: what the loading checklist shows, what the
// reveal waits for, and what the field check-up says when a section is empty.
//
//   state per source (and per field, for the sources fetched field by field):
//     'loading'  still asking
//     'done'     the data is in
//     'none'     the source answered: it has no data here
//     'failed'   the source couldn't be reached (or ran out of time)
//
//   const t = createLoadTracker(fieldIds)
//   t.begin('soil', ['a', 'b'])   per field          t.begin('rain')   for the whole farm
//   t.field('soil', 'a', 'done')   t.settle('rain', 'failed', 'NASA POWER did not answer')
//   t.failRemaining('soil', reason)   anything still loading -> failed (a budget ran out)
//   t.get('soil') -> { key, label, source, perField, state, total, done, none, failed, loading, reason, partial }
//   t.fieldState('soil', 'a') -> { state, reason } | null
//   t.settled  t.whenSettled()  t.subscribe(fn) -> off

/** The farm's data sources, in the checklist's order. */
export const LOAD_SOURCES = [
  { key: 'crops', label: 'Crop history, 8 years', source: 'USDA CSB, CDL', name: 'CropScape (USDA Cropland Data Layer)', perField: true },
  { key: 'soil', label: 'Soil', source: 'USDA SSURGO', name: 'USDA Soil Data Access (SSURGO)', perField: true },
  { key: 'slope', label: 'Terrain and slope', source: 'USGS 3DEP', name: 'the elevation tiles (USGS 3DEP)', perField: true },
  { key: 'rain', label: 'Rain since 1991', source: 'NASA POWER', name: 'NASA POWER', perField: false },
  { key: 'greenness', label: 'Greenness last season', source: 'NASA HLS', name: 'NASA HLS (Microsoft Planetary Computer)', perField: true },
  { key: 'market', label: 'Local crops, yields and prices', source: 'USDA NASS', name: 'USDA NASS', perField: false },
];
export const SOURCE_BY_KEY = Object.fromEntries(LOAD_SOURCES.map((s) => [s.key, s]));
const SETTLED = new Set(['done', 'none', 'failed']);

export function createLoadTracker(fieldIds = [], { sources = LOAD_SOURCES } = {}) {
  const ids = [...fieldIds];
  const listeners = new Set();
  const waiters = [];
  // key -> { state, reason, fields: Map id -> { state, reason } }
  const rows = new Map(sources.map((s) => [s.key, { meta: s, state: 'loading', reason: null, fields: new Map(s.perField ? ids.map((id) => [id, { state: 'loading', reason: null }]) : []) }]));

  let queued = false;
  function changed() {
    // one notice per tick, however many fields settled in it
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const fn of [...listeners]) { try { fn(api); } catch (e) { console.error('load status listener', e); } }
      if (isSettled()) waiters.splice(0).forEach((r) => r());
    });
  }

  const row = (key) => {
    const r = rows.get(key);
    if (!r) throw new Error(`unknown data source: ${key}`);
    return r;
  };

  function derive(r) {
    if (!r.meta.perField) return r.state;
    const s = [...r.fields.values()].map((f) => f.state);
    if (s.includes('loading')) return 'loading';
    if (s.includes('done')) return 'done';
    if (s.includes('failed')) return 'failed';
    return 'none';
  }

  function begin(key, only = null) {
    const r = row(key);
    if (r.meta.perField) {
      for (const id of only ?? ids) r.fields.set(id, { state: 'loading', reason: null });
    } else {
      r.state = 'loading';
      r.reason = null;
    }
    changed();
  }

  function field(key, id, state, reason = null) {
    const r = row(key);
    if (!SETTLED.has(state) && state !== 'loading') throw new Error(`unknown state: ${state}`);
    if (!r.fields.has(id)) return;
    r.fields.set(id, { state, reason: state === 'failed' || state === 'none' ? reason : null });
    if (state === 'failed' && reason) r.reason = reason;
    changed();
  }

  function settle(key, state, reason = null) {
    const r = row(key);
    if (r.meta.perField) {
      for (const id of r.fields.keys()) if (r.fields.get(id).state === 'loading') field(key, id, state, reason);
      if (reason) r.reason = reason;
      return;
    }
    r.state = state;
    r.reason = state === 'done' ? null : reason;
    changed();
  }

  /** Anything of this source still loading has failed (its budget ran out, or it stopped answering). */
  function failRemaining(key, reason) {
    const r = row(key);
    if (r.meta.perField) {
      let any = false;
      for (const [id, f] of r.fields) if (f.state === 'loading') { r.fields.set(id, { state: 'failed', reason }); any = true; }
      if (any) { r.reason = reason; changed(); }
    } else if (r.state === 'loading') {
      settle(key, 'failed', reason);
    }
  }

  function get(key) {
    const r = row(key);
    const state = derive(r);
    const count = (st) => [...r.fields.values()].filter((f) => f.state === st).length;
    const out = { key, label: r.meta.label, source: r.meta.source, name: r.meta.name, perField: r.meta.perField, state, reason: r.reason };
    if (r.meta.perField) {
      Object.assign(out, { total: r.fields.size, done: count('done'), none: count('none'), failed: count('failed'), loading: count('loading') });
      out.partial = out.state === 'done' && out.done < out.total;
      if (!out.failed && state !== 'failed') out.reason = state === 'none' ? r.reason : null;
    } else {
      Object.assign(out, { total: 1, done: +(state === 'done'), none: +(state === 'none'), failed: +(state === 'failed'), loading: +(state === 'loading'), partial: false });
    }
    return out;
  }

  /** A field's state for a source (farm-wide sources give the farm's), or null for an unknown field. */
  function fieldState(key, id) {
    const r = row(key);
    if (!r.meta.perField) return { state: r.state, reason: r.reason };
    const f = r.fields.get(id);
    return f ? { ...f } : null;
  }

  const isSettled = () => [...rows.keys()].every((k) => get(k).state !== 'loading');

  const api = {
    begin,
    field,
    settle,
    failRemaining,
    get,
    fieldState,
    /** Every source, in order. */
    all: () => [...rows.keys()].map(get),
    get fieldIds() { return [...ids]; },
    get settled() { return isSettled(); },
    /** Resolves once every source has settled (done, none or failed). */
    whenSettled() {
      if (isSettled()) return Promise.resolve();
      return new Promise((r) => waiters.push(r));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}

/** Each source's share settled (0..1), averaged: the checklist's progress bar. */
export function settledShare(rowsList) {
  if (!rowsList.length) return 1;
  return rowsList.reduce((s, r) => s + (r.total ? (r.total - r.loading) / r.total : 1), 0) / rowsList.length;
}

/**
 * The checklist's line under a source: "3 of 5 fields", "No data here", "Couldn’t reach USDA NASS".
 */
export function statusText(r) {
  if (r.state === 'loading') {
    return r.perField && r.total > 1 && r.total - r.loading > 0 ? `Checking… ${r.total - r.loading} of ${r.total} fields` : 'Checking…';
  }
  if (r.state === 'none') return 'No data here';
  if (r.state === 'failed') return `Couldn’t reach ${r.source}`;
  if (!r.perField || r.done === r.total) return r.perField && r.total > 1 ? `All ${r.total} fields` : 'Done';
  const extra = [r.none ? `no data for ${r.none}` : null, r.failed ? `couldn’t reach ${r.failed}` : null].filter(Boolean).join(', ');
  return `${r.done} of ${r.total} fields${extra ? ` (${extra})` : ''}`;
}
