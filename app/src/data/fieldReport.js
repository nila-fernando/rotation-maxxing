// One field's check-up: what the field panel (Part 3.5) shows and what colours its status dot.
//
//   fieldReportFor(field, { profile, farmIsDemo })   field = an app field (from the field step)
//   buildFieldReport(field, { demo, weather, profile })   the same, with the data passed in (tests)
//
// Crop history comes from the field's own outline (USDA CSB years) or the demo data. Soil, slope,
// rain and greenness come from the demo data for now (realistic placeholders for Story County;
// the live sources come later), so other farms show "not available yet" for those.

import { CROP_STYLE, cropKeyFor } from '../island/crops.js';
import { findFieldBySourceId, getField, getMeta, getWeather } from './farmData.js';
import { FLAG_CONFIG, erosionRisk, flagsFor, shownFlags, statusFor } from './flags.js';

/** The 8 CSB years shown in the crop history. */
export const HISTORY_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
/** How many years of growing-season rain the sparkline shows. */
export const RAIN_YEARS = 10;

/** The source chip on every number: short label and the full name for its tooltip. */
export const SOURCES = {
  CSB: { label: 'CSB', name: 'USDA NASS Crop Sequence Boundaries' },
  SSURGO: { label: 'SSURGO', name: 'USDA NRCS SSURGO soil survey' },
  SRTM: { label: 'SRTM', name: 'NASA SRTM elevation (1 arc-second)' },
  POWER: { label: 'POWER', name: 'NASA POWER daily weather' },
  Landsat: { label: 'Landsat', name: 'NASA Harmonized Landsat Sentinel-2 (HLS)' },
};

/** The demo data record behind an app field, or null (a field on any other farm). */
export function demoRecordFor(field) {
  if (!field) return null;
  if (field.demoId) return getField(field.demoId); // dev copies of the demo fields
  return field.sourceIds?.length === 1 ? findFieldBySourceId(field.sourceIds[0]) : null;
}

/** Which demo values are stand-ins (from demo-farm.json's meta), by section. */
function placeholders() {
  const p = getMeta()?.placeholder || [];
  return {
    soil: p.includes('fields[].soil'),
    slope: p.includes('fields[].slopePct'),
    ndvi: p.includes('fields[].ndvi'),
    rain: p.includes('weather.growingSeasonRainMm'),
    history: p.includes('fields[].cropHistory'),
  };
}

const titleCase = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/**
 * @param {object} field  app field: { id, name, acres, crops?: {year: crop}, sourceIds?, demoId? }
 * @param {object} [o]
 * @param {object|null} [o.demo]     the demo record (soil, slopePct, ndvi, cropHistory)
 * @param {object|null} [o.weather] { growingSeasonRainMm: [{year, value}], avg30yrRainMm }
 * @param {object|null} [o.profile] farmProfile ({ irrigatedFieldIds })
 * @param {object} [o.placeholder]  which sections are demo stand-ins
 */
export function buildFieldReport(field, { demo = null, weather = null, profile = null, placeholder = {}, cfg = FLAG_CONFIG } = {}) {
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

  const soil = demo?.soil
    ? { texture: demo.soil.texture ?? null, drainage: demo.soil.drainage ?? null, organicMatterPct: demo.soil.organicMatterPct ?? null, waterHoldingIn: demo.soil.waterHoldingIn ?? null }
    : null;
  const slopePct = Number.isFinite(demo?.slopePct) ? demo.slopePct : null;
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

  const ndvi = Array.isArray(demo?.ndvi) && demo.ndvi.length ? demo.ndvi : null;
  const flags = flagsFor({ cropHistory: known, slopePct, rain: rain && { years: [...series], avg30: rain.avg30 } }, cfg);
  const irrigated = !!profile?.irrigatedFieldIds?.includes(field.id);
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
    placeholder: { ...placeholder, history: false },
  };
}

/**
 * The report for an app field, resolving its demo data. farmIsDemo: the farm is the demo farm, so
 * the demo farm's rain applies even to fields that aren't one of the five demo records.
 */
export function fieldReportFor(field, { profile = null, farmIsDemo = false } = {}) {
  const demo = demoRecordFor(field);
  const weather = demo || farmIsDemo ? getWeather() : null;
  return buildFieldReport(field, { demo, weather, profile, placeholder: placeholders() });
}
