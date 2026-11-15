import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getFields } from '../data/farmData.js';
import { DEMO_FARM } from '../data/demoFarm.js';
import { fieldData } from '../../test/fieldData.mjs';
import { createFakeSupabase, fakeTimers, memoryStorage } from '../../test/fakeSupabase.mjs';
import { makeSnapshot, readSnapshot, summaryOf, SNAPSHOT_VERSION } from './snapshot.js';
import { createLocalStore, LOCAL_KEY } from './localStore.js';
import { createScheduler } from './scheduler.js';
import { farmRow, fieldRow, fieldDataRows, jarRow, planRow, profilePatch, snapshotFromRows, idFrom, stableJson } from './rows.js';
import { createCloud, createSync, isTablesMissing } from './cloudSync.js';

const USER = 'user-1';
// a searched farm (not the demo: the demo farm never goes to the database)
const PLACE = { id: 'p1', kind: 'house', label: '2210 County Rd 9', detail: 'Story County, Iowa', lat: 42.03, lon: -93.6 };
const JAR = { v: 1, fieldId: 'field-2', textureClass: 'Silt loam', sandPct: 20, siltPct: 64, clayPct: 16, confidence: 'ok', layers: [] };

/** The demo fields as the field step makes them, with the data fetched for them and a CDL year. */
function appFields() {
  return getFields().slice(0, 3).map((f, i) => ({
    id: `field-${i + 1}`, name: f.name, autoName: false, geometry: f.geometry, acres: f.acres, source: 'usda', sourceIds: [f.sourceId],
    crops: { ...Object.fromEntries(f.cropHistory.map((c) => [c.year, c.crop])), 2025: 'Corn' }, cdlYears: [2025],
    ...fieldData(f),
    ...(i === 1 ? { jar: JAR } : {}),
  }));
}
const PROFILE = { priorities: ['soil-health', 'profit'], irrigatedFieldIds: ['field-3'], excludedCrops: ['oats'] };
const PLAN = { plan: { sequences: { 'field-1': [{ main: 'corn' }, { main: 'soybean', cover: 'cereal_rye' }, { main: 'corn' }] } }, choice: { 'field-1': 'priority' }, startYear: 2027 };

const snap = (o = {}) => makeSnapshot({ id: 'local-1', farm: PLACE, fields: appFields(), profile: PROFILE, plan: PLAN, picks: { 'field-1': 'priority' }, ...o });

describe('farm snapshots', () => {
  it('round-trip through JSON with only plain data', () => {
    const fields = appFields().map((f) => ({ ...f, draw: () => {} })); // anything else on a field is dropped
    const s = makeSnapshot({ id: 'local-1', farm: PLACE, fields, profile: PROFILE, plan: { ...PLAN, extra: new Map() }, savedAt: new Date('2026-11-15T10:00:00Z') });
    const back = readSnapshot(JSON.stringify(s));
    assert.equal(back.v, SNAPSHOT_VERSION);
    assert.equal(back.savedAt, '2026-11-15T10:00:00.000Z');
    assert.deepEqual(back.farm, PLACE);
    assert.equal(back.fields.length, 3);
    assert.equal(back.fields[0].draw, undefined);
    assert.deepEqual(back.fields[1].jar, JAR);
    assert.deepEqual(back.fields[0].soil, appFields()[0].soil);
    assert.deepEqual(back.profile, PROFILE);
    assert.deepEqual(back.plan, PLAN);
    assert.deepEqual(back, readSnapshot(back));
  });

  it('refuses what it does not understand: other versions, no farm, broken JSON', () => {
    assert.equal(readSnapshot({ ...snap(), v: 2 }), null);
    assert.equal(readSnapshot({ ...snap(), farm: { label: 'x' } }), null);
    assert.equal(readSnapshot('{nope'), null);
    assert.equal(readSnapshot(null), null);
    // a field without an outline is left out rather than breaking the farm
    assert.equal(readSnapshot({ ...snap(), fields: [{ id: 'a', name: 'A' }, ...snap().fields] }).fields.length, 3);
  });

  it('a profile before the check-in stays null, and the summary adds up', () => {
    const s = snap({ profile: null, plan: null });
    assert.equal(s.profile, null);
    assert.equal(s.plan, null);
    const sum = summaryOf(s);
    assert.equal(sum.name, PLACE.label);
    assert.equal(sum.fields, 3);
    assert.equal(sum.acres, Math.round(appFields().reduce((a, f) => a + f.acres, 0)));
    assert.equal(sum.demo, false);
    assert.equal(summaryOf(snap({ farm: DEMO_FARM })).demo, true);
  });
});

