// "Build your own": the drag-and-drop planner (roadmap 4.2), inside the plans panel.
//
//   palette   the crops this farm can grow (and an eraser)
//   grid      every field x the next 3 seasons
//   checks    the planner's instant rule checks on every season (nitrogen, pests, water, erosion,
//             repeats, shade, market, land), and a preview while a crop is dragged over a season
//   totals    once every season is filled: what the plan earns, a bad year, soil health and how
//             often it beats keeping going, next to Manami's pick (scored by the planner's worker)
//
// Three ways to place a crop: drag it from the palette (or from another season) onto a season;
// pick it in the palette and tap seasons; or use the keyboard (arrows move round the grid, Enter
// places the picked crop, Delete clears).
//
//   const builder = createPlanBuilder({ evaluate, onPreview, onSave })
//   await builder.mount(container, ctx)   ctx: { farm, market, years, exclusions, startPlans, saved }
import { cropIcon } from '../ui/cropIcons.js';
import { APP_CROP } from '../plan/farmInput.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ERASER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5l8.5-8.5 6 6-5 5H8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12.5 8l-4 4M8 19.5h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const CROP_NAME = {
  corn: 'Corn', soybeans: 'Soybeans', 'winter-wheat': 'Winter wheat', 'spring-wheat': 'Spring wheat', sorghum: 'Sorghum',
  cotton: 'Cotton', alfalfa: 'Alfalfa', oats: 'Oats', barley: 'Barley', sunflower: 'Sunflower', canola: 'Canola',
  'dry-beans': 'Dry beans', 'cereal-rye': 'Cereal rye', fallow: 'Fallow',
};
const nameOf = (id) => CROP_NAME[id] || id;
const iconOf = (id) => cropIcon(APP_CROP[id] || 'other');
const DRAG_START_PX = 5;
const HOLD_MS = 280; // a finger rests this long to pick a crop up (a quicker swipe scrolls)
const TOUCH_SLOP_PX = 10;

/**
 * @param {object} o
 * @param {(plan: object) => Promise<object>} o.evaluate          scores a full plan (planner worker)
 * @param {(plan: object, label: string) => void} [o.onPreview]   show it on the island
 * @param {(plan: object) => void} [o.onSave]                     use it
 * @param {() => void} [o.onIsland]                               plan it on the island instead (drag onto the fields)
 * @param {(n: number) => string} [o.money]                       money formatting
 */
