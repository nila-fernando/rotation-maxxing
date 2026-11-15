/**
 * Jar test: soil texture from a photo of a settled soil jar.
 *
 * Pure functions, no DOM, no runtime dependencies.
 * The frontend passes in RGBA pixels (e.g. from canvas getImageData) and the box
 * the farmer drew around the jar contents; this module finds the layers, labels
 * them, and turns them into a soil result.
 *
 * Pipeline:
 *  1. Build a colour (CIELAB) + graininess profile down the middle of the jar.
 *  2. Find the best layer boundaries for the whole jar at once (dynamic programming).
 *  3. Clean up: drop blurry transition bands, merge look-alike neighbours.
 *  4. Decide where the water ends and the soil starts, then label each part.
 *  5. computeResult() turns labelled layers into sand/silt/clay %, texture class, warnings.
 */

/* =====================================================================
   TYPES
   ===================================================================== */

export type LayerType =
  | 'air' | 'foam' | 'floating' | 'water' | 'tea' | 'cloudy' | 'organic'
  | 'clay' | 'fines' | 'silt' | 'sand' | 'gravel' | 'other' | 'ignore';

/** How long after shaking the photo was taken. */
export type Elapsed = 'short' | 'mid' | 'ok';

export interface RgbaImage {
  /** RGBA bytes, row by row (same layout as canvas ImageData.data). */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Box around the jar contents, in image pixels. Corners can be in any order. */
export interface Box { x0: number; y0: number; x1: number; y1: number; }

export interface JarLayer {
  type: LayerType;
  /** Plain-English reason for the label. */
  why: string;
  /** Average colour seen in the photo for this layer. */
  rgb: [number, number, number];
  /** Top and bottom of the layer, in image pixels. */
  y0: number;
  y1: number;
}

export interface JarAnalysis {
  box: Box;
  imageHeight: number;
  elapsed: Elapsed;
  /** Top to bottom. layers[i].y1 === layers[i + 1].y0. */
  layers: JarLayer[];
  /** How different the two layers at each inner boundary look (length = layers.length - 1). */
  boundaryScores: number[];
  /** True once the farmer has changed anything. */
  edited: boolean;
}

export type ConfidenceKey = 'high' | 'medium' | 'low' | 'adjusted';

export interface JarResult {
  sandPct: number | null;
  siltPct: number | null;
  clayPct: number | null;
  textureClass: string | null;
  drainage: string | null;
  waterHolding: string | null;
  propertyNote: string | null;
  organicMatterPct: number;
  organicMatterLevel: 'None seen' | 'Little' | 'Some' | 'A lot';
  gravelPct: number;
  stoneLevel: 'None seen' | 'Very few' | 'Some' | 'Stony';
  confidence: { key: ConfidenceKey; label: string };
  warnings: string[];
  /** Notes for every layer type present that has one (e.g. what tea-coloured water means). */
  notes: { type: LayerType; label: string; note: string }[];
  /** Layer types present, in dropdown order. */
  typesPresent: LayerType[];
  /** Each layer's share of the jar contents (ignored layers count as 0). */
  layerList: { type: LayerType; heightPct: number }[];
  elapsed: Elapsed;
  edited: boolean;
}

export class JarTestError extends Error {
  constructor(message: string) { super(message); this.name = 'JarTestError'; }
}

/* =====================================================================
   LAYER TYPES (labels, colours and notes the frontend can use)
   Order = dropdown order, top of the jar to the bottom.
   ===================================================================== */

export interface LayerTypeInfo { label: string; short: string; color: string; note: string; }

export const LAYER_TYPES: Record<LayerType, LayerTypeInfo> = {
  air:      { label: 'Air gap',                            short: 'Air',                color: '#8fb8de', note: '' },
  foam:     { label: 'Foam / bubbles',                     short: 'Foam',               color: '#b0bec5', note: 'Usually soap bubbles. Harmless. Use a little less soap next time.' },
  floating: { label: 'Floating organic matter',            short: 'Floating organic',   color: '#8d6e63', note: 'Light bits of plant material (roots, straw, leaf pieces) that float. A sign of fresh organic matter that has not broken down yet.' },
  water:    { label: 'Clear water',                        short: 'Clear water',        color: '#4fc3f7', note: '' },
  tea:      { label: 'Tea-coloured water',                 short: 'Tea-coloured water', color: '#c8861e', note: 'Brown, orange or yellow water that you can still see through usually means dissolved plant material (such as tannins). It is not counted as clay, silt or sand.' },
  cloudy:   { label: 'Cloudy water (clay still floating)', short: 'Cloudy water',       color: '#9e9e9e', note: '' },
  organic:  { label: 'Organic matter (settled)',           short: 'Organic matter',     color: '#5d4037', note: 'A thin, dark layer of settled organic matter on top of the soil. It helps the soil hold water and nutrients.' },
  clay:     { label: 'Clay',                               short: 'Clay',               color: '#c0504d', note: '' },
  fines:    { label: "Silt + clay (can't tell apart)",     short: 'Silt + clay',        color: '#d4785a', note: 'Silt and clay settled into one layer that looks the same. We count it as half silt and half clay, which is a rough guess. If you can see a line inside it, split it.' },
  silt:     { label: 'Silt',                               short: 'Silt',               color: '#e6b422', note: '' },
  sand:     { label: 'Sand',                               short: 'Sand',               color: '#4a90d9', note: '' },
  gravel:   { label: 'Gravel / stones',                    short: 'Gravel',             color: '#455a64', note: 'Stones and coarse grit. They are not counted in the sand, silt and clay shares, but they show how stony the soil is.' },
  other:    { label: 'Something else',                     short: 'Other',              color: '#8e24aa', note: 'Not counted in any result. If you can tell what it is, pick a better label.' },
  ignore:   { label: 'Not jar contents (lid, rim, label)', short: 'Ignored',            color: '#9a9a9a', note: 'Parts of the photo that are not inside the jar (lid, rim, labels). Left out of every result.' },
};

export const LAYER_TYPE_ORDER = Object.keys(LAYER_TYPES) as LayerType[];

const MINERAL: LayerType[] = ['sand', 'silt', 'clay', 'fines'];
const MAX_LAYERS = 12;

/* Detection settings */
const MAX_BINS = 300;         // the jar column is resampled to at most this many rows
const MAX_ROWS = 800;         // big photos are sampled down to about this many rows
const DP_MAX_SEGMENTS = 14;   // first pass: generous number of candidate layers
const MERGE_T = 4.5;          // merge neighbours that differ less than this (ΔE + texture)
const LIQUID_MERGE_T = 8;     // stricter merging in the water part (glass embossing, glare)

/* =====================================================================
   SOIL SCIENCE
   ===================================================================== */

/** USDA soil texture class from sand / silt / clay percentages (sum = 100). */
export function textureClass(sand: number, silt: number, clay: number): string {
  if (silt + 1.5 * clay < 15) return 'Sand';
  if (silt + 1.5 * clay >= 15 && silt + 2 * clay < 30) return 'Loamy sand';
  if ((clay >= 7 && clay < 20 && sand > 52 && silt + 2 * clay >= 30) ||
      (clay < 7 && silt < 50 && silt + 2 * clay >= 30)) return 'Sandy loam';
  if (clay >= 7 && clay < 27 && silt >= 28 && silt < 50 && sand <= 52) return 'Loam';
  if ((silt >= 50 && clay >= 12 && clay < 27) ||
      (silt >= 50 && silt < 80 && clay < 12)) return 'Silt loam';
  if (silt >= 80 && clay < 12) return 'Silt';
  if (clay >= 20 && clay < 35 && silt < 28 && sand > 45) return 'Sandy clay loam';
  if (clay >= 27 && clay < 40 && sand > 20 && sand <= 45) return 'Clay loam';
  if (clay >= 27 && clay < 40 && sand <= 20) return 'Silty clay loam';
  if (clay >= 35 && sand > 45) return 'Sandy clay';
  if (clay >= 40 && silt >= 40) return 'Silty clay';
  if (clay >= 40 && sand <= 45 && silt < 40) return 'Clay';
  return 'Unclassified';
}

/** Rough, typical properties for each class (general guidance only). */
export const TEXTURE_PROPERTIES: Record<string, { drain: string; water: string; note: string }> = {
  'Sand':            { drain: 'Very fast',        water: 'Low',         note: 'Dries out quickly and loses nutrients. Drought and wind erosion are the main risks.' },
  'Loamy sand':      { drain: 'Fast',             water: 'Low',         note: 'Drains easily and dries out in dry spells. Holds few nutrients.' },
  'Sandy loam':      { drain: 'Good to fast',     water: 'Low–medium',  note: 'Easy to work and warms up early. Can dry out quickly.' },
  'Loam':            { drain: 'Good',             water: 'Medium–high', note: 'A well-balanced soil that suits most crops.' },
  'Silt loam':       { drain: 'Moderate',         water: 'High',        note: 'Holds lots of water. Erodes and crusts easily if left bare.' },
  'Silt':            { drain: 'Moderate',         water: 'High',        note: 'Very easily eroded by water and wind. Keep the ground covered.' },
  'Sandy clay loam': { drain: 'Moderate',         water: 'Medium',      note: 'Fairly balanced. Can set hard when dry.' },
  'Clay loam':       { drain: 'Moderate to slow', water: 'Medium–high', note: 'Holds water and nutrients well. Can get sticky and compact when wet.' },
  'Silty clay loam': { drain: 'Slow to moderate', water: 'High',        note: 'Holds a lot of water. Prone to crusting and compaction.' },
  'Sandy clay':      { drain: 'Slow',             water: 'Medium',      note: 'Heavy to work. Can crack when dry.' },
  'Silty clay':      { drain: 'Slow',             water: 'High',        note: 'Waterlogs easily. Wait until it is not too wet to work.' },
  'Clay':            { drain: 'Slow',             water: 'High',        note: 'Holds water and nutrients, but waterlogs and compacts easily.' },
};

/* =====================================================================
   COLOUR HELPERS (sRGB -> CIELAB, so differences match what we see)
   ===================================================================== */

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const labF = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(R: number, G: number, B: number): [number, number, number] {
  const r = LIN[R]!, g = LIN[G]!, b = LIN[B]!;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function median(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0;
  const s = Array.from(arr).sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/* =====================================================================
   1. PROFILE: one colour + texture value per row, resampled into bins
   ===================================================================== */

interface Profile {
  nb: number;
  L: Float32Array; A: Float32Array; B: Float32Array; T: Float32Array;
  R: Float32Array; G: Float32Array; Bc: Float32Array;
}

function buildProfile(img: RgbaImage, xL: number, xR: number, top: number, h: number): Profile {
  // middle 50% of the box: avoids the curved jar edges, where glare and distortion are worst
  const bx = Math.round(xL + (xR - xL) * 0.25);
  const bw = Math.max(4, Math.round((xR - xL) * 0.5));
  const colStep = Math.max(1, Math.floor(bw / 90));
  const rowStep = Math.max(1, Math.floor(h / MAX_ROWS));
  const cols: number[] = [];
  for (let x = 0; x < bw; x += colStep) cols.push(Math.min(img.width - 1, bx + x));
  const rows: number[] = [];
  for (let y = 0; y < h; y += rowStep) rows.push(Math.min(img.height - 1, top + y));
  const nc = cols.length, nr = rows.length;
  const d = img.data;

  const Lg = new Float32Array(nc * nr), Ag = new Float32Array(nc * nr), Bg = new Float32Array(nc * nr);
  const rR = new Float32Array(nr), rG = new Float32Array(nr), rB = new Float32Array(nr);
  for (let y = 0; y < nr; y++) {
    let sr = 0, sg = 0, sb = 0;
    const rowOff = rows[y]! * img.width;
    for (let c = 0; c < nc; c++) {
      const i = (rowOff + cols[c]!) * 4;
      const R = d[i]!, G = d[i + 1]!, B = d[i + 2]!;
      const lab = rgbToLab(R, G, B);
      Lg[y * nc + c] = lab[0]; Ag[y * nc + c] = lab[1]; Bg[y * nc + c] = lab[2];
      sr += R; sg += G; sb += B;
    }
    rR[y] = sr / nc; rG[y] = sg / nc; rB[y] = sb / nc;
  }

  // per row: median colour (robust to glare streaks and specks) + graininess
  const rowL = new Float32Array(nr), rowA = new Float32Array(nr), rowB = new Float32Array(nr), rowT = new Float32Array(nr);
  for (let y = 0; y < nr; y++) {
    const o = y * nc;
    rowL[y] = median(Lg.subarray(o, o + nc));
    rowA[y] = median(Ag.subarray(o, o + nc));
    rowB[y] = median(Bg.subarray(o, o + nc));
    let hs = 0, vs = 0;
    for (let c = 0; c < nc - 1; c++) hs += Math.min(25, Math.abs(Lg[o + c + 1]! - Lg[o + c]!));
    if (y < nr - 1) for (let c = 0; c < nc; c++) vs += Math.min(25, Math.abs(Lg[o + nc + c]! - Lg[o + c]!));
    const hv = nc > 1 ? hs / (nc - 1) : 0;
    rowT[y] = y < nr - 1 ? (hv + vs / nc) / 2 : hv;
  }

  // resample into bins
  const nb = Math.min(nr, MAX_BINS);
  const P: Profile = {
    nb,
    L: new Float32Array(nb), A: new Float32Array(nb), B: new Float32Array(nb), T: new Float32Array(nb),
    R: new Float32Array(nb), G: new Float32Array(nb), Bc: new Float32Array(nb),
  };
  for (let i = 0; i < nb; i++) {
    const r0 = Math.floor(i * nr / nb), r1 = Math.max(r0 + 1, Math.floor((i + 1) * nr / nb));
    let l = 0, a = 0, b = 0, t = 0, R = 0, G = 0, Bc = 0;
    for (let y = r0; y < r1; y++) {
      l += rowL[y]!; a += rowA[y]!; b += rowB[y]!; t += rowT[y]!; R += rR[y]!; G += rG[y]!; Bc += rB[y]!;
    }
    const n = r1 - r0;
    P.L[i] = l / n; P.A[i] = a / n; P.B[i] = b / n; P.T[i] = t / n;
    P.R[i] = R / n; P.G[i] = G / n; P.Bc[i] = Bc / n;
  }
  // light 3-bin median smoothing of the colour channels
  P.L = median3(P.L); P.A = median3(P.A); P.B = median3(P.B);
  return P;
}

function median3(src: Float32Array): Float32Array {
  const n = src.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = src[Math.max(0, i - 1)]!, b = src[i]!, c = src[Math.min(n - 1, i + 1)]!;
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return out;
}

/* =====================================================================
   SEGMENTS
   ===================================================================== */

interface Seg {
  a: number; b: number;                 // bin range [a, b)
  L: number; A: number; B: number; T: number; C: number;
  rgb: [number, number, number];
  texN: number; hPct: number; soil: number;   // filled in by enrich()
}

function segStats(P: Profile, a: number, b: number): Seg {
  const m = (b - a) >= 6 ? Math.floor((b - a) * 0.15) : 0;   // skip the blurry edges
  const lo = a + m, hi = b - m;
  const L: number[] = [], A: number[] = [], B: number[] = [], T: number[] = [];
  let r = 0, g = 0, bl = 0;
  for (let i = lo; i < hi; i++) {
    L.push(P.L[i]!); A.push(P.A[i]!); B.push(P.B[i]!); T.push(P.T[i]!);
    r += P.R[i]!; g += P.G[i]!; bl += P.Bc[i]!;
  }
  const n = Math.max(1, hi - lo);
  const s: Seg = {
    a, b, L: median(L), A: median(A), B: median(B), T: median(T), C: 0,
    rgb: [Math.round(r / n), Math.round(g / n), Math.round(bl / n)],
    texN: 0, hPct: 0, soil: 0,
  };
  s.C = Math.hypot(s.A, s.B);   // chroma = how colourful
  return s;
}

/** How different two layers look: colour difference (ΔE) plus a texture term. */
const segDist = (s: Seg, t: Seg): number =>
  Math.hypot(s.L - t.L, s.A - t.A, s.B - t.B) + 0.5 * Math.abs(s.T - t.T);

/* =====================================================================
   2. BEST BOUNDARIES FOR THE WHOLE JAR (dynamic programming)
   Minimises the colour/texture spread inside each layer.
   ===================================================================== */

function dpSegment(P: Profile, maxK: number, minLen: number): number[] {
  const n = P.nb, d = 4;
  const S = new Float64Array((n + 1) * d), Q = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = [P.L[i]!, P.A[i]!, P.B[i]!, P.T[i]! * 0.7];
    let q = 0;
    for (let f = 0; f < d; f++) { S[(i + 1) * d + f] = S[i * d + f]! + v[f]!; q += v[f]! * v[f]!; }
    Q[i + 1] = Q[i]! + q;
  }
  const cost = (i: number, j: number): number => {
    let c = Q[j]! - Q[i]!;
    const len = j - i;
    for (let f = 0; f < d; f++) { const s = S[j * d + f]! - S[i * d + f]!; c -= s * s / len; }
    return c;
  };
  const K = Math.max(1, Math.min(maxK, Math.floor(n / minLen)));
  let prev = new Float64Array(n + 1).fill(Infinity);
  for (let j = minLen; j <= n; j++) prev[j] = cost(0, j);
  const back: Int32Array[] = [];
  for (let k = 2; k <= K; k++) {
    const cur = new Float64Array(n + 1).fill(Infinity), bk = new Int32Array(n + 1);
    for (let j = k * minLen; j <= n; j++) {
      let best = Infinity, bi = -1;
      for (let i = (k - 1) * minLen; i <= j - minLen; i++) {
        const p = prev[i]!;
        if (p === Infinity) continue;
        const v = p + cost(i, j);
        if (v < best) { best = v; bi = i; }
      }
      cur[j] = best; bk[j] = bi;
    }
    back.push(bk); prev = cur;
  }
  const cuts: number[] = [];
  let j = n;
  for (let k = K; k >= 2; k--) { const i = back[k - 2]![j]!; cuts.push(i); j = i; }
  cuts.reverse();
  return [0, ...cuts, n];
}

/* =====================================================================
   3. CLEAN-UP
   ===================================================================== */

function mergeWeak(P: Profile, input: Seg[], T: number): Seg[] {
  const segs = input.slice();
  while (segs.length > 1) {
    let best = Infinity, bi = -1;
    for (let i = 0; i < segs.length - 1; i++) {
      const d = segDist(segs[i]!, segs[i + 1]!);
      if (d < best) { best = d; bi = i; }
    }
    if (best >= T) break;
    segs.splice(bi, 2, segStats(P, segs[bi]!.a, segs[bi + 1]!.b));
  }
  return segs;
}

function cleanSegments(P: Profile, edges: number[]): Seg[] {
  const segs = edges.slice(0, -1).map((a, i) => segStats(P, a, edges[i + 1]!));
  const minKeep = Math.max(3, Math.round(P.nb * 0.02));
  const join = (i: number): void => { segs.splice(i, 2, segStats(P, segs[i]!.a, segs[i + 1]!.b)); };

  // thin bands that are just the blur between two layers, or tiny look-alikes
  let changed = true;
  while (changed && segs.length > 1) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!, len = s.b - s.a;
      if (len >= minKeep * 1.25) continue;
      const p = segs[i - 1], q = segs[i + 1];
      const dp = p ? segDist(p, s) : Infinity, dq = q ? segDist(s, q) : Infinity;
      let merge = false;
      if (p && q && dp + dq <= 1.1 * segDist(p, q) + 1) merge = true;   // colour sits between its neighbours
      if (len < minKeep && Math.min(dp, dq) < 15) merge = true;
      if (merge) { if (dp <= dq) join(i - 1); else join(i); changed = true; break; }
    }
  }
  return mergeWeak(P, segs, MERGE_T);
}

