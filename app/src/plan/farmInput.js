// Turns what the app knows about a farm into the rotation planner's inputs
// (src/vendor/rotation-maxxing, see its docs/API.md):
//
//   plannerFarm({ fields, place, profile })   -> { farm, gaps }   Farm: paddocks with land, history, crops
//   plannerPriorities(profile)                -> Priorities       { profit, soilHealth, water, risk } 0-100
//   plannerMarket(county)                     -> Market           county prices per crop
//
// Everything here is plain data (no three.js, no DOM), so it can be sent to the planner's Web Worker.
// Where the app has no value, a stand-in is used and said so in `gaps` (shown with the plans).
import { mapTexture } from '../vendor/rotation-maxxing/data/ssurgo.ts';
import { continueHistory } from '../vendor/rotation-maxxing/algorithm/plans.ts';
import { cropKeyFor } from '../island/crops.js';
import { demoRecordFor } from '../data/fieldReport.js';

/**
 * App crop keys (src/island/crops.js) -> planner crop ids, as the planner's own CDL mapping does
 * (vendor data/cdl.ts). The other keys (hay, pasture, potatoes, vegetables...) have no planner crop.
 */
export const PLANNER_CROP = {
  corn: 'corn',
  soybeans: 'soybeans',
  wheat: 'winter-wheat',
  barley: 'barley',
  oats: 'oats',
  sorghum: 'sorghum',
  alfalfa: 'alfalfa',
  fallow: 'fallow',
  springwheat: 'spring-wheat',
  cotton: 'cotton',
  sunflower: 'sunflower',
  canola: 'canola',
  drybeans: 'dry-beans',
  // a rye year reads as winter wheat in the planner's history, as it did before rye had its own key
  // (the planner's CDL mapping has no grain rye; its cereal-rye is the winter cover crop)
  rye: 'winter-wheat',
};
/** Planner crop ids -> the app's crop keys (for icons, the island and the check-in's answers). */
export const APP_CROP = {
  corn: 'corn', soybeans: 'soybeans', 'winter-wheat': 'wheat', 'spring-wheat': 'springwheat', barley: 'barley', oats: 'oats',
  sorghum: 'sorghum', alfalfa: 'alfalfa', fallow: 'fallow', 'cereal-rye': 'rye', cotton: 'cotton', sunflower: 'sunflower',
  canola: 'canola', 'dry-beans': 'drybeans',
};

/**
 * The crops a Corn Belt farm can usually get seed for and sell (the roadmap's "only crops grown in
 * the county"). A stand-in until there's per-county data: Story County, Iowa grows corn, soybeans,
 * oats, wheat and alfalfa; cereal rye is the planner's winter cover crop.
 */
export const COUNTY_CROPS = ['corn', 'soybeans', 'oats', 'winter-wheat', 'alfalfa', 'cereal-rye', 'fallow'];

/** The check-in's crop answers (keys in src/screens/checkin.js) -> planner crop ids. */
const EXCLUDE = { corn: ['corn'], soybeans: ['soybeans'], wheat: ['winter-wheat', 'spring-wheat'], oats: ['oats'], alfalfa: ['alfalfa'], sorghum: ['sorghum'] };

// typical sand and clay % for the USDA texture names in the demo data, so they go through the
// planner's own texture buckets (mapTexture) just as SSURGO data would
const TEXTURE_PCT = {
  sand: [92, 3], 'loamy sand': [82, 6], 'sandy loam': [65, 10], loam: [40, 20], 'silt loam': [20, 15], silt: [7, 6],
  'sandy clay loam': [60, 27], 'clay loam': [32, 34], 'silty clay loam': [10, 34], 'sandy clay': [52, 42], 'silty clay': [7, 47], clay: [20, 55],
};

/** The largest outer ring of a GeoJSON Polygon/MultiPolygon, without the repeated closing point. */
export function outerRing(geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let best = null, bestA = -1;
  for (const rings of polys) {
    const r = rings[0];
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = r; }
  }
  const ring = best.map(([x, y]) => [x, y]);
  const [f, l] = [ring[0], ring[ring.length - 1]];
  if (ring.length > 3 && f[0] === l[0] && f[1] === l[1]) ring.pop();
  return ring;
}

/** The planner's texture bucket for a USDA texture name ("Silty clay loam" -> 'silt'), or null. */
export const textureBucket = (name) => { const p = TEXTURE_PCT[String(name || '').toLowerCase()]; return p ? mapTexture(p[0], p[1]) : null; };

const JAR_MINERAL = ['sand', 'silt', 'clay', 'fines'];

/**
 * Is a saved jar test (src/plan/jarTest.js toRecord) fit to plan with? A second check after the jar
 * test's own gate, so a record is never trusted blindly: not taken too early, not low confidence,
 * a texture class to name, sand, silt and clay real percentages adding up to 100, and at least 2
 * different soil layers.
 */
