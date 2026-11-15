// Small drawn icons for "See them on the farm" (src/screens/planFutures.js): the plans, the score
// tiles, the warning lenses and the dock's buttons. No emoji anywhere.
//
// The cozy-kit line style: 24×24, stroke currentColor at 2.2 with round caps and joins, soft fills
// at fill-opacity .2, hidden from screen readers (the button or label next to each says it).
// Size comes from CSS (.btn svg is 20px).
import { cropIcon } from './cropIcons.js';
import { APP_CROP } from '../plan/farmInput.js';

const S = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SOFT = 'fill="currentColor" fill-opacity=".2"';

// the coin and the leaf, as on the check-in's priority buttons (src/screens/checkin.js)
const COIN = '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14.6 9.4c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 1.9 0 1.2 1.1 1.7 2.7 2s2.8.9 2.8 2.1-1.2 2-2.8 2c-1.3 0-2.4-.6-2.8-1.5M12 6.4V8M12 16v1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const LEAF = '<path d="M12 20v-7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 13c0-3.6-2.6-6.2-6.4-6.2 0 3.6 2.6 6.2 6.4 6.2zM12 11.2c0-3.1 2.2-5.6 5.8-5.6 0 3.1-2.2 5.6-5.8 5.6z" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5.5 20h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
// two arrows chasing each other round a loop
const LOOP = '<path d="M19.5 10.5a7.6 7.6 0 0 0-13.4-3.3"/><path d="M5.6 3.6v3.8h3.8"/><path d="M4.5 13.5a7.6 7.6 0 0 0 13.4 3.3"/><path d="M18.4 20.4v-3.8h-3.8"/>';

/** The four views of the farm: Keep going, Most profit, Manami’s pick, Your plan. */
export const PLAN_ICONS = {
  current: S(LOOP),
  maxProfit: S(COIN),
  priority: '<img src="/manami.svg" alt="" width="20" height="18">',
  // a pencil writing, with a tick beside it
  mix: S(`<path d="M13.6 5.4l3 3L8.4 16.6l-3.9.9.9-3.9z" ${SOFT}/><path d="M11.8 7.2l3 3"/><path d="M14 17.6l2 2 4-4.4"/>`),
};

/** The score tiles: cash, a bad year, soil at the end, beats keeping going. */
export const TILE_ICONS = {
  cash: S(COIN),
  // a rain cloud: three slanted strokes under it
  badYear: S(`<path d="M7.2 14.6a4 4 0 0 1-.3-8 5.2 5.2 0 0 1 10-1 3.6 3.6 0 0 1 .4 7.2z" ${SOFT}/><path d="M8.6 17.2l-1.2 2.6M12.4 17.2l-1.2 2.6M16.2 17.2l-1.2 2.6"/>`),
  soil: S(LEAF),
  // a rosette: a round badge with two ribbon tails
  beats: S(`<circle cx="12" cy="9.2" r="5.6" ${SOFT}/><path d="M9.2 14l-1.8 6.6 3-1.6 1.6 2.4 1-6.6"/><path d="M14.8 14l1.8 6.6-3-1.6"/><path d="M10 9.4l1.4 1.4 2.8-3"/>`),
};