/* =====================================================================
   4. LABELLING
   ===================================================================== */

const WHY = {
  ignore:    'Grey and stripy at the very top. Looks like the lid or the jar rim, so it is left out.',
  foam:      'Bright, bubbly band on top of the water.',
  floating:  'Thin band with bits in it near the top of the water.',
  floatDark: 'Thin, dark band near the top of the water.',
  tea:       'Smooth, see-through and orange/brown. Water stained by dissolved plant material.',
  cloudy:    'Smooth but duller than the clearest water, so fine clay may still be floating. If you can see clearly through it, change it to clear water.',
  cloudyDk:  'Smooth, dark and murky. Could also be very dark tea-coloured water. If you can see through it, change the label.',
  water:     'Smooth, bright and colourless.',
  air:       'Bright gap above the water line.',
  orgSoil:   'Thin, grainy, dark band resting right on the soil.',
  organic:   'Thin, dark band sitting on top of the soil.',
  gravel:    'Very coarse and grainy at the bottom of the jar.',
  sand:      'Bottom soil layer. Sand is the heaviest, so it settles first.',
  silt:      'Middle soil layer. Silt settles after sand.',
  siltTop:   'Top soil layer. Clay needs 24–48 hours to settle, so this is probably silt.',
  clay:      'Top soil layer. Clay is the finest and settles last.',
  fines:     'Top soil layer. Silt and clay often settle into one layer that looks the same. Split it if you can see a line inside it.',
  single:    'The only soil layer we could tell apart. If you can see faint lines in it, split it.',
} as const;

