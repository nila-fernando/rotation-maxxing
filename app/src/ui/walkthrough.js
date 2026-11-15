// The guided walkthrough of the hub, narrated by Manami. It starts by itself the first time the hub
// appears (remembered in localStorage), and the "?" on "Your fields" plays it again.
//
// Each step spotlights part of the hub and Manami's card sits beside it: "n of N", a title, a few
// lines, where the data comes from, and sometimes a "Try it" that moves the tour on once it's done.
// Next, Back and Skip are always there; Esc skips, ← and → step. The dimming never takes the
// pointer, so the farm stays usable the whole way through (the pattern of Halation's tutorial).
//
// Steps name their targets as CSS selectors, tried in order: the first that matches something on
// screen gets the spotlight (several matches are lit together). A step whose target isn't on screen
// shows its card in the middle instead, and an `optional` one is left out of the tour.
// Some steps need a panel open (`needs`: the field check-up or the plans); the tour opens it, and
// closes it again when it leaves, but only if it was the one that opened it.
//
//   const tour = createWalkthrough({ ctx, sources, say })
//   tour.start()              from the first step (again, if it's already open)
//   tour.maybeAutoStart()     the first time only (or ?tour=1); ?tour=0 never
//   tour.stop()               closes it without a word (the hub went away)
//   tour.isOpen
//
// The pure parts (the steps, the memory, the key map, where the card goes) are exported for tests.

export const TOUR_KEY = 'rotation-maxxing.tour.v1';
export const SETTLE_MS = 900; // after a "Try it" is done, before the tour moves on

/**
 * The steps. target: selectors tried in order. needs: a panel the step needs open. side: where the
 * card would like to go. sources: keys of the data sources (fieldReport.js SOURCES) to name.
 * try: { text, wait } with wait one of the waits in createWalkthrough.
 */
export const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to your farm!',
    body: 'This island is your farm: every field you picked, with this year’s crop growing on it. Drag to turn it, scroll or pinch to zoom. Let me show you around. It takes about a minute.',
    next: 'Show me',
  },
  {
    id: 'fields',
    target: ['#hubPanel'],
    side: 'right',
    title: 'Your fields',
    body: 'Every field, its acres and its latest crop. The dot says how it’s doing: grey is not checked yet, green is nothing to flag, amber is one thing to look at, red is a few. Each one lights up on the island when you point at it.',
    try: { text: 'Tap a field to open its check-up.', wait: 'fieldOpened' },
  },
  {
    id: 'checkup',
    needs: 'checkup',
    target: ['#checkup .checkup__top, #checkup .says', '#checkup'],
    side: 'left',
    title: 'A field’s check-up',
    body: 'Each field gets a check-up. Rename it here, and switch on Irrigated if it’s watered. Up top I note the one or two things I’d look at first. Every section below shows a chip that names where its numbers come from.',
  },
  {
    id: 'history',
    needs: 'checkup',
    target: ['#checkup section[aria-labelledby="ckHist"]', '#checkup'],
    side: 'left',
    title: 'Crop history',
    body: 'What grew here each year from 2018 to 2025. Tap a year for the crop’s name. Years with no record stay blank: I never guess.',
    sources: ['CSB', 'CDL'],
  },
  {
    id: 'soil',
    needs: 'checkup',
    target: ['#checkup section[aria-labelledby="ckSoil"]', '#checkup'],
    side: 'left',
    title: 'Soil',
    body: 'Texture, drainage, organic matter and how much water the soil holds, from the soil survey at a spot in this field. A field the survey doesn’t cover is left out of the plans.',
    sources: ['SSURGO'],
  },
  {
    id: 'slope',
    needs: 'checkup',
    target: ['#checkup section[aria-labelledby="ckSlope"]', '#checkup'],
    side: 'left',
    title: 'Slope',
    body: 'How steep the field is on average, and what that means for erosion, worked out from elevation maps.',
    sources: ['DEM'],
  },
  {
    id: 'rain',
    needs: 'checkup',
    target: ['#checkup section[aria-labelledby="ckRain"]', '#checkup'],
    side: 'left',
    title: 'Rain',
    body: 'Rain from April to September for the last 10 years, against the 30-year normal (the dashed line). Once you have plans, I add any weather worries here too.',
    sources: ['POWER'],
  },
  {
    id: 'greenness',
    needs: 'checkup',
    target: ['#checkup section[aria-labelledby="ckGreen"]', '#checkup'],
    side: 'left',
    title: 'Greenness',
    body: 'How green the field was through last season, seen from satellites. It can take a minute to arrive, so it may still be on its way.',
    sources: ['HLS'],
  },
  {
    id: 'jar',
    target: ['#hubJar'],
    side: 'right',
    title: 'Test your soil',
    body: 'Shake some soil in a jar of water, let it settle, and take a photo. I read the layers as sand, silt and clay, plan with your result, and stand the jar by that field’s gate.',
  },
  {
    id: 'time',
    optional: true,
    target: ['#timebar'],
    side: 'bottom',
    title: 'Through the years',
    body: 'Step back through the years to see what grew where, or press play to watch your farm change. The moon button sets the time of day, the season and a festival theme.',
    try: { text: 'Step back a year, or press play.', wait: 'timeMoved' },
  },
  {
    id: 'plan',
    target: ['#hubPlan'],
    side: 'bottom',
    title: 'Plan my next seasons',
    body: 'I work out three plans for your next three seasons from 24 years of NASA weather, your soil and your crop history: Keep going (your rotation as it is), Most profit, and my pick for what matters to you.',
    try: { text: 'Tap it to see your plans.', wait: 'plansOpened' },
  },
  {
    id: 'farm',
    needs: 'plans',
    target: ['#plans [data-act="futures"]', '#plans'],
    side: 'bottom',
    title: 'See them on the farm',
    body: 'Here are your plans, side by side. “See them on the farm” puts them on the island, so you can flip between plans and seasons and watch each field change.',
    busyBody: 'I’m working out your plans now. When they’re ready, “See them on the farm” puts them on the island, so you can flip between plans and seasons and watch each field change.',
    try: { text: 'Tap “See them on the farm” when it shows up.', wait: 'futuresOpened' },
  },
  {
    id: 'done',
    target: ['#hubHelp'],
    side: 'right',
    title: 'You’re all set!',
    body: 'Tap any field for a closer look whenever you like. If you want this tour again, tap the ? on Your fields.',
    next: 'Finish',
  },
];

