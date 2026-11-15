/**
 * Water scarcity from climate: how much should "use less water" count on this farm?
 *
 *   aridity index AI = mean annual precipitation / mean annual reference ET0
 *   (both from NASA POWER; ET0 is FAO-56 Penman-Monteith)
 *
 * Classes: UNEP aridity classes (see ARIDITY_CLASSES for the cited boundaries).
 * The scarcity factor between the class anchors is a DESIGN CHOICE: 0 for humid
 * climates, rising linearly to 1 at the semi-arid/arid boundary, 1 when drier.
 * Irrigated farms always get 1: irrigation water is a real, paid resource.
 */
import { ARIDITY_CLASSES, SCARCITY_CURVE } from './waterParams';
import type { WeatherRisk } from './types';

export interface WaterScarcity {
  /** Aridity index P / ET0, null if the weather pool has no daily-weather totals. */
  aridityIndex: number | null;
  /** UNEP class name, or null. */
  aridityClass: string | null;
  /** 0-1 multiplier on the water slider. */
  scarcity: number;
  /** Plain-English sentence for the explanation. */
  explanation: string;
  irrigated: boolean;
}

/** The "water-limited?" flag for the frontend. */
export function weatherRiskFrom(w: WaterScarcity): WeatherRisk {
  const ai = w.aridityIndex;
  if (ai === null) {
    return { waterLimited: null, aridityIndex: null, aridityClass: null, message: 'Climate unknown: no daily weather was supplied.' };
  }
  const humid = ai >= SCARCITY_CURVE.zeroAt;
  const irrigated = w.irrigated ? ' Fields are irrigated, so the real water risk is the irrigation supply.' : '';
  return {
    waterLimited: !humid,
    aridityIndex: ai,
    aridityClass: w.aridityClass,
    message: humid
      ? `Weather risk here is mostly not about water (${w.aridityClass}, aridity index ${ai.toFixed(2)}): wet springs, floods, wind and frost matter more, and the model doesn't capture most of those yet.${irrigated}`
      : `Water is a main weather risk here (${w.aridityClass}, aridity index ${ai.toFixed(2)}).${irrigated}`,
  };
}

export function aridityClass(ai: number): string {
  for (const c of ARIDITY_CLASSES) if (ai < c.below) return c.name;
  return ARIDITY_CLASSES[ARIDITY_CLASSES.length - 1]!.name;
}

/** Design curve: 0 at AI >= humidFrom, linear to 1 at AI <= fullAt. */
export function scarcityFromAridity(ai: number): number {
  const { zeroAt, oneAt } = SCARCITY_CURVE;
  if (ai >= zeroAt) return 0;
  if (ai <= oneAt) return 1;
  return (zeroAt - ai) / (zeroAt - oneAt);
}

export function waterScarcity(precipMm: number | null, et0Mm: number | null, irrigated: boolean): WaterScarcity {
  if (irrigated) {
    const ai = precipMm !== null && et0Mm ? precipMm / et0Mm : null;
    return {
      aridityIndex: ai,
      aridityClass: ai !== null ? aridityClass(ai) : null,
      scarcity: 1,
      irrigated: true,
      explanation: 'Irrigation water is a real cost here, so water use counts in full.',
    };
  }
  if (precipMm === null || !et0Mm) {
    return {
      aridityIndex: null,
      aridityClass: null,
      scarcity: 1,
      irrigated: false,
      explanation: 'Climate unknown (no daily weather), so water use counts in full.',
    };
  }
  const ai = precipMm / et0Mm;
  const cls = aridityClass(ai);
  const s = scarcityFromAridity(ai);
  const pct = Math.round(s * 100);
  const explanation =
    s < 0.05
      ? `Water is plentiful here (aridity index ${ai.toFixed(2)}, ${cls}), so water use counts for little.`
      : s > 0.95
        ? `Water is scarce here (aridity index ${ai.toFixed(2)}, ${cls}), so water use counts in full.`
        : `Water is somewhat limited here (aridity index ${ai.toFixed(2)}, ${cls}), so water use counts at ${pct}% of the slider.`;
  return { aridityIndex: ai, aridityClass: cls, scarcity: s, irrigated: false, explanation };
}