export function usableJar(j) {
  return !!j && j.v === 1 && j.elapsed !== 'short' && j.confidence !== 'low' && typeof j.textureClass === 'string' && !!j.textureClass
    && [j.sandPct, j.siltPct, j.clayPct].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
    && Math.abs(j.sandPct + j.siltPct + j.clayPct - 100) <= 1
    && new Set((Array.isArray(j.layers) ? j.layers : []).map((l) => l?.type).filter((t) => JAR_MINERAL.includes(t))).size >= 2;
}

/**
 * The planner's Land for a field, from its own soil survey (src/data/soilSurvey.js) only: no
 * stand-in soil. Slope is the field's own (elevation tiles, src/data/terrain.js), else the survey's
 * map-unit slope. A usable jar test sets the texture and nothing else: drainage, water holding,
 * organic matter and pH stay with the survey (the jar's guesses at those are by volume and only
 * shown). Returns land: null when the field has no survey, or no slope from either source.
 */
export function landFor(field, jar = field?.jar ?? null) {
  const survey = field?.soil?.land;
  if (!survey) return { land: null, known: false, why: 'soil' };
  const noSurveySlope = (field.soil.gaps || []).some((g) => /no slope/i.test(g));
  const slopePct = Number.isFinite(field.slopePct) ? field.slopePct : noSurveySlope ? null : survey.slopePct;
  if (!Number.isFinite(slopePct)) return { land: null, known: false, why: 'slope' };
  const land = { ...survey, slopePct, ph: survey.ph ?? null };
  if (!usableJar(jar)) return { land, known: true, gaps: field.soil.gaps || [] };
  return { land: { ...land, texture: mapTexture(jar.sandPct, jar.clayPct) }, known: true, jar: true, gaps: field.soil.gaps || [] };
}

/** The gap line for a field planned with its jar test (the plans panel and the field card show it). */
export function jarGapLine(name, field, jar) {
  const cls = String(jar.textureClass || '').toLowerCase();
  const survey = field?.soil?.display?.texture;
  return `${name}: soil texture from your jar test (${cls}${jar.adjusted ? ', adjusted by you' : ''}${jar.sample ? ', a sample jar' : ''})${survey ? ` instead of the soil survey (${survey})` : ''}.`;
}

/**
 * The last 3 years' main crops, oldest first, as planner ids. Only the unbroken run of plannable
 * years at the end counts: a year of hay, pasture or a gap in the record breaks it, since skipping
 * it would make an older crop look like last year's (and the planner times rotations by position).
 */
export function historyFor(field, demo) {
  return historyRunFor(field, demo).history;
}

/** historyFor, plus the year of its newest crop (null when there's none). */
export function historyRunFor(field, demo) {
  const byYear = new Map();
  for (const c of demo?.cropHistory || []) byYear.set(Number(c.year), c.crop);
  for (const [y, c] of Object.entries(field.crops || {})) byYear.set(Number(y), c);
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const out = [];
  for (let i = years.length - 1; i >= 0 && out.length < 3; i--) {
    const id = PLANNER_CROP[cropKeyFor(byYear.get(years[i]))];
    if (!id) break; // hay, pasture or a crop the planner doesn't know
    if (out.length && years[i] !== years[i + 1] - 1) break; // a missing year
    out.unshift(id);
  }
  return { history: out, lastYear: out.length ? years[years.length - 1] : null };
}

/**
 * The planner reads a field's history as the seasons right before the first planned one. When the
 * record stops short of that (in fall 2026 the newest survey year is 2025, and the plans start in
 * 2027), the missing seasons are filled with the field's rotation continued, the planner's own
 * "keep going" guess, so the plans really start in `firstSeason`. Returns the history and how many
 * seasons were filled in.
 */
export function historyUpTo(history, lastYear, firstSeason, name = 'Field') {
  if (!history.length || !Number.isFinite(firstSeason) || lastYear == null) return { history, filled: 0 };
  const missing = Math.min(3, Math.max(0, firstSeason - 1 - lastYear));
  if (!missing) return { history, filled: 0 };
  const { seq } = continueHistory({ name, history }, missing);
  return { history: [...history, ...seq].slice(-3), filled: missing };
}

export { cropIdsFor } from './cropIds.js';

