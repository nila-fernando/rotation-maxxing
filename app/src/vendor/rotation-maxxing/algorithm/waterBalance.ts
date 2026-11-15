/**
 * Daily root-zone soil water balance (FAO-56 chapter 8, single crop
 * coefficient) and the FAO-33 yield response to water:
 *
 *   ETm = Kc x ET0                               crop water demand (Kc curve: FAO-56 eq. 66)
 *   TAW = 1000 x AWC x Zr                        mm the root zone can hold (eq. 82)
 *   RAW = p x TAW                                 readily available water (eq. 83)
 *   Ks  = (TAW - Dr) / ((1 - p) x TAW) if Dr > RAW, else 1        (eq. 84)
 *   ETa = Ks x ETm
 *   Dr  = Dr - rain - irrigation + ETa, kept within 0..TAW (eq. 85, no runoff)
 *   Ya / Ym = 1 - Ky x (1 - sum ETa / sum ETm)    FAO-33 (Doorenbos & Kassam 1979)
 *
 * Simplifications (documented in ALGORITHM.md):
 *  - no surface runoff: every mm of rain enters the root zone (overstates water in storms)
 *  - root depth grows linearly from planting to the end of the development stage
 *  - the profile is at field capacity at planting unless an initial depletion is given
 *  - irrigated fields are refilled to field capacity when depletion passes RAW,
 *    until the season's allocation runs out
 */
import { dayOfYear, eaFromRhMean, et0PenmanMonteith } from './et0';
import type { DailyWeather } from './types';

export interface CropWaterParams {
  /** FAO-56 Table 11 stage lengths, days. */
  lIni: number;
  lDev: number;
  lMid: number;
  lLate: number;
  /** FAO-56 Table 12 crop coefficients. */
  kcIni: number;
  kcMid: number;
  kcEnd: number;
  /** FAO-33 seasonal yield response factor. */
  ky: number;
  /** Depletion fraction p (FAO-56 Table 22). */
  p: number;
  /** Root depth at planting and at full development, m. */
  rootIniM: number;
  rootMaxM: number;
}

export interface SeasonWaterResult {
  /** Crop water demand, mm. */
  etmMm: number;
  /** Actual crop water use, mm. */
  etaMm: number;
  rainMm: number;
  irrigationMm: number;
  /** etm - eta: water the crop wanted but didn't get, mm. */
  deficitMm: number;
  /** FAO-33 relative yield Ya/Ym, 0-1. */
  yieldRatio: number;
  stressDays: number;
  /** Root-zone depletion at harvest as a share of TAW (carry-over to the next crop). */
  endDepletionFraction: number;
  /** Days simulated (less than the season if maxDays cut it short). */
  days: number;
  /** Day index (into the weather arrays) after the last simulated day. */
  endIndex: number;
}

export interface SeasonOptions {
  /** Index into the daily arrays of the planting day. */
  startIndex: number;
  /** Root-zone available water capacity, m/m (= in/in, from SSURGO awc). */
  awc: number;
  irrigated?: boolean;
  /** Seasonal irrigation allowance, mm. Infinity if absent. */
  allocationMm?: number;
  /** Depletion at planting as a share of TAW (0 = field capacity). */
  initialDepletionFraction?: number;
  /**
   * Depletion of the deeper soil the roots will grow into, as a share of its
   * capacity (carryover from the previous crop or fallow). Default: same as
   * initialDepletionFraction.
   */
  subsoilDepletionFraction?: number;
  /** Stop early (e.g. the next crop is planted before this one is harvested). */
  maxDays?: number;
  /** Precomputed daily ET0 (mm), aligned with the weather arrays. */
  et0?: number[];
}

