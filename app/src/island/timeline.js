// The farm through time: which year's crops, which season, how far into it, and any festival
// (Easter, Independence Day, Halloween, Thanksgiving, Christmas, New Year). Pure logic, no
// three.js, so it's easy to test.
//
//   staticState(2019)              that year's crops at the height of summer
//   nowState(new Date())           today's season, with today's occasion if there is one
//   createPlayback(years)          the play-through: spring → summer → fall → winter, year by year
//     .duration                    seconds
//     .at(seconds)                 the state at that moment
//   frostLook(look)                that look with a spring freeze's rime of frost on it
//
// A state: { year, cropYear, season, t, occasion, label, look }
//   t        0..1 through the season
//   look     what the island should show: { growth, ripe, harvested, snow, grass, leaves }

export const SEASONS = ['spring', 'summer', 'fall', 'winter'];
export const SEASON_NAMES = { spring: 'Spring', summer: 'Summer', fall: 'Fall', winter: 'Winter' };
/** First month of each season (0 = January). Winter runs December to February. */
const START_MONTH = { spring: 2, summer: 5, fall: 8, winter: 11 };
/** Where in a season a still view sits: young crops in spring, ripe ones in fall, deep snow in winter. */
export const STILL_T = { spring: 0.7, summer: 0.6, fall: 0.35, winter: 0.5 };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The season a date falls in, and how far through it (0..1). */
export function seasonAt(date) {
  const m = date.getMonth();
  const season = m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'fall' : 'winter';
  const startYear = season === 'winter' && m <= 1 ? date.getFullYear() - 1 : date.getFullYear();
  const start = new Date(startYear, START_MONTH[season], 1);
  const end = new Date(startYear, START_MONTH[season] + 3, 1);
  return { season, t: clamp01((date - start) / (end - start)), year: startYear };
}

/** The calendar date at t through a season of a given year (winter's year is the one it starts in). */
export function dateIn(year, season, t) {
  const start = new Date(year, START_MONTH[season], 1);
  const end = new Date(year, START_MONTH[season] + 3, 1);
  return new Date(start.getTime() + clamp01(t) * (end - start));
}

/** Easter Sunday in a year (the Western church's date: Meeus/Jones/Butcher). */
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Thanksgiving (US): the fourth Thursday of November. */
export function thanksgivingDay(year) {
  const first = new Date(year, 10, 1).getDay(); // 0 Sunday .. 4 Thursday
  return new Date(year, 10, 1 + ((4 - first + 7) % 7) + 21);
}

const dayAfter = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const endOf = (y, m, d) => new Date(y, m, d, 23, 59, 59);

/**
 * The festivals through a farm year that starts in spring `year` (winter runs into the next
 * January): { key, season, from, to } with real dates, in order. They show on the island with their
 * own decorations and look (src/island/decor.js, seasons.js).
 *   easter        Palm Sunday to Easter Monday
 *   independence  July 1–5 (flags, bunting, fireworks)
 *   halloween     October 15–31
 *   thanksgiving  the Saturday before to the Friday after (a harvest display)
 *   christmas     December 1–26
 *   newyear       December 30 to January 2 (fireworks)
 */
export function occasionsIn(year) {
  const easter = easterSunday(year), thanks = thanksgivingDay(year);
  return [
    { key: 'easter', season: 'spring', from: dayAfter(easter, -7), to: endOf(easter.getFullYear(), easter.getMonth(), easter.getDate() + 1) },
    { key: 'independence', season: 'summer', from: new Date(year, 6, 1), to: endOf(year, 6, 5) },
    { key: 'halloween', season: 'fall', from: new Date(year, 9, 15), to: endOf(year, 9, 31) },
    { key: 'thanksgiving', season: 'fall', from: dayAfter(thanks, -5), to: endOf(year, 10, thanks.getDate() + 1) },
    { key: 'christmas', season: 'winter', from: new Date(year, 11, 1), to: endOf(year, 11, 26) },
    { key: 'newyear', season: 'winter', from: new Date(year, 11, 30), to: endOf(year + 1, 0, 2) },
  ];
}
export const OCCASIONS = ['easter', 'independence', 'halloween', 'thanksgiving', 'christmas', 'newyear'];

/** The festival on a date, if any (see occasionsIn). */
export function occasionOn(date) {
  for (const y of [date.getFullYear(), date.getFullYear() - 1]) { // (New Year's Day belongs to last year's winter)
    const o = occasionsIn(y).find((x) => date >= x.from && date <= x.to);
    if (o) return o.key;
  }
  return null;
}

/**
 * How the island looks at t through a season.
 *   growth    crops' size, 0 (bare soil) to 1 (fully grown)
 *   ripe      crops' colour, 0 green to 1 straw
 *   harvested crops cut down to stubble
 *   snow      0..1 snow on the ground, roofs and fences
 *   grass     -1 fresh spring green .. 0 summer .. 1 dry fall straw
 *   leaves    0 green .. 1 full fall colour; > 1 (to 2) winter-bare greys
 */
