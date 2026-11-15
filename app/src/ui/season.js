// The farming season for a date (US, northern hemisphere, by month):
// spring Mar–May, summer Jun–Aug, fall Sep–Nov, winter Dec–Feb. Winter spans the new year, so it's
// named by both years ("Winter 2026–27").

const NAMES = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };

/** @returns {{ key: 'spring'|'summer'|'fall'|'winter', year: number, label: string }} */
export function seasonOf(date = new Date()) {
  const m = date.getMonth(); // 0 = January
  const y = date.getFullYear();
  if (m >= 2 && m <= 4) return { key: 'spring', year: y, label: `${NAMES.spring} ${y}` };
  if (m >= 5 && m <= 7) return { key: 'summer', year: y, label: `${NAMES.summer} ${y}` };
  if (m >= 8 && m <= 10) return { key: 'fall', year: y, label: `${NAMES.fall} ${y}` };
  const start = m === 11 ? y : y - 1; // December starts the winter; January and February finish it
  return { key: 'winter', year: start, label: `${NAMES.winter} ${start}–${String(start + 1).slice(-2)}` };
}

/** A small drawn icon for each season (24×24, currentColor). */
export const SEASON_ICONS = {
  spring: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21v-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 13c0-4 2.6-6.6 7-6.6 0 4.2-2.7 6.6-7 6.6zM12 14c0-3.4-2.2-5.6-6-5.6 0 3.6 2.3 5.6 6 5.6z" fill="currentColor"/></svg>',
  summer: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4" fill="currentColor"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  fall: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.6 3.4 3-1.2-.6 3.6 3.6.4-2.4 2.8 2.6 1.8-3.8 1.2.8 3.4-3.6-1.4L12 20l-1.2-3.4-3.6 1.4.8-3.4L4.2 13.4l2.6-1.8L4.4 8.8 8 8.4l-.6-3.6 3 1.2z" fill="currentColor"/><path d="M12 11v10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  winter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M9.5 4l2.5 2.5L14.5 4M9.5 20l2.5-2.5 2.5 2.5M3.6 10.4l3.4-.9-.9-3.4M20.4 13.6l-3.4.9.9 3.4M6.1 17.9l.9-3.4-3.4-.9M17.9 6.1l-.9 3.4 3.4.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