/** Daily FAO-56 Penman-Monteith ET0 for a whole weather series. */
export function dailyEt0(w: DailyWeather): number[] {
  return w.dates.map((d, i) =>
    et0PenmanMonteith({
      tmaxC: w.tmaxC[i]!,
      tminC: w.tminC[i]!,
      eaKPa: eaFromRhMean(w.tmaxC[i]!, w.tminC[i]!, w.rhPct[i]!),
      solarMJ: w.solarMJ[i]!,
      wind2m: w.wind2m[i]!,
      latDeg: w.latitude,
      elevationM: w.elevationM,
      dayOfYear: dayOfYear(d),
    }).et0Mm,
  );
}

export function seasonLength(c: CropWaterParams): number {
  return c.lIni + c.lDev + c.lMid + c.lLate;
}

/** Kc on day `d` after planting (FAO-56 eq. 66, linear through dev and late stages). */
export function kcOnDay(c: CropWaterParams, d: number): number {
  if (d < c.lIni) return c.kcIni;
  if (d < c.lIni + c.lDev) return c.kcIni + ((d - c.lIni) / c.lDev) * (c.kcMid - c.kcIni);
  if (d < c.lIni + c.lDev + c.lMid) return c.kcMid;
  const late = d - (c.lIni + c.lDev + c.lMid);
  return c.kcMid + (Math.min(late, c.lLate) / c.lLate) * (c.kcEnd - c.kcMid);
}

/** Root depth on day `d` (linear from rootIni at planting to rootMax at the end of development). */
export function rootDepthOnDay(c: CropWaterParams, d: number): number {
  const grow = c.lIni + c.lDev;
  return c.rootIniM + (Math.min(d, grow) / grow) * (c.rootMaxM - c.rootIniM);
}

export function simulateSeason(w: DailyWeather, crop: CropWaterParams, o: SeasonOptions): SeasonWaterResult | null {
  // Whole days (stage lengths can be fractional, e.g. soybean L_dev 32.5).
  const full = Math.ceil(seasonLength(crop));
  const n = Math.min(full, Math.floor(o.maxDays ?? full));
  if (o.startIndex < 0 || o.startIndex + n > w.dates.length) return null;
  const et0 = o.et0 ?? dailyEt0(w);
  let allowance = o.irrigated ? (o.allocationMm ?? Infinity) : 0;
  let taw = 1000 * o.awc * crop.rootIniM;
  let dr = (o.initialDepletionFraction ?? 0) * taw;
  const subsoil = o.subsoilDepletionFraction ?? o.initialDepletionFraction ?? 0;
  let etm = 0, eta = 0, rain = 0, irr = 0, stress = 0;
  for (let d = 0; d < n; d++) {
    const i = o.startIndex + d;
    const newTaw = 1000 * o.awc * rootDepthOnDay(crop, d);
    // Roots growing into deeper soil inherit that soil's carried-over depletion.
    dr += subsoil * Math.max(0, newTaw - taw);
    taw = newTaw;
    const raw = crop.p * taw;
    const r = w.rainMm[i]!;
    rain += r;
    // Irrigate in the morning if the root zone is past readily available water.
    if (dr > raw && allowance > 0) {
      const amount = Math.min(dr, allowance);
      irr += amount;
      allowance -= amount;
      dr -= amount;
    }
    const demand = kcOnDay(crop, d) * et0[i]!;
    const ks = dr > raw && taw > 0 ? Math.max(0, (taw - dr) / ((1 - crop.p) * taw)) : 1;
    if (ks < 1) stress++;
    const actual = ks * demand;
    etm += demand;
    eta += actual;
    dr = Math.min(taw, Math.max(0, dr - r + actual));
  }
  const relEt = etm > 0 ? eta / etm : 1;
  return {
    etmMm: etm,
    etaMm: eta,
    rainMm: rain,
    irrigationMm: irr,
    deficitMm: etm - eta,
    yieldRatio: Math.min(1, Math.max(0, 1 - crop.ky * (1 - relEt))),
    stressDays: stress,
    endDepletionFraction: taw > 0 ? dr / taw : 0,
    days: n,
    endIndex: o.startIndex + n,
  };
}