describe('the farms kept on this device', () => {
  it('saves, lists newest first, opens the last one and removes', () => {
    const storage = memoryStorage();
    const store = createLocalStore({ storage: () => storage });
    assert.equal(store.current(), null);
    assert.ok(store.put(snap({ id: 'a', savedAt: new Date('2026-11-01') })));
    assert.ok(store.put(snap({ id: 'b', farm: { ...PLACE, label: 'Other farm' }, savedAt: new Date('2026-11-02') })));
    assert.equal(store.current().id, 'b');
    assert.deepEqual(store.list().map((f) => f.id), ['b', 'a']);
    store.put(snap({ id: 'a', savedAt: new Date('2026-11-03') }));
    assert.equal(store.current().id, 'a');
    assert.equal(store.list().length, 2);
    assert.ok(store.remove('a'));
    assert.equal(store.current(), null);
    assert.equal(store.get('b').farm.label, 'Other farm');
    assert.equal(JSON.parse(storage.getItem(LOCAL_KEY)).v, 1);
  });

  it('copes with storage that is missing, throws, or holds junk', () => {
    const throwing = createLocalStore({ storage: () => { throw new Error('SecurityError'); } });
    assert.equal(throwing.current(), null);
    assert.equal(throwing.put(snap()), false);
    assert.deepEqual(throwing.list(), []);
    const storage = memoryStorage();
    storage.setItem(LOCAL_KEY, '{not json');
    const store = createLocalStore({ storage: () => storage });
    assert.equal(store.current(), null);
    assert.ok(store.put(snap()));
    assert.equal(store.current().id, 'local-1');
  });

  it('leaves a newer app version’s save alone', () => {
    const storage = memoryStorage();
    const newer = JSON.stringify({ v: 2, current: 'x', farms: [{ whatever: true }] });
    storage.setItem(LOCAL_KEY, newer);
    const store = createLocalStore({ storage: () => storage });
    assert.equal(store.current(), null);
    assert.equal(store.readOnly, true);
    assert.equal(store.put(snap()), false);
    assert.equal(storage.getItem(LOCAL_KEY), newer);
  });

  it('keeps at most `max` farms, and lets the oldest go when the quota is full', () => {
    const storage = memoryStorage();
    const store = createLocalStore({ storage: () => storage, max: 3 });
    for (let i = 0; i < 5; i++) store.put(snap({ id: `f${i}`, savedAt: new Date(2026, 10, i + 1) }));
    assert.deepEqual(store.list().map((f) => f.id), ['f4', 'f3', 'f2']);
    const one = JSON.stringify({ v: 1, current: 'x', farms: [snap()] }).length;
    const tight = memoryStorage({ quota: one * 2.5 });
    const small = createLocalStore({ storage: () => tight });
    for (let i = 0; i < 4; i++) assert.ok(small.put(snap({ id: `q${i}`, savedAt: new Date(2026, 10, i + 1) })));
    assert.equal(small.current().id, 'q3');
    assert.ok(small.list().length < 4);
  });

  it('changes where a farm lives in the cloud without touching the rest', () => {
    const storage = memoryStorage();
    const store = createLocalStore({ storage: () => storage });
    store.put(snap());
    store.setCloud('local-1', { [USER]: { id: 'c1', synced: true } });
    assert.deepEqual(store.get('local-1').cloud, { [USER]: { id: 'c1', synced: true } });
    assert.equal(store.get('local-1').fields.length, 3);
  });
});

