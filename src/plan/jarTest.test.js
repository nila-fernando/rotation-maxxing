import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyseJar, computeResult } from '../vendor/rotation-maxxing/jar-test/jar_test.ts';
import {
  MINERAL, MIN_BOX, SAMPLE_BOX, JAR_LINES, JAR_WARN, REASON_LINE, defaultBox, cleanBox, nudgeBox, boxLabel, edgeLabel,
  analysePhoto, safeMove, withElapsed, markByHand, verdict, layerRows, layersLabel, toRecord, warnLines, reasonLine,
  splitLayer, setLayerType,
} from './jarTest.js';
import { paintJar, paintSampleJar, SAMPLE_BANDS } from './jarSample.js';
import { usableJar } from './farmInput.js';
import { lintLine } from './futuresVoice.js';

const W = 480, H = 640;
const sample = (seed = 1, elapsed = 'ok') => {
  const { img, box } = paintSampleJar({ seed });
  return { img, box, analysis: analysePhoto(img, box, elapsed).analysis };
};
// the sample's contents by band height: clay 73 rows, silt 95, sand 100 (organic and gravel aside)
const SMOOTH = [[62, 200, '#cfe6ee', 3], [200, 330, '#8a6b52', 6], [330, 450, '#a58762', 9], [450, 578, '#d2bb88', 16]];
const white = () => ({ data: new Uint8ClampedArray(W * H * 4).fill(255), width: W, height: H });
// a hand-built analysis (the module's JarAnalysis shape)
const built = (types, { edited = true, elapsed = 'ok' } = {}) => {
  const step = (SAMPLE_BOX.y1 - SAMPLE_BOX.y0) / types.length;
  return {
    box: { ...SAMPLE_BOX }, imageHeight: H, elapsed, edited,
    layers: types.map((type, i) => ({ type, why: 'Set by you.', rgb: [120, 100, 80], y0: SAMPLE_BOX.y0 + i * step, y1: SAMPLE_BOX.y0 + (i + 1) * step })),
    boundaryScores: types.slice(1).map(() => 20),
  };
};

