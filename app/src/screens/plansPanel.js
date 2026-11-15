// "Plan my next seasons": the rotation planner's three plans side by side (roadmap 4.3, 4.4).
//
//   Keep going     the current rotation, continued
//   Most profit    the most cash over the 3 seasons
//   Manami's pick  the best fit for the farmer's priorities (from the check-in)
//
// For each: the 3-season cash margin, a bad year (1 in 10), soil health, and how often it beats
// keeping going; every field's crops for the 3 seasons; the reasons, risks and gaps. Pick a plan per
// field (the mix is scored too) and save it. "See them on the farm" (and each plan's "Show on the
// island") opens the plans on the island itself (src/screens/planFutures.js).
//
//   const panel = createPlansPanel({ planSeasons, evaluateMix, onPreview, onFutures, onSave, onOpen, onClose })
//   panel.open()   panel.close()   panel.ensureData()   panel.getChoice()   panel.setChoice(map)
import { cropIcon } from '../ui/cropIcons.js';
import { APP_CROP } from '../plan/farmInput.js';
import { createPlanBuilder } from './planBuilder.js';
import { money } from '../ui/money.js';
import { PLANS, CROP_NAME } from '../plan/planNames.js';

// (money lives in src/ui/money.js now; it is still exported from here for older callers)
export { money } from '../ui/money.js';

// a little barn, for "See them on the farm"
const FARM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 20V10.2L12 4l8.5 6.2V20z" fill="currentColor" fill-opacity=".2"/><path d="M9 20v-5.5h6V20M9 14.5l6 5.5M15 14.5L9 20M10 10h4"/></svg>';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The first season the plans start with: next year's once this year's harvest is in (from August). */
export function firstSeason(today = new Date()) {
  return today.getMonth() >= 7 ? today.getFullYear() + 1 : today.getFullYear();
}

/**
 * Manami's line over the cards (HTML): what her pick earns over keeping going, or that the rotation
 * already fits, with what her pick costs when it earns less. gain: pick minus keeping going, 3 seasons.
 */