describe('the save scheduler', () => {
  it('turns a burst of changes into one save after a quiet moment', async () => {
    const timers = fakeTimers();
    let runs = 0;
    const s = createScheduler(() => { runs++; }, { delay: 500, timers });
    for (let i = 0; i < 10; i++) { s.schedule(); await timers.tick(100); }
    assert.equal(runs, 0);
    await timers.tick(500);
    assert.equal(runs, 1);
    await timers.tick(10000);
    assert.equal(runs, 1);
  });

  it('retries a failed save with growing waits, then stops when it works', async () => {
    const timers = fakeTimers();
    const at = [];
    let fails = 3;
    let t = 0;
    const s = createScheduler(() => { at.push(t); if (fails-- > 0) throw new Error('offline'); }, { delay: 100, retryBase: 1000, timers });
    s.schedule();
    for (let i = 0; i < 100; i++) { await timers.tick(100); t += 100; }
    assert.equal(at.length, 4); // 3 failures and the save that worked
    assert.deepEqual(at.slice(1).map((x, i) => x - at[i]), [1000, 2000, 4000]);
    assert.equal(s.failures, 0);
    assert.equal(timers.pending, 0);
  });

  it('never runs twice at once: a change during a save makes one more save after it', async () => {
    const timers = fakeTimers();
    let release;
    let running = 0, most = 0, runs = 0;
    const s = createScheduler(async () => { running++; most = Math.max(most, running); runs++; if (runs === 1) await new Promise((r) => { release = r; }); running--; }, { delay: 100, timers });
    s.schedule();
    await timers.tick(100);
    s.schedule(); s.schedule();
    s.flush();
    release();
    await timers.tick(500);
    assert.equal(most, 1);
    assert.equal(runs, 2);
  });

  it('flush saves at once', async () => {
    const timers = fakeTimers();
    let runs = 0;
    const s = createScheduler(() => { runs++; }, { delay: 5000, timers });
    s.schedule();
    await s.flush();
    assert.equal(runs, 1);
    await timers.tick(6000);
    assert.equal(runs, 1);
  });
});

