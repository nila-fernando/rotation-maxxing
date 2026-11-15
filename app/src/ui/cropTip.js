// One shared crop-name tooltip for every crop icon: hover, keyboard focus, touch and Esc. Badges
// carry data-crop-tip (one line, with an optional quieter data-crop-sub) or a control carries
// data-crop-tip-list (up to 3 lines); installCropTips() wires one body-level #cropTip for the whole
// app. No native title attributes on crop icons (they made double tooltips).
//
//   - Mouse and pen: shown 80 ms after pointerover on [data-crop-tip], hidden 150 ms after
//     pointerout. The tip itself is hoverable (pointer-events:auto), so moving onto it keeps it open
//     (WCAG 1.4.13). Moving to a second icon swaps the text at once.
//   - Keyboard: on focusin (keyboard focus only) an element's own data-crop-tip-list (up to 3
//     lines) or data-crop-tip (one line); hidden on focusout.
//   - Esc: a window capture-phase keydown hides a visible tip and stops the event (immediately, so
//     other window-capture handlers skip it too), so the first Esc closes only the tip and the next
//     one reaches the panel.
//   - Touch: a tap on a badge shows it at once (no preventDefault, so the tap still selects); it
//     hides after 2.5 s, on the next pointerdown elsewhere, or on scroll.
//   - Also hidden on scroll (a keyboard tip follows its control while it stays in view), resize,
//     visibilitychange and hideCropTip() (a drag, the island turning, the reel moving). Never shown
//     while the jar test is open (body.jar-open).
//   - Placement: tipPlace() centres it above the icon, flips it below near the top, and clamps it
//     inside the viewport and the icon's closest [data-tip-bounds] (the panel).
//
// The tip is aria-hidden: screen readers get the crop from the badge's aria-label, or from the
// control's own label, so nothing is read twice.
import { cropIcon } from './cropIcons.js';
import { APP_CROP } from '../plan/farmInput.js';
import { CROP_NAME } from '../plan/planNames.js';

export const KEY_NAME = {
  corn: 'Corn', soybeans: 'Soybeans', wheat: 'Wheat', barley: 'Barley', oats: 'Oats', sorghum: 'Sorghum',
  alfalfa: 'Alfalfa', hay: 'Hay', pasture: 'Pasture', fallow: 'Fallow', other: 'Other crop',
};

const SHOW_MS = 80;
const HIDE_MS = 150;
const TOUCH_MS = 2500;
const MAX_LINES = 3;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const coverName = (cover) => (typeof cover === 'string' ? (CROP_NAME[cover] || cover).toLowerCase() : 'winter');

/** A crop's name as the tip says it: 'Soybeans + cereal rye cover'. */
export function cropName(cropId, { key, cover, name } = {}) {
  const base = name || (cropId && CROP_NAME[cropId]) || KEY_NAME[key || APP_CROP[cropId]] || KEY_NAME.other;
  return cover ? `${base} + ${coverName(cover)} cover` : base;
}

/**
 * A crop icon with its tooltip data. Standalone it is role="img" with an aria-label; inControl it is
 * aria-hidden (the button or radio around it names the crops). `cls` is the wrapper's class list:
 * 'plan-crop' (the boxed tile) by default, 'crop-ico' for a bare icon inside a styled control. The
 * size modifier goes on the first class; the cover dot is always .plan-crop__cover.
 */
export function cropBadge(cropId, { key, name, year, after, cover, sub, size = 'md', inControl = false, focusable = false, cls = 'plan-crop' } = {}) {
  const label = cropName(cropId, { key, cover, name });
  const afterName = after ? cropName(after).toLowerCase() : '';
  const subLine = sub ?? [year, afterName ? `after ${afterName}` : ''].filter(Boolean).join(' · ');
  const aria = `${year ? `${year}: ` : ''}${label}${afterName ? `, after ${afterName}` : ''}`;
  const icon = cropIcon(key || APP_CROP[cropId] || 'other');
  const dot = cover ? '<span class="plan-crop__cover" aria-hidden="true"></span>' : '';
  const a11y = inControl ? ' aria-hidden="true"' : ` role="img" aria-label="${esc(aria)}"`;
  const tab = focusable && !inControl ? ' tabindex="0"' : '';
  const subAttr = subLine ? ` data-crop-sub="${esc(subLine)}"` : '';
  const first = String(cls).trim().split(/\s+/)[0] || 'plan-crop';
  return `<span class="${esc(cls)} ${esc(first)}--${esc(size)}"${a11y}${tab} data-crop-tip="${esc(label)}"${subAttr}>${icon}${dot}</span>`;
}

/** The attribute for a control naming several crops: ' data-crop-tip-list="2027 Soybeans;2028 Corn"'. */
export function tipListAttr(items = []) {
  const list = items.map(({ year, cropId, cover }) => `${year ?? ''} ${cropName(cropId, { cover })}`.trim()).join(';');
  return ` data-crop-tip-list="${esc(list)}"`;
}

