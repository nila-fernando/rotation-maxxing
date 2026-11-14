import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPlayback, dateIn, lookAt, nowState, occasionOn, seasonAt, seasonLabel, staticState } from './timeline.js';

const D = (y, m, d) => new Date(y, m - 1, d);

describe('seasons and occasions', () => {
  it('finds the season and how far in', () => {
    assert.equal(seasonAt(D(2026, 11, 15)).season, 'fall');
    assert.ok(Math.abs(seasonAt(D(2026, 9, 1)).t) < 1e-9);
    assert.equal(seasonAt(D(2027, 1, 10)).season, 'winter');
    assert.equal(seasonAt(D(2027, 1, 10)).year, 2026); // winter is named by the year it starts
    assert.equal(seasonAt(D(2026, 4, 1)).season, 'spring');
    assert.equal(seasonAt(D(2026, 7, 4)).season, 'summer');
  });
  it('dateIn is the inverse of seasonAt', () => {
    for (const d of [D(2021, 3, 9), D(2021, 6, 30), D(2021, 10, 31), D(2021, 12, 25), D(2022, 2, 14)]) {
      const s = seasonAt(d);
      assert.equal(dateIn(s.year, s.season, s.t).toDateString(), d.toDateString());
    }
  });
  it('Halloween is Oct 15–31, Christmas Dec 1–26', () => {
    assert.equal(occasionOn(D(2026, 10, 14)), null);
    assert.equal(occasionOn(D(2026, 10, 15)), 'halloween');
    assert.equal(occasionOn(D(2026, 10, 31)), 'halloween');
    assert.equal(occasionOn(D(2026, 11, 1)), null);
    assert.equal(occasionOn(D(2026, 12, 1)), 'christmas');
    assert.equal(occasionOn(D(2026, 12, 25)), 'christmas');
    assert.equal(occasionOn(D(2026, 12, 27)), null);
  });
  it('labels', () => {
    assert.equal(seasonLabel('fall', 2026), 'Fall 2026');
    assert.equal(seasonLabel('winter', 2019), 'Winter 2019–20');
  });
});

describe('looks', () => {
  it('crops grow in spring and summer, ripen and are cut in fall, bare in winter', () => {
    assert.ok(lookAt('spring', 0).growth < 0.1);
    assert.ok(lookAt('summer', 1).growth === 1 && lookAt('summer', 1).ripe === 0);
    assert.ok(lookAt('fall', 0.4).ripe > 0.7 && !lookAt('fall', 0.4).harvested);
    assert.ok(lookAt('fall', 0.8).harvested && lookAt('fall', 0.8).growth < 0.3);
    assert.equal(lookAt('winter', 0.5).growth, 0);
  });
  it('snow only in winter (with a dusting at the edges of fall and spring)', () => {
    assert.equal(lookAt('summer', 0.5).snow, 0);
    assert.equal(lookAt('fall', 0.3).snow, 0);
    assert.ok(lookAt('winter', 0.5).snow > 0.9);
    assert.ok(lookAt('spring', 0.5).snow === 0);
  });
});

describe('still states', () => {
  it('a past year shows its crops in summer', () => {
    const s = staticState(2019);
    assert.equal(s.cropYear, 2019);
    assert.equal(s.season, 'summer');
    assert.equal(s.look.growth > 0.9, true);
    assert.equal(s.occasion, null);
  });
  it('now: the real season and occasion, with the newest crops', () => {
    const s = nowState(D(2026, 11, 15), 2025);
    assert.deepEqual([s.season, s.year, s.cropYear, s.occasion, s.now], ['fall', 2026, 2025, null, true]);
    assert.equal(s.label, 'Fall 2026');
    assert.ok(!s.look.harvested); // still point: ripe and standing
    assert.equal(nowState(D(2026, 10, 31), 2025).occasion, 'halloween');
    const xmas = nowState(D(2026, 12, 24), 2025);
    assert.deepEqual([xmas.season, xmas.occasion], ['winter', 'christmas']);
    assert.ok(xmas.look.snow > 0.9);
  });
});

