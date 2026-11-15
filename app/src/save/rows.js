// A farm snapshot (src/save/snapshot.js) to and from the rows of the team's Supabase schema
// (supabase/migrations/20261115000000_init.sql), both ways:
//
//   farms       one row: owner_id, name, place (the search result), is_demo
//   fields      one per field: app_key (the app's field id), name, acres, geometry, source,
//               source_ids, crops (the field's own crop history), irrigated (from the check-in)
//   field_data  one per field and kind: soil, slope, rain, greenness, cdl (only what really arrived)
//   jar_tests   the field's jar test record; in_use marks the one the planner uses (history kept)
//   plans       the plan the farmer saved: start_year, source, choice, sequences, scores, is_current
//   profiles    the check-in's priorities and crops off the table (per person)
//
// Pure: no network here (src/save/cloudSync.js sends the rows).
import { SNAPSHOT_VERSION } from './snapshot.js';

/** Where each kind of field data comes from (field_data.source). */
export const KIND_SOURCES = {
  soil: 'USDA NRCS SSURGO',
  slope: 'USGS 3DEP elevation (AWS Terrain Tiles)',
  rain: 'NASA POWER',
  greenness: 'NASA HLS (Microsoft Planetary Computer)',
  cdl: 'USDA NASS Cropland Data Layer',
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A stable uuid-shaped id from a string (cyrb128), so the same jar test or plan always maps to the
 * same row: sending it twice updates that row instead of adding another.
 */
export function idFrom(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  const hex = [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
  // version 4 and the RFC variant, so it reads as an ordinary uuid
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A random uuid (crypto.randomUUID needs a secure page; this works on any). */
export function newId(cryptoObj = globalThis.crypto) {
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  const b = new Uint8Array(16);
  cryptoObj.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Stable JSON (keys sorted), for ids and for telling whether a row changed. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

// ---------------------------------------------------------------- snapshot -> rows

export function farmRow(snap, { id, ownerId }) {
  return {
    id,
    owner_id: ownerId,
    name: String(snap.farm?.label || 'My farm').slice(0, 200),
    place: snap.farm || {},
    is_demo: !!snap.farm?.demo,
  };
}

/** The field's own crop years (the outline's data and the farmer's edits), without the ones CDL filled in. */
function ownCrops(f) {
  const mine = new Set((f.cropsByFarmer || []).map(String));
  const cdl = new Set((f.cdlYears || []).map(String).filter((y) => !mine.has(y)));
  return Object.fromEntries(Object.entries(f.crops || {}).filter(([y, c]) => c != null && !cdl.has(String(y))));
}

/**
 * The farmer's crop history edits (src/fields/cropEdits.js) for the fields.crop_edits column: USDA's
 * record as it was, the years the farmer set, and the years they said "not sure" about. null: none.
 */
export function cropEditsOf(f) {
  if (!isObj(f.cropsOriginal) || !Array.isArray(f.cropsByFarmer) || !f.cropsByFarmer.length) return null;
  const out = { original: f.cropsOriginal, by_farmer: f.cropsByFarmer.map(Number) };
  if (Array.isArray(f.cropsCleared) && f.cropsCleared.length) out.cleared = f.cropsCleared.map(Number);
  return out;
}

export function fieldRow(f, { farmId, irrigated = false }) {
  return {
    farm_id: farmId,
    app_key: f.id,
    name: f.name,
    acres: Number.isFinite(f.acres) ? Math.round(f.acres * 100) / 100 : null,
    geometry: f.geometry,
    source: f.source ?? null,
    source_ids: Array.isArray(f.sourceIds) ? f.sourceIds.map(String) : [],
    crops: ownCrops(f),
    crop_edits: cropEditsOf(f), // (supabase/migrations/20261116000000_field_crop_edits.sql)
    irrigated: !!irrigated,
  };
}

/** The data fetched for a field, one row per kind that actually arrived. */
export function fieldDataRows(f, fieldId) {
  const rows = [];
  const add = (kind, data) => rows.push({ field_id: fieldId, kind, data, source: KIND_SOURCES[kind] });
  if (isObj(f.soil)) add('soil', f.soil);
  if (Number.isFinite(f.slopePct)) add('slope', { pct: f.slopePct });
  if (isObj(f.rain)) add('rain', f.rain);
  if (Array.isArray(f.ndvi) && f.ndvi.length) add('greenness', { series: f.ndvi });
  // what CropScape said (a year the farmer changed keeps CropScape's answer here, and theirs in fields.crops)
  const cdlCrop = (y) => (f.cropsOriginal && y in f.cropsOriginal ? f.cropsOriginal[y] : f.crops?.[y]);
  const years = (f.cdlYears || []).filter((y) => cdlCrop(y) != null);
  if (years.length) add('cdl', { crops: Object.fromEntries(years.map((y) => [String(y), cdlCrop(y)])) });
  return rows;
}

/** The jar test in use on a field, as a jar_tests row (its id follows from the field and the record). */
export function jarRow(f, fieldId) {
  if (!isObj(f.jar)) return null;
  return { id: idFrom(`jar|${fieldId}|${stableJson(f.jar)}`), field_id: fieldId, record: f.jar, in_use: true };
}

/** The saved plan as the farm's current plans row. */
export function planRow(snap, farmId) {
  const p = snap.plan;
  if (!p) return null;
  const row = {
    farm_id: farmId,
    start_year: p.startYear,
    source: p.source === 'built' ? 'built' : 'saved',
    choice: p.choice || {},
    sequences: p.plan.sequences,
    scores: p.scores || {},
    is_current: true,
  };
  // the scores arrive a moment after the save: the same plan keeps its row
  row.id = idFrom(`plan|${farmId}|${stableJson({ s: row.start_year, src: row.source, c: row.choice, q: row.sequences })}`);
  return row;
}

export function profilePatch(profile) {
  if (!profile) return null;
  return { priorities: profile.priorities?.length ? profile.priorities : ['profit'], excluded_crops: profile.excludedCrops || [] };
}

/** The fields switched to irrigated (fields.irrigated). */
export const irrigatedOf = (snap) => new Set(snap.profile?.irrigatedFieldIds || []);

// ---------------------------------------------------------------- rows -> snapshot

/**
 * A snapshot from a farm's rows (opening it on another device).
 * @param {{ farm: object, fields: object[], fieldData?: object[], jarTests?: object[], plan?: object|null,
 *   profile?: object|null, localId: string, ownerId: string }} o
 */
export function snapshotFromRows({ farm, fields, fieldData = [], jarTests = [], plan = null, profile = null, localId, ownerId }) {
  const byField = new Map();
  for (const d of fieldData) {
    if (!byField.has(d.field_id)) byField.set(d.field_id, {});
    byField.get(d.field_id)[d.kind] = d.data;
  }
  const jarOf = new Map();
  for (const j of [...jarTests].sort((a, b) => (a.created_at > b.created_at ? 1 : -1))) if (j.in_use) jarOf.set(j.field_id, j.record);

  // the app numbers its fields in the order they were picked ('field-1', 'field-2', ...): a natural sort
  const ordered = [...fields].sort((a, b) => String(a.app_key).localeCompare(String(b.app_key), 'en', { numeric: true }));
  const appFields = ordered.map((r) => {
    const d = byField.get(r.id) || {};
    const own = isObj(r.crops) ? r.crops : {};
    const cdl = isObj(d.cdl?.crops) ? d.cdl.crops : {};
    const crops = { ...cdl, ...own };
    const f = {
      id: r.app_key,
      name: r.name,
      autoName: false,
      geometry: r.geometry,
      acres: r.acres == null ? null : Number(r.acres),
      source: r.source ?? null,
      sourceIds: r.source_ids || [],
      crops: Object.keys(crops).length ? crops : null,
    };
    const edits = isObj(r.crop_edits) && isObj(r.crop_edits.original) && Array.isArray(r.crop_edits.by_farmer) && r.crop_edits.by_farmer.length ? r.crop_edits : null;
    const mine = new Set((edits?.by_farmer || []).map(String));
    const cdlYears = Object.keys(cdl).filter((y) => own[y] == null || mine.has(y)).map(Number).sort();
    if (cdlYears.length) f.cdlYears = cdlYears;
    if (edits) {
      // the farmer's own crop history: their years over USDA's, "not sure" years off the record
      f.cropsOriginal = edits.original;
      f.cropsByFarmer = edits.by_farmer.map(Number);
      const cleared = (edits.cleared || []).map(Number);
      if (cleared.length) {
        f.cropsCleared = cleared;
        for (const y of cleared) delete crops[y];
        f.crops = Object.keys(crops).length ? crops : null;
      }
    }
    if (isObj(d.soil)) f.soil = d.soil;
    if (Number.isFinite(d.slope?.pct)) f.slopePct = d.slope.pct;
    if (isObj(d.rain)) f.rain = d.rain;
    if (Array.isArray(d.greenness?.series)) f.ndvi = d.greenness.series;
    if (jarOf.has(r.id)) f.jar = jarOf.get(r.id);
    return f;
  });

  const savedPlan = plan && isObj(plan.sequences)
    ? {
      plan: { sequences: plan.sequences },
      startYear: plan.start_year,
      ...(plan.source === 'built' ? { source: 'built' } : {}),
      ...(isObj(plan.choice) && Object.keys(plan.choice).length ? { choice: plan.choice } : {}),
      ...(isObj(plan.scores) && Object.keys(plan.scores).length ? { scores: plan.scores } : {}),
    }
    : null;

  return {
    v: SNAPSHOT_VERSION,
    id: localId,
    savedAt: farm.updated_at || new Date().toISOString(),
    farm: isObj(farm.place) && Number.isFinite(farm.place.lat) ? farm.place : { label: farm.name },
    fields: appFields,
    profile: {
      priorities: profile?.priorities?.length ? [...profile.priorities] : ['profit'],
      irrigatedFieldIds: ordered.filter((r) => r.irrigated).map((r) => r.app_key),
      excludedCrops: profile?.excluded_crops ? [...profile.excluded_crops] : [],
    },
    plan: savedPlan,
    picks: savedPlan?.choice ? { ...savedPlan.choice } : null,
    cloud: { [ownerId]: { id: farm.id, synced: true } },
  };
}
