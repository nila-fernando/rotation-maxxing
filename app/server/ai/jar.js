// The jar test, read by Claude's vision: POST .../jar { v: 1, image: { mediaType, data }, elapsed, fieldName? }
// -> { ok: true, v: 1, reading: { usable, problems, box, layers, sandPct, siltPct, clayPct, confidence, note }, model, served_by_fallback }
//
// One non-streaming Messages call with a JSON schema (output_config.format). The server owns the prompt
// and checks everything the model gives back (fractions clamped, bad layers dropped, percentages
// re-worked from the mineral layers' heights). The photo is never kept.

export const JAR_LIMITS = Object.freeze({ bytes: 2_500_000, problems: 6, layers: 12, noteChars: 400, problemChars: 120, nameChars: 60 });
export const JAR_MAX_TOKENS = 6000;
export const JAR_EFFORT = 'medium';
export const JAR_MEDIA = ['image/jpeg', 'image/png', 'image/webp'];
export const JAR_ELAPSED = ['short', 'mid', 'ok'];
/** The vendored jar module's LayerType values (src/vendor/rotation-maxxing/jar-test/jar_test.ts). */
export const JAR_LAYER_TYPES = ['air', 'foam', 'floating', 'water', 'tea', 'cloudy', 'organic', 'clay', 'fines', 'silt', 'sand', 'gravel', 'other', 'ignore'];
export const JAR_PROBLEMS = ['no_jar', 'not_settled', 'blurry', 'too_dark', 'angle', 'other'];
const MINERAL = ['sand', 'silt', 'clay', 'fines'];

export const JAR_SYSTEM = `You are Manami, the guide inside Rotation-Maxxing, a crop rotation app. A farmer has done a soil jar test: soil, water and a little soap shaken in a clear jar, then left to settle. Sand settles first at the bottom, then silt, then clay on top of the soil, with water (clear, cloudy or tea-coloured) above and maybe floating bits of plant material and an air gap under the lid. You read their photo and say where each layer is.

What to give back
- usable: true only when the photo shows a jar of settled soil and water clearly enough to see the soil layers.
- problems: short plain reasons the photo is hard to read, each with a code: no_jar (no jar of soil in the photo), not_settled (still muddy or swirling, layers not formed), blurry, too_dark, angle (tilted or seen from too high or low), other. Empty when the photo is fine.
- box: the settled contents of the jar, as fractions of the image (0 is the left or top edge, 1 the right or bottom). From just under the lid down to the bottom of the soil, and inside the glass on the left and right.
- layers: every layer inside the box, top to bottom, touching each other, with y0 and y1 as fractions of the whole image height. The first starts at the box top and the last ends at the box bottom. Types: air (gap under the lid), foam, floating (plant bits floating), water (clear), tea (see-through but brown or yellow), cloudy (murky water, clay still floating), organic (thin dark settled layer on the soil), clay, silt, sand, fines (silt and clay you truly cannot tell apart), gravel (stones at the bottom), other, ignore (lid, rim, a label in the way).
- sandPct, siltPct, clayPct: the share of each by the heights of the soil layers alone, adding up to 100.
- confidence: high when the soil layer lines are sharp, medium when you can see them but not crisply, low when you are mostly guessing.
- note: one or two short sentences to the farmer about what you see. Warm and plain, like a neighbor who knows farming. First person. No markdown, no emoji, no numbers they can already see.

How to read it
- Look closely at colour and texture changes in the soil column. Sand looks grainy and often paler or speckled; silt is finer and smooth; clay is the smoothest, often a slightly different shade, on top of the soil. Many soils show only a faint line between silt and clay: give your best split, and say so in the note.
- Smooth, solid-looking material under the water is soil (usually clay), not water.
- If the farmer says it settled only a short time, the clay may still be in the water: read what you see and mention it kindly.
- Never invent layers you cannot see. If the photo is not a soil jar, set usable to false, say why in problems, and still give your best box and layers or an empty list.`;

