// The walkthrough's pure parts: the steps, remembering it was seen, the keys, and where the card goes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  STEPS, TOUR_KEY, END_LINES, activeSteps, countLabel, keyAction, needsChange, placeCard, shouldAutoStart, tourMemory, unionRect,
} from './walkthrough.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** A Storage stand-in; `broken` throws on every call, like a blocked one. */
function fakeStorage({ broken = false } = {}) {
  const m = new Map();
  const guard = () => { if (broken) throw new Error('SecurityError'); };
  return {
    getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { guard(); m.set(k, String(v)); },
    removeItem: (k) => { guard(); m.delete(k); },
    map: m,
  };
}

describe('the steps', () => {
  it('walk the hub in order: fields, the check-up and its data, the jar, time, the plans', () => {
    assert.deepEqual(STEPS.map((s) => s.id), [
      'welcome', 'fields', 'checkup', 'history', 'soil', 'slope', 'rain', 'greenness', 'jar', 'time', 'plan', 'farm', 'done',
    ]);
  });

  it('each have an id, a title and a few lines', () => {
    assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length);
    for (const s of STEPS) {
      assert.ok(s.title && s.title.length < 40, s.id);
      assert.ok(s.body && s.body.length > 40 && s.body.length < 320, `${s.id} body length ${s.body.length}`);
      if (s.target) assert.ok(Array.isArray(s.target) && s.target.length, s.id);
      if (s.try) assert.ok(s.try.text && s.try.wait, s.id);
    }
  });

  it('start and end without a target, in the middle or on the help button', () => {
    assert.equal(STEPS[0].target, undefined);
    assert.equal(STEPS[0].next, 'Show me');
    assert.equal(STEPS.at(-1).next, 'Finish');
    assert.deepEqual(STEPS.at(-1).target, ['#hubHelp']);
  });

  it('name the source of every piece of field data', () => {
    const src = Object.fromEntries(STEPS.filter((s) => s.sources).map((s) => [s.id, s.sources]));
    assert.deepEqual(src, { history: ['CSB', 'CDL'], soil: ['SSURGO'], slope: ['DEM'], rain: ['POWER'], greenness: ['HLS'] });
  });

  it('only name sources the field report knows', () => {
    const report = read('../data/fieldReport.js');
    for (const k of STEPS.flatMap((s) => s.sources || [])) assert.match(report, new RegExp(`\\b${k}: \\{ label:`), k);
  });

  it('target things the app really has (the page, the check-up, the plans)', () => {
    const app = [read('../../index.html'), read('../screens/fieldPanel.js'), read('../screens/plansPanel.js')].join('\n');
    for (const s of STEPS) {
      for (const sel of s.target || []) {
        for (const id of sel.match(/#[\w-]+/g) || []) assert.ok(app.includes(`id="${id.slice(1)}"`), `${s.id}: ${id}`);
        for (const [, v] of sel.matchAll(/aria-labelledby="(\w+)"/g)) assert.ok(app.includes(`section('${v}'`), `${s.id}: ${v}`);
        for (const [, v] of sel.matchAll(/data-act="(\w+)"/g)) assert.ok(app.includes(`data-act="${v}"`), `${s.id}: ${v}`);
      }
    }
  });

  it('end each targeted step on the panel itself, for when its part isn’t on screen', () => {
    for (const s of STEPS.filter((x) => x.needs === 'checkup')) assert.equal(s.target.at(-1), '#checkup', s.id);
    assert.equal(STEPS.find((s) => s.id === 'farm').target.at(-1), '#plans');
  });

  it('open the check-up for its steps, and the plans for “See them on the farm”', () => {
    assert.deepEqual(STEPS.filter((s) => s.needs === 'checkup').map((s) => s.id), ['checkup', 'history', 'soil', 'slope', 'rain', 'greenness']);
    assert.deepEqual(STEPS.filter((s) => s.needs === 'plans').map((s) => s.id), ['farm']);
  });

  it('use only waits the tour knows', () => {
    const src = read('./walkthrough.js');
    for (const s of STEPS.filter((x) => x.try)) assert.match(src, new RegExp(`\\b${s.try.wait}: on`), s.id);
  });
});

describe('activeSteps', () => {
  it('drops an optional step whose target isn’t on screen, and keeps the rest', () => {
    const ids = activeSteps(STEPS, (s) => s.id !== 'time').map((s) => s.id);
    assert.ok(!ids.includes('time'));
    assert.equal(ids.length, STEPS.length - 1);
    assert.equal(activeSteps(STEPS, () => true).length, STEPS.length);
  });

  it('never drops a required step, even with nothing on screen', () => {
    const ids = activeSteps(STEPS, () => false).map((s) => s.id);
    assert.deepEqual(ids, STEPS.filter((s) => !s.optional).map((s) => s.id));
    assert.ok(ids.includes('checkup') && ids.includes('done'));
  });
});

describe('countLabel', () => {
  it('counts from one', () => {
    assert.equal(countLabel(0, 13), '1 of 13');
    assert.equal(countLabel(12, 13), '13 of 13');
  });
});

describe('needsChange', () => {
  const s = (needs) => ({ needs });
  it('opens what the next step needs and closes what only the last one did', () => {
    assert.deepEqual(needsChange(s(), s('checkup')), { release: null, ensure: 'checkup' });
    assert.deepEqual(needsChange(s('checkup'), s('checkup')), { release: null, ensure: 'checkup' });
    assert.deepEqual(needsChange(s('checkup'), s()), { release: 'checkup', ensure: null });
    assert.deepEqual(needsChange(s('checkup'), s('plans')), { release: 'checkup', ensure: 'plans' });
    assert.deepEqual(needsChange(undefined, s()), { release: null, ensure: null });
  });
});

describe('keyAction', () => {
  it('Esc skips, the arrows step', () => {
    assert.equal(keyAction('Escape'), 'end');
    assert.equal(keyAction('ArrowRight'), 'next');
    assert.equal(keyAction('ArrowLeft'), 'back');
    assert.equal(keyAction('Enter'), null);
    assert.equal(keyAction('ArrowUp'), null);
  });

  it('leaves the arrows to a text box or a control that uses them', () => {
    assert.equal(keyAction('ArrowRight', { typing: true }), null);
    assert.equal(keyAction('ArrowLeft', { ownsArrows: true }), null);
    assert.equal(keyAction('Escape', { typing: true }), 'end');
  });

  it('lets an open dialog have Esc first', () => {
    assert.equal(keyAction('Escape', { dialog: true }), null);
    assert.equal(keyAction('ArrowRight', { dialog: true }), 'next');
  });
});

describe('tourMemory', () => {
  it('remembers the tour was seen, under one key', () => {
    const st = fakeStorage();
    const m = tourMemory(() => st);
    assert.equal(m.seen(), false);
    assert.equal(m.remember(), true);
    assert.equal(m.seen(), true);
    assert.equal(st.map.get(TOUR_KEY), 'done');
    m.forget();
    assert.equal(m.seen(), false);
  });

  it('copes with storage that throws or isn’t there', () => {
    for (const get of [() => fakeStorage({ broken: true }), () => null, () => { throw new Error('no storage'); }]) {
      const m = tourMemory(get);
      assert.equal(m.seen(), false);
      assert.equal(m.remember(), false);
      assert.doesNotThrow(() => m.forget());
    }
  });

  it('ignores anything else stored under the key', () => {
    const st = fakeStorage();
    st.setItem(TOUR_KEY, 'maybe');
    assert.equal(tourMemory(() => st).seen(), false);
  });
});

describe('shouldAutoStart', () => {
  it('starts the first time only', () => {
    assert.equal(shouldAutoStart({ seen: false }), true);
    assert.equal(shouldAutoStart({ seen: true }), false);
  });
  it('?tour=1 always, ?tour=0 never, and not over the ?futures dev shortcut', () => {
    assert.equal(shouldAutoStart({ seen: true, search: '?hub=5&tour=1' }), true);
    assert.equal(shouldAutoStart({ seen: false, search: '?hub=5&tour=0' }), false);
    assert.equal(shouldAutoStart({ seen: false, search: '?hub=5&futures=1' }), false);
    assert.equal(shouldAutoStart({ seen: false, search: '?hub=5' }), true);
  });
});

describe('unionRect', () => {
  const vp = { width: 400, height: 800 };
  it('joins rects and keeps them on screen', () => {
    assert.deepEqual(unionRect([{ left: 10, top: 10, right: 50, bottom: 40 }, { left: 30, top: 60, right: 90, bottom: 100 }], vp), { left: 10, top: 10, right: 90, bottom: 100 });
    assert.deepEqual(unionRect([{ left: -20, top: 700, right: 420, bottom: 900 }], vp), { left: 0, top: 700, right: 400, bottom: 800 });
  });
  it('clips each rect to its scrolling panel', () => {
    const clip = { left: 0, top: 300, right: 400, bottom: 800 };
    assert.deepEqual(unionRect([{ left: 20, top: 250, right: 380, bottom: 500, clip }], vp), { left: 20, top: 300, right: 380, bottom: 500 });
    assert.equal(unionRect([{ left: 20, top: 100, right: 380, bottom: 200, clip }], vp), null); // scrolled out of its panel
  });
  it('is null for nothing, or slivers', () => {
    assert.equal(unionRect([], vp), null);
    assert.equal(unionRect([null, { left: 5, top: 5, right: 5, bottom: 50 }], vp), null);
    assert.equal(unionRect([{ left: 5, top: 5, right: 8, bottom: 50 }], vp), null);
  });
});

describe('placeCard', () => {
  const card = { width: 340, height: 260 };
  const desk = { width: 1440, height: 900 };
  const phone = { width: 390, height: 844 };
  const inside = (p, vp, c = card) => p.x >= 12 && p.y >= 12 && p.x + c.width <= vp.width - 12 && p.y + c.height <= vp.height - 12;

  it('centres the card when there is no target', () => {
    const p = placeCard({ target: null, card, vp: desk });
    assert.equal(p.spot, null);
    assert.equal(p.side, 'center');
    assert.deepEqual([p.x, p.y], [550, 320]);
  });

  it('takes the side it asks for when there is room', () => {
    const p = placeCard({ target: { left: 24, top: 72, right: 324, bottom: 878 }, card, vp: desk, side: 'right' });
    assert.equal(p.side, 'right');
    assert.equal(p.x, 324 + 6 + 14);
    assert.ok(inside(p, desk));
    assert.deepEqual(p.spot, { left: 18, top: 66, width: 312, height: 818 });
  });

  it('moves to a side with room when the asked one has none (a bottom sheet on a phone)', () => {
    const p = placeCard({ target: { left: 0, top: 544, right: 390, bottom: 844 }, card: { width: 358, height: 260 }, vp: phone, side: 'right' });
    assert.equal(p.side, 'top');
    assert.ok(p.y + 260 <= 544 - 6);
    assert.ok(inside(p, phone, { width: 358, height: 260 }));
  });

  it('stays on screen even when no side has room', () => {
    const big = { width: 358, height: 600 };
    const p = placeCard({ target: { left: 0, top: 300, right: 390, bottom: 700 }, card: big, vp: phone, side: 'left' });
    assert.ok(p.x >= 12 && p.y >= 12 && p.x + big.width <= phone.width - 12 + 0.5 && p.y + big.height <= phone.height - 12 + 0.5);
  });

  it('never leaves the card wider than the screen at phone width (no sideways scroll)', () => {
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const p = placeCard({ target: { left: 330, top: 12, right: 374, bottom: 52 }, card: { width: 366, height: 300 }, vp: phone, side });
      assert.ok(p.x >= 12 && p.x + 366 <= phone.width - 12, side);
    }
  });
});

describe('END_LINES', () => {
  it('say how to see the tour again when it’s skipped', () => {
    assert.match(END_LINES.skipped, /\?/);
    assert.ok(END_LINES.finished.length > 10);
  });
});
