import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as turf from '@turf/turf';
import {
  getFarm,
  getFields,
  getField,
  getWeather,
  getCounty,
  getMeta,
  findFieldBySourceId,
} from './farmData.js';

const SQ_M_PER_ACRE = 4046.8564224;
const LEGUMES = new Set(['soybeans', 'alfalfa', 'clover', 'peas', 'beans', 'dry beans', 'lentils', 'vetch']);

// Every value present: no undefined/null (except ndvi), no empty strings, arrays or objects.
function assertFilled(value, path) {
  assert.notEqual(value, undefined, `${path} is undefined`);
  assert.notEqual(value, null, `${path} is null`);
  if (typeof value === 'string') assert.ok(value.trim().length > 0, `${path} is empty`);
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is not finite`);
  if (Array.isArray(value)) {
    assert.ok(value.length > 0, `${path} is an empty array`);
    value.forEach((v, i) => assertFilled(v, `${path}[${i}]`));
  } else if (typeof value === 'object') {
    assert.ok(Object.keys(value).length > 0, `${path} is an empty object`);
    for (const [k, v] of Object.entries(value)) assertFilled(v, `${path}.${k}`);
  }
}

const longestCornRun = (f) => {
  let run = 0;
  let best = 0;
  for (const { crop } of f.cropHistory) {
    run = crop === 'corn' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
};

describe('farm', () => {
  test('has name, county, state and a [lon, lat] centre', () => {
    const farm = getFarm();
    assertFilled(farm, 'farm');
    assert.equal(farm.name, 'Sheeeep Hollow');
    assert.equal(farm.county, 'Story');
    assert.equal(farm.state, 'IA');
    const [lon, lat] = farm.center;
    assert.ok(lon > -94 && lon < -93 && lat > 41.8 && lat < 42.3, 'centre is in Story County');
  });

  test('meta says which values are real and which are placeholders', () => {
    const meta = getMeta();
    assert.ok(meta.real.includes('fields[].geometry'));
    assert.ok(meta.placeholder.includes('fields[].soil'));
    assert.ok(meta.cropKeyMapping && meta.units && meta.sources);
  });
});

describe('fields', () => {
  const fields = getFields();

  test('there are exactly 5, ids f1..f5, unique names and source ids', () => {
    assert.equal(fields.length, 5);
    assert.deepEqual(fields.map((f) => f.id), ['f1', 'f2', 'f3', 'f4', 'f5']);
    assert.equal(new Set(fields.map((f) => f.name)).size, 5);
    assert.equal(new Set(fields.map((f) => f.sourceId)).size, 5);
  });

  test('every property is filled in (ndvi is a non-empty array or null)', () => {
    const keys = ['id', 'name', 'acres', 'sourceId', 'geometry', 'cropHistory', 'soil', 'slopePct', 'elevationM', 'ndvi'];
    for (const f of fields) {
      for (const k of keys) assert.ok(k in f, `${f.id}.${k} missing`);
      for (const k of ['texture', 'drainage', 'organicMatterPct', 'waterHoldingIn']) assert.ok(k in f.soil, `${f.id}.soil.${k} missing`);
      const { ndvi, ...rest } = f;
      assertFilled(rest, f.id);
      if (ndvi !== null) {
        assertFilled(ndvi, `${f.id}.ndvi`);
        for (const p of ndvi) {
          assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
          assert.ok(p.value >= 0 && p.value <= 1, `${f.id} ndvi ${p.value}`);
        }
      }
    }
  });

  test('cropHistory has 8 entries, 2018-2025 in order', () => {
    for (const f of fields) {
      assert.deepEqual(f.cropHistory.map((c) => c.year), [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], f.id);
      for (const c of f.cropHistory) assert.match(c.crop, /^[a-z ]+$/, `${f.id} crop key ${c.crop}`);
    }
  });

  test('placeholder values are in a plausible Story County range', () => {
    for (const f of fields) {
      assert.ok(f.elevationM >= 280 && f.elevationM <= 330, `${f.id} elevation`);
      assert.ok(f.soil.organicMatterPct >= 2.5 && f.soil.organicMatterPct <= 6, `${f.id} OM`);
      assert.ok(f.soil.waterHoldingIn >= 8 && f.soil.waterHoldingIn <= 12, `${f.id} AWC`);
      assert.ok(f.slopePct >= 0.5 && f.slopePct <= 9, `${f.id} slope`);
    }
  });

  test('required cases: corn 3+ years running, no legume in 8 years, slope > 6%, ndvi null', () => {
    assert.ok(fields.some((f) => longestCornRun(f) >= 3), 'a field with corn 3+ years in a row');
    assert.ok(fields.some((f) => f.cropHistory.every((c) => !LEGUMES.has(c.crop))), 'a field with no legume in 8 years');
    assert.ok(fields.some((f) => f.slopePct > 6), 'a field with slope above 6%');
    assert.ok(fields.some((f) => f.ndvi === null), 'a field with ndvi null');
  });

  test('geometry is a valid closed Polygon whose geodesic area matches acres within 2%', () => {
    for (const f of fields) {
      const g = f.geometry;
      assert.equal(g.type, 'Polygon', f.id);
      assert.ok(g.coordinates.length >= 1, `${f.id} has rings`);
      for (const ring of g.coordinates) {
        assert.ok(ring.length >= 4, `${f.id} ring has >= 4 positions`);
        assert.deepEqual(ring[0], ring[ring.length - 1], `${f.id} ring is closed`);
        for (const [lon, lat] of ring) assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
      }
      assert.equal(turf.kinks(g).features.length, 0, `${f.id} has no self-intersections`);
      const acres = turf.area(g) / SQ_M_PER_ACRE;
      assert.ok(Math.abs(acres - f.acres) <= f.acres * 0.02, `${f.id} area ${acres.toFixed(1)} vs ${f.acres}`);
    }
  });

  test('the farm centre lies inside one of the fields', () => {
    const pin = turf.point(getFarm().center);
    assert.ok(fields.some((f) => turf.booleanPointInPolygon(pin, f.geometry)));
  });
});

describe('lookups', () => {
  test("getField('f3') works and getField('nope') returns null", () => {
    assert.equal(getField('f3').id, 'f3');
    assert.equal(getField('f3'), getFields()[2]);
    assert.equal(getField('nope'), null);
  });

  test('findFieldBySourceId matches the CSB outline id', () => {
    const f = getFields()[0];
    assert.equal(findFieldBySourceId(f.sourceId), f);
    assert.equal(findFieldBySourceId('usda-000'), null);
  });

  test('data is frozen so callers cannot mutate it', () => {
    const f = getField('f1');
    assert.ok(Object.isFrozen(f) && Object.isFrozen(f.geometry.coordinates[0][0]) && Object.isFrozen(getCounty().prices));
    assert.throws(() => {
      f.name = 'changed';
    }, TypeError);
  });
});

describe('weather', () => {
  const w = getWeather();

  test('has every year 1981-2025 with plausible April-September rain', () => {
    assert.deepEqual(w.growingSeasonRainMm.map((r) => r.year), Array.from({ length: 45 }, (_, i) => 1981 + i));
    for (const r of w.growingSeasonRainMm) assert.ok(r.value >= 300 && r.value <= 1100, `${r.year} ${r.value}`);
  });

  test('avg30yrRainMm equals the 1991-2020 mean of the series (+-1)', () => {
    const norm = w.growingSeasonRainMm.filter((r) => r.year >= 1991 && r.year <= 2020);
    assert.equal(norm.length, 30);
    const mean = norm.reduce((s, r) => s + r.value, 0) / norm.length;
    assert.ok(Math.abs(w.avg30yrRainMm - mean) <= 1, `${w.avg30yrRainMm} vs ${mean}`);
  });
});

describe('county', () => {
  const c = getCounty();

  test('corn and soybean yields cover every year 1995-2025', () => {
    for (const crop of ['corn', 'soybeans']) {
      assert.deepEqual(c.yields[crop].map((y) => y.year), Array.from({ length: 31 }, (_, i) => 1995 + i), crop);
      for (const y of c.yields[crop]) assert.ok(y.buPerAcre > 0, `${crop} ${y.year}`);
    }
    const corn = Object.fromEntries(c.yields.corn.map((y) => [y.year, y.buPerAcre]));
    assert.ok(corn[2012] < corn[2011] && corn[2012] < corn[2013], '2012 drought dip');
  });

  test('prices and costs exist for every crop the fields grow', () => {
    const grown = new Set(getFields().flatMap((f) => f.cropHistory.map((h) => h.crop)));
    for (const crop of grown) {
      assert.ok(c.prices[crop] > 0, `price for ${crop}`);
      assert.ok(c.costsPerAcre[crop] > 0, `cost for ${crop}`);
    }
  });
});