export function createPlanBuilder({ evaluate, onPreview, onSave, onIsland, money = (n) => `$${Math.round(n)}` }) {
  let mod = null; // src/plan/builder.js, loaded on first use (it brings the planner's rules)
  let ctx = null;
  let checker = null;
  let plan = null;
  let warnings = new Map();
  let brush; // undefined: nothing picked; null: the eraser; a crop id
  let selected = null; // { field, year }
  let el = null;
  let evalRun = 0;
  let evalTimer = 0;
  let score = null; // { key, result } for the plan on screen
  let drag = null;
  let shownTotals = ''; // the totals' last HTML (only rewritten when it changes)

  /** Draws the builder into `container` (again: keeps the plan being built if the farm is the same). */
  async function mount(container, context) {
    mod ??= await import('../plan/builder.js');
    const sameFarm = ctx && JSON.stringify(ctx.farm) === JSON.stringify(context.farm);
    ctx = context;
    if (!sameFarm || !checker) {
      // a renamed field or a new answer in the check-in: new checks and scores, but the plan being
      // built is kept (fields that are gone drop out, new ones start empty)
      checker = mod.createChecker(ctx.farm, ctx.market);
      plan = mod.copyPlan(plan || ctx.saved || ctx.startPlans.priority, ctx.farm);
      if (selected && !ctx.farm.paddocks.some((p) => p.id === selected.field)) selected = null;
      score = null;
      evalRun++;
      pendingKey = null;
    }
    el = container;
    el.innerHTML = skeleton();
    wire();
    shownTotals = '';
    refresh();
  }

  const fields = () => ctx.farm.paddocks;
  const palette = () => {
    const ids = new Set(fields().flatMap((p) => p.availableCrops));
    ids.delete('cereal-rye'); // a winter cover, added to a season rather than planted as one
    return [...ids];
  };

  function skeleton() {
    return `<div class="builder">
      <p class="builder__lead">Drag a crop onto a season, or pick one and tap the seasons. I’ll flag anything worth a second look.</p>
      <div class="builder__palette" role="toolbar" aria-label="Crops to place">
        ${palette().map((id) => `<button type="button" class="bcrop" data-crop="${esc(id)}" aria-pressed="false">${iconOf(id)}<span>${esc(nameOf(id))}</span></button>`).join('')}
        <button type="button" class="bcrop bcrop--clear" data-crop="" aria-pressed="false">${ERASER}<span>Clear</span></button>
      </div>
      <div class="builder__main">
        <div class="builder__gridwrap"><table class="builder__grid" aria-label="Your plan, field by field">
          <thead><tr><th scope="col">Field</th>${ctx.years.map((y) => `<th scope="col">${y}</th>`).join('')}</tr></thead>
          <tbody>${fields().map((p) => `<tr><th scope="row"><span class="plan-field__name">${esc(p.name)}</span><span class="plan-field__acres">${Math.round(p.acres)} ac</span></th>
            ${ctx.years.map((_, y) => `<td><button type="button" class="bcell" data-field="${esc(p.id)}" data-year="${y}"></button></td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <aside class="builder__detail" aria-label="The season you picked"></aside>
      </div>
      <div class="builder__totals" aria-live="polite"></div>
      <div class="builder__actions">
        <span class="builder__start">Start from
          <button type="button" class="linkish" data-start="priority">Manami’s pick</button>
          <button type="button" class="linkish" data-start="current">Keep going</button>
          <button type="button" class="linkish" data-start="empty">Empty</button>
        </span>
        <span class="builder__go">
          <button type="button" class="btn btn--quiet btn--small" data-act="island">Plan on the island</button>
          <button type="button" class="btn btn--quiet btn--small" data-act="preview">Show on the island</button>
          <button type="button" class="btn btn--primary btn--small" data-act="save">Use my plan</button>
        </span>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- drawing
  function refresh() {
    warnings = checker.all(plan);
    for (const b of el.querySelectorAll('.bcell')) paintCell(b);
    for (const b of el.querySelectorAll('.bcrop')) b.setAttribute('aria-pressed', String(brush !== undefined && (b.dataset.crop || null) === brush));
    el.querySelector('.builder__grid').classList.toggle('has-brush', brush !== undefined);
    // roving focus: one season in the tab order
    const cells = [...el.querySelectorAll('.bcell')];
    const focusKey = selected ? `${selected.field}:${selected.year}` : `${cells[0]?.dataset.field}:0`;
    for (const b of cells) b.tabIndex = `${b.dataset.field}:${b.dataset.year}` === focusKey ? 0 : -1;
    paintDetail();
    scheduleScore();
    emit();
  }

  // ---- for the island planner (src/screens/islandPlanner.js), which edits this same plan
  const listeners = new Set();
  let totals = { kind: 'empty', left: 0 }; // 'empty' | 'working' | 'done' | 'error'
  function emit() { listeners.forEach((fn) => { try { fn(); } catch { /* a listener's problem isn't the grid's */ } }); }

  function paintCell(b, preview = null) {
    const f = b.dataset.field, y = Number(b.dataset.year);
    const cell = plan.sequences[f][y];
    const crop = preview?.crop ?? cell.main;
    const w = preview ? preview.warnings : warnings.get(`${f}:${y}`) || [];
    const sev = mod.worst(w);
    const field = fields().find((p) => p.id === f);
    b.className = `bcell${crop ? '' : ' is-empty'}${sev ? ` sev-${sev}` : ''}${selected?.field === f && selected?.year === y ? ' is-selected' : ''}${preview ? ' is-target' : ''}`;
    b.innerHTML = crop
      ? `${iconOf(crop)}${cell.cover && !preview ? '<span class="plan-crop__cover" aria-hidden="true"></span>' : ''}${sev ? `<span class="bcell__flag" aria-hidden="true"></span>` : ''}`
      : '<span class="bcell__plus" aria-hidden="true"></span>';
    const what = crop ? `${nameOf(crop)}${cell.cover && !preview ? ' with a cereal rye cover' : ''}` : 'empty';
    b.setAttribute('aria-label', `${field.name}, ${ctx.years[y]}: ${what}${w.length ? `. ${mod.summarise(w)}` : ''}`);
  }

  function paintDetail() {
    const d = el.querySelector('.builder__detail');
    if (!selected) {
      const all = [...warnings.entries()].flatMap(([k, ws]) => ws.map((w) => ({ k, w }))).filter((x) => x.w.severity >= 2).sort((a, b) => b.w.severity - a.w.severity);
      d.innerHTML = `<h4>Things to look at</h4>${all.length
        ? `<ul class="bchips">${all.slice(0, 6).map(({ k, w }) => { const [f, y] = k.split(':'); return chip(w, `${fields().find((p) => p.id === f).name}, ${ctx.years[y]}`); }).join('')}</ul>${all.length > 6 ? `<p class="builder__more">and ${all.length - 6} more: pick a season to see its notes.</p>` : ''}`
        : '<p class="builder__ok">Nothing worth a second look. Pick a season to see its notes.</p>'}`;
      return;
    }
    const { field, year } = selected;
    const p = fields().find((x) => x.id === field);
    const cell = plan.sequences[field][year];
    const ws = warnings.get(`${field}:${year}`) || [];
    const rye = p.availableCrops.includes('cereal-rye') && cell.main && cell.main !== 'fallow';
    const notOffered = (ctx.exclusions?.[field] || []).filter((x) => x.cropId !== 'cereal-rye');
    d.innerHTML = `<h4>${esc(p.name)}, ${ctx.years[year]}</h4>
      <p class="builder__crop">${cell.main ? `${iconOf(cell.main)}<b>${esc(nameOf(cell.main))}</b>${cell.cover ? ' + cereal rye cover over winter' : ''}` : 'Empty: drag a crop here, or pick one and tap.'}</p>
      ${cell.main ? (ws.length ? `<ul class="bchips">${ws.map((w) => chip(w)).join('')}</ul>` : '<p class="builder__ok">No concerns here.</p>') : ''}
      ${rye ? `<button type="button" class="btn btn--quiet btn--small" data-act="cover">${cell.cover ? 'Take off the rye cover' : 'Add a rye cover crop after it'}</button>` : ''}
      ${notOffered.length ? `<details class="builder__why"><summary>Why some crops aren’t suggested here</summary><ul>${notOffered.map((x) => `<li><b>${esc(nameOf(x.cropId))}</b>: ${esc(x.reason)}</li>`).join('')}</ul></details>` : ''}`;
  }

  function chip(w, where = '') {
    return `<li class="bchip sev-${w.severity}"><span class="bchip__tag">${esc(mod.LENS_LABEL[w.lens] || w.lens)} · ${esc(mod.SEVERITY_LABEL[w.severity])}</span>${where ? `<span class="bchip__where">${esc(where)}</span>` : ''}<span class="bchip__why">${esc(w.reason)}</span></li>`;
  }

  // ---------------------------------------------------------------- totals (the planner's worker)
  /** Writes the totals only when they change (they're a live region: no repeats on every move). */
  function writeTotals(html) {
    if (html === shownTotals) return;
    shownTotals = html;
    el.querySelector('.builder__totals').innerHTML = html;
  }

  function scheduleScore() {
    const left = mod.emptyCount(plan, ctx.farm);
    setActions(left === 0);
    const key = JSON.stringify(plan);
    if (left) {
      clearTimeout(evalTimer);
      pendingKey = null;
      evalRun++;
      writeTotals(`<p class="builder__fill">Fill the ${left} empty season${left === 1 ? '' : 's'} to see what your plan earns.</p>`);
      totals = { kind: 'empty', left };
      return;
    }
    if (score?.key === key) { // anything still on its way is for another plan
      clearTimeout(evalTimer);
      pendingKey = null;
      evalRun++;
      paintTotals();
      return;
    }
    if (pendingKey === key) return; // this plan is already scheduled or being worked out
    clearTimeout(evalTimer);
    writeTotals('<p class="builder__fill"><span class="plans__spinner" aria-hidden="true"></span>Working out what your plan earns…</p>');
    totals = { kind: 'working' };
    const id = ++evalRun;
    const snapshot = plan;
    pendingKey = key;
    evalTimer = setTimeout(async () => {
      try {
        const result = await evaluate(snapshot);
        if (id !== evalRun || JSON.stringify(plan) !== key) return;
        score = { key, result };
        paintTotals();
      } catch (e) {
        if (id === evalRun) {
          writeTotals(`<p class="builder__fill">I couldn’t score it this time (${esc(e.message)}).</p>`);
          totals = { kind: 'error', message: e.message };
          emit();
        }
      } finally {
        if (pendingKey === key) pendingKey = null;
      }
    }, 300);
  }
  let pendingKey = null;

  function paintTotals() {
    const r = score.result, pick = ctx.startPlans.priorityResult;
    const diff = r.expectedGM - pick.expectedGM;
    totals = { kind: 'done', expectedGM: r.expectedGM, diff, p10GM: r.p10GM };
    queueMicrotask(emit);
    const soil = (x) => Math.round((x.endSoilHealth ?? x.soilHealth) * 100);
    // the planner gives no "beats keeping going" for a plan that IS keeping going
    const beats = r.probBeatsCurrent == null ? '–' : `${Math.round(r.probBeatsCurrent * 100)}% of years`;
    writeTotals(`<dl class="builder__nums">
      <div><dt>Your plan, 3 seasons</dt><dd class="plan-card__big">${money(r.expectedGM)}</dd></div>
      <div><dt>Next to Manami’s pick</dt><dd class="${diff >= 0 ? 'is-up' : 'is-down'}">${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))}</dd></div>
      <div><dt>In a bad year (1 in 10)</dt><dd>${money(r.p10GM)}</dd></div>
      <div><dt>Soil health at the end</dt><dd>${soil(r)}/100 <span class="builder__vs">(pick: ${soil(pick)})</span></dd></div>
      <div><dt>Beats keeping going</dt><dd>${beats}</dd></div>
    </dl>`);
  }

  function setActions(complete) {
    for (const b of el.querySelectorAll('[data-act="preview"], [data-act="save"]')) {
      b.disabled = !complete;
      b.title = complete ? '' : 'Fill every season first';
    }
  }

  // ---------------------------------------------------------------- placing
  function place(field, year, crop) {
    if (plan.sequences[field][year].main === (crop || null)) return;
    plan = mod.setCell(plan, field, year, crop || null);
    refresh();
  }

  function select(field, year, focus = false) {
    selected = { field, year };
    refresh();
    if (focus) el.querySelector(`.bcell[data-field="${CSS.escape(field)}"][data-year="${year}"]`)?.focus();
  }

  function onClick(e) {
    if (drag?.suppressClick) { drag = null; return; }
    const crop = e.target.closest('.bcrop');
    if (crop) {
      const id = crop.dataset.crop || null;
      brush = brush === id ? undefined : id; // tap again to put it down
      refresh();
      return;
    }
    const cell = e.target.closest('.bcell');
    if (cell) {
      const f = cell.dataset.field, y = Number(cell.dataset.year);
      if (brush !== undefined) place(f, y, brush);
      selected = { field: f, year: y };
      refresh();
      return;
    }
    const start = e.target.closest('[data-start]');
    if (start) {
      plan = start.dataset.start === 'empty' ? mod.emptyPlan(ctx.farm) : mod.copyPlan(ctx.startPlans[start.dataset.start], ctx.farm);
      refresh();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cover' && selected) {
      const c = plan.sequences[selected.field][selected.year];
      const whyOpen = el.querySelector('.builder__why')?.open;
      plan = mod.setCover(plan, selected.field, selected.year, c.cover ? null : 'cereal-rye');
      refresh();
      const why = el.querySelector('.builder__why');
      if (why && whyOpen) why.open = true;
      el.querySelector('.builder__detail [data-act="cover"]')?.focus(); // stay on the button (it was redrawn)
    } else if (act === 'island') onIsland?.();
    else if (act === 'preview' && mod.isComplete(plan, ctx.farm)) onPreview?.(plan, 'Your plan');
    else if (act === 'save' && mod.isComplete(plan, ctx.farm)) onSave?.(plan);
  }

  function onKey(e) {
    const cell = e.target.closest?.('.bcell');
    if (!cell) return;
    const f = cell.dataset.field, y = Number(cell.dataset.year);
    const ids = fields().map((p) => p.id);
    const r = ids.indexOf(f);
    const move = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
    if (move) {
      e.preventDefault();
      const nr = Math.max(0, Math.min(ids.length - 1, r + move[0]));
      const ny = Math.max(0, Math.min(ctx.years.length - 1, y + move[1]));
      select(ids[nr], ny, true);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      place(f, y, null);
      select(f, y, true);
    }
  }

  // ---- dragging (pointer events, so it works with a mouse, a pen or a finger)
  function onDown(e) {
    if (e.button !== 0) return;
    if (drag && !drag.suppressClick) return; // one drag at a time (a second finger is ignored)
    const chipEl = e.target.closest('.bcrop');
    const cellEl = e.target.closest('.bcell');
    const crop = chipEl ? chipEl.dataset.crop || null : cellEl ? plan.sequences[cellEl.dataset.field][Number(cellEl.dataset.year)].main : undefined;
    if (!crop) return; // nothing to carry (the eraser and empty seasons only tap)
    const touch = e.pointerType === 'touch';
    drag = { id: e.pointerId, touch, x: e.clientX, y: e.clientY, crop, active: false, armed: !touch, target: null, ghost: null };
    // a finger has to rest a moment before it picks a crop up; a swipe before then scrolls the panel
    if (touch) drag.hold = setTimeout(() => { if (drag && !drag.active) { drag.armed = true; startDrag(drag.x, drag.y); } }, HOLD_MS);
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
  }

  function startDrag(x, y) {
    drag.active = true;
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'bghost';
    drag.ghost.innerHTML = `<span class="bghost__crop">${iconOf(drag.crop)}<b>${esc(nameOf(drag.crop))}</b></span><span class="bghost__note"></span>`;
    document.body.appendChild(drag.ghost);
    el.classList.add('is-dragging');
    placeGhost(x, y);
  }

  /** Next to the pointer (above the finger on touch), kept on the screen. */
  function placeGhost(x, y) {
    const g = drag.ghost;
    const w = g.offsetWidth, h = g.offsetHeight;
    let gx = x + 14, gy = drag.touch ? y - h - 28 : y + 14;
    if (gx + w > innerWidth - 8) gx = Math.max(8, x - 14 - w);
    if (gy < 8) gy = y + 28;
    if (gy + h > innerHeight - 8) gy = Math.max(8, y - h - 14);
    g.style.transform = `translate(${Math.round(gx)}px, ${Math.round(gy)}px)`;
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      if (drag.touch) {
        if (moved > TOUCH_SLOP_PX) onCancel(); // a swipe: let the panel scroll
        return;
      }
      if (moved < DRAG_START_PX) return;
      startDrag(e.clientX, e.clientY);
    }
    e.preventDefault();
    placeGhost(e.clientX, e.clientY);
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.bcell');
    const inGrid = target && el.contains(target) ? target : null;
    if (inGrid !== drag.target) {
      if (drag.target) paintCell(drag.target);
      drag.target = inGrid;
      const note = drag.ghost.querySelector('.bghost__note');
      if (inGrid) {
        // the live check: what putting this crop here would mean
        const w = checker.at(plan, inGrid.dataset.field, Number(inGrid.dataset.year), drag.crop);
        paintCell(inGrid, { crop: drag.crop, warnings: w });
        const sev = mod.worst(w);
        drag.ghost.dataset.sev = String(sev);
        note.textContent = w.length ? `${mod.SEVERITY_LABEL[w[0].severity]}: ${w[0].reason}` : 'Looks good here.';
      } else {
        delete drag.ghost.dataset.sev;
        note.textContent = '';
      }
      placeGhost(e.clientX, e.clientY); // its size changed with the note
    }
  }

  function onUp(e) {
    if (!drag || drag.suppressClick || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    endDrag();
    if (!d.active) { drag = null; return; } // a tap: the click handler takes it
    drag = { suppressClick: true };
    setTimeout(() => { if (drag?.suppressClick) drag = null; }, 0);
    if (d.target) {
      const f = d.target.dataset.field, y = Number(d.target.dataset.year);
      selected = { field: f, year: y };
      place(f, y, d.crop);
      refresh();
    }
  }

  function onCancel(e) {
    if (e?.pointerId !== undefined && drag && !drag.suppressClick && e.pointerId !== drag.id) return;
    if (drag?.target) paintCell(drag.target);
    endDrag();
    drag = null;
  }

  // once a finger has picked a crop up, it drags rather than scrolls
  function onTouchMove(e) { if (drag?.active && drag.touch) e.preventDefault(); }

  function endDrag() {
    clearTimeout(drag?.hold);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onCancel);
    drag?.ghost?.remove();
    el?.classList.remove('is-dragging');
  }

  function wire() {
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('touchmove', onTouchMove, { passive: false });
  }

  return {
    mount,
    get plan() { return plan; },
    get ready() { return !!(mod && ctx && checker); },
    get years() { return ctx?.years || []; },
    get fields() { return ctx?.farm.paddocks || []; },
    get totals() { return totals; },
    /** The crops on offer (the palette), as planner ids. */
    palette: () => (ctx ? palette() : []),
    /** Puts a crop (or null) on a field in a season, here and on the grid. */
    place: (field, year, crop) => { if (ctx) { selected = { field, year }; place(field, year, crop); } },
    /** Warnings for putting crop on a field in a season, with the rest of the plan as it is. */
    check: (field, year, crop) => (checker ? checker.at(plan, field, year, crop) : []),
    /** The warnings for what's planned there now. */
    warningsAt: (field, year) => warnings.get(`${field}:${year}`) || [],
    worst: (ws) => (mod ? mod.worst(ws) : 0),
    summarise: (ws) => (mod ? mod.summarise(ws) : ''),
    isComplete: () => !!(mod && ctx && mod.isComplete(plan, ctx.farm)),
    nameOf,
    iconOf,
    /** Calls fn whenever the plan, its checks or its totals change; returns a remover. */
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    /** Stops any drag (the panel closed). */
    cancel: onCancel,
  };
}
