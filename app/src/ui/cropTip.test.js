// The shared crop-name tooltip: its markup helpers, where it goes, how it behaves (hover, keyboard,
// touch, Esc first), and a static check that every crop icon in the screens goes through it.
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as T from './cropTip.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('cropBadge and the names', () => {
  it('names a crop, a key and a cover', () => {
    assert.equal(T.KEY_NAME.other, 'Other crop');
    assert.equal(T.cropName('soybeans', { cover: 'cereal-rye' }), 'Soybeans + cereal rye cover');
    assert.equal(T.cropName('winter-wheat'), 'Winter wheat');
    assert.equal(T.cropName(null, { key: 'hay' }), 'Hay');
    assert.equal(T.cropName(null, { key: 'nope' }), 'Other crop');
    assert.equal(T.cropName(null, { key: 'corn', name: 'Corn (silage)' }), 'Corn (silage)');
  });

  it('standalone: role=img with an aria-label and the tip data', () => {
    const solo = T.cropBadge('soybeans', { year: 2027, after: 'corn' });
    assert.match(solo, /^<span class="plan-crop plan-crop--md" role="img" aria-label="2027: Soybeans, after corn" data-crop-tip="Soybeans" data-crop-sub="2027 · after corn"><svg/);
    assert.doesNotMatch(solo, /tabindex/);
    assert.match(T.cropBadge('corn', { focusable: true }), /tabindex="0"/);
  });

  it('inControl: aria-hidden, no role, no label, no tabindex', () => {
    const inCtl = T.cropBadge('corn', { inControl: true, focusable: true });
    assert.match(inCtl, /aria-hidden="true"/);
    assert.doesNotMatch(inCtl, /role=|aria-label=|tabindex/);
    assert.match(inCtl, /data-crop-tip="Corn"/);
  });

  it('adds the cover and its dot, escapes names, takes a sub line and a bare class', () => {
    const c = T.cropBadge('soybeans', { cover: 'cereal-rye', year: 2029 });
    assert.match(c, /data-crop-tip="Soybeans \+ cereal rye cover"/);
    assert.match(c, /<span class="plan-crop__cover" aria-hidden="true"><\/span><\/span>$/);
    const e = T.cropBadge(null, { key: 'other', name: 'Kale & "rape"' });
    assert.match(e, /data-crop-tip="Kale &amp; &quot;rape&quot;"/);
    assert.match(e, /aria-label="Kale &amp; &quot;rape&quot;"/);
    assert.doesNotMatch(e, /data-crop-sub/);
    const p = T.cropBadge('corn', { inControl: true, sub: 'Best sown Apr 15 – May 9', cls: 'crop-ico', size: 'sm' });
    assert.match(p, /class="crop-ico crop-ico--sm"/);
    assert.match(p, /data-crop-sub="Best sown Apr 15 – May 9"/);
  });

  it('lists several crops for a control, escaped', () => {
    assert.equal(T.tipListAttr([{ year: 2027, cropId: 'soybeans' }, { year: 2028, cropId: 'corn' }]), ' data-crop-tip-list="2027 Soybeans;2028 Corn"');
    assert.equal(T.tipListAttr([{ year: 2029, cropId: 'soybeans', cover: 'cereal-rye' }]), ' data-crop-tip-list="2029 Soybeans + cereal rye cover"');
  });

  it('reads at most 3 lines', () => {
    assert.equal(T.tipLines({ dataset: { cropTipList: 'a;b;c;d' } }).length, 3);
    assert.deepEqual(T.tipLines({ dataset: { cropTip: 'Corn', cropSub: '2027' } }), [{ name: 'Corn', sub: '2027' }]);
    assert.deepEqual(T.tipLines({ dataset: { cropTip: 'Corn' } }), [{ name: 'Corn', sub: '' }]);
    assert.deepEqual(T.tipLines({ dataset: {} }), []);
    assert.deepEqual(T.tipLines(null), []);
  });
});

