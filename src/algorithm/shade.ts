/**
 * Stage 4: shade as an edge effect between neighbouring paddocks.
 *
 * Deliberate simplification: we use the NOON shadow only. Morning and
 * evening shadows are longer but fall east/west and move through the day; noon
 * is the shadow that sits on the north neighbour longest. Good enough to show
 * that shade is negligible on broadacre paddocks and real on small strips.
 *
 *   sun elevation   = 90 - latitude + declination(midpoint of the SHADED crop's season)
 *   shadow length   = max(0, tall crop height - shaded crop height) / tan(elevation)
 *   shaded fraction = shadow length x shared north edge (E-W width) / shaded paddock area
 *   yield loss      = shaded fraction x (1 - shade tolerance of the shaded crop)
 *
 * Northern hemisphere only: a paddock is shaded by the neighbour on its SOUTH side.
 */
import { MIN_SUN_ELEVATION_DEG, SHADE_TOLERANCE_UNKNOWN_DETERMINISTIC } from './constants';
import { heightM, isFallow, shadeTolerance } from './cropData';
import { FALLBACK_SEASONS, noonSunElevationDeg, seasonFor, seasonMidpointDay, solarDeclinationDeg } from './seasons';
import type { CropTraits, PaddockId, PreparedFarm } from './types';

const DEG = Math.PI / 180;

export interface ShadeContribution {
  fromPaddockId: PaddockId;
  fromCropId: string;
  shadowLengthM: number;
  northEdgeM: number;
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

/** Sun elevation at noon at the midpoint of this crop's season. */
export function sunElevationForCrop(latitude: number, crop: CropTraits, state: string | undefined): number {
  const span = seasonFor(crop, state).span ?? FALLBACK_SEASONS.summer!;
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
    const shadow = Math.max(0, hTall - hShaded) / tanE;
    if (shadow <= 0) continue;
    const f = (shadow * fromNb.northEdgeM) / area;
    fraction += f;
    contributions.push({
      fromPaddockId: nb.paddockId,
      fromCropId: tall.id,
      shadowLengthM: shadow,
      northEdgeM: fromNb.northEdgeM,
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
