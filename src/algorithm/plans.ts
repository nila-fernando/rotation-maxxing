/** Small helpers for building and reading plans. */
import type { CropId, Paddock, Plan } from './types';

/**
 * "Current rotation continued": find the shortest repeating pattern in the
 * paddock's history (period 1, 2 or 3) and carry it forward.
 * corn, soy, corn -> soy, corn, soy.   corn, corn, corn -> corn, corn, corn.
 * A paddock with no history continues as fallow (and says so).
 */
export function continueHistory(paddock: Paddock, years: number): { seq: CropId[]; gap: string | null } {
  const h = paddock.history.slice(-3);
  if (h.length === 0) {
    return {
      seq: Array.from({ length: years }, () => 'fallow'),
      gap: `${paddock.name} has no crop history, so its "current rotation" is shown as fallow.`,
    };
  }
  let period = h.length;
  for (let p = 1; p <= h.length; p++) {
    let ok = true;
    for (let i = p; i < h.length; i++) if (h[i] !== h[i - p]) ok = false;
    if (ok) {
      period = p;
      break;
    }
  }
  const t = h.slice();
  for (let y = 0; y < years; y++) t.push(t[t.length - period]!);
  return { seq: t.slice(h.length), gap: null };
}

export function planFromSequences(paddockIds: string[], seqs: CropId[][]): Plan {
  const sequences: Plan['sequences'] = {};
  paddockIds.forEach((id, i) => {
    sequences[id] = seqs[i]!.map((main) => ({ main }));
  });
  return { sequences };
}

/** Convenience for callers and tests: { paddockId: ['corn', 'soybeans', 'corn'] } -> Plan. */
export function planFromCrops(crops: Record<string, CropId[]>): Plan {
  const sequences: Plan['sequences'] = {};
  for (const [id, seq] of Object.entries(crops)) sequences[id] = seq.map((main) => ({ main }));
  return { sequences };
}

/** Read a complete plan as crop sequences in paddock order. Throws on gaps or unknown paddocks. */
export function sequencesFromPlan(plan: Plan, paddocks: Paddock[], years: number, knownCrops: Set<string>): CropId[][] {
  return paddocks.map((p) => {
    const slots = plan.sequences[p.id];
    if (!slots) throw new Error(`Plan has no sequence for paddock "${p.name}" (${p.id}).`);
    if (slots.length !== years) throw new Error(`Plan for "${p.name}" has ${slots.length} years; expected ${years}.`);
    return slots.map((s, y) => {
      if (!s.main) throw new Error(`Plan for "${p.name}" has no crop in year ${y + 1}.`);
      if (!knownCrops.has(s.main)) throw new Error(`Unknown crop "${s.main}" in "${p.name}" year ${y + 1}.`);
      return s.main;
    });
  });
}
