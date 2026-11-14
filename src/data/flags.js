// Manami's flags for a field: plain-English things worth a look, from crop history, slope and rain.
// Every threshold lives in FLAG_CONFIG so it's easy to tune.
//
//   const flags = flagsFor({ cropHistory, slopePct, rain })
//   statusFor(flags)        'green' | 'amber' | 'red'   (the hub's status dot)
//   shownFlags(flags)       the 1–2 Manami says out loud, most field-specific first

import { cropKeyFor } from '../island/crops.js';

export const FLAG_CONFIG = {
  /** Same crop this many years in a row (anywhere in the history) → a rotation flag. */
  sameCropRunYears: 3,
  /** No legume in this many years → a nitrogen flag (only when the history covers that many years). */
  legumeYears: 8,
  /** Crop keys that count as legumes, plus a name pattern for crops without their own key. */
  legumeKeys: ['soybeans', 'alfalfa'],
  legumeNames: /(soy|\bbeans?\b|\bpeas?\b|\blentils?\b|\bclover\b|\bvetch\b|\balfalfa\b|\bchickpeas?\b|\bpeanuts?\b)/i,
  /**
   * Years that aren't a crop (grass, idle ground, built-up land, water, woods): left out of the
   * rotation and legume rules, which are about cropland. Keys, plus a name pattern for CSB/CDL
   * land-cover classes that have no key of their own.
   */
  notCropKeys: ['pasture', 'fallow'],
  notCropNames: /developed|open water|forest|wetland|shrub|barren|grassland|woody|herbaceous|clouds|no data|aquaculture|perennial ice/i,
  /** The rotation and legume rules only run when at least this share of known years are crops. */
  minCropShare: 0.5,
  /** Average slope above this (%) and a row crop last year → an erosion flag. */
  steepSlopePct: 6,
  /** Crop keys that count as row crops, plus a name pattern for ones without a key. */
  rowCropKeys: ['corn', 'soybeans', 'sorghum'],
  rowCropNames: /\b(cotton|sunflowers?|sugarbeets?|potatoes|dry beans|peanuts?|tobacco)\b/i,
  /** Erosion risk label: under lowBelowPct low, up to highAbovePct medium, above that high. */
  erosion: { lowBelowPct: 2, highAbovePct: 6 },
  /** Average growing-season rain of the last dryYears years more than dryBelowPct % under the 30-year average → a dry flag. */
  dryYears: 5,
  dryBelowPct: 10,
  /** How many flags Manami says at most. */
  maxShown: 2,
  /** Flags with 2 or more → red; exactly 1 → amber; none → green. */
  redAt: 2,
  /**
   * Farm-wide flags (the same on every field, like the dry rain trend) are said in the panel but
   * don't colour the status dot, so the dots still tell the fields apart. Set true to count them.
   */
  farmWideCountsForStatus: false,
};

/** "low" | "medium" | "high" erosion risk for an average slope in %, or null if unknown. */
export function erosionRisk(slopePct, cfg = FLAG_CONFIG) {
  if (!Number.isFinite(slopePct)) return null;
  if (slopePct < cfg.erosion.lowBelowPct) return 'low';
  if (slopePct <= cfg.erosion.highAbovePct) return 'medium';
  return 'high';
}