/** The tip's lines for an element, from its dataset (at most 3). */
export function tipLines(el) {
  const d = el?.dataset ?? {};
  if (d.cropTipList) return d.cropTipList.split(';').map((s) => s.trim()).filter(Boolean).slice(0, MAX_LINES).map((name) => ({ name, sub: '' }));
  if (d.cropTip) return [{ name: d.cropTip, sub: d.cropSub ?? '' }];
  return [];
}

/**
 * Where the tip goes, in whole pixels: centred above the anchor; below it when above would come
 * within `gap` of the top (of the viewport, or of the bounds); then clamped `gap` inside the
 * viewport and the bounds. anchor and bounds are rects ({left, top, right, bottom, width?, height?}),
 * tip is {width, height}, viewport is {width, height}.
 */
export function tipPlace({ anchor, tip, viewport, bounds = null, gap = 8 } = {}) {
  const a = rectOf(anchor);
  const tw = Math.max(0, tip?.width ?? 0), th = Math.max(0, tip?.height ?? 0);
  const vw = viewport?.width ?? Infinity, vh = viewport?.height ?? Infinity;
  const b = bounds ? rectOf(bounds) : null;
  const left = Math.max(0, b ? b.left : 0) + gap;
  const right = Math.min(vw, b ? b.right : Infinity) - gap;
  const top = Math.max(0, b ? b.top : 0) + gap;
  const bottom = Math.min(vh, b ? b.bottom : Infinity) - gap;

  let x = a.left + a.width / 2 - tw / 2;
  x = Math.min(x, right - tw);
  x = Math.max(x, left); // a tip wider than the room keeps its left edge in view
  let y = a.top - gap - th;
  let below = false;
  if (y < top) {
    y = a.bottom + gap;
    below = true;
    if (y + th > bottom && a.top - gap - th >= gap) { y = a.top - gap - th; below = false; } // no room below either: stay above, inside the viewport
  }
  y = Math.max(gap, Math.min(y, vh - gap - th));
  return { x: Math.round(x), y: Math.round(y), below };
}

function rectOf(r = {}) {
  const left = r.left ?? r.x ?? 0, top = r.top ?? r.y ?? 0;
  const width = r.width ?? ((r.right ?? left) - left), height = r.height ?? ((r.bottom ?? top) - top);
  return { left, top, width, height, right: r.right ?? left + width, bottom: r.bottom ?? top + height };
}

// ---------------------------------------------------------------- the live tip (one per app)
let installed = null;
let live = null; // { hide } while installed with a real document

const ANCHOR = '[data-crop-tip]';

