// "See them on the farm": the island flips between the three plans (and the farmer's own pick per
// field), one season at a time, so the farmer sees what each plan does to each field.
//
//   dock      along the bottom: the plan (Keep going, Most profit, Manami's pick, Your plan), the
//             season (2027, 2028, 2029, with the farm's cash in each), 4 score tiles, what a coin is
//             worth, and Fields, Why and watch out, Back to the plans, Use …
//   island    the plan's crops for the season; fields that change get green outlines and grow back in;
//             a coin stack over each field is its 3-season cash (bright gold: more than keeping going);
//             a chip over each field says the money and has a dot for anything to watch, and a
//             snowflake where a spring freeze can hurt the wheat (the walk's frost stop and the card's
//             peek outline those fields ice blue, under a light rime: src/plan/futureMarks.js)
//   Manami    walks a short reel of lines first (skippable at any stop), then the farmer looks round
//   card      a field's whole story, and the place to pick its plan (the mix is scored like the panel's)
//   notes     "Why and watch out": her reasons, the risks, the gaps, and the planner's own words
//
// The camera keeps to the tour limits for the whole mode (src/island/cameraSafety.js): never lower
// than 0.95 from straight down, and far enough back to stay above everything solid on the island.
// Loaded on demand (main.js imports it the first time it's needed), so it is its own chunk.
//
//   const futures = createPlanFutures({ hub, timeTravel, manami, getData, getChoice, setChoice, evaluateMix, onSave, onBack, ... })
//   futures.start('priority', { reel: true, view, startYear })   futures.stop()   futures.insets()
//   futures.start(kind, { reel: false, view, startYear, card: fieldId, said })   opens that field's card once
//                                       in, with Manami's line `said` in it
import * as THREE from 'three';
import {
  KINDS, kindFor, mixedPlan, compareFutures, fieldOf, viewField, seasonChanges, seasonCashFor, coinPlan,
  tiles as tileValues, sameCrops, uniformKind, gainField, reelStops, fineprint, frostIds, dryIds,
  waterWorry,
} from '../plan/compareFutures.js';
import { marksFor } from '../plan/futureMarks.js';
import { frostNumbers } from '../plan/weatherWords.js';
import * as voice from '../plan/futuresVoice.js';
import { SEVERITY_LABEL, LENS_LABEL } from '../plan/builder.js';
import { PLANS, CROP_NAME } from '../plan/planNames.js';
import { PLAN_ICONS, TILE_ICONS, LENS_ICONS, ACTION_ICONS, cropIconFor } from '../ui/futureIcons.js';
import { SEASON_ICONS } from '../ui/season.js';
import { money, moneyAbout, perAcre } from '../ui/money.js';
import { createCoinStacks, sailSpheres, themeKeepOuts } from '../island/coinStacks.js';
import { TOUR, tourFloor, entryRise, riseIsClear, poseIsClear, overviewPose, fieldPose } from '../island/cameraSafety.js';
import { solidTop } from '../island/cameraRig.js';
import { propTop } from '../island/clearance.js';
import { stackBase, MAX_COINS, COIN_PITCH, DROP_ROOM } from '../island/stackSpots.js';
import { SHEET_QUERY } from './hub.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The four views of the farm, in the order the dock shows them. */
export const VIEWS = ['current', 'maxProfit', 'priority', 'mix'];
const NAME = { ...Object.fromEntries(PLANS.map((p) => [p.kind, p.name])), mix: 'Your plan' };
const BLURB = { ...Object.fromEntries(PLANS.map((p) => [p.kind, p.blurb])), mix: 'Your pick of plan for each field' };
const TILE_LABEL = { cash: 'Cash margin, 3 seasons', badYear: 'In a bad year (1 in 10)', soil: 'Soil health at the end', beats: 'Beats keeping going' };
const CHIP_LIFT = 0.30; // a chip floats this far over its coins
const NO_STACK_LIFT = 1.3; // and over the soil where a field has no stack
const ENTRY_RISE = 0.35; // the camera's first move (it only rises)
const COINS_AFTER_MS = 800; // the festival's things have popped in by then
// little screens: Manami tucks away to her face after each line while the farmer looks round
const COMPACT_QUERY = '(max-height: 520px), (max-width: 1000px)';
const PHONE_QUERY = '(max-width: 640px)';

// ---------------------------------------------------------------- pure helpers (tested)

/** The island's crop key for each field in each season of a view: [Map id -> key] x 3 (timeTravel.preview). */
export function keysFor(cmp, view, choice) {
  return [0, 1, 2].map((y) => new Map(cmp.fields.map((f) => [f.id, f.byKind[view === 'mix' ? kindFor(choice, f.id) : view].seq[y].key])));
}

/** What each field grows in a season of a view, as one word each ("corn|cereal-rye"): Map id -> cell. */
export function cellsFor(cmp, view, season, choice) {
  return new Map(cmp.fields.map((f) => {
    const s = f.byKind[view === 'mix' ? kindFor(choice, f.id) : view].seasons[season];
    return [f.id, `${s.crop}|${s.cover || ''}`];
  }));
}

/** The fields whose crops differ between two cell maps, west to east (`xOf` gives a field's x). */
export function changedIds(before, after, xOf = () => 0) {
  return [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)).sort((a, b) => xOf(a) - xOf(b));
}

/** Whether two screen boxes {x, y, w, h} overlap (with `gap` px of air). */
export const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/**
 * Which chips show when some overlap: changed fields first, then the bigger money difference; a
 * chip that would overlap one already shown hides. items: [{ id, box, changed, weight }] -> Set of ids.
 */
export function declutter(items, gap = 4) {
  const order = [...items].sort((a, b) => (Number(b.changed) - Number(a.changed)) || (b.weight - a.weight));
  const kept = [];
  for (const it of order) if (!kept.some((k) => overlaps(k.box, it.box, gap))) kept.push(it);
  return new Set(kept.map((k) => k.id));
}

/** The first of these that's on screen to take focus (a hidden one can't), or null. */
export function focusHome(els) {
  return els.find((el) => el && !el.disabled && el.getClientRects().length > 0) || null;
}

/**
 * A chip's inside: the crop, the field's 3-season cash, its difference from keeping going (when
 * showDiff), a snowflake when this season's wheat has a spring freeze, a drop when the field runs
 * short of water where water is the weather worry (dry), and the warning dot. s is the season shown.
 */
export function chipHtml({ s, total, diff, showDiff = false, dry = false }) {
  return `<span class="fut-chip__crop plan-crop">${cropIconFor(s.crop, s.cover)}</span>`
    + `<span class="fut-chip__cash">${esc(moneyAbout(total))}</span>`
    + (showDiff ? `<span class="fut-chip__diff ${diff >= 0 ? 'is-up' : 'is-down'}">${esc(diff >= 0 ? '+' : '−')}${esc(moneyAbout(Math.abs(diff)))}</span>` : '')
    + (s.freeze ? `<span class="fut-chip__frost" aria-hidden="true">${LENS_ICONS.frost}</span>` : '')
    + (dry ? `<span class="fut-chip__dry" aria-hidden="true">${LENS_ICONS.water}</span>` : '')
    + (s.worst ? `<span class="fut-chip__dot sev-${s.worst}"></span>` : '');
}

/** A season radio's year line: the season icon, the year, and a snowflake (hidden unless `frost`; paintDock flips it). */
export function seasonYearHtml(year, frost = false) {
  return `<span class="fut-season__year">${SEASON_ICONS.summer}${esc(year)}<span class="fut-season__frost" aria-hidden="true"${frost ? '' : ' hidden'}>${LENS_ICONS.frost}</span></span>`;
}

/** The years in a plan's seasons whose wheat has a spring freeze, for its row's label: " Spring freeze risk on the wheat in 2028." */
export function frostRowWords(seasons, years) {
  const ys = seasons.map((s, y) => (s.freeze ? years[y] : null)).filter((y) => y != null);
  if (!ys.length) return '';
  const list = ys.length > 1 ? `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}` : String(ys[0]);
  return ` Spring freeze risk on the wheat in ${list}.`;
}

/**
 * The years in a plan's seasons that leave the field short of water (1 in or more), where water is
 * the weather worry (dry), for its row's label: " Short of water in 2027." ('' otherwise).
 */
export function dryRowWords(seasons, years, dry = false) {
  if (!dry) return '';
  const ys = seasons.map((s, y) => ((s.waterShort ?? 0) >= 1 ? years[y] : null)).filter((y) => y != null);
  if (!ys.length) return '';
  const list = ys.length > 1 ? `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}` : String(ys[0]);
  return ` Short of water in ${list}.`;
}