/** One icon per kind of warning (builder.js LENS_LABEL). */
export const LENS_ICONS = {
  // a sprout with a dot of nitrogen beside it
  nitrogen: S(`<path d="M11 20v-7"/><path d="M11 13c0-3.4-2.4-5.8-6-5.8 0 3.4 2.4 5.8 6 5.8z" ${SOFT}/><path d="M11 12c0-2.8 2-5 5.2-5 0 2.8-2 5-5.2 5z" ${SOFT}/><circle cx="18" cy="16.4" r="1.9" fill="currentColor"/><path d="M5 20h12"/>`),
  // a rounded bug with six legs
  pest: S(`<ellipse cx="12" cy="13.2" rx="4.4" ry="5.6" ${SOFT}/><path d="M12 7.6v11.2"/><path d="M9.6 7.4L8 4.6M14.4 7.4L16 4.6"/><path d="M7.6 10.6L4.4 9M7.6 13.4H4M7.6 16.2L4.4 18M16.4 10.6L19.6 9M16.4 13.4H20M16.4 16.2l3.2 1.8"/>`),
  // a drop
  water: S(`<path d="M12 3.6s-6 6.5-6 10.5a6 6 0 0 0 12 0c0-4-6-10.5-6-10.5z" ${SOFT}/><path d="M9.2 14.6a2.9 2.9 0 0 0 2.4 2.6"/>`),
  // a slope with an arrow running down it
  erosion: S(`<path d="M3 7.5l18 11H3z" ${SOFT}/><path d="M9.5 6.2l7.2 4.4"/><path d="M13.4 11.2l3.3-.6-.9-3.2"/>`),
  // two arrows circling: the same crop round again
  repeat: S(`<path d="M17.6 6.6A7.4 7.4 0 0 0 5 9.2"/><path d="M17.8 2.8v3.8H14"/><path d="M6.4 17.4A7.4 7.4 0 0 0 19 14.8"/><path d="M6.2 21.2v-3.8H10"/>`),
  // half a sun, the other half in shadow
  shade: S(`<path d="M12 7.2a4.8 4.8 0 0 0 0 9.6z" fill="currentColor"/><circle cx="12" cy="12" r="4.8"/><path d="M12 2.6v2M12 19.4v2M2.6 12h2M5.4 5.4l1.4 1.4M5.4 18.6l1.4-1.4"/>`),
  // a price tag
  market: S(`<path d="M3.6 12.4V4.6a1 1 0 0 1 1-1h7.8l8 8a1.4 1.4 0 0 1 0 2l-6.8 6.8a1.4 1.4 0 0 1-2 0z" ${SOFT}/><circle cx="8.2" cy="8.2" r="1.6"/>`),
  // a hill
  land: S(`<path d="M2.8 19.4c2.4-5.6 5.2-9 9.2-9s6.8 3.4 9.2 9z" ${SOFT}/><path d="M7.2 8.4l2.4-2.6 2 2"/>`),
};

/** The dock's and the card's buttons. */
export const ACTION_ICONS = {
  // a 2×2 grid of fields
  grid: S(`<rect x="4" y="4" width="6.6" height="6.6" rx="1.4" ${SOFT}/><rect x="13.4" y="4" width="6.6" height="6.6" rx="1.4"/><rect x="4" y="13.4" width="6.6" height="6.6" rx="1.4"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.4" ${SOFT}/>`),
  // an open book
  book: S(`<path d="M12 6.6C10.2 5.2 7.4 4.6 3.6 4.8v13.4c3.8-.2 6.6.4 8.4 1.8z" ${SOFT}/><path d="M12 6.6c1.8-1.4 4.6-2 8.4-1.8v13.4c-3.8-.2-6.6.4-8.4 1.8z"/>`),
  // as "Search again" (index.html)
  arrowLeft: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  tick: S('<path d="M5 12.6l4.4 4.4L19 7.4" stroke-width="2.6"/>'),
  // as the timebar's year steps (index.html)
  chevronLeft: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // as the panels' close buttons (index.html)
  close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>',
};

/**
 * A planner crop's icon ("cereal-rye" has none of its own, so it gets the sprout), with the
 * cover-crop dot when the season has a winter cover.
 */
export function cropIconFor(id, cover = null) {
  return `${cropIcon(APP_CROP[id] || 'other')}${cover ? '<span class="plan-crop__cover" aria-hidden="true"></span>' : ''}`;
}

/** Every icon string here, for the tests (no emoji in any). */
export const ALL_ICONS = { ...PLAN_ICONS, ...Object.fromEntries(Object.entries(TILE_ICONS).map(([k, v]) => [`tile-${k}`, v])), ...Object.fromEntries(Object.entries(LENS_ICONS).map(([k, v]) => [`lens-${k}`, v])), ...ACTION_ICONS };