export function lookAt(season, t) {
  switch (season) {
    case 'spring': return { growth: 0.05 + 0.55 * smooth(0.1, 1, t), ripe: 0, harvested: false, snow: 0.5 * (1 - smooth(0, 0.18, t)), grass: -1 + smooth(0.6, 1, t) * 0.4, leaves: 0 };
    case 'summer': return { growth: 0.6 + 0.4 * smooth(0, 0.5, t), ripe: 0, harvested: false, snow: 0, grass: -0.6 * (1 - smooth(0, 0.4, t)), leaves: 0 };
    case 'fall': {
      const cut = t >= 0.62;
      return { growth: cut ? 0.16 : 1, ripe: smooth(0, 0.5, t), harvested: cut, snow: 0.35 * smooth(0.9, 1, t), grass: smooth(0, 0.6, t), leaves: smooth(0.05, 0.55, t) };
    }
    default: // winter
      return { growth: 0, ripe: 1, harvested: true, snow: Math.max(0.35, smooth(0, 0.12, t)) * (1 - 0.5 * smooth(0.88, 1, t)), grass: 0.6, leaves: 1 + smooth(0, 0.3, t) };
  }
}

/**
 * A hard spring freeze on the farm: a light rime of frost on the ground, roofs and fences. It only
 * raises the snow (to FROST_SNOW at least, and never lowers deeper snow); the season, the crops and
 * any festival stay as they were, so nothing appears or disappears.
 */
export const FROST_SNOW = 0.3;
export const frostLook = (look) => ({ ...look, snow: Math.max(look.snow ?? 0, FROST_SNOW) });

/** "Summer 2019", "Winter 2019–20". */
export function seasonLabel(season, year) {
  return season === 'winter' ? `Winter ${year}–${String(year + 1).slice(-2)}` : `${SEASON_NAMES[season]} ${year}`;
}

function state({ year, cropYear = year, season, t, occasion = null, now = false }) {
  return { year, cropYear, season, t, occasion, now, label: seasonLabel(season, year), look: lookAt(season, t) };
}

/** A past year's crops, at the height of its summer. */
export function staticState(year) {
  return state({ year, season: 'summer', t: STILL_T.summer });
}

/**
 * A festival the farmer picked (a theme): its season at the season's usual still point (so a picked
 * Thanksgiving looks like the same day by the calendar: standing crops, no snow), for a past year
 * or now (now: true, the newest crops on record as cropYear).
 */
export function occasionState(year, key, { now = false, cropYear = year } = {}) {
  const o = occasionsIn(year).find((x) => x.key === key);
  const season = o?.season || 'summer';
  return state({ year, cropYear, season, t: STILL_T[season], occasion: o ? key : null, now });
}

/**
 * A season the farmer picked, at its still point: for a past year (that year's crops), or for now
 * (now: true, the newest crops on record as cropYear). No Halloween or Christmas: those come with
 * the real date (nowState) or the play-through.
 */
export function seasonState(year, season, { now = false, cropYear = year } = {}) {
  return state({ year, cropYear, season, t: STILL_T[season], now });
}

/**
 * Today: the real season and occasion. The crops are the newest year on record (cropYear), since
 * this year's survey isn't out yet. The season sits at its usual still point (ripe crops in fall,
 * deep snow in winter) so the farm always looks its best, not half-harvested.
 */
export function nowState(date, cropYear) {
  const { season, year } = seasonAt(date);
  return state({ year, cropYear, season, t: STILL_T[season], occasion: occasionOn(date), now: true });
}

/**
 * The play-through: every year in `years`, each season in turn (just the seasons: the festivals
 * show on today's date or when picked, not in the history). Seconds per season are in `beats`.
 */
export const BEATS = { spring: 1.05, summer: 1.05, fall: 1.15, winter: 0.95 };

export function createPlayback(years, beats = BEATS) {
  const parts = [];
  for (const year of years) for (const season of SEASONS) parts.push({ year, season, t0: 0, t1: 1, s: beats[season] });
  let total = 0;
  for (const p of parts) { p.from = total; total += p.s; }
  return {
    duration: total,
    parts,
    /** The state `seconds` into the play-through (clamped to its ends). */
    at(seconds) {
      const s = Math.max(0, Math.min(total - 1e-6, seconds));
      let lo = 0, hi = parts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (parts[mid].from <= s) lo = mid; else hi = mid - 1; }
      const p = parts[lo];
      const k = (s - p.from) / p.s;
      return state({ year: p.year, season: p.season, t: p.t0 + (p.t1 - p.t0) * k, occasion: p.occasion || null });
    },
    /** Seconds at which a year's spring starts (to start playing from a chosen year). */
    startOf(year) {
      const p = parts.find((x) => x.year === year);
      return p ? p.from : 0;
    },
  };
}

// t through a farm year's season (winter's year is the one it starts in) for a date
function tIn(year, season, date) {
  const start = new Date(year, START_MONTH[season], 1);
  const end = new Date(year, START_MONTH[season] + 3, 1);
  return clamp01((date - start) / (end - start));
}
