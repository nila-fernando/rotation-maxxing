// A farmer's own crop history: they know what they grew better than a satellite does.
//
//   applyCropEdits(field, { 2023: 'soybeans', 2021: null })  -> the field with those years changed
//   restoreCrops(field)                                       -> the field back on USDA's record
//   CROP_CHOICES                                              -> the crops offered, in a sensible order
//
// field.crops keeps crop names by year (as the USDA data does: "Corn", "Soybeans"), so everything that
// reads it (the check-up, the planner, the island, Ask Manami) takes the farmer's years as it takes
// USDA's. The first edit keeps USDA's record in field.cropsOriginal, so it can be put back, and
// field.cropsByFarmer lists the years the farmer changed (shown as theirs, and told to Manami).
// A year set to null is "not sure": no record, and the demo farm's own data doesn't fill it back in
// (field.cropsCleared).

import { CROP_STYLE, CROP_KEYS } from '../island/crops.js';

// the usual Corn Belt crops first, then the rest A to Z, then fallow and other
const FIRST = ['corn', 'soybeans', 'wheat', 'oats', 'alfalfa', 'hay', 'pasture', 'barley', 'sorghum', 'rye'];
const LAST = ['fallow', 'other'];

/** [{ key, label }] for the crop picker. */
export const CROP_CHOICES = [
  ...FIRST,
  ...CROP_KEYS.filter((k) => !FIRST.includes(k) && !LAST.includes(k)).sort((a, b) => CROP_STYLE[a].label.localeCompare(CROP_STYLE[b].label)),
  ...LAST,
].map((key) => ({ key, label: key === 'fallow' ? 'Fallow (nothing grown)' : CROP_STYLE[key].label }));

const KEYS = new Set(CROP_KEYS);

/** The name kept in field.crops for a crop key ("soybeans" -> "Soybeans"). */
export const cropNameFor = (key) => CROP_STYLE[key]?.label ?? null;

const same = (a, b) => (a ?? null) === (b ?? null);

/**
 * The field with these years changed: { year: cropKey } (null: not sure). Unknown keys and years
 * that aren't whole numbers are ignored. Returns the same field when nothing changes.
 */
export function applyCropEdits(field, edits) {
  if (!field || !edits) return field;
  const original = field.cropsOriginal ?? { ...(field.crops || {}) };
  const crops = { ...(field.crops || {}) };
  const cleared = new Set(field.cropsCleared || []);
  let changed = false;
  for (const [y, key] of Object.entries(edits)) {
    const year = Number(y);
    if (!Number.isInteger(year)) continue;
    if (key == null) {
      // (the editor sends only the years it changed, so a "not sure" here was a crop on show)
      if (year in crops) { delete crops[year]; changed = true; }
      if (!cleared.has(year)) { cleared.add(year); changed = true; }
      continue;
    }
    if (!KEYS.has(key)) continue;
    const name = cropNameFor(key);
    if (crops[year] !== name) { crops[year] = name; changed = true; }
    if (cleared.delete(year)) changed = true;
  }
  if (!changed) return field;
  return withMarks(field, crops, original, cleared);
}

/** The field back on USDA's record (as it was before the first edit). */
export function restoreCrops(field) {
  if (!field?.cropsOriginal) return field;
  const { cropsOriginal, cropsByFarmer, cropsCleared, ...rest } = field;
  return { ...rest, crops: { ...cropsOriginal } };
}

function withMarks(field, crops, original, cleared) {
  const years = new Set([...Object.keys(crops), ...Object.keys(original)].map(Number));
  const byFarmer = [...years].filter((y) => !same(crops[y], original[y]) || cleared.has(y)).sort((a, b) => a - b);
  const { cropsOriginal, cropsByFarmer, cropsCleared, ...rest } = field;
  if (!byFarmer.length) return { ...rest, crops: { ...original } }; // back where USDA had it
  const out = { ...rest, crops, cropsOriginal: original, cropsByFarmer: byFarmer };
  const kept = [...cleared].filter((y) => !(y in crops)).sort((a, b) => a - b);
  if (kept.length) out.cropsCleared = kept;
  return out;
}

/** The latest year's crop name, or null. */
export function latestCropName(crops) {
  const y = Object.keys(crops || {}).filter((k) => crops[k] != null).sort().pop();
  return y ? crops[y] : null;
}
