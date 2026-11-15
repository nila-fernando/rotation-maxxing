// Planning on the island: drag crops straight onto the 3D fields (roadmap 4.2).
//
//   dock      along the bottom: the season (2027, 2028, 2029), the crops, what the plan earns,
//             "Back to the grid" and "Use my plan"
//   island    shows the plan's crops for the chosen season; drag a crop over a field and it lights
//             up with what Manami thinks of it there; drop it and the field changes; badges float
//             over the fields worth a second look, and over the ones still to plant
//   Manami    says what she thinks of each drop
//
// Tap works too: pick a crop, then tap fields. It edits the same plan as the "Build your own" grid
// (src/screens/planBuilder.js), so the checks, totals and saving are one and the same; the grid is
// also the keyboard way in ("Back to the grid").
//
//   const planner = createIslandPlanner({ hub, timeTravel, manami, money, onStart, onStop, onBack, onSave })
//   planner.start(builder, { startYear, view })   planner.stop()
import * as THREE from 'three';
import { APP_CROP } from '../plan/farmInput.js';
import { hideCropTip } from '../ui/cropTip.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEV = { 1: 'Note', 2: 'Careful', 3: 'Avoid' };
const HOLD_MS = 280;
const TOUCH_SLOP_PX = 10;
const DRAG_START_PX = 5;
const ERASER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5l8.5-8.5 6 6-5 5H8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12.5 8l-4 4M8 19.5h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
// little screens: Manami tucks away to her face after each line, so the island keeps the room
const COMPACT_QUERY = '(max-height: 520px), (max-width: 1000px)';

