// The soil jar test: a photo of a settled jar of soil and water -> sand, silt and clay for one field.
//
// The vendored module (src/vendor/rotation-maxxing/jar-test/jar_test.ts) finds and labels the layers.
// This file is the app's only door to it, and every guard sits here (the vendored file is never edited):
//
//   analysePhoto(img, box, elapsed)   -> { analysis } | { error: 'photo' | 'box' }   never throws
//   verdict(analysis, { isDemoFarm, sample })   -> { result, canUse, reason, hint, mineralTypes }
//   toRecord(analysis, result, { fieldId, sample, at })   -> JarRecord, the only thing the planner sees
//
// The gates stop a confident wrong answer: smooth bands the module reads as water and one "silt + clay"
// layer (a 0/50/50 "Silty clay"), a photo taken before the clay settled, faint layers, and a box with
// NaN in it. "I'll mark the layers myself" (markByHand) is always there as a way through.
//
// Also: the box helpers for drawing and the keyboard, the layer rows for the list, and Manami's lines.
// Pure (no DOM): lines are plain text, so the caller escapes them where they go into HTML.
import {
  analyseJar, computeResult, moveBoundary, JarTestError, LAYER_TYPES,
} from '../vendor/rotation-maxxing/jar-test/jar_test.ts';

export { LAYER_TYPES, LAYER_TYPE_ORDER, setLayerType, splitLayer, mergeLayerUp, boundaryLines } from '../vendor/rotation-maxxing/jar-test/jar_test.ts';

/** The soil layer types: what sand, silt and clay are worked out from. */
export const MINERAL = ['sand', 'silt', 'clay', 'fines'];
/** What sits above the soil. */
export const LIQUID = ['air', 'foam', 'floating', 'water', 'tea', 'cloudy'];
/** A photo is drawn at most this many pixels on its long side before it is read. */
export const WORK_MAX = 1000;
/** The smallest box that is read, in pixels. */
export const MIN_BOX = { w: 24, h: 48 };
/** The box round the sample jar's contents (src/plan/jarSample.js, 480×640). */
export const SAMPLE_BOX = { x0: 160, x1: 320, y0: 63, y1: 577 };

const ELAPSED = ['short', 'mid', 'ok'];
const MAX_LAYERS = 12; // the module's own limit for a split
const MIN_SPLIT = 8; // the module won't split a layer thinner than this (pixels)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (...vs) => vs.every((v) => Number.isFinite(v));
const pctOf = (v, of) => (of > 0 ? Math.round((v / of) * 100) : 0);

// ---- the box ----

/** The box a new photo starts with: the middle of the picture, as the jar test demo does. */
export function defaultBox(w, h) {
  return { x0: Math.round(w * 0.35), x1: Math.round(w * 0.65), y0: Math.round(h * 0.15), y1: Math.round(h * 0.9) };
}

/**
 * The box sorted (corners in any order), clamped to the image and rounded, or null when any value
 * isn't a finite number (NaN gets past the module's own check) or it is smaller than MIN_BOX.
 */
export function cleanBox(box, w, h) {
  if (!box || !finite(box.x0, box.x1, box.y0, box.y1, w, h) || w <= 0 || h <= 0) return null;
  const x0 = Math.round(clamp(Math.min(box.x0, box.x1), 0, w)), x1 = Math.round(clamp(Math.max(box.x0, box.x1), 0, w));
  const y0 = Math.round(clamp(Math.min(box.y0, box.y1), 0, h)), y1 = Math.round(clamp(Math.max(box.y0, box.y1), 0, h));
  if (x1 - x0 < MIN_BOX.w || y1 - y0 < MIN_BOX.h) return null;
  return { x0, x1, y0, y1 };
}

/**
 * Moves one edge ('top' | 'bottom' | 'left' | 'right') by d pixels: a new box, kept inside the image
 * and at least MIN_BOX. A box that doesn't clean up starts again from the default box. Null only when
 * the image itself is smaller than MIN_BOX.
 */
export function nudgeBox(box, edge, d, w, h) {
  const b = cleanBox(box, w, h) ?? cleanBox(defaultBox(w, h), w, h) ?? cleanBox({ x0: 0, x1: w, y0: 0, y1: h }, w, h);
  if (!b) return null;
  const by = Number.isFinite(d) ? d : 0;
  const n = { ...b };
  if (edge === 'top') n.y0 = Math.round(clamp(b.y0 + by, 0, b.y1 - MIN_BOX.h));
  else if (edge === 'bottom') n.y1 = Math.round(clamp(b.y1 + by, b.y0 + MIN_BOX.h, h));
  else if (edge === 'left') n.x0 = Math.round(clamp(b.x0 + by, 0, b.x1 - MIN_BOX.w));
  else if (edge === 'right') n.x1 = Math.round(clamp(b.x1 + by, b.x0 + MIN_BOX.w, w));
  return n;
}

