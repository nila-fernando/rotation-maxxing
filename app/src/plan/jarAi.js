// The jar test read by Manami (Claude's vision, through the app's own server: server/ai/jar.js).
// This is the first way a photo is read when the server has AI; the algorithm in jarTest.js stays
// for the sample jar, for "Read it without AI", and whenever AI isn't there (no key, offline,
// GitHub Pages).
//
//   jarAiAvailable(endpoint)                     -> true | false   never throws
//   readJarWithAi(endpoint, { image, elapsed, fieldName })   -> { reading } | { error }   never throws
//   readingToAnalysis(reading, img, elapsed)     -> { analysis } | { error: 'box' | 'layers' }
//
// The analysis is the vendored module's own shape (layers in pixels of the working image), so the
// layer list, the edit controls, the texture class, the gates and "Use for" all work as they do.
// Pure apart from fetch (passed in for the tests) and photoForAi (a canvas).
import { cleanBox, middleColour, LAYER_TYPES } from './jarTest.js';

/** The photo sent is at most this many pixels on its long side. */
export const AI_MAX = 1024;
/** The module reads a boundary's score as how clearly two layers differ: Manami's confidence, said that way. */
export const AI_SCORE = { high: 15, medium: 8, low: 3 };
const ELAPSED = ['short', 'mid', 'ok'];

/** What Manami says around her reading (every line passes lintLine in futuresVoice.js). */
export const JAR_AI_LINES = {
  howto: 'I’ll find the layers and work out your sand, silt and clay. It’s a rough guide, not a lab test.',
  consent: 'When you pick a photo, it goes to Anthropic’s Claude so I can read it. It isn’t stored.',
  local: 'Okay, I’ll read it here instead. Your photo stays on this device.',
  reading: 'Reading your jar with Manami…',
  check: 'Check each label, and drag a line if it’s off.',
  notUsable: 'I couldn’t read the layers in this photo.',
  failed: 'I couldn’t reach my jar reader just now.',
  retry: 'Take another photo, or draw a box and I’ll read it without AI.',
  busy: 'That’s a lot of photos at once. Give me a minute, or read it without AI.',
};

/** Does the server read jars? Never throws. */
export async function jarAiAvailable(endpoint, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (!endpoint || typeof fetchImpl !== 'function') return false;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${endpoint}/health`, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ai === true && Array.isArray(body.routes) && body.routes.includes('jar');
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** The photo as a JPEG for the server, at most AI_MAX on its long side: { mediaType, data } (base64). */
export function photoForAi(source, { doc = globalThis.document, quality = 0.85 } = {}) {
  const w0 = source.width, h0 = source.height;
  const k = Math.min(1, AI_MAX / Math.max(w0, h0));
  const c = doc.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k));
  c.height = Math.max(1, Math.round(h0 * k));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', quality);
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

/** Sends the photo. { reading } or { error: code, retryable }. Never throws. */
export async function readJarWithAi(endpoint, { image, elapsed = 'ok', fieldName = null }, { fetchImpl = globalThis.fetch, signal, timeoutMs = 90_000 } = {}) {
  if (!endpoint || typeof fetchImpl !== 'function') return { error: 'unavailable', retryable: false };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  signal?.addEventListener?.('abort', () => ac.abort(), { once: true });
  try {
    const res = await fetchImpl(`${endpoint}/jar`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ v: 1, image, elapsed: ELAPSED.includes(elapsed) ? elapsed : 'ok', ...(fieldName ? { fieldName: String(fieldName).slice(0, 60) } : {}) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok || !body.reading) return { error: body?.error?.code || `http_${res.status}`, retryable: !!body?.error?.retryable };
    return { reading: body.reading };
  } catch {
    return { error: signal?.aborted ? 'aborted' : 'unreachable', retryable: true };
  } finally {
    clearTimeout(t);
  }
}

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Manami's reading (fractions of the image) -> the module's analysis (pixels of img). The box goes
 * through cleanBox; the layers are cut to fit it exactly, each touching the next, each coloured from
 * the photo. { error: 'box' } when the box is missing or too small, 'layers' when no layer is left.
 */
export function readingToAnalysis(reading, img, elapsed = 'ok') {
  const W = img?.width, H = img?.height;
  const rb = reading?.box;
  if (!fin(W) || !fin(H) || !rb || ![rb.x0, rb.x1, rb.y0, rb.y1].every(fin)) return { error: 'box' };
  const box = cleanBox({ x0: rb.x0 * W, x1: rb.x1 * W, y0: rb.y0 * H, y1: rb.y1 * H }, W, H);
  if (!box) return { error: 'box' };
  const src = (Array.isArray(reading.layers) ? reading.layers : []).filter((l) => l && LAYER_TYPES[l.type] && fin(l.y0) && fin(l.y1));
  // the lines between layers, in pixels, kept inside the box and in order
  const cuts = [box.y0];
  for (let i = 1; i < src.length; i++) cuts.push(Math.min(box.y1, Math.max(cuts[i - 1], Math.round(src[i].y0 * H))));
  cuts.push(box.y1);
  const layers = [];
  src.forEach((l, i) => {
    const y0 = cuts[i], y1 = cuts[i + 1];
    if (y1 - y0 < 1) return;
    if (layers.length && layers[layers.length - 1].type === l.type) { layers[layers.length - 1].y1 = y1; return; }
    layers.push({ type: l.type, why: 'Read by Manami from your photo.', rgb: null, y0, y1 });
  });
  if (!layers.length) return { error: 'layers' };
  layers[0].y0 = box.y0;
  layers[layers.length - 1].y1 = box.y1;
  for (const l of layers) l.rgb = middleColour(img, box, l.y0, l.y1) ?? hexRgb(LAYER_TYPES[l.type].color);
  const score = AI_SCORE[reading.confidence] ?? AI_SCORE.low;
  return {
    analysis: {
      box,
      imageHeight: H,
      elapsed: ELAPSED.includes(elapsed) ? elapsed : 'ok',
      layers,
      boundaryScores: layers.slice(1).map(() => score),
      edited: false,
      ai: true,
    },
  };
}

/** What Manami says after her reading: her note and any problems, plainly. */
export function readingLines(reading, ok) {
  const lines = [];
  if (!ok) lines.push(JAR_AI_LINES.notUsable);
  if (reading?.note) lines.push(String(reading.note));
  for (const p of reading?.problems || []) if (p?.text && !lines.includes(p.text)) lines.push(String(p.text));
  lines.push(ok ? JAR_AI_LINES.check : JAR_AI_LINES.retry);
  return lines;
}

/** The line for a request that failed. */
export const failLine = (code) => (code === 'rate_limited' || code === 'upstream_rate_limited' ? JAR_AI_LINES.busy : `${JAR_AI_LINES.failed} ${JAR_AI_LINES.retry}`);