describe('the sample jar', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: clay loam, high confidence, and it can be used on the demo farm`, () => {
      const { analysis } = sample(seed);
      const v = verdict(analysis, { isDemoFarm: true, sample: true });
      assert.equal(v.result.textureClass, 'Clay loam');
      assert.ok(Math.abs(v.result.sandPct - 38) <= 4, `sand ${v.result.sandPct}`);
      assert.ok(Math.abs(v.result.siltPct - 35) <= 4, `silt ${v.result.siltPct}`);
      assert.ok(Math.abs(v.result.clayPct - 27) <= 4, `clay ${v.result.clayPct}`);
      assert.equal(v.result.confidence.key, 'high');
      assert.equal(v.canUse, true);
      assert.equal(v.reason, null);
      assert.equal(v.mineralTypes, 3);
      assert.equal(v.result.warnings.length, 1);
      assert.deepEqual(warnLines(v.result.warnings), [JAR_WARN.find((w) => w.re.test('looks cloudy')).line]);
    });
  }
  it('paints the same jar for the same seed, a different one for another', () => {
    const a = paintSampleJar({ seed: 1 }).img.data, b = paintSampleJar({ seed: 1 }).img.data, c = paintSampleJar({ seed: 2 }).img.data;
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.equal(a.length, W * H * 4);
    assert.deepEqual(paintSampleJar().box, SAMPLE_BOX);
    assert.equal(SAMPLE_BANDS.length, 9);
  });
});

describe('never a confident wrong answer', () => {
  // the expected clay share, from the painted bands under the water
  const expectedClay = (bands) => {
    const soil = bands.slice(-3).map(([a, b]) => b - a);
    return Math.round((soil[0] / soil.reduce((x, y) => x + y, 0)) * 100);
  };
  it('smooth painted bands are blocked: only one soil layer, and a hint that the "water" may be clay', () => {
    const r = analysePhoto(paintJar({ bands: SMOOTH, gravel: false }), SAMPLE_BOX);
    const v = verdict(r.analysis, { isDemoFarm: true });
    assert.equal(v.canUse, false);
    assert.equal(v.reason, 'one');
    assert.equal(v.hint, 'smooth');
    assert.ok(!(v.canUse && Math.abs(v.result.clayPct - expectedClay(SMOOTH)) > 15));
  });
  it('a blank white photo, and an empty jar, are blocked too', () => {
    for (const img of [white(), paintJar({ bands: [], gravel: false })]) {
      const v = verdict(analysePhoto(img, SAMPLE_BOX).analysis, { isDemoFarm: true });
      assert.equal(v.canUse, false);
      assert.equal(v.reason, 'one');
    }
  });
  it('whatever the jar, a usable answer is never far off', () => {
    for (const seed of [1, 2, 3]) {
      const v = verdict(sample(seed).analysis, { isDemoFarm: true });
      assert.ok(!(v.canUse && Math.abs(v.result.clayPct - 27) > 15));
    }
  });
  it('a soil layer squeezed to nothing doesn’t count as a second type', () => {
    const a = built(['water', 'clay', 'sand']);
    a.layers[2].y0 = a.layers[2].y1; // the sand has no height
    const v = verdict(a, { isDemoFarm: true });
    assert.equal(v.mineralTypes, 1);
    assert.equal(v.reason, 'one');
  });
  it('two "silt + clay" layers after a split still count as one soil type', () => {
    const one = analysePhoto(white(), SAMPLE_BOX).analysis;
    const i = one.layers.findIndex((l) => l.type === 'fines');
    const v = verdict(splitLayer(one, i), { isDemoFarm: true });
    assert.equal(v.mineralTypes, 1);
    assert.equal(v.reason, 'one');
  });
});

describe('the settling time', () => {
  it('under 2 hours is too early, whatever the layers say', () => {
    const v = verdict(sample(1, 'short').analysis, { isDemoFarm: true });
    assert.equal(v.result.textureClass, 'Clay loam');
    assert.equal(v.reason, 'early');
    assert.equal(v.canUse, false);
  });
  it('2 to 24 hours is allowed, with the settling warning', () => {
    const v = verdict(sample(1, 'mid').analysis, { isDemoFarm: true });
    assert.equal(v.canUse, true);
    assert.ok(warnLines(v.result.warnings).includes(JAR_WARN[1].line));
  });
  it('withElapsed reads an untouched jar again, and only changes the time on an edited one', () => {
    const { img, analysis } = sample(1);
    const again = withElapsed(analysis, 'short', img);
    assert.equal(again.elapsed, 'short');
    assert.equal(again.edited, false);
    const edited = setLayerType(analysis, 0, 'air');
    const kept = withElapsed(edited, 'mid', img);
    assert.equal(kept.elapsed, 'mid');
    assert.deepEqual(kept.layers, edited.layers);
  });
});

describe('the box', () => {
  it('a box with NaN or Infinity in it never reaches the module', () => {
    const { img } = paintSampleJar();
    let calls = 0;
    const analyse = (...a) => { calls++; return analyseJar(...a); };
    for (const bad of [{ ...SAMPLE_BOX, x0: NaN }, { ...SAMPLE_BOX, y1: Infinity }, { ...SAMPLE_BOX, y0: -Infinity }, null, { x0: 1 }]) {
      assert.deepEqual(analysePhoto(img, bad, 'ok', { analyse }), { error: 'box' });
    }
    assert.equal(calls, 0);
    assert.ok(analysePhoto(img, SAMPLE_BOX, 'ok', { analyse }).analysis);
    assert.equal(calls, 1);
  });
  it('a box smaller than MIN_BOX, or a photo that can’t be read, gives an error key', () => {
    const { img } = paintSampleJar();
    assert.deepEqual(analysePhoto(img, { x0: 200, x1: 200 + MIN_BOX.w - 1, y0: 100, y1: 400 }), { error: 'box' });
    assert.deepEqual(analysePhoto(img, { x0: 200, x1: 300, y0: 100, y1: 100 + MIN_BOX.h - 1 }), { error: 'box' });
    assert.deepEqual(analysePhoto(null, SAMPLE_BOX), { error: 'photo' });
    assert.deepEqual(analysePhoto({ data: new Uint8ClampedArray(4), width: W, height: H }, SAMPLE_BOX), { error: 'photo' });
    assert.deepEqual(analysePhoto(img, SAMPLE_BOX, 'ok', { analyse: () => { throw new Error('boom'); } }), { error: 'photo' });
  });
  it('cleanBox sorts, clamps and rounds', () => {
    assert.deepEqual(cleanBox({ x0: 320.4, x1: 159.6, y0: 700, y1: 62.6 }, W, H), { x0: 160, x1: 320, y0: 63, y1: 640 });
    assert.equal(cleanBox({ x0: 0, x1: 10, y0: 0, y1: 100 }, W, H), null);
    assert.deepEqual(defaultBox(W, H), { x0: 168, x1: 312, y0: 96, y1: 576 });
  });
  it('nudgeBox stays inside the image and keeps MIN_BOX', () => {
    let b = defaultBox(W, H);
    for (let i = 0; i < 200; i++) b = nudgeBox(b, 'top', -10, W, H);
    assert.equal(b.y0, 0);
    for (let i = 0; i < 200; i++) b = nudgeBox(b, 'top', 10, W, H);
    assert.equal(b.y1 - b.y0, MIN_BOX.h);
    for (let i = 0; i < 200; i++) b = nudgeBox(b, 'right', 25, W, H);
    assert.equal(b.x1, W);
    for (let i = 0; i < 200; i++) b = nudgeBox(b, 'left', 25, W, H);
    assert.equal(b.x1 - b.x0, MIN_BOX.w);
    for (let i = 0; i < 200; i++) b = nudgeBox(b, 'bottom', 25, W, H);
    assert.equal(b.y1, H);
    assert.ok(cleanBox(b, W, H));
    assert.deepEqual(nudgeBox(SAMPLE_BOX, 'left', NaN, W, H), SAMPLE_BOX);
    assert.deepEqual(nudgeBox({ x0: NaN }, 'top', 0, W, H), defaultBox(W, H));
  });
  it('safeMove ignores a line position that isn’t a number, or a line that doesn’t exist', () => {
    const { analysis } = sample(1);
    assert.equal(safeMove(analysis, 1, NaN), analysis);
    assert.equal(safeMove(analysis, 99, 300), analysis);
    const moved = safeMove(analysis, 1, analysis.layers[0].y1 + 2);
    assert.notEqual(moved, analysis);
    assert.equal(moved.edited, true);
  });
  it('says the box and its edges in words', () => {
    const b = defaultBox(W, H);
    assert.equal(boxLabel(b, W, H), 'Box from 15% to 90% down, 35% to 65% across');
    assert.equal(edgeLabel({ ...b, y0: Math.round(H * 0.18) }, 'top', W, H), 'Top edge at 18% down');
    assert.equal(edgeLabel(b, 'bottom', W, H), 'Bottom edge at 90% down');
    assert.equal(edgeLabel(b, 'left', W, H), 'Left edge at 35% across');
    assert.equal(edgeLabel(b, 'right', W, H), 'Right edge at 65% across');
  });
});

describe('marking the layers by hand', () => {
  it('gives water, clay, silt and sand, set by the farmer, and passes the gate', () => {
    const { img, box } = paintSampleJar();
    const a = markByHand(box, H, img);
    assert.deepEqual(a.layers.map((l) => l.type), ['water', 'clay', 'silt', 'sand']);
    assert.deepEqual(a.boundaryScores, [0, 0, 0]);
    assert.equal(a.edited, true);
    assert.ok(a.layers.every((l) => l.why === 'Set by you.'));
    assert.equal(a.layers[0].y0, box.y0);
    assert.equal(a.layers[3].y1, box.y1);
    assert.ok(Math.abs(a.layers[1].y0 - (box.y0 + 0.4 * (box.y1 - box.y0))) < 1e-9);
    // the colours come from the photo: the bottom band is the sand's tan
    assert.ok(a.layers[3].rgb[0] > 180 && a.layers[3].rgb[2] < 160, String(a.layers[3].rgb));
    const v = verdict(a, { isDemoFarm: false });
    assert.equal(v.result.confidence.key, 'adjusted');
    assert.equal(v.canUse, true);
    // it also works on a blank photo, the case it is the way through for
    assert.equal(verdict(markByHand(SAMPLE_BOX, H, white()), {}).canUse, true);
    // and with no photo or height at all, the lines are still numbers
    const bare = markByHand({ x0: 10, x1: 90, y0: 20, y1: 300 }, NaN, null);
    assert.ok(bare.layers.every((l) => Number.isFinite(l.y0) && Number.isFinite(l.y1)), JSON.stringify(bare.layers));
    assert.ok(Number.isFinite(bare.imageHeight));
    assert.equal(verdict(bare, {}).canUse, true);
  });
});

describe('the record', () => {
  it('plain, JSON-safe, shares add up to 1, no "ignore", whole-number colours, and the planner takes it', () => {
    const { analysis } = sample(1);
    const withLid = setLayerType(analysis, 0, 'ignore');
    for (const a of [analysis, withLid]) {
      const v = verdict(a, { isDemoFarm: true, sample: true });
      const rec = toRecord(a, v.result, { fieldId: 'f2', sample: true, at: new Date('2026-11-15T20:14:00Z') });
      assert.equal(rec.v, 1);
      assert.equal(rec.fieldId, 'f2');
      assert.equal(rec.at, '2026-11-15T20:14:00.000Z');
      assert.equal(rec.sample, true);
      assert.equal(rec.textureClass, 'Clay loam');
      const sum = rec.layers.reduce((s, l) => s + l.share, 0);
      assert.ok(Math.abs(sum - 1) <= 0.01, String(sum));
      assert.ok(rec.layers.every((l) => l.type !== 'ignore'));
      assert.ok(rec.layers.every((l) => l.rgb.length === 3 && l.rgb.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)));
      assert.deepEqual(JSON.parse(JSON.stringify(rec)), rec);
      assert.equal(usableJar(rec), true);
      assert.ok(rec.warnings.every((w) => JAR_WARN.some((x) => x.line === w)));
    }
    const rec = toRecord(withLid, computeResult(withLid), { fieldId: 'f2' });
    assert.equal(rec.layers.length, analysis.layers.length - 1);
    assert.equal(rec.confidence, 'adjusted');
    assert.equal(rec.adjusted, true);
    assert.ok(!Number.isNaN(Date.parse(rec.at)));
  });
  it('the sample jar is only used on the demo farm', () => {
    const { analysis } = sample(1);
    assert.equal(verdict(analysis, { isDemoFarm: false, sample: true }).reason, 'sample');
    assert.equal(verdict(analysis, { isDemoFarm: true, sample: true }).reason, null);
    assert.equal(verdict(analysis, { isDemoFarm: false, sample: false }).reason, null);
  });
});

describe('the layer list', () => {
  it('one row per layer with its share, and words for a screen reader', () => {
    const { analysis } = sample(1);
    const result = computeResult(analysis);
    const rows = layerRows(analysis, result);
    assert.equal(rows.length, 9);
    assert.deepEqual(rows.map((r) => r.pct), result.layerList.map((l) => l.heightPct));
    assert.deepEqual(rows.map((r) => r.pct), [6, 3, 16, 12, 4, 14, 19, 19, 7]);
    assert.deepEqual(rows.map((r) => r.type), ['air', 'floating', 'water', 'cloudy', 'organic', 'clay', 'silt', 'sand', 'gravel']);
    assert.equal(rows[0].canMerge, false);
    assert.ok(rows.slice(1).every((r) => r.canMerge));
    assert.equal(rows[0].lineAbove, null);
    assert.equal(rows[5].lineAbove, 5);
    assert.equal(rows[5].label, 'Clay');
    assert.equal(rows[5].ariaLabel, 'Layer 6 of 9, 14% of the jar');
    assert.ok(rows.every((r) => r.canSplit));
    assert.equal(layersLabel(analysis), '9 layers: Air gap 6%, Floating organic matter 3%, Clear water 16%, Cloudy water (clay still floating) 12%, Organic matter (settled) 4%, Clay 14%, Silt 19%, Sand 19%, Gravel / stones 7%');
  });
});

describe('Manami on the jar test', () => {
  const DEMO = { name: 'West 140', cls: 'Clay loam' };
  const lines = Object.entries(JAR_LINES).flatMap(([key, l]) => {
    if (typeof l !== 'function') return [[key, l]];
    if (key === 'found') return [[key, l(9)], [key, l(1)]];
    if (key === 'used') return ['gate', 'beside', 'none', null].map((p) => [key, l(DEMO.name, DEMO.cls, p)]);
    if (key === 'same') return [[key, l('Home place')]];
    return [[key, l(DEMO.name)]];
  });
  it('every line passes lintLine', () => {
    for (const [key, line] of [...lines, ...JAR_WARN.map((w, i) => [`warn ${i}`, w.line])]) {
      assert.deepEqual(lintLine(line), [], `${key}: ${line}`);
    }
  });
  it('the demo lines word for word', () => {
    assert.equal(JAR_LINES.found(9), 'I found 9 layers. Check each label, and drag a line if it’s off.');
    assert.equal(JAR_LINES.used('West 140', 'Clay loam', 'gate'), 'Done. By your jar, West 140 is clay loam, and I’ll plan with that. I’ve left the jar by its gate.');
    assert.equal(JAR_LINES.used('West 140', 'Clay loam', 'beside'), 'Done. By your jar, West 140 is clay loam, and I’ll plan with that. I’ve left the jar beside it.');
    assert.equal(JAR_LINES.used('West 140', 'Clay loam', 'none'), 'Done. By your jar, West 140 is clay loam, and I’ll plan with that. There’s no clear grass by it just now, so I’ll set the jar out when there’s room.');
    assert.equal(JAR_LINES.used('West 140', 'Clay loam', null), 'Done. By your jar, West 140 is clay loam, and I’ll plan with that.');
    assert.equal(JAR_LINES.same('Home place'), 'Done. Your jar agrees with the soil map on Home place, so your plans won’t change.');
    assert.equal(JAR_LINES.undone('West 140'), 'Okay, West 140 is back on the soil map.');
  });
  it('every gate reason has a line', () => {
    for (const reason of ['early', 'none', 'one', 'low', 'sample']) assert.equal(reasonLine(reason), JAR_LINES[REASON_LINE[reason]]);
    assert.equal(reasonLine(null), null);
  });
  it('all 7 of the module’s warnings map to one of her lines', () => {
    const seen = new Set();
    const note = (analysis) => {
      for (const w of computeResult(analysis).warnings) {
        const i = JAR_WARN.findIndex((x) => x.re.test(w));
        assert.ok(i >= 0, `no line for: ${w}`);
        seen.add(i);
      }
    };
    note(sample(1, 'short').analysis); // too early, cloudy water
    note(sample(1, 'mid').analysis); // still settling
    note(analysePhoto(white(), SAMPLE_BOX).analysis); // one soil layer, hard to tell apart
    note(built(['water'])); // no sand, silt or clay
    note(built(['water', 'sand', 'clay'])); // an odd order
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5, 6]);
    // one she doesn't know is kept word for word
    assert.deepEqual(warnLines(['Something new.']), ['Something new.']);
  });
  it('MINERAL matches the module’s soil types', () => {
    assert.deepEqual(MINERAL, ['sand', 'silt', 'clay', 'fines']);
  });
});
