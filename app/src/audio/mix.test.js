import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MASTER, masterFor, mixAt, nextGap, readSoundPref, sceneOf, SOUND_KEY, writeSoundPref } from './mix.js';

const SEASONS = ['spring', 'summer', 'fall', 'winter'];

describe('the farm sound mix', () => {
  it('has birds by day and crickets and owls at night', () => {
    const noon = mixAt({ hour: 12, season: 'summer' });
    const late = mixAt({ hour: 22.5, season: 'summer' });
    assert.ok(noon.birds > 0.4, `noon birds ${noon.birds}`);
    assert.equal(noon.crickets, 0);
    assert.equal(noon.rates.owl, 0);
    assert.equal(late.birds, 0);
    assert.ok(late.crickets > 0.8, `night crickets ${late.crickets}`);
    assert.ok(late.rates.owl > 0);
    assert.ok(noon.rates.baa > late.rates.baa, 'sheep baa more by day');
  });

  it('follows the night amount it is given over the hour', () => {
    const m = mixAt({ hour: 12, night: 1, golden: 0, season: 'summer' });
    assert.equal(m.birds, 0);
    assert.ok(m.crickets > 0.8);
  });

  it('sings a dawn chorus louder than the afternoon', () => {
    const dawn = mixAt({ hour: 12, night: 0.05, golden: 0.9, morning: true, season: 'spring' });
    const afternoon = mixAt({ hour: 15, night: 0, golden: 0, morning: false, season: 'spring' });
    assert.ok(dawn.birds > afternoon.birds, `${dawn.birds} vs ${afternoon.birds}`);
  });

  it('has a stronger breeze in fall and winter, and no winter crickets', () => {
    const at = (season) => mixAt({ hour: 12, season });
    assert.ok(at('fall').breeze > at('summer').breeze);
    assert.ok(at('winter').breeze > at('spring').breeze);
    assert.ok(at('winter').creak > at('summer').creak, 'the windmill creaks more in the wind');
    assert.equal(mixAt({ hour: 23, season: 'winter' }).crickets, 0);
    assert.ok(at('winter').birds < at('spring').birds);
  });

  it('rings faint bells only at Christmas and New Year', () => {
    assert.ok(mixAt({ season: 'winter', occasion: 'christmas' }).bells > 0);
    assert.ok(mixAt({ season: 'winter', occasion: 'newyear' }).rates.bells > 0);
    for (const occasion of [null, 'easter', 'independence', 'halloween', 'thanksgiving', 'nonsense']) {
      assert.equal(mixAt({ season: 'fall', occasion }).bells, 0, String(occasion));
    }
    assert.ok(mixAt({ hour: 23, season: 'fall', occasion: 'halloween' }).rates.owl > mixAt({ hour: 23, season: 'fall' }).rates.owl);
  });

  it('keeps every level between 0 and 1 and every rate finite, round the clock', () => {
    for (const season of [...SEASONS, 'unknown']) {
      for (const occasion of [null, 'easter', 'halloween', 'christmas', 'newyear']) {
        for (let h = 0; h < 24; h += 0.5) {
          const m = mixAt({ hour: h, season, occasion });
          for (const k of ['sea', 'breeze', 'birds', 'crickets', 'creak', 'bells']) {
            assert.ok(m[k] >= 0 && m[k] <= 1, `${season} ${occasion} ${h} ${k}=${m[k]}`);
          }
          for (const [k, r] of Object.entries(m.rates)) assert.ok(Number.isFinite(r) && r >= 0, `${k}=${r}`);
        }
      }
    }
  });

  it('changes smoothly from one quarter hour to the next (dawn and dusk ramp, the player crossfades the rest)', () => {
    for (const season of SEASONS) {
      let prev = mixAt({ hour: 0, season });
      for (let h = 0.25; h <= 24; h += 0.25) {
        const m = mixAt({ hour: h, season });
        for (const k of ['birds', 'crickets', 'breeze']) assert.ok(Math.abs(m[k] - prev[k]) < 0.45, `${season} ${h} ${k}: ${prev[k]} -> ${m[k]}`);
        prev = m;
      }
    }
  });
});

describe('when the farm is quiet', () => {
  it('plays only once unlocked, switched on, visible and not covered', () => {
    assert.equal(masterFor({ on: true, unlocked: true }), MASTER);
    assert.ok(MASTER > 0 && MASTER <= 0.4, 'gentle');
    assert.equal(masterFor({ on: true, unlocked: false }), 0, 'nothing before a tap');
    assert.equal(masterFor({ on: false, unlocked: true }), 0);
    assert.equal(masterFor({ on: true, unlocked: true, hidden: true }), 0);
    assert.equal(masterFor({ on: true, unlocked: true, away: true }), 0, 'the plans panel is open');
  });
});

describe('the gaps between calls', () => {
  it('spreads calls out at random but never too close, and never at 0 a minute', () => {
    assert.equal(nextGap(0), Infinity);
    assert.equal(nextGap(-1), Infinity);
    assert.equal(nextGap(NaN), Infinity);
    assert.equal(nextGap(60, () => 0), 1.5);
    assert.ok(nextGap(1, () => 0.999) < 60 * 10);
    // on average about 60 / perMinute seconds
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += nextGap(2, rnd, 0);
    assert.ok(Math.abs(sum / 4000 - 30) < 2.5, `mean ${sum / 4000}`);
  });
});

describe('remembering the sound switch', () => {
  const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
  it('is on until turned off, and remembers', () => {
    const s = memory();
    assert.equal(readSoundPref(s), true);
    writeSoundPref(s, false);
    assert.equal(s.m.get(SOUND_KEY), 'off');
    assert.equal(readSoundPref(s), false);
    writeSoundPref(s, true);
    assert.equal(readSoundPref(s), true);
  });
  it('carries on when storage is missing or throws', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.equal(readSoundPref(broken), true);
    assert.doesNotThrow(() => writeSoundPref(broken, false));
    assert.equal(readSoundPref(undefined), true);
    assert.doesNotThrow(() => writeSoundPref(null, true));
  });
});

describe('the moment the sounds follow', () => {
  it('takes the hour and night from the time of day, and the season and festival from what is on show', () => {
    const session = { dayInfo: { hour: 22, night: 1, golden: 0, morning: false, part: 'Night' }, state: { season: 'winter', occasion: 'christmas', year: 2026 } };
    assert.deepEqual(sceneOf(session), { hour: 22, night: 1, golden: 0, morning: false, season: 'winter', occasion: 'christmas' });
    assert.equal(sceneOf({ dayInfo: session.dayInfo, state: { season: 'summer' } }).occasion, null);
    assert.equal(sceneOf(null), null);
    assert.equal(sceneOf({ state: session.state }), null);
    assert.ok(mixAt(sceneOf(session)).bells > 0);
  });
});