interface Labelled { s: Seg; type: LayerType; why: string; }

function classifySegments(P: Profile, segsIn: Seg[], elapsed: Elapsed): Labelled[] {
  const segs = segsIn.slice();
  const total = segs[segs.length - 1]!.b - segs[0]!.a;
  const ts = segs.map(s => s.T).sort((a, b) => a - b);
  const texRef = Math.max(1.5, ts[Math.floor((ts.length - 1) * 0.25)]!);   // smooth reference (usually the water)
  const enrich = (s: Seg): Seg => {
    s.texN = s.T / texRef;                       // graininess relative to the smoothest parts
    s.hPct = (s.b - s.a) / total;
    // "soilness": grainy, darker, not strongly coloured = soil; smooth, bright or very colourful = liquid
    s.soil = 1.2 * Math.log2(Math.min(16, Math.max(0.25, s.texN)) / 2)
           + (55 - s.L) / 25
           - Math.max(0, s.C - 35) / 12;
    return s;
  };
  segs.forEach(enrich);

  // soil sits at the bottom: choose the start point that makes "everything below = soil" fit best.
  // The bottom layer is always treated as soil (the box ends at the bottom of the jar).
  let k = segs.length - 1, best = -Infinity, suf = 0;
  for (let i = segs.length - 1; i >= 0; i--) {
    suf += segs[i]!.soil;
    if (suf > best) { best = suf; k = i; }
  }

  const out: Labelled[] = [];
  labelUpper(mergeWeak(P, segs.slice(0, k), LIQUID_MERGE_T).map(enrich), out);
  labelSediment(P, segs.slice(k), elapsed, out, enrich);
  return mergeSameType(P, out);
}

