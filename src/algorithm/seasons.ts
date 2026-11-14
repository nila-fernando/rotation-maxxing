/**
 * Growing seasons and solar geometry.
 *
 * Season spans come from croptraits.ts `season[state]` (USDA Ag Handbook 628).
 * When the farm's state has no entry yet, a fallback span by season type is
 * used and an information gap is recorded.
 */
import type { CropTraits, SeasonSpan, SeasonType } from './croptraits';

/** Fallback spans (design choice, used until Handbook 628 values are entered). */
export const FALLBACK_SEASONS: Record<SeasonType, SeasonSpan | null> = {
  summer: { plantMonth: 5, harvestMonth: 9 },
  winter: { plantMonth: 10, harvestMonth: 7 },
  // Alfalfa: until sourced, the summer span sets shade timing and water months.
  perennial: { plantMonth: 5, harvestMonth: 9 },
  none: null,
};

export interface ResolvedSeason {
  span: SeasonSpan | null;
  fallback: boolean;
  gap: string | null;
}

export function seasonFor(c: CropTraits, state: string | undefined): ResolvedSeason {
  const fromData = state ? c.season[state] : undefined;
  if (fromData) return { span: fromData, fallback: false, gap: null };
  const span = FALLBACK_SEASONS[c.seasonType];
  if (!span) return { span: null, fallback: false, gap: null };
  const where = state ? `in ${state}` : '(farm state not given)';
  return {
    span,
    fallback: true,
    gap: `Planting/harvest months for ${c.name} ${where} are not entered yet; using a default ${c.seasonType} season.`,
  };
}

/** Number of calendar months the crop occupies, inclusive (May-Sep = 5, Oct-Jul = 10). */
export function monthsOccupied(span: SeasonSpan | null): number {
  if (!span) return 0;
  return ((span.harvestMonth - span.plantMonth + 12) % 12) + 1;
}

/** The calendar months (1-12) a span covers, handling spans that wrap the new year. */
export function monthsIn(span: SeasonSpan | null): number[] {
  const n = monthsOccupied(span);
  if (!span) return [];
  return Array.from({ length: n }, (_, i) => ((span.plantMonth - 1 + i) % 12) + 1);
}

/**
 * The window when shade matters for a crop: its sensitiveMonths if set
 * (winter wheat: Apr-Jun), otherwise its whole season.
 */
export function shadeSensitiveWindow(c: CropTraits, state: string | undefined): SeasonSpan | null {
  return c.sensitiveMonths ?? seasonFor(c, state).span;
}

/**
 * Share of `window` months during which `other` is also in the field (0-1).
 * Used so a crop only shades a neighbour while both are growing.
 */
export function seasonOverlapShare(window: SeasonSpan | null, other: SeasonSpan | null): number {
  const w = monthsIn(window);
  if (w.length === 0) return 0;
  const o = new Set(monthsIn(other));
  return w.filter((m) => o.has(m)).length / w.length;
}

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Day of year (1-365) of the 15th of a month. */
function midMonthDay(month: number): number {
  return DAYS_BEFORE_MONTH[month - 1]! + 15;
}

/** Day of year at the midpoint of a season (handles spans that wrap the new year). */
export function seasonMidpointDay(span: SeasonSpan): number {
  const start = midMonthDay(span.plantMonth);
  let end = midMonthDay(span.harvestMonth);
  if (end < start) end += 365;
  const mid = (start + end) / 2;
  return ((Math.round(mid) - 1) % 365) + 1;
}

/** Solar declination (degrees) on a given day of year (Cooper 1969). */
export function solarDeclinationDeg(dayOfYear: number): number {
  return 23.44 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
}

/**
 * Sun elevation at solar noon (degrees) in the northern hemisphere:
 * 90 - latitude + declination, capped at 90.
 */
export function noonSunElevationDeg(latitude: number, declinationDeg: number): number {
  return Math.min(90, 90 - latitude + declinationDeg);
}