describe('festivals', () => {
  it('Easter and Thanksgiving move with the calendar', async () => {
    const { easterSunday, thanksgivingDay } = await import('./timeline.js');
    const iso = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    assert.equal(iso(easterSunday(2024)), '2024-3-31');
    assert.equal(iso(easterSunday(2025)), '2025-4-20');
    assert.equal(iso(easterSunday(2026)), '2026-4-5');
    assert.equal(iso(easterSunday(2027)), '2027-3-28');
    assert.equal(iso(thanksgivingDay(2025)), '2025-11-27');
    assert.equal(iso(thanksgivingDay(2026)), '2026-11-26');
  });
  it('each has its days', () => {
    assert.equal(occasionOn(D(2026, 4, 5)), 'easter');
    assert.equal(occasionOn(D(2026, 3, 29)), 'easter'); // Palm Sunday
    assert.equal(occasionOn(D(2026, 4, 7)), null);
    assert.equal(occasionOn(D(2026, 7, 4)), 'independence');
    assert.equal(occasionOn(D(2026, 7, 6)), null);
    assert.equal(occasionOn(D(2026, 11, 15)), null);
    assert.equal(occasionOn(D(2026, 11, 26)), 'thanksgiving');
    assert.equal(occasionOn(D(2026, 11, 21)), 'thanksgiving');
    assert.equal(occasionOn(D(2026, 12, 31)), 'newyear');
    assert.equal(occasionOn(D(2027, 1, 1)), 'newyear');
    assert.equal(occasionOn(D(2027, 1, 3)), null);
    assert.equal(occasionOn(D(2026, 12, 28)), null); // between Christmas and New Year
  });
  it('a picked festival shows in its own season, looking as it does by the calendar', async () => {
    const { occasionState } = await import('./timeline.js');
    const seasonOf = { easter: 'spring', independence: 'summer', halloween: 'fall', thanksgiving: 'fall', christmas: 'winter', newyear: 'winter' };
    for (const [key, season] of Object.entries(seasonOf)) {
      const st = occasionState(2026, key);
      assert.equal(st.occasion, key);
      assert.equal(st.season, season);
      assert.deepEqual(st.look, nowState(D(2026, 10, 1), 2025).season === season ? nowState(D(2026, 10, 1), 2025).look : st.look);
    }
    const thanks = occasionState(2026, 'thanksgiving');
    assert.equal(thanks.look.harvested, false); // standing crops, as on the day itself
    assert.equal(thanks.look.snow, 0);
  });
});

describe('playback', () => {
  const years = [2018, 2019, 2020];
  const pb = createPlayback(years);
  it('runs every season of every year in order', () => {
    const seen = [];
    for (let s = 0; s < pb.duration; s += 0.05) {
      const st = pb.at(s);
      const key = `${st.year} ${st.season}`;
      if (seen[seen.length - 1] !== key) seen.push(key);
    }
    assert.deepEqual(seen, years.flatMap((y) => ['spring', 'summer', 'fall', 'winter'].map((x) => `${y} ${x}`)));
  });
  it('is just the seasons: no festivals in the history', () => {
    assert.equal(pb.parts.length, years.length * 4);
    for (let s = 0; s < pb.duration; s += 0.1) assert.equal(pb.at(s).occasion, null);
  });
  it('time runs forward and clamps at the ends', () => {
    assert.equal(pb.at(-5).year, 2018);
    assert.equal(pb.at(-5).season, 'spring');
    const end = pb.at(pb.duration + 10);
    assert.deepEqual([end.year, end.season], [2020, 'winter']);
    assert.ok(pb.startOf(2019) > 0 && pb.at(pb.startOf(2019)).year === 2019);
    assert.ok(pb.duration > 10 && pb.duration < 30);
  });
});