function labelUpper(upper: Seg[], out: Labelled[]): void {
  let i = 0;
  while (i < upper.length && upper[i]!.C < 12 && upper[i]!.texN > 2.2 && upper[i]!.hPct < 0.2) {
    out.push({ s: upper[i]!, type: 'ignore', why: WHY.ignore });
    i++;
  }
  const liq = upper.slice(i);
  if (!liq.length) return;
  const smooth = liq.filter(s => s.texN < 2.2);
  const refL = median((smooth.length ? smooth : liq).map(s => s.L));
  const lowC = liq.filter(s => s.C < 22 && s.texN < 2.2);
  const brightest = lowC.length ? Math.max(...lowC.map(s => s.L)) : 0;

  const types: [LayerType, string][] = liq.map((s, j) => {
    const onSoil = j === liq.length - 1;
    if (s.texN >= 2.2 && s.hPct < 0.15) {
      if (s.L > 75 && s.C < 15) return ['foam', WHY.foam];
      if (onSoil) return ['organic', WHY.orgSoil];
      return ['floating', WHY.floating];
    }
    if (s.L < refL - 20 && s.hPct < 0.15 && !onSoil) return ['floating', WHY.floatDark];
    if (s.C >= 22) return s.L >= 40 ? ['tea', WHY.tea] : ['cloudy', WHY.cloudyDk];
    if (s.L >= 55 && s.L >= brightest - 10) return ['water', WHY.water];
    return ['cloudy', WHY.cloudy];
  });
  const firstWater = types.findIndex(t => t[0] === 'water');
  if (firstWater === 0 && liq[0]!.hPct < 0.15 && types.some((t, j) => j > 0 && t[0] === 'water')) {
    types[0] = ['air', WHY.air];
  }
  liq.forEach((s, j) => out.push({ s, type: types[j]![0], why: types[j]![1] }));
}

