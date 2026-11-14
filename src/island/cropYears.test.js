// The crops sprouting back up in a plan view (cropYears.growIn / tick): from small to full size,
// easing out with no overshoot, one field after another, and the season's own setSize leaves a
// sprouting field alone until it's done.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCropYears } from './cropYears.js';

/** A field whose paddock only records the sizes it's set to (nothing is built: no crop changes). */
function stubField(id) {
  const sizes = [];
  const paddock = { visible: true, userData: { setSize: (s) => sizes.push(s) }, traverse() {} };
  return { f: { id, polygons: [], holder: { add() {} }, paddock, seed: 1, gateToward: [0, 0], cropKey: 'corn' }, sizes };
}

function setup(n = 3) {
  const stubs = Array.from({ length: n }, (_, i) => stubField(`f${i + 1}`));
  const crops = createCropYears({ fields: stubs.map((s) => s.f) });
  return { crops, stubs, sizes: (i) => stubs[i].sizes };
}

const run = (crops, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) crops.tick(dt); };

describe('cropYears grow-in', () => {
  it('rises from 0.15 of the size to the size, never past it, and stops', () => {
    for (const size of [1, 0.75]) {
      const { crops, sizes } = setup(1);
      crops.setSize(size);
      sizes(0).length = 0;
      crops.growIn(['f1']);
      run(crops, 1);
      const s = sizes(0);
      assert.ok(s.length >= 5, `set ${s.length} times while growing`);
      assert.ok(Math.abs(s[0] - 0.15 * size) <= 1 / 60, `starts small: ${s[0]}`);
      for (let i = 1; i < s.length; i++) assert.ok(s[i] >= s[i - 1], `never shrinks: ${s[i - 1]} then ${s[i]}`);
      assert.ok(s.every((v) => v <= size + 1e-9), `never past full size (${Math.max(...s)} > ${size})`);
      assert.equal(s[s.length - 1], size, 'ends at full size');
      assert.equal(crops.growing, 0, 'done');
      const after = s.length;
      run(crops, 0.5);
      assert.equal(s.length, after, 'nothing more to do once it has grown');
    }
  });

  it('eases out (most of the growing happens early) and takes about dur', () => {
    const { crops, sizes } = setup(1);
    crops.growIn(['f1'], { dur: 0.45 });
    run(crops, 0.15);
    const third = sizes(0).at(-1);
    assert.ok(third > 0.15 + 0.85 * (1 / 3) + 0.05, `a third of the way in it's past a third grown (${third})`);
    run(crops, 0.25);
    assert.ok(crops.growing === 1, 'still growing just before dur');
    run(crops, 0.1);
    assert.equal(crops.growing, 0, 'done just after dur');
  });

  it('staggers the fields in the order given', () => {
    const { crops, sizes } = setup(3);
    crops.growIn(['f3', 'f1', 'f2'], { stagger: 0.12 });
    run(crops, 0.1);
    const now = (i) => sizes(i).at(-1);
    assert.ok(now(2) > now(0) && now(0) === now(1), `first one is ahead: f3 ${now(2)}, f1 ${now(0)}, f2 ${now(1)}`);
    run(crops, 0.12);
    assert.ok(now(0) > now(1), `f1 before f2: ${now(0)} ${now(1)}`);
    run(crops, 1);
    for (let i = 0; i < 3; i++) assert.equal(now(i), 1);
  });

  it("setSize during a grow doesn't stomp the growing field, and it ends at the new size", () => {
    const { crops, sizes } = setup(2);
    crops.growIn(['f1']);
    run(crops, 0.1);
    const mid = sizes(0).at(-1);
    sizes(0).length = 0;
    sizes(1).length = 0;
    crops.setSize(0.8);
    assert.deepEqual(sizes(0), [], 'the growing field is left alone');
    assert.deepEqual(sizes(1), [0.8], 'the others take the size');
    run(crops, 1);
    const s = sizes(0);
    assert.ok(s.every((v) => v <= 0.8 + 1e-9), 'never past the new size');
    assert.ok(s[0] >= mid * 0.8 - 1e-9 && s.at(-1) === 0.8, `goes on from where it was to the new size (${s[0]} .. ${s.at(-1)})`);
  });

  it('ignores ids it has no field for, and dispose stops it', () => {
    const { crops, sizes } = setup(1);
    crops.growIn(['nope', 'f1']);
    assert.equal(crops.growing, 1);
    assert.ok(Math.abs(sizes(0)[0] - 0.15) <= 1 / 60, 'the first known field goes first (no wait for an unknown one)');
    crops.dispose();
    assert.equal(crops.growing, 0);
    sizes(0).length = 0;
    run(crops, 0.5);
    assert.deepEqual(sizes(0), []);
  });

  it('without growIn, setSize works as before', () => {
    const { crops, sizes } = setup(2);
    crops.setSize(0.5);
    crops.setSize(0.5);
    run(crops, 0.2);
    assert.deepEqual(sizes(0), [0.5]);
    assert.deepEqual(sizes(1), [0.5]);
  });
});
