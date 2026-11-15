// The rotation and calendar icons: drawn, 24×24, hidden from screen readers, no emoji.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LINK_ICONS, CAL_ICONS, ALL_ROTATION_ICONS } from './rotationIcons.js';
import { LENS_ICONS, TILE_ICONS, ALL_ICONS } from './futureIcons.js';

test('every link kind and calendar mark has an icon', () => {
  for (const k of ['nitrogen', 'repeat', 'break', 'cover', 'same-family']) assert.ok(LINK_ICONS[k], k);
  for (const k of ['plant', 'harvest', 'frost', 'insurance', 'best', 'clock']) assert.ok(CAL_ICONS[k], k);
  assert.equal(Object.keys(ALL_ROTATION_ICONS).length, 11);
  assert.ok(ALL_ROTATION_ICONS['link-break'] && ALL_ROTATION_ICONS['cal-plant']);
});

test('drawn in the cozy-kit stroke, hidden, no emoji', () => {
  for (const [k, svg] of Object.entries({ ...ALL_ROTATION_ICONS, ...ALL_ICONS })) {
    if (k === 'priority') continue; // Manami's own picture
    assert.match(svg, /^<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"/, k);
    assert.match(svg, /<\/svg>$/, k);
    assert.doesNotMatch(svg, /\p{Extended_Pictographic}/u, k);
    assert.doesNotMatch(svg, /<text|title/, k);
  }
});

test('reuses the lens drawings where they mean the same', () => {
  assert.equal(LINK_ICONS.nitrogen, LENS_ICONS.nitrogen);
  assert.equal(LINK_ICONS.repeat, LENS_ICONS.repeat);
  assert.equal(CAL_ICONS.frost, LENS_ICONS.frost);
  assert.equal(CAL_ICONS.clock, LENS_ICONS.timing);
  assert.equal(TILE_ICONS.repeats, LENS_ICONS.repeat);
  assert.equal(TILE_ICONS.handoffs, LENS_ICONS.nitrogen);
  // each link kind looks different from the others
  assert.equal(new Set(Object.values(LINK_ICONS)).size, 5);
});