// ------------------------------------------------------------------ memory (localStorage, may throw)

/**
 * Whether the tour has been seen. Storage can be missing or throw (private windows, blocked site
 * data): then the tour simply counts as not seen, and remembering it does nothing.
 * @param {() => Storage | null | undefined} getStorage
 */
export function tourMemory(getStorage, key = TOUR_KEY) {
  const store = () => { try { return getStorage() || null; } catch { return null; } };
  return {
    seen() {
      try { return store()?.getItem(key) === 'done'; } catch { return false; }
    },
    remember() {
      const s = store();
      if (!s) return false;
      try { s.setItem(key, 'done'); return true; } catch { return false; }
    },
    forget() {
      try { store()?.removeItem(key); } catch { /* nothing to forget */ }
    },
  };
}

/**
 * Should the tour start by itself? ?tour=1 always, ?tour=0 never; and not while a dev shortcut is
 * opening the plans on the farm (?futures).
 * @param {{ seen: boolean, search?: string }} o
 */
export function shouldAutoStart({ seen, search = '' }) {
  const p = new URLSearchParams(search);
  if (p.get('tour') === '1') return true;
  if (p.get('tour') === '0' || p.has('futures')) return false;
  return !seen;
}

// ------------------------------------------------------------------ navigation

/** The steps that make up this tour: optional ones only when their target is on screen. */
export function activeSteps(steps, isAvailable) {
  return steps.filter((s) => !s.optional || isAvailable(s));
}

/** "3 of 12" */
export const countLabel = (i, n) => `${i + 1} of ${n}`;

/**
 * Leaving one step for another: which panel to close (one the step left behind needed) and which to
 * open (the next one needs it). The same panel on both sides stays as it is.
 */
export function needsChange(from, to) {
  const a = from?.needs || null, b = to?.needs || null;
  return { release: a && a !== b ? a : null, ensure: b };
}

