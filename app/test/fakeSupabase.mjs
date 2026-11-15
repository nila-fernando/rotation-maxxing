// A small in-memory stand-in for the supabase-js query builder, for the save tests only: the tables
// of supabase/migrations/20261115000000_init.sql with their unique keys and cascades, and the
// filters the app uses. It records every request so tests can count them.
//
//   const db = createFakeSupabase({ userId })
//   db.client.from('farms').select('id').eq('owner_id', id)    (thenable: { data, error })
//   db.tables.farms   db.requests   db.missing = true (PGRST205)   db.failNext(n) (network errors)
//   db.noColumns = { fields: ['crop_edits'] }   a column a later migration adds isn't there yet (PGRST204)
//   db.noTables = ['season_reports']               a table a later migration adds isn't there yet (PGRST205)

const KEYS = {
  farms: ['id'],
  fields: ['farm_id', 'app_key'],
  field_data: ['field_id', 'kind'],
  jar_tests: ['id'],
  plans: ['id'],
  profiles: ['id'],
  season_reports: ['farm_id', 'season'],
};
const CHILDREN = { farms: [['fields', 'farm_id'], ['plans', 'farm_id'], ['season_reports', 'farm_id']], fields: [['field_data', 'field_id'], ['jar_tests', 'field_id']] };
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const clone = (v) => JSON.parse(JSON.stringify(v));

function parseIn(list) {
  const inner = String(list).replace(/^\(|\)$/g, '');
  if (!inner) return [];
  return inner.match(/"(?:[^"\\]|\\.)*"|[^,]+/g).map((s) => (s.startsWith('"') ? JSON.parse(s) : s));
}

