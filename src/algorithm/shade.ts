/**
 * Stage 4: shade as an edge effect between neighbouring paddocks.
 *
 * Deliberate simplification: we use the NOON shadow only. Morning and
 * evening shadows are longer but fall east/west and move through the day; noon
 * is the shadow that sits on the north neighbour longest. Good enough to show
 * that shade is negligible on broadacre paddocks and real on small strips.
 *
 *   window          = shaded crop's sensitiveMonths if set, else its whole season
 *   sun elevation   = 90 - latitude + declination(midpoint of that window)
 *   height(month)   = max height x min(1, months since planting / (season length / 2))
 *                     (ASSUMPTION: linear growth to full height at mid-season; 0 when not in the field)
 *   shadow(month)   = max(0, tall height(month) - shaded height(month)) / tan(elevation)
 *   shaded fraction = mean over window months of shadow(month) x shared north edge (E-W width) / area
 *   yield loss      = shaded fraction x (1 - shade tolerance of the shaded crop)
 *
 * So a crop only shades a neighbour in months when both are in the field and
 * it is actually taller: corn (May-Sep) next to winter wheat (sensitive Apr-Jun)
 * is near zero, because corn is still short in May-June.
 *
 * Northern hemisphere only: a paddock is shaded by the neighbour on its SOUTH side.
 */
import { MIN_SUN_ELEVATION_DEG, SHADE_TOLERANCE_UNKNOWN_DETERMINISTIC } from './constants';
import { heightM, isFallow, shadeTolerance } from './cropData';
import {
  FALLBACK_SEASONS,
  monthsIn,
  monthsOccupied,
  noonSunElevationDeg,
  seasonFor,
  seasonMidpointDay,
  seasonOverlapShare,
  shadeSensitiveWindow,
  solarDeclinationDeg,
} from './seasons';
import type { SeasonSpan } from './croptraits';
import type { CropTraits, PaddockId, PreparedFarm } from './types';

const DEG = Math.PI / 180;

export interface ShadeContribution {
  fromPaddockId: PaddockId;
  fromCropId: string;
  northEdgeM: number;
  /** Share of the shaded crop's sensitive window when the tall crop is in the field. */
  seasonOverlap: number;
  /** Mean noon shadow over the window (m), after the height ramp. */
  shadowLengthM: number;
  fraction: number;
}

export interface ShadeResult {
  /** Share of the paddock in noon shadow (0-1). Always computed: the geometry is sourced. */
  shadedFraction: number;
  sunElevationDeg: number;
  /** Tolerance used: sourced value, the caller's override (Monte Carlo draw), or the 0.5 midpoint. */
  toleranceUsed: number;
  toleranceKnown: boolean;
  /** Fraction of yield lost (0-1). */
  yieldLoss: number;
  contributions: ShadeContribution[];
  gaps: string[];
}

export const NO_SHADE: ShadeResult = {
  shadedFraction: 0,
  sunElevationDeg: 90,
  toleranceUsed: 1,
  toleranceKnown: true,
  yieldLoss: 0,
  contributions: [],
  gaps: [],
};

/**
 * Crop height in a calendar month: linear ramp from 0 at planting to full
 * height at mid-season, full after that, 0 outside the season. (Design assumption.)
 */
export function heightInMonth(maxHeight: number, span: SeasonSpan | null, month: number): number {
  if (!span || !monthsIn(span).includes(month)) return 0;
  const sincePlanting = ((month - span.plantMonth + 12) % 12) + 0.5; // mid-month
  const half = monthsOccupied(span) / 2;
  return maxHeight * Math.min(1, sincePlanting / half);
}

/** Sun elevation at noon at the midpoint of this crop's shade-sensitive window (or its season). */
export function sunElevationForCrop(latitude: number, crop: CropTraits, state: string | undefined): number {
  const span = shadeSensitiveWindow(crop, state) ?? FALLBACK_SEASONS.summer!;
  const decl = solarDeclinationDeg(seasonMidpointDay(span));
  return Math.max(MIN_SUN_ELEVATION_DEG, noonSunElevationDeg(latitude, decl));
}

/**
 * Shade on `paddockId` growing `shaded`, given what its neighbours grow that year.
 * @param neighbourCrop crop on a neighbouring paddock that year (null = unknown/empty)
 * @param toleranceOverride Monte Carlo draw for crops whose tolerance is null
 */
export function computeShade(
  prepared: PreparedFarm,
  paddockId: PaddockId,
  shaded: CropTraits,
  neighbourCrop: (id: PaddockId) => CropTraits | null,
  toleranceOverride?: number,
): ShadeResult {
  if (isFallow(shaded)) return NO_SHADE;
  const { farm, adjacency, areaM2 } = prepared;
  const area = areaM2[paddockId] ?? 0;
  if (area <= 0) return NO_SHADE;

  const gaps: string[] = [];
  const elevation = sunElevationForCrop(farm.latitude, shaded, farm.state);
  const window = shadeSensitiveWindow(shaded, farm.state);
  const windowMonths = monthsIn(window);
  const shadedSpan = seasonFor(shaded, farm.state).span;
  const tanE = Math.tan(elevation * DEG);
  let hShaded = heightM(shaded);
  if (hShaded === null) {
    hShaded = 0; // conservative: unknown height gets the full shadow
    gaps.push(`Height of ${shaded.name} is not sourced; treated as 0 m for shade (worst case).`);
  }

  const contributions: ShadeContribution[] = [];
  let fraction = 0;
  for (const nb of adjacency[paddockId] ?? []) {
    // We need the edge as seen FROM the neighbour: are we on its north side?
    const fromNb = (adjacency[nb.paddockId] ?? []).find((x) => x.paddockId === paddockId);
    if (!fromNb || fromNb.northEdgeM <= 0) continue;
    const tall = neighbourCrop(nb.paddockId);
    if (!tall) continue;
    let hTall = heightM(tall);
    if (hTall === null) {
      if (!isFallow(tall)) gaps.push(`Height of ${tall.name} is not sourced; it casts no shade in the model.`);
      hTall = 0;
    }
    const tallSpan = seasonFor(tall, farm.state).span;
    const overlap = seasonOverlapShare(window, tallSpan);
    if (overlap <= 0 || windowMonths.length === 0) continue;
    let shadowSum = 0;
    for (const m of windowMonths) {
      const diff = heightInMonth(hTall, tallSpan, m) - heightInMonth(hShaded, shadedSpan, m);
      if (diff > 0) shadowSum += diff / tanE;
    }
    const shadow = shadowSum / windowMonths.length;
    if (shadow <= 0) continue;
    const f = (shadow * fromNb.northEdgeM) / area;
    fraction += f;
    contributions.push({
      fromPaddockId: nb.paddockId,
      fromCropId: tall.id,
      shadowLengthM: shadow,
      northEdgeM: fromNb.northEdgeM,
      seasonOverlap: overlap,
      fraction: f,
    });
  }
  fraction = Math.min(1, fraction);

  const sourced = shadeTolerance(shaded);
  const toleranceKnown = sourced !== null;
  const toleranceUsed = sourced ?? toleranceOverride ?? SHADE_TOLERANCE_UNKNOWN_DETERMINISTIC;
  if (!toleranceKnown && fraction > 0) {
    gaps.push(`Shade tolerance for ${shaded.name} is not yet sourced; yield loss shown as a range.`);
  }
  return {
    shadedFraction: fraction,
    sunElevationDeg: elevation,
    toleranceUsed,
    toleranceKnown,
    yieldLoss: fraction * (1 - toleranceUsed),
    contributions,
    gaps,
  };
}
