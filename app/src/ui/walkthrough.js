// The guided walkthrough of the whole farm, narrated by Manami: the hub, a field's check-up, the jar
// test, the year bar, Ask Manami, the plans and their tabs, the plans on the island (the plan view),
// saving a plan, and your farms and signing in. It starts by itself the first time the hub appears
// (remembered in localStorage), and the "?" on "Your fields" plays it again.
//
// Each step spotlights part of the hub and Manami's card sits beside it: "n of N", a title, a few
// lines, where the data comes from, and sometimes a "Try it" that moves the tour on once it's done.
// Next, Back and Skip are always there; Esc skips (unless you're typing, or an app dialog is up),
// and ← and → step while the card has the focus. The dimming never takes the pointer, so the farm
// stays usable the whole way through (the pattern of Halation's tutorial). While an app dialog or
// popover is open over the hub (the jar test, the time of day), the tour steps aside until it closes.
//
// Steps name their targets as CSS selectors, tried in order: the first that matches something on
// screen gets the spotlight (several matches are lit together). A step whose target isn't on screen
// shows its card in the middle instead, and an `optional` one is left out of the tour when it starts
// (its target isn't on screen, or, for an `ai` step, the AI server doesn't answer that route). Steps
// on panels that open later (the plans, the plan view) are required, with the panel itself as their
// last target, so they're never dropped. A step's `variants` swap in another target and words while
// a mode is on (a class on <body>), and its `bodyClass` goes on <body> while it's showing (Manami
// comes out for "Ask me").
// Some steps need a panel open (`needs`: the field check-up, the plans or the plan view); the tour
// opens it, and closes it again when it leaves, but only if it was the one that opened it. A step on
// the plans can ask for one of their tabs (`tab`). Steps need other panels shut (`clear`: the field
// list waits under the plans and the plan view, Manami under the check-up): the tour puts away what
// the farmer opened, and puts their plans back at the end.
// A "Try it" moves on once it's done, unless it `stay`s (the answer takes a moment to arrive: her read,
// her take, a field's card): then the farmer reads it and presses Next.
//
//   const tour = createWalkthrough({ ctx, sources, say })
//   tour.start()              from the first step (again, if it's already open)
//   tour.maybeAutoStart()     the first time only (or ?tour=1); ?tour=0 never
//   tour.stop()               closes it without a word (the hub went away)
//   tour.isOpen
//
// The pure parts (the steps, the memory, the key map, where the card goes) are exported for tests.

import { asset } from './asset.js';

export const TOUR_KEY = 'rotation-maxxing.tour.v1';
export const SETTLE_MS = 900; // after a "Try it" is done, before the tour moves on

/**
 * The steps. target: selectors tried in order. needs: a panel the step needs open. side: where the
 * card would like to go. sources: keys of the data sources (fieldReport.js SOURCES) to name.
 * clear: a panel the step needs shut (the plans: the field list waits, inert, while they're open).
 * try: { text, wait, busyText?, stay? } with wait one of the waits in createWalkthrough; stay: once
 *   it's done, wait for Next rather than move on.
 * busyBody / try.busyText: the words while the plans are still being worked out.
 * variants: [{ when: a <body> class, ...fields to use instead while it's there }].
 * optional: left out when it isn't there as the tour starts; ai: a route the AI server must answer.
 * tab: the plans' tab to show ('rotation' | 'calendar'). bodyClass: on <body> while the step shows.
 */
