import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DAY_HOURS, daylightAt, formatHour, hourOf, hoursPerSecond, wrapHour } from './daylight.js';

describe('the time of day', () => {
  it('is full day at noon and full night at midnight, with twilight between', () => {
    const noon = daylightAt(12.5, 'summer');
    assert.equal(noon.night, 0);
    assert.equal(noon.moon, false);
    assert.equal(noon.part, 'Midday');
    assert.ok(noon.strength > 0.9);
    const midnight = daylightAt(0.5, 'summer');
    assert.equal(midnight.night, 1);
    assert.equal(midnight.moon, true);
    assert.equal(midnight.part, 'Night');
    const dusk = daylightAt(DAY_HOURS.summer[1] - 0.1, 'summer');
    assert.ok(dusk.golden > 0.3, `golden ${dusk.golden}`);
    assert.ok(dusk.night > 0 && dusk.night < 1, `night ${dusk.night}`);
    assert.equal(dusk.part, 'Dusk');
    assert.equal(daylightAt(DAY_HOURS.summer[0] + 0.1, 'summer').part, 'Dawn');
  });
  it('the night deepens smoothly (no jumps from one quarter hour to the next)', () => {
    for (const season of ['spring', 'summer', 'fall', 'winter']) {
      let prev = daylightAt(0, season);
      for (let h = 0.25; h <= 24; h += 0.25) {
        const d = daylightAt(h, season);
        assert.ok(Math.abs(d.night - prev.night) < 0.35, `${season} ${h}: ${prev.night} -> ${d.night}`);
        prev = d;
      }
    }
  });
  it('the sun rises in the east, is highest round noon, sets in the west; its light fades out at the horizon', () => {
    const [rise, set] = DAY_HOURS.summer;
    const morning = daylightAt(rise + 1.5, 'summer'), noon = daylightAt((rise + set) / 2, 'summer'), evening = daylightAt(set - 1.5, 'summer');
    assert.ok(morning.dir[0] > 0.3, 'east is +x');
    assert.ok(evening.dir[0] < -0.3, 'west is -x');
    assert.ok(noon.dir[1] > morning.dir[1] && noon.dir[1] > evening.dir[1]);
    assert.ok(noon.dir[2] > 0, 'toward the camera side (south) at noon');
    for (const d of [morning, noon, evening]) assert.ok(Math.abs(Math.hypot(...d.dir) - 1) < 1e-9);
    assert.ok(daylightAt(rise + 0.02, 'summer').strength < 0.15);
    assert.ok(daylightAt(set - 0.02, 'summer').strength < 0.15);
  });
  it('winter days are shorter than summer ones', () => {
    const len = (s) => DAY_HOURS[s][1] - DAY_HOURS[s][0];
    assert.ok(len('winter') < len('spring') && len('spring') < len('summer'));
    assert.equal(daylightAt(18, 'winter').night > 0.5, true); // dark by 6 pm in winter
    assert.equal(daylightAt(18, 'summer').night, 0); // still light in summer
  });
  it('runs slower by day than by night, about two and a half minutes a day', () => {
    assert.ok(hoursPerSecond(13) < hoursPerSecond(2));
    let seconds = 0;
    for (let h = 0; h < 24; h += 0.05) seconds += 0.05 / hoursPerSecond(h);
    assert.ok(seconds > 120 && seconds < 200, `${seconds} s a day`);
  });
  it('clock faces', () => {
    assert.equal(formatHour(19 + 40 / 60), '7:40 pm');
    assert.equal(formatHour(12), '12:00 pm');
    assert.equal(formatHour(0.05), '12:05 am');
    assert.equal(formatHour(23.99), '12:00 am');
    assert.equal(formatHour(-1), '11:00 pm');
    assert.equal(wrapHour(25.5), 1.5);
    assert.equal(hourOf(new Date(2026, 10, 15, 21, 30)), 21.5);
  });
});
