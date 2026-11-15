// One field's check-up: what the field panel (Part 3.5) shows and what colours its status dot.
//
//   fieldReportFor(field, { profile, planWeather })   field = an app field (from the field step)
//   buildFieldReport(field, { demo, weather, profile, planWeather })   the same, with the data passed in (tests)
//
// A field with a jar test (field.jar, src/plan/jarTest.js toRecord) gets report.jar: the record, the
// soil map's texture beside it, and whether the two fall in the same planner texture bucket.
// planWeather ({ water, frost } lines from the latest plans) is passed through for the captions.
//
// Every section is the field's own fetched data, never a stand-in; a section with no data says so.
//   crop history  the outline's USDA CSB years, then CDL for the rest (src/data/cdlHistory.js); the
//                 demo farm's records are real CSB too
//   soil          SSURGO at a point in the field (src/data/soilSurvey.js)
//   slope         mean slope over the field from elevation tiles (src/data/terrain.js)
//   rain          NASA POWER growing-season rain at the farm (src/data/rain.js)
//   greenness     last season's NDVI from NASA HLS (src/data/greenness.js)

import { CROP_STYLE, cropKeyFor } from '../island/crops.js';
import { findFieldBySourceId, getField } from './farmData.js';
import { FLAG_CONFIG, erosionRisk, flagsFor, shownFlags, statusFor } from './flags.js';
import { mapTexture } from '../vendor/rotation-maxxing/data/ssurgo.ts';
import { textureBucket } from '../plan/farmInput.js';
import { cdlAvailable } from './cdlHistory.js';

/** The 8 CSB years shown in the crop history. */
export const HISTORY_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
/** How many years of growing-season rain the sparkline shows. */
export const RAIN_YEARS = 10;

/** The source chip on every number: short label and the full name for its tooltip. */
export const SOURCES = {
  CSB: { label: 'CSB', name: 'USDA NASS Crop Sequence Boundaries' },
  SSURGO: { label: 'SSURGO', name: 'USDA NRCS SSURGO soil survey' },
  CDL: { label: 'CDL', name: 'USDA NASS Cropland Data Layer (CropScape)' },
  DEM: { label: '3DEP', name: 'USGS 3DEP elevation (NASA SRTM outside the US), via AWS Terrain Tiles' },
  POWER: { label: 'POWER', name: 'NASA POWER monthly rainfall' },
  HLS: { label: 'HLS', name: 'NASA Harmonized Landsat Sentinel-2 (HLS), via Microsoft Planetary Computer' },
};

/** The demo data record behind an app field, or null (a field on any other farm). */
export function demoRecordFor(field) {
  if (!field) return null;
  if (field.demoId) return getField(field.demoId); // dev copies of the demo fields
  return field.sourceIds?.length === 1 ? findFieldBySourceId(field.sourceIds[0]) : null;
}

const titleCase = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/**
 * @param {object} field  app field: { id, name, acres, crops?, cdlYears?, soil?, slopePct?, rain?, ndvi?, jar?, sourceIds?, demoId? }
 * @param {object} [o]
 * @param {object|null} [o.demo]     the demo record (only its real CSB cropHistory and acres are used)
 * @param {object|null} [o.weather] { growingSeasonRainMm: [{year, value}], avg30yrRainMm } (field.rain)
 * @param {object|null} [o.profile] farmProfile ({ irrigatedFieldIds })
 * @param {object|null} [o.planWeather] { water, frost } lines from the latest plans, passed through
 * @param {boolean} [o.cdl]          whether CropScape can be reached from this site (no on GitHub Pages)
 * @param {object} [o.status]        where each source has got to for this field (src/data/loadStatus.js):
 *   { crops, soil, slope, rain, greenness: { state: 'loading'|'done'|'none'|'failed', reason } }, so an
 *   empty section can say "still checking", "no data here" or "couldn't reach"
 */
export function buildFieldReport(field, { demo = null, weather = null, profile = null, cfg = FLAG_CONFIG, planWeather = null, cdl = cdlAvailable(), status = {} } = {}) {
  // crop history: the outline's own years first, the demo record's for any it lacks
  const byYear = new Map();
  for (const c of demo?.cropHistory || []) if (c?.crop != null) byYear.set(Number(c.year), c.crop);
  for (const [y, c] of Object.entries(field.crops || {})) if (c != null) byYear.set(Number(y), c);
  const history = HISTORY_YEARS.map((year) => {
    const crop = byYear.has(year) ? byYear.get(year) : null;
    const key = crop == null ? null : cropKeyFor(crop);
    const label = crop == null ? null : key === 'other' ? titleCase(crop) : CROP_STYLE[key]?.label || titleCase(crop);
    return { year, crop, key, label };
  });
  const known = history.filter((h) => h.crop != null).map(({ year, crop }) => ({ year, crop }));

  const s = field.soil?.display || null;
  const soil = s
    ? { texture: s.texture ?? null, drainage: s.drainage ?? null, organicMatterPct: s.organicMatterPct ?? null, waterHoldingIn: s.waterHoldingIn ?? null }
    : null;
  const slopePct = Number.isFinite(field.slopePct) ? field.slopePct : null;
  const slope = slopePct == null ? null : { pct: slopePct, risk: erosionRisk(slopePct, cfg) };

  let rain = null;
  const series = weather?.growingSeasonRainMm;
  if (series?.length && Number.isFinite(weather.avg30yrRainMm)) {
    const sorted = [...series].sort((a, b) => a.year - b.year);
    const recent = sorted.slice(-cfg.dryYears);
    rain = {
      years: sorted.slice(-RAIN_YEARS),
      avg30: weather.avg30yrRainMm,
      recentAvg: recent.reduce((s, r) => s + r.value, 0) / recent.length,
      recentYears: recent.length,
    };
  }

  const ndvi = Array.isArray(field.ndvi) && field.ndvi.length ? field.ndvi : null;
  const flags = flagsFor({ cropHistory: known, slopePct, rain: rain && { years: [...series], avg30: rain.avg30 } }, cfg);
  const irrigated = !!profile?.irrigatedFieldIds?.includes(field.id);
  const jar = field.jar
    ? { ...field.jar, mapTexture: soil?.texture ?? null,
        sameAsMap: soil?.texture ? textureBucket(soil.texture) === mapTexture(field.jar.sandPct, field.jar.clayPct) : false }
    : null;
  return {
    id: field.id,
    name: field.name,
    acres: Number.isFinite(field.acres) ? field.acres : demo?.acres ?? null,
    irrigated,
    history,
    soil,
    slope,
    rain,
    ndvi,
    flags,
    shown: shownFlags(flags, cfg),
    // nothing known about it (no crop years, soil, slope or rain): grey, not a green "all clear"
    status: known.length || soil || slope || rain ? statusFor(flags, cfg) : 'unknown',
    placeholder: {}, // nothing is a stand-in any more
    cdlYears: field.cdlYears || [],
    cdlOff: !cdl, // the missing years can't be looked up from this site (no CropScape proxy)
    jar,
    planWeather: planWeather ?? null,
    sources: Object.fromEntries(['crops', 'soil', 'slope', 'rain', 'greenness'].map((k) => [k, status?.[k]?.state ?? null])),
  };
}

/**
 * The report for an app field: its demo record (for real CSB crop years only), its fetched rain,
 * and where each source has got to for it (status).
 */
export function fieldReportFor(field, { profile = null, planWeather = null, status = {} } = {}) {
  return buildFieldReport(field, { demo: demoRecordFor(field), weather: field.rain || null, profile, planWeather, status });
}