export function createIslandPlanner({ hub, timeTravel, manami, money = (n) => `$${Math.round(n)}`, onStart, onStop, onBack, onSave }) {
  const $ = (id) => document.getElementById(id);
  const dock = $('isleDock');
  const seasonsEl = $('isleSeasons');
  const paletteEl = $('islePalette');
  const totalsEl = $('isleTotals');
  const saveBtn = $('isleSave');
  const badgesEl = $('isleBadges');
  const compact = matchMedia(COMPACT_QUERY);
  let b = null; // the builder (the plan)
  let view = null;
  let startYear = 0;
  let season = 0;
  let brush; // undefined: none picked; null: clear; a crop id
  let drag = null;
  let offs = [];
  let badges = [];
  let shownKey = ''; // the crops and season the island shows (preview only when they change)
  let shownTotals = ''; // the totals' last HTML (the live region is only rewritten when it changes)
  let dockH = 0;
  const v3 = new THREE.Vector3();

  // Manami sits above the dock, however tall it wraps, and the island is framed above it
  new ResizeObserver(() => {
    if (dock.hidden || dock.offsetHeight === dockH) return;
    dockH = dock.offsetHeight;
    document.body.style.setProperty('--isle-dock-h', `${dockH}px`);
    if (b) hub.session?.relayout();
  }).observe(dock);

  $('isleBack').addEventListener('click', () => { stop(); onBack?.(); });
  saveBtn.addEventListener('click', () => { if (!b?.isComplete()) return; const plan = b.plan; stop(); onSave?.(plan); });

  const fieldName = (id) => b.fields.find((p) => p.id === id)?.name || 'Field';
  const year = () => startYear + season;
  const say = (text) => { manami.say(text); if (compact.matches) manami.collapse(); };

  /** Starts planning on the island with the builder's plan. */
  function start(builder, { startYear: y0, view: v }) {
    stop();
    b = builder;
    view = v;
    startYear = y0;
    season = 0;
    brush = undefined;
    shownKey = '';
    shownTotals = '';
    // the dock first, so the island is framed in the room above it
    document.body.classList.add('isle-planning');
    dock.hidden = false;
    dockH = dock.offsetHeight;
    document.body.style.setProperty('--isle-dock-h', `${dockH}px`);
    onStart?.();
    hub.setPlanMode({ tipFor, onTap, get dragging() { return !!drag?.active; } });
    hub.session?.relayout();
    hub.overview(); // the whole farm, any check-up closed
    paintPalette();
    buildSeasons();
    paint();
    offs.push(b.onChange(paint));
    offs.push(view.onFrame(placeBadges));
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.target.closest?.('input, textarea, #plans')) return;
      e.preventDefault();
      e.stopPropagation(); // ours alone: the plans panel this opens must not take it as its own Esc
      if (drag && !drag.suppressClick) { cancelDrag(); return; }
      if (brush !== undefined) { brush = undefined; paintBrush(); hub.session?.refreshTip(); return; } // put the crop down first
      stop();
      onBack?.();
    };
    addEventListener('keydown', onKey, true);
    paletteEl.addEventListener('pointerdown', onDown);
    paletteEl.addEventListener('click', onPaletteClick);
    // in place before a touch starts, so a hold that turns into a drag never scrolls the palette
    paletteEl.addEventListener('touchmove', onTouchMove, { passive: false });
    seasonsEl.addEventListener('click', onSeasonClick);
    seasonsEl.addEventListener('keydown', onSeasonKey);
    offs.push(() => {
      removeEventListener('keydown', onKey, true);
      paletteEl.removeEventListener('pointerdown', onDown);
      paletteEl.removeEventListener('click', onPaletteClick);
      paletteEl.removeEventListener('touchmove', onTouchMove);
      seasonsEl.removeEventListener('click', onSeasonClick);
      seasonsEl.removeEventListener('keydown', onSeasonKey);
    });
    say('Drag a crop onto a field, or pick one and tap the fields. I’ll tell you what I think of each.');
    dock.querySelector('.isle-crop')?.focus({ preventScroll: true });
  }

  function stop() {
    if (!b) return;
    cancelDrag();
    offs.forEach((fn) => fn());
    offs = [];
    hub.setPlanMode(null);
    hub.session?.clearHover();
    document.body.classList.remove('isle-planning');
    dock.hidden = true;
    hub.session?.relayout(); // the room the dock took is the island's again
    badgesEl.replaceChildren();
    badges = [];
    b = null;
    onStop?.();
  }

  // ---------------------------------------------------------------- drawing
  function paint() {
    if (!b) return;
    paintSeasons();
    paintBrush();
    paintTotals();
    showOnIsland();
    paintBadges();
    hub.session?.refreshTip();
  }

  function showOnIsland() {
    const key = `${season}|${b.fields.map((p) => b.plan.sequences[p.id].map((c) => c.main).join(',')).join(';')}`;
    if (key === shownKey) return;
    shownKey = key;
    const seq = (p, i) => b.plan.sequences[p.id][i];
    // an empty season shows bare ground, and the field list says it isn't planned yet
    const keysByYear = [0, 1, 2].map((i) => new Map(b.fields.map((p) => [p.id, APP_CROP[seq(p, i).main] || 'fallow'])));
    const emptyByYear = [0, 1, 2].map((i) => new Set(b.fields.filter((p) => !seq(p, i).main).map((p) => p.id)));
    timeTravel.preview({ label: 'Your plan', startYear, keysByYear, emptyByYear }, season);
    timeTravel.prebuild?.(keysByYear); // the other seasons' crops, built while idle so switching is instant
  }

  function paintPalette() {
    // each crop's name in the shared crop tip, on hover (its icon) and keyboard focus (the button)
    paletteEl.innerHTML = [...b.palette().map((id) => `<button type="button" class="isle-crop bcrop" data-crop="${esc(id)}" data-crop-tip="${esc(b.nameOf(id))}" aria-pressed="false">${b.iconOf(id)}<span>${esc(b.nameOf(id))}</span></button>`),
      `<button type="button" class="isle-crop bcrop bcrop--clear" data-crop="" aria-pressed="false">${ERASER}<span>Clear</span></button>`].join('');
  }

  const paintBrush = () => {
    for (const c of paletteEl.querySelectorAll('.isle-crop')) c.setAttribute('aria-pressed', String(brush !== undefined && (c.dataset.crop || null) === brush));
  };

  /** The season radios, once per start (the years don't change); paintSeasons updates them in place. */
  function buildSeasons() {
    seasonsEl.innerHTML = b.years.map((y, i) => `<button type="button" role="radio" class="isle-season" data-i="${i}">${y}<span class="isle-season__flag" aria-hidden="true" hidden></span><span class="sr-only"></span></button>`).join('');
  }

  function paintSeasons() {
    for (const btn of seasonsEl.children) {
      const i = Number(btn.dataset.i);
      const worst = Math.max(0, ...b.fields.map((p) => b.worst(b.warningsAt(p.id, i))));
      const empty = b.fields.filter((p) => !b.plan.sequences[p.id][i].main).length;
      btn.setAttribute('aria-checked', String(i === season));
      btn.tabIndex = i === season ? 0 : -1;
      const flag = btn.children[0];
      flag.hidden = !worst;
      flag.className = `isle-season__flag${worst ? ` sev-${worst}` : ''}`;
      const sr = `${empty ? `, ${empty} ${empty === 1 ? 'field' : 'fields'} to plant` : ''}${worst ? `, ${SEV[worst].toLowerCase()}` : ''}`;
      if (btn.children[1].textContent !== sr) btn.children[1].textContent = sr;
    }
  }

  function paintTotals() {
    const t = b.totals;
    const html = t.kind === 'done'
      ? `<b>${money(t.expectedGM)}</b> over 3 seasons <span class="${t.diff >= 0 ? 'is-up' : 'is-down'}">${t.diff >= 0 ? '+' : '−'}${money(Math.abs(t.diff))} next to Manami’s pick</span>`
      : t.kind === 'working' ? 'Working out what your plan earns…'
        : t.kind === 'error' ? 'I couldn’t score it this time.'
          : `${t.left} field-season${t.left === 1 ? '' : 's'} still to plant`;
    // only the answer is read out, not "working out…" each time
    totalsEl.setAttribute('aria-busy', String(t.kind === 'working'));
    if (html !== shownTotals) { shownTotals = html; totalsEl.innerHTML = html; }
    saveBtn.disabled = !b.isComplete();
  }

  // ---- badges over the fields worth a second look this season, and the ones still to plant
  function paintBadges() {
    const fields = hub.session?.fields || [];
    badges = fields.flatMap((f) => {
      const cell = b.plan.sequences[f.id]?.[season];
      if (!cell) return [];
      if (!cell.main) return [{ f, empty: true }];
      const ws = b.warningsAt(f.id, season);
      const sev = b.worst(ws);
      return sev >= 2 ? [{ f, sev, n: ws.filter((w) => w.severity >= 2).length }] : [];
    });
    badgesEl.innerHTML = badges.map((x) => (x.empty
      ? `<span class="isle-badge isle-badge--empty">${PLUS}</span>`
      : `<span class="isle-badge sev-${x.sev}">${x.n}</span>`)).join('');
    badges.forEach((x, i) => { x.el = badgesEl.children[i]; x.at = ''; });
    placeBadges();
  }

  function placeBadges() {
    if (!b || !view || !badges.length) return;
    const r = view.canvas.getBoundingClientRect();
    for (const x of badges) {
      const v = v3.set(x.f.center[0], x.f.topY + 0.9, x.f.center[1]).project(view.camera);
      const at = v.z > 1 ? 'off' : `translate(${Math.round(r.left + ((v.x + 1) / 2) * r.width)}px, ${Math.round(r.top + ((1 - v.y) / 2) * r.height)}px) translate(-50%, -50%)`;
      if (at === x.at) continue; // nothing moved: no style writes
      x.at = at;
      x.el.style.visibility = at === 'off' ? 'hidden' : '';
      if (at !== 'off') x.el.style.transform = at;
    }
  }

  // ---------------------------------------------------------------- what Manami thinks
  function tipFor(id) {
    if (!b) return null;
    const cell = b.plan.sequences[id]?.[season];
    if (!cell) return null;
    const crop = drag?.active ? drag.crop : brush !== undefined ? brush : cell.main;
    if (drag?.active || brush !== undefined) {
      if (!crop) return { title: `Clear ${fieldName(id)} in ${year()}`, note: 'Tap to empty this season.' };
      const ws = b.check(id, season, crop);
      return { title: `${b.nameOf(crop)} on ${fieldName(id)}, ${year()}`, note: ws.length ? `${SEV[ws[0].severity]}: ${ws[0].reason}` : 'Looks good here.', sev: b.worst(ws) };
    }
    const ws = b.warningsAt(id, season);
    return {
      title: `${fieldName(id)}, ${year()}: ${cell.main ? b.nameOf(cell.main) : 'not planned yet'}`,
      note: cell.main ? (ws.length ? `${SEV[ws[0].severity]}: ${ws[0].reason}` : 'No concerns here.') : 'Drag a crop here.',
      sev: b.worst(ws),
    };
  }

  /** Manami's line about a field's season: the crop, then the most important note. */
  function sayAbout(id, crop) {
    const ws = b.warningsAt(id, season);
    const head = crop ? `${b.nameOf(crop)} on ${fieldName(id)} in ${year()}.` : `${fieldName(id)} is empty in ${year()}.`;
    say(ws.length ? `${head} ${SEV[ws[0].severity]}: ${ws[0].reason}` : crop ? `${head} Looks good to me.` : head);
  }

  function onTap(id) {
    if (!b || !id || !b.plan.sequences[id]) return;
    if (brush !== undefined) {
      b.place(id, season, brush);
      sayAbout(id, brush);
    } else {
      sayAbout(id, b.plan.sequences[id][season].main);
    }
  }

  function setSeason(i) {
    season = Math.max(0, Math.min(b.years.length - 1, i));
    paint();
    seasonsEl.querySelector(`[data-i="${season}"]`)?.focus();
  }
  function onSeasonClick(e) {
    const s = e.target.closest('.isle-season');
    if (s) setSeason(Number(s.dataset.i));
  }
  function onSeasonKey(e) {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (step) { e.preventDefault(); setSeason(season + step); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setSeason(e.key === 'Home' ? 0 : b.years.length - 1); }
  }

  function onPaletteClick(e) {
    if (drag?.suppressClick) { drag = null; return; }
    const c = e.target.closest('.isle-crop');
    if (!c) return;
    const id = c.dataset.crop || null;
    brush = brush === id ? undefined : id; // tap again to put it down
    paintBrush();
    hub.session?.refreshTip();
  }

  // ---------------------------------------------------------------- dragging onto the fields
  function onDown(e) {
    if (e.button !== 0 || (drag && !drag.suppressClick)) return;
    const c = e.target.closest('.isle-crop');
    if (!c || !c.dataset.crop) return; // the eraser only taps
    const touch = e.pointerType === 'touch';
    drag = { id: e.pointerId, touch, x: e.clientX, y: e.clientY, crop: c.dataset.crop, active: false, over: null, ghost: null };
    if (touch) drag.hold = setTimeout(() => { if (drag && !drag.active) startDrag(drag.x, drag.y); }, HOLD_MS);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
    addEventListener('blur', onCancel); // the window lost focus mid-drag: the release may never come
  }

  function startDrag(x, y) {
    hideCropTip(); // a crop picked up: the ghost carries it now
    drag.active = true;
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'isle-ghost';
    drag.ghost.innerHTML = b.iconOf(drag.crop);
    document.body.appendChild(drag.ghost);
    document.body.classList.add('isle-dragging');
    moveTo(x, y);
  }

  /** The field under (x, y), lit up with Manami's note on this crop there (or none). */
  const fieldAt = (x, y) => (document.elementFromPoint(x, y) === view.canvas ? hub.session?.hoverAt(x, y) ?? null : null);

  function moveTo(x, y) {
    drag.ghost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - (drag.touch ? 46 : 0))}px) translate(-50%, -50%)`;
    drag.over = fieldAt(x, y);
    if (!drag.over) hub.session?.clearHover();
  }

  function onMove(e) {
    if (!drag || drag.suppressClick || e.pointerId !== drag.id) return;
    // a mouse released somewhere we never heard about (outside the window, say): stop following it
    if (!drag.touch && e.buttons === 0) { cancelDrag(); return; }
    if (!drag.active) {
      const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      if (drag.touch) { if (moved > TOUCH_SLOP_PX) cancelDrag(); return; }
      if (moved < DRAG_START_PX) return;
      startDrag(e.clientX, e.clientY);
    }
    e.preventDefault();
    moveTo(e.clientX, e.clientY);
  }

  function onUp(e) {
    if (!drag || drag.suppressClick || e.pointerId !== drag.id) return;
    const d = drag;
    endDrag();
    if (!d.active) { drag = null; return; } // a tap: the click handler picks the crop
    drag = { suppressClick: true };
    setTimeout(() => { if (drag?.suppressClick) drag = null; }, 0);
    // the field under the release now (the island may have turned under a still pointer)
    const over = fieldAt(e.clientX, e.clientY);
    if (over && b.plan.sequences[over]) {
      b.place(over, season, d.crop);
      sayAbout(over, d.crop);
    }
    // a finger has left the screen: no hover to keep; a mouse still points at the field, now with its own note
    if (d.touch) hub.session?.clearHover();
    else hub.session?.refreshTip();
  }

  function onCancel(e) {
    if (e?.pointerId !== undefined && drag && !drag.suppressClick && e.pointerId !== drag.id) return;
    cancelDrag();
  }
  function cancelDrag() {
    const d = drag;
    endDrag();
    drag = null;
    if (!b || !d?.active) return;
    // the dragged crop's note goes; a mouse still over a field gets that field's own
    if (d.touch) hub.session?.clearHover();
    else hub.session?.refreshTip();
  }
  function onTouchMove(e) { if (drag?.active) e.preventDefault(); }

  function endDrag() {
    clearTimeout(drag?.hold);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onCancel);
    removeEventListener('blur', onCancel);
    drag?.ghost?.remove();
    document.body.classList.remove('isle-dragging');
  }

  return { start, stop, get active() { return !!b; } };
}
