import test from 'node:test';
import assert from 'node:assert/strict';
import { seasonStripSvg, stripScale } from './seasonStrip.js';

const STORY = { state: 'IA', fips: '19169' };
const svgOf = (s) => s.slice(0, s.indexOf('</svg>') + 6);
const attr = (s, kind, name) => Number(new RegExp(`data-kind="${kind}"[^>]*data-${name}="([\\d.]+)"`).exec(s)?.[1]);
// March 1 is day 60 and December 1 day 335 of a non-leap year; a 300 px strip has 6 px each side
const xOf = (day) => Math.round((6 + ((day - 60) / 275) * 288) * 10) / 10;

test('corn 2027: the bands sit on a March–November axis', () => {
  const s = seasonStripSvg('corn', 2027, STORY);
  assert.equal(attr(s, 'usual', 'x0'), xOf(115)); // Apr 25
  assert.equal(attr(s, 'usual', 'x1'), xOf(138)); // May 18
  assert.equal(attr(s, 'best', 'x0'), xOf(105)); // Apr 15
  assert.equal(attr(s, 'best', 'x1'), xOf(129)); // May 9
  assert.equal(attr(s, 'harvest', 'x0'), xOf(278)); // Oct 5
  assert.equal(attr(s, 'harvest', 'x1'), xOf(313)); // Nov 9
  assert.equal(attr(s, 'half', 'x'), xOf(126)); // May 6, the recent halfway day
  assert.equal(attr(s, 'insurance', 'x'), xOf(151)); // May 31, the last day for full insurance
  assert.equal((s.match(/data-kind="frost"/g) ?? []).length, 2); // Apr 23 and Oct 14
  assert.ok(stripScale()('01-15') === 6 && stripScale()('12-31') === 294, 'dates outside the axis are clamped');
});

test('the aria-label says the season in words', () => {
  assert.match(seasonStripSvg('corn', 2027, STORY), /aria-label="2027 corn: sow Apr 15 to May 9, harvest early October to early November"/);
  assert.match(seasonStripSvg('soybeans', 2027, STORY), /aria-label="2027 soybeans: sow by May 20, harvest late September to mid October"/);
  assert.match(seasonStripSvg('winter-wheat', 2028, STORY), /aria-label="2028 winter wheat: sow Oct 1 to Oct 10 the fall before, harvest early July to late July"/);
  assert.match(seasonStripSvg('winter-wheat', 2028, STORY), />the fall before</);
  assert.match(seasonStripSvg('corn', 2027, STORY, { cover: 'cereal-rye' }), /rye cover from mid August"/);
  assert.match(seasonStripSvg('sunflower', 2027, STORY), /aria-label="2027 sunflowers: no sowing dates here yet"/);
});

test('winter wheat’s "the fall before" sits left of its sowing band, clear of the October marks', () => {
  const s = seasonStripSvg('winter-wheat', 2028, STORY, { cover: 'cereal-rye' });
  const note = /<text class="ss-note" x="([\d.]+)" y="([\d.]+)" text-anchor="end">the fall before<\/text>/.exec(s);
  assert.ok(note, 'the note is there, anchored at its end');
  const x0 = attr(s, 'usual', 'x0');
  assert.ok(Number(note[1]) < x0, `${note[1]} < ${x0}`);
  // above the cover stripe (y 19) and below the icon row (0–9)
  assert.ok(Number(note[2]) < 19 && Number(note[2]) > 9);
  const frostXs = [...s.matchAll(/data-kind="frost" data-x="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(frostXs.every((fx) => fx < 100 || fx > Number(note[1])), 'no frost mark over the note');
});

test('an SVG with role img, then an sr-only list of every date with its source', () => {
  const s = seasonStripSvg('corn', 2027, STORY, { cover: 'cereal-rye' });
  assert.match(s, /^<svg [^>]*role="img"/);
  assert.match(s, /<\/svg><ul class="sr-only"><li>/);
  assert.match(s, /<li>Last day for full insurance here: May 31 \(USDA RMA 2026\)<\/li>/);
  assert.match(s, /<li>Best sown Apr 15 to May 9 \(Iowa State\)<\/li>/);
  assert.match(s, /data-kind="cover"/);
  // the drawings inside are hidden; the strip is one image
  for (const inner of svgOf(s).match(/<svg x=[^>]*>/g) ?? []) assert.match(inner, /aria-hidden="true"/);
});

test('no emoji, no native titles, the size asked for', () => {
  for (const crop of ['corn', 'soybeans', 'oats', 'winter-wheat', 'alfalfa', 'sunflower']) {
    const s = seasonStripSvg(crop, 2027, STORY, { width: 240, height: 36 });
    assert.doesNotMatch(s, /\p{Extended_Pictographic}/u);
    assert.doesNotMatch(s, /title=|<title/);
    assert.match(s, /viewBox="0 0 240 36"/);
  }
});