/** Wires the shared tip once; later calls return the same handle. */
export function installCropTips({ doc = globalThis.document, win = globalThis.window } = {}) {
  if (installed) return installed;
  if (!doc?.body || !win?.addEventListener) {
    installed = { hide() {}, dispose() { installed = null; } };
    return installed;
  }

  const el = doc.createElement('div');
  el.id = 'cropTip';
  el.className = 'crop-tip';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  doc.body.appendChild(el);

  let anchor = null; // the element the tip is for (shown, or about to be)
  let source = null; // 'pointer' | 'focus' | 'touch'
  let showTimer = 0, hideTimer = 0, touchTimer = 0;
  const clear = (t) => { if (t) win.clearTimeout(t); return 0; };
  const clearAll = () => { showTimer = clear(showTimer); hideTimer = clear(hideTimer); touchTimer = clear(touchTimer); };
  const blocked = () => doc.body.classList.contains('jar-open');
  // (a tip left up when the jar test opened is hidden by CSS: it must not eat the jar's Esc)
  const visible = () => !el.hidden && !blocked();

  function render(lines) {
    const rows = lines.map(({ name, sub }) => {
      const row = doc.createElement('span');
      row.className = 'crop-tip__row';
      const b = doc.createElement('b');
      b.textContent = name;
      row.appendChild(b);
      if (sub) {
        const s = doc.createElement('span');
        s.textContent = sub;
        row.appendChild(s);
      }
      return row;
    });
    el.replaceChildren(...rows);
    el.classList.toggle('crop-tip--list', lines.length > 1);
  }

  function place() {
    if (!anchor) return;
    const icon = anchor.getBoundingClientRect();
    const boundsEl = anchor.closest?.('[data-tip-bounds]');
    const bounds = boundsEl ? boundsEl.getBoundingClientRect() : null;
    const p = tipPlace({
      anchor: icon,
      tip: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: win.innerWidth || doc.documentElement.clientWidth, height: win.innerHeight || doc.documentElement.clientHeight },
      bounds,
    });
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.classList.toggle('is-below', p.below);
  }

  function show(target, how, lines = tipLines(target)) {
    if (!target?.isConnected || !lines.length || blocked()) { hide(); return; }
    clearAll(); // (a touch's 2.5 s goes too: a touch show sets its own again)
    anchor = target;
    source = how;
    render(lines);
    el.hidden = false;
    place();
  }

  function hide() {
    clearAll();
    anchor = null;
    source = null;
    if (!el.hidden) {
      el.hidden = true;
      el.replaceChildren();
    }
  }

  const inside = (node, root) => !!(node && root && (node === root || root.contains?.(node)));

  // ---- mouse and pen
  const onOver = (e) => {
    if (e.pointerType === 'touch') return;
    if (e.buttons && !visible()) return; // a button held: a drag or a turn of the island, not a hover
    if (inside(e.target, el)) { hideTimer = clear(hideTimer); return; } // onto the tip: keep it
    const t = e.target.closest?.(ANCHOR);
    if (!t) return;
    if (t === anchor) { hideTimer = clear(hideTimer); return; }
    if (visible()) { show(t, 'pointer'); return; } // a second icon: swap at once
    hideTimer = clear(hideTimer);
    showTimer = clear(showTimer);
    anchor = t;
    source = 'pointer';
    showTimer = win.setTimeout(() => { showTimer = 0; if (anchor === t) show(t, 'pointer'); }, SHOW_MS);
  };
  const onOut = (e) => {
    if (e.pointerType === 'touch' || !anchor || source !== 'pointer') return;
    const from = e.target;
    if (!inside(from, anchor) && !inside(from, el)) return;
    const to = e.relatedTarget;
    if (inside(to, anchor) || inside(to, el)) return;
    if (!visible()) { showTimer = clear(showTimer); anchor = null; source = null; return; }
    hideTimer = clear(hideTimer);
    hideTimer = win.setTimeout(() => { hideTimer = 0; hide(); }, HIDE_MS);
  };

  // ---- keyboard focus (not a mouse click's focus: the hover already named it)
  const keyboardFocus = (t) => {
    try { return t.matches(':focus-visible'); } catch { return true; }
  };
  const onFocusIn = (e) => {
    const t = e.target;
    if (!t?.dataset || (!t.dataset.cropTip && !t.dataset.cropTipList)) return;
    if (!keyboardFocus(t)) return;
    show(t, 'focus');
  };
  const onFocusOut = (e) => {
    if (source === 'focus' && e.target === anchor) hide();
  };

  // ---- touch, and any press elsewhere
  const onDown = (e) => {
    const t = e.target.closest?.(ANCHOR);
    if (e.pointerType === 'touch' && t) {
      show(t, 'touch');
      touchTimer = clear(touchTimer);
      if (visible()) touchTimer = win.setTimeout(() => { touchTimer = 0; hide(); }, TOUCH_MS);
      return;
    }
    if ((visible() || anchor) && !inside(e.target, anchor) && !inside(e.target, el)) hide();
  };

  // ---- Esc first, before any panel's own Esc
  const onKey = (e) => {
    if (e.key !== 'Escape' || !visible()) return;
    hide();
    // (immediate too: other window-capture Esc handlers, such as the farm view's, sit on this same
    // target, where stopPropagation alone would let them run)
    e.stopImmediatePropagation?.();
    e.stopPropagation();
    e.preventDefault();
  };

  const onAway = () => { if (visible() || anchor) hide(); };
  // A scroll hides a hover or touch tip. A keyboard tip follows its control instead: Tab to a control
  // out of view scrolls it in (that scroll lands just after the focusin), and hiding then would mean
  // the tip never showed. It goes once the control scrolls out of the viewport or its panel.
  const onScroll = () => {
    if (source === 'focus' && visible() && anchor?.isConnected && doc.activeElement === anchor) {
      const r = anchor.getBoundingClientRect();
      const boundsEl = anchor.closest?.('[data-tip-bounds]');
      const b = boundsEl ? boundsEl.getBoundingClientRect() : null;
      const vw = win.innerWidth || doc.documentElement.clientWidth, vh = win.innerHeight || doc.documentElement.clientHeight;
      const inView = r.bottom > Math.max(0, b ? b.top : 0) && r.top < Math.min(vh, b ? b.bottom : vh)
        && r.right > Math.max(0, b ? b.left : 0) && r.left < Math.min(vw, b ? b.right : vw);
      if (inView) { place(); return; }
    }
    onAway();
  };
  const onVisibility = () => { if (doc.visibilityState === 'hidden') onAway(); };

  doc.addEventListener('pointerover', onOver);
  doc.addEventListener('pointerout', onOut);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  doc.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('scroll', onScroll, { capture: true, passive: true });
  win.addEventListener('resize', onAway);
  doc.addEventListener('visibilitychange', onVisibility);

  live = { hide };
  installed = {
    hide,
    dispose() {
      hide();
      doc.removeEventListener('pointerover', onOver);
      doc.removeEventListener('pointerout', onOut);
      doc.removeEventListener('focusin', onFocusIn);
      doc.removeEventListener('focusout', onFocusOut);
      doc.removeEventListener('pointerdown', onDown, { capture: true });
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('scroll', onScroll, { capture: true });
      win.removeEventListener('resize', onAway);
      doc.removeEventListener('visibilitychange', onVisibility);
      el.remove();
      live = null;
      installed = null;
    },
  };
  return installed;
}

/** Hides the tip if it is showing (a drag starting, the island turning, the reel moving). */
export function hideCropTip() {
  live?.hide();
}
