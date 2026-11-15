// A farm as plain data, so it can be kept on this device (src/save/localStore.js) and in the
// farmer's account (src/save/cloudSync.js), and the app rebuilt from it after a reload.
//
//   makeSnapshot({ id, farm, fields, profile, plan, picks, cloud })  -> snapshot (v: SNAPSHOT_VERSION)
//   readSnapshot(raw)                                               -> snapshot, or null if it isn't one
//   summaryOf(snapshot)                                             -> { id, name, fields, acres, savedAt, demo }
//
// A snapshot holds only what the farmer chose or what was fetched for real (never a stand-in):
//   farm     the place they searched for or the demo farm ({ lat, lon, label, ... })
//   fields   each field: outline, name, acres, crop history, and the data fetched for it
//            (soil, slopePct, rain, ndvi, cdlYears) and its jar test in use (jar)
//   profile  the check-in answers { priorities, irrigatedFieldIds, excludedCrops }, or null before then
//   plan     the plan they saved { plan: { sequences }, startYear, choice? , source?, scores? }, or null
//   picks    the plan picked per field in "Plan my next seasons" ({ fieldId: kind }), or null
//   cloud    where this farm lives in each account that saved it: { [userId]: { id, synced?, gone? } }
// Photos from the jar test are never part of it (they stay in this session only).

export const SNAPSHOT_VERSION = 1;

/** The field properties that are kept (everything else on a field is rebuilt by the app). */
// (cropsOriginal, cropsByFarmer, cropsCleared: the farmer's own crop history edits, src/fields/cropEdits.js)
export const FIELD_KEYS = ['id', 'name', 'autoName', 'geometry', 'acres', 'source', 'sourceIds', 'crops', 'cdlYears', 'cropsOriginal', 'cropsByFarmer', 'cropsCleared', 'soil', 'slopePct', 'rain', 'ndvi', 'jar', 'demoId'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** A deep copy with only JSON data in it (functions, Maps and cycles can't sneak in); null if it can't be copied. */
export function plain(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function plainField(f) {
  const out = {};
  for (const k of FIELD_KEYS) if (f[k] !== undefined && f[k] !== null) out[k] = f[k];
  return plain(out);
}

function plainProfile(p) {
  if (!isObj(p)) return null;
  return {
    priorities: strings(p.priorities) ? [...p.priorities] : ['profit'],
    irrigatedFieldIds: strings(p.irrigatedFieldIds) ? [...p.irrigatedFieldIds] : [],
    excludedCrops: strings(p.excludedCrops) ? [...p.excludedCrops] : [],
  };
}

function plainPlan(p) {
  if (!isObj(p) || !isObj(p.plan?.sequences) || !Number.isFinite(p.startYear)) return null;
  const out = { plan: { sequences: p.plan.sequences }, startYear: p.startYear };
  if (isObj(p.choice)) out.choice = p.choice;
  if (p.source === 'built') out.source = 'built';
  if (isObj(p.scores)) out.scores = p.scores;
  return plain(out);
}

/**
 * The farm on screen as a snapshot.
 * @param {{ id: string, farm: object, fields: object[], profile?: object|null, plan?: object|null,
 *   picks?: object|null, cloud?: object, savedAt?: Date }} o
 */
export function makeSnapshot({ id, farm, fields, profile = null, plan = null, picks = null, cloud = {}, savedAt = new Date() }) {
  return {
    v: SNAPSHOT_VERSION,
    id,
    savedAt: savedAt.toISOString(),
    farm: plain(farm),
    fields: (fields || []).map(plainField).filter(Boolean),
    profile: plainProfile(profile),
    plan: plainPlan(plan),
    picks: isObj(picks) && Object.keys(picks).length ? plain(picks) : null,
    cloud: isObj(cloud) ? plain(cloud) : {},
  };
}

/**
 * A snapshot read back (from storage or the cloud), checked; null when it isn't one this version of
 * the app understands (a newer app's save is left alone, not misread).
 */
export function readSnapshot(raw) {
  let s = raw;
  if (typeof s === 'string') {
    try { s = JSON.parse(s); } catch { return null; }
  }
  if (!isObj(s) || s.v !== SNAPSHOT_VERSION || typeof s.id !== 'string' || !s.id) return null;
  const farm = s.farm;
  if (!isObj(farm) || !Number.isFinite(farm.lat) || !Number.isFinite(farm.lon)) return null;
  if (!Array.isArray(s.fields)) return null;
  const fields = s.fields.filter((f) => isObj(f) && typeof f.id === 'string' && isObj(f.geometry) && typeof f.name === 'string');
  return {
    v: SNAPSHOT_VERSION,
    id: s.id,
    savedAt: typeof s.savedAt === 'string' ? s.savedAt : new Date(0).toISOString(),
    farm,
    fields,
    profile: s.profile == null ? null : plainProfile(s.profile),
    plan: s.plan == null ? null : plainPlan(s.plan),
    picks: isObj(s.picks) ? s.picks : null,
    cloud: isObj(s.cloud) ? s.cloud : {},
  };
}

/** The farm's name as the farmer sees it. */
export const farmName = (farm) => String(farm?.label || farm?.name || 'My farm').slice(0, 80);

/** What a list of farms shows for one. */
export function summaryOf(s) {
  return {
    id: s.id,
    name: farmName(s.farm),
    fields: s.fields.length,
    acres: Math.round(s.fields.reduce((a, f) => a + (Number(f.acres) || 0), 0)),
    savedAt: s.savedAt,
    demo: !!s.farm?.demo,
  };
}
