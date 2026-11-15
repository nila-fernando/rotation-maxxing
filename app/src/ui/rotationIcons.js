// Drawn icons for the rotation ribbon's link signs, the farm chips and the "When to sow" tab. 24×24
// in the cozy-kit stroke (see futureIcons.js): stroke currentColor at 2.2, round caps and joins,
// soft fills at fill-opacity .2, aria-hidden (the words beside each say it). No emoji.
//
//   LINK_ICONS  what joins one season to the next: nitrogen (beans feed the corn), repeat (the same
//               crop again), break (a pest cycle broken), same-family (another grain), and cover
//               (a winter cover, drawn on the cell's edge: not a link kind itself)
//   CAL_ICONS   the calendar's marks: plant, harvest, frost, insurance, best window, clock
import { LENS_ICONS } from './futureIcons.js';

const S = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SOFT = 'fill="currentColor" fill-opacity=".2"';

export const LINK_ICONS = {
  nitrogen: LENS_ICONS.nitrogen,
  repeat: LENS_ICONS.repeat,
  // a loop cut by a gap at the top, with the two cut ends marked: the cycle doesn't come round
  break: S('<path d="M16.2 5.9A7.4 7.4 0 1 1 7.8 5.9"/><path d="M15.2 7.4l2.1-2.9M8.8 7.4L6.7 4.5"/>'),
  // a sprout under a blanket arc
  cover: S(`<path d="M3.6 13a8.4 8.4 0 0 1 16.8 0z" ${SOFT}/><path d="M12 20v-5"/><path d="M12 16.4c0-1.8-1.4-3-3.2-3 0 1.8 1.4 3 3.2 3z"/><path d="M5 20h14"/>`),
  // a neutral dot: one grain after another, nothing gained or lost
  'same-family': S(`<circle cx="12" cy="12" r="3.4" ${SOFT}/><circle cx="12" cy="12" r="3.4"/>`),
};

export const CAL_ICONS = {
  // a seed going into the ground
  plant: S(`<ellipse cx="12" cy="17.2" rx="3.4" ry="2.6" ${SOFT}/><path d="M12 3.6v8.4M8.8 9l3.2 3.2L15.2 9"/>`),
  // a sickle
  harvest: S('<path d="M6.4 19.6l3.4-3.4"/><path d="M9.8 16.2c-1.6-5.4 1.8-11 8-11.6-3.8 2.2-5.6 6.6-4.6 10.6"/>'),
  frost: LENS_ICONS.frost,
  // a small shield: the insurance date
  insurance: S(`<path d="M12 3.4l7 2.6v5.4c0 4.4-3 7.6-7 9.2-4-1.6-7-4.8-7-9.2V6z" ${SOFT}/>`),
  // a bracket round the best window
  best: S('<path d="M8 4.4H5.4v15.2H8M16 4.4h2.6v15.2H16"/><path d="M9.6 12h4.8"/>'),
  // a clock
  clock: LENS_ICONS.timing,
};

/** Every icon here, prefixed, for the tests (no emoji in any). */
export const ALL_ROTATION_ICONS = {
  ...Object.fromEntries(Object.entries(LINK_ICONS).map(([k, v]) => [`link-${k}`, v])),
  ...Object.fromEntries(Object.entries(CAL_ICONS).map(([k, v]) => [`cal-${k}`, v])),
};
