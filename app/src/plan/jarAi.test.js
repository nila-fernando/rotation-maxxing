import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readingToAnalysis, readingLines, readJarWithAi, jarAiAvailable, failLine, JAR_AI_LINES, AI_SCORE } from './jarAi.js';
import { verdict, toRecord, layerRows, withElapsed, analysePhoto, SAMPLE_BOX } from './jarTest.js';
import { paintSampleJar } from './jarSample.js';
import { lintLine } from './futuresVoice.js';

const img = (w = 400, h = 600) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(128) });
const READING = {
  usable: true, problems: [],
  box: { x0: 0.35, y0: 0.1, x1: 0.65, y1: 0.9 },
  layers: [
    { type: 'air', y0: 0.1, y1: 0.15 }, { type: 'water', y0: 0.15, y1: 0.5 },
    { type: 'clay', y0: 0.5, y1: 0.6 }, { type: 'silt', y0: 0.6, y1: 0.7 }, { type: 'sand', y0: 0.7, y1: 0.9 },
  ],
  sandPct: 50, siltPct: 25, clayPct: 25, confidence: 'high', note: 'Nice clear lines.',
};
const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Manami reads the jar', () => {
  it('turns her reading into the module’s analysis, in pixels', () => {
    const { analysis } = readingToAnalysis(READING, img(), 'ok');
    assert.deepEqual(analysis.box, { x0: 140, x1: 260, y0: 60, y1: 540 });
    assert.deepEqual(analysis.layers.map((l) => [l.type, l.y0, l.y1]), [['air', 60, 90], ['water', 90, 300], ['clay', 300, 360], ['silt', 360, 420], ['sand', 420, 540]]);
    assert.equal(analysis.boundaryScores.length, 4);
    assert.ok(analysis.boundaryScores.every((s) => s === AI_SCORE.high));
    assert.equal(analysis.edited, false);
    assert.equal(analysis.ai, true);
    assert.ok(analysis.layers.every((l) => l.rgb.length === 3));
    // the rest of the jar test works on it unchanged
    const v = verdict(analysis);
    assert.equal(v.canUse, true);
    assert.deepEqual([v.result.sandPct, v.result.siltPct, v.result.clayPct], [50, 25, 25]);
    assert.equal(v.result.confidence.key, 'high');
    assert.ok(v.result.textureClass);
    assert.equal(layerRows(analysis).length, 5);
    const rec = toRecord(analysis, v.result, { fieldId: 'f1', at: new Date(0) });
    assert.equal(rec.textureClass, v.result.textureClass);
    // a new settling time keeps her layers
    const later = withElapsed(analysis, 'mid', img());
    assert.equal(later.elapsed, 'mid');
    assert.equal(later.layers.length, 5);
  });

  it('low confidence goes through the same gate as the algorithm’s', () => {
    const { analysis } = readingToAnalysis({ ...READING, confidence: 'low' }, img());
    assert.equal(verdict(analysis).reason, 'low');
  });

  it('fits odd layers to the box and refuses a reading with no box or layers', () => {
    const { analysis } = readingToAnalysis({ ...READING, layers: [{ type: 'clay', y0: 0.2, y1: 0.4 }, { type: 'clay', y0: 0.4, y1: 0.5 }, { type: 'nope', y0: 0, y1: 1 }, { type: 'sand', y0: 0.5, y1: 0.95 }] }, img());
    assert.deepEqual(analysis.layers.map((l) => [l.type, l.y0, l.y1]), [['clay', 60, 300], ['sand', 300, 540]]);
    assert.deepEqual(readingToAnalysis({ ...READING, box: null }, img()), { error: 'box' });
    assert.deepEqual(readingToAnalysis({ ...READING, box: { x0: 0.5, x1: 0.51, y0: 0.1, y1: 0.9 } }, img()), { error: 'box' });
    assert.deepEqual(readingToAnalysis({ ...READING, layers: [] }, img()), { error: 'layers' });
  });

  it('says her note and the problems plainly', () => {
    assert.deepEqual(readingLines(READING, true), ['Nice clear lines.', JAR_AI_LINES.check]);
    const lines = readingLines({ note: '', problems: [{ code: 'blurry', text: 'The photo is blurry.' }] }, false);
    assert.deepEqual(lines, [JAR_AI_LINES.notUsable, 'The photo is blurry.', JAR_AI_LINES.retry]);
    for (const [k, l] of Object.entries(JAR_AI_LINES)) assert.deepEqual(lintLine(l), [], k);
    assert.deepEqual(lintLine(failLine('unreachable')), []);
  });

  it('asks the server, and falls back plainly when it can’t', async () => {
    let sent = null;
    const ok = await readJarWithAi('/api/ai', { image: { mediaType: 'image/jpeg', data: 'AAAA' }, elapsed: 'mid', fieldName: 'West 140' }, {
      fetchImpl: async (url, o) => { sent = { url, body: JSON.parse(o.body) }; return res(200, { ok: true, reading: READING }); },
    });
    assert.equal(sent.url, '/api/ai/jar');
    assert.deepEqual(sent.body, { v: 1, image: { mediaType: 'image/jpeg', data: 'AAAA' }, elapsed: 'mid', fieldName: 'West 140' });
    assert.equal(ok.reading.note, 'Nice clear lines.');
    assert.deepEqual(await readJarWithAi(null, { image: {} }), { error: 'unavailable', retryable: false });
    assert.equal((await readJarWithAi('/api/ai', { image: {} }, { fetchImpl: async () => { throw new Error('offline'); } })).error, 'unreachable');
    assert.equal((await readJarWithAi('/api/ai', { image: {} }, { fetchImpl: async () => res(429, { ok: false, error: { code: 'rate_limited', retryable: true } }) })).error, 'rate_limited');
    assert.equal(await jarAiAvailable(null), false);
    assert.equal(await jarAiAvailable('/api/ai', { fetchImpl: async () => res(200, { ok: true, ai: true, routes: ['chat', 'jar'] }) }), true);
    assert.equal(await jarAiAvailable('/api/ai', { fetchImpl: async () => res(200, { ok: true, ai: true, routes: ['chat'] }) }), false);
    assert.equal(await jarAiAvailable('/api/ai', { fetchImpl: async () => res(200, { ok: true, ai: false, reason: 'no_key' }) }), false);
    assert.equal(await jarAiAvailable('/api/ai', { fetchImpl: async () => { throw new Error('offline'); } }), false);
  });

  it('the algorithm is still there for the sample jar', () => {
    const { img: s } = paintSampleJar({ seed: 1 });
    assert.ok(analysePhoto(s, SAMPLE_BOX, 'ok').analysis);
  });
});