/**
 * What a key does while the tour is open: 'end', 'next', 'back' or null (left to the app).
 * The arrows are left alone while typing, or in a control that uses them itself (a slider, a select,
 * a radio group such as the year picker).
 * @param {string} key
 * @param {{ typing?: boolean, ownsArrows?: boolean, dialog?: boolean }} [where]
 *   dialog: an app dialog (the jar test) is open over the tour: its Esc closes that first
 */
export function keyAction(key, { typing = false, ownsArrows = false, dialog = false } = {}) {
  if (key === 'Escape') return dialog ? null : 'end';
  if (typing || ownsArrows) return null;
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowLeft') return 'back';
  return null;
}

// ------------------------------------------------------------------ geometry

/**
 * The union of some rects, clipped to each one's own clip rect (its scrolling panel) and to the
 * viewport. Null when nothing useful is left (under 5 px either way).
 * @param {{left: number, top: number, right: number, bottom: number, clip?: object}[]} rects
 * @param {{width: number, height: number}} vp
 */
export function unionRect(rects, vp) {
  let r = null;
  for (const b of rects) {
    if (!b || b.right - b.left <= 0 || b.bottom - b.top <= 0) continue;
    let c = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    if (b.clip) c = { left: Math.max(c.left, b.clip.left), top: Math.max(c.top, b.clip.top), right: Math.min(c.right, b.clip.right), bottom: Math.min(c.bottom, b.clip.bottom) };
    if (c.right - c.left <= 0 || c.bottom - c.top <= 0) continue;
    r = r ? { left: Math.min(r.left, c.left), top: Math.min(r.top, c.top), right: Math.max(r.right, c.right), bottom: Math.max(r.bottom, c.bottom) } : c;
  }
  if (!r) return null;
  r = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, vp.width), bottom: Math.min(r.bottom, vp.height) };
  return r.right - r.left > 4 && r.bottom - r.top > 4 ? r : null;
}

/**
 * Where the spotlight and the card go. The spotlight is the target padded (kept on screen); the card
 * takes the preferred side if it fits, else the first side with room (bottom, top, right, left),
 * else the roomiest, and is always kept inside the viewport with a margin.
 * With no target, the card sits in the middle.
 * @param {{ target: object|null, card: {width: number, height: number}, vp: {width: number, height: number}, side?: string }} o
 * @returns {{ spot: object|null, x: number, y: number, side: string }}
 */
export function placeCard({ target, card, vp, side }, { margin = 12, gap = 14, pad = 6 } = {}) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  if (!target) {
    return { spot: null, x: Math.round(clamp((vp.width - card.width) / 2, margin, vp.width - card.width - margin)), y: Math.round(clamp((vp.height - card.height) / 2, margin, vp.height - card.height - margin)), side: 'center' };
  }
  const s = {
    left: Math.max(2, target.left - pad), top: Math.max(2, target.top - pad),
    right: Math.min(vp.width - 2, target.right + pad), bottom: Math.min(vp.height - 2, target.bottom + pad),
  };
  const room = {
    right: vp.width - s.right - gap - margin - card.width,
    left: s.left - gap - margin - card.width,
    bottom: vp.height - s.bottom - gap - margin - card.height,
    top: s.top - gap - margin - card.height,
  };
  const order = [side, 'bottom', 'top', 'right', 'left'].filter((k) => k && k in room);
  const pick = order.find((k) => room[k] >= 0) || order.reduce((a, b) => (room[b] > room[a] ? b : a));
  const cx = (s.left + s.right) / 2, cy = (s.top + s.bottom) / 2;
  let x = cx - card.width / 2, y = cy - card.height / 2;
  if (pick === 'right') x = s.right + gap;
  else if (pick === 'left') x = s.left - gap - card.width;
  else if (pick === 'bottom') y = s.bottom + gap;
  else y = s.top - gap - card.height;
  return {
    spot: { left: s.left, top: s.top, width: s.right - s.left, height: s.bottom - s.top },
    x: Math.round(clamp(x, margin, vp.width - card.width - margin)),
    y: Math.round(clamp(y, margin, vp.height - card.height - margin)),
    side: pick,
  };
}