export function createFakeSupabase({ userId = 'user-1' } = {}) {
  const tables = { farms: [], fields: [], field_data: [], jar_tests: [], plans: [], season_reports: [], profiles: [{ id: userId, priorities: ['profit'], excluded_crops: [] }] };
  const db = { tables, requests: [], missing: false, failures: 0, clock: 0, noColumns: {}, noTables: [] };
  db.failNext = (n = 1) => { db.failures = n; };
  const now = () => new Date(Date.UTC(2026, 10, 15, 12, 0, db.clock++)).toISOString();

  function remove(table, rows) {
    for (const r of rows) {
      tables[table].splice(tables[table].indexOf(r), 1);
      for (const [child, fk] of CHILDREN[table] || []) remove(child, tables[child].filter((c) => c[fk] === r.id));
    }
  }

  function builder(table) {
    const q = { table, op: 'select', filters: [], limit: null, order: null, returning: false };
    const api = {
      select(cols) { if (q.op === 'select') q.cols = cols; else q.returning = true; return api; },
      insert(rows) { q.op = 'insert'; q.rows = [].concat(rows); return api; },
      upsert(rows, { onConflict } = {}) { q.op = 'upsert'; q.rows = [].concat(rows); q.onConflict = onConflict; return api; },
      update(patch) { q.op = 'update'; q.patch = patch; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(c, v) { q.filters.push((r) => r[c] === v); return api; },
      neq(c, v) { q.filters.push((r) => r[c] !== v); return api; },
      in(c, vs) { q.filters.push((r) => vs.includes(r[c])); return api; },
      not(c, op, v) { if (op !== 'in') throw new Error(`fake: not ${op}`); const vs = parseIn(v); q.filters.push((r) => !vs.includes(String(r[c]))); return api; },
      order(c, { ascending = true } = {}) { q.order = [c, ascending]; return api; },
      limit(n) { q.limit = n; return api; },
      then(ok, bad) { return Promise.resolve().then(run).then(ok, bad); },
    };
    function run() {
      db.requests.push({ table, op: q.op });
      if (db.failures > 0) { db.failures--; return { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }; }
      if (db.missing || db.noTables.includes(table)) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } };
      const rows = tables[table];
      const match = () => rows.filter((r) => q.filters.every((f) => f(r)));
      if (q.op === 'select') {
        let out = match();
        if (q.order) { const [c, asc] = q.order; out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)); }
        if (q.limit != null) out = out.slice(0, q.limit);
        return { data: clone(out), error: null };
      }
      if (q.op === 'insert' || q.op === 'upsert') {
        const gone = (db.noColumns[table] || []).find((c) => q.rows.some((r) => c in r));
        if (gone) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${gone}' column of '${table}' in the schema cache` } };
        const keys = q.onConflict ? q.onConflict.split(',') : KEYS[table];
        const out = [];
        // foreign keys (and RLS's owns_farm / owns_field, which fail the same way for a deleted farm)
        const parent = { fields: ['farms', 'farm_id'], plans: ['farms', 'farm_id'], field_data: ['fields', 'field_id'], jar_tests: ['fields', 'field_id'], season_reports: ['farms', 'farm_id'] }[table];
        if (parent && q.rows.some((r) => !tables[parent[0]].some((p) => p.id === r[parent[1]]))) {
          return { data: null, error: { code: '42501', message: `new row violates row-level security policy for table "${table}"` } };
        }
        for (const raw of q.rows) {
          const hit = q.op === 'upsert' ? rows.find((r) => keys.every((k) => r[k] === raw[k])) : null;
          if (hit) { Object.assign(hit, clone(raw), table === 'farms' || table === 'fields' ? { updated_at: now() } : {}); out.push(hit); continue; }
          const row = { ...(table !== 'field_data' && !raw.id ? { id: uuid() } : {}), created_at: now(), ...clone(raw) };
          if (table === 'farms' || table === 'fields') row.updated_at = row.created_at;
          // the unique keys and "one current plan per farm" (plans_one_current)
          if (rows.some((r) => KEYS[table].every((k) => r[k] === row[k]))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          if (table === 'fields' && rows.some((r) => r.farm_id === row.farm_id && r.app_key === row.app_key)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          if (table === 'plans' && row.is_current && rows.some((r) => r.farm_id === row.farm_id && r.is_current)) return { data: null, error: { code: '23505', message: 'plans_one_current' } };
          rows.push(row);
          out.push(row);
        }
        if (table === 'plans' && new Set(rows.filter((r) => r.is_current).map((r) => r.farm_id)).size !== rows.filter((r) => r.is_current).length) {
          return { data: null, error: { code: '23505', message: 'plans_one_current' } };
        }
        return { data: q.returning ? clone(out) : null, error: null };
      }
      if (q.op === 'update') {
        const hit = match();
        for (const r of hit) Object.assign(r, clone(q.patch), table === 'farms' || table === 'fields' ? { updated_at: now() } : {});
        if (table === 'plans' && new Set(rows.filter((r) => r.is_current).map((r) => r.farm_id)).size !== rows.filter((r) => r.is_current).length) {
          return { data: null, error: { code: '23505', message: 'plans_one_current' } };
        }
        return { data: q.returning ? clone(hit) : null, error: null };
      }
      if (q.op === 'delete') {
        remove(table, match());
        return { data: null, error: null };
      }
      throw new Error(`fake: ${q.op}`);
    }
    return api;
  }

  db.client = { from: (t) => { if (!(t in tables)) throw new Error(`fake: no table ${t}`); return builder(t); } };
  return db;
}

/** Fake timers: nothing runs until tick(ms). */
export function fakeTimers() {
  let t = 0;
  let id = 0;
  const due = new Map();
  return {
    setTimeout(fn, ms) { due.set(++id, { at: t + ms, fn }); return id; },
    clearTimeout(i) { due.delete(i); },
    async tick(ms) {
      const end = t + ms;
      const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
      for (;;) {
        await settle();
        const next = [...due.entries()].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
      await settle();
    },
    get pending() { return due.size; },
  };
}

/** An in-memory localStorage. */
export function memoryStorage({ quota = Infinity } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    get size() { return m.size; },
  };
}