const problem = { type: 'object', properties: { code: { type: 'string', enum: JAR_PROBLEMS }, text: { type: 'string' } }, required: ['code', 'text'], additionalProperties: false };
const frac = { type: 'number' };
export const JAR_SCHEMA = {
  type: 'object',
  properties: {
    usable: { type: 'boolean' },
    problems: { type: 'array', items: problem },
    box: { type: 'object', properties: { x0: frac, y0: frac, x1: frac, y1: frac }, required: ['x0', 'y0', 'x1', 'y1'], additionalProperties: false },
    layers: {
      type: 'array',
      items: { type: 'object', properties: { type: { type: 'string', enum: JAR_LAYER_TYPES }, y0: frac, y1: frac }, required: ['type', 'y0', 'y1'], additionalProperties: false },
    },
    sandPct: { type: 'number' },
    siltPct: { type: 'number' },
    clayPct: { type: 'number' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string' },
  },
  required: ['usable', 'problems', 'box', 'layers', 'sandPct', 'siltPct', 'clayPct', 'confidence', 'note'],
  additionalProperties: false,
};

export class JarBadRequest extends Error {}
const bad = (msg) => { throw new JarBadRequest(msg); };
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The request body. Throws JarBadRequest. */
export function validateJarBody(body) {
  if (!isObj(body)) bad('body must be an object');
  if (body.v !== 1) bad('v must be 1');
  const im = body.image;
  if (!isObj(im)) bad('image must be an object');
  if (!JAR_MEDIA.includes(im.mediaType)) bad('image.mediaType must be image/jpeg, image/png or image/webp');
  if (typeof im.data !== 'string' || im.data.length < 100) bad('image.data must be base64');
  if (im.data.length % 4 !== 0 || !BASE64.test(im.data)) bad('image.data must be base64');
  const elapsed = body.elapsed == null ? 'ok' : JAR_ELAPSED.includes(body.elapsed) ? body.elapsed : bad('elapsed must be short, mid or ok');
  const fieldName = body.fieldName == null ? null : typeof body.fieldName === 'string' ? body.fieldName.trim().slice(0, JAR_LIMITS.nameChars).replace(/[<>]/g, '') : bad('fieldName must be a string');
  return { mediaType: im.mediaType, data: im.data, elapsed, fieldName: fieldName || null };
}

const ELAPSED_WORDS = { short: 'under 2 hours', mid: '2 to 24 hours', ok: 'a day or more' };

/** The Messages request. Pure, for tests. */
export function buildJarParams(config, { mediaType, data, elapsed, fieldName }) {
  const ask = `The farmer says the jar settled for ${ELAPSED_WORDS[elapsed] || ELAPSED_WORDS.ok}.${fieldName ? ` The soil is from their field "${fieldName}".` : ''} Read the layers in this photo.`;
  return {
    model: config.model,
    max_tokens: JAR_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: JAR_EFFORT, format: { type: 'json_schema', schema: JAR_SCHEMA } },
    system: JAR_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data } }, { type: 'text', text: ask }] }],
    ...(config.fallbacks ? { fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] } : {}),
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plain = (s, n) => String(s ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/[*_#`<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Whole percentages adding to 100 (the largest takes the rounding), or nulls when there is nothing. */
export function toHundred(parts) {
  const total = parts.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return parts.map(() => null);
  const r = parts.map((v) => Math.round((v / total) * 100));
  const big = r.indexOf(Math.max(...r));
  r[big] += 100 - r.reduce((a, b) => a + b, 0);
  return r;
}

/**
 * The model's JSON made safe: box sorted and clamped to 0..1, layers sorted top to bottom, clamped to
 * the box, made to touch, thin or bad ones dropped; sand/silt/clay worked out again from the mineral
 * layers (the model's own numbers only when there are none). Null when it isn't an object at all.
 */
export function normaliseJarOutput(raw) {
  if (!isObj(raw)) return null;
  const problems = (Array.isArray(raw.problems) ? raw.problems : [])
    .filter(isObj).slice(0, JAR_LIMITS.problems)
    .map((p) => ({ code: JAR_PROBLEMS.includes(p.code) ? p.code : 'other', text: plain(p.text, JAR_LIMITS.problemChars) }))
    .filter((p) => p.text);
  const b = isObj(raw.box) ? raw.box : {};
  let box = null;
  if ([b.x0, b.x1, b.y0, b.y1].every((v) => num(v) != null)) {
    const x0 = clamp01(Math.min(b.x0, b.x1)), x1 = clamp01(Math.max(b.x0, b.x1));
    const y0 = clamp01(Math.min(b.y0, b.y1)), y1 = clamp01(Math.max(b.y0, b.y1));
    if (x1 - x0 >= 0.03 && y1 - y0 >= 0.05) box = { x0, y0, x1, y1 };
  }
  let layers = (Array.isArray(raw.layers) ? raw.layers : [])
    .filter((l) => isObj(l) && JAR_LAYER_TYPES.includes(l.type) && num(l.y0) != null && num(l.y1) != null)
    .map((l) => ({ type: l.type, y0: clamp01(Math.min(l.y0, l.y1)), y1: clamp01(Math.max(l.y0, l.y1)) }))
    .sort((a, c) => a.y0 - c.y0 || a.y1 - c.y1);
  if (box) layers = layers.map((l) => ({ ...l, y0: Math.min(box.y1, Math.max(box.y0, l.y0)), y1: Math.min(box.y1, Math.max(box.y0, l.y1)) }));
  // overlaps: each layer starts where the one above ended
  for (let i = 1; i < layers.length; i++) if (layers[i].y0 < layers[i - 1].y1) layers[i].y0 = layers[i - 1].y1;
  layers = layers.filter((l) => l.y1 - l.y0 >= 0.004).slice(0, JAR_LIMITS.layers);
  // gaps: the line between two layers goes halfway across the gap; the ends meet the box
  for (let i = 1; i < layers.length; i++) {
    if (layers[i].y0 > layers[i - 1].y1) { const m = (layers[i].y0 + layers[i - 1].y1) / 2; layers[i - 1].y1 = m; layers[i].y0 = m; }
  }
  if (layers.length) {
    if (!box) box = { x0: 0.3, x1: 0.7, y0: layers[0].y0, y1: layers[layers.length - 1].y1 };
    else { layers[0].y0 = box.y0; layers[layers.length - 1].y1 = box.y1; }
  }
  const h = (t) => layers.reduce((s, l) => s + (l.type === t ? l.y1 - l.y0 : 0), 0);
  let [sandPct, siltPct, clayPct] = toHundred([h('sand'), h('silt') + h('fines') / 2, h('clay') + h('fines') / 2]);
  if (sandPct == null) {
    const own = [num(raw.sandPct), num(raw.siltPct), num(raw.clayPct)].map((v) => Math.max(0, v ?? 0));
    [sandPct, siltPct, clayPct] = toHundred(own);
  }
  const minerals = new Set(layers.filter((l) => MINERAL.includes(l.type)).map((l) => l.type)).size;
  const usable = raw.usable === true && !!box && minerals > 0;
  if (raw.usable === true && !usable && !problems.length) problems.push({ code: 'other', text: 'I couldn’t find the soil layers in this photo.' });
  return {
    usable,
    problems,
    box,
    layers,
    sandPct, siltPct, clayPct,
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low',
    note: plain(raw.note, JAR_LIMITS.noteChars),
  };
}

/** The JSON text the model gave (the last text block, after any fallback), parsed; null when it isn't JSON. */
export function parseJarMessage(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const text = [...blocks].reverse().find((b) => b?.type === 'text' && typeof b.text === 'string')?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