/** A two-letter US state code from a search place ("Story County, IA", "... Iowa"), or undefined. */
export function stateOf(place) {
  const text = [place?.state, place?.detail, place?.label].filter(Boolean).join(', ');
  const m = /\b([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/.exec(text);
  if (m) return m[1];
  const name = Object.entries(STATE_NAMES).find(([, n]) => new RegExp(`\\b${n}\\b`, 'i').test(text));
  return name?.[0];
}
const STATE_NAMES = { IA: 'Iowa', IL: 'Illinois', IN: 'Indiana', NE: 'Nebraska', MN: 'Minnesota', KS: 'Kansas', OH: 'Ohio', MO: 'Missouri', SD: 'South Dakota', ND: 'North Dakota', WI: 'Wisconsin', MI: 'Michigan', KY: 'Kentucky', TX: 'Texas' };

/**
 * @param {object} o
 * @param {object[]} o.fields   app fields: { id, name, acres, geometry, crops?, sourceIds?, demoId?, jar? }
 *                              (jar: a saved jar test, src/plan/jarTest.js toRecord)
 * @param {object} [o.place]    the farm's search place ({ lat, lon, label, detail, demo })
 * @param {object} [o.profile]  farmProfile ({ irrigatedFieldIds, excludedCrops })
 */
export function plannerFarm({ fields, place = null, profile = null, firstSeason = null }) {
  const gaps = [];
  const excluded = new Set((profile?.excludedCrops || []).flatMap((k) => EXCLUDE[k] || []));
  const available = COUNTY_CROPS.filter((c) => !excluded.has(c));
  gaps.push('Crops to choose from: the usual Corn Belt crops (corn, soybeans, oats, wheat, alfalfa) until county seed data is in.');
  const skipped = [];
  const paddocks = fields.map((f) => {
    const demo = demoRecordFor(f);
    const { land, jar, why, gaps: soilGaps = [] } = landFor(f);
    if (!land) {
      skipped.push(f.name);
      gaps.push(why === 'slope'
        ? `${f.name}: no slope data is available, so this field is left out of the plans.`
        : `${f.name}: no soil data is available (the soil survey has nothing at this spot), so this field is left out of the plans.`);
      return null;
    }
    for (const g of soilGaps) gaps.push(`${f.name}: ${g}`);
    if (jar) gaps.push(jarGapLine(f.name, f, f.jar));
    const run = historyRunFor(f, demo);
    if (run.history.length < 3) gaps.push(`${f.name}: only ${run.history.length} of the last 3 years' crops are on record.`);
    const { history, filled } = historyUpTo(run.history, run.lastYear, firstSeason, f.name);
    if (filled) {
      const from = run.lastYear + 1, to = run.lastYear + filled;
      gaps.push(`${f.name}: ${from === to ? `${from}'s crop isn't` : `the ${from}-${to} crops aren't`} on record yet, so ${from === to ? 'it is' : 'they are'} taken to follow your rotation (${history.slice(-filled).join(', ')}).`);
    }
    const paddock = {
      id: f.id,
      name: f.name,
      acres: f.acres,
      polygon: { lngLat: outerRing(f.geometry) },
      land,
      history,
      availableCrops: available,
    };
    // Poorly drained ground that has been growing corn and soybeans year after year is tile drained
    // (row crops fail on undrained wet soil, and most Corn Belt cropland like it is tiled). The planner
    // counts tile as one drainage class better; without it, it would rule corn out on these fields.
    if (land.drainage === 'poor' && history.some((c) => c === 'corn' || c === 'soybeans')) {
      paddock.tileDrained = true;
      gaps.push(`${f.name}: poorly drained soil that has grown row crops, so it's taken to be tile drained.`);
    }
    return paddock;
  }).filter(Boolean);
  if (!paddocks.length && fields.length) {
    throw new Error(`No soil data is available for ${fields.length === 1 ? 'this field' : 'any of these fields'} yet, so there's nothing to plan`);
  }
  const irrigated = new Set(profile?.irrigatedFieldIds || []);
  const allIrrigated = fields.length > 0 && fields.every((f) => irrigated.has(f.id));
  if (irrigated.size && !allIrrigated) gaps.push('Some fields are irrigated: the planner treats the whole farm as dryland for now.');
  const lats = paddocks.flatMap((p) => p.polygon.lngLat.map((c) => c[1]));
  const farm = {
    latitude: Number.isFinite(place?.lat) ? place.lat : lats.reduce((a, b) => a + b, 0) / Math.max(1, lats.length),
    paddocks,
    constraints: { irrigation: allIrrigated ? 'irrigated' : 'dryland' },
  };
  const state = place?.demo ? 'IA' : stateOf(place);
  if (state) farm.state = state;
  return { farm, gaps };
}

/**
 * The check-in's ordered priorities (profit, soil-health, saving-water, low-risk) -> planner weights.
 * First pick 85, second 70, anything not picked stays near neutral (40). `risk` sets how much bad
 * years count.
 */
export function plannerPriorities(profile) {
  const picks = profile?.priorities?.length ? profile.priorities : ['profit'];
  const weight = (key) => { const i = picks.indexOf(key); return i === 0 ? 85 : i === 1 ? 70 : i >= 2 ? 60 : 40; };
  return { profit: weight('profit'), soilHealth: weight('soil-health'), water: weight('saving-water'), risk: weight('low-risk') };
}

/**
 * County prices -> the planner's Market. One price everywhere (no separate local buyer or freight)
 * and no demand cap, since the demo data has county cash prices only.
 */
export function plannerMarket(county) {
  const market = {};
  for (const [key, price] of Object.entries(county?.prices || {})) {
    const id = PLANNER_CROP[key];
    if (!id || !Number.isFinite(price)) continue;
    market[id] = { localDemand: 1e9, localPrice: price, distantPrice: price, freightPerUnit: 0 };
  }
  return market;
}