function labelSediment(P: Profile, sed: Seg[], elapsed: Elapsed, out: Labelled[], enrich: (s: Seg) => Seg): void {
  if (!sed.length) return;
  const sedH = sed.reduce((acc, s) => acc + s.b - s.a, 0);
  const mins = sed.slice();
  let gravel: Seg | null = null, organic: Seg | null = null;

  if (mins.length >= 2) {
    // grey bottom band(s) under brown soil = stones
    let g = mins.length;
    while (g > 1 && mins[g - 1]!.C < 10) g--;
    if (g < mins.length && mins.slice(0, g).some(s => s.C >= 15)) {
      gravel = enrich(segStats(P, mins[g]!.a, mins[mins.length - 1]!.b));
      mins.splice(g);
    } else {
      // or a very coarse, grainy bottom band
      const medTex = median(mins.map(s => s.texN));
      const bottom = mins[mins.length - 1]!;
      if (bottom.texN > 1.7 * medTex && bottom.texN > 2.5) gravel = mins.pop()!;
    }
  }
  if (mins.length >= 2) {
    const t = mins[0]!, nx = mins[1]!;
    if ((t.b - t.a) / sedH < 0.18 && t.L < nx.L - 8) organic = mins.shift()!;
  }
  while (mins.length > 3) {   // at most clay / silt / sand
    let bestD = Infinity, bi = 0;
    for (let i = 0; i < mins.length - 1; i++) {
      const d = segDist(mins[i]!, mins[i + 1]!);
      if (d < bestD) { bestD = d; bi = i; }
    }
    mins.splice(bi, 2, enrich(segStats(P, mins[bi]!.a, mins[bi + 1]!.b)));
  }

  if (organic) out.push({ s: organic, type: 'organic', why: WHY.organic });
  if (mins.length === 1) {
    const only = mins[0]!;
    out.push({ s: only, type: only.texN >= 3 ? 'sand' : 'fines', why: WHY.single });
  } else if (mins.length === 2) {
    out.push(elapsed === 'short'
      ? { s: mins[0]!, type: 'silt', why: WHY.siltTop }
      : { s: mins[0]!, type: 'fines', why: WHY.fines });
    out.push({ s: mins[1]!, type: 'sand', why: WHY.sand });
  } else if (mins.length === 3) {
    out.push({ s: mins[0]!, type: 'clay', why: WHY.clay });
    out.push({ s: mins[1]!, type: 'silt', why: WHY.silt });
    out.push({ s: mins[2]!, type: 'sand', why: WHY.sand });
  }
  if (gravel) out.push({ s: gravel, type: 'gravel', why: WHY.gravel });
}

