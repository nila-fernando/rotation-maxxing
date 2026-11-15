// TEST FIXTURE ONLY. The app never shows or plans with these numbers: it fetches each field's own
// soil, slope, rain and greenness (src/data/soilSurvey.js, terrain.js, rain.js, greenness.js) and
// says "no data" when they don't arrive. Tests need fixed values in the same shapes, so this hands
// the demo fields the illustrative soil, slope, rain and NDVI kept in data/demo-farm.json.
import { getWeather } from '../src/data/farmData.js';
import { mapDrainage, mapTexture } from '../src/vendor/rotation-maxxing/data/ssurgo.ts';

const TEXTURE_PCT = {
  sand: [92, 3], 'loamy sand': [82, 6], 'sandy loam': [65, 10], loam: [40, 20], 'silt loam': [20, 15], silt: [7, 6],
  'sandy clay loam': [60, 27], 'clay loam': [32, 34], 'silty clay loam': [10, 34], 'sandy clay': [52, 42], 'silty clay': [7, 47], clay: [20, 55],
};

/** { soil, slopePct, rain, ndvi } for a demo record, shaped like the fetched data. */
export function fieldData(demo) {
  const out = {};
  const s = demo?.soil;
  if (s) {
    const [sand, clay] = TEXTURE_PCT[String(s.texture || '').toLowerCase()] || [null, null];
    const land = { slopePct: demo.slopePct ?? 0, texture: mapTexture(sand, clay), drainage: mapDrainage(s.drainage || null), salinityECe: 0, ph: null };
    if (Number.isFinite(s.organicMatterPct)) land.organicMatterPct = s.organicMatterPct;
    if (Number.isFinite(s.waterHoldingIn)) land.awcInPerIn = Math.round((s.waterHoldingIn / 60) * 1000) / 1000;
    out.soil = { display: { ...s }, land, mapUnit: 'test fixture', component: 'test fixture', gaps: [] };
  }
  if (Number.isFinite(demo?.slopePct)) out.slopePct = demo.slopePct;
  const w = getWeather();
  if (w?.growingSeasonRainMm?.length) out.rain = w;
  if (Array.isArray(demo?.ndvi) && demo.ndvi.length) out.ndvi = demo.ndvi;
  return out;
}