describe('tipPlace', () => {
  const viewport = { width: 1000, height: 800 };
  const tip = { width: 100, height: 40 };
  const at = (left, top, w = 30, h = 30) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });

  it('centres above the icon, in whole pixels', () => {
    assert.deepEqual(T.tipPlace({ anchor: at(400.4, 300.2), tip, viewport }), { x: 365, y: 252, below: false });
  });

  it('flips below within 8 px of the top', () => {
    assert.deepEqual(T.tipPlace({ anchor: at(400, 50), tip, viewport }), { x: 365, y: 88, below: true });
    // exactly room for it: stays above
    assert.equal(T.tipPlace({ anchor: at(400, 56), tip, viewport }).below, false);
    assert.equal(T.tipPlace({ anchor: at(400, 55), tip, viewport }).below, true);
  });

  it('clamps to the viewport', () => {
    assert.equal(T.tipPlace({ anchor: at(0, 300), tip, viewport }).x, 8);
    assert.equal(T.tipPlace({ anchor: at(990, 300, 10), tip, viewport }).x, 892);
    // near the bottom it never runs off
    const p = T.tipPlace({ anchor: at(400, 790, 30, 30), tip, viewport });
    assert.ok(p.y + tip.height <= viewport.height - 8);
  });

  it('clamps to the bounds (the panel), and flips at the bounds’ top', () => {
    const bounds = { left: 300, top: 100, right: 700, bottom: 700 };
    assert.equal(T.tipPlace({ anchor: at(290, 400), tip, viewport, bounds }).x, 308);
    assert.equal(T.tipPlace({ anchor: at(690, 400), tip, viewport, bounds }).x, 592);
    const p = T.tipPlace({ anchor: at(500, 130), tip, viewport, bounds });
    assert.equal(p.below, true);
    assert.equal(p.y, 168);
  });
});

// ---------------------------------------------------------------- a small fake DOM for the behaviour
function fakeDom() {
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const listeners = { doc: [], win: [] };

  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parent = null;
      this.dataset = {};
      this.attrs = {};
      this.hidden = false;
      this.style = {};
      this.textContent = '';
      this.rect = { left: 100, top: 300, right: 130, bottom: 330, width: 30, height: 30 };
      this.focusVisible = true;
      const cls = new Set();
      this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) };
      this.offsetWidth = 120;
      this.offsetHeight = 36;
    }
    set className(v) { v.split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c)); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    replaceChildren(...cs) { this.children.forEach((c) => { c.parent = null; }); this.children = []; cs.forEach((c) => this.appendChild(c)); }
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
    contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
    get isConnected() { let x = this; while (x.parent) x = x.parent; return x === doc.documentElement; }
    has(sel) {
      const m = /^\[data-([a-z-]+)\]$/.exec(sel);
      if (!m) return false;
      const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return key in this.dataset;
    }
    closest(sel) { const sels = sel.split(','); for (let x = this; x; x = x.parent) if (sels.some((s) => x.has(s.trim()))) return x; return null; }
    matches(sel) { if (sel === ':focus-visible') return this.focusVisible; return this.has(sel); }
    getBoundingClientRect() { return this.rect; }
    get text() { return this.children.map((c) => c.children.map((g) => g.textContent).join('|')).join(' / '); }
  }
  const add = (list) => (type, fn, opt) => list.push({ type, fn, capture: opt === true || !!opt?.capture });
  const remove = (list) => (type, fn) => { const i = list.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) list.splice(i, 1); };
  const html = new El('html');
  const body = new El('body');
  html.appendChild(body);
  const doc = {
    documentElement: html, body, visibilityState: 'visible',
    createElement: (t) => new El(t),
    addEventListener: add(listeners.doc), removeEventListener: remove(listeners.doc),
  };
  const win = {
    innerWidth: 1000, innerHeight: 800,
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    addEventListener: add(listeners.win), removeEventListener: remove(listeners.win),
  };
  const tick = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  // an event as the browser runs it: window capture, document capture, then document bubble
  const fire = (type, props = {}) => {
    let stopped = false;
    const e = { type, defaultPrevented: false, immediate: false, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; this.immediate = true; }, preventDefault() { this.defaultPrevented = true; }, ...props };
    const phases = [
      ...listeners.win.filter((l) => l.type === type && l.capture),
      ...listeners.doc.filter((l) => l.type === type && l.capture),
      ...listeners.doc.filter((l) => l.type === type && !l.capture),
      ...listeners.win.filter((l) => l.type === type && !l.capture),
    ];
    for (const l of phases) { if (stopped) break; l.fn(e); }
    return { e, stopped };
  };
  const badge = (name, sub, parent = body) => { const b = new El('span'); b.dataset.cropTip = name; if (sub) b.dataset.cropSub = sub; parent.appendChild(b); return b; };
  return { doc, win, body, El, tick, fire, badge, listeners };
}