/** The box for a screen reader: "Box from 15% to 90% down, 35% to 65% across". */
export function boxLabel(box, w, h) {
  return `Box from ${pctOf(box.y0, h)}% to ${pctOf(box.y1, h)}% down, ${pctOf(box.x0, w)}% to ${pctOf(box.x1, w)}% across`;
}

const EDGE = { top: ['Top', 'y0', 'down'], bottom: ['Bottom', 'y1', 'down'], left: ['Left', 'x0', 'across'], right: ['Right', 'x1', 'across'] };

/** One edge for a screen reader: "Top edge at 18% down", "Left edge at 35% across". */
export function edgeLabel(box, edge, w, h) {
  const [name, key, way] = EDGE[edge] || EDGE.top;
  return `${name} edge at ${pctOf(box[key], way === 'down' ? h : w)}% ${way}`;
}

// ---- reading the photo ----

const goodImage = (img) => !!img && finite(img.width, img.height) && img.width > 0 && img.height > 0
  && !!img.data && img.data.length >= img.width * img.height * 4;

/**
 * Finds and labels the layers in the box. Never throws: a photo that can't be read gives
 * { error: 'photo' }, a box that is missing, has a value that isn't a number, or is too small gives
 * { error: 'box' } (without reaching the module). `analyse` is there for the tests.
 */
export function analysePhoto(img, box, elapsed = 'ok', { analyse = analyseJar } = {}) {
  if (!goodImage(img)) return { error: 'photo' };
  const b = cleanBox(box, img.width, img.height);
  if (!b) return { error: 'box' };
  try {
    return { analysis: analyse(img, b, ELAPSED.includes(elapsed) ? elapsed : 'ok') };
  } catch (e) {
    return { error: e instanceof JarTestError && /box/i.test(e.message) ? 'box' : 'photo' };
  }
}

/** Moves boundary line k to y (the module's moveBoundary), or gives the analysis back unchanged when y isn't a number or there is no line k. */
export function safeMove(analysis, k, y) {
  if (!analysis || !Number.isFinite(y)) return analysis;
  try {
    return moveBoundary(analysis, k, y);
  } catch (e) {
    if (e instanceof JarTestError) return analysis;
    throw e;
  }
}

/**
 * The analysis with a new settling time. Untouched, it is read again (the labels can change with the
 * time); once the farmer has changed anything, only the time changes (computeResult reads it).
 */
export function withElapsed(analysis, elapsed, img) {
  const e = ELAPSED.includes(elapsed) ? elapsed : 'ok';
  if (!analysis.edited && img) {
    const again = analysePhoto(img, analysis.box, e);
    if (again.analysis) return again.analysis;
  }
  return { ...analysis, elapsed: e };
}

// the median colour of the few columns at the middle of the box, over rows [y0, y1)
function middleColour(img, box, y0, y1) {
  if (!goodImage(img)) return null;
  const xm = Math.round((box.x0 + box.x1) / 2);
  const cols = [xm - 2, xm - 1, xm, xm + 1, xm + 2].map((x) => clamp(x, 0, img.width - 1));
  const rowStep = Math.max(1, Math.floor((y1 - y0) / 80));
  const ch = [[], [], []];
  for (let y = Math.floor(y0); y < Math.ceil(y1); y += rowStep) {
    const row = clamp(y, 0, img.height - 1) * img.width;
    for (const x of cols) {
      const o = (row + x) * 4;
      ch[0].push(img.data[o]); ch[1].push(img.data[o + 1]); ch[2].push(img.data[o + 2]);
    }
  }
  if (!ch[0].length) return null;
  return ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1]);
}

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * "I'll mark the layers myself": four layers the farmer then moves into place. Water down to 40% of
 * the box, clay to 60%, silt to 80%, sand to the bottom, each coloured from the middle of the photo
 * there. It counts as set by the farmer (confidence 'adjusted'), so the gate lets it through.
 */
