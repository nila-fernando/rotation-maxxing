// The farms kept on this device (localStorage), for everyone: signed in or not, a reload never loses
// the farm. One versioned key holds a few farms and which one was open last.
//
//   const store = createLocalStore()
//   store.put(snapshot)   store.get(id)   store.current()   store.list()   store.remove(id)
//
// Storage can be missing or throw (private windows, blocked site data, a full quota): then nothing
// is kept and the app carries on as before. A save made by a newer version of the app is left as it
// is (read-only), never overwritten by this one.
import { readSnapshot, summaryOf } from './snapshot.js';

export const LOCAL_KEY = 'rotation-maxxing:farms:v1';
const STORE_VERSION = 1;

/**
 * @param {{ storage?: () => Storage, key?: string, max?: number }} [o]
 *   max: how many farms are kept (the oldest goes first when there are more, or the quota is full)
 */
export function createLocalStore({ storage = () => globalThis.localStorage, key = LOCAL_KEY, max = 8 } = {}) {
  let readOnly = false;

  function read() {
    let raw = null;
    try { raw = storage()?.getItem(key) ?? null; } catch { return { current: null, farms: [] }; }
    if (!raw) { readOnly = false; return { current: null, farms: [] }; }
    let data;
    try { data = JSON.parse(raw); } catch { readOnly = false; return { current: null, farms: [] }; }
    if (!data || typeof data !== 'object') return { current: null, farms: [] };
    if (data.v !== STORE_VERSION) { readOnly = data.v > STORE_VERSION; return { current: null, farms: [] }; }
    readOnly = false;
    const farms = (Array.isArray(data.farms) ? data.farms : []).map(readSnapshot).filter(Boolean);
    return { current: typeof data.current === 'string' ? data.current : null, farms };
  }

  function write(state) {
    if (readOnly) return false;
    let s = null;
    try { s = storage(); } catch { return false; }
    if (!s) return false;
    let farms = [...state.farms].sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1)).slice(0, max);
    // a full quota: let the oldest farms go (never the one being saved) until it fits
    for (;;) {
      try {
        s.setItem(key, JSON.stringify({ v: STORE_VERSION, current: state.current, farms }));
        return true;
      } catch (e) {
        const keep = farms.filter((f) => f.id === state.current);
        const others = farms.filter((f) => f.id !== state.current);
        if (!others.length) { console.warn('Could not save the farm on this device', e); return false; }
        others.pop();
        farms = [...keep, ...others];
      }
    }
  }

  return {
    /** A newer app's save is here: this one leaves it alone. */
    get readOnly() { read(); return readOnly; },
    /** Every farm on this device, newest first: { id, name, fields, acres, savedAt, demo }. */
    list() {
      return read().farms.sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1)).map(summaryOf);
    },
    get(id) { return read().farms.find((f) => f.id === id) || null; },
    /** The farm open last, or null. */
    current() {
      const st = read();
      return st.farms.find((f) => f.id === st.current) || null;
    },
    /** Keeps (or replaces) a farm; it becomes the one open last. Returns whether it was saved. */
    put(snapshot, { makeCurrent = true } = {}) {
      const snap = readSnapshot(snapshot);
      if (!snap) return false;
      const st = read();
      const farms = [snap, ...st.farms.filter((f) => f.id !== snap.id)];
      return write({ current: makeCurrent ? snap.id : st.current, farms });
    },
    /** Changes where a farm lives in the cloud, without touching anything else about it. */
    setCloud(id, cloud) {
      const st = read();
      const f = st.farms.find((x) => x.id === id);
      if (!f) return false;
      f.cloud = cloud;
      return write(st);
    },
    setCurrent(id) {
      const st = read();
      if (id !== null && !st.farms.some((f) => f.id === id)) return false;
      return write({ ...st, current: id });
    },
    remove(id) {
      const st = read();
      if (!st.farms.some((f) => f.id === id)) return false;
      return write({ current: st.current === id ? null : st.current, farms: st.farms.filter((f) => f.id !== id) });
    },
    /** Every farm, as full snapshots (for the first upload to an account). */
    all() { return read().farms; },
  };
}
