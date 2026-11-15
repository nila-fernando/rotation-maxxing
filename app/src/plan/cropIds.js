// The planner crop ids a farm needs: its choices, plus anything in a field's history (the planner
// throws on a crop id missing from its crop table). No imports, so the planner's Web Worker can use
// it without pulling in the rest of the app.

/** @param {{ paddocks: { availableCrops: string[], history: string[] }[] }} farm  a planner Farm */
export function cropIdsFor(farm) {
  const ids = new Set(['fallow', 'cereal-rye']);
  for (const p of farm.paddocks) { p.availableCrops.forEach((c) => ids.add(c)); p.history.forEach((c) => ids.add(c)); }
  return [...ids];
}
