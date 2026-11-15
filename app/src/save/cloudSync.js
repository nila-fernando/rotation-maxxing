// The farmer's farms in their account (Supabase, the team's schema in supabase/migrations), on top of
// the copy kept on this device (src/save/localStore.js), which is always saved first.
//
//   const cloud = createCloud(client)           the requests: list, load, delete, push one farm
//   const sync = createSync({ cloud, local })   when to push: debounced, retried, one farm at a time
//   sync.setUser(user)   signed in: every farm on this device goes up once (never twice)
//   sync.request(localId)   that farm changed on this device
//
// The tables may not exist yet (PGRST205): then nothing is sent again until sync.recheck(), and the
// farm keeps saving on this device. The demo farm is never stored in the database (the team's rule,
// supabase/README.md): it stays on this device.
import { farmRow, fieldRow, fieldDataRows, jarRow, planRow, profilePatch, irrigatedOf, snapshotFromRows, stableJson, newId } from './rows.js';
import { createScheduler } from './scheduler.js';

/** PostgREST / Postgres codes for "that table isn't there". */
const MISSING = new Set(['PGRST205', '42P01']);
export const isTablesMissing = (e) => MISSING.has(e?.code);
/** Row-level security or a foreign key said no. */
const DENIED = new Set(['42501', '23503']);
/** A request that never reached the server (offline, DNS, CORS, a dropped connection). */
export const isNetworkError = (e) => !e?.code && /fetch|network|load failed|timed? ?out/i.test(String(e?.message || e));

export class CloudError extends Error {
  constructor(err) {
    super(err?.message || String(err));
    this.code = err?.code || '';
    this.details = err?.details;
  }
}

/** "That column isn't in the table": the crop_edits column (a later migration) may not be added yet. */
const isMissingColumn = (e, col) => (e?.code === 'PGRST204' || e?.code === '42703') && String(e?.message || '').includes(col);