function mergeSameType(P: Profile, list: Labelled[]): Labelled[] {
  const res: Labelled[] = [];
  for (const item of list) {
    const prev = res[res.length - 1];
    if (prev && prev.type === item.type) prev.s = segStats(P, prev.s.a, item.s.b);
    else res.push({ ...item });
  }
  return res;
}

/* =====================================================================
   PUBLIC API: analyse a photo
   ===================================================================== */

function normaliseBox(box: Box, img: RgbaImage): Box {
  const clampX = (v: number) => Math.min(img.width, Math.max(0, Math.round(v)));
  const clampY = (v: number) => Math.min(img.height, Math.max(0, Math.round(v)));
  return {
    x0: clampX(Math.min(box.x0, box.x1)), x1: clampX(Math.max(box.x0, box.x1)),
    y0: clampY(Math.min(box.y0, box.y1)), y1: clampY(Math.max(box.y0, box.y1)),
  };
}

/**
 * Find and label the layers inside the box.
 * @param img     RGBA pixels of the photo.
 * @param box     Box around the jar contents (just below the lid to the bottom of the soil).
 * @param elapsed How long after shaking the photo was taken. Re-run this if it changes.
 * @throws JarTestError if the image or box is unusable.
 */
export function analyseJar(img: RgbaImage, box: Box, elapsed: Elapsed = 'ok'): JarAnalysis {
  if (!img || img.width <= 0 || img.height <= 0 || img.data.length < img.width * img.height * 4) {
    throw new JarTestError('The photo could not be read.');
  }
  const b = normaliseBox(box, img);
  const h = b.y1 - b.y0;
  if ((b.x1 - b.x0) * 0.5 < 4 || h < 40) {
    throw new JarTestError('The box is too small to analyse. Draw a bigger box around the jar contents.');
  }

  const P = buildProfile(img, b.x0, b.x1, b.y0, h);
  const minLen = Math.max(3, Math.round(P.nb * 0.012));
  const edges = dpSegment(P, DP_MAX_SEGMENTS, minLen);
  const segs = cleanSegments(P, edges);
  const final = classifySegments(P, segs, elapsed);

  const ys = [b.y0, ...final.slice(1).map(f => b.y0 + (f.s.a / P.nb) * h), b.y1];
  const layers: JarLayer[] = final.map((f, i) => ({
    type: f.type, why: f.why, rgb: f.s.rgb, y0: ys[i]!, y1: ys[i + 1]!,
  }));
  const boundaryScores = final.slice(1).map((f, i) => segDist(final[i]!.s, f.s));

  return { box: b, imageHeight: img.height, elapsed, layers, boundaryScores, edited: false };
}

/* =====================================================================
   PUBLIC API: farmer edits (all return a new JarAnalysis)
   ===================================================================== */

function cloneAnalysis(a: JarAnalysis): JarAnalysis {
  return { ...a, box: { ...a.box }, layers: a.layers.map(l => ({ ...l, rgb: [...l.rgb] as [number, number, number] })), boundaryScores: a.boundaryScores.slice() };
}
function checkIndex(a: JarAnalysis, i: number): void {
  if (!Number.isInteger(i) || i < 0 || i >= a.layers.length) throw new JarTestError('That layer does not exist.');
}

/** Change a layer's label. */
export function setLayerType(a: JarAnalysis, i: number, type: LayerType): JarAnalysis {
  checkIndex(a, i);
  const n = cloneAnalysis(a);
  n.layers[i]!.type = type;
  n.layers[i]!.why = 'Set by you.';
  n.edited = true;
  return n;
}

