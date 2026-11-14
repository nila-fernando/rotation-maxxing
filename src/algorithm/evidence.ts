/**
 * Evidence: where numbers come from, and what a farmer should check locally.
 *
 * Every Term can carry `sources` (ids). This file holds the ids for data the
 * caller supplies (NASA POWER, SSURGO, CDL, market input, farmer reports) and
 * a single lookup across all source tables, so the mascot can answer
 * "where does that number come from?".
 */
import { SOURCES } from './croptraits';
import { SOIL_SOURCES } from './soilData';
import { WATER_SOURCES } from './waterParams';
import { SOURCES_ADDITIONS } from './cropTraitsUpdate';
import type { CropTraits, PaddockResult, Term } from './types';

export interface SourceInfo {
  title: string;
  url: string | null;
  covers: string;
}

/** Data sources fed in through the API (fetched by src/data or entered by the farmer). */
export const DATA_SOURCES: Record<string, SourceInfo> = {
  nasaPower: {
    title: 'NASA Prediction Of Worldwide Energy Resources (POWER), daily point API, Agroclimatology community',
    url: 'https://power.larc.nasa.gov/',
    covers: 'Daily temperature, precipitation, solar radiation, humidity and wind used for the water balance and rainfall erosivity',
  },
  ssurgo: {
    title: 'USDA NRCS Soil Survey Geographic Database (SSURGO), via Soil Data Access',
    url: 'https://sdmdataaccess.sc.egov.usda.gov/',
    covers: 'Soil texture, drainage, pH, EC, organic matter, available water capacity, K and T factors, map-unit slope',
  },
  cdl: {
    title: 'USDA NASS Cropland Data Layer, via CropScape',
    url: 'https://nassgeodata.gmu.edu/CropScape/',
    covers: 'Crop grown on each field in past years (crop history)',
  },
  marketInput: {
    title: 'Local market prices and demand entered for this farm',
    url: null,
    covers: 'Local and distant prices, freight, local demand',
  },
  farmerReport: {
    title: "The farmer's own end-of-season reports",
    url: null,
    covers: 'Reported yields and events used to calibrate this field',
  },
};

/** Normalise a Sourced<T>.source (string | string[] | null) to an id list. */
export function sourceIds(src: string | readonly string[] | null | undefined): string[] {
  if (!src) return [];
  return typeof src === 'string' ? [src] : [...src];
}

/** Look up any source id across croptraits, soil and data source tables. */
export function describeSource(id: string): SourceInfo | null {
  const all: Record<string, SourceInfo> = {
    ...(SOURCES as unknown as Record<string, SourceInfo>),
    ...(SOIL_SOURCES as unknown as Record<string, SourceInfo>),
    ...(WATER_SOURCES as unknown as Record<string, SourceInfo>),
    ...(SOURCES_ADDITIONS as unknown as Record<string, SourceInfo>),
    ...DATA_SOURCES,
  };
  return all[id] ?? null;
}

/** Every source id a plan's numbers rest on (for an evidence panel). */
export function planSources(paddocks: PaddockResult[]): string[] {
  const ids = new Set<string>();
  for (const p of paddocks) for (const y of p.years) for (const t of y.terms) t.sources?.forEach((s) => ids.add(s));
  return [...ids].sort();
}

/**
 * Things to check with a local agronomist or extension agent before acting.
 * The tool supports, and doesn't replace, local judgement.
 */
export function localReviewFor(input: {
  paddocks: PaddockResult[];
  crops: Record<string, CropTraits>;
  gaps: string[];
  usesMarketInput: boolean;
  steepPaddocks: string[];
}): string[] {
  const out: string[] = [];
  const terms: Term[] = input.paddocks.flatMap((p) => p.years.flatMap((y) => y.terms));
  const used = new Set(input.paddocks.flatMap((p) => p.sequence));

  if (terms.some((t) => t.label.startsWith('US average'))) {
    out.push('Yields start from US averages: compare them with your own records or county yields before trusting the dollar figures.');
  }
  if (terms.some((t) => t.basis === 'design' && /White mold|carried over|host year|repeat drag/.test(t.label))) {
    out.push('Pest and disease penalties (white mold, nematodes, repeats) are estimates: check local pressure with your agronomist.');
  }
  if (input.gaps.some((g) => g.startsWith('Shade tolerance'))) {
    out.push('Shade effects on narrow strips use an unknown crop tolerance: check yields along shaded edges.');
  }
  for (const id of used) {
    const c = input.crops[id];
    if (c?.requiresBuyer) out.push(`Confirm contract terms, delivery point and price for ${c.name.toLowerCase()} before planting.`);
  }
  if (!input.usesMarketInput) out.push('No local prices were entered: check prices with your local elevator or buyer.');
  for (const name of input.steepPaddocks) {
    out.push(`${name} is sloped: ask NRCS about contour, terrace or residue practices for the low-cover years.`);
  }
  if (used.has('alfalfa')) out.push('Alfalfa: check stand establishment timing and hay markets locally.');
  return out;
}
