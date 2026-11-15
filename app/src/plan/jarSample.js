// A sample soil jar photo, painted pixel by pixel, for "Try a sample jar" and the tests.
//
//   paintSampleJar({ seed })            -> { img: { data, width: 480, height: 640 }, box: SAMPLE_BOX }
//   paintJar({ bands, seed, gravel })   -> { data, width: 480, height: 640 }   the same jar with your own bands
//
// This is the jar test demo's makeSample (jar_test.html at 20d9f14), ported: the same 9 bands, colours
// and grain, the 260 grey gravel patches and the 5 px glass outline. It paints straight into an RGBA
// array (no canvas), so it runs in node too, and its random grain comes from a seeded mulberry32, so
// the same seed always gives the same jar. Edges that fall between pixels are blended by how much of
// the pixel they cover, as a canvas does.
import { SAMPLE_BOX } from './jarTest.js';

export const SAMPLE_SIZE = { width: 480, height: 640 };

/** The demo's bands, top to bottom: [top row, bottom row, colour, grain]. */
export const SAMPLE_BANDS = [
  [62, 92, '#f9fafa', 2], // air gap
  [92, 106, '#3b2f25', 18], // floating organic matter
  [106, 190, '#cfe6ee', 3], // clear water (slightly blue)
  [190, 250, '#cfc9b8', 3], // cloudy water
  [250, 272, '#3e3027', 14], // settled organic matter
  [272, 345, '#8a6b52', 12], // clay
  [345, 440, '#a58762', 12], // silt
  [440, 540, '#d2bb88', 14], // sand
  [540, 578, '#8a8780', 0], // gravel (patches added on top)
];

/** A seeded random number in [0, 1), the same sequence for the same seed. */
export function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// how much of the span [i, i + 1) lies inside [a, b)
const cover = (i, a, b) => Math.max(0, Math.min(i + 1, b) - Math.max(i, a));

/**
 * Paints the jar: the table, the glass, your bands with their grain, the gravel patches (when
 * `gravel`) and the glass outline. Bands are [top row, bottom row, '#rrggbb', grain] and fill the
 * inside of the glass (x 145 to 335).
 */
export function paintJar({ bands = SAMPLE_BANDS, seed = 1, gravel = true } = {}) {
  const W = SAMPLE_SIZE.width, H = SAMPLE_SIZE.height;
  const rand = mulberry32(seed);
  const d = new Uint8ClampedArray(W * H * 4);

  // a filled rectangle, blended where its edges only partly cover a pixel
  const fill = (x, y, w, h, c) => {
    const x1 = x + w, y1 = y + h;
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(H, Math.ceil(y1)); j++) {
      const cy = cover(j, y, y1);
      for (let i = Math.max(0, Math.floor(x)); i < Math.min(W, Math.ceil(x1)); i++) {
        const a = cy * cover(i, x, x1);
        if (a <= 0) continue;
        const o = (j * W + i) * 4;
        d[o] = d[o] * (1 - a) + c[0] * a;
        d[o + 1] = d[o + 1] * (1 - a) + c[1] * a;
        d[o + 2] = d[o + 2] * (1 - a) + c[2] * a;
        d[o + 3] = 255;
      }
    }
  };

  fill(0, 0, W, H, hex('#e9e4d8')); // the table behind
  fill(140, 60, 200, 520, hex('#f7f9f9')); // the glass

  for (const [a, b, col, amp] of bands) {
    fill(145, a, 190, b - a, hex(col));
    if (!amp) continue;
    // grain: the same random shift on all three channels, pixel by pixel, row by row
    for (let j = a; j < b; j++) {
      for (let i = 145; i < 335; i++) {
        const n = (rand() - 0.5) * 2 * amp;
        const o = (j * W + i) * 4;
        d[o] += n; d[o + 1] += n; d[o + 2] += n;
      }
    }
  }

  if (gravel) {
    for (let k = 0; k < 260; k++) {
      const v = Math.round(70 + rand() * 120);
      const x = 145 + rand() * 180, y = 541 + rand() * 28, w = 5 + rand() * 9, h = 4 + rand() * 6;
      fill(x, y, w, h, [v, v - 4, v - 10]);
    }
  }

  // the glass outline: a 5 px line centred on the rectangle (142, 60, 196, 522), as strokeRect draws it
  const g = hex('#8fa3ad');
  fill(139.5, 57.5, 201, 5, g); // top
  fill(139.5, 579.5, 201, 5, g); // bottom
  fill(139.5, 62.5, 5, 517, g); // left
  fill(335.5, 62.5, 5, 517, g); // right
  return { data: d, width: W, height: H };
}

/** The sample jar and the box round its contents (just under the lid to the bottom of the soil). */
export function paintSampleJar({ seed = 1 } = {}) {
  return { img: paintJar({ bands: SAMPLE_BANDS, seed, gravel: true }), box: { ...SAMPLE_BOX } };
}
