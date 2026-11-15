import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JAR_ICONS } from './jarIcons.js';

const EMOJI = /\p{Extended_Pictographic}/u;

describe('the jar test icons', () => {
  it('are 24×24 line drawings in currentColor, hidden from screen readers, with no emoji', () => {
    assert.deepEqual(Object.keys(JAR_ICONS), ['JAR', 'CAMERA', 'IMAGE', 'SPLIT', 'MERGE']);
    for (const [name, svg] of Object.entries(JAR_ICONS)) {
      assert.match(svg, /^<svg viewBox="0 0 24 24" [^>]*>.*<\/svg>$/s, name);
      assert.match(svg, /stroke="currentColor"/, name);
      assert.match(svg, /stroke-width="2.2"/, name);
      assert.match(svg, /aria-hidden="true"/, name);
      assert.match(svg, /focusable="false"/, name);
      assert.ok(!EMOJI.test(svg), `${name} has an emoji`);
      assert.ok(!/#[0-9a-f]{3,6}\b/i.test(svg), `${name} has a fixed colour`);
    }
  });
});