export function markByHand(box, imageHeight, img, elapsed = 'ok') {
  // the image's size, or (with no photo) one just big enough for the box
  const fin = (...vs) => vs.filter((v) => Number.isFinite(v));
  const H = Number.isFinite(imageHeight) && imageHeight > 0 ? imageHeight
    : goodImage(img) ? img.height : Math.max(...fin(box?.y0, box?.y1), MIN_BOX.h);
  const W = goodImage(img) ? img.width : Math.max(...fin(box?.x0, box?.x1), MIN_BOX.w);
  const b = cleanBox(box, W, H) ?? cleanBox(defaultBox(W, H), W, H) ?? { x0: 0, x1: W, y0: 0, y1: H };
  const span = b.y1 - b.y0;
  const cuts = [0, 0.4, 0.6, 0.8, 1].map((f) => b.y0 + span * f);
  cuts[4] = b.y1;
  const layers = ['water', 'clay', 'silt', 'sand'].map((type, i) => ({
    type,
    why: 'Set by you.',
    rgb: middleColour(img, b, cuts[i], cuts[i + 1]) ?? hexRgb(LAYER_TYPES[type].color),
    y0: cuts[i],
    y1: cuts[i + 1],
  }));
  return { box: b, imageHeight: H, elapsed: ELAPSED.includes(elapsed) ? elapsed : 'ok', layers, boundaryScores: [0, 0, 0], edited: true };
}

// ---- the gate ----

/** Each layer's height, without the parts that aren't jar contents. */
const heightsOf = (analysis) => analysis.layers.map((l) => (l.type === 'ignore' ? 0 : Math.max(0, l.y1 - l.y0) || 0));

// the different soil layer types that have some height (toRecord drops the rest, so usableJar agrees)
const mineralTypesOf = (analysis) => {
  const hs = heightsOf(analysis);
  return new Set(analysis.layers.filter((l, i) => hs[i] > 0 && MINERAL.includes(l.type)).map((l) => l.type)).size;
};

/**
 * May this jar be used on a field? `reason` is the first that applies, else null:
 *   'early'  the photo was taken under 2 hours after shaking (the clay hasn't settled)
 *   'none'   no texture (no sand, silt or clay layer)
 *   'one'    fewer than 2 different soil layer types (smooth bands, a blank photo, one "silt + clay")
 *   'low'    the layers are too faint to trust
 *   'sample' the sample jar, on a farm that isn't the demo farm
 * `hint` 'smooth' (advice only): the module may have read smooth clay as water.
 */
export function verdict(analysis, { isDemoFarm = false, sample = false } = {}) {
  const result = computeResult(analysis);
  const mineralTypes = mineralTypesOf(analysis);
  const reason = analysis.elapsed === 'short' ? 'early'
    : result.textureClass == null ? 'none'
      : mineralTypes < 2 ? 'one'
        : result.confidence.key === 'low' ? 'low'
          : sample && !isDemoFarm ? 'sample'
            : null;
  let hint = null;
  if (!analysis.edited) {
    const first = analysis.layers.findIndex((l) => MINERAL.includes(l.type));
    const above = first > 0 ? analysis.layers[first - 1].type : null;
    const hs = heightsOf(analysis);
    const total = hs.reduce((a, b) => a + b, 0);
    const murky = analysis.layers.reduce((s, l, i) => s + (l.type === 'cloudy' || l.type === 'tea' ? hs[i] : 0), 0);
    if (above === 'cloudy' || above === 'tea' || (total > 0 && murky / total > 0.35)) hint = 'smooth';
  }
  return { result, canUse: reason == null, reason, hint, mineralTypes };
}

// ---- the layer list ----

/**
 * One row per layer, top to bottom, for the list beside the photo. `lineAbove` is the boundary line
 * above the layer (moveBoundary's index), null on the top layer.
 */
export function layerRows(analysis, result = computeResult(analysis)) {
  const n = analysis.layers.length;
  return analysis.layers.map((l, i) => {
    const pct = result.layerList[i]?.heightPct ?? 0;
    const info = LAYER_TYPES[l.type] || LAYER_TYPES.other;
    return {
      i,
      type: l.type,
      label: info.label,
      short: info.short,
      pct,
      rgb: l.rgb.map((v) => Math.round(clamp(v, 0, 255))),
      why: l.why,
      canSplit: n < MAX_LAYERS && l.y1 - l.y0 >= MIN_SPLIT,
      canMerge: i > 0,
      lineAbove: i > 0 ? i : null,
      ariaLabel: `Layer ${i + 1} of ${n}, ${pct}% of the jar`,
    };
  });
}

/** All the layers in one line, for the photo's screen-reader label: "9 layers: Air gap 6%, …, Sand 19%". */
export function layersLabel(analysis) {
  const rows = layerRows(analysis);
  const head = rows.length === 1 ? '1 layer' : `${rows.length} layers`;
  return `${head}: ${rows.map((r) => `${r.label} ${r.pct}%`).join(', ')}`;
}

// ---- the record ----

/**
 * The saved jar test for a field: plain, JSON-safe data, and the only thing the planner sees. Layers
 * are top to bottom without the parts that aren't jar contents, each with its photo colour and its
 * share of the contents.
 */
