import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getFields } from './farmData.js';
import { buildFieldReport, demoRecordFor, fieldReportFor } from './fieldReport.js';
import { fieldData } from '../../test/fieldData.mjs';

// a demo field as the field step hands it on
const appField = (id) => {
  const f = getFields().find((x) => x.id === id);
  return { id: f.id, name: f.name, acres: f.acres, geometry: f.geometry, sourceIds: [f.sourceId], crops: Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])), ...fieldData(f) };
};
// a saved jar test (src/plan/jarTest.js toRecord): the sample jar's clay loam
const JAR = {
  v: 1, fieldId: 'f2', at: '2026-11-15T20:14:00.000Z', sample: true, elapsed: 'ok',
  textureClass: 'Clay loam', sandPct: 36, siltPct: 36, clayPct: 28, confidence: 'high', adjusted: false,
  layers: [{ type: 'water', rgb: [207, 230, 238], share: 0.5 }, { type: 'clay', rgb: [138, 107, 82], share: 0.15 }, { type: 'silt', rgb: [165, 135, 98], share: 0.17 }, { type: 'sand', rgb: [210, 187, 136], share: 0.18 }],
  warnings: [],
};

describe('the jar test in the field check-up', () => {
  it('West 140: the jar (loam bucket) differs from the soil map (silty clay loam, silt bucket)', () => {
    const r = fieldReportFor({ ...appField('f2'), jar: JAR });
    assert.equal(r.jar.textureClass, 'Clay loam');
    assert.equal(r.jar.sandPct, 36);
    assert.equal(r.jar.mapTexture, 'silty clay loam');
    assert.equal(r.jar.sameAsMap, false);
  });
  it('Home place: clay loam on the map, and the jar agrees', () => {
    const r = fieldReportFor({ ...appField('f1'), jar: { ...JAR, fieldId: 'f1' } });
    assert.equal(r.jar.mapTexture, 'clay loam');
    assert.equal(r.jar.sameAsMap, true);
  });
  it('no jar: null; a field with no soil survey: no map texture to agree with', () => {
    assert.equal(fieldReportFor(appField('f2')).jar, null);
    const r = buildFieldReport({ id: 'field-9', name: 'Field 9', acres: 40, jar: { ...JAR, fieldId: 'field-9' } });
    assert.equal(r.jar.mapTexture, null);
    assert.equal(r.jar.sameAsMap, false);
  });
  it('the soil section itself is unchanged by a jar', () => {
    const f = appField('f2');
    assert.deepEqual(fieldReportFor({ ...f, jar: JAR }).soil, fieldReportFor(f).soil);
    assert.ok(demoRecordFor(f));
  });
});

describe('the plans\u2019 weather in the check-up', () => {
  it('is passed through unchanged, and is null by default', () => {
    const planWeather = { water: 'Rain is usually enough here.', frost: null };
    assert.equal(fieldReportFor(appField('f1'), { planWeather }).planWeather, planWeather);
    assert.equal(fieldReportFor(appField('f1')).planWeather, null);
    assert.equal(buildFieldReport({ id: 'x', name: 'X' }).planWeather, null);
  });
});
