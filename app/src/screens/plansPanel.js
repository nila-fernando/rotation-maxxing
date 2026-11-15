// "Plan my next seasons": the rotation planner's three plans (roadmap 4.3, 4.4), rotation first.
//
//   Keep going     the current rotation, continued
//   Most profit    the most cash over the 3 seasons
//   Manami's pick  the best fit for the farmer's priorities (from the check-in)
//
// Three tabs:
//   Your rotation  Manami's headline (rotation only), a "Plan to show" switch, the rotation ribbon
//                  (two past seasons and three planned, with link signs and verdicts, no money), the
//                  5-row rotation check, then the money: one line and a closed "Money detail". Each
//                  field's story opens under its ribbon row and carries the per-field pick. Then
//                  "Why my pick", "Watch out", "Good to know" and the planner's own words, all closed.
//   When to sow    jobs by month, crop cards, frost and handoffs (src/screens/cropCalendarView.js)
//   Build your own the drag-and-drop planner (src/screens/planBuilder.js), unchanged
// Pick a plan per field (the mix is scored too) and save it. "See it on the farm" opens the plan on
// show on the island itself (src/screens/planFutures.js).
//
//   const panel = createPlansPanel({ planSeasons, evaluateMix, onPreview, onFutures, onSave, onOpen, onClose })
//   panel.open()   panel.close()   panel.ensureData()   panel.getChoice()   panel.setChoice(map)
//
// The rotation views (compareFutures, Manami's lines, the ribbon, the calendar) load with the first
// open, alongside the plans themselves, so they stay out of the app's first download.
import { APP_CROP } from '../plan/farmInput.js';
import { createPlanBuilder } from './planBuilder.js';
import { money } from '../ui/money.js';
import { PLANS } from '../plan/planNames.js';
import { asset } from '../ui/asset.js';
// the calendar is already in the main bundle (the builder's palette reads its sowing windows), so it's not lazy
import * as cropCalendar from '../plan/cropCalendar.js';

const MANAMI_SVG = asset('/manami.svg');

// (money lives in src/ui/money.js now; it is still exported from here for older callers)
export { money } from '../ui/money.js';