describe('the live tip', () => {
  const tipEl = (dom) => dom.body.children.find((c) => c.attrs['aria-hidden'] === 'true' && c.classList.contains('crop-tip'));

  it('works without a document (node), and once only', () => {
    const h = T.installCropTips({ doc: null, win: null });
    assert.equal(T.installCropTips({ doc: null, win: null }), h);
    assert.equal(typeof h.hide, 'function');
    h.dispose();
    T.hideCropTip();
  });

  it('hover: shows after 80 ms, swaps at once, stays on the tip, hides 150 ms after leaving', () => {
    const dom = fakeDom();
    const h = T.installCropTips(dom);
    const tip = tipEl(dom);
    assert.ok(tip, 'one tip on body');
    assert.equal(tip.hidden, true);
    const corn = dom.badge('Corn', '2027 · after soybeans');
    const soy = dom.badge('Soybeans');
    dom.fire('pointerover', { target: corn, pointerType: 'mouse' });
    dom.tick(79);
    assert.equal(tip.hidden, true);
    dom.tick(1);
    assert.equal(tip.hidden, false);
    assert.equal(tip.text, 'Corn|2027 · after soybeans');
    assert.match(tip.style.transform, /^translate\(\d+px, \d+px\)$/);
    // to another icon: the text swaps with no wait
    dom.fire('pointerout', { target: corn, relatedTarget: soy, pointerType: 'mouse' });
    dom.fire('pointerover', { target: soy, pointerType: 'mouse' });
    assert.equal(tip.text, 'Soybeans');
    // onto the tip itself: it stays
    dom.fire('pointerout', { target: soy, relatedTarget: tip, pointerType: 'mouse' });
    dom.fire('pointerover', { target: tip, pointerType: 'mouse' });
    dom.tick(500);
    assert.equal(tip.hidden, false);
    // off the tip to nothing: gone after 150 ms
    dom.fire('pointerout', { target: tip, relatedTarget: dom.body, pointerType: 'mouse' });
    dom.tick(149);
    assert.equal(tip.hidden, false);
    dom.tick(1);
    assert.equal(tip.hidden, true);
    h.dispose();
    assert.equal(tipEl(dom), undefined, 'dispose removes it');
    assert.equal(dom.listeners.doc.length + dom.listeners.win.length, 0, 'and every listener');
  });

  it('a quick pass over an icon shows nothing', () => {
    const dom = fakeDom();
    const h = T.installCropTips(dom);
    const corn = dom.badge('Corn');
    dom.fire('pointerover', { target: corn, pointerType: 'mouse' });
    dom.fire('pointerout', { target: corn, relatedTarget: dom.body, pointerType: 'mouse' });
    dom.tick(500);
    assert.equal(tipEl(dom).hidden, true);
    h.dispose();
  });

  it('keyboard: a list on a control (up to 3 lines), one line on a badge, hidden on focusout; not on a mouse focus', () => {
    const dom = fakeDom();
    const h = T.installCropTips(dom);
    const tip = tipEl(dom);
    const row = new dom.El('button');
    row.dataset.cropTipList = '2027 Soybeans;2028 Corn;2029 Soybeans + cereal rye cover;2030 Corn';
    dom.body.appendChild(row);
    dom.fire('focusin', { target: row });
    assert.equal(tip.hidden, false);
    assert.equal(tip.children.length, 3);
    assert.equal(tip.text, '2027 Soybeans / 2028 Corn / 2029 Soybeans + cereal rye cover');
    dom.fire('focusout', { target: row });
    assert.equal(tip.hidden, true);
    const li = dom.badge('Corn', '2024');
    dom.fire('focusin', { target: li });
    assert.equal(tip.text, 'Corn|2024');
    dom.fire('focusout', { target: li });
    li.focusVisible = false; // focused by a click
    dom.fire('focusin', { target: li });
    assert.equal(tip.hidden, true);
    h.dispose();
  });

  it('keyboard: the scroll that brings a focused control into view keeps its tip; scrolled away, it goes', () => {
    const dom = fakeDom();
    const h = T.installCropTips(dom);
    const tip = tipEl(dom);
    const row = new dom.El('button');
    row.dataset.cropTipList = '2027 Soybeans;2028 Corn';
    dom.body.appendChild(row);
    dom.doc.activeElement = row;
    dom.fire('focusin', { target: row });
    const before = tip.style.transform;
    row.rect = { left: 100, top: 200, right: 130, bottom: 230, width: 30, height: 30 };
    dom.fire('scroll', { target: dom.body });
    assert.equal(tip.hidden, false, 'still showing');
    assert.notEqual(tip.style.transform, before, 'and moved with its control');
    row.rect = { left: 100, top: -80, right: 130, bottom: -50, width: 30, height: 30 };
    dom.fire('scroll', { target: dom.body });
    assert.equal(tip.hidden, true, 'gone once its control scrolls out of view');
    h.dispose();
  });

  it('Esc closes only the tip first; the next Esc reaches the panel', () => {
    const dom = fakeDom();
    const h = T.installCropTips(dom);
    let panelEsc = 0;
    dom.doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') panelEsc++; }, true); // the plans panel's document-capture Esc
    const corn = dom.badge('Corn');
    dom.fire('focusin', { target: corn });
    const first = dom.fire('keydown', { key: 'Escape' });
    assert.equal(first.stopped, true);
    assert.equal(first.e.defaultPrevented, true);
    assert.equal(first.e.immediate, true, 'other window-capture Esc handlers skip it too');
    assert.equal(panelEsc, 0);
    assert.equal(tipEl(dom).hidden, true);
    const second = dom.fire('keydown', { key: 'Escape' });
    assert.equal(second.stopped, false);
    assert.equal(panelEsc, 1);
    // other keys pass while it shows
    dom.fire('focusin', { target: corn });
    assert.equal(dom.fire('keydown', { key: 'Enter' }).stopped, false);
    assert.equal(tipEl(dom).hidden, false);
    h.dispose();
  });

  it('touch: a tap shows it at once without preventDefault, then 2.5 s, a tap elsewhere or a scroll hides it', () => {
    const dom = fakeDom();
    const h = T.installCropTips(dom);
    const tip = tipEl(dom);
    const corn = dom.badge('Corn');
    const tap = dom.fire('pointerdown', { target: corn, pointerType: 'touch' });
    assert.equal(tap.e.defaultPrevented, false);
    assert.equal(tip.hidden, false);
    dom.tick(2499);
    assert.equal(tip.hidden, false);
    dom.tick(1);
    assert.equal(tip.hidden, true);
    dom.fire('pointerdown', { target: corn, pointerType: 'touch' });
    dom.fire('pointerdown', { target: dom.body, pointerType: 'touch' });
    assert.equal(tip.hidden, true);
    dom.fire('pointerdown', { target: corn, pointerType: 'touch' });
    dom.fire('scroll', { target: dom.body });
    assert.equal(tip.hidden, true);
    // the touch's own pointerover does not start a hover timer
    dom.fire('pointerover', { target: corn, pointerType: 'touch' });
    dom.tick(200);
    assert.equal(tip.hidden, true);
    h.dispose();
  });

  it('hides on resize, a hidden tab and hideCropTip(); never while the jar test is open', () => {
    const dom = fakeDom();
    const h = T.installCropTips(dom);
    const tip = tipEl(dom);
    const corn = dom.badge('Corn');
    const showIt = () => { dom.fire('focusin', { target: corn }); assert.equal(tip.hidden, false); };
    showIt(); dom.fire('resize', {}); assert.equal(tip.hidden, true);
    showIt(); dom.doc.visibilityState = 'hidden'; dom.fire('visibilitychange', {}); assert.equal(tip.hidden, true);
    dom.doc.visibilityState = 'visible';
    showIt(); T.hideCropTip(); assert.equal(tip.hidden, true);
    dom.body.classList.add('jar-open');
    dom.fire('focusin', { target: corn });
    assert.equal(tip.hidden, true);
    // one left up as the jar test opens never eats the jar's Esc
    dom.body.classList.remove('jar-open');
    showIt();
    dom.body.classList.add('jar-open');
    assert.equal(dom.fire('keydown', { key: 'Escape' }).stopped, false);
    h.dispose();
  });

  it('keeps inside the closest [data-tip-bounds]', () => {
    const dom = fakeDom();
    const h = T.installCropTips(dom);
    const tip = tipEl(dom);
    const panel = new dom.El('section');
    panel.dataset.tipBounds = '';
    panel.rect = { left: 300, top: 100, right: 700, bottom: 700, width: 400, height: 600 };
    dom.body.appendChild(panel);
    const corn = dom.badge('Corn', '', panel);
    corn.rect = { left: 290, top: 400, right: 320, bottom: 430, width: 30, height: 30 };
    dom.fire('focusin', { target: corn });
    assert.equal(tip.style.transform, 'translate(308px, 356px)');
    h.dispose();
  });
});

