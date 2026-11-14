/**
 * FAO-56 Penman-Monteith reference evapotranspiration (ET0), daily.
 * Allen et al. 1998, FAO Irrigation and Drainage Paper 56, chapters 2-4.
 * Equation numbers below refer to FAO-56.
 *
 *   ET0 = [0.408 D (Rn - G) + g (900 / (T + 273)) u2 (es - ea)] / [D + g (1 + 0.34 u2)]   (eq. 6)
 */

const GSC = 0.082; // solar constant, MJ m-2 min-1
const SIGMA = 4.903e-9; // Stefan-Boltzmann, MJ K-4 m-2 day-1

/** Saturation vapour pressure at T (C), kPa (eq. 11). */
export function satVapourPressure(tC: number): number {
  return 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3));
}

/** Extraterrestrial radiation Ra, MJ m-2 day-1 (eqs. 21-25). */
export function extraterrestrialRadiation(latDeg: number, dayOfYear: number): number {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365); // eq. 23
  const delta = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39); // eq. 24
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta)))); // eq. 25
  return ((24 * 60) / Math.PI) * GSC * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
}

export interface Et0Input {
  tmaxC: number;
  tminC: number;
  /** Actual vapour pressure ea, kPa. Use eaFromRhMean() for mean RH. */
  eaKPa: number;
  /** Incoming solar radiation Rs, MJ m-2 day-1. */
  solarMJ: number;
  /** Wind speed at 2 m, m/s. */
  wind2m: number;
  latDeg: number;
  elevationM: number;
  dayOfYear: number;
}

/** ea from mean relative humidity (eq. 19). */
export function eaFromRhMean(tmaxC: number, tminC: number, rhMeanPct: number): number {
  return (rhMeanPct / 100) * ((satVapourPressure(tmaxC) + satVapourPressure(tminC)) / 2);
}

export interface Et0Result {
  et0Mm: number;
  netRadiation: number;
  ra: number;
  rnl: number;
}

export function et0PenmanMonteith(i: Et0Input): Et0Result {
  const t = (i.tmaxC + i.tminC) / 2;
  const es = (satVapourPressure(i.tmaxC) + satVapourPressure(i.tminC)) / 2; // eq. 12
  const delta = (4098 * satVapourPressure(t)) / (t + 237.3) ** 2; // eq. 13
  const p = 101.3 * ((293 - 0.0065 * i.elevationM) / 293) ** 5.26; // eq. 7
  const gamma = 0.000665 * p; // eq. 8
  const ra = extraterrestrialRadiation(i.latDeg, i.dayOfYear);
  const rso = (0.75 + 2e-5 * i.elevationM) * ra; // eq. 37
  const rns = (1 - 0.23) * i.solarMJ; // eq. 38
  const ratio = rso > 0 ? Math.min(1, i.solarMJ / rso) : 0.5;
  const tk4 = ((i.tmaxC + 273.16) ** 4 + (i.tminC + 273.16) ** 4) / 2;
  const rnl = SIGMA * tk4 * (0.34 - 0.14 * Math.sqrt(Math.max(0, i.eaKPa))) * (1.35 * ratio - 0.35); // eq. 39
  const rn = rns - rnl; // eq. 40
  const num = 0.408 * delta * rn + gamma * (900 / (t + 273)) * i.wind2m * (es - i.eaKPa);
  const den = delta + gamma * (1 + 0.34 * i.wind2m);
  return { et0Mm: Math.max(0, num / den), netRadiation: rn, ra, rnl };
}

/** Day of year (1-366) of a YYYY-MM-DD date. */
export function dayOfYear(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}