const must = (res) => {
  if (res?.error) throw new CloudError(res.error);
  return res?.data ?? [];
};
const inList = (vals) => `(${vals.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;

/**
 * The requests, on a supabase-js client (or anything with the same from()/select/upsert shape).
 */
export function createCloud(client) {
  const from = (t) => client.from(t);
  let noCropEdits = false; // the fields table has no crop_edits column (yet): send fields without it

  /** Whether the tables are there (a cheap read; RLS returns nothing to others). */
  async function probe() {
    must(await from('farms').select('id').limit(1));
    return true;
  }

  /** The signed-in farmer's farms, newest first: { id, name, place, isDemo, updatedAt, fields, acres }. */
  async function listFarms(userId) {
    const farms = must(await from('farms').select('id,name,place,is_demo,updated_at').eq('owner_id', userId).order('updated_at', { ascending: false }));
    if (!farms.length) return [];
    const fields = must(await from('fields').select('farm_id,acres').in('farm_id', farms.map((f) => f.id)));
    return farms.map((f) => {
      const mine = fields.filter((x) => x.farm_id === f.id);
      return {
        id: f.id, name: f.name, place: f.place, isDemo: f.is_demo, updatedAt: f.updated_at,
        fields: mine.length, acres: Math.round(mine.reduce((a, x) => a + (Number(x.acres) || 0), 0)),
      };
    });
  }

  /** A farm from the account as a snapshot (a new local id; it remembers its cloud row). */
  async function loadFarm(farmId, userId, { localId = newId() } = {}) {
    const [farm] = must(await from('farms').select('*').eq('id', farmId).limit(1));
    if (!farm) return null;
    const fields = must(await from('fields').select('*').eq('farm_id', farmId));
    const ids = fields.map((f) => f.id);
    const [fieldData, jarTests] = ids.length
      ? await Promise.all([
        from('field_data').select('*').in('field_id', ids).then(must),
        from('jar_tests').select('*').in('field_id', ids).eq('in_use', true).then(must),
      ])
      : [[], []];
    const [plan] = must(await from('plans').select('*').eq('farm_id', farmId).eq('is_current', true).limit(1));
    const [profile] = must(await from('profiles').select('priorities,excluded_crops').eq('id', userId).limit(1));
    return snapshotFromRows({ farm, fields, fieldData, jarTests, plan: plan || null, profile: profile || null, localId, ownerId: userId });
  }

  /** Whether the farm is still in the account. */
  async function exists(farmId) {
    return must(await from('farms').select('id').eq('id', farmId).limit(1)).length > 0;
  }

  /** Deletes a farm; its fields, field data, jar tests and plans go with it (on delete cascade). */
  async function deleteFarm(farmId) {
    must(await from('farms').delete().eq('id', farmId));
  }

  /**
   * Sends what changed in one farm since the last push in this session (memo remembers what was
   * sent). The farm's cloud id is already in snap.cloud[userId] (chosen before the first push, so a
   * retry never makes a second farm).
   * @returns {Promise<{ farmId: string, gone?: boolean }>}  gone: the farm was deleted from the account elsewhere
   */
  async function push(snap, userId, memo) {
    const link = snap.cloud?.[userId];
    if (!link?.id) throw new Error('push: the farm has no cloud id yet');
    const farmId = link.id;

    // the farm
    const fr = farmRow(snap, { id: farmId, ownerId: userId });
    const fs = stableJson(fr);
    if (memo.get('farm') !== fs) {
      if (link.synced) {
        // it was uploaded before: update it, and if it's no longer there it was deleted elsewhere
        const { id, owner_id: _o, ...patch } = fr;
        const rows = must(await from('farms').update(patch).eq('id', id).select('id'));
        if (!rows.length) return { farmId, gone: true };
      } else {
        must(await from('farms').upsert(fr, { onConflict: 'id' }));
      }
      memo.set('farm', fs);
    }

    // its fields (the farm_id + app_key pair is unique, so a field is updated, never doubled)
    const irrigated = irrigatedOf(snap);
    const rows = snap.fields.map((f) => {
      const r = fieldRow(f, { farmId, irrigated: irrigated.has(f.id) });
      if (noCropEdits) delete r.crop_edits;
      return r;
    });
    const ids = memo.get('fieldIds') || new Map();
    const changed = rows.filter((r) => !ids.has(r.app_key) || memo.get(`field:${r.app_key}`) !== stableJson(r));
    if (changed.length) {
      let back;
      try {
        back = must(await from('fields').upsert(changed, { onConflict: 'farm_id,app_key' }).select('id,app_key'));
      } catch (e) {
        if (noCropEdits || !isMissingColumn(e, 'crop_edits')) throw e;
        // the database hasn't had the crop_edits migration yet: the farmer's crops still go up (in
        // crops), only which years were theirs is left on this device
        console.warn('fields.crop_edits is missing: run supabase/migrations/20261116000000_field_crop_edits.sql');
        noCropEdits = true;
        for (const r of changed) delete r.crop_edits;
        back = must(await from('fields').upsert(changed, { onConflict: 'farm_id,app_key' }).select('id,app_key'));
      }
      for (const b of back) ids.set(b.app_key, b.id);
      for (const r of changed) memo.set(`field:${r.app_key}`, stableJson(r));
      memo.set('fieldIds', ids);
    }
    if (!memo.get('pruned') && rows.length) {
      // fields no longer on the farm (once per session is enough: the hub can't remove fields)
      must(await from('fields').delete().eq('farm_id', farmId).not('app_key', 'in', inList(rows.map((r) => r.app_key))));
      memo.set('pruned', true);
    }

    // the data fetched for each field: one row per kind, only the ones that changed
    const data = snap.fields.flatMap((f) => (ids.has(f.id) ? fieldDataRows(f, ids.get(f.id)) : []));
    const freshData = data.filter((r) => memo.get(`data:${r.field_id}:${r.kind}`) !== stableJson(r.data));
    if (freshData.length) {
      const at = new Date().toISOString();
      must(await from('field_data').upsert(freshData.map((r) => ({ ...r, fetched_at: at })), { onConflict: 'field_id,kind' }));
      for (const r of freshData) memo.set(`data:${r.field_id}:${r.kind}`, stableJson(r.data));
    }

    // jar tests: earlier ones stay (history), only the one on the field now is in use
    const jars = snap.fields.filter((f) => ids.has(f.id)).map((f) => ({ fid: ids.get(f.id), row: jarRow(f, ids.get(f.id)) }));
    const jarChanged = jars.filter((j) => memo.get(`jar:${j.fid}`) !== (j.row?.id ?? 'none'));
    const off = jarChanged.filter((j) => !j.row);
    const on = jarChanged.filter((j) => j.row);
    if (off.length) must(await from('jar_tests').update({ in_use: false }).in('field_id', off.map((j) => j.fid)).eq('in_use', true));
    if (on.length) {
      must(await from('jar_tests').update({ in_use: false }).in('field_id', on.map((j) => j.fid)).eq('in_use', true).not('id', 'in', inList(on.map((j) => j.row.id))));
      must(await from('jar_tests').upsert(on.map((j) => j.row), { onConflict: 'id' }));
    }
    for (const j of jarChanged) memo.set(`jar:${j.fid}`, j.row?.id ?? 'none');

    // the saved plan: the old current one steps down first (one current plan per farm)
    const pr = planRow(snap, farmId);
    const ps = pr ? stableJson(pr) : 'none';
    if (memo.get('plan') !== ps) {
      if (pr) {
        must(await from('plans').update({ is_current: false }).eq('farm_id', farmId).eq('is_current', true).neq('id', pr.id));
        must(await from('plans').upsert(pr, { onConflict: 'id' }));
      } else if (memo.has('plan')) {
        must(await from('plans').update({ is_current: false }).eq('farm_id', farmId).eq('is_current', true));
      }
      memo.set('plan', ps);
    }

    // the check-in's answers (per person; the profile row is made when they sign up)
    const pp = profilePatch(snap.profile);
    if (pp && memo.get('profile') !== stableJson(pp)) {
      must(await from('profiles').update(pp).eq('id', userId));
      memo.set('profile', stableJson(pp));
    }
    return { farmId };
  }

  return { probe, listFarms, loadFarm, deleteFarm, exists, push };
}

/**
 * When to push: after a quiet moment, one farm at a time, retried with growing waits when the
 * connection drops, and not at all while the tables are missing.
 * @param {{ cloud: ReturnType<typeof createCloud>, local: object, delay?: number, timers?: object,
 *   retryBase?: number, onStatus?: (s: object) => void, online?: () => boolean }} o
 */
export function createSync({ cloud, local, delay = 2500, timers = globalThis, retryBase = 4000, onStatus = () => {}, online = () => globalThis.navigator?.onLine !== false }) {
  let user = null;
  let status = 'signed-out'; // 'signed-out' | 'idle' | 'saving' | 'saved' | 'offline' | 'error' | 'no-tables'
  let savedAt = null;
  const pending = new Set(); // local farm ids waiting to go up
  const memos = new Map(); // cloud farm id -> what was sent this session

  const set = (s) => { status = s; onStatus({ status, savedAt, user }); };
  const eligible = (snap) => !!snap && !snap.farm?.demo && snap.fields.length > 0;

  const scheduler = createScheduler(run, { delay, timers, retryBase, onError: (e) => set(!online() || isNetworkError(e) ? 'offline' : 'error') });

  async function run() {
    if (!user || status === 'no-tables') return;
    const uid = user.id;
    for (const id of [...pending]) {
      if (user?.id !== uid) return; // signed out (or someone else signed in) meanwhile
      let snap = local.get(id);
      if (!eligible(snap)) { pending.delete(id); continue; }
      let link = snap.cloud?.[uid];
      if (link?.gone) { pending.delete(id); continue; }
      if (!link?.id) {
        // the farm's cloud id is chosen and kept on this device before anything is sent
        link = { id: newId() };
        const cloudMap = { ...snap.cloud, [uid]: link };
        local.setCloud(id, cloudMap);
        snap = { ...snap, cloud: cloudMap };
      }
      set('saving');
      if (!memos.has(link.id)) memos.set(link.id, new Map());
      let res;
      try {
        res = await cloud.push(snap, uid, memos.get(link.id));
      } catch (e) {
        if (isTablesMissing(e)) { set('no-tables'); return; }
        // refused by row-level security or a foreign key: the farm was deleted from the account elsewhere
        if (DENIED.has(e?.code) && link.synced && !(await cloud.exists(link.id))) res = { farmId: link.id, gone: true };
        else throw e; // the scheduler tries again later
      }
      const now = local.get(id);
      if (now) {
        if (res.gone) local.setCloud(id, { ...now.cloud, [uid]: { ...link, gone: true } });
        else if (!link.synced) local.setCloud(id, { ...now.cloud, [uid]: { ...link, synced: true } });
      }
      // (a newer change to this farm while it was sending is picked up by the next run)
      if (!res.gone && now && now.savedAt !== snap.savedAt) continue;
      pending.delete(id);
    }
    savedAt = new Date();
    set('saved');
  }

  return {
    get status() { return status; },
    get user() { return user; },
    get savedAt() { return savedAt; },
    /** Signed in (or out, with null). Signing in sends every farm on this device that isn't there yet. */
    setUser(next) {
      const same = user?.id === next?.id;
      user = next ? { id: next.id, email: next.email } : null;
      if (!user) { pending.clear(); memos.clear(); scheduler.cancel(); set('signed-out'); return; }
      if (same) return;
      memos.clear();
      set('idle');
      for (const snap of local.all()) {
        const link = snap.cloud?.[user.id];
        if (eligible(snap) && !link?.gone && !link?.synced) pending.add(snap.id);
      }
      if (pending.size) scheduler.flush();
    },
    /** A farm changed on this device. */
    request(localId) {
      if (!user || !localId) return;
      pending.add(localId);
      if (status !== 'no-tables') scheduler.schedule();
    },
    /** Push now (the connection came back, the page is being hidden). */
    flush() { if (user && pending.size && status !== 'no-tables') return scheduler.flush(); return Promise.resolve(); },
    /** Look again for the tables (when the account panel opens, say); pushes what's waiting if they're there. */
    async recheck() {
      if (!user) return false;
      try {
        await cloud.probe();
      } catch (e) {
        if (isTablesMissing(e)) { set('no-tables'); return false; }
        set(!online() || isNetworkError(e) ? 'offline' : 'error');
        return false;
      }
      if (status === 'no-tables' || status === 'error' || status === 'offline') set('idle');
      if (pending.size) scheduler.flush();
      return true;
    },
    /** Whether a farm can go to the account at all (the demo farm and an empty farm can't). */
    eligible,
  };
}