/**
 * Off-season (harvest -> next planting, or a fallow year): the root zone loses
 * water only to bare-soil evaporation (FAO-56 Ch. 7/11, from the surface
 * layer) and is refilled by rain; water beyond field capacity drains.
 * Returns the root-zone depletion (mm) at the end.
 * Simplification: residue mulch and frozen soil are not modelled, so winter
 * evaporation is somewhat overstated.
 */
export function simulateOffSeason(
  w: DailyWeather,
  o: { startIndex: number; endIndex: number; depletionMm: number; tawMm: number; rewMm: number; tewMm: number; kcMax: number; et0?: number[] },
): number | null {
  if (o.startIndex < 0 || o.endIndex > w.dates.length || o.endIndex < o.startIndex) return null;
  const et0 = o.et0 ?? dailyEt0(w);
  let dr = Math.min(o.tawMm, o.depletionMm);
  let de = Math.min(o.tewMm, dr);
  for (let i = o.startIndex; i < o.endIndex; i++) {
    const r = w.rainMm[i]!;
    dr = Math.max(0, dr - r);
    de = Math.max(0, de - r);
    const kr = de <= o.rewMm ? 1 : Math.max(0, (o.tewMm - de) / (o.tewMm - o.rewMm));
    const e = Math.min(kr * o.kcMax * et0[i]!, o.tewMm - de, o.tawMm - dr);
    de = Math.min(o.tewMm, de + e);
    dr = Math.min(o.tawMm, dr + e);
  }
  return dr;
}

export interface BareSoilResult {
  /** Evaporation from the bare surface over the window, mm. */
  evaporationMm: number;
  rainMm: number;
  /** Reference ET over the window, mm (for context). */
  et0Mm: number;
}

/**
 * Daily evaporation from bare (fallow) soil, FAO-56 Ch. 11 dual-Kc method:
 * Kcb = Kc min = 0, few = 1 (rain wets the whole bare surface), so
 *   Ke  = Kr x Kc max                                  (eq. 71)
 *   Kr  = 1 while De <= REW, else (TEW - De) / (TEW - REW)   (eq. 74)
 *   De  = De - rain + E, kept within 0..TEW            (eqs. 77, 78; runoff and Tew ignored)
 * The surface starts dry (De = TEW), as FAO-56 advises after a long dry spell.
 */
export function simulateBareSoil(
  w: DailyWeather,
  o: { startIndex: number; days: number; rewMm: number; tewMm: number; kcMax: number; et0?: number[] },
): BareSoilResult | null {
  if (o.startIndex < 0 || o.startIndex + o.days > w.dates.length) return null;
  const et0 = o.et0 ?? dailyEt0(w);
  let de = o.tewMm;
  let evap = 0, rain = 0, ref = 0;
  for (let d = 0; d < o.days; d++) {
    const i = o.startIndex + d;
    const r = w.rainMm[i]!;
    rain += r;
    ref += et0[i]!;
    de = Math.max(0, de - r);
    const kr = de <= o.rewMm ? 1 : Math.max(0, (o.tewMm - de) / (o.tewMm - o.rewMm));
    const e = Math.min(kr * o.kcMax * et0[i]!, o.tewMm - de);
    evap += e;
    de = Math.min(o.tewMm, de + e);
  }
  return { evaporationMm: evap, rainMm: rain, et0Mm: ref };
}

/** Index of YYYY-MM-DD in the series, or -1. */
export function indexOfDate(w: DailyWeather, iso: string): number {
  // Dates are consecutive days; jump straight there.
  const start = Date.parse(w.dates[0]! + 'T00:00:00Z');
  const i = Math.round((Date.parse(iso + 'T00:00:00Z') - start) / 86_400_000);
  return i >= 0 && i < w.dates.length && w.dates[i] === iso ? i : -1;
}
