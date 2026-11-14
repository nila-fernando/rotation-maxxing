// Each field's crop for any year: the island's paddocks swap to that year's crop (corn, soybeans,
// oats...) and grow, ripen and get cut with the seasons.
//
// A paddock is built once per field and crop, then kept and shown or hidden, so stepping through
// the years is instant after the first time (and builds for the coming years are done ahead, in
// idle time).
//
//   const crops = createCropYears({ fields, onBuilt })   fields: the reveal's view.fields
//   crops.setYear(keysById)      Map id -> crop key for the year shown
//   crops.setSize(s)             every plant 0..1 (growth through the season, stubble after harvest)
//   crops.prebuild(keysById)     build those paddocks in idle time
//   crops.growIn(ids, { dur, stagger })   these fields' crops sprout back up from small (a plan view)
//   crops.tick(dt)               every frame: moves the sprouting on
//   crops.dispose()              puts the original paddocks back and drops the others
import { makeFieldPaddock } from './paddocks.js';

const idle = typeof requestIdleCallback === 'function' ? (fn) => requestIdleCallback(fn, { timeout: 400 }) : (fn) => setTimeout(fn, 16);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const GROW_FROM = 0.15; // a sprouting crop starts at this share of its full size
const steps = (s) => Math.round(s * 60) / 60; // the same ~60 steps setSize uses

/**
 * @param {object} o
 * @param {{id: string, polygons: Array, holder: object, paddock: object, seed: number, gateToward: number[], cropKey: string}[]} o.fields
 * @param {(paddock: object) => void} [o.onBuilt]  a new paddock was built (to apply the season's look to it)
 */
export function createCropYears({ fields, onBuilt }) {
  const entries = new Map(fields.map((f) => [f.id, { f, shown: f.cropKey, cache: new Map([[f.cropKey, f.paddock]]) }]));
  let size = 1;
  let queue = [];
  let alive = true;
  // fields whose crop is sprouting back up: id -> { t, dur, shownAt } (t below 0 is still waiting
  // its turn in the stagger); setSize leaves these alone until they're done
  const growing = new Map();

  function paddockFor(e, key) {
    let p = e.cache.get(key);
    if (!p) {
      p = makeFieldPaddock(e.f.polygons, { cropKey: key, seed: e.f.seed, gateToward: e.f.gateToward });
      p.visible = false;
      p.userData.setSize?.(size);
      e.f.holder.add(p);
      e.cache.set(key, p);
      onBuilt?.(p);
    }
    return p;
  }

  /** Shows each field's crop for the year (keys: Map or object of id -> crop key). */
  function setYear(keys) {
    for (const [id, key] of entries2(keys)) {
      const e = entries.get(id);
      if (!e || !key || key === e.shown) continue;
      const next = paddockFor(e, key);
      e.cache.get(e.shown).visible = false;
      const g = growing.get(id);
      next.userData.setSize?.(g ? growSize(g) : size); // (a field mid-sprout keeps sprouting)
      if (g) g.shownAt = growSize(g);
      next.visible = true;
      e.shown = key;
    }
  }

  /** Every shown plant at one size (cheap to call every frame: unchanged sizes are skipped). */
  function setSize(s) {
    s = Math.round(Math.max(0, Math.min(1, s)) * 60) / 60; // ~60 steps is smooth and skips tiny changes
    if (s === size) return;
    size = s;
    for (const [id, e] of entries) if (!growing.has(id)) e.cache.get(e.shown).userData.setSize?.(s);
  }

  // a sprouting field's size now: from GROW_FROM of the full size up to it, easing out, never past it
  const growSize = (g) => Math.min(size, steps(size * (GROW_FROM + (1 - GROW_FROM) * easeOutCubic(Math.max(0, Math.min(1, g.t / g.dur))))));

  /**
   * These fields' crops sprout back up from small to full size, one after the other (`stagger`
   * seconds apart, in the order given) over `dur` seconds each. tick(dt) moves them on.
   */
  function growIn(ids, { dur = 0.45, stagger = 0.06 } = {}) {
    let k = 0;
    for (const id of ids || []) {
      const e = entries.get(id);
      if (!e) continue;
      const g = { t: -k * stagger, dur: Math.max(1e-3, dur), shownAt: -1 };
      k++;
      growing.set(id, g);
      apply(e, g);
    }
  }

  function apply(e, g) {
    const s = growSize(g);
    if (s === g.shownAt) return; // only when it changes (most frames move less than a step)
    g.shownAt = s;
    e.cache.get(e.shown).userData.setSize?.(s);
  }

  /** Moves every sprouting crop on by dt seconds (every frame; nothing to do when none is). */
  function tick(dt) {
    if (!growing.size) return;
    for (const [id, g] of growing) {
      const e = entries.get(id);
      g.t += dt;
      if (g.t >= g.dur) {
        growing.delete(id);
        e.cache.get(e.shown).userData.setSize?.(size); // done: back with the rest
      } else apply(e, g);
    }
  }

  /** Builds the paddocks for these years' crops ahead of time, one per idle slot. */
  function prebuild(keyMaps) {
    for (const keys of keyMaps) for (const [id, key] of entries2(keys)) {
      const e = entries.get(id);
      if (e && key && !e.cache.has(key) && !queue.some((q) => q.e === e && q.key === key)) queue.push({ e, key });
    }
    const step = () => {
      if (!alive || !queue.length) return;
      const { e, key } = queue.shift();
      if (!e.cache.has(key)) paddockFor(e, key);
      idle(step);
    };
    idle(step);
  }

  function dispose() {
    alive = false;
    queue = [];
    growing.clear();
    for (const e of entries.values()) {
      for (const [key, p] of e.cache) {
        if (p === e.f.paddock) { p.visible = true; p.userData.setSize?.(1); continue; }
        p.parent?.remove(p);
        p.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      }
      e.shown = e.f.cropKey;
    }
  }

  return { setYear, setSize, prebuild, growIn, tick, dispose, get size() { return size; }, get growing() { return growing.size; } };
}

function entries2(keys) {
  return keys instanceof Map ? keys.entries() : Object.entries(keys || {});
}