export const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to your farm!',
    body: 'This island is your farm: every field you picked, with this year’s crop growing on it. Drag to turn it, scroll or pinch to zoom. Let me show you round: your fields, their check-ups, your plans and how they look on the farm. It takes a few minutes.',
    next: 'Show me',
  },
  {
    id: 'fields',
    clear: ['plans', 'futures'],
    target: ['#hubPanel'],
    side: 'right',
    title: 'Your fields',
    body: 'Every field, its acres and its latest crop. The dot says how it’s doing: grey is not checked yet, green is nothing to flag, amber is one thing to look at, red is a few. Each one lights up on the island when you point at it.',
    try: { text: 'Tap a field to open its check-up.', wait: 'fieldOpened' },
  },
  {
    id: 'checkup',
    clear: ['plans', 'futures'],
    needs: 'checkup',
    target: ['#checkup .checkup__top, #checkup .says', '#checkup'],
    side: 'left',
    title: 'A field’s check-up',
    body: 'Each field gets a check-up. Rename it here, and switch on Irrigated if it’s watered. Up top I note the one or two things I’d look at first. Every section below shows a chip that names where its numbers come from.',
  },
  {
    id: 'history',
    clear: ['plans', 'futures'],
    needs: 'checkup',
    target: ['#checkup section[aria-labelledby="ckHist"]', '#checkup'],
    side: 'left',
    title: 'Crop history',
    body: 'What grew here each year from 2018 to 2025. Tap a year for the crop’s name. Years with no record stay blank: I never guess. If you know better, “Edit crop history” lets you fix a year, and the plans follow.',
    sources: ['CSB', 'CDL'],
  },
  {
    id: 'read',
    optional: true,
    ai: 'field',
    clear: ['plans', 'futures'],
    needs: 'checkup',
    target: ['#checkup [data-read-host]', '#checkup [data-read]', '#checkup'],
    side: 'left',
    title: 'Manami’s read',
    body: 'Want it in plain words? I read the whole check-up and tell you what’s going well, what to keep an eye on, and one next step. My words come from Claude, an AI, so check them against the numbers.',
    try: { text: 'Tap “Manami’s read”. It takes a moment to arrive.', wait: 'readAsked', stay: true },
  },
  {
    id: 'land',
    clear: ['plans', 'futures'],
    needs: 'checkup',
    target: ['#checkup section[aria-labelledby="ckSoil"], #checkup section[aria-labelledby="ckSlope"]', '#checkup'],
    side: 'left',
    title: 'Soil and slope',
    body: 'Texture, drainage, organic matter and how much water the soil holds, from the soil survey at a spot in this field. Then how steep the field is, and what that means for erosion. A field the survey doesn’t cover is left out of the plans.',
    sources: ['SSURGO', 'DEM'],
  },
  {
    id: 'season',
    clear: ['plans', 'futures'],
    needs: 'checkup',
    target: ['#checkup section[aria-labelledby="ckRain"], #checkup section[aria-labelledby="ckGreen"]', '#checkup'],
    side: 'left',
    title: 'Rain and greenness',
    body: 'Rain from April to September for the last 10 years against the 30-year normal (the dashed line), and how green the field was last season, seen from satellites. The greenness can take a minute to arrive.',
    sources: ['POWER', 'HLS'],
  },
  {
    id: 'jar',
    clear: ['checkup', 'plans', 'futures'],
    target: ['#hubJar'],
    side: 'right',
    title: 'Test your soil',
    body: 'Shake some soil in a jar of water, let it settle, and take a photo. I read the layers as sand, silt and clay, plan with your result, and stand the jar by that field’s gate.',
    try: { text: 'Tap it to have a look. I’ll wait here until you close it.', wait: 'jarVisited' },
  },
  {
    id: 'time',
    optional: true,
    clear: ['checkup', 'plans', 'futures'],
    target: ['#timebar'],
    side: 'bottom',
    title: 'Through the years',
    body: 'Step back through the years to see what grew where, or press play to watch your farm change. The moon button sets the time of day, the season and a festival theme, and the speaker turns the farm’s sounds on or off.',
    try: { text: 'Step back a year, or press play.', wait: 'timeMoved' },
  },
  {
    id: 'ask',
    optional: true,
    ai: 'chat',
    clear: ['checkup', 'plans', 'futures'],
    bodyClass: 'tour-manami',
    target: ['#askOpen, #manami .manami__avatar'],
    side: 'top',
    title: 'Ask me anything',
    body: 'Got a question about your farm? Ask me here, in your own words: why a field is flagged, what a crop would earn, when to sow. I read your farm’s data to answer. My words come from Claude, an AI, and can be wrong.',
    try: { text: 'Tap “Ask me”. I’ll wait here until you close it.', wait: 'askVisited' },
  },
  {
    id: 'plan',
    clear: ['checkup', 'futures'],
    target: ['#hubPlan'],
    side: 'bottom',
    title: 'Plan my next seasons',
    body: 'I work out three plans for your next three seasons from 24 years of NASA weather, your soil and your crop history: Keep going (your rotation as it is), Most profit, and my pick for what matters to you.',
    try: { text: 'Tap it to see your plans.', wait: 'plansOpened' },
  },
  {
    id: 'rotation',
    needs: 'plans',
    tab: 'rotation',
    target: ['#plans .rot-host--switch, #plans .rot-host--ribbon', '#plans .plans__loading', '#plans'],
    side: 'left',
    title: 'Rotation first',
    body: 'Pick a plan here and see its crops field by field, season by season. A good rotation comes first: it keeps the soil healthy and pests guessing. The money comes second, further down.',
    busyBody: 'I’m working out your plans now. When they’re ready, you pick one here and see its crops field by field, season by season. The rotation comes first, the money second.',
  },
  {
    id: 'take',
    optional: true,
    ai: 'plan',
    needs: 'plans',
    tab: 'rotation',
    target: ['#plans .plans__take', '#plans .plans__loading', '#plans'],
    side: 'left',
    title: 'Manami’s take',
    body: 'Not sure which plan? I can look at each field and tell you which one I’d choose, and why. The planner checks my pick and shows its own numbers next to it.',
    try: { text: 'Tap “Manami’s take”. It takes a moment to arrive.', busyText: 'Tap “Manami’s take” when it shows up.', wait: 'takeAsked', stay: true },
    busyBody: 'Once your plans are ready, I can look at each field and tell you which one I’d choose, and why. The planner checks my pick and shows its own numbers next to it.',
  },
  {
    id: 'calendar',
    needs: 'plans',
    tab: 'calendar',
    target: ['#plans .plans__tabs, #plans .plans__cal', '#plans .plans__loading', '#plans'],
    side: 'left',
    title: 'When to sow',
    body: 'When to sow and harvest each crop in the plan, for your part of the country: from USDA’s usual planting dates and crop progress reports, and state extension guides.',
    busyBody: 'Once your plans are ready, the When to sow tab shows when to sow and harvest each crop in them, from USDA’s usual planting dates and crop progress reports.',
  },
  {
    id: 'farm',
    needs: 'plans',
    tab: 'rotation',
    target: ['#plans .plans__farm', '#plans .plans__loading', '#plans'],
    side: 'bottom',
    title: 'See it on the farm',
    body: '“See it on the farm” puts the plans on the island, so you can flip between plans and seasons and watch each field change.',
    busyBody: 'I’m working out your plans now. When they’re ready, “See it on the farm” puts them on the island, so you can flip between plans and seasons and watch each field change.',
    try: { text: 'Tap “See it on the farm”.', busyText: 'Tap “See it on the farm” when it shows up.', wait: 'futuresOpened' },
  },
  {
    id: 'futPlans',
    needs: 'futures',
    target: ['#futDock .fut-dock__row--top, #futDock .fut-dock__row--mid', '#futDock'],
    side: 'top',
    title: 'Plans and seasons',
    body: 'Your plans are on the farm now. Pick a plan up top and a season below it, and watch each field change on the island.',
    try: { text: 'Pick another plan or season.', wait: 'futurePicked' },
  },
  {
    id: 'futCard',
    needs: 'futures',
    target: ['#futFields', '#futDock'],
    side: 'top',
    title: 'Each field up close',
    body: 'This opens a card for one field: its crops in each plan and what each one would earn. Tap a field on the island to see its card.',
    try: { text: 'Tap it to open a field’s card.', wait: 'cardOpened', stay: true },
    variants: [{
      when: 'fut-card-open',
      target: ['#futCard', '#futFields'],
      side: 'left',
      body: 'Here’s one field’s card: its crops in each plan and what each would earn. Tap another field on the island to see its card, and Done puts it away.',
    }],
  },
  {
    id: 'futNotes',
    needs: 'futures',
    clear: ['futCard'],
    target: ['#futNotesBtn', '#futDock'],
    side: 'top',
    title: 'Why and watch out',
    body: 'Why I picked this plan, what it gives up next to the others, and what to watch out for field by field and year by year, like rootworm when corn follows corn.',
    try: { text: 'Tap it to have a look. I’ll wait here until you close it.', wait: 'notesVisited' },
  },
  {
    id: 'futSave',
    needs: 'futures',
    clear: ['futCard'],
    target: ['#futSave', '#futDock'],
    side: 'top',
    title: 'Save your plan',
    body: 'Happy with a plan? Use it here and it’s saved as your plan for the next three seasons. You can change it any time from “Plan my next seasons”.',
    try: { text: 'Use the plan you like.', wait: 'planSaved' },
  },
  {
    id: 'account',
    clear: ['futures'],
    target: ['#acctBtn'],
    side: 'bottom',
    title: 'Your farms',
    body: 'Your farm saves on this device by itself. Sign in with your email to keep it safe and open it on any device. There’s no password: I send you a link.',
    try: { text: 'Tap it to have a look. I’ll wait here until you close it.', wait: 'accountVisited' },
  },
  {
    id: 'done',
    clear: ['futures'],
    target: ['#hubHelp'],
    side: 'right',
    title: 'You’re all set!',
    body: 'That’s your whole farm. Tap any field for a closer look whenever you like. If you want this tour again, tap the ? on Your fields.',
    next: 'Finish',
    variants: [{
      // the plans are still open (the farmer's own): the field list waits under them
      when: 'plans-open',
      target: ['#plansClose'],
      side: 'bottom',
      body: 'Close the plans here when you’re done, then tap any field for a closer look whenever you like. If you want this tour again, tap the ? on Your fields.',
    }],
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

/**
 * The step as it is right now: its first variant whose <body> class is on, laid over it.
 * @param {object} step
 * @param {(cls: string) => boolean} isOn
 */
export function resolveStep(step, isOn) {
  const v = step?.variants?.find((x) => isOn(x.when));
  if (!v) return step;
  const { when, ...over } = v;
  return { ...step, ...over };
}

/** The steps that make up this tour: optional ones only when they're available. */
export function activeSteps(steps, isAvailable) {
  return steps.filter((s) => !s.optional || isAvailable(s));
}

/**
 * Whether an optional step can be in the tour: an AI step when the server answers its route (its
 * target may be in a panel that isn't open yet), any other when its target is on screen.
 * @param {object} step
 * @param {{ hasAi?: (route: string) => boolean, onScreen: (step: object) => boolean }} o
 */
export function stepAvailable(step, { hasAi = () => false, onScreen }) {
  if (step.ai) return !!hasAi(step.ai);
  return onScreen(step);
}

/** "3 of 12" */
export const countLabel = (i, n) => `${i + 1} of ${n}`;

/**
 * Leaving one step for another: which panel to close (one the step left behind needed), which to
 * open (the next one needs it), and which the next one needs shut whoever opened it (`clear`, a list,
 * or null). The same panel on both sides stays as it is.
 */
export function needsChange(from, to) {
  const a = from?.needs || null, b = to?.needs || null;
  const c = [to?.clear || []].flat().filter((x) => x && x !== b);
  return { release: a && a !== b ? a : null, ensure: b, clear: c.length ? c : null };
}

/**
 * What a key does while the tour is open: 'end', 'next', 'back' or null (left to the app).
 * Esc is left to a text box (it puts the old text back there) and to an open app dialog or popover
 * (it closes that first). The arrows step only from the tour's card (or with nothing focused), and
 * never while typing or in a control that uses them itself (a slider, a select, a radio group).
 * @param {string} key
 * @param {{ typing?: boolean, ownsArrows?: boolean, dialog?: boolean, inTour?: boolean }} [where]
 *   dialog: an app dialog (the jar test, the time-of-day popover) is open over the tour
 *   inTour: the focus is in the tour's card, or on nothing in particular
 */
export function keyAction(key, { typing = false, ownsArrows = false, dialog = false, inTour = true } = {}) {
  if (dialog || typing) return null;
  if (key === 'Escape') return 'end';
  if (ownsArrows || !inTour) return null;
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
 * takes the preferred side if it fits, else the first side with room (bottom, top, right, left).
 * When no side has room for all of it, it goes above or below (whichever has more room) cut down to
 * fit, so it never covers the spotlight, as long as at least `minHeight` of it is left; else the
 * roomiest side. It is always kept inside the viewport with a margin, and centred across a screen
 * it nearly fills (a phone) rather than pushed against one edge.
 * With no target, the card sits in the middle.
 * @param {{ target: object|null, card: {width: number, height: number}, vp: {width: number, height: number}, side?: string }} o
 * @returns {{ spot: object|null, x: number, y: number, side: string, maxHeight?: number }}
 */
export function placeCard({ target, card, vp, side }, { margin = 12, gap = 14, pad = 6, minHeight = 190 } = {}) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const narrow = vp.width - card.width < 2 * margin + 60;
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
  let pick = order.find((k) => room[k] >= 0);
  let height = card.height, maxHeight;
  if (!pick) {
    const v = room.top > room.bottom ? 'top' : 'bottom';
    if (card.height + room[v] >= minHeight) {
      pick = v;
      height = maxHeight = Math.floor(card.height + room[v]);
    } else {
      pick = order.reduce((a, b) => (room[b] > room[a] ? b : a));
    }
  }
  const cx = (s.left + s.right) / 2, cy = (s.top + s.bottom) / 2;
  let x = cx - card.width / 2, y = cy - height / 2;
  if (pick === 'right') x = s.right + gap;
  else if (pick === 'left') x = s.left - gap - card.width;
  else if (pick === 'bottom') y = s.bottom + gap;
  else y = s.top - gap - height;
  if (narrow && (pick === 'top' || pick === 'bottom')) x = (vp.width - card.width) / 2;
  const out = {
    spot: { left: s.left, top: s.top, width: s.right - s.left, height: s.bottom - s.top },
    x: Math.round(clamp(x, margin, vp.width - card.width - margin)),
    y: Math.round(clamp(y, margin, vp.height - height - margin)),
    side: pick,
  };
  if (maxHeight) out.maxHeight = maxHeight;
  return out;
}

/** The "Try it" line once it's done: moving on, or waiting for Next. */
export const TRIED_GO = 'Nice! On we go…';
export const TRIED_STAY = 'Nice! Press Next when you’re ready.';

/** What Manami says when the tour closes. */
export const END_LINES = {
  finished: 'Have fun! Tap any field for a closer look, or plan your next seasons when you’re ready.',
  skipped: 'Okay! Tap the ? on Your fields any time to see the tour again.',
};

// ------------------------------------------------------------------ the tour on the page

const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
const ICON_TRY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" fill="currentColor"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_DONE ='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.6l4.4 4.4L19 7.4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const isTyping = (t) => (t instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(t.type))
  || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || !!t?.isContentEditable;
const ownsArrows = (t) => !!t?.closest?.('[role="radiogroup"], [role="slider"], [role="listbox"], [role="tablist"], [role="grid"], input[type="range"], select, .bcell');
/** An app dialog or popover is open over the hub: the tour steps aside, and leaves it the keys. */
const appDialogUp = () => {
  const b = document.body.classList;
  // (acct: your farms and sign-in; ask: Ask Manami's chat)
  if (['jar-open', 'fut-notes-open', 'acct-open', 'ask-open'].some((c) => b.contains(c))) return true;
  const day = document.getElementById('dayPop');
  return !!day && !day.hidden;
};

/**
 * @param {object} o
 * @param {{ openField: () => void, closeField: () => void, openPlans: () => void, closePlans: () => void,
 *   openFutures?: () => void, closeFutures?: () => void, showPlansTab?: (tab: string) => void,
 *   isOpen: (need: 'checkup'|'plans'|'futures') => boolean, hasAi?: (route: string) => boolean }} o.ctx
 *   the app's panels, and whether the AI server answers a route ('chat', 'field', 'plan')
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
  const none = () => ({ checkup: false, plans: false, futures: false, futCard: false });
  let owned = none(); // panels the tour opened (and so closes)
  let parked = none(); // panels the farmer opened that the tour put away (and so puts back)
  let bodyClass = null; // the step's own class on <body>
  let stopWait = null;
  let settle = 0;
  let tick = 0;
  let lastFocus = null;
  let aside = false; // stepped aside for an app dialog
  // the jar opening and closing, a popover, a mode coming on: look again straight away
  const looks = typeof MutationObserver === 'function' ? new MutationObserver(() => place()) : null;
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
  // the dialog opened and then closed again (the farmer had a look)
  const onRoundTrip = (cls) => (done) => {
    let opened = document.body.classList.contains(cls);
    const mo = new MutationObserver(() => {
      const on = document.body.classList.contains(cls);
      if (on) opened = true;
      else if (opened) done();
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
    jarVisited: onRoundTrip('jar-open'),
    readAsked: onClick('#checkup [data-read]'),
    timeMoved: onClick('#timePrev, #timeNext, #timePlay, #timeYears [role="radio"]'),
    askVisited: onRoundTrip('ask-open'),
    takeAsked: onClick('#plans [data-take="ask"]'),
    futuresOpened: onBodyClass('plan-futures'),
    futurePicked: onClick('#futPlans [role="radio"], #futSeasons [role="radio"]'),
    cardOpened: onBodyClass('fut-card-open'),
    notesVisited: onRoundTrip('fut-notes-open'),
    planSaved: onClick('#futSave'),
    accountVisited: onRoundTrip('acct-open'),
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
        <img class="tour-card__face" src="${asset('/manami.svg')}" alt="" width="40" height="36">
        <p class="tour-card__who"><span class="tour-card__name">Manami</span><span class="tour-card__count"></span></p>
        <button class="tour-card__close" type="button" title="Skip the tour (Esc)" aria-label="Skip the tour">${ICON_CLOSE}</button>
      </div>
      <div class="tour-card__bar" aria-hidden="true"><span></span></div>
      <div class="tour-card__main">
        <h2 class="tour-card__title" id="tourTitle"></h2>
        <p class="tour-card__body" id="tourBody"></p>
        <p class="tour-card__src"></p>
        <p class="tour-card__try" aria-live="polite"><span class="tour-card__try-icon"></span><span class="tour-card__try-text"></span></p>
      </div>
      <div class="tour-card__more" aria-hidden="true">${ICON_MORE}</div>
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
      main: q('.tour-card__main'), src: q('.tour-card__src'), tryEl: q('.tour-card__try'), tryIcon: q('.tour-card__try-icon'), tryText: q('.tour-card__try-text'),
      skip: q('.tour-card__skip'), back: q('.tour-card__back'), next: q('.tour-card__next'),
    };
    q('.tour-card__close').addEventListener('click', () => end(false));
    parts.skip.addEventListener('click', () => end(false));
    parts.back.addEventListener('click', () => go(index - 1, true));
    parts.next.addEventListener('click', () => go(index + 1, true));
    parts.main.addEventListener('scroll', () => moreBelow(parts.main), { passive: true });
    document.body.append(spot, card);
    resize?.observe(card);
    return parts;
  }

  // ---------------------------------------------------------------- panels the steps need
  function ensure(need) {
    if (!need) return;
    if (ctx.isOpen(need)) { parked[need] = false; return; } // (the farmer opened it again: theirs)
    // the farmer's own, put away for a step that needed it shut: theirs again; else the tour's
    if (parked[need]) parked[need] = false;
    else owned[need] = true;
    open(need);
  }
  const OPEN = { checkup: 'openField', plans: 'openPlans', futures: 'openFutures' };
  const CLOSE = { checkup: 'closeField', plans: 'closePlans', futures: 'closeFutures', futCard: 'closeFutCard' };
  const open = (need) => ctx[OPEN[need]]?.();
  const close = (need) => ctx[CLOSE[need]]?.();
  /** A step needs this panel shut: the tour's own is simply closed, the farmer's is put away for later. */
  function shut(need) {
    if (!need || !ctx.isOpen(need)) return;
    if (owned[need]) owned[need] = false;
    else parked[need] = true;
    close(need);
  }
  function release(need) {
    if (!need || !owned[need]) return;
    owned[need] = false;
    if (!ctx.isOpen(need)) return;
    close(need);
  }
  function setBodyClass(cls) {
    if (cls === bodyClass) return;
    if (bodyClass) document.body.classList.remove(bodyClass);
    bodyClass = cls || null;
    if (bodyClass) document.body.classList.add(bodyClass);
  }

  // ---------------------------------------------------------------- open, step, close
  function start() {
    if (ui) { go(0, true); return; }
    lastFocus = document.activeElement;
    list = activeSteps(steps, (s) => stepAvailable(s, { hasAi: ctx.hasAi, onScreen: (x) => targets(x).length > 0 }));
    owned = none();
    parked = none();
    ui = build();
    document.body.classList.add('is-touring');
    addEventListener('keydown', onKey, true);
    addEventListener('resize', place);
    document.addEventListener('scroll', place, { capture: true, passive: true });
    looks?.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const day = document.getElementById('dayPop');
    if (day) looks?.observe(day, { attributes: true, attributeFilter: ['hidden'] });
    aside = false;
    // targets come and go (the plans arrive, a panel slides in): look again now and then
    tick = setInterval(place, 400);
    index = -1;
    go(0, true);
  }

  function maybeAutoStart({ search = location.search } = {}) {
    if (ui || !shouldAutoStart({ seen: memory.seen(), search })) return false;
    start();
    // started by itself, not from the keyboard: no focus ring until a key is pressed
    ui?.card.setAttribute('data-quiet', '');
    addEventListener('keydown', () => ui?.card.removeAttribute('data-quiet'), { once: true, capture: true });
    return true;
  }

  /** Closes the tour. finished: the last step's Finish; quiet: no word from Manami (the hub went away). */
  function end(finished = false, { quiet = false } = {}) {
    if (!ui) return;
    leaveStep();
    setBodyClass(null);
    release('futures');
    release('checkup');
    release('plans');
    // seen once it's been finished or skipped; not when the hub went away under it (it comes back)
    if (!quiet) memory.remember();
    // the farmer's own plans, put away for the field steps, come back (not when the hub went away)
    const putBack = !quiet && parked.plans && !ctx.isOpen('plans');
    parked = none();
    resize?.disconnect();
    looks?.disconnect();
    clearInterval(tick);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', place);
    document.removeEventListener('scroll', place, { capture: true });
    ui.spot.remove();
    ui.card.remove();
    ui = null;
    index = -1;
    document.body.classList.remove('is-touring');
    aside = false;
    if (quiet) return;
    if (putBack) { ctx.openPlans(); return; } // (they take the focus and the keys)
    say(finished ? END_LINES.finished : END_LINES.skipped);
    // back where the farmer was, or to the "?" that plays it again
    // back where it was; else the "?" ; else something focusable in whatever view is up (the plan view fades the hub)
    const usable = (el) => !!el?.isConnected && el !== document.body && visible(el) && !el.closest('[inert]');
    const back = [lastFocus, document.getElementById('hubHelp'), ...document.querySelectorAll('#futPlans button, #plans button, .fut-card button')].find(usable) || null;
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
    const { release: off, ensure: on, clear } = needsChange(prev, list[n]);
    release(off);
    for (const c of clear || []) shut(c);
    ensure(on);
    index = n;
    const step = current();
    if (step.tab && ctx.isOpen('plans')) ctx.showPlansTab?.(step.tab);
    setBodyClass(step.bodyClass);

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
    ui.main.scrollTop = 0;
    setTried(false);
    ui.back.hidden = n === 0;
    ui.skip.hidden = n === list.length - 1;
    ui.next.textContent = step.next || 'Next';

    if (step.try && WAITS[step.try.wait]) stopWait = WAITS[step.try.wait](() => tried(n));
    reveal(step);
    watch(step);
    place();
    // after a panel slides in or a section scrolls
    setTimeout(() => { if (index === n) { reveal(current()); place(); } }, 350);
    if (focus && !aside) ui.card.focus({ preventScroll: true });
  }

  /** This step as it is right now (another target and words while the plan view is on). */
  function current() {
    return resolveStep(list[index], (cls) => document.body.classList.contains(cls));
  }

  // the plans are still being worked out: no tabs in the plans yet (or the old ones, greyed)
  const busyNow = (step) => !!(step.busyBody || step.try?.busyText)
    && (!document.querySelector('#plans .plans__tabs') || !!document.querySelector('#plansBody.is-busy'));

  function writeBody(step) {
    const text = busyNow(step) && step.busyBody ? step.busyBody : step.body;
    if (ui.body.textContent !== text) ui.body.textContent = text;
    if (step.try && !ui.tryEl.classList.contains('is-done')) {
      const t = `Try it: ${busyNow(step) && step.try.busyText ? step.try.busyText : step.try.text}`;
      if (ui.tryText.textContent !== t) ui.tryText.textContent = t;
    }
  }

  /** Scrolls the step's first target into view inside its panel (the check-up's sections). */
  function reveal(step) {
    const el = targets(step)[0] || (step.target?.[0] ? document.querySelector(step.target[0]) : null);
    const box = el?.closest('.checkup__body, .plans__body');
    if (!box) return;
    // a check-up section goes to the top of the panel; the rest just into view. Only the panel's own
    // list scrolls: scrollIntoView would also scroll the panel itself when the list can't go far
    // enough (the last section), hiding its header for good.
    const toTop = box.matches('.checkup__body') && !el.matches('.says');
    const er = el.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const pad = 8;
    if (toTop || er.top < br.top) box.scrollTop += er.top - br.top - pad;
    else if (er.bottom > br.bottom) box.scrollTop += er.bottom - br.bottom + pad;
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
    if (current()?.try?.stay) return; // (her answer is on its way: they read it, then press Next)
    settle = setTimeout(() => { if (index === n) go(n + 1, true); }, SETTLE_MS);
  }
  function setTried(done) {
    ui.tryEl.classList.toggle('is-done', done);
    ui.tryIcon.innerHTML = done ? ICON_DONE : ICON_TRY;
    if (done) ui.tryText.textContent = current()?.try?.stay ? TRIED_STAY : TRIED_GO;
    else writeBody(current());
  }

  function onKey(e) {
    if (!ui) return;
    const t = e.target;
    const action = keyAction(e.key, {
      typing: isTyping(t),
      ownsArrows: ownsArrows(t),
      dialog: appDialogUp(),
      inTour: !t || t === document.body || t === document.documentElement || ui.card.contains(t),
    });
    if (!action) return;
    e.preventDefault();
    e.stopPropagation(); // the hub's own Esc (back to the whole farm) and the panels' wait
    if (action === 'end') end(false);
    else go(index + (action === 'next' ? 1 : -1), true);
  }

  /** Out of the way while an app dialog is open over the hub; back when it closes. */
  function stepAside(on) {
    if (on === aside) return;
    aside = on;
    ui.card.classList.toggle('is-aside', on);
    ui.spot.classList.toggle('is-aside', on);
    if (on) ui.card.setAttribute('aria-hidden', 'true');
    else ui.card.removeAttribute('aria-hidden');
    // Manami speaks for the dialog meanwhile
    document.body.classList.toggle('is-touring', !on);
  }

  /** The words are cut down to fit and there's more of them below: the card fades out at the bottom. */
  function moreBelow(main) {
    main.classList.toggle('has-more', main.scrollHeight - main.scrollTop - main.clientHeight > 2);
  }

  function place() {
    if (!ui) return;
    stepAside(appDialogUp());
    const step = current();
    if (!step) return;
    if (step.busyBody || step.try?.busyText || step.variants) writeBody(step);
    const els = targets(step);
    const vp = { width: document.documentElement.clientWidth, height: innerHeight };
    const target = unionRect(els.map((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, clip: clipOf(el) };
    }), vp);
    // its whole height, as if nothing cut it down
    ui.card.style.maxHeight = '';
    const p = placeCard({ target, card: { width: ui.card.offsetWidth, height: ui.card.offsetHeight }, vp, side: step.side });
    ui.card.style.maxHeight = p.maxHeight ? `${p.maxHeight}px` : '';
    moreBelow(ui.main);
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
    get aside() { return aside; },
    memory,
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