// a little barn, for "See it on the farm"
const FARM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 20V10.2L12 4l8.5 6.2V20z" fill="currentColor" fill-opacity=".2"/><path d="M9 20v-5.5h6V20M9 14.5l6 5.5M15 14.5L9 20M10 10h4"/></svg>';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// a value inside a quoted attribute selector
const attrSel = (s) => String(s ?? '').replace(/["\\]/g, '\\$&');

/** The panel's three tabs, in order (the arrow keys cycle them). */
export const TABS = [
  { view: 'rotation', label: 'Your rotation' },
  { view: 'calendar', label: 'When to sow' },
  { view: 'build', label: 'Build your own' },
];

/** The tab an arrow, Home or End key moves to from `view` (wrapping), or null for other keys. */
export function nextTab(view, key) {
  const i = Math.max(0, TABS.findIndex((t) => t.view === view));
  const n = TABS.length;
  const j = { ArrowLeft: (i - 1 + n) % n, ArrowRight: (i + 1) % n, Home: 0, End: n - 1 }[key];
  return j == null ? null : TABS[j].view;
}

/** The first season the plans start with: next year's once this year's harvest is in (from August). */
export function firstSeason(today = new Date()) {
  return today.getMonth() >= 7 ? today.getFullYear() + 1 : today.getFullYear();
}

/**
 * Manami's money line (HTML): what her pick earns over keeping going, or that the rotation already
 * fits, with what her pick costs when it earns less. gain: pick minus keeping going, 3 seasons.
 * (The panel now leads with the rotation; this stays for older callers and its tests.)
 */
export function pickNote(gain, beats) {
  if (gain > 1) return `My pick earns about <b>${money(gain)}</b> more than keeping going over 3 seasons, and comes out ahead in <b>${beats}%</b> of the weather years I tried.`;
  if (gain < -1) return `My pick earns about <b>${money(-gain)}</b> less than keeping going over 3 seasons, in return for what you told me matters most.`;
  return 'Your rotation is already a good fit. My pick changes little.';
}

// the rotation views, loaded once with the first open
let mods = null;
let modsP = null;
/** Loads the rotation views (once). */
export function loadRotationViews() {
  modsP ??= Promise.all([
    import('../plan/compareFutures.js'), import('../plan/futuresVoice.js'), import('../plan/rotationStory.js'),
    import('../plan/rotationVoice.js'), import('./rotationRibbon.js'), import('./cropCalendarView.js'), cropCalendar,
  ]).then(([cf, fv, rs, rv, rr, cv, cc]) => (mods = { cf, fv, rs, rv, rr, cv, cc }), (e) => { modsP = null; throw e; });
  return modsP;
}

/**
 * @param {object} o
 * @param {() => Promise<{result, gaps, weather, farm}>} o.planSeasons
 * @param {(plan: object) => Promise<object>} [o.evaluateMix]   scores a mixed plan
 * @param {(info: {label: string, keysByYear: Map<string, string>[], startYear: number}) => void} [o.onPreview]
 * @param {(kind: string, opts: {reel: boolean}) => void} [o.onFutures]   the plans on the island (planFutures)
 * @param {(plan: object, info: object) => void} [o.onSave]
 * @param {() => void} [o.onOpen]   [o.onClose]
 * @param {() => Date} [o.today]
 * @param {() => object|null} [o.getSaved]  the plan the farmer saved last (the builder starts from it)
 */
export function createPlansPanel({ planSeasons, evaluateMix, onPreview, onFutures, onSave, onIsland, onOpen, onClose, today = () => new Date(), getSaved = () => null, aiTake = null }) {
  const root = document.getElementById('plans');
  const body = document.getElementById('plansBody');
  const title = document.getElementById('plansTitle');
  document.getElementById('plansClose').addEventListener('click', () => close());
  let data = null; // { result, gaps, weather, farm }
  let choice = {}; // field id -> plan kind
  let run = 0;
  let mixRun = 0;
  let view = 'rotation'; // 'rotation' | 'calendar' (when to sow) | 'build' your own (drag and drop)
  let selected = 'priority'; // the plan on show in the ribbon, the check and the money line
  const openStories = new Set(); // the field stories that are open
  let calSeason = 0; // the season on show in "When to sow"
  let mixScore = null; // the mix's evaluateMix score, once worked out
  let mixShown = false; // whether the switch shows "Your plan"
  let cmp = null; // compareFutures(data), worked out with the first render of these plans
  let cmpData = null;
  const rots = new Map(); // kind -> rotationOf(cmp, kind)
  let ribbonWired = false;
  let disposeView = null; // the "When to sow" tab's wiring
  let handoff = null; // the plans on show, handed straight to the island by "See it on the farm"
  let viewsErr = null; // why the rotation views didn't load, the last time they were asked for

  // "Build your own": the drag-and-drop planner, scored by the same planner
  const builder = createPlanBuilder({
    money,
    evaluate: (plan) => evaluateMix(plan),
    onPreview: (plan, label) => { close({ restoreFocus: false }); onPreview?.(previewInfo(plan, label)); },
    onSave: (plan) => { close({ restoreFocus: false }); onSave?.(plan, { source: 'built', startYear: firstSeason(today()) }); },
    // the same plan, edited by dragging crops onto the 3D fields (src/screens/islandPlanner.js)
    onIsland: () => { close({ restoreFocus: false }); onIsland?.(builder, { startYear: firstSeason(today()) }); },
  });
  /** Saves the plan built here (from the island planner, say). */
  const saveBuilt = (plan) => onSave?.(plan, { source: 'built', startYear: firstSeason(today()) });
  const previewInfo = (plan, label) => ({
    label, plan, startYear: firstSeason(today()),
    keysByYear: [0, 1, 2].map((i) => new Map(Object.entries(plan.sequences).map(([id, s]) => [id, APP_CROP[s[i].main] || 'other']))),
  });

  // Esc closes it wherever focus is (Safari doesn't focus buttons on click)
  document.addEventListener('keydown', (e) => {
    // (a jar test open over the plans takes the Esc for itself; the crop tip takes the first Esc on its window listener)
    if (e.key === 'Escape' && !root.hidden && !document.body.classList.contains('jar-open') && !e.target.closest?.('input, textarea')) { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);
  let opener = null; // focus goes back here on close

  async function open() {
    const id = ++run;
    handoff = null;
    if (root.hidden) {
      // focus goes back here on close: not the island planner's dock (it hides as this opens), nor
      // anything else that can't take focus; close() falls back to "Plan my next seasons"
      const a = document.activeElement;
      opener = a && a !== document.body && a.getClientRects().length && !a.closest('#isleDock') ? a : null;
    }
    onOpen?.();
    root.hidden = false;
    document.body.classList.add('plans-open');
    const y0 = firstSeason(today());
    title.textContent = `Your next 3 seasons: ${y0} to ${y0 + 2}`;
    title.focus({ preventScroll: true });
    if (!data) {
      body.innerHTML = `<div class="plans__loading" role="status"><span class="plans__spinner" aria-hidden="true"></span>
        Working out your plans from 24 years of NASA weather, your soil and your crop history…</div>`;
    }
    // if the farm changed since last time, the old plans stay on show (greyed) while new ones are worked out
    const pending = planSeasons();
    let settled = false;
    pending.finally(() => { settled = true; }).catch(() => {});
    await Promise.resolve();
    if (data && !settled) setBusy(true);
    try {
      // (if the rotation views don't load, the plans still do: "Build your own" works without them)
      const [fresh] = await Promise.all([pending, loadRotationViews().catch((e) => { viewsErr = e; })]);
      if (id !== run || root.hidden) return;
      adopt(fresh);
      setBusy(false);
      render();
    } catch (e) {
      if (id !== run) return;
      setBusy(false);
      body.innerHTML = `<p class="plans__error">I couldn’t work out the plans this time (${esc(e.message)}). Try again in a moment.</p>`;
    }
  }

  /** New plans become the ones on show (the same ones again change nothing). */
  function adopt(fresh) {
    if (data?.result === fresh.result) return;
    // keep the picks for fields that are still there; new fields start on Manami's pick
    choice = Object.fromEntries(fresh.result.plans.priority.paddocks.map((p) => [p.paddockId, choice[p.paddockId] && fresh.result.plans[choice[p.paddockId]] ? choice[p.paddockId] : 'priority']));
    data = fresh;
    mixScore = null;
  }

  /**
   * The plans for the farm as it stands (worked out if they aren't yet, or if the farm changed). Straight
   * from the panel, the ones the farmer was just looking at: the farm can't change while it's open, and
   * asking again would redo plans made on stand-in weather (and could show other numbers than the card).
   */
  async function ensureData() {
    const handed = handoff;
    handoff = null;
    if (handed && handed === data) return data;
    const fresh = await planSeasons();
    adopt(fresh);
    return data;
  }

  /** The pick per field (a copy). */
  const getChoice = () => ({ ...choice });

  const isMixed = () => new Set(Object.values(choice)).size > 1;
  const uniform = () => { const k = new Set(Object.values(choice)); return k.size === 1 ? [...k][0] : null; };

  /** The story radios follow the picks (and the one picked is the one in the tab order). */
  function syncCells(field = null) {
    const cells = body.querySelectorAll(field ? `.plan-cell[data-field="${attrSel(field)}"]` : '.plan-cell');
    for (const b of cells) {
      const on = (choice[b.dataset.field] || 'priority') === b.dataset.kind;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    return cells;
  }

  /**
   * After the picks change: "Your plan" shows on the switch once they differ by field (and goes
   * with them), and while it is on show the ribbon, the check and the money follow the picks.
   */
  function afterChoice() {
    const mixed = isMixed();
    fixSelected();
    if (view === 'rotation' && mods && cmp && (mixed !== mixShown || selected === 'mix')) refreshShown();
  }

  /** The picks made elsewhere (the plans on the island): the story radios, the switch and the mix follow. */
  function setChoice(map) {
    choice = { ...choice, ...map };
    mixScore = null;
    const cells = syncCells();
    const shown = !!body.querySelector('.rot-host--switch');
    if (!cells.length && !shown) return;
    afterChoice();
    scoreMix();
  }

  /** Old plans on show while new ones are worked out: greyed, not clickable, and said so. */
  function setBusy(on) {
    body.setAttribute('aria-busy', String(on));
    body.classList.toggle('is-busy', on);
    let note = body.querySelector('.plans__updating');
    if (on && !note) {
      note = document.createElement('p');
      note.className = 'plans__updating';
      note.setAttribute('role', 'status');
      note.innerHTML = '<span class="plans__spinner" aria-hidden="true"></span>Updating your plans for the changes you made…';
      body.prepend(note);
    }
    if (!on) note?.remove();
  }

  function close({ restoreFocus = true } = {}) {
    run++;
    mixRun++;
    builder.cancel();
    if (root.hidden) return;
    const hadFocus = root.contains(document.activeElement) || document.activeElement === document.body;
    root.hidden = true;
    document.body.classList.remove('plans-open');
    setBusy(false);
    onClose?.();
    if (restoreFocus && hadFocus) (opener?.isConnected && opener.getClientRects().length ? opener : document.getElementById('hubPlan'))?.focus({ preventScroll: true });
  }

  const planOf = (kind) => data.result.plans[kind];

  /** The mixed plan from the per-field picks, in the planner's Plan shape. */
  function mixedPlan() {
    const sequences = {};
    for (const p of planOf('priority').paddocks) {
      const kind = choice[p.paddockId] || 'priority';
      sequences[p.paddockId] = planOf(kind).plan.sequences[p.paddockId];
    }
    return { sequences };
  }

  // ---- the comparison and the rotations ----

  /** compareFutures for the plans on show (worked out once per set of plans). */
  function cmpNow() {
    if (cmpData !== data) {
      cmp = mods.cf.compareFutures(data, { startYear: firstSeason(today()) });
      cmpData = data;
      rots.clear();
    }
    return cmp;
  }

  /** A plan's rotation (the mix: the picks as they stand, never cached). */
  function rotFor(kind) {
    if (kind === 'mix') return mods.rs.rotationOf(cmp, 'mix', choice, mixScore);
    if (!rots.has(kind)) rots.set(kind, mods.rs.rotationOf(cmp, kind));
    return rots.get(kind);
  }

  const planName = (kind) => mods.rr.PLAN_NAME[kind] || 'Your plan';

  function tabs() {
    const tab = ({ view: v, label }) => `<button type="button" role="tab" class="plans__tab" id="plansTab-${v}" aria-controls="plansView" data-view="${v}" aria-selected="${view === v}" tabindex="${view === v ? 0 : -1}">${label}</button>`;
    return `<div class="plans__tabs" role="tablist" aria-label="Plans">${TABS.map(tab).join('')}</div>`;
  }

  function render() {
    disposeView?.();
    disposeView = null;
    if (view === 'build') return renderBuild();
    if (!mods) {
      if (viewsErr) {
        // the views didn't load (a dropped connection, say): say so, and keep the tabs (the builder still works)
        const why = viewsErr;
        viewsErr = null; // (the next open tries again)
        body.innerHTML = `${tabs()}<p class="plans__error" role="tabpanel" id="plansView" aria-labelledby="plansTab-${view}">I couldn’t lay these plans out this time (${esc(why.message)}). Try again in a moment.</p>`;
        return;
      }
      loadRotationViews().then(() => { if (!root.hidden) render(); }, (e) => { viewsErr = e; if (!root.hidden) render(); });
      return;
    }
    if (!ribbonWired) {
      mods.rr.wireRibbon(body, {
        onToggle: (id, isOpen) => { if (isOpen) openStories.add(id); else openStories.delete(id); },
        onSelect: (kind) => select(kind),
      });
      ribbonWired = true;
    }
    try {
      cmpNow();
    } catch (e) {
      body.innerHTML = `${tabs()}<p class="plans__error" role="tabpanel" id="plansView">I couldn’t lay these plans out this time (${esc(e.message)}).</p>`;
      return;
    }
    if (view === 'calendar') renderCalendar();
    else renderRotation();
  }

  function renderBuild() {
    body.innerHTML = `${tabs()}<div class="plans__build" role="tabpanel" id="plansView" aria-labelledby="plansTab-build"></div>`;
    const el = body.querySelector('.plans__build');
    if (!el) return;
    const y0 = firstSeason(today());
    builder.mount(el, {
      farm: data.farm,
      market: data.market,
      years: [y0, y0 + 1, y0 + 2],
      exclusions: data.result.exclusions,
      saved: getSaved(),
      startPlans: { priority: planOf('priority').plan, current: planOf('current').plan, priorityResult: planOf('priority') },
    });
  }

  // ---- "Your rotation" ----

  // the parts that follow the plan on show, each in a host of its own so a switch redraws only them
  const PARTS = {
    farm: () => farmBtn(),
    switch: () => switchPart(),
    ribbon: () => ribbonPart(),
    check: () => checkPart(),
    money: () => moneyPart(),
    detail: () => detailPart(),
    watch: () => watchPart(),
  };
  const host = (part, tag = 'div', cls = '') => `<${tag} class="rot-host rot-host--${part}${cls ? ` ${cls}` : ''}">${PARTS[part]()}</${tag}>`;

  function farmBtn() {
    if (!onFutures) return '';
    // Manami's pick runs her walk; any other plan opens on the island as it is
    const act = selected === 'priority' ? 'data-act="futures"' : `data-show="${esc(selected)}"`;
    return `<button class="btn btn--primary btn--small plans__farm" type="button" ${act}>${FARM_ICON}See it on the farm</button>`;
  }

  /** "Your plan" is on the switch only while the picks differ by field. */
  function fixSelected() {
    if (selected === 'mix' && !isMixed()) selected = uniform() || 'priority';
  }

  function switchPart() {
    mixShown = isMixed();
    const kinds = ['current', 'maxProfit', 'priority', ...(mixShown ? ['mix'] : [])];
    const all = Object.fromEntries(kinds.map((k) => [k, rotFor(k)]));
    return mods.rr.switchHtml(cmp, all[selected], selected, { showMix: mixShown, rots: all });
  }

  function ribbonPart() {
    const rot = rotFor(selected);
    const place = mods.cc.placeOf(data.farm);
    const stories = Object.fromEntries((rot.fields || []).map((f) => [f.id, mods.rr.storyHtml(rot, cmp, f.id, { choice, place, years: rot.years })]));
    return mods.rr.ribbonHtml(rot, { selectedKind: selected, open: openStories, stories });
  }

  function checkPart() {
    const base = selected === 'current' ? 'priority' : 'current';
    const rows = mods.rv.checkRows(rotFor(selected), rotFor(base));
    return mods.rr.checkHtml(rows, { baseLabel: selected === 'current' ? 'my pick' : 'keeping going' });
  }

  /** The one money line; until Manami's words for it are in, the plain numbers. */
  function moneyPart() {
    const said = mods.rv.moneyLine(cmp, selected, mixScore, choice);
    if (said) return `<p class="rot-money__line">${esc(said)}</p>`;
    const [cash, bad] = mods.cf.tiles(cmp, selected, mixScore, choice);
    if (cash.value == null) return '<p class="rot-money__line">Working out what your plan earns…</p>';
    return `<p class="rot-money__line">About ${esc(money(cash.value))} over 3 seasons. In a bad year, 1 in 10, about ${esc(money(bad.value))}.</p>`;
  }

  /** Money detail: the plans' four numbers, then the price of the pick and the nitrogen left. */
  function detailPart() {
    const { cf, fv } = mods;
    const kinds = ['current', 'maxProfit', 'priority', ...(isMixed() ? ['mix'] : [])];
    const cell = (v, f) => (v == null ? '…' : f(v));
    const rows = kinds.map((kind) => {
      const [cash, bad, soil, beats] = cf.tiles(cmp, kind, mixScore, choice);
      const on = kind === selected;
      return `<tr${on ? ' class="is-on"' : ''}><th scope="row">${esc(planName(kind))}${on ? '<span class="sr-only"> (on show)</span>' : ''}</th>`
        // (data-label: a phone shows each plan as a small card, its numbers labelled one by one)
        + `<td data-label="Cash margin, 3 seasons">${cell(cash.value, money)}</td><td data-label="In a bad year">${cell(bad.value, money)}</td><td data-label="Soil score in ${cmp.years[2]}">${cell(soil.value, (v) => `${v}/100`)}</td>`
        + `<td data-label="Beats keeping going">${kind === 'current' ? '–' : cell(beats.value, (v) => `${v}% of years`)}</td></tr>`;
    }).join('');
    const lines = [fv.priceLine(cmp.price), fv.vsProfitLine(cmp), fv.nCarriedLine(cmp, selected, mixScore, choice)].filter(Boolean);
    return `<div class="rot-money__wrap"><table class="rot-money__table"><caption class="sr-only">Money for each plan, over 3 seasons</caption>
      <thead><tr><th scope="col">Plan</th><th scope="col">Cash margin, 3 seasons</th><th scope="col">In a bad year (1 in 10)</th><th scope="col">Soil score in ${cmp.years[2]}</th><th scope="col">Beats keeping going</th></tr></thead>
      <tbody>${rows}</tbody></table></div>${lines.map((l) => `<p class="rot-money__note">${esc(l)}</p>`).join('')}`;
  }

  /** Watch out: the plan on show's warnings, grouped by field. */
  function watchPart() {
    const rows = mods.fv.watchRows(cmp, selected, choice);
    const head = `<p class="plans__src">On ${esc(planName(selected))}.</p>`;
    if (!rows.length) return `${head}<p class="plans__none">Nothing to watch on this plan.</p>`;
    // (in the ribbon's order, so a field is found where it was seen)
    const order = mods.rs.orderFields(cmp);
    const fields = [...cmp.fields].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const groups = fields.map((f) => [f, rows.filter((r) => r.id === f.id)]).filter(([, rs]) => rs.length);
    return head + groups.map(([f, rs]) => `<h4 class="rot-watch__h">${esc(f.name)}</h4><ul class="plans__list plans__list--risk">${rs.map((r) => `<li>${esc(r.text.startsWith(`${f.name} · `) ? r.text.slice(f.name.length + 3) : r.text)}</li>`).join('')}</ul>`).join('');
  }

  const list = (items, cls) => (items.length ? `<ul class="plans__list ${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="plans__none">Nothing to note.</p>');

  function renderRotation() {
    fixSelected();
    const { fv, rv, cf, rr } = mods;
    const said = rv.headline(cmp) || 'Here’s what each field grows over the next three seasons.';
    const gaps = fv.gapLines(cmp);
    const fieldGaps = cmp.fields.flatMap((f) => (gaps.byField[f.id] || []).map((g) => `${f.name}: ${g}`));
    const calGaps = mods.cc.gapsFor ? mods.cc.gapsFor(mods.cc.placeOf(data.farm)) : rr.calendarGaps();
    const known = [fv.weatherLine(cmp.weather), ...gaps.farm, ...fieldGaps, ...calGaps];
    const raw = cf.fineprint(cmp, 'priority', mixScore, choice);
    const own = Object.entries(raw).filter(([, items]) => items.length)
      .map(([k, items]) => `<h4 class="rot-raw__h">${esc(k)}</h4>${list(items, 'plans__list--raw')}`).join('');
    const why = [fv.weightsLine(cmp.weights), fv.nLine(cmp, 'priority', choice)].filter(Boolean);

    body.innerHTML = `${tabs()}<div class="plans__rot" role="tabpanel" id="plansView" aria-labelledby="plansTab-rotation">
      <div class="plans__manami"><img src="${MANAMI_SVG}" alt="" width="40" height="36"><p>${esc(said)}</p>${host('farm', 'span', 'plans__farmhost')}</div>
      ${aiTake ? '<section class="plans__take" hidden></section>' : ''}
      ${host('switch')}
      ${host('ribbon')}
      ${host('check')}
      <section class="rot-money" aria-labelledby="rotMoneyH"><h3 class="plans__h" id="rotMoneyH">Money</h3>${host('money')}
        <details class="plans__more rot-money__detail"><summary>Money detail</summary>${host('detail')}</details></section>

      <details class="plans__more"><summary>Why my pick</summary>${why.map((l) => `<p class="rot-why">${esc(l)}</p>`).join('')}</details>
      <details class="plans__more"><summary>Watch out</summary>${host('watch')}</details>
      <details class="plans__more"><summary>Good to know</summary>${list(known.filter(Boolean), 'plans__list--gap')}
        <p class="plans__src"><button class="linkish" type="button" data-go="calendar">Where the sowing dates come from</button></p></details>
      <details class="plans__more"><summary>The planner’s own words</summary><div class="rot-raw">${own || '<p class="plans__none">Nothing to note.</p>'}</div></details>
      <div class="plans__mix plans__mix--sticky" aria-live="polite"><span id="plansMix">${mixLine()}</span>
        <button class="btn btn--primary btn--small" type="button" data-act="save">Use this plan</button></div></div>`;
    // Manami's take (AI, server/ai/advice.js): saved as source 'ai'; hidden when the server has no 'plan' route
    aiTake?.mount(body.querySelector('.plans__take'), {
      data,
      save: (plan) => { close({ restoreFocus: false }); onSave?.(plan, { source: 'ai', startYear: firstSeason(today()) }); },
    });
    scoreMix();
  }

  /** The focusable a redraw should hand focus back to, as a selector (null: not in a redrawn part). */
  function focusSelector(a) {
    if (!a?.closest || !body.contains(a)) return null;
    if (a.closest('.rib-switch__seg')) return `.rib-switch__seg[data-kind="${attrSel(a.closest('.rib-switch__seg').dataset.kind)}"]`;
    const cell = a.closest('.plan-cell');
    if (cell) return `.plan-cell[data-field="${attrSel(cell.dataset.field)}"][data-kind="${attrSel(cell.dataset.kind)}"]`;
    const row = a.closest('.rib__open');
    if (row) return `.rib__open[data-field="${attrSel(row.dataset.field)}"]`;
    if (a.closest('.plans__farm')) return '.plans__farm';
    return null;
  }

  /** Redraws the parts that follow the plan on show (all of them, or the ones named), keeping focus. */
  function refreshShown(parts = Object.keys(PARTS)) {
    if (view !== 'rotation' || !mods || !cmp) return;
    // new plans came in since this was drawn (the island asked for them, say): the parts on show
    // belong to the old ones, so it all redraws (now if it's open, else on the next open)
    if (cmpData !== data) { if (!root.hidden) render(); return; }
    fixSelected();
    const sel = focusSelector(document.activeElement);
    for (const part of parts) {
      const el = body.querySelector(`.rot-host--${part}`);
      if (el) el.innerHTML = PARTS[part]();
    }
    if (sel) body.querySelector(sel)?.focus({ preventScroll: true });
  }

  /** The switch picked another plan to show. */
  function select(kind) {
    if (!kind || kind === selected) return;
    selected = kind;
    refreshShown();
  }

  // ---- "When to sow" ----

  function renderCalendar() {
    const rot = rotFor(selected);
    const place = mods.cc.placeOf(data.farm);
    const inner = mods.cv.calendarTabHtml({ rot, cmp, place, season: calSeason }) || '<p class="plans__none">I don’t have the sowing dates ready yet.</p>';
    // the dates follow the plan on show on Your rotation, so say which one it is
    const forPlan = `<p class="plans__calfor">Dates for <b>${esc(mods.rr.PLAN_NAME[selected] || 'Manami’s pick')}</b>. Change the plan on Your rotation.</p>`;
    body.innerHTML = `${tabs()}<div class="plans__cal" role="tabpanel" id="plansView" aria-labelledby="plansTab-calendar">${forPlan}${inner}</div>`;
    const el = body.querySelector('.plans__cal');
    if (!el) return;
    disposeView = mods.cv.wireCalendarTab(el, {
      onSeason: (s) => {
        if (s === calSeason) return;
        calSeason = s;
        render();
        body.querySelector('.plans__cal [role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
      },
    });
  }

  /** "Your plan: Manami's pick on every field" or "Your plan: a mix of plans" with its score once worked out. */
  function mixLine(score) {
    const kinds = new Set(Object.values(choice));
    const what = kinds.size === 1 ? `${PLANS.find((p) => p.kind === [...kinds][0]).name} on every field` : 'a mix of plans';
    return `Your plan: <b>${esc(what)}</b>${score ? `, about <b>${money(score.expectedGM)}</b> over 3 seasons` : ''}.`;
  }

  async function scoreMix() {
    const id = ++mixRun; // any older score still on its way is ignored
    const kinds = new Set(Object.values(choice));
    const mixEl = () => document.getElementById('plansMix');
    if (kinds.size === 1) { mixEl() && (mixEl().innerHTML = mixLine(planOf([...kinds][0]))); return; }
    if (!evaluateMix) return;
    try {
      const score = await evaluateMix(mixedPlan());
      if (id !== mixRun) return;
      mixScore = score;
      if (mixEl()) mixEl().innerHTML = mixLine(score);
      // the mix's numbers on show: its money line, its check (the soil at the end) and its detail row
      refreshShown(selected === 'mix' ? ['check', 'money', 'detail'] : ['detail']);
    } catch { /* keep the line without a number */ }
  }

  /**
   * A field picked in the field list while the plans are open: its row on "Your rotation", brought
   * into view and lit for a moment (the list stays live beside the plans for this).
   */
  function showField(id) {
    if (root.hidden || !id) return;
    if (view !== 'rotation') { view = 'rotation'; render(); }
    const row = body.querySelector(`.rib__row[data-field="${attrSel(id)}"]`);
    if (!row) return;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    row.classList.remove('is-lit');
    void row.offsetWidth; // (so the light plays again on a second pick)
    row.classList.add('is-lit');
    row.querySelector('.rib__open')?.focus({ preventScroll: true });
  }

  /** Switches tab (and focuses the new one). */
  function goTo(v) {
    if (!v) return;
    if (view !== v) { view = v; render(); }
    body.querySelector(`.plans__tab[data-view="${v}"]`)?.focus();
  }

  body.addEventListener('keydown', (e) => {
    const t = e.target.closest?.('.plans__tab');
    if (!t) return;
    const v = nextTab(view, e.key);
    if (!v) return;
    e.preventDefault();
    goTo(v);
  });

  /** Manami's answer to a pick, in the story's live line. */
  function sayPicked(id) {
    const f = cmp?.fields.find((x) => x.id === id);
    const el = body.querySelector(`[id="picked-${attrSel(id)}"]`);
    if (!f || !el || !mods) return;
    el.textContent = '';
    // (a moment later, so a story drawn again just now is in the reading tree before it speaks)
    setTimeout(() => { el.textContent = mods.fv.pickedLine(f.name, choice[id]); }, 60);
  }

  body.addEventListener('click', (e) => {
    const tab = e.target.closest('.plans__tab');
    if (tab) { goTo(tab.dataset.view); return; }
    if (e.target.closest('.plans__build')) return; // the builder handles its own buttons
    const go = e.target.closest('[data-go]');
    if (go) { goTo(go.dataset.go); return; }
    const cell = e.target.closest('.plan-cell');
    if (cell) {
      const id = cell.dataset.field;
      choice[id] = cell.dataset.kind;
      mixScore = null;
      syncCells(id);
      afterChoice();
      sayPicked(id);
      scoreMix();
      return;
    }
    // (the plans on show go to the island as they are, unless new ones are still being worked out)
    const handOff = () => { handoff = body.classList.contains('is-busy') ? null : data; };
    if (e.target.closest('[data-act="futures"]')) {
      handOff();
      close({ restoreFocus: false });
      onFutures?.('priority', { reel: true });
      return;
    }
    const show = e.target.closest('[data-show]');
    if (show && onFutures) {
      // the island opens on that plan (or on the farmer's own mix), without the walk
      handOff();
      close({ restoreFocus: false });
      onFutures(show.dataset.show, { reel: false });
      return;
    }
    if (show) {
      const kind = show.dataset.show;
      const plan = kind === 'mix' ? mixedPlan() : planOf(kind).plan;
      const name = kind === 'mix' ? 'Your plan' : PLANS.find((p) => p.kind === kind).name;
      close({ restoreFocus: false });
      onPreview?.({ label: name, plan, startYear: firstSeason(today()), keysByYear: [0, 1, 2].map((i) => new Map(Object.entries(plan.sequences).map(([id, s]) => [id, APP_CROP[s[i].main] || 'other']))) });
      return;
    }
    if (e.target.closest('[data-act="save"]')) {
      const plan = mixedPlan();
      close({ restoreFocus: false }); // first, so Manami isn't inert when she confirms
      onSave?.(plan, { choice: { ...choice }, startYear: firstSeason(today()) });
    }
  });

  /** Opens on "Build your own" (back from planning on the island). */
  function openBuild() {
    view = 'build';
    return open();
  }

  /** Saves a plan picked elsewhere (the plans on the island), the same way "Use this plan" does. */
  const saveChosen = (plan, info) => onSave?.(plan, info);

  return { open, openBuild, close, saveBuilt, saveChosen, ensureData, getChoice, setChoice, showField, get isOpen() { return !root.hidden; }, get data() { return data; } };
}