export function toRecord(analysis, result, { fieldId, sample = false, at = new Date() } = {}) {
  const hs = heightsOf(analysis);
  const total = hs.reduce((a, b) => a + b, 0) || 1;
  const layers = analysis.layers
    .map((l, i) => ({ type: l.type, rgb: l.rgb.map((v) => Math.round(clamp(Number(v) || 0, 0, 255))), share: Math.round((hs[i] / total) * 10000) / 10000 }))
    .filter((l, i) => l.type !== 'ignore' && hs[i] > 0);
  return {
    v: 1,
    fieldId,
    at: at instanceof Date ? at.toISOString() : String(at),
    sample: !!sample,
    elapsed: analysis.elapsed,
    textureClass: result.textureClass,
    sandPct: result.sandPct,
    siltPct: result.siltPct,
    clayPct: result.clayPct,
    confidence: result.confidence.key,
    adjusted: !!result.edited,
    layers,
    warnings: warnLines(result.warnings),
  };
}

// ---- Manami's words ----

/** What Manami says through the jar test (every line passes lintLine in futuresVoice.js). */
export const JAR_LINES = {
  howto: 'I’ll find the layers and work out your sand, silt and clay. It’s a rough guide, not a lab test. Your photo stays on this device.',
  sample: 'This is a sample jar, not your soil. Use it to see how it works.',
  box: 'Drag a box from just under the lid to the bottom of the soil. Keep it inside the glass.',
  reading: 'Reading your layers…',
  found: (n) => `I found ${n === 1 ? 'one layer' : `${n} layers`}. Check each label, and drag a line if it’s off.`,
  byHand: 'Okay, mark them yourself. Drag each line to where the layers change, then check the labels.',
  photo: 'I couldn’t open that photo. Try another one, or the sample jar.',
  smallBox: 'That box is too small for me to read. Make it bigger, from the lid down to the bottom of the soil.',
  early: 'Clay needs a day or two to settle. Take another photo tomorrow and I’ll use that one.',
  none: 'Label at least two layers as sand, silt or clay first.',
  one: 'I can only see one soil layer, so I can’t split sand, silt and clay. Split it where you see a line, or mark the layers yourself.',
  low: 'The layers are too faint for me to trust. Try brighter, even light, or move the lines yourself.',
  sampleOnly: 'This is a sample jar, so I won’t use it on your field.',
  smooth: 'Some of that “water” may be smooth clay. If the jar looks solid there, change the label to clay.',
  onlyTexture: 'I only use the sand, silt and clay. Drainage and organic matter stay with the soil map.',
  used: (name, cls, placed = null) => `Done. By your jar, ${name} is ${String(cls).toLowerCase()}, and I’ll plan with that.${placed === 'gate' ? ' I’ve left the jar by its gate.' : placed === 'beside' ? ' I’ve left the jar beside it.' : placed === 'none' ? ' There’s no clear grass by it just now, so I’ll set the jar out when there’s room.' : ''}`,
  same: (name) => `Done. Your jar agrees with the soil map on ${name}, so your plans won’t change.`,
  undone: (name) => `Okay, ${name} is back on the soil map.`,
  earlier: 'Here’s your jar from earlier. I didn’t keep the photo, so take a new one to change it.',
  replanned: 'I’ve worked the plans out again with your jar test.',
};

/** verdict's reasons -> the JAR_LINES key that explains them. */
export const REASON_LINE = { early: 'early', none: 'none', one: 'one', low: 'low', sample: 'sampleOnly' };

/** The line for a verdict reason, or null. */
export const reasonLine = (reason) => (REASON_LINE[reason] ? JAR_LINES[REASON_LINE[reason]] : null);

/** The module's 7 warnings in Manami's words. */
export const JAR_WARN = [
  { re: /^Clay takes 24/, line: 'Clay takes a day or two to settle, so this photo is early. The clay share is probably too low.' },
  { re: /^Clay may not be fully/, line: 'The clay may still be settling. A photo after a full day will be closer.' },
  { re: /looks cloudy/, line: 'Part of the water looks cloudy, so some clay may still be floating. If it looks clear to you, change that layer to clear water.' },
  { re: /^No sand, silt or clay/, line: 'I can’t see a sand, silt or clay layer yet. Check the labels.' },
  { re: /only find one soil layer/, line: 'I could only find one soil layer. Most soils show two or three, so split it where you see a line.' },
  { re: /unusual order/, line: 'The layers are in an odd order, like sand over clay. The jar may have been bumped, or a label is off.' },
  { re: /hard to tell apart/, line: 'Your soil layers are hard to tell apart in this photo. Try brighter, even light, or move the lines yourself.' },
];

/** The module's warnings as Manami says them; one she doesn't know is kept word for word. */
export function warnLines(warnings) {
  return (warnings || []).map((w) => JAR_WARN.find((x) => x.re.test(w))?.line ?? String(w));
}
