// The walkthrough's pure parts: the steps, remembering it was seen, the keys, and where the card goes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  STEPS, TOUR_KEY, END_LINES, TRIED_GO, TRIED_STAY, activeSteps, countLabel, keyAction, needsChange, placeCard, resolveStep, shouldAutoStart,
  stepAvailable, tourMemory, unionRect,
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

const byId = (id) => STEPS.find((s) => s.id === id);
/** Everywhere a step's target can come from: the page, the screens that draw them, Manami's face, main.js. */
const APP = [
  '../../index.html', '../screens/fieldPanel.js', '../screens/plansPanel.js', '../screens/planTake.js', '../ui/manami.js', '../main.js',
].map(read).join('\n');

/** Is every part of this selector something the app really has? Returns the parts it couldn't find. */
function missingParts(sel) {
  const missing = [];
  for (const [, id] of sel.matchAll(/#([\w-]+)/g)) {
    const tab = /^plansTab-(\w+)$/.exec(id);
    const ok = tab ? APP.includes('id="plansTab-${v}"') && APP.includes(`view: '${tab[1]}'`) : APP.includes(`id="${id}"`) || APP.includes(`b.id = '${id}'`);
    if (!ok) missing.push(`#${id}`);
  }
  for (const [, cls] of sel.matchAll(/\.([\w-]+)/g)) {
    const host = /^rot-host--(\w+)$/.exec(cls);
    const ok = host ? APP.includes('rot-host--${part}') && new RegExp(`\\b${host[1]}: \\(\\) =>`).test(APP) : new RegExp(`class="[^"]*\\b${cls}\\b`).test(APP);
    if (!ok) missing.push(`.${cls}`);
  }
  for (const [, name, v] of sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (name === 'aria-labelledby') { if (!APP.includes(`section('${v}'`) && !APP.includes(`aria-labelledby="${v}"`)) missing.push(v); continue; }
    if (name === 'role') continue;
    if (!APP.includes(v == null ? name : `${name}="${v}"`)) missing.push(`[${name}${v == null ? '' : `=${v}`}]`);
  }
  return missing;
}

describe('the steps', () => {
  it('walk the whole farm in order: the hub, a check-up, the jar, time, Ask Manami, the plans, the plan view, your farms', () => {
    assert.deepEqual(STEPS.map((s) => s.id), [
      'welcome', 'fields', 'checkup', 'history', 'read', 'land', 'season', 'jar', 'time', 'ask',
      'plan', 'rotation', 'take', 'calendar', 'farm',
      'futPlans', 'futCard', 'futNotes', 'futSave',
      'account', 'done',
    ]);
  });

  it('each have an id, a title and a few lines', () => {
    assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length);
    for (const s of STEPS) {
      assert.ok(s.title && s.title.length < 40, s.id);
      for (const text of [s.body, s.busyBody, ...(s.variants || []).map((v) => v.body)].filter(Boolean)) {
        assert.ok(text.length > 40 && text.length < 320, `${s.id} body length ${text.length}`);
      }
      if (s.target) assert.ok(Array.isArray(s.target) && s.target.length, s.id);
      if (s.try) assert.ok(s.try.text && s.try.wait, s.id);
    }
  });

  it('start in the middle and end on the help button', () => {
    assert.equal(STEPS[0].target, undefined);
    assert.equal(STEPS[0].next, 'Show me');
    assert.doesNotMatch(STEPS[0].body, /about a minute/);
    assert.equal(STEPS.at(-1).next, 'Finish');
    assert.deepEqual(STEPS.at(-1).target, ['#hubHelp']);
  });

  it('name the source of every piece of field data', () => {
    const src = Object.fromEntries(STEPS.filter((s) => s.sources).map((s) => [s.id, s.sources]));
    assert.deepEqual(src, { history: ['CSB', 'CDL'], land: ['SSURGO', 'DEM'], season: ['POWER', 'HLS'] });
  });

  it('only name sources the field report knows', () => {
    const report = read('../data/fieldReport.js');
    for (const k of STEPS.flatMap((s) => s.sources || [])) assert.match(report, new RegExp(`\\b${k}: \\{ label:`), k);
  });

  it('target things the app really has (the page, the check-up, the plans, the plan view, Manami)', () => {
    for (const s of STEPS) {
      for (const v of [s, ...(s.variants || [])]) {
        for (const sel of v.target || []) assert.deepEqual(missingParts(sel), [], `${s.id}: ${sel}`);
      }
    }
  });

  it('the target check itself catches a selector the app doesn’t have', () => {
    assert.deepEqual(missingParts('#nopeNope'), ['#nopeNope']);
    assert.deepEqual(missingParts('#plans .plans__nothing'), ['.plans__nothing']);
    assert.deepEqual(missingParts('#plansTab-nowhere'), ['#plansTab-nowhere']);
    assert.deepEqual(missingParts('#plans .rot-host--nope'), ['.rot-host--nope']);
    assert.deepEqual(missingParts('#checkup [data-nothing]'), ['[data-nothing]']);
  });

  it('point at Edit crop history, Manami’s read, Ask me, her take, When to sow, the plan view and your farms', () => {
    assert.match(byId('history').body, /Edit crop history/);
    assert.ok(APP.includes('data-hist="edit"'));
    assert.ok(byId('read').target.some((t) => t.includes('[data-read')));
    assert.ok(byId('ask').target[0].includes('#askOpen'));
    assert.ok(byId('take').target[0].includes('.plans__take'));
    assert.ok(byId('calendar').target[0].includes('.plans__cal'));
    assert.equal(byId('calendar').tab, 'calendar');
    assert.ok(byId('futPlans').target[0].includes('#futDock'));
    assert.equal(byId('futCard').target[0], '#futFields');
    assert.equal(byId('futNotes').target[0], '#futNotesBtn');
    assert.equal(byId('futSave').target[0], '#futSave');
    assert.equal(byId('account').target[0], '#acctBtn');
  });

  it('end each step on a panel with its panel itself, for when its part isn’t on screen (or not there yet)', () => {
    const last = { checkup: '#checkup', plans: '#plans', futures: '#futDock' };
    for (const s of STEPS.filter((x) => x.needs)) assert.equal(s.target.at(-1), last[s.needs], s.id);
  });

  it('open the check-up, the plans and the plan view for their steps', () => {
    const need = (n) => STEPS.filter((s) => s.needs === n).map((s) => s.id);
    assert.deepEqual(need('checkup'), ['checkup', 'history', 'read', 'land', 'season']);
    assert.deepEqual(need('plans'), ['rotation', 'take', 'calendar', 'farm']);
    assert.deepEqual(need('futures'), ['futPlans', 'futCard', 'futNotes', 'futSave']);
  });

  it('show the plans’ rotation tab for its steps, and When to sow for its own', () => {
    assert.deepEqual(STEPS.filter((s) => s.tab).map((s) => [s.id, s.tab]), [['rotation', 'rotation'], ['take', 'rotation'], ['calendar', 'calendar'], ['farm', 'rotation']]);
  });

  it('only leave out AI steps (and the year bar) when they aren’t there: everything later is required', () => {
    assert.deepEqual(STEPS.filter((s) => s.optional).map((s) => s.id), ['read', 'time', 'ask', 'take']);
    assert.deepEqual(STEPS.filter((s) => s.ai).map((s) => [s.id, s.ai]), [['read', 'field'], ['ask', 'chat'], ['take', 'plan']]);
    for (const s of STEPS.filter((x) => x.ai)) assert.ok(s.optional, s.id);
  });

  it('say “when it shows up” only while the plans are still being worked out', () => {
    const farm = byId('farm');
    assert.doesNotMatch(farm.try.text, /when it shows up/);
    assert.match(farm.try.busyText, /when it shows up/);
    for (const s of STEPS.filter((x) => x.needs === 'plans')) assert.ok(s.busyBody, s.id);
  });

  it('use the plans’ real words for their button', () => {
    assert.ok(read('../screens/plansPanel.js').includes('See it on the farm'));
    assert.match(byId('farm').try.text, /“See it on the farm”/);
  });

  it('show Manami and her Ask me on their step, and hide her the rest of the tour', () => {
    assert.equal(byId('ask').bodyClass, 'tour-manami');
    assert.deepEqual(STEPS.filter((s) => s.bodyClass).map((s) => s.id), ['ask']);
    const css = read('../styles.css');
    assert.match(css, /body\.is-touring \.manami \{ opacity: 0;/);
    assert.match(css, /body\.is-touring\.tour-manami \.manami \{ opacity: 1; pointer-events: auto;/);
    // (her check-up and the plans make her inert: the step puts them away)
    assert.deepEqual(byId('ask').clear, ['checkup', 'plans', 'futures']);
  });

  it('end by the plans’ close button when the farmer’s plans are still open (the field list waits under them)', () => {
    const done = STEPS.at(-1);
    const v = resolveStep(done, (c) => c === 'plans-open');
    assert.deepEqual(v.target, ['#plansClose']);
    assert.match(v.body, /Close the plans/);
    assert.equal(v.next, 'Finish');
    assert.equal(v.when, undefined);
    assert.equal(resolveStep(done, () => false), done);
    assert.ok(read('../../index.html').includes('id="plansClose"'));
  });

  it('end on the hub: your farms and the last step put the plan view away', () => {
    assert.deepEqual(byId('account').clear, ['futures']);
    assert.deepEqual(byId('done').clear, ['futures']);
  });

  it('light a field’s card once the farmer opens it, and put it away after', () => {
    const v = resolveStep(byId('futCard'), (c) => c === 'fut-card-open');
    assert.equal(v.target[0], '#futCard');
    for (const id of ['futNotes', 'futSave']) assert.deepEqual(byId(id).clear, ['futCard'], id);
  });

  it('wait by the dialogs while they’re open: the jar test, Ask Manami, Why and watch out, your farms', () => {
    assert.equal(byId('jar').try.wait, 'jarVisited');
    assert.equal(byId('ask').try.wait, 'askVisited');
    assert.equal(byId('futNotes').try.wait, 'notesVisited');
    assert.equal(byId('account').try.wait, 'accountVisited');
    const src = read('./walkthrough.js');
    for (const [w, cls] of [['jarVisited', 'jar-open'], ['askVisited', 'ask-open'], ['notesVisited', 'fut-notes-open'], ['accountVisited', 'acct-open']]) {
      assert.match(src, new RegExp(`${w}: onRoundTrip\\('${cls}'\\)`), w);
      assert.match(src, new RegExp(`'${cls}'`), `${cls} steps the tour aside`);
    }
  });

  it('move on when the plan view opens, however the farmer opened it', () => {
    assert.equal(byId('farm').try.wait, 'futuresOpened');
    assert.match(read('./walkthrough.js'), /futuresOpened: onBodyClass\('plan-futures'\)/);
  });

  it('stay put after a Try it whose answer takes a moment (her read, her take, a field’s card)', () => {
    assert.deepEqual(STEPS.filter((s) => s.try?.stay).map((s) => s.id), ['read', 'take', 'futCard']);
    assert.match(TRIED_STAY, /Next/);
    assert.match(TRIED_GO, /On we go/);
  });

  it('use only waits the tour knows', () => {
    const src = read('./walkthrough.js');
    for (const s of STEPS.filter((x) => x.try)) assert.match(src, new RegExp(`\\b${s.try.wait}: on`), s.id);
  });

  it('find Manami’s face under the site’s base path (GitHub Pages)', () => {
    const src = read('./walkthrough.js');
    assert.match(src, /src="\$\{asset\('\/manami\.svg'\)\}"/);
    assert.doesNotMatch(src, /src="\/manami\.svg"/);
  });

  it('count as seen only once finished or skipped, not when the hub goes away under them', () => {
    assert.match(read('./walkthrough.js'), /if \(!quiet\) memory\.remember\(\)/);
  });
});

describe('main.js wiring', () => {
  const main = read('../main.js');
  it('opens and closes the plan view for the tour, without Manami’s own reel', () => {
    assert.match(main, /openFutures: \(\) => \{[\s\S]*?openFutures\('priority', \{ reel: false \}\)/);
    assert.match(main, /closeFutures: \(\) => planFutures\?\.stop\(\)/);
    assert.match(main, /need === 'futures' \? !!planFutures\?\.active/);
  });
  it('keeps Manami’s reel out of the plan view while the tour is open', () => {
    assert.match(main, /onFutures: \(kind, opts\) => openFutures\(kind, tour\.isOpen \? \{ \.\.\.opts, reel: false \} : opts\)/);
  });
  it('tells the tour which AI routes answer, and lets it switch the plans’ tab', () => {
    assert.match(main, /hasAi: \(route\) => aiRoutes\.has\(route\)/);
    assert.match(main, /showPlansTab: \(tab\) => plansPanel\.showView\(tab\)/);
  });
});

describe('activeSteps', () => {
  const avail = (hasAi, onScreen = () => true) => (s) => stepAvailable(s, { hasAi, onScreen });

  it('drops the AI steps when AI is off (GitHub Pages, no key), whatever is on screen', () => {
    const ids = activeSteps(STEPS, avail(() => false)).map((s) => s.id);
    for (const id of ['read', 'ask', 'take']) assert.ok(!ids.includes(id), id);
    assert.equal(ids.length, STEPS.length - 3);
    assert.ok(ids.includes('time') && ids.includes('futSave'));
  });

  it('keeps each AI step whose route the server answers, though its panel isn’t open yet', () => {
    const ids = activeSteps(STEPS, avail((r) => r === 'plan', () => false)).map((s) => s.id);
    assert.ok(ids.includes('take'));
    assert.ok(!ids.includes('read') && !ids.includes('ask') && !ids.includes('time'));
    assert.equal(activeSteps(STEPS, avail(() => true)).length, STEPS.length);
  });

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
  const s = (needs, clear) => ({ needs, clear });
  it('opens what the next step needs and closes what only the last one did', () => {
    assert.deepEqual(needsChange(s(), s('checkup')), { release: null, ensure: 'checkup', clear: null });
    assert.deepEqual(needsChange(s('checkup'), s('checkup')), { release: null, ensure: 'checkup', clear: null });
    assert.deepEqual(needsChange(s('checkup'), s()), { release: 'checkup', ensure: null, clear: null });
    assert.deepEqual(needsChange(s('checkup'), s('plans')), { release: 'checkup', ensure: 'plans', clear: null });
    assert.deepEqual(needsChange(undefined, s()), { release: null, ensure: null, clear: null });
  });

  it('goes from the plans to the plan view and back', () => {
    assert.deepEqual(needsChange(s('plans'), s('futures')), { release: 'plans', ensure: 'futures', clear: null });
    assert.deepEqual(needsChange(s('futures'), s('futures', ['futCard'])), { release: null, ensure: 'futures', clear: ['futCard'] });
    assert.deepEqual(needsChange(s('futures'), s('plans')), { release: 'futures', ensure: 'plans', clear: null });
    assert.deepEqual(needsChange(s('futures'), s(undefined, ['futures'])), { release: 'futures', ensure: null, clear: ['futures'] });
  });

  it('shuts what the next step needs out of the way (one panel or several)', () => {
    assert.deepEqual(needsChange(s('plans'), s('checkup', 'plans')), { release: 'plans', ensure: 'checkup', clear: ['plans'] });
    assert.deepEqual(needsChange(s(), s(undefined, ['checkup', 'plans', 'futures'])), { release: null, ensure: null, clear: ['checkup', 'plans', 'futures'] });
    // never shut what the step itself needs
    assert.deepEqual(needsChange(s(), s('plans', ['plans', 'futures'])), { release: null, ensure: 'plans', clear: ['futures'] });
  });

  it('never shows a check-up or the field list under the plans or the plan view', () => {
    // the app keeps the field list inert while either is open, and opening them closes a check-up
    for (const step of STEPS) {
      const onList = step.needs === 'checkup' || (step.target || []).some((t) => /#hub(Panel|Jar|List)/.test(t));
      if (onList) for (const c of ['plans', 'futures']) assert.ok([step.clear].flat().includes(c), `${step.id} clears ${c}`);
    }
    for (const step of STEPS.filter((x) => x.clear)) assert.ok(![step.clear].flat().includes(step.needs), step.id);
  });

  it('walks the whole tour with one panel open at a time', () => {
    // as go() does it, with every panel's state kept here
    const open = new Set();
    for (let i = 0; i < STEPS.length; i++) {
      const { release, ensure, clear } = needsChange(STEPS[i - 1], STEPS[i]);
      if (release) open.delete(release);
      for (const c of clear || []) open.delete(c);
      if (ensure === 'futures') open.delete('plans'); // (the plan view closes the plans as it opens)
      if (ensure === 'plans') { open.delete('checkup'); open.delete('futures'); } // (and the plans close those)
      if (ensure) open.add(ensure);
      const workspaces = [...open].filter((p) => p !== 'futCard');
      assert.ok(workspaces.length <= 1, `${STEPS[i].id}: ${workspaces}`);
      if (STEPS[i].needs) assert.ok(open.has(STEPS[i].needs), STEPS[i].id);
    }
    assert.deepEqual([...open], []); // ends on the hub
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
    assert.equal(keyAction('Escape', { ownsArrows: true }), 'end');
  });

  it('leaves Esc to a text box, where it puts the old text back', () => {
    assert.equal(keyAction('Escape', { typing: true }), null);
  });

  it('leaves every key to an open dialog or popover', () => {
    assert.equal(keyAction('Escape', { dialog: true }), null);
    assert.equal(keyAction('ArrowRight', { dialog: true }), null);
    assert.equal(keyAction('ArrowLeft', { dialog: true }), null);
  });

  it('steps with the arrows only from the tour’s card, but skips with Esc from anywhere', () => {
    assert.equal(keyAction('ArrowRight', { inTour: false }), null);
    assert.equal(keyAction('ArrowLeft', { inTour: false }), null);
    assert.equal(keyAction('Escape', { inTour: false }), 'end');
    assert.equal(keyAction('ArrowRight', { inTour: true }), 'next');
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

  it('cuts the card down above or below rather than cover the spotlight, when no side has room', () => {
    const p = placeCard({ target: { left: 140, top: 436, right: 347, bottom: 474 }, card: { width: 340, height: 460 }, vp: phone, side: 'bottom' });
    assert.equal(p.side, 'top');
    assert.ok(p.maxHeight >= 190 && p.maxHeight < 460);
    assert.ok(p.y >= 12 && p.y + p.maxHeight <= p.spot.top, JSON.stringify(p));
  });

  it('centres a card that nearly fills a phone’s width instead of pushing it to one edge', () => {
    const p = placeCard({ target: { left: 300, top: 100, right: 370, bottom: 140 }, card: { width: 340, height: 260 }, vp: phone, side: 'bottom' });
    assert.equal(p.side, 'bottom');
    assert.equal(p.x, 25);
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