// ---------------------------------------------------------------- every crop icon goes through cropBadge
describe('static coverage', () => {
  const dirs = [join(HERE, '..', 'screens'), HERE];
  const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).map((f) => ({ f, src: readFileSync(join(d, f), 'utf8') })));

  it('no raw cropIcon( outside cropIcons.js and cropTip.js', () => {
    for (const { f, src } of files) {
      if (f === 'cropIcons.js' || f === 'cropTip.js') continue;
      assert.ok(!/\bcropIcon\(/.test(src), `${f} calls cropIcon( directly: use cropBadge`);
    }
  });

  it('the check-up history keeps data-year beside the tip data (markYear rings the island’s year by it)', () => {
    const src = files.find((x) => x.f === 'fieldPanel.js').src;
    assert.match(src, /li\.dataset\.year/);
    assert.equal((src.match(/<li class="hist[^"]*" tabindex="0" data-year="\$\{h\.year\}" data-crop-tip=/g) || []).length, 2);
  });

  it('no native title next to crop markup', () => {
    const near = /plan-crop|cropBadge|data-crop|hub-field__crop|hist\b/;
    for (const { f, src } of files) {
      for (const m of src.matchAll(/title=|\.title\s*=/g)) {
        const around = src.slice(Math.max(0, m.index - 120), m.index + 120);
        assert.ok(!near.test(around), `${f}: a title next to crop markup: ${around.replace(/\s+/g, ' ')}`);
      }
    }
  });
});

test('every crop helper output carries data-crop-tip', async () => {
  globalThis.document ??= { getElementById: () => null };
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const { cropIconFor } = await import('./futureIcons.js');
  assert.match(cropIconFor('corn'), /data-crop-tip="Corn"/);
  assert.match(cropIconFor('soybeans', 'cereal-rye'), /data-crop-tip="Soybeans \+ cereal rye cover"/);
  const { chipHtml } = await import('../screens/planFutures.js');
  const s = { crop: 'corn', cover: null, gmAc: 500, warnings: [] };
  assert.match(chipHtml({ s, total: 50000, diff: 0 }), /data-crop-tip=/);
  assert.match(chipHtml({ s, total: 50000, diff: 0, mode: 'rotation', link: { kind: 'nitrogen', prev: 'soybeans' } }), /data-crop-tip=/);
  const { paletteHtml } = await import('../screens/planBuilder.js');
  assert.match(paletteHtml(['corn', 'soybeans'], { state: 'IA' }), /data-crop-tip="Corn"/);
  // Track D's and B's helpers, on the demo farm's real plans: each must render, with the tip data
  const { demoData, START_YEAR } = await import('../../test/futuresDemo.mjs');
  const { compareFutures } = await import('../plan/compareFutures.js');
  const { rotationOf } = await import('../plan/rotationStory.js');
  const cmp = compareFutures(demoData(['profit']), { startYear: START_YEAR });
  const rot = rotationOf(cmp, 'priority', {});
  const place = { state: 'IA', fips: '19169' };
  const { ribbonHtml, storyHtml } = await import('../screens/rotationRibbon.js');
  const { calendarTabHtml } = await import('../screens/cropCalendarView.js');
  for (const [name, out] of [
    ['ribbonHtml', ribbonHtml(rot, { selectedKind: 'priority' })],
    ['storyHtml', storyHtml(rot, cmp, 'f1', { choice: {}, place, years: cmp.years })],
    ['calendarTabHtml', calendarTabHtml({ rot, cmp, place })],
  ]) {
    assert.ok(out, `${name} renders`);
    assert.match(out, /data-crop-tip/, name);
    assert.doesNotMatch(out, /\stitle="/, `${name}: no native title`);
  }
});
