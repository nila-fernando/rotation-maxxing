// The farmer's chosen fields: one ordered list (the order is the field number), with undo and redo.
//
// Fields are treated as immutable: every change builds new field objects and a new array, so a
// history entry is just the previous array. Cheap, and undo can never half-apply.
//
// A field: { id, name, autoName, geometry, acres, source, sourceIds, crops }
//   name      what the farmer sees ("North field", or whatever they typed)
//   autoName  true while the name is still the one we made up (renaming sets it false)
//   source    'usda' | 'ai' | 'drawn' | 'circle' | 'merged' | 'split'
//   sourceIds the dataset outline ids this field came from (so those outlines show as taken)
//   crops     { "2018": "Corn", ... } from USDA, or null
import { booleanPointInPolygon } from '@turf/turf';
import { acresOf, autoName, labelPoint } from './geometry.js';

const HISTORY_LIMIT = 100;
let nextId = 1;

/**
 * @param {{center: [number, number]}} opts  the farm's [lng, lat], used for names like "North field"
 */
export function createFieldStore({ center }) {
  let fields = [];
  let past = [];
  let future = [];
  const listeners = new Set();

  const emit = (why) => listeners.forEach((fn) => fn(fields, why));
  /** "Home field" for the field the farm pin is in, otherwise by direction: "North field"… */
  const nameFor = (geometry, taken) => autoName(
    booleanPointInPolygon(center, geometry) ? center : labelPoint(geometry), center, taken,
  );
  const names = (except) => fields.filter((f) => f.id !== except).map((f) => f.name);

  function commit(next, why) {
    past.push(fields);
    if (past.length > HISTORY_LIMIT) past.shift();
    future = [];
    fields = next;
    emit(why);
  }

  /** Builds a field object from a shape (not yet in the list). */
  function make({ geometry, source, sourceIds = [], crops = null, name = null }, taken) {
    const auto = !name;
    return {
      id: `field-${nextId++}`, // not "f1": the demo farm data uses f1..f5 for its own fields
      name: name || nameFor(geometry, taken),
      autoName: auto,
      geometry,
      acres: acresOf(geometry),
      source,
      sourceIds,
      crops,
    };
  }

  /** Makes several fields, naming each so none clash with the others or the list. */
  function makeAll(inits, taken = names()) {
    const used = [...taken];
    return inits.map((init) => {
      const f = make(init, used);
      used.push(f.name);
      return f;
    });
  }

  return {
    get fields() { return fields; },
    get(id) { return fields.find((f) => f.id === id) || null; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    get totalAcres() { return fields.reduce((sum, f) => sum + f.acres, 0); },
    /** Outline ids already used by a field. */
    takenSourceIds() {
      const s = new Set();
      fields.forEach((f) => f.sourceIds.forEach((id) => s.add(id)));
      return s;
    },
    numberOf(id) { return fields.findIndex((f) => f.id === id) + 1; },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Adds fields from shapes; returns the new fields. */
    add(inits, why = 'add') {
      const list = Array.isArray(inits) ? inits : [inits];
      if (!list.length) return [];
      const made = makeAll(list);
      commit([...fields, ...made], why);
      return made;
    },

    remove(ids, why = 'remove') {
      const drop = new Set(Array.isArray(ids) ? ids : [ids]);
      if (!fields.some((f) => drop.has(f.id))) return;
      commit(fields.filter((f) => !drop.has(f.id)), why);
    },

    /** Empty or blank name: back to the automatic one. */
    rename(id, name) {
      const f = fields.find((x) => x.id === id);
      if (!f) return;
      const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const next = clean
        ? { ...f, name: clean, autoName: false }
        : { ...f, name: nameFor(f.geometry, names(id)), autoName: true };
      if (next.name === f.name && next.autoName === f.autoName) return;
      commit(fields.map((x) => (x.id === id ? next : x)), 'rename');
    },

    /** A new outline for one field (corner edits). Keeps its number, name and history. */
    reshape(id, geometry) {
      const f = fields.find((x) => x.id === id);
      if (!f) return;
      commit(fields.map((x) => (x.id === id ? { ...f, geometry, acres: acresOf(geometry) } : x)), 'reshape');
    },

    /**
     * Swaps some fields for new ones in one undo step (merge, split). The new fields take the
     * place of the first replaced field in the list. The first new field may keep a name.
     * @returns {object[]} the new fields
     */
    replace(ids, inits, why) {
      const drop = new Set(ids);
      const at = fields.findIndex((f) => drop.has(f.id));
      if (at < 0) return [];
      const kept = fields.filter((f) => !drop.has(f.id));
      const made = makeAll(inits, kept.map((f) => f.name));
      const next = [...kept];
      next.splice(Math.min(at, next.length), 0, ...made);
      commit(next, why);
      return made;
    },

    /**
     * A field's source outline turned out bigger: its other half arrived from the next map tile.
     * Fields still exactly on the old outline take the whole one, in the undo history too, so
     * undo never brings the half back. Not an undo step itself. Returns the fields that grew.
     */
    growFromSource(sourceId, oldGeometry, newGeometry) {
      const grow = (list) => list.map((f) => (
        f.sourceIds.length === 1 && f.sourceIds[0] === sourceId && f.geometry === oldGeometry
          ? { ...f, geometry: newGeometry, acres: acresOf(newGeometry) }
          : f));
      const next = grow(fields);
      const grown = next.filter((f, i) => f !== fields[i]);
      if (!grown.length) return [];
      past = past.map(grow);
      future = future.map(grow);
      fields = next;
      emit('grow');
      return grown;
    },

    undo() {
      if (!past.length) return false;
      future.push(fields);
      fields = past.pop();
      emit('undo');
      return true;
    },

    redo() {
      if (!future.length) return false;
      past.push(fields);
      fields = future.pop();
      emit('redo');
      return true;
    },

    clear() {
      fields = [];
      past = [];
      future = [];
      emit('clear');
    },
  };
}