/** Split a layer in two at its middle. The new lower half keeps the same label. */
export function splitLayer(a: JarAnalysis, i: number): JarAnalysis {
  checkIndex(a, i);
  if (a.layers.length >= MAX_LAYERS) throw new JarTestError('That is the maximum number of layers.');
  const l = a.layers[i]!;
  if (l.y1 - l.y0 < 8) throw new JarTestError('That layer is too thin to split.');
  const n = cloneAnalysis(a);
  const mid = (l.y0 + l.y1) / 2;
  n.layers[i]!.y1 = mid;
  n.layers.splice(i + 1, 0, {
    type: l.type, why: 'Split by you. Move the new line into place and pick a label.',
    rgb: [...l.rgb] as [number, number, number], y0: mid, y1: l.y1,
  });
  n.boundaryScores.splice(i, 0, 0);
  n.edited = true;
  return n;
}

/** Merge a layer into the one above it. The layer above keeps its label. */
export function mergeLayerUp(a: JarAnalysis, i: number): JarAnalysis {
  checkIndex(a, i);
  if (i === 0) throw new JarTestError('The top layer has nothing above it to merge with.');
  const n = cloneAnalysis(a);
  n.layers[i - 1]!.y1 = n.layers[i]!.y1;
  n.layers.splice(i, 1);
  n.boundaryScores.splice(i - 1, 1);
  n.edited = true;
  return n;
}

/**
 * Move a boundary line. Index 0 is the top of the contents, index layers.length is the bottom,
 * and index k in between is the line between layers k-1 and k.
 */
export function moveBoundary(a: JarAnalysis, k: number, y: number): JarAnalysis {
  const nL = a.layers.length;
  if (!Number.isInteger(k) || k < 0 || k > nL) throw new JarTestError('That line does not exist.');
  const gap = 3;
  const lo = k > 0 ? a.layers[k - 1]!.y0 + gap : 0;
  const hi = k < nL ? a.layers[k]!.y1 - gap : a.imageHeight;
  const yy = Math.min(hi, Math.max(lo, y));
  const n = cloneAnalysis(a);
  if (k > 0) n.layers[k - 1]!.y1 = yy;
  if (k < nL) n.layers[k]!.y0 = yy;
  if (k === 0) n.box.y0 = yy;
  if (k === nL) n.box.y1 = yy;
  n.edited = true;
  return n;
}

/** All boundary lines, top to bottom (length = layers.length + 1). Handy for drawing. */
export function boundaryLines(a: JarAnalysis): number[] {
  if (!a.layers.length) return [];
  return [...a.layers.map(l => l.y0), a.layers[a.layers.length - 1]!.y1];
}

/* =====================================================================
   PUBLIC API: turn layers into a soil result
   ===================================================================== */

function orderLooksOdd(layers: JarLayer[]): boolean {
  const rank: Partial<Record<LayerType, number>> = { gravel: 0, sand: 1, silt: 2, fines: 2.5, clay: 3 };  // heaviest settles lowest
  const soilSet: LayerType[] = ['gravel', 'sand', 'silt', 'fines', 'clay', 'organic'];
  const liquidSet: LayerType[] = ['air', 'foam', 'floating', 'water', 'tea', 'cloudy'];
  let prev = Infinity, odd = false, firstSoil = -1;
  layers.forEach((l, i) => {
    const r = rank[l.type];
    if (r !== undefined) {
      if (r > prev) odd = true;
      prev = r;
    }
    if (firstSoil < 0 && soilSet.includes(l.type)) firstSoil = i;
  });
  if (firstSoil >= 0) layers.forEach((l, i) => { if (i > firstSoil && liquidSet.includes(l.type)) odd = true; });
  return odd;
}