/** What Manami says when the tour closes. */
export const END_LINES = {
  finished: 'Have fun! Tap any field for a closer look, or plan your next seasons when you’re ready.',
  skipped: 'Okay! Tap the ? on Your fields any time to see the tour again.',
};

// ------------------------------------------------------------------ the tour on the page

const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
const ICON_TRY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" fill="currentColor"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor"/></svg>';
const ICON_DONE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.6l4.4 4.4L19 7.4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const isTyping = (t) => (t instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(t.type))
  || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || !!t?.isContentEditable;
const ownsArrows = (t) => !!t?.closest?.('[role="radiogroup"], [role="slider"], [role="listbox"], [role="tablist"], input[type="range"], select');

/**
 * @param {object} o
 * @param {{ openField: () => void, closeField: () => void, openPlans: () => void, closePlans: () => void,
 *   isOpen: (need: 'checkup'|'plans') => boolean }} o.ctx   the app's panels
 * @param {Record<string, {label: string, name: string}>} [o.sources]   fieldReport.js SOURCES
 * @param {(line: string) => void} [o.say]   Manami's line when the tour closes
 * @param {() => Storage} [o.storage]
 * @param {object[]} [o.steps]
 */
export function createWalkthrough({ ctx, sources = {}, say = () => {}, storage = () => window.localStorage, steps = STEPS } = {}) {
  const memory = tourMemory(storage);
  let ui = null;
  let list = []; // this tour's steps
  let index = -1;
  let owned = { checkup: false, plans: false }; // panels the tour opened (and so closes)
  let stopWait = null;
  let settle = 0;
  let tick = 0;
  let lastFocus = null;
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- targets
  const visible = (el) => {
    if (!el?.isConnected || !el.getClientRects().length || el.closest('[hidden], [inert]') || getComputedStyle(el).visibility === 'hidden') return false;
    const b = el.getBoundingClientRect();
    return b.width > 4 && b.height > 4 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth;
  };
  /** The step's elements on screen: the first selector that matches anything visible. */
  function targets(step) {
    for (const sel of step?.target || []) {
      const els = [...document.querySelectorAll(sel)].filter(visible);
      if (els.length) return els;
    }
    return [];
  }
  const clipOf = (el) => el.closest('.checkup__body, .plans__body, .hub-list')?.getBoundingClientRect() || null;

  // ---------------------------------------------------------------- "Try it" waits
  // each: (done) => cleanup; done may fire more than once
  const onBodyClass = (cls) => (done) => {
    const had = document.body.classList.contains(cls);
    const mo = new MutationObserver(() => {
      if (!had && document.body.classList.contains(cls)) done();
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  };
  const onClick = (sel) => (done) => {
    const fn = (e) => { if (e.target.closest?.(sel)) done(); };
    document.addEventListener('click', fn, true);
    return () => document.removeEventListener('click', fn, true);
  };
  const WAITS = {
    fieldOpened: onBodyClass('checkup-open'),
    plansOpened: onBodyClass('plans-open'),
    timeMoved: onClick('#timePrev, #timeNext, #timePlay, #timeYears [role="radio"]'),
    futuresOpened: onClick('#plans [data-act="futures"]'),
  };

  // ---------------------------------------------------------------- the card
  function build() {
    const el = (tag, cls, html) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      return e;
    };
    const spot = el('div', 'tour-spot');
    spot.setAttribute('aria-hidden', 'true');
    const card = el('div', 'tour-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-labelledby', 'tourTitle');
    card.setAttribute('aria-describedby', 'tourBody');
    card.tabIndex = -1;
    card.innerHTML = `
      <div class="tour-card__head">
        <img class="tour-card__face" src="/manami.svg" alt="" width="40" height="36">
        <p class="tour-card__who"><span class="tour-card__name">Manami</span><span class="tour-card__count"></span></p>
        <button class="tour-card__close" type="button" title="Skip the tour (Esc)" aria-label="Skip the tour">${ICON_CLOSE}</button>
      </div>
      <div class="tour-card__bar" aria-hidden="true"><span></span></div>
      <h2 class="tour-card__title" id="tourTitle"></h2>
      <p class="tour-card__body" id="tourBody"></p>
      <p class="tour-card__src"></p>
      <p class="tour-card__try" aria-live="polite"><span class="tour-card__try-icon"></span><span class="tour-card__try-text"></span></p>
      <div class="tour-card__foot">
        <button class="tour-card__skip" type="button">Skip tour</button>
        <span class="tour-card__spacer"></span>
        <button class="btn btn--quiet btn--small tour-card__back" type="button">Back</button>
        <button class="btn btn--primary btn--small tour-card__next" type="button">Next</button>
      </div>`;
    const q = (s) => card.querySelector(s);
    const parts = {
      spot, card,
      count: q('.tour-card__count'), bar: q('.tour-card__bar span'), title: q('.tour-card__title'), body: q('.tour-card__body'),
      src: q('.tour-card__src'), tryEl: q('.tour-card__try'), tryIcon: q('.tour-card__try-icon'), tryText: q('.tour-card__try-text'),
      skip: q('.tour-card__skip'), back: q('.tour-card__back'), next: q('.tour-card__next'),
    };
    q('.tour-card__close').addEventListener('click', () => end(false));
    parts.skip.addEventListener('click', () => end(false));
    parts.back.addEventListener('click', () => go(index - 1, true));
    parts.next.addEventListener('click', () => go(index + 1, true));
    document.body.append(spot, card);
    resize?.observe(card);
    return parts;
  }

  // ---------------------------------------------------------------- panels the steps need
  function ensure(need) {
    if (!need || ctx.isOpen(need)) return;
    owned[need] = true;
    if (need === 'checkup') ctx.openField();
    else if (need === 'plans') ctx.openPlans();
  }
  function release(need) {
    if (!need || !owned[need]) return;
    owned[need] = false;
    if (!ctx.isOpen(need)) return;
    if (need === 'checkup') ctx.closeField();
    else if (need === 'plans') ctx.closePlans();
  }

  // ---------------------------------------------------------------- open, step, close
  function start() {
    if (ui) { go(0, true); return; }
    lastFocus = document.activeElement;
    list = activeSteps(steps, (s) => targets(s).length > 0);
    owned = { checkup: false, plans: false };
    ui = build();
    document.body.classList.add('is-touring');
    addEventListener('keydown', onKey, true);
    addEventListener('resize', place);
    document.addEventListener('scroll', place, { capture: true, passive: true });
    // targets come and go (the plans arrive, a panel slides in): look again now and then
    tick = setInterval(place, 400);
    index = -1;
    go(0, true);
  }

  function maybeAutoStart({ search = location.search } = {}) {
    if (ui || !shouldAutoStart({ seen: memory.seen(), search })) return false;
    start();
    return true;
  }

  /** Closes the tour. finished: the last step's Finish; quiet: no word from Manami (the hub went away). */
  function end(finished = false, { quiet = false } = {}) {
    if (!ui) return;
    leaveStep();
    release('checkup');
    release('plans');
    memory.remember();
    resize?.disconnect();
    clearInterval(tick);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', place);
    document.removeEventListener('scroll', place, { capture: true });
    ui.spot.remove();
    ui.card.remove();
    ui = null;
    index = -1;
    document.body.classList.remove('is-touring');
    if (quiet) return;
    say(finished ? END_LINES.finished : END_LINES.skipped);
    // back where the farmer was, or to the "?" that plays it again
    const back = lastFocus?.isConnected && lastFocus !== document.body && visible(lastFocus) ? lastFocus : document.getElementById('hubHelp');
    back?.focus?.({ preventScroll: true });
  }

  function leaveStep() {
    stopWait?.();
    stopWait = null;
    clearTimeout(settle);
  }

  function go(n, focus = false) {
    if (!ui || n < 0) return;
    if (n >= list.length) { end(true); return; }
    leaveStep();
    const prev = list[index];
    const step = list[n];
    const { release: off, ensure: on } = needsChange(prev, step);
    release(off);
    ensure(on);
    index = n;

    ui.count.textContent = countLabel(n, list.length);
    ui.bar.style.width = `${((n + 1) / list.length) * 100}%`;
    ui.title.textContent = step.title;
    writeBody(step);
    const named = (step.sources || []).map((k) => sources[k]).filter(Boolean);
    ui.src.hidden = !named.length;
    ui.src.innerHTML = named.length
      ? `<span class="tour-card__src-label">From</span> ${named.map((s) => `<span class="tour-card__src-item"><span class="src-chip">${escapeHtml(s.label)}</span> ${escapeHtml(s.name)}</span>`).join('')}`
      : '';
    ui.tryEl.hidden = !step.try;
    setTried(false);
    ui.back.hidden = n === 0;
    ui.skip.hidden = n === list.length - 1;
    ui.next.textContent = step.next || 'Next';

    if (step.try && WAITS[step.try.wait]) stopWait = WAITS[step.try.wait](() => tried(n));
    reveal(step);
    watch(step);
    place();
    // after a panel slides in or a section scrolls
    setTimeout(() => { if (index === n) { reveal(step); place(); } }, 350);
    if (focus) ui.card.focus({ preventScroll: true });
  }

  function writeBody(step) {
    const busy = step.busyBody && !document.querySelector('#plans [data-act="futures"]');
    const text = busy ? step.busyBody : step.body;
    if (ui.body.textContent !== text) ui.body.textContent = text;
  }

  /** Scrolls the step's first target into view inside its panel (the check-up's sections). */
  function reveal(step) {
    const el = targets(step)[0] || (step.target?.[0] ? document.querySelector(step.target[0]) : null);
    if (!el || !el.closest('.checkup__body, .plans__body')) return;
    // a check-up section goes to the top of the panel; the rest just into view
    const block = el.closest('.checkup__body') && !el.matches('.says') ? 'start' : 'nearest';
    el.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' });
  }

  function watch(step) {
    if (!resize || !ui) return;
    resize.disconnect();
    resize.observe(ui.card);
    for (const el of targets(step)) resize.observe(el);
  }

  // the farmer did what the step asked: say so, then move on once they pause
  function tried(n) {
    if (index !== n || !ui) return;
    setTried(true);
    clearTimeout(settle);
    settle = setTimeout(() => { if (index === n) go(n + 1, true); }, SETTLE_MS);
  }
  function setTried(done) {
    const step = list[index];
    ui.tryEl.classList.toggle('is-done', done);
    ui.tryIcon.innerHTML = done ? ICON_DONE : ICON_TRY;
    ui.tryText.textContent = done ? 'Nice! On we go…' : `Try it: ${step?.try?.text || ''}`;
  }

  function onKey(e) {
    if (!ui) return;
    const t = e.target;
    const action = keyAction(e.key, {
      typing: isTyping(t),
      ownsArrows: ownsArrows(t),
      dialog: document.body.classList.contains('jar-open'),
    });
    if (!action) return;
    e.preventDefault();
    e.stopPropagation(); // the hub's own Esc (back to the whole farm) and the panels' wait
    if (action === 'end') end(false);
    else go(index + (action === 'next' ? 1 : -1), true);
  }

  function place() {
    if (!ui) return;
    const step = list[index];
    if (step?.busyBody) writeBody(step);
    const els = targets(step);
    const vp = { width: document.documentElement.clientWidth, height: innerHeight };
    const target = unionRect(els.map((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, clip: clipOf(el) };
    }), vp);
    const p = placeCard({ target, card: { width: ui.card.offsetWidth, height: ui.card.offsetHeight }, vp, side: step?.side });
    ui.spot.classList.toggle('is-none', !p.spot);
    const s = p.spot || { left: vp.width / 2, top: vp.height / 2, width: 0, height: 0 };
    Object.assign(ui.spot.style, { left: `${s.left}px`, top: `${s.top}px`, width: `${s.width}px`, height: `${s.height}px` });
    Object.assign(ui.card.style, { left: `${p.x}px`, top: `${p.y}px` });
    ui.card.dataset.side = p.side;
    ui.card.classList.toggle('is-still', reducedMotion());
  }

  return {
    start,
    maybeAutoStart,
    stop: () => end(false, { quiet: true }),
    end,
    get isOpen() { return !!ui; },
    get step() { return list[index]?.id ?? null; },
    memory,
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
