import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFieldStore } from './store.js';

const LAT = 42.0255, LNG = -93.3555, d = 0.004;
const rect = (w, s, e, n) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const half = rect(LNG, LAT, LNG + d / 2, LAT + d);
const whole = rect(LNG, LAT, LNG + d, LAT + d);

describe('field store', () => {
  it('names the field the farm pin is in "Home field" and numbers by order', () => {
    const store = createFieldStore({ center: [LNG + 0.001, LAT + 0.001] });
    const [a, b] = store.add([{ geometry: whole, source: 'usda', sourceIds: ['x'] }, { geometry: rect(LNG, LAT + 0.01, LNG + d, LAT + 0.01 + d), source: 'usda' }]);
    assert.equal(a.name, 'Home field');
    assert.equal(store.numberOf(b.id), 2);
  });

  it('grows a field picked from half an outline, in the history too', () => {
    const store = createFieldStore({ center: [LNG, LAT] });
    const [f] = store.add({ geometry: half, source: 'usda', sourceIds: ['usda23-1'] });
    store.rename(f.id, 'North 80');
    const grown = store.growFromSource('usda23-1', half, whole);
    assert.equal(grown.length, 1);
    assert.equal(store.fields[0].geometry, whole);
    assert.equal(store.fields[0].name, 'North 80');
    store.undo(); // undo the rename: the whole outline must stay
    assert.equal(store.fields[0].geometry, whole);
    assert.notEqual(store.fields[0].name, 'North 80');
  });

  it('leaves edited or merged fields alone', () => {
    const store = createFieldStore({ center: [LNG, LAT] });
    const [f] = store.add({ geometry: half, source: 'usda', sourceIds: ['usda23-1'] });
    store.reshape(f.id, rect(LNG, LAT, LNG + d / 3, LAT + d)); // farmer moved a corner
    assert.deepEqual(store.growFromSource('usda23-1', half, whole), []);
    const [m] = store.add({ geometry: half, source: 'merged', sourceIds: ['usda23-1', 'usda23-2'] });
    assert.deepEqual(store.growFromSource('usda23-1', half, whole), []);
    assert.equal(store.get(m.id).geometry, half);
  });
});