// "Other Hay/Non Alfalfa" is not alfalfa: drop negated words before matching names
const unNegated = (c) => String(c).replace(/\bnon[\s-]+[a-z]+/gi, ' ');
// a double crop ("Dbl Crop Soybeans/Oats") is a legume if either crop is
const parts = (c) => (/^\s*dbl crop/i.test(String(c)) ? String(c).replace(/^\s*dbl crop\s*/i, '').split('/') : [String(c)]);
const isLegume = (c, cfg) => parts(c).some((p) => cfg.legumeKeys.includes(cropKeyFor(p)) || cfg.legumeNames.test(unNegated(p)));
// the row crop "last year" is what was in the ground last (a double crop's later crop)
const isRowCrop = (c, cfg) => cfg.rowCropKeys.includes(cropKeyFor(c)) || cfg.rowCropNames.test(unNegated(c));
/** Whether a year's cover is a crop at all (not grass, idle ground, buildings, water or woods). */
export const isCrop = (c, cfg = FLAG_CONFIG) => !cfg.notCropKeys.includes(cropKeyFor(c)) && !cfg.notCropNames.test(String(c));
const cropLabel = (c) => {
  const key = cropKeyFor(c);
  const name = key === 'other' ? String(c) : key;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

// crops without their own key ("Sunflower", "Dry Beans") compare by name
const sameCropKey = (c) => { const k = cropKeyFor(c); return k === 'other' ? `other:${String(c).toLowerCase()}` : k; };

/** The longest run of one crop in consecutive years: { crop, years, from, to } or null. Ties: the latest. */
export function longestRun(history) {
  const h = history.filter((x) => x && x.crop != null).sort((a, b) => a.year - b.year);
  let best = null;
  let start = 0;
  for (let i = 1; i <= h.length; i++) {
    if (i < h.length && h[i].year === h[i - 1].year + 1 && sameCropKey(h[i].crop) === sameCropKey(h[start].crop)) continue;
    const years = i - start;
    if (!best || years >= best.years) best = { crop: h[start].crop, years, from: h[start].year, to: h[i - 1].year };
    start = i;
  }
  return best;
}

/**
 * @param {object} o
 * @param {{year: number, crop: string}[]} [o.cropHistory]  oldest or newest first, gaps allowed
 * @param {number|null} [o.slopePct]
 * @param {{years: {year: number, value: number}[], avg30: number}|null} [o.rain]  growing-season rain
 * @param {object} [cfg]
 * @returns {{id: string, level: 'amber', text: string, rank: number, farmWide?: boolean}[]}
 *   rank: lower = more specific to the field; farmWide: the same on every field of the farm
 */
export function flagsFor({ cropHistory = [], slopePct = null, rain = null } = {}, cfg = FLAG_CONFIG) {
  const flags = [];
  const history = cropHistory.filter((x) => x && x.crop != null).sort((a, b) => a.year - b.year);
  // rotation advice is for cropland: skip it for ground that's mostly grass, idle, built-up or wild
  const cropYears = history.filter((x) => isCrop(x.crop, cfg));
  const cropland = history.length > 0 && cropYears.length >= history.length * cfg.minCropShare;

  // no legume in N years (needs N crop years in the last N to say so)
  if (cropland) {
    const last = history[history.length - 1].year;
    const window = cropYears.filter((x) => x.year > last - cfg.legumeYears);
    if (window.length >= cfg.legumeYears && !window.some((x) => isLegume(x.crop, cfg))) {
      flags.push({ id: 'noLegume', level: 'amber', rank: 1, text: `No legume in ${cfg.legumeYears} years. Beans or alfalfa can add nitrogen.` });
    }
  }

  // steep ground with a row crop last year
  const lastCrop = history.length ? history[history.length - 1].crop : null;
  if (Number.isFinite(slopePct) && slopePct > cfg.steepSlopePct && lastCrop != null && isRowCrop(lastCrop, cfg)) {
    flags.push({ id: 'steepRowCrop', level: 'amber', rank: 2, text: 'Steep ground. Erosion risk with row crops.' });
  }

  // the same crop N+ years in a row (crop years only: a run of pasture isn't a rotation problem)
  const run = cropland ? longestRun(cropYears) : null;
  if (run && run.years >= cfg.sameCropRunYears) {
    const now = run.to === history[history.length - 1].year;
    flags.push({
      id: 'sameCrop',
      level: 'amber',
      rank: 3,
      text: now
        ? `${cropLabel(run.crop)} ${run.years} years running. Rotating could lift yield.`
        : `${cropLabel(run.crop)} ${run.years} years running (${run.from}–${run.to}). Rotating could lift yield.`,
    });
  }

  // drier than normal lately
  if (rain?.years?.length && Number.isFinite(rain.avg30) && rain.avg30 > 0) {
    const recent = [...rain.years].sort((a, b) => a.year - b.year).slice(-cfg.dryYears);
    if (recent.length === cfg.dryYears) {
      const avg = recent.reduce((s, r) => s + r.value, 0) / recent.length;
      if (avg < rain.avg30 * (1 - cfg.dryBelowPct / 100)) {
        flags.push({ id: 'dry', level: 'amber', rank: 4, farmWide: true, text: 'Drier than normal lately.' });
      }
    }
  }
  return flags.sort((a, b) => a.rank - b.rank);
}

/** 'green' (no flags), 'amber' (one), 'red' (two or more), counting the field's own flags only (see farmWideCountsForStatus). */
export function statusFor(flags, cfg = FLAG_CONFIG) {
  const n = flags.filter((f) => cfg.farmWideCountsForStatus || !f.farmWide).length;
  if (!n) return 'green';
  return n >= cfg.redAt ? 'red' : 'amber';
}

/** The flags Manami says: the most field-specific first, at most cfg.maxShown. */
export function shownFlags(flags, cfg = FLAG_CONFIG) {
  return [...flags].sort((a, b) => a.rank - b.rank).slice(0, cfg.maxShown);
}
