// Which fields "See them on the farm" outlines, and how (src/screens/planFutures.js hands the Map
// to the hub's setMarks): 'crop' (green, the crop changes), 'margin' (faint green, same crop but
// different money), 'frost' (ice blue, the wheat has a spring freeze) and 'focus' (gold, the field
// Manami is on or the card is open for). Hover and select are the hub's own and sit on top.
//
// Pure (no DOM), so node:test checks the order the marks win in.
import { frostIds, seasonChanges } from './compareFutures.js';

/**
 * The outlines for a view and season: Map id -> 'focus' | 'crop' | 'margin' | 'frost'.
 * marksBase is the plan the changes are measured against (null: no change outlines). With the frost
 * lens on (the walk's frost stop, the card's freeze peek), a frost field is ice blue even where its
 * crop changed; with it off, a change mark wins and frost shows only on a field with none. The
 * focus and card fields are gold whatever else they are.
 */
export function marksFor(cmp, view, season, choice, { marksBase = null, frostLens = false, focusId = null, cardId = null } = {}) {
  const m = new Map();
  if (marksBase && marksBase !== view) for (const [id, k] of seasonChanges(cmp, view, choice, marksBase)[season]) m.set(id, k);
  for (const id of frostIds(cmp, view, season, choice)) if (frostLens || !m.has(id)) m.set(id, 'frost');
  if (focusId) m.set(focusId, 'focus');
  if (cardId) m.set(cardId, 'focus');
  return m;
}