/** "+$25k" / "−$2k" (a money difference with its sign). */
const signed = (d) => `${d >= 0 ? '+' : '−'}${money(Math.abs(d))}`;
/** "$25k more than keeping going", for screen readers. */
const diffWords = (d) => (Math.abs(d) < 500 ? 'about the same as keeping going' : `${money(Math.abs(d))} ${d > 0 ? 'more' : 'less'} than keeping going`);
const cropName = (id) => CROP_NAME[id] || id;
const cellName = (s) => `${cropName(s.crop)}${s.cover ? ` + ${cropName(s.cover)} cover` : ''}`;

// ---------------------------------------------------------------- the mode

/**
 * @param {object} o
 * @param {object} o.hub          the hub (src/screens/hub.js): its session, setPlanMode, overview
 * @param {object} o.timeTravel   preview, prebuild, select
 * @param {object} o.manami
 * @param {() => Promise<object>} o.getData          the plans (plansPanel.ensureData)
 * @param {() => object|null} [o.getCurrentData]     the plans as the panel has them now (to notice a change)
 * @param {() => object} [o.getChoice]               the panel's pick per field; [o.setChoice] writes it back
 * @param {(plan: object) => Promise<object>} [o.evaluateMix]   scores a mixed plan
 * @param {() => void} [o.onStart]   [o.onStop]
 * @param {(plan: object, info: object) => void} [o.onSave]
 * @param {() => void} [o.onBack]   back to the plans panel;  [o.onBuild] its "Build your own"
 * @param {(fieldId: string) => void} [o.onJar]   the card's "Test this field’s soil with a jar"
 * @param {(fieldId: string) => boolean} [o.hasJar]   the field has a jar test in use (no such link then)
 */