export function pickNote(gain, beats) {
  if (gain > 1) return `My pick earns about <b>${money(gain)}</b> more than keeping going over 3 seasons, and comes out ahead in <b>${beats}%</b> of the weather years I tried.`;
  if (gain < -1) return `My pick earns about <b>${money(-gain)}</b> less than keeping going over 3 seasons, in return for what you told me matters most.`;
  return 'Your rotation is already a good fit. My pick changes little.';
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
export function createPlansPanel({ planSeasons, evaluateMix, onPreview, onFutures, onSave, onIsland, onOpen, onClose, today = () => new Date(), getSaved = () => null }) {
  const root = document.getElementById('plans');
  const body = document.getElementById('plansBody');
  const title = document.getElementById('plansTitle');
  document.getElementById('plansClose').addEventListener('click', () => close());
  let data = null; // { result, gaps, weather, farm }
  let choice = {}; // field id -> plan kind
  let run = 0;
  let mixRun = 0;
  let view = 'compare'; // 'compare' the three plans | 'build' your own (drag and drop)
  let handoff = null; // the plans on show, handed straight to the island by "See them on the farm" / "Show on the island"

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
    if (e.key === 'Escape' && !root.hidden && !e.target.closest?.('input, textarea')) { e.preventDefault(); e.stopPropagation(); close(); }
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
    pending.finally(() => { settled = true; });
    await Promise.resolve();
    if (data && !settled) setBusy(true);
    try {
      const fresh = await pending;
      if (id !== run || root.hidden) return;
      adopt(fresh);
      setBusy(false);
      render();
    } catch (e) {
      if (id !== run) return;
      body.innerHTML = `<p class="plans__error">I couldn’t work out the plans this time (${esc(e.message)}). Try again in a moment.</p>`;
    }
  }

  /** New plans become the ones on show (the same ones again change nothing). */
  function adopt(fresh) {
    if (data?.result === fresh.result) return;
    // keep the picks for fields that are still there; new fields start on Manami's pick
    choice = Object.fromEntries(fresh.result.plans.priority.paddocks.map((p) => [p.paddockId, choice[p.paddockId] && fresh.result.plans[choice[p.paddockId]] ? choice[p.paddockId] : 'priority']));
    data = fresh;
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

  /** The picks made elsewhere (the plans on the island): the table's radios and the mix follow. */
  function setChoice(map) {
    choice = { ...choice, ...map };
    const cells = body.querySelectorAll('.plan-cell');
    if (!cells.length) return;
    for (const b of cells) {
      const on = (choice[b.dataset.field] || 'priority') === b.dataset.kind;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
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

  function seqCell(slots, years) {
    return slots.map((s, i) => {
      const key = APP_CROP[s.main] || 'other';
      const name = CROP_NAME[s.main] || s.main;
      const cover = s.cover ? ` + ${CROP_NAME[s.cover] || s.cover} cover` : '';
      return `<span class="plan-crop" title="${years[i]}: ${esc(name + cover)}">${cropIcon(key)}${s.cover ? '<span class="plan-crop__cover" aria-hidden="true"></span>' : ''}<span class="sr-only">${years[i]}: ${esc(name + cover)}</span></span>`;
    }).join('');
  }

  function tabs() {
    const tab = (v, label) => `<button type="button" role="tab" class="plans__tab" id="plansTab-${v}" aria-controls="plansView" data-view="${v}" aria-selected="${view === v}" tabindex="${view === v ? 0 : -1}">${label}</button>`;
    return `<div class="plans__tabs" role="tablist" aria-label="Plans">${tab('compare', 'Compare plans')}${tab('build', 'Build your own')}</div>`;
  }

  function render() {
    if (view === 'build') {
      body.innerHTML = `${tabs()}<div class="plans__build" role="tabpanel" id="plansView" aria-labelledby="plansTab-build"></div>`;
      const y0 = firstSeason(today());
      builder.mount(body.querySelector('.plans__build'), {
        farm: data.farm,
        market: data.market,
        years: [y0, y0 + 1, y0 + 2],
        exclusions: data.result.exclusions,
        saved: getSaved(),
        startPlans: { priority: planOf('priority').plan, current: planOf('current').plan, priorityResult: planOf('priority') },
      });
      return;
    }
    const { result } = data;
    const y0 = firstSeason(today());
    const years = [y0, y0 + 1, y0 + 2];
    const cur = planOf('current'), pick = planOf('priority');
    const gain = pick.expectedGM - cur.expectedGM;
    const beats = Math.round((pick.probBeatsCurrent ?? 0) * 100);
    const manami = pickNote(gain, beats);
    const farmBtn = onFutures ? `<button class="btn btn--primary btn--small plans__farm" type="button" data-act="futures">${FARM_ICON}See them on the farm</button>` : '';

    const cards = PLANS.map(({ kind, name, blurb }) => {
      const p = planOf(kind);
      const soil = Math.round((p.endSoilHealth ?? p.soilHealth) * 100);
      return `<section class="plan-card plan-card--${kind}" aria-labelledby="plan-${kind}">
        <h3 id="plan-${kind}">${esc(name)}${kind === 'priority' ? '<span class="plan-card__badge">Recommended</span>' : ''}</h3>
        <p class="plan-card__blurb">${esc(blurb)}</p>
        <dl class="plan-card__nums">
          <div><dt>Cash margin, 3 seasons</dt><dd class="plan-card__big">${money(p.expectedGM)}</dd></div>
          <div><dt>In a bad year (1 in 10)</dt><dd>${money(p.p10GM)}</dd></div>
          <div><dt>Soil health at the end</dt><dd><span class="meter" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, soil))}%"></span></span>${soil}/100</dd></div>
          ${kind === 'current' ? '<div><dt>Beats keeping going</dt><dd>–</dd></div>' : `<div><dt>Beats keeping going</dt><dd>${Math.round((p.probBeatsCurrent ?? 0) * 100)}% of years</dd></div>`}
        </dl>
        <button class="btn btn--quiet btn--small plan-card__show" type="button" data-show="${kind}">Show on the island</button>
      </section>`;
    }).join('');

    const rows = pick.paddocks.map((pd) => {
      const cells = PLANS.map(({ kind, name }) => {
        const p = planOf(kind).paddocks.find((x) => x.paddockId === pd.paddockId);
        const on = (choice[pd.paddockId] || 'priority') === kind;
        return `<td><button type="button" class="plan-cell${on ? ' is-on' : ''}" role="radio" aria-checked="${on}" data-field="${esc(pd.paddockId)}" data-kind="${kind}"
          aria-label="${esc(pd.name)}: ${esc(name)}, ${esc(p.sequence.map((c) => CROP_NAME[c] || c).join(', '))}">${seqCell(planOf(kind).plan.sequences[pd.paddockId], years)}</button></td>`;
      }).join('');
      return `<tr><th scope="row"><span class="plan-field__name">${esc(pd.name)}</span><span class="plan-field__acres">${Math.round(pd.acres)} ac</span></th>${cells}</tr>`;
    }).join('');

    const list = (items, cls) => items.length ? `<ul class="plans__list ${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="plans__none">Nothing to note.</p>';
    const gaps = [...new Set([...data.gaps, ...(pick.informationGaps || []), ...(pick.localReview || [])])];

    body.innerHTML = `${tabs()}<div role="tabpanel" id="plansView" aria-labelledby="plansTab-compare">
      <div class="plans__manami"><img src="/manami.svg" alt="" width="40" height="36"><p>${manami}</p>${farmBtn}</div>
      <div class="plans__cards">${cards}</div>
      <p class="plans__price">${esc(result.priceOfPriorities.summary)}</p>

      <h3 class="plans__h">Field by field <span class="plans__sub">${years.join(' · ')}. Pick a plan for each field.</span></h3>
      <div class="plans__tablewrap">
        <table class="plans__table">
          <thead><tr><th scope="col">Field</th>${PLANS.map((p) => `<th scope="col">${esc(p.name)}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="plans__mix" aria-live="polite"><span id="plansMix">${mixLine()}</span>
        <button class="btn btn--primary btn--small" type="button" data-act="save">Use this plan</button></div>

      <details class="plans__more" open><summary>Why Manami picked this</summary>${list(pick.reasons || [], 'plans__list--why')}</details>
      <details class="plans__more"><summary>Watch out for</summary>${list(pick.risks || [], 'plans__list--risk')}</details>
      <details class="plans__more"><summary>Good to know</summary>
        <p class="plans__src">Weather: ${esc(data.weather.source)}, ${data.weather.years} growing seasons.</p>${list(gaps, 'plans__list--gap')}</details></div>`;
    scoreMix();
  }

  /** "Your mix: Manami's pick on every field" or "Your mix: ..." with its score once worked out. */
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
      if (id === mixRun && mixEl()) mixEl().innerHTML = mixLine(score);
    } catch { /* keep the line without a number */ }
  }

  body.addEventListener('keydown', (e) => {
    const t = e.target.closest?.('.plans__tab');
    if (!t || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    view = view === 'compare' ? 'build' : 'compare';
    render();
    body.querySelector(`.plans__tab[data-view="${view}"]`)?.focus();
  });

  body.addEventListener('click', (e) => {
    const tab = e.target.closest('.plans__tab');
    if (tab) {
      if (view !== tab.dataset.view) { view = tab.dataset.view; render(); body.querySelector(`.plans__tab[data-view="${view}"]`)?.focus(); }
      return;
    }
    if (e.target.closest('.plans__build')) return; // the builder handles its own buttons
    const cell = e.target.closest('.plan-cell');
    if (cell) {
      choice[cell.dataset.field] = cell.dataset.kind;
      body.querySelectorAll(`.plan-cell[data-field="${CSS.escape(cell.dataset.field)}"]`).forEach((b) => {
        const on = b.dataset.kind === cell.dataset.kind;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      });
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
      // the island opens on that plan, without the walk
      handOff();
      close({ restoreFocus: false });
      onFutures(show.dataset.show, { reel: false });
      return;
    }
    if (show) {
      const plan = planOf(show.dataset.show).plan;
      const name = PLANS.find((p) => p.kind === show.dataset.show).name;
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

  return { open, openBuild, close, saveBuilt, saveChosen, ensureData, getChoice, setChoice, get isOpen() { return !root.hidden; }, get data() { return data; } };
}
