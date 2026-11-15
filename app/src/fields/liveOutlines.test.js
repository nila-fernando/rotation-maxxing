import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acresOf } from './geometry.js';
import { bboxAround, compactness, createLiveLayer, fillSmallHoles, joinPieces, tilesFor } from './liveOutlines.js';

// a 400 m square near the demo farm, and its west and east halves (as two tiles would cut it)
const LAT = 42.0255, LNG = -93.3555;
const dLat = 400 / 111320, dLng = 400 / (111320 * Math.cos((LAT * Math.PI) / 180));
const rect = (w, s, e, n) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const whole = rect(LNG, LAT, LNG + dLng, LAT + dLat);
const west = rect(LNG, LAT, LNG + dLng / 2, LAT + dLat);
const east = rect(LNG + dLng / 2, LAT, LNG + dLng, LAT + dLat);

describe('tiles', () => {
  it('covers a small bbox with the tile the point is in', () => {
    const t = tilesFor(bboxAround([LNG, LAT], 0.5), 10);
    assert.ok(t.length >= 1 && t.length <= 4);
    assert.deepEqual(t[0], [246, 380]); // the demo farm's zoom-10 tile, nearest first
  });
  it('sorts nearest first and grows with the box', () => {
    const small = tilesFor(bboxAround([LNG, LAT], 1), 14).length;
    const big = tilesFor(bboxAround([LNG, LAT], 5), 14).length;
    assert.ok(big > small);
  });
});

describe('joining pieces cut by tile edges', () => {
  it('joins two halves back into the whole field', () => {
    const g = joinPieces([west, east]);
    assert.equal(g.type, 'Polygon');
    assert.ok(Math.abs(acresOf(g) - acresOf(whole)) < 0.2);
  });
});

describe('tidying AI shapes', () => {
  it('scores a circle near 1, a square near 0.79, a thin web near 0', () => {
    const pts = [...Array(73)].map((_, i) => [LNG + dLng * Math.cos((i / 72) * 2 * Math.PI), LAT + dLat * Math.sin((i / 72) * 2 * Math.PI)]);
    assert.ok(compactness({ type: 'Polygon', coordinates: [pts] }) > 0.95);
    assert.ok(Math.abs(compactness(whole) - Math.PI / 4) < 0.03);
    // a comb: one long thin strip with thin teeth
    const comb = rect(LNG, LAT, LNG + dLng * 10, LAT + dLat / 100);
    assert.ok(compactness(comb) < 0.05);
  });
  it('fills pinholes but keeps real gaps', () => {
    const outer = whole.coordinates[0];
    const hole = (f) => [[LNG + dLng * 0.4, LAT + dLat * 0.4], [LNG + dLng * (0.4 + f), LAT + dLat * 0.4], [LNG + dLng * (0.4 + f), LAT + dLat * (0.4 + f)], [LNG + dLng * 0.4, LAT + dLat * (0.4 + f)], [LNG + dLng * 0.4, LAT + dLat * 0.4]];
    const g = { type: 'Polygon', coordinates: [outer, hole(0.05), hole(0.3)] }; // ~0.1 ac and ~3.6 ac holes
    assert.equal(fillSmallHoles(g, 2).coordinates.length, 2);
  });
});

describe('a live layer', () => {
  it('adds new fields, then grows a field when its other piece arrives', async () => {
    // a box that spans exactly two zoom-10 tiles side by side; the first holds field a's west half and
    // field b, the second holds a's east half
    const box = [-93.52, 41.99, -93.47, 42.02];
    const [t1, t2] = tilesFor(box, 10).sort((p, q) => p[0] - q[0]);
    assert.ok(t1 && t2 && t1[0] !== t2[0]);
    const byTile = {
      [`${t1[0]}/${t1[1]}`]: [
        { id: 'a', geometry: west, props: { 'crop:name': 'Corn' } },
        { id: 'b', geometry: rect(LNG, LAT - dLat, LNG + dLng, LAT), props: { 'crop:name': 'Soybeans' } },
      ],
      [`${t2[0]}/${t2[1]}`]: [{ id: 'a', geometry: east, props: { 'crop:name': 'Corn' } }],
    };
    const order = [];
    const layer = createLiveLayer('usda', {
      loadPieces: async (z, x, y) => { order.push(`${x}/${y}`); return byTile[`${x}/${y}`] || []; },
    });
    const events = [];
    layer.subscribe((e) => events.push({ added: e.added.map((i) => i.id), replaced: e.replaced.map((i) => i.id) }));

    // the first tile alone: a (half) and b are new
    await layer.ensure([box[0], box[1], box[0] + 0.001, box[3]]);
    assert.deepEqual(events[0], { added: ['a', 'b'], replaced: [] });
    assert.ok(Math.abs(layer.byId.get('a').acres - acresOf(west)) < 0.2);
    assert.deepEqual(layer.byId.get('b').crops, { 2023: 'Soybeans' });

    // the whole box: only the second tile is fetched, and a grows to the whole field
    await layer.ensure(box);
    assert.equal(order.length, 2, 'each tile is fetched once');
    assert.deepEqual(events[1], { added: [], replaced: ['a'] });
    assert.equal(layer.items.length, 2);
    assert.ok(Math.abs(layer.byId.get('a').acres - acresOf(whole)) < 0.2);
    assert.equal(layer.items.find((i) => i.id === 'a'), layer.byId.get('a'), 'items and byId agree');
  });

  it('leaves out slivers under an acre, but lists a field once its pieces add up', async () => {
    const tiny = (w, e) => rect(w, LAT, e, LAT + 0.0003); // about 33 m tall strips
    const box = [-93.52, 41.99, -93.47, 42.02];
    const [t1, t2] = tilesFor(box, 10).sort((p, q) => p[0] - q[0]);
    const step = 0.0002;
    const byTile = {
      [`${t1[0]}/${t1[1]}`]: [{ id: 's', geometry: tiny(LNG, LNG + step), props: {} }],
      [`${t2[0]}/${t2[1]}`]: [{ id: 's', geometry: tiny(LNG + step, LNG + step * 20), props: {} }],
    };
    const layer = createLiveLayer('usda', { loadPieces: async (z, x, y) => byTile[`${x}/${y}`] || [] }); // zoom-10 tiles, like box
    await layer.ensure([box[0], box[1], box[0] + 0.001, box[3]]);
    assert.equal(layer.items.length, 0, 'a sliver alone is not listed');
    await layer.ensure(box);
    assert.equal(layer.items.length, 1, 'with its other piece it is a real field');
    assert.ok(layer.byId.get('s').acres >= 1);
  });

  it('reports tooFar when zoomed out', async () => {
    const layer = createLiveLayer('ai', { loadPieces: async () => [] });
    assert.deepEqual(await layer.ensure(bboxAround([LNG, LAT], 50), { zoom: 8 }), { tooFar: true });
  });

  it('rejects only when every tile failed', async () => {
    const layer = createLiveLayer('usda', { loadPieces: async () => { throw new Error('offline'); } });
    await assert.rejects(layer.ensure(bboxAround([LNG, LAT], 1)), /offline/);
  });
});