export function createPlanFutures({ hub, timeTravel, manami, getData, getCurrentData = () => null, getChoice = () => ({}), setChoice, evaluateMix, onStart, onStop, onSave, onBack, onBuild, onJar = null, hasJar = () => false }) {
  const $ = (id) => document.getElementById(id);
  const dock = $('futDock');
  const titleEl = $('futTitle');
  const plansEl = $('futPlans');
  const seasonsEl = $('futSeasons');
  const scoreEl = $('futScore');
  const moreBtn = $('futMore');
  const captionEl = $('futCaption');
  const mixEl = $('futMix');
  const fieldsBtn = $('futFields');
  const notesBtn = $('futNotesBtn');
  const backBtn = $('futBack');
  const saveBtn = $('futSave');
  const statusEl = $('futStatus');
  const card = $('futCard');
  const notes = $('futNotes');
  const chipsEl = $('futChips');
  const compact = matchMedia(COMPACT_QUERY);
  const sheetQ = matchMedia(SHEET_QUERY);
  const phoneQ = matchMedia(PHONE_QUERY);
  const reducedQ = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reducedQ.matches; // checked live

  let active = false;
  let run = 0; // a newer start (or a stop) makes an older one's late answers moot
  let isle = null; // the reveal's island view
  let startYear = 0;
  let lastStart = null; // { kind, opts } for "Try again" and "See them on the farm" again
  let data = null;
  let cmp = null;
  let coinsPlan = null;
  let gaps = null; // gapLines(cmp), once per start
  let view = 'priority';
  let season = 0;
  let choice = {};
  let mixScore = null;
  let mixRun = 0;
  let mixTimer = 0;
  let reel = null; // { stops, i } while Manami walks through
  let marksBase = 'current'; // what the change outlines are measured against (null: none)
  let focusId = null; // a field the walk (or the "start there" hint) lights gold
  let frostLens = false; // the frost fields outlined ice blue, with a rime on the farm (the walk's frost stop, the card's peek)
  let peek = false; // the lens is the card's "Show a spring freeze on the farm"
  let hintOn = false; // the hint's gold outline stays until the first tap
  let cardId = null;
  let cardOpener = null;
  let said = ''; // Manami's last pick line, also in the card (phones hide her while it's open)
  let notesOpen = false;
  let coins = null;
  let spotsPlaced = false;
  let coinsReady = false;
  let chips = [];
  let chipsDirty = true;
  let limits = null; // { maxPolar, floor } once the tour limits are on
  let pendingCam = null; // a camera move asked for before the limits went on
  let shown = new Map(); // id -> the cell the island shows now
  let offs = [];
  let timers = [];
  let statusTimer = 0;
  const v3 = new THREE.Vector3();
  const lastCam = new Float64Array(32);

  const session = () => hub.session;
  const hubField = (id) => session()?.fields.find((f) => f.id === id) || null;
  const xOf = (id) => hubField(id)?.center[0] ?? 0;
  const years = () => cmp.years;
  const kindOf = (id) => (view === 'mix' ? kindFor(choice, id) : view);
  const sayExplore = (line, o) => { manami.say(line, o); if (compact.matches && !o?.focus) manami.collapse(); };
  /** Where focus goes back to in the dock: its title, or (where the title is hidden) the plan on show. */
  const homeEl = () => focusHome([titleEl, plansEl.querySelector('[aria-checked="true"]'), seasonsEl.querySelector('[aria-checked="true"]'), fieldsBtn, moreBtn]) || titleEl;

  // ---------------------------------------------------------------- start and stop

  /**
   * Opens the mode on a view ('current' | 'maxProfit' | 'priority' | 'mix'). reel: Manami walks through
   * first (else the farmer looks round straight away). view is the island's (main.js app.island.view).
   */
  async function start(kind = 'priority', opts = {}) {
    const { reel: walk = true, view: v, startYear: y0 } = opts;
    if (active) stop();
    if (!v || !session()) return;
    const id = ++run;
    active = true;
    lastStart = { kind, opts };
    isle = v;
    startYear = y0;
    reset();
    onStart?.();
    // taps on the island wait while the plans are worked out (no field check-up opens under the dock)
    hub.setPlanMode({ onTap: () => {} });
    document.body.classList.add('plan-futures');
    dock.hidden = false;
    setDockH();
    // (a frame later: setDockH can resize what's observed, and in the same frame that's a loop)
    let roFrame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(roFrame);
      roFrame = requestAnimationFrame(() => {
        if (!active) return;
        setDockH();
        session()?.relayout();
        chipsDirty = true;
      });
    });
    ro.observe(dock);
    ro.observe(card);
    offs.push(() => { ro.disconnect(); cancelAnimationFrame(roFrame); });
    // Manami's bubble grows, shrinks and folds away with each line: the chips look again
    const manamiHost = document.getElementById('manami');
    let lastBottom = -1;
    const mo = manamiHost && new MutationObserver(() => {
      chipsDirty = true;
      // (on a phone the island is framed above her bubble: measure again when it moves a fair bit)
      const bottom = insets().bottom || 0;
      if (active && Math.abs(bottom - lastBottom) > 8) { lastBottom = bottom; session()?.relayout(); }
    });
    if (mo) {
      mo.observe(manamiHost, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true, characterData: true });
      offs.push(() => mo.disconnect());
    }
    addEventListener('keydown', onKey, true);
    offs.push(() => removeEventListener('keydown', onKey, true));

    // the plans: at once if they're worked out already, else the dock waits (greyed) and says so
    const had = !!getCurrentData();
    const pending = Promise.resolve().then(() => getData());
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    if (!settled && id === run) loading(had ? 'Updating your plans for the changes you made…' : 'Working out your plans from 24 years of NASA weather, your soil and your crop history…');
    let fresh;
    try {
      fresh = await pending;
    } catch (e) {
      if (id !== run || !active) return;
      loading('');
      manami.say(`I couldn’t work out the plans this time (${e?.message || 'no answer'}). Try again in a moment.`, {
        actions: [
          { label: 'Try again', primary: true, onClick: () => start(kind, opts) },
          { label: 'Back to the plans', onClick: () => back() },
        ],
        focus: true,
      });
      return;
    }
    if (id !== run || !active) return;
    try {
      begin(fresh, kind, walk);
      // (back from a jar test opened on a field's card: that card again)
      if (opts.card && fieldOf(cmp, opts.card)) {
        openCard(opts.card, { opener: fieldsBtn });
        // and Manami's word on it there (she steps aside while a card is open)
        if (opts.said) { said = String(opts.said); renderCard(); }
      }
    } catch (e) {
      // anything unexpected: leave cleanly rather than stranding the farmer in a half-built mode
      console.error('planFutures: could not start', e);
      stop();
      manami.say('I couldn’t show the plans on the farm this time. They’re all in “Plan my next seasons”.', {
        actions: [{ label: 'Back to the plans', primary: true, onClick: () => onBack?.() }],
        focus: true,
      });
    }
  }

  function reset() {
    data = cmp = coinsPlan = gaps = null;
    reel = null;
    marksBase = 'current';
    focusId = null;
    frostLens = peek = false;
    hintOn = false;
    cardId = cardOpener = null;
    said = '';
    notesOpen = false;
    mixScore = null;
    spotsPlaced = coinsReady = false;
    chips = [];
    limits = pendingCam = null;
    shown = new Map();
    lastCam.fill(NaN);
  }

  /** Everything once the plans are in: the dock, the island, the camera, then the walk or the look round. */
  function begin(fresh, kind, walk) {
    data = fresh;
    cmp = compareFutures(data, { startYear });
    coinsPlan = coinPlan(cmp);
    gaps = voice.gapLines(cmp);
    choice = Object.fromEntries(cmp.fields.map((f) => [f.id, kindFor(getChoice?.() || {}, f.id)]));
    view = VIEWS.includes(kind) ? kind : 'priority';
    season = 0;
    loading(null);
    buildDock();
    buildChips();
    hub.setPlanMode({ tipFor, onTap, get dragging() { return false; } });
    // every plan's crops, built while idle, so flipping is instant
    timeTravel.prebuild(KINDS.flatMap((k) => keysFor(cmp, k, choice)));
    coins = createCoinStacks(isle, { reduced });
    offs.push(isle.onFrame((dt) => coins?.step(dt)));
    offs.push((isle.onAfterFrame || isle.onFrame)(placeChips));
    timers.push(setTimeout(placeCoins, COINS_AFTER_MS));
    enterCamera();
    if (walk) startReel(0);
    else {
      paint({ grow: false });
      toExplore({ hint: true, focusTitle: true });
    }
    if (view === 'mix' && !uniformKind(cmp, choice)) scoreMix();
  }

  /** Leaves the mode and puts the hub back as it was. Safe to call any time, more than once. */
  function stop() {
    if (!active) return;
    active = false;
    run++;
    mixRun++;
    const hadFocus = [dock, card, notes].some((el) => el.contains(document.activeElement));
    const steps = [
      () => { clearTimeout(mixTimer); clearTimeout(statusTimer); timers.forEach(clearTimeout); timers = []; },
      // the key listener, the ResizeObserver, the frame hooks
      () => { const fns = offs; offs = []; fns.forEach((fn) => fn()); },
      () => { coins?.dispose(); coins = null; chipsEl.replaceChildren(); chips = []; },
      () => { session()?.setMarks(null); hub.setPlanMode(null); session()?.clearHover(); },
      () => { session()?.rig.setExtraLimits(null); if (isle?.controls) isle.controls.enabled = true; },
      () => timeTravel.select('now'),
      // her reel line and its buttons go with the mode (each way out says its own line after this)
      () => manami.hide(),
      () => {
        document.body.classList.remove('plan-futures', 'fut-card-open', 'fut-notes-open');
        dock.hidden = true;
        card.hidden = true;
        notes.hidden = true;
        dock.classList.remove('is-loading');
        setMore(false);
        statusEl.textContent = '';
        card.replaceChildren();
        notes.replaceChildren();
      },
    ];
    try {
      for (const fn of steps) {
        try { fn(); } catch (e) { console.error('planFutures: stopping', e); }
      }
    } finally {
      reset();
      isle = null;
      try { onStop?.(); } catch (e) { console.error(e); }
      try { hub.overview(); } catch (e) { console.error(e); }
      // focus was in the dock, card or notes, which just hid: somewhere sensible (each way out may move it on)
      if (hadFocus) $('hubPlan')?.focus({ preventScroll: true });
    }
  }

  /** Back to the plans panel (Back, Esc, "See it all as a table"). */
  function back() {
    stop();
    onBack?.();
  }

  /** The close X: back to today on the hub. */
  function leave() {
    stop();
    $('hubPlan')?.focus({ preventScroll: true });
    manami.say('Back to today. Your plans are here under “Plan my next seasons”.');
  }

  /** [Use …]: saves the view (a whole plan sets every field to it), then leaves. */
  function save() {
    if (!checkData()) return;
    if (view !== 'mix') choice = Object.fromEntries(cmp.fields.map((f) => [f.id, view]));
    setChoice?.({ ...choice });
    const plan = mixedPlan(data.result.plans, choice);
    const info = { choice: { ...choice }, startYear };
    stop();
    onSave?.(plan, info);
  }

  /** The farm changed under the mode (it shouldn't: the field list is inert): stop and offer a fresh look. */
  function checkData() {
    if (!active || !cmp) return false;
    const now = getCurrentData();
    if (!now || now.result === data.result) return true;
    const again = lastStart;
    stop();
    manami.say('Your farm changed, so I’ve updated the plans. Shall we look again?', {
      actions: [
        { label: 'See them on the farm', primary: true, onClick: () => start(again.kind, { ...again.opts, reel: false }) },
        { label: 'Back to the plans', onClick: () => onBack?.() },
      ],
      focus: true,
    });
    return false;
  }

  function setDockH() {
    if (!dock.hidden) document.body.style.setProperty('--fut-dock-h', `${dock.offsetHeight}px`);
  }

  /** The dock while the plans are worked out: greyed tiles and a line saying so (null: done; '': failed). */
  function loading(text) {
    const on = text != null;
    dock.classList.toggle('is-loading', on);
    scoreEl.setAttribute('aria-busy', String(!!text));
    for (const b of [fieldsBtn, notesBtn, saveBtn, moreBtn]) b.disabled = on;
    if (!on) return;
    plansEl.replaceChildren();
    seasonsEl.replaceChildren();
    scoreEl.innerHTML = Object.entries(TILE_LABEL).map(([k, label]) => `<div class="fut-tile fut-tile--${k}" role="group" aria-label="${esc(label)}"><p class="fut-tile__label">${TILE_ICONS[k]}${esc(label)}</p><p class="fut-tile__num">–</p></div>`).join('');
    captionEl.innerHTML = text ? `<span class="plans__spinner" aria-hidden="true"></span>${esc(text)}` : '';
    captionEl.setAttribute('role', 'status');
    mixEl.textContent = '';
  }

  // ---------------------------------------------------------------- the camera

  /** Where the tour floor is: a little above everything solid (props, sails, coin columns, hills). */
  function measureFloor() {
    const rig = session().rig;
    const sails = sailSpheres(isle.spinners);
    const fields = session().fields;
    // before the stacks are placed, the highest a column could reach (a pivot field's, full, with room to drop)
    const coinTop = spotsPlaced && coins
      ? coins.columnTop
      : Math.max(...fields.map((f) => stackBase(f.topY, true) + MAX_COINS * COIN_PITCH + DROP_ROOM));
    const sailTops = sails.map((s) => s.y + s.r);
    const tops = [solidTop(isle, { skip: [coins?.mesh] }), ...sailTops, coinTop];
    const propTops = [...(isle.props || []).map(propTop), ...sailTops, coinTop];
    const { floor, fellBack } = tourFloor({ tops, propTops, heightAt: isle.heightAt, center: isle.center, maxCoast: isle.radius, overviewDist: rig.overviewDist });
    if (fellBack) console.warn('planFutures: something on the island stands very tall; the camera floor uses the props only', floor);
    return floor;
  }

  /**
   * The entry, in two phases: (1) with the farmer's drag off for a moment, keep the look-at point and
   * the direction and only rise, to the tour's angle and the floor's distance (flown only if every step
   * of it is clear, else a jump); (2) the tour limits go on, and the first stop's camera move follows.
   */
  function enterCamera() {
    const rig = session().rig;
    const controls = isle.controls;
    const want = { maxPolar: TOUR.maxPolar, floor: measureFloor() };
    const from = rig.pose;
    const rise = entryRise(from, want);
    const props = isle.props || [];
    const sails = sailSpheres(isle.spinners);
    const clear = !reduced() && poseIsClear(from, props, sails, isle.heightAt, { pad: 1.0 }) && riseIsClear(from, rise, props, sails, isle.heightAt);
    if (controls) controls.enabled = false;
    const token = run;
    rig.shot(rise, clear ? ENTRY_RISE : 0, {
      onDone: (cancelled) => {
        if (token !== run || !active) return;
        limits = want;
        rig.setExtraLimits(limits);
        if (controls) controls.enabled = true;
        const next = pendingCam;
        pendingCam = null;
        // (a flight that cut this one short has its own way to go: don't start another from in here)
        if (next && !cancelled) cameraTo(next);
      },
    });
  }

  /** A camera move for a stop: 'overview', 'field' (with an id) or 'none'. */
  function cameraTo(move) {
    if (!move || move.kind === 'none') return;
    if (!limits) { pendingCam = move; return; } // the entry is still rising
    const rig = session().rig;
    if (move.kind === 'overview') {
      rig.shot(overviewPose({ center: isle.center.toArray(), overviewDist: rig.overviewDist, azimuth: rig.azimuth }), reduced() ? 0 : 0.8);
      return;
    }
    const f = hubField(move.id);
    if (!f) return;
    const pose = fieldPose({
      field: f, islandCenter: isle.center, islandRadius: isle.radius, focusDist: rig.focusDistance(f.radius),
      limits: { ...limits, baseMin: rig.baseMinDistance }, current: rig.azimuth, home: rig.homeAzimuth ?? rig.azimuth,
      coinTop: coins?.topOf(move.id) ?? null, props: isle.props || [], sails: sailSpheres(isle.spinners),
    });
    rig.shot(pose, reduced() ? 0 : 0.9);
  }

  // ---------------------------------------------------------------- the coins

  /** 0.8 s in: where the stacks go (clear of the festival's things by now), then they drop in. */
  async function placeCoins() {
    if (!active || !coins) return;
    const token = run;
    const fields = session().fields;
    const low = Math.min(...fields.map((f) => f.topY));
    const keepOuts = themeKeepOuts(isle.island.getObjectByName('Festival themes'), { floorY: low + 1.0 });
    coins.place({ keepOuts });
    spotsPlaced = true;
    // the floor again with the real columns (it only ever rises: the camera never dips toward a prop)
    const floor = measureFloor();
    if (limits && floor > limits.floor) { limits = { ...limits, floor }; session().rig.setExtraLimits(limits); }
    await coins.prewarm(isle.camera);
    if (token !== run || !active || !coins) return;
    coinsReady = true;
    paintCoins();
    paintChips();
  }

  function paintCoins() {
    if (!coinsReady || !coins) return;
    coins.set(coinsPlan.countsFor(view, choice), coinsPlan.counts.current);
    chipsDirty = true;
  }

  // ---------------------------------------------------------------- painting the view

  /**
   * The island, the outlines, the coins, the chips, the dock, and the card and notes if open, for the
   * view and season now. Fields whose crops change grow back in (`stagger` s apart, west to east).
   */
  function paint({ grow = true, stagger = 0.06 } = {}) {
    const cells = cellsFor(cmp, view, season, choice);
    const changed = grow ? changedIds(shown, cells, xOf) : [];
    shown = cells;
    previewIsland({ grow: changed.length ? changed : null, stagger });
    paintMarks();
    paintCoins();
    paintDock();
    paintChips();
    if (cardId) renderCard();
    if (notesOpen) renderNotes();
    session()?.refreshTip();
    queueStatus();
  }

  /**
   * The view's crops for the season on the island; with the frost lens on and a freeze that season,
   * a light rime lies on the farm (only the snow look: the season and any festival stay as they are).
   */
  function previewIsland({ grow = null, stagger } = {}) {
    const frost = frostLens && frostIds(cmp, view, season, choice).size > 0;
    timeTravel.preview({ label: NAME[view], startYear, keysByYear: keysFor(cmp, view, choice) }, season, { grow, stagger, frost });
  }

  function paintMarks() {
    session()?.setMarks(marksFor(cmp, view, season, choice, { marksBase, frostLens, focusId, cardId }));
    chipsDirty = true;
  }

  /**
   * The frost lens off (a new view or season, the card closing, the walk ending): the outlines go
   * back to the changes and the rime lifts. Returns whether it was on. repaint: false when the
   * caller paints next anyway.
   */
  function lensOff({ repaint = true } = {}) {
    const was = frostLens;
    frostLens = peek = false;
    if (was && repaint && cmp) {
      previewIsland();
      paintMarks();
      paintChips(); // (the frost fields' chips stop winning a place)
      if (cardId) renderCard();
    }
    return was;
  }

  // ---- the dock

  /** The plan and season radios, once per start; paintDock updates them in place. */
  function buildDock() {
    titleEl.textContent = `Your next 3 seasons: ${years()[0]} to ${years()[2]}`;
    plansEl.innerHTML = VIEWS.map((k) => `<button type="button" role="radio" class="fut-plan fut-plan--${k}" data-view="${k}" aria-description="${esc(BLURB[k])}">
      <span class="fut-plan__icon">${PLAN_ICONS[k]}</span>
      <span class="fut-plan__text"><span class="fut-plan__name">${esc(NAME[k])}</span><span class="fut-plan__subrow"><span class="fut-plan__sub"></span>${k === 'priority' ? '<span class="fut-plan__badge">Recommended</span>' : ''}</span></span>
    </button>`).join('');
    seasonsEl.innerHTML = years().map((y, i) => `<button type="button" role="radio" class="fut-season" data-i="${i}">
      ${seasonYearHtml(y, frostIds(cmp, view, i, choice).size > 0)}<span class="fut-season__cash"></span>
    </button>`).join('');
    captionEl.removeAttribute('role');
    captionEl.textContent = voice.captionLine(coinsPlan.value);
  }

  function paintDock() {
    const uniform = uniformKind(cmp, choice);
    for (const b of plansEl.children) {
      const k = b.dataset.view;
      const on = k === view;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      const sub = k === 'mix' ? (uniform ? money(cmp.totals[uniform].expectedGM) : mixScore ? money(mixScore.expectedGM) : 'a mix') : money(cmp.totals[k].expectedGM);
      const el = b.querySelector('.fut-plan__sub');
      if (el.textContent !== sub) el.textContent = sub;
    }
    const cash = seasonCashFor(cmp, view, choice);
    for (const b of seasonsEl.children) {
      const i = Number(b.dataset.i);
      const on = i === season;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.setAttribute('aria-label', voice.seasonLabel(cmp, view, i, choice));
      const flake = b.querySelector('.fut-season__frost');
      const noFrost = !frostIds(cmp, view, i, choice).size;
      if (flake && flake.hidden !== noFrost) flake.hidden = noFrost;
      const d = cash[i] - cmp.seasonCash.current[i];
      const html = `${esc(money(cash[i]))}${view === 'current' ? '' : `<span class="fut-season__diff"> · ${esc(Math.abs(d) < 500 ? 'same' : signed(d))}</span>`}`;
      const el = b.querySelector('.fut-season__cash');
      if (el.innerHTML !== html) el.innerHTML = html;
    }
    paintScore();
    const mix = voice.mixLine(cmp, choice, mixScore);
    if (mixEl.textContent !== mix) mixEl.textContent = mix;
    mixEl.hidden = view !== 'mix'; // (only beside the mix: next to "Use Keep going" it reads as a contradiction)
    const label = voice.saveLabel(view);
    saveBtn.innerHTML = `${ACTION_ICONS.tick}<span>${esc(label)}</span>`;
    fieldsBtn.setAttribute('aria-expanded', String(!!cardId));
    notesBtn.setAttribute('aria-expanded', String(notesOpen));
  }

  /** The 4 tiles for the view (the mix's once it's scored; greyed while it's being worked out). */
  function paintScore() {
    const ts = tileValues(cmp, view, mixScore, choice);
    const busy = ts[0].value == null;
    scoreEl.setAttribute('aria-busy', String(busy));
    scoreEl.classList.toggle('is-busy', busy);
    const html = ts.map((t) => tileHtml(t, busy)).join('');
    if (scoreEl.innerHTML !== html) scoreEl.innerHTML = html;
    // (the plan radio's sub-line and the mix line follow the score)
    const mixSub = plansEl.querySelector('[data-view="mix"] .fut-plan__sub');
    const uniform = uniformKind(cmp, choice);
    const sub = uniform ? money(cmp.totals[uniform].expectedGM) : mixScore ? money(mixScore.expectedGM) : 'a mix';
    if (mixSub && mixSub.textContent !== sub) mixSub.textContent = sub;
    const mix = voice.mixLine(cmp, choice, mixScore);
    if (mixEl.textContent !== mix) mixEl.textContent = mix;
    mixEl.hidden = view !== 'mix'; // (only beside the mix: next to "Use Keep going" it reads as a contradiction)
  }

  function tileHtml(t, busy) {
    const label = TILE_LABEL[t.key];
    let num;
    let diff = '';
    if (busy) num = '<span class="fut-tile__busy">Working it out…</span>';
    else if (t.key === 'soil') {
      const v = Math.max(0, Math.min(100, t.value));
      num = `<span class="meter" aria-hidden="true"><span style="width:${v}%"></span></span><span aria-hidden="true">${t.value}/100</span><span class="sr-only">${t.value} out of 100</span>`;
      if (view !== 'current' && t.diff != null) {
        const up = t.diff >= 0;
        diff = `<span class="fut-tile__diff ${up ? 'is-up' : 'is-down'}"><span aria-hidden="true">${up ? '+' : '−'}${Math.abs(t.diff)}</span><span class="sr-only">${Math.abs(t.diff)} ${Math.abs(t.diff) === 1 ? 'point' : 'points'} ${up ? 'higher' : 'lower'} than keeping going</span></span>`;
      }
    } else if (t.key === 'beats') {
      num = t.value == null ? '–' : `${t.value}% of years`;
    } else {
      num = esc(money(t.value));
      if (view !== 'current' && t.diff != null && Math.abs(t.diff) >= 500) {
        const up = t.diff >= 0;
        diff = `<span class="fut-tile__diff ${up ? 'is-up' : 'is-down'}"><span aria-hidden="true">${esc(signed(t.diff))}</span><span class="sr-only">${esc(diffWords(t.diff))}</span></span>`;
      }
    }
    return `<div class="fut-tile fut-tile--${t.key}" role="group" aria-label="${esc(label)}"><p class="fut-tile__label">${TILE_ICONS[t.key]}${esc(label)}</p><p class="fut-tile__num">${num}${diff}</p></div>`;
  }

  /** "#futStatus": the view and season in words for screen readers, while the farmer looks round. */
  function queueStatus() {
    clearTimeout(statusTimer);
    if (reel) return;
    statusTimer = setTimeout(() => {
      if (!active || !cmp || reel) return;
      const line = voice.statusLine(cmp, view, season, choice, mixScore);
      if (statusEl.textContent !== line) statusEl.textContent = line;
    }, 400);
  }

  // ---- the chips over the fields

  function buildChips() {
    chipsEl.innerHTML = session().fields.map((f) => `<div class="fut-chip" data-id="${esc(f.id)}" tabindex="-1" style="visibility:hidden"></div>`).join('');
    chips = [...chipsEl.children].map((el) => ({ id: el.dataset.id, el, html: '', w: 0, h: 0, at: '', shown: false, changed: false, weight: 0 }));
  }

  /** Each chip's money, difference and dot for the view and season (written only when it changes). */
  function paintChips() {
    if (!cmp) return;
    const changes = marksBase && marksBase !== view ? seasonChanges(cmp, view, choice, marksBase)[season] : new Map();
    const dry = dryIds(cmp, view, season, choice);
    const dryStop = !!reel?.stops[reel.i]?.dryLens; // the walk's dry stop: the drops' chips win a place
    const written = [];
    for (const c of chips) {
      const f = fieldOf(cmp, c.id);
      if (!f) continue;
      const e = viewField(cmp, c.id, view, choice);
      const s = e.seasons[season];
      const d = e.total - f.byKind.current.total;
      const showDiff = kindOf(c.id) !== 'current' && Math.abs(d) >= 500;
      // (with the frost lens on, the frost fields' chips win a place over the others; at the dry
      // stop, the dry fields')
      c.changed = changes.has(c.id) || c.id === focusId || c.id === cardId || (frostLens && !!s.freeze) || (dryStop && dry.has(c.id));
      c.weight = Math.abs(d);
      const html = chipHtml({ s, total: e.total, diff: d, showDiff, dry: dry.has(c.id) });
      const cls = `fut-chip${showDiff ? ' has-diff' : ''}${e.total <= 0 ? ' is-loss' : ''}${c.id === focusId || c.id === cardId ? ' is-focus' : ''}`;
      if (html !== c.html || c.el.className !== cls) {
        c.html = html;
        c.el.innerHTML = html;
        c.el.className = cls;
        written.push(c);
      }
    }
    // measured after all the writes, so the page lays out once rather than once per chip
    for (const c of written) {
      c.w = c.el.offsetWidth;
      c.h = c.el.offsetHeight;
    }
    chipsDirty = true;
  }

  const hubPanelEl = document.getElementById('hubPanel');
  /** Manami's face, and her bubble while it's open. */
  function manamiParts() {
    const host = document.getElementById('manami');
    if (!host || !host.classList.contains('is-shown')) return [];
    const parts = [host.querySelector('.manami__avatar')];
    if (!host.classList.contains('is-collapsed')) parts.push(host.querySelector('.manami__bubble'));
    return parts;
  }

  /** Where a field's chip floats: over its coins, or over the soil when it has no stack. */
  function chipAnchor(id) {
    const spot = coins?.spotOf(id);
    if (spot) return v3.set(spot.x, spot.baseY + coins.countOf(id) * COIN_PITCH + CHIP_LIFT, spot.z);
    const f = hubField(id);
    return v3.set(f.center[0], f.topY + NO_STACK_LIFT, f.center[1]);
  }

  /**
   * After each frame is drawn (view.onAfterFrame, so they never lag the 3D): the chips over their
   * fields, only when the camera, the coins or the view moved. Hidden behind the camera, over the
   * dock or the card, and where two would overlap (changed fields and bigger differences win).
   */
  function placeChips() {
    if (!active || !coinsReady || !chips.length || !isle) return;
    const cam = isle.camera;
    let same = !chipsDirty;
    const a = cam.matrixWorld.elements, b = cam.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) {
      if (lastCam[i] !== a[i]) { lastCam[i] = a[i]; same = false; }
      if (lastCam[16 + i] !== b[i]) { lastCam[16 + i] = b[i]; same = false; }
    }
    if (same) return;
    chipsDirty = false;
    const r = isle.canvas.getBoundingClientRect();
    // (and off the field list and Manami: a chip over them reads as part of them)
    const avoid = [dock, card, notes, hubPanelEl, ...manamiParts()].filter((el) => el && !el.hidden && el.getClientRects().length).map((el) => {
      const q = el.getBoundingClientRect();
      return { x: q.left, y: q.top, w: q.width, h: q.height };
    }).filter((q) => q.w > 0 && q.h > 0);
    const items = [];
    const at = new Map();
    for (const c of chips) {
      const p = chipAnchor(c.id).project(cam);
      if (p.z > 1 || p.z < -1) continue;
      const x = r.left + ((p.x + 1) / 2) * r.width, y = r.top + ((1 - p.y) / 2) * r.height;
      const box = { x: x - c.w / 2, y: y - c.h, w: c.w, h: c.h };
      if (box.x < 0 || box.y < 0 || box.x + box.w > innerWidth || box.y + box.h > innerHeight) continue;
      if (avoid.some((q) => overlaps(box, q))) continue;
      items.push({ id: c.id, box, changed: c.changed, weight: c.weight });
      at.set(c.id, box);
    }
    const keep = declutter(items);
    for (const c of chips) {
      const on = keep.has(c.id);
      if (on) {
        const box = at.get(c.id);
        const t = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
        if (t !== c.at) { c.at = t; c.el.style.transform = t; }
      }
      if (on !== c.shown) { c.shown = on; c.el.style.visibility = on ? '' : 'hidden'; }
    }
  }

  // ---------------------------------------------------------------- the reel

  function startReel(at = 0) {
    closeNotes({ restore: false });
    reel = { stops: reelStops(cmp), i: at };
    hintOn = false;
    clearTimeout(statusTimer);
    runStop();
  }

  /** Shows the stop at reel.i (or the next one with something to say) with Manami's line and buttons. */
  function runStop() {
    const token = reel;
    let i = reel.i;
    let line = null;
    while (i < reel.stops.length && !(line = voice.reelLine(cmp, reel.stops[i]))) i++;
    if (i >= reel.stops.length) { toExplore({ hint: false }); return; }
    reel.i = i;
    const st = reel.stops[i];
    view = st.view;
    season = st.season;
    marksBase = st.marksBase;
    // the weather stops light their fields their own way (ice blue for frost), not gold
    frostLens = !!st.frostLens;
    peek = false;
    focusId = st.noFocus ? null : st.fieldId || null;
    paint({ grow: i > 0, stagger: st.growStagger || 0 });
    cameraTo(st.camera === 'field' ? { kind: 'field', id: st.fieldId } : { kind: st.camera });
    const go = (j) => () => { if (reel === token && reel.i === i && active) { reel.i = j; runStop(); } };
    const next = { label: 'Next', primary: true, onClick: go(i + 1) };
    const look = { label: 'I’ll look round', onClick: () => { if (reel === token && active) toExplore({ hint: true }); } };
    let actions;
    if (st.id === 'intro') actions = [{ ...next, label: 'Show my pick' }, look];
    else if (st.id === 'vsProfit') actions = [{ ...next, label: 'Back to my pick' }, look];
    else if (st.id === 'watch') actions = [next, { label: 'Why and watch out', onClick: () => { if (reel !== token || !active) return; toExplore({ hint: false, quiet: true }); openNotes(); } }];
    else if (st.id === 'yourTurn') actions = [];
    else actions = [next, look];
    manami.say(line, { actions, focus: actions.length > 0 });
    if (st.id === 'yourTurn') {
      reel = null; // the walk is over: over to the farmer
      focusId = null;
      paintMarks();
      paintChips();
      queueStatus();
      if (!dock.contains(document.activeElement)) homeEl().focus({ preventScroll: true });
    }
  }

  /** The walk ends (or never ran): the farmer looks round. hint: "Start there" on the biggest-gain field. */
  function toExplore({ hint = false, quiet = false, focusTitle = false } = {}) {
    reel = null;
    marksBase = 'current';
    focusId = null;
    hintOn = false;
    if (frostLens) { frostLens = peek = false; previewIsland(); } // (the marks are painted below)
    if (hint) {
      const g = gainField(cmp);
      if (g) { focusId = g.id; hintOn = true; }
      sayExplore(voice.skipHintLine(cmp));
    } else if (!quiet) sayExplore(voice.yourTurnLine());
    else manami.hide();
    paintMarks();
    paintChips();
    queueStatus();
    if (focusTitle) homeEl().focus({ preventScroll: true });
  }

  /** Any tap on the island clears the "start there" outline. */
  function dropHint() {
    if (!hintOn) return;
    hintOn = false;
    focusId = null;
  }

  // ---------------------------------------------------------------- looking round

  function setView(v) {
    if (!VIEWS.includes(v) || !checkData()) return;
    if (v === view) return;
    view = v;
    if (!reel) marksBase = 'current';
    lensOff({ repaint: false });
    paint();
    if (v === 'mix' && !uniformKind(cmp, choice) && !mixScore) scoreMix();
  }

  /** keepFrost: the card's freeze peek moves the season itself, and keeps its lens on. */
  function setSeason(i, { keepFrost = false } = {}) {
    if (!checkData()) return;
    const s = Math.max(0, Math.min(2, i));
    if (s === season) return;
    season = s;
    if (!keepFrost) lensOff({ repaint: false });
    paint();
  }

  /**
   * The card's "Show a spring freeze on the farm": the island goes to the field's first season with
   * a freeze, every frost field that season is outlined ice blue under a rime, and #futStatus says
   * which. Pressed again (or Esc, or Done), it goes off.
   */
  function togglePeek() {
    if (!cardId) return;
    if (peek && frostLens) { lensOff(); queueStatus(); return; }
    const e = viewField(cmp, cardId, view, choice);
    const y = e.seasons.findIndex((s) => s.freeze);
    if (y < 0) return;
    frostLens = peek = true;
    if (y !== season) setSeason(y, { keepFrost: true });
    else paint();
    if (!active || !cmp) return; // (the farm changed under the mode, and it stopped)
    clearTimeout(statusTimer); // (the peek's line, not the season's)
    statusEl.textContent = voice.frostPeekLine(cmp, season, frostIds(cmp, view, season, choice));
  }

  /** The tooltip over a field (hub.setPlanMode). */
  function tipFor(id) {
    if (!active || !cmp || !fieldOf(cmp, id)) return null;
    return voice.tipFor(cmp, id, view, season, choice);
  }

  /** A tap on a field (or a chip) opens its card; a tap on open ground closes it. */
  function onTap(id) {
    if (!active || !cmp) return;
    dropHint();
    if (!id || !fieldOf(cmp, id)) { closeCard({ restore: false }); paintMarks(); paintChips(); return; }
    openCard(id, { opener: homeEl() });
  }

  /** A field's plan, picked in its card: the farm shows the farmer's own plan from now on. */
  function pick(id, kind) {
    if (!KINDS.includes(kind) || !checkData()) return;
    const was = kindFor(choice, id);
    choice = { ...choice, [id]: kind };
    setChoice?.({ ...choice });
    if (reel) { reel = null; focusId = null; marksBase = 'current'; }
    dropHint();
    if (was !== kind) mixScore = null;
    view = 'mix';
    lensOff({ repaint: false });
    paint();
    scoreMix();
    said = voice.pickedLine(fieldOf(cmp, id).name, kind);
    const saidEl = card.querySelector('.fut-card__said');
    if (saidEl) saidEl.textContent = said;
    sayExplore(said);
  }

  /** The mix's score (debounced; an older one still on its way is ignored). */
  function scoreMix() {
    clearTimeout(mixTimer);
    const id = ++mixRun;
    if (uniformKind(cmp, choice) || !evaluateMix) { paintScore(); return; }
    mixScore = null;
    paintScore();
    paintDock();
    mixTimer = setTimeout(async () => {
      try {
        const plan = mixedPlan(data.result.plans, choice);
        const score = await evaluateMix(plan);
        if (id !== mixRun || !active) return;
        mixScore = score;
        paintDock();
        if (cardId) renderCard();
        if (notesOpen) renderNotes();
        queueStatus();
      } catch { /* the tiles keep saying they're working it out; the line stays without a number */ }
    }, 300);
  }

  // ---------------------------------------------------------------- the field card

  function openCard(id, { opener = document.activeElement, watch = false } = {}) {
    if (!fieldOf(cmp, id)) return;
    if (reel) {
      // the farmer's own look now: the walk ends (Manami steps aside while the card is open)
      reel = null;
      marksBase = 'current';
      focusId = null;
      if (frostLens) { frostLens = peek = false; previewIsland(); } // (the walk's frost stop: the rime lifts)
      manami.say(voice.yourTurnLine());
    }
    const was = cardId;
    cardId = id;
    // (the peek was this card's: another field's card starts without it)
    if (was && was !== id && peek && lensOff({ repaint: false })) { previewIsland(); queueStatus(); }
    if (!was) cardOpener = opener;
    if (was !== id) said = '';
    card.hidden = false;
    document.body.classList.add('fut-card-open');
    renderCard({ fresh: was !== id });
    paintMarks();
    paintChips();
    paintDock();
    session()?.relayout();
    if (was !== id) cameraTo({ kind: 'field', id });
    if (watch) card.querySelector('#futCardWatch')?.scrollIntoView({ block: 'start' });
    if (!was || !card.contains(document.activeElement)) card.querySelector('#futCardTitle')?.focus({ preventScroll: true });
  }

  function closeCard({ restore = true } = {}) {
    if (!cardId) return;
    cardId = null;
    said = '';
    const hadFocus = card.contains(document.activeElement);
    card.hidden = true;
    card.replaceChildren();
    document.body.classList.remove('fut-card-open');
    if (lensOff({ repaint: false })) { previewIsland(); queueStatus(); }
    paintMarks();
    paintChips();
    paintDock();
    session()?.relayout();
    const to = cardOpener?.isConnected && cardOpener.getClientRects().length ? cardOpener : homeEl();
    cardOpener = null;
    if (restore || hadFocus) to.focus({ preventScroll: true });
  }

  /** Steps the card to the field before or after (round the list). */
  function stepCard(by) {
    const ids = cmp.fields.map((f) => f.id);
    const i = ids.indexOf(cardId);
    openCard(ids[(i + by + ids.length) % ids.length]);
  }

  /** The card's HTML for cardId, keeping focus, scroll and "More numbers" as they were. */
  function renderCard({ fresh = false } = {}) {
    const id = cardId;
    const f = fieldOf(cmp, id);
    if (!f) return;
    const focusAct = card.contains(document.activeElement) ? document.activeElement.dataset?.act || (document.activeElement.dataset?.kind ? `kind:${document.activeElement.dataset.kind}` : null) : null;
    const body = card.querySelector('.fut-card__body');
    const scroll = fresh ? 0 : body?.scrollTop || 0;
    const numbersOpen = !fresh && !!card.querySelector('.fut-numbers')?.open;
    const picked = kindFor(choice, id);
    const e = viewField(cmp, id, view, choice);
    const cover = voice.coverLine(cmp, id, view, choice);
    const rows = KINDS.map((k, i) => rowHtml(f, k, picked, KINDS.slice(0, i).find((o) => f.byKind[o].seasons.every((s, y) => sameCrops(s, f.byKind[k].seasons[y]))))).join('');
    const watch = voice.watchItems(cmp, id, view, choice);
    const good = gaps.byField[id] || [];
    const options = cmp.fields.map((x) => `<option value="${esc(x.id)}"${x.id === id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    card.innerHTML = `
      <div class="fut-card__top">
        <div class="fut-card__head">
          <p class="fut-kicker">Field · ${Math.round(f.acres)} ac</p>
          <h2 class="fut-card__title" id="futCardTitle" tabindex="-1">${esc(f.name)}</h2>
        </div>
        <button class="fut-close" type="button" data-act="close" aria-label="Close the field card">${ACTION_ICONS.close}</button>
      </div>
      <div class="fut-card__nav">
        <button class="fut-step" type="button" data-act="prev" aria-label="Previous field">${ACTION_ICONS.chevronLeft}</button>
        <select class="fut-card__select" data-act="select" aria-label="Field">${options}</select>
        <button class="fut-step" type="button" data-act="next" aria-label="Next field">${ACTION_ICONS.chevronRight}</button>
      </div>
      <div class="fut-card__body">
        <div class="says fut-card__says">
          <p class="says__title"><img src="/manami.svg" alt="" width="24" height="22">Manami</p>
          <p>${esc(voice.fieldLine(cmp, id, view, choice))}</p>
          ${cover ? `<p class="fut-card__cover">${esc(cover)}</p>` : ''}
          <p class="fut-card__said" aria-live="polite">${esc(said)}</p>
        </div>
        <h3 class="fut-card__h" id="futCardPlanH">Plan for ${esc(f.name)}</h3>
        <div class="fut-rows" role="radiogroup" aria-labelledby="futCardPlanH">${rows}</div>
        <h3 class="fut-card__h" id="futCardWatch">What to watch on this plan</h3>
        ${watch.length
    ? `<ul class="fut-watch">${watch.map((w) => `<li class="fut-watch__row"><span class="fut-watch__when">${w.year} · <span class="fut-sev sev-${w.severity}">${esc(w.label)}</span> ·</span>${LENS_ICONS[w.lens] || ''}<span class="sr-only">${esc(LENS_LABEL[w.lens] || '')}:</span><span>${esc(w.text)}</span></li>`).join('')}</ul>`
    : '<p class="fut-none">Nothing to flag here. Nice work.</p>'}
        ${e.seasons.some((s) => s.freeze) ? `<button class="linkish fut-frost-peek" type="button" data-act="frost" aria-pressed="${peek && frostLens}">Show a spring freeze on the farm</button>` : ''}
        ${good.length ? `<h3 class="fut-card__h">Good to know</h3><ul class="fut-list">${good.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${onJar && !hasJar(id) ? '<button class="linkish fut-jar" type="button" data-act="jar">Test this field’s soil with a jar</button>' : ''}
        <details class="fut-numbers"${numbersOpen ? ' open' : ''}><summary>More numbers</summary>${numbersHtml(f, e)}</details>
      </div>
      <div class="fut-card__foot">
        <button class="btn btn--quiet btn--small" type="button" data-act="done">Done</button>
        <button class="btn btn--primary btn--small" type="button" data-act="save">${ACTION_ICONS.tick}<span>${esc(voice.saveLabel(view))}</span></button>
      </div>`;
    const nb = card.querySelector('.fut-card__body');
    if (nb) nb.scrollTop = scroll;
    if (focusAct) {
      const el = focusAct.startsWith('kind:') ? card.querySelector(`.fut-row[data-kind="${focusAct.slice(5)}"]`) : card.querySelector(`[data-act="${focusAct}"]`);
      (el || card.querySelector('#futCardTitle'))?.focus({ preventScroll: true });
    }
  }

  /** One plan's row in the card: its 3 seasons, its worst warning, and its total next to keeping going. */
  function rowHtml(f, kind, picked, sameAs) {
    const e = f.byKind[kind];
    const on = kind === picked;
    const cells = e.seasons.map((s, y) => `<span class="fut-cell">
        <span class="plan-crop">${cropIconFor(s.crop, s.cover)}</span>
        <span class="fut-cell__year">${years()[y]}${s.freeze ? `<span class="fut-cell__frost" aria-hidden="true">${LENS_ICONS.frost}</span>` : ''}</span>
        <span class="fut-cell__cash">${esc(perAcre(s.gmAc))}/ac</span>
        <span class="fut-cell__soil">${TILE_ICONS.soil}${s.soil100}</span>
      </span>`).join('');
    const sev = Math.max(0, ...e.seasons.map((s) => s.worst));
    const d = e.total - f.byKind.current.total;
    const total = kind === 'current' ? money(e.total) : `${money(e.total)}, ${Math.abs(d) < 500 ? 'same' : signed(d)}`;
    const label = `${NAME[kind]}: ${e.seasons.map((s, y) => `${years()[y]} ${cellName(s)}`).join(', ')}. About ${money(e.total)} over 3 seasons${kind === 'current' ? '' : `, ${diffWords(d)}`}.${sev ? ` ${SEVERITY_LABEL[sev]}: something to watch.` : ''}${frostRowWords(e.seasons, years())}${dryRowWords(e.seasons, years(), waterWorry(cmp) === true)}${sameAs ? ` Same crops as ${NAME[sameAs]}.` : ''}`;
    return `<button type="button" role="radio" class="fut-row fut-row--${kind}" data-kind="${kind}" aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="${esc(label)}">
      <span class="fut-row__head"><span class="fut-row__icon">${PLAN_ICONS[kind]}</span><b>${esc(NAME[kind])}</b>${kind === 'priority' ? '<span class="fut-plan__badge">Recommended</span>' : ''}${sameAs ? `<span class="fut-row__same">same crops as ${esc(NAME[sameAs])}</span>` : ''}</span>
      <span class="fut-row__cells">${cells}</span>
      <span class="fut-row__foot">${sev ? `<span class="fut-dot sev-${sev}"></span>` : ''}<span class="fut-row__total">${esc(total)}</span></span>
    </button>`;
  }

  /** "More numbers": each season of the view, in full. */
  function numbersHtml(f, e) {
    const cur = f.byKind.current.seasons;
    const meter = (v) => `<span class="meter" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, v))}%"></span></span><span aria-hidden="true">${v}/100</span><span class="sr-only">${v} out of 100</span>`;
    return e.seasons.map((s, y) => {
      const rows = [
        ['Yield', `${Number(s.yield).toFixed(1)} ${s.unit || 'bu'}/ac`],
        ['Cash margin', `${money(s.gmAc)} an acre`],
        ['On this field', money(s.cash)],
        ['Soil care this season', meter(s.soil100), true],
        ['Keeping going', meter(cur[y].soil100), true],
      ];
      if (s.water != null) rows.push(['Water', `${s.water.toFixed(1)} in used${s.waterShort ? `, ${s.waterShort.toFixed(1)} in short` : ''}`]);
      if (s.nCredit > 0) rows.push(['Nitrogen credit', `+${perAcre(s.nCredit)}/ac`]);
      if (s.drag < 0) rows.push(['Yield drag', `−${Math.round(Math.abs(s.drag))} ${s.unit || 'bu'}/ac`]);
      if (s.coverCost) rows.push(['Cover crop', `${perAcre(s.coverCost)}/ac`]);
      rows.push(...frostNumbers(s.freeze));
      return `<div class="fut-num"><p class="fut-num__h">${years()[y]} · ${esc(cellName(s))}</p><dl>${rows.map(([k, v, raw]) => `<div><dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd></div>`).join('')}</dl></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- "Why and watch out"

  function openNotes() {
    if (!cmp) return;
    notesOpen = true;
    notes.hidden = false;
    document.body.classList.add('fut-notes-open');
    renderNotes();
    paintDock();
    chipsDirty = true;
    notes.querySelector('#futNotesTitle')?.focus({ preventScroll: true });
  }

  function closeNotes({ restore = true } = {}) {
    if (!notesOpen) return;
    notesOpen = false;
    const hadFocus = notes.contains(document.activeElement);
    notes.hidden = true;
    notes.replaceChildren();
    document.body.classList.remove('fut-notes-open');
    paintDock();
    chipsDirty = true;
    if (restore || hadFocus) notesBtn.focus({ preventScroll: true });
  }

  function renderNotes() {
    const scroll = notes.querySelector('.fut-notes__body')?.scrollTop || 0;
    const fineOpen = !!notes.querySelector('.fut-fine')?.open;
    const why = [voice.weightsLine(cmp.weights)];
    if (view === 'priority' || view === 'mix') why.push(voice.priceLine(cmp.price));
    why.push(voice.nLine(cmp, view, choice));
    const carried = voice.nCarriedLine(cmp, view, mixScore, choice);
    if (carried) why.push(carried);
    const rows = voice.watchRows(cmp, view, choice);
    const risks = voice.farmRiskLines(cmp, view, mixScore, choice);
    // (the weather worry in her words; the planner's own sentence stays in the fine print)
    const wheat = cmp.fields.some((f) => viewField(cmp, f.id, view, choice).seasons.some((s) => /wheat/.test(s.crop)));
    const weatherRisk = voice.farmWeatherLine(cmp, { wheat });
    const good = [voice.weatherLine(cmp.weather), weatherRisk, voice.captionLine(coinsPlan.value), ...gaps.farm];
    const raw = fineprint(cmp, view, mixScore, choice);
    const p = (t) => `<p>${esc(t)}</p>`;
    const list = (items) => `<ul class="fut-list">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    notes.innerHTML = `
      <div class="fut-notes__top">
        <div><p class="fut-kicker">${esc(NAME[view])}</p><h2 class="fut-notes__title" id="futNotesTitle" tabindex="-1">Why and watch out</h2></div>
        <button class="fut-close" type="button" data-act="close" aria-label="Close Why and watch out">${ACTION_ICONS.close}</button>
      </div>
      <div class="fut-notes__body">
        <details class="fut-notes__sec" open><summary>${view === 'priority' || view === 'mix' ? 'Why I picked this' : 'About this plan'}</summary>${why.map(p).join('')}</details>
        <details class="fut-notes__sec" open><summary>Watch out for</summary>
          ${rows.length ? `<div class="fut-watch__list">${rows.map((r) => `<button type="button" class="fut-watch__item" data-id="${esc(r.id)}" data-season="${r.season}"><span class="fut-dot sev-${r.severity}" aria-hidden="true"></span>${LENS_ICONS[r.lens] || ''}<span>${esc(r.text)}</span></button>`).join('')}</div>` : '<p class="fut-none">Nothing to flag on this plan. Nice work.</p>'}
          ${risks.lines.map(p).join('')}
          ${risks.unmatched.length ? `<p class="fut-kicker fut-kicker--sub">From the planner</p>${list(risks.unmatched)}` : ''}
        </details>
        <details class="fut-notes__sec" open><summary>Good to know</summary>${good.map(p).join('')}
          ${gaps.unmatched.length ? `<p class="fut-kicker fut-kicker--sub">From the planner</p>${list(gaps.unmatched)}` : ''}
        </details>
        <details class="fut-fine"${fineOpen ? ' open' : ''}><summary>Fine print</summary>
          ${Object.entries(raw).filter(([, items]) => items.length).map(([k, items]) => `<p class="fut-kicker fut-kicker--sub">${esc(k)}</p>${list(items)}`).join('')}
        </details>
      </div>
      <div class="fut-notes__foot">
        <button class="linkish" type="button" data-act="replay">Walk me through it again</button>
        <button class="linkish" type="button" data-act="table">See it all as a table</button>
        <button class="linkish" type="button" data-act="build">Change crops myself</button>
      </div>`;
    const b = notes.querySelector('.fut-notes__body');
    if (b) b.scrollTop = scroll;
  }

  // ---------------------------------------------------------------- the card's and the camera's room

  /** The room the card takes (hub getPanelInsets while the mode is on). */
  function insets() {
    if (!active) return {};
    if (!cardId || card.hidden) {
      // a phone: Manami's open bubble sits over the island's middle, so the island is framed above it
      if (!(sheetQ.matches || phoneQ.matches)) return {};
      const bubble = manamiParts()[1];
      if (!bubble) return {};
      const top = bubble.getBoundingClientRect().top;
      return top > innerHeight * 0.3 ? { right: 0, bottom: Math.max(0, innerHeight - top + 8) } : {};
    }
    const r = card.getBoundingClientRect();
    if (sheetQ.matches || phoneQ.matches) return { right: 0, bottom: Math.max(0, innerHeight - r.top + 12) };
    const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 24;
    return { right: card.offsetWidth + gutter + 8, bottom: 0 };
  }

  // ---------------------------------------------------------------- input

  /** Esc: the notes first, then the card, then back to the plans. Ours alone while the mode is on. */
  function onKey(e) {
    if (e.key !== 'Escape' || !active) return;
    if (document.body.classList.contains('plans-open') || document.body.classList.contains('jar-open')) return;
    if (e.target.closest?.('input, textarea, select')) return;
    e.preventDefault();
    e.stopPropagation();
    if (notesOpen) closeNotes();
    else if (cardId && peek && frostLens) { lensOff(); queueStatus(); } // the freeze peek first, then the card
    else if (cardId) closeCard();
    else back();
  }

  /** Arrow keys walk a radio group (roving tabindex); returns the index to go to, or null. */
  function rove(e, i, n) {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (step) return (i + step + n) % n;
    if (e.key === 'Home') return 0;
    if (e.key === 'End') return n - 1;
    return null;
  }

  $('futClose').addEventListener('click', () => { if (active) leave(); });
  backBtn.addEventListener('click', () => { if (active) back(); });
  saveBtn.addEventListener('click', () => { if (active && cmp) save(); });
  notesBtn.addEventListener('click', () => { if (!active || !cmp) return; if (notesOpen) closeNotes(); else openNotes(); });
  fieldsBtn.addEventListener('click', () => {
    if (!active || !cmp) return;
    if (cardId) { closeCard(); return; }
    openCard(focusId || gainField(cmp)?.id || cmp.fields[0].id, { opener: fieldsBtn });
  });
  /** The dock's extra rows on a phone: shown or folded away, with the button saying which. */
  function setMore(on) {
    dock.classList.toggle('is-more', on);
    moreBtn.setAttribute('aria-expanded', String(on));
    moreBtn.textContent = on ? 'Less' : 'More';
  }
  moreBtn.addEventListener('click', () => setMore(!dock.classList.contains('is-more')));
  plansEl.addEventListener('click', (e) => {
    const b = e.target.closest('.fut-plan');
    if (b && active && cmp) setView(b.dataset.view);
  });
  plansEl.addEventListener('keydown', (e) => {
    if (!active || !cmp) return;
    const i = rove(e, VIEWS.indexOf(view), VIEWS.length);
    if (i == null) return;
    e.preventDefault();
    setView(VIEWS[i]);
    plansEl.querySelector(`[data-view="${VIEWS[i]}"]`)?.focus();
  });
  seasonsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.fut-season');
    if (b && active && cmp) setSeason(Number(b.dataset.i));
  });
  seasonsEl.addEventListener('keydown', (e) => {
    if (!active || !cmp) return;
    const i = rove(e, season, 3);
    if (i == null) return;
    e.preventDefault();
    setSeason(i);
    seasonsEl.querySelector(`[data-i="${i}"]`)?.focus();
  });
  chipsEl.addEventListener('click', (e) => {
    const c = e.target.closest('.fut-chip');
    if (c && active) onTap(c.dataset.id);
  });
  card.addEventListener('click', (e) => {
    if (!active || !cmp || !cardId) return;
    const row = e.target.closest('.fut-row');
    if (row) { pick(cardId, row.dataset.kind); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close' || act === 'done') closeCard();
    else if (act === 'prev') stepCard(-1);
    else if (act === 'next') stepCard(1);
    else if (act === 'save') save();
    else if (act === 'frost') togglePeek();
    else if (act === 'jar') onJar?.(cardId);
  });
  card.addEventListener('change', (e) => {
    if (active && cmp && e.target.matches('.fut-card__select')) openCard(e.target.value);
  });
  card.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('.fut-row');
    if (!row || !active || !cmp) return;
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = KINDS.indexOf(row.dataset.kind);
    const k = KINDS[(i + step + KINDS.length) % KINDS.length];
    pick(cardId, k);
    card.querySelector(`.fut-row[data-kind="${k}"]`)?.focus();
  });
  notes.addEventListener('click', (e) => {
    if (!active || !cmp) return;
    const row = e.target.closest('.fut-watch__item');
    if (row) {
      const id = row.dataset.id;
      closeNotes({ restore: false });
      setSeason(Number(row.dataset.season));
      openCard(id, { opener: notesBtn, watch: true });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeNotes();
    else if (act === 'replay') { closeCard({ restore: false }); startReel(0); }
    else if (act === 'table') back();
    else if (act === 'build') { stop(); onBuild?.(); }
  });

  return {
    start,
    stop,
    insets,
    get active() { return active; },
    /** For debugging in the console: the state of the mode. */
    get state() { return { view, season, choice: { ...choice }, cardId, notesOpen, frostLens, peek, reel: reel ? reel.stops[reel.i]?.id : null, limits, mixScore: mixScore?.expectedGM ?? null }; },
    get cmp() { return cmp; },
  };
}