export function computeResult(a: JarAnalysis): JarResult {
  const { layers, boundaryScores: scores, edited, elapsed } = a;
  const heights = layers.map(l => Math.max(0, l.y1 - l.y0));
  const hgt: Partial<Record<LayerType, number>> = {};
  let total = 0;
  layers.forEach((l, i) => {
    if (l.type === 'ignore') return;
    hgt[l.type] = (hgt[l.type] ?? 0) + heights[i]!;
    total += heights[i]!;
  });
  total = Math.max(1, total);
  const h = (t: LayerType): number => hgt[t] ?? 0;

  // sand / silt / clay shares ("silt + clay" layers are split half and half)
  const fine = h('sand') + h('silt') + h('clay') + h('fines');
  let sandPct: number | null = null, siltPct: number | null = null, clayPct: number | null = null;
  let cls: string | null = null;
  let props: { drain: string; water: string; note: string } | null = null;
  if (fine > 0) {
    const r = [h('clay') + h('fines') / 2, h('silt') + h('fines') / 2, h('sand')].map(v => Math.round(v / fine * 100));
    const maxIdx = r.indexOf(Math.max(...r));
    r[maxIdx] = r[maxIdx]! + 100 - (r[0]! + r[1]! + r[2]!);
    [clayPct, siltPct, sandPct] = [r[0]!, r[1]!, r[2]!];
    cls = textureClass(sandPct, siltPct, clayPct);
    props = TEXTURE_PROPERTIES[cls] ?? { drain: '—', water: '—', note: 'Check the layer labels and try again.' };
  }

  // organic matter and stones, as a share of all the solid stuff in the jar
  const organicH = h('organic') + h('floating');
  const solids = fine + h('gravel') + organicH;
  const share = (v: number): number => (solids > 0 && v > 0 ? Math.max(1, Math.round(v / solids * 100)) : 0);
  const organicMatterPct = share(organicH);
  const gravelPct = share(h('gravel'));
  const organicMatterLevel: JarResult['organicMatterLevel'] =
    organicH === 0 ? 'None seen' : organicMatterPct < 3 ? 'Little' : organicMatterPct < 10 ? 'Some' : 'A lot';
  const stoneLevel: JarResult['stoneLevel'] =
    h('gravel') === 0 ? 'None seen' : gravelPct < 5 ? 'Very few' : gravelPct < 15 ? 'Some' : 'Stony';

  const present = new Set(layers.map(l => l.type));
  const mineralCount = layers.filter(l => MINERAL.includes(l.type)).length;

  // confidence: how clearly the soil layers stand apart in the photo
  let confidence: JarResult['confidence'];
  if (edited) {
    confidence = { key: 'adjusted', label: 'Adjusted by you' };
  } else {
    const soilish = (t: LayerType) => MINERAL.includes(t) || t === 'gravel' || t === 'organic';
    let rel: number[] = [];
    for (let i = 0; i < scores.length && i + 1 < layers.length; i++) {
      if (soilish(layers[i]!.type) || soilish(layers[i + 1]!.type)) rel.push(scores[i]!);
    }
    if (!rel.length) rel = scores;
    const m = rel.length ? Math.min(...rel) : 0;
    confidence = m >= 12 ? { key: 'high', label: 'High confidence' }
               : m >= 6  ? { key: 'medium', label: 'Medium confidence' }
               :           { key: 'low', label: 'Low confidence' };
    if (confidence.key === 'high' && (present.has('fines') || mineralCount === 1)) {
      confidence = { key: 'medium', label: 'Medium confidence' };
    }
  }

  const warnings: string[] = [];
  if (elapsed === 'short') warnings.push('Clay takes 24–48 hours to settle, so the clay share is probably too low. Wait longer and take a new photo.');
  if (elapsed === 'mid') warnings.push('Clay may not be fully settled yet. For the best result, wait 24–48 hours.');
  if (present.has('cloudy')) warnings.push('Part of the water looks cloudy, which usually means clay is still floating, so the clay share may be too low. If the water looks clear to you, change that layer’s label.');
  if (fine === 0) warnings.push('No sand, silt or clay layer is labelled yet, so we cannot work out the soil type. Check the layer labels.');
  if (mineralCount === 1 && !edited) warnings.push('We could only find one soil layer. Most soils show at least two. Look closely at the jar and split it if you can see lines.');
  if (orderLooksOdd(layers)) warnings.push('The layers are in an unusual order (for example sand above clay, or water below soil). The jar may have been disturbed, or a label may be wrong. We still show the result, but please check the labels.');
  if (confidence.key === 'low') warnings.push('The soil layers are hard to tell apart in this photo. Try brighter, even light, or move the lines to where you can see the layers change.');

  const typesPresent = LAYER_TYPE_ORDER.filter(t => present.has(t));
  const notes = typesPresent
    .filter(t => LAYER_TYPES[t].note)
    .map(t => ({ type: t, label: LAYER_TYPES[t].label, note: LAYER_TYPES[t].note }));

  return {
    sandPct, siltPct, clayPct,
    textureClass: cls,
    drainage: props ? props.drain : null,
    waterHolding: props ? props.water : null,
    propertyNote: props ? props.note : null,
    organicMatterPct, organicMatterLevel, gravelPct, stoneLevel,
    confidence, warnings, notes, typesPresent,
    layerList: layers.map((l, i) => ({
      type: l.type,
      heightPct: l.type === 'ignore' ? 0 : Math.round(heights[i]! / total * 100),
    })),
    elapsed, edited,
  };
}

/** What the planner needs from the jar test (replaces the map-based soil texture for that field). */
export interface JarSoilPayload {
  source: 'jar-photo';
  sandPct: number | null; siltPct: number | null; clayPct: number | null;
  textureClass: string | null;
  drainage: string | null; waterHolding: string | null;
  organicMatterLevel: JarResult['organicMatterLevel']; organicMatterPct: number;
  stoneLevel: JarResult['stoneLevel']; gravelPct: number;
  siltClayCombined: boolean; cloudyWater: boolean; teaColouredWater: boolean; foam: boolean;
  layers: JarResult['layerList'];
  confidence: ConfidenceKey;
  adjustedByFarmer: boolean;
  photoTakenAfter: Elapsed;
}

export function toPlannerPayload(r: JarResult): JarSoilPayload {
  return {
    source: 'jar-photo',
    sandPct: r.sandPct, siltPct: r.siltPct, clayPct: r.clayPct,
    textureClass: r.textureClass,
    drainage: r.drainage, waterHolding: r.waterHolding,
    organicMatterLevel: r.organicMatterLevel, organicMatterPct: r.organicMatterPct,
    stoneLevel: r.stoneLevel, gravelPct: r.gravelPct,
    siltClayCombined: r.typesPresent.includes('fines'),
    cloudyWater: r.typesPresent.includes('cloudy'),
    teaColouredWater: r.typesPresent.includes('tea'),
    foam: r.typesPresent.includes('foam'),
    layers: r.layerList,
    confidence: r.confidence.key,
    adjustedByFarmer: r.edited,
    photoTakenAfter: r.elapsed,
  };
}