describe('rows for the team’s schema, both ways', () => {
  const s = snap();
  it('farm, fields, field data, jar test, plan and profile', () => {
    assert.deepEqual(farmRow(s, { id: 'c1', ownerId: USER }), { id: 'c1', owner_id: USER, name: PLACE.label, place: PLACE, is_demo: false });
    const f = fieldRow(s.fields[0], { farmId: 'c1', irrigated: false });
    assert.equal(f.app_key, 'field-1');
    assert.equal(f.crops[2025], undefined); // the CDL year goes in field_data, not the field's own history
    assert.ok(Object.keys(f.crops).length > 0);
    assert.deepEqual(f.source_ids, s.fields[0].sourceIds);
    assert.equal(f.acres, Math.round(s.fields[0].acres * 100) / 100);
    assert.equal(fieldRow(s.fields[2], { farmId: 'c1', irrigated: true }).irrigated, true);
    const kinds = fieldDataRows(s.fields[0], 'fid').map((r) => r.kind).sort();
    assert.deepEqual(kinds, ['cdl', 'greenness', 'rain', 'slope', 'soil']);
    assert.deepEqual(fieldDataRows(s.fields[0], 'fid').find((r) => r.kind === 'cdl').data, { crops: { 2025: 'Corn' } });
    assert.deepEqual(fieldDataRows({ id: 'x', geometry: {} }, 'fid'), []); // nothing fetched, nothing stored
    assert.equal(jarRow(s.fields[0], 'fid'), null);
    const j = jarRow(s.fields[1], 'fid');
    assert.equal(j.in_use, true);
    assert.equal(j.id, jarRow(s.fields[1], 'fid').id); // the same jar on the same field is the same row
    assert.notEqual(j.id, jarRow(s.fields[1], 'other').id);
    const p = planRow(s, 'c1');
    assert.equal(p.source, 'saved');
    assert.equal(p.start_year, 2027);
    assert.equal(p.is_current, true);
    assert.equal(planRow({ ...s, plan: { ...s.plan, scores: { expectedGM: 1 } } }, 'c1').id, p.id); // scores don't make a new plan
    assert.equal(planRow({ ...s, plan: { ...s.plan, source: 'built', choice: undefined } }, 'c1').source, 'built');
    assert.deepEqual(profilePatch(PROFILE), { priorities: ['soil-health', 'profit'], excluded_crops: ['oats'] });
    assert.match(idFrom('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it('rows back into the same farm', () => {
    const fields = s.fields.map((f, i) => ({ id: `fid${i}`, created_at: '2026-11-15T00:00:00Z', ...fieldRow(f, { farmId: 'c1', irrigated: PROFILE.irrigatedFieldIds.includes(f.id) }) }));
    const fieldData = s.fields.flatMap((f, i) => fieldDataRows(f, `fid${i}`));
    const jarTests = [
      { ...jarRow({ jar: { ...JAR, sandPct: 50 } }, 'fid1'), in_use: false, created_at: '2026-11-01' }, // an older one, kept as history
      { ...jarRow(s.fields[1], 'fid1'), created_at: '2026-11-02' },
    ];
    const back = snapshotFromRows({
      farm: { id: 'c1', ...farmRow(s, { id: 'c1', ownerId: USER }), updated_at: '2026-11-15T01:00:00Z' },
      fields: [...fields].reverse(), fieldData, jarTests, plan: planRow(s, 'c1'),
      profile: { priorities: PROFILE.priorities, excluded_crops: PROFILE.excludedCrops }, localId: 'local-2', ownerId: USER,
    });
    assert.equal(back.id, 'local-2');
    assert.deepEqual(back.cloud, { [USER]: { id: 'c1', synced: true } });
    assert.deepEqual(back.farm, PLACE);
    assert.deepEqual(back.profile, PROFILE);
    assert.deepEqual(back.plan, PLAN);
    assert.deepEqual(back.picks, PLAN.choice);
    assert.deepEqual(back.fields.map((f) => f.id), ['field-1', 'field-2', 'field-3']);
    const want = (f) => ({ ...f, acres: Math.round(f.acres * 100) / 100 });
    assert.deepEqual(back.fields, s.fields.map(want));
  });
});

describe('crop history edits in the account', () => {
  // field-1 as the farmer left it: 2023 changed, 2025 (a CropScape year) changed, 2021 "not sure"
  const edited = () => {
    const f = appFields()[0];
    const original = { ...f.crops };
    const crops = { ...f.crops, 2023: 'Alfalfa', 2025: 'Soybeans' };
    delete crops[2021];
    return { ...f, crops, cropsOriginal: original, cropsByFarmer: [2021, 2023, 2025], cropsCleared: [2021] };
  };

  it('the farmer’s years go in crops, USDA’s record and the marks in crop_edits, CropScape’s answer in field_data', () => {
    const f = edited();
    const row = fieldRow(f, { farmId: 'c1' });
    assert.equal(row.crops[2023], 'Alfalfa');
    assert.equal(row.crops[2025], 'Soybeans'); // the farmer's, though CropScape filled that year
    assert.equal(row.crops[2021], undefined);
    assert.deepEqual(row.crop_edits, { original: f.cropsOriginal, by_farmer: [2021, 2023, 2025], cleared: [2021] });
    assert.deepEqual(fieldDataRows(f, 'fid').find((r) => r.kind === 'cdl').data, { crops: { 2025: 'Corn' } });
    assert.equal(fieldRow(appFields()[0], { farmId: 'c1' }).crop_edits, null); // nothing edited: nothing stored
  });

  it('come back the same from the rows', () => {
    const f = edited();
    const s = makeSnapshot({ id: 'local-1', farm: PLACE, fields: [f] });
    const back = snapshotFromRows({
      farm: { id: 'c1', ...farmRow(s, { id: 'c1', ownerId: USER }), updated_at: '2026-11-15T01:00:00Z' },
      fields: [{ id: 'fid0', ...fieldRow(s.fields[0], { farmId: 'c1' }) }], fieldData: fieldDataRows(s.fields[0], 'fid0'), localId: 'local-2', ownerId: USER,
    });
    const g = back.fields[0];
    assert.deepEqual(g.crops, s.fields[0].crops);
    assert.deepEqual(g.cropsOriginal, f.cropsOriginal);
    assert.deepEqual(g.cropsByFarmer, [2021, 2023, 2025]);
    assert.deepEqual(g.cropsCleared, [2021]);
    assert.deepEqual(g.cdlYears, [2025]);
  });

  it('a database without the crop_edits column still gets the farmer’s crops', async () => {
    const db = createFakeSupabase({ userId: USER });
    db.noColumns = { fields: ['crop_edits'] };
    const cloud = createCloud(db.client);
    const s = makeSnapshot({ id: 'local-1', farm: PLACE, fields: [edited()], cloud: { [USER]: { id: 'c1' } } });
    const warn = console.warn;
    console.warn = () => {};
    try { await cloud.push(s, USER, new Map()); } finally { console.warn = warn; }
    const row = db.tables.fields[0];
    assert.equal(row.crops[2025], 'Soybeans');
    assert.equal('crop_edits' in row, false);
  });
});

/** A sync on a fake database, with fake timers. */
function setup({ missing = false } = {}) {
  const db = createFakeSupabase({ userId: USER });
  db.missing = missing;
  const timers = fakeTimers();
  const storage = memoryStorage();
  const local = createLocalStore({ storage: () => storage });
  const cloud = createCloud(db.client);
  const statuses = [];
  const sync = createSync({ cloud, local, delay: 1000, retryBase: 2000, timers, onStatus: (s) => statuses.push(s.status), online: () => true });
  return { db, timers, local, cloud, sync, statuses };
}

describe('saving to the account', () => {
  it('first sign-in uploads the farm on this device once, never twice', async () => {
    const { db, timers, local, sync } = setup();
    local.put(snap());
    local.put(snap({ id: 'demo-1', farm: DEMO_FARM })); // the demo farm stays on this device
    db.failNext(2); // the connection drops part way: the retry must not make a second farm
    sync.setUser({ id: USER, email: 'a@example.com' });
    await timers.tick(60000);
    assert.equal(db.tables.farms.length, 1);
    assert.equal(db.tables.farms[0].owner_id, USER);
    assert.equal(db.tables.farms[0].is_demo, false);
    assert.equal(db.tables.fields.length, 3);
    assert.equal(db.tables.field_data.length, 15);
    assert.equal(db.tables.jar_tests.length, 1);
    assert.equal(db.tables.plans.length, 1);
    assert.deepEqual(db.tables.profiles[0].priorities, PROFILE.priorities);
    assert.deepEqual(db.tables.fields.filter((f) => f.irrigated).map((f) => f.app_key), ['field-3']);
    const link = local.get('local-1').cloud[USER];
    assert.equal(link.id, db.tables.farms[0].id);
    assert.equal(link.synced, true);
    assert.equal(sync.status, 'saved');
    // signing out and in again (or a reload) sends nothing new
    const before = db.requests.length;
    sync.setUser(null);
    sync.setUser({ id: USER, email: 'a@example.com' });
    await timers.tick(60000);
    assert.equal(db.requests.length, before);
    assert.equal(db.tables.farms.length, 1);
  });

  it('sends only what changed, debounced, and keeps one current plan and the jar history', async () => {
    const { db, timers, local, sync } = setup();
    local.put(snap());
    sync.setUser({ id: USER, email: 'a@example.com' });
    await timers.tick(10000);
    const n = db.requests.length;
    // a rename, a new jar test, another plan: several quick changes, one push
    let s = local.get('local-1');
    const fields = s.fields.map((f) => (f.id === 'field-1' ? { ...f, name: 'Creek field' } : f.id === 'field-2' ? { ...f, jar: { ...JAR, sandPct: 30 } } : f));
    for (let i = 0; i < 5; i++) {
      local.put({ ...makeSnapshot({ ...s, fields, plan: { ...PLAN, choice: { 'field-1': 'profit' } }, savedAt: new Date(Date.UTC(2026, 10, 16, 0, 0, i)) }) });
      sync.request('local-1');
      await timers.tick(200);
    }
    await timers.tick(5000);
    const sent = db.requests.slice(n);
    assert.ok(sent.length <= 7, `${sent.length} requests`);
    assert.equal(db.tables.fields.find((f) => f.app_key === 'field-1').name, 'Creek field');
    assert.equal(db.tables.jar_tests.length, 2);
    assert.equal(db.tables.jar_tests.filter((j) => j.in_use).length, 1);
    assert.equal(db.tables.jar_tests.find((j) => j.in_use).record.sandPct, 30);
    assert.equal(db.tables.plans.length, 2);
    assert.equal(db.tables.plans.filter((p) => p.is_current).length, 1);
    assert.deepEqual(db.tables.plans.find((p) => p.is_current).choice, { 'field-1': 'profit' });
    // the jar test taken off: none in use, both kept
    s = local.get('local-1');
    local.put(makeSnapshot({ ...s, fields: s.fields.map((f) => ({ ...f, jar: null })), savedAt: new Date(Date.UTC(2026, 10, 17)) }));
    sync.request('local-1');
    await timers.tick(5000);
    assert.equal(db.tables.jar_tests.length, 2);
    assert.equal(db.tables.jar_tests.filter((j) => j.in_use).length, 0);
  });

  it('opens the same farm on another device', async () => {
    const { db, timers, local, cloud, sync } = setup();
    local.put(snap());
    sync.setUser({ id: USER, email: 'a@example.com' });
    await timers.tick(10000);
    const farms = await cloud.listFarms(USER);
    assert.equal(farms.length, 1);
    assert.equal(farms[0].fields, 3);
    const other = await cloud.loadFarm(farms[0].id, USER, { localId: 'device-2' });
    const mine = local.get('local-1');
    assert.equal(other.id, 'device-2');
    assert.deepEqual(other.farm, mine.farm);
    assert.deepEqual(other.profile, mine.profile);
    assert.deepEqual(other.plan, mine.plan);
    assert.deepEqual(other.fields, mine.fields.map((f) => ({ ...f, acres: Math.round(f.acres * 100) / 100 })));
    assert.deepEqual(other.cloud, { [USER]: { id: farms[0].id, synced: true } });
    // pushing it from the second device updates the same farm
    const storage2 = memoryStorage();
    const local2 = createLocalStore({ storage: () => storage2 });
    local2.put(other);
    const sync2 = createSync({ cloud, local: local2, delay: 1000, timers, online: () => true });
    sync2.setUser({ id: USER, email: 'a@example.com' });
    local2.put(makeSnapshot({ ...other, fields: other.fields.map((f) => ({ ...f, name: `${f.name}!` })), savedAt: new Date(Date.UTC(2026, 10, 18)) }));
    sync2.request('device-2');
    await timers.tick(10000);
    assert.equal(db.tables.farms.length, 1);
    assert.equal(db.tables.fields.length, 3);
    assert.ok(db.tables.fields.every((f) => f.name.endsWith('!')));
  });

  it('deleting a farm takes its fields, data, jar tests and plans with it; a copy elsewhere stops syncing', async () => {
    const { db, timers, local, cloud, sync } = setup();
    local.put(snap());
    sync.setUser({ id: USER, email: 'a@example.com' });
    await timers.tick(10000);
    await cloud.deleteFarm(db.tables.farms[0].id);
    for (const t of ['farms', 'fields', 'field_data', 'jar_tests', 'plans']) assert.equal(db.tables[t].length, 0, t);
    // this device still has it and changes it: it isn't brought back
    const s = local.get('local-1');
    local.put(makeSnapshot({ ...s, fields: s.fields.map((f) => ({ ...f, name: 'x' })), savedAt: new Date(Date.UTC(2026, 10, 19)) }));
    sync.request('local-1');
    await timers.tick(10000);
    assert.equal(db.tables.farms.length, 0);
    assert.equal(local.get('local-1').cloud[USER].gone, true);
  });

  it('with the tables missing it stays quiet: one try, then saving on this device only', async () => {
    const { db, timers, local, sync, statuses } = setup({ missing: true });
    local.put(snap());
    sync.setUser({ id: USER, email: 'a@example.com' });
    await timers.tick(10000);
    assert.equal(sync.status, 'no-tables');
    const n = db.requests.length;
    assert.equal(n, 1);
    for (let i = 0; i < 5; i++) { sync.request('local-1'); await timers.tick(5000); }
    assert.equal(db.requests.length, n); // no flood
    assert.ok(local.get('local-1')); // still on this device
    assert.ok(statuses.includes('no-tables'));
    // once the tables are made, a recheck sends what was waiting
    db.missing = false;
    assert.equal(await sync.recheck(), true);
    await timers.tick(10000);
    assert.equal(db.tables.farms.length, 1);
    assert.equal(sync.status, 'saved');
    assert.ok(isTablesMissing({ code: 'PGRST205' }));
  });

  it('signed out, nothing is sent', async () => {
    const { db, timers, local, sync } = setup();
    local.put(snap());
    sync.request('local-1');
    await timers.tick(10000);
    assert.equal(db.requests.length, 0);
    assert.equal(sync.status, 'signed-out');
  });
});
