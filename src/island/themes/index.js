// Festival themes: the whole farm dressed for Easter, the Fourth of July, Halloween, Thanksgiving,
// Christmas or New Year. Each festival is its own module (./easter.js, ...) that builds its things
// all over the island (fences, gates, buildings, trees, paths, the barn), on top of the barnyard
// decorations in ../decor.js and the festival's sky and light in ../seasons.js. The theme follows the
// calendar (src/island/timeline.js occasionOn) unless the farmer picks one in the time and season
// popover (src/screens/timeTravel.js).
//
//   const themes = createThemes(view, { attach })
//   themes.setTheme('halloween' | ... | null)
//   themes.update(dt, time, { night })   every frame
//   themes.snap()    (arrive or leave at once)   themes.dispose()
//
// ---------------------------------------------------------------- the module contract
// A theme module's default export is build(ctx) -> {
//   root,        a THREE.Group in island space. Each top-level child is one placed thing, at its
//                own spot (y from ctx.heightAt), at the scale it should end up: the manager pops each
//                one in (scale from 0, one after another) and out. A child with userData.noPop = true
//                (an InstancedMesh spread over the island, say) is only shown and hidden; the module
//                can fade it itself with `k` in update.
//   barnBits?,   a THREE.Group in the barn's own space (door faces +z; eaves at y 1.28 along z 0.99,
//                x -1.33..1.33; ridge at y 2.27; gable ends at x ±1.38), shown and hidden with the theme
//   update(dt, time, { night, k }),   every frame while shown. night 0 day..1 night; k 0..1 how far in
//                the theme is (it eases in and out). With ctx.reduced(): no motion (time is held).
//   lampColors?, [hex, ...]: the farm's lamps take these in turn while the theme is on
//   setYear?(year), the farm year on show (a festival can show it, like New Year's sign)
//   sheepWear?(i) -> THREE.Object3D, a costume for sheep number i (a hat, ears, a scarf...): the
//                manager puts one on every sheep. World units; origin = the top of the sheep's head
//                (between the ears), +y up, +z the way the sheep faces. The head is about 0.2 wide and
//                0.18 deep; the ear tips stick out ~0.1 either side just below the origin. Keep it
//                light (a few meshes, shared materials) and give it userData.update?(time, night)
//                for a little motion or glow.
//   dispose?(),
// }
// Rules: no DOM or canvas (plain geometry and colours, so it runs in tests), no new lights (each
// would rebuild every shader on the island), InstancedMesh for anything repeated more than a few
// times, and nothing on top of a field, a building, a pad or a sheep (use ctx.spots / ctx.free).
import * as THREE from 'three';
import buildEaster from './easter.js';
import buildIndependence from './independence.js';
import buildHalloween from './halloween.js';
import buildThanksgiving from './thanksgiving.js';
import buildChristmas from './christmas.js';
import buildNewYear from './newyear.js';
import { costumeFor } from './costumes.js';
import { hitsProp, shrunk } from '../clearance.js';

export const THEMES = ['easter', 'independence', 'halloween', 'thanksgiving', 'christmas', 'newyear'];
export const THEME_NAMES = { easter: 'Easter', independence: 'July 4th', halloween: 'Halloween', thanksgiving: 'Thanksgiving', christmas: 'Christmas', newyear: 'New Year' };
/** The season each festival falls in (picking a theme shows the farm in it). */
export const THEME_SEASON = { easter: 'spring', independence: 'summer', halloween: 'fall', thanksgiving: 'fall', christmas: 'winter', newyear: 'winter' };
const BUILDERS = { easter: buildEaster, independence: buildIndependence, halloween: buildHalloween, thanksgiving: buildThanksgiving, christmas: buildChristmas, newyear: buildNewYear };

const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * What a theme module gets to work with (all positions in island space: x east, z south, y up;
 * the camera looks from +z, so the front of things faces +z).
 */
export function makeThemeContext(view, { attach, reduced = () => false } = {}) {
  const heightAt = view.heightAt;
  const home = view.farmstead?.yard?.at || view.farmstead?.at || [view.center?.x || 0, view.center?.z || 0];
  const center = [view.center?.x || 0, view.center?.z || 0];
  const f = view.terrainField || {};
  const taken = [];
  const blocked = [];
  const centroid = (ring) => ring.reduce((a, [x, z]) => [a[0] + x / ring.length, a[1] + z / ring.length], [0, 0]);
  const area = (ring) => Math.abs(ring.reduce((s, [x, z], i) => { const [x2, z2] = ring[(i + 1) % ring.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
  const fields = (view.fields || []).map((fl) => {
    // the biggest part first (the main parcel of a field in several pieces)
    const rings = (fl.polygons || []).map((p) => p[0]).filter((r) => r?.length >= 3).sort((a, b) => area(b) - area(a));
    return {
      id: fl.id, ring: rings[0], rings, topY: fl.topY, fenceY: fl.topY + 0.3, gate: fl.paddock?.userData?.gate || null,
      center: rings[0] ? centroid(rings[0]) : center,
      fenced: !fl.paddock?.userData?.isPivot, // a centre-pivot circle has no fence (nothing hangs on it)
    };
  });
  const props = (view.props || []).slice();
  const fieldAt = (x, z, pad) => fields.find((fl) => fl.rings.some((ring) => {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    if (ins) return true;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const dx = bx - ax, dz = bz - az, t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1));
      if (Math.hypot(x - ax - t * dx, z - az - t * dz) < pad) return true;
    }
    return false;
  })) || null;
  const inField = (x, z, pad) => !!fieldAt(x, z, pad);

  /** Open grass at (x, z) for something of radius r: off fields, buildings, pads, sheep and other things. */
  function free(x, z, r = 0.2) {
    if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + r + 0.08)) return false;
    if (view.flock?.walkable && !view.flock.walkable(x, z, null, r * 2)) return false;
    if (view.flock?.sheep?.some((sh) => Math.hypot(sh.g.position.x - x, sh.g.position.z - z) < r + 0.25 + sh.size * 0.6)) return false;
    if (view.slots?.some((sl) => sl.kind !== 'tree' && Math.hypot(sl.at[0] - x, sl.at[1] - z) < sl.r + r + 0.1)) return false;
    if ((view.obstacles || []).some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.05)) return false;
    if (inField(x, z, r + 0.15)) return false;
    return true;
  }
  /** Marks a spot as used; block: the sheep walk round it too (undone when the theme module is disposed). */
  function take(x, z, r = 0.2, { block = true } = {}) {
    taken.push({ x, z, r });
    if (block && view.obstacles) { const o = { x, z, r }; view.obstacles.push(o); blocked.push(o); }
  }
  /**
   * Up to n free spots on rings out from `around` (the farmyard), nearest and frontmost first, at
   * least `spacing` apart; each one taken (and blocked for the sheep unless block: false).
   */
  function spots(n, { r = 0.25, from = 1.4, to = 6.5, spacing = 0.9, around = home, block = true, front = 0.3 } = {}) {
    const cands = [];
    for (let d = from; d <= to; d += 0.3) {
      const k = Math.max(6, Math.round(d * 7));
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2 + d;
        const x = around[0] + Math.cos(a) * d, z = around[1] + Math.sin(a) * d;
        cands.push({ x, z, score: d - (z - around[1]) * front });
      }
    }
    cands.sort((a, b) => a.score - b.score);
    const out = [];
    for (const c of cands) {
      if (out.length >= n) break;
      if (out.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < spacing)) continue;
      if (!free(c.x, c.z, r)) continue;
      take(c.x, c.z, r, { block });
      out.push([c.x, c.z]);
    }
    return out;
  }
  /** Up to n free spots along the edges of the trodden paths round the flats, nearest the farmyard first. */
  function pathSpots(n, { r = 0.15, spacing = 1.2, block = true } = {}) {
    if (!f.pathMask) return spots(n, { r, spacing, block });
    const R = f.maxCoast || view.radius || 7;
    const cands = [];
    for (let x = center[0] - R; x <= center[0] + R; x += 0.25) for (let z = center[1] - R; z <= center[1] + R; z += 0.25) {
      const p = f.pathMask(x, z);
      if (p > 0.1 && p < 0.55) cands.push({ x, z, d: Math.hypot(x - home[0], z - home[1]) });
    }
    cands.sort((a, b) => a.d - b.d);
    const out = [];
    for (const c of cands) {
      if (out.length >= n) break;
      if (out.some(([x, z]) => Math.hypot(x - c.x, z - c.z) < spacing)) continue;
      if (!free(c.x, c.z, r)) continue;
      take(c.x, c.z, r, { block });
      out.push([c.x, c.z]);
    }
    return out;
  }
  /**
   * Points [x, y, z] round a field's fence at its top rail (outset: a little outside it), closed,
   * every `step` or so: for lights or bunting along the fences.
   */
  function fenceLine(field, { outset = 0.05, step = 0.5, lift = 0, ring = field.ring } = {}) {
    if (!ring || field.fenced === false) return []; // (a pivot circle has no fence to hang things on)
    const [cx, cz] = ring === field.ring ? field.center : centroid(ring);
    const out = [];
    for (let i = 0; i <= ring.length; i++) {
      const [ax, az] = ring[i % ring.length], [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      const k = Math.max(1, Math.round(len / step));
      for (let s = 0; s < (i === ring.length ? 1 : k); s++) {
        const t = s / k, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const d = Math.hypot(x - cx, z - cz) || 1;
        out.push([x + ((x - cx) / d) * outset, field.fenceY + lift, z + ((z - cz) / d) * outset]);
      }
    }
    return out;
  }
  const trees = props.filter((p) => p.key === 'tree' || p.key === 'pine');
  const buildings = props.filter((p) => !['tree', 'pine', 'lampPost', 'hayBale'].includes(p.key));
  return {
    view, heightAt, home, center, radius: view.radius || 7, scale: view.barnScale || 0.75,
    fields, props, trees, buildings, lamps: view.lamps || [],
    barn: view.barn ? { obj: view.barn, at: view.farmstead?.at || home, facing: view.farmstead?.facing || 0 } : null,
    free, take, spots, pathSpots, fenceLine, attach, reduced, inField, fieldAt,
    /** The spots this context blocked for the sheep (the clearance check leaves them out). */
    get blocked() { return blocked; },
    /** Lets the sheep through this theme's spots again (it's switched off); reblock() undoes it. */
    release() {
      for (const o of blocked) { const i = view.obstacles?.indexOf(o) ?? -1; if (i >= 0) view.obstacles.splice(i, 1); }
    },
    reblock() {
      for (const o of blocked) if (view.obstacles && !view.obstacles.includes(o)) view.obstacles.push(o);
    },
    /** Forget everything (disposed). */
    clear() {
      this.release();
      blocked.length = 0;
      taken.length = 0;
    },
  };
}

// ---------------------------------------------------------------- nothing clips into anything
//
// After a theme is built, each thing it placed is measured against the real shapes on the island:
// every prop (buildings, the windmill and its sails, trees, lamps, by their own rotated boxes), the
// fields (up to the fence tops), the barnyard decorations and the things already kept. Whatever
// would overlap is left out. Things deliberately on a fence or a building (onFence / onBuilding)
// and island-wide sets (noPop) are the module's own business.
// (the boxes are measured by src/island/clearance.js: each is taken a tenth in from every side
// first, so touching is fine)

/**
 * Leaves out of `root` every free-standing thing that would clip into the island's props, the
 * fields, the barnyard decorations (round obstacles not blocked by this theme) or an earlier kept
 * thing. Returns how many were left out.
 */
export function clearClipping(root, ctx, { obstacles = [] } = {}) {
  root.updateMatrixWorld(true);
  const kept = [];
  const own = new Set(ctx.blocked);
  const others = obstacles.filter((o) => !own.has(o) && !(ctx.props || []).some((p) => Math.abs(p.x - o.x) < 1e-6 && Math.abs(p.z - o.z) < 1e-6));
  let dropped = 0;
  for (const o of [...root.children]) {
    const u = o.userData;
    if (u.noPop || u.onFence || u.onBuilding) continue;
    const raw = new THREE.Box3().setFromObject(o);
    if (raw.isEmpty()) continue;
    const box = shrunk(raw);
    let hit = (ctx.props || []).some((p) => hitsProp(box, p));
    // in a field, below its fence tops (a ghost may float over one): any of nine points over the footprint
    for (const fx of [0, 0.5, 1]) {
      if (hit) break;
      for (const fz of [0, 0.5, 1]) {
        const fl = ctx.fieldAt(box.min.x + (box.max.x - box.min.x) * fx, box.min.z + (box.max.z - box.min.z) * fz, 0.02);
        if (fl && box.min.y < fl.fenceY + 0.05) { hit = true; break; }
      }
    }
    // a barnyard decoration's spot
    if (!hit) hit = others.some((ob) => {
      const nx = Math.max(box.min.x, Math.min(ob.x, box.max.x)), nz = Math.max(box.min.z, Math.min(ob.z, box.max.z));
      return Math.hypot(nx - ob.x, nz - ob.z) < ob.r * 0.85;
    });
    // something of ours already there
    if (!hit) hit = kept.some((k) => k.intersectsBox(box));
    if (hit) { root.remove(o); dropped++; continue; }
    kept.push(box);
  }
  return dropped;
}

/**
 * @param {object} view   the reveal's view
 * @param {object} [o]
 * @param {(o: THREE.Object3D) => void} [o.attach]   the seasons' material patch (snow on things)
 */
export function createThemes(view, { attach } = {}) {
  const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!reducedQuery?.matches;
  const host = new THREE.Group();
  host.name = 'Festival themes';
  view.island.add(host);
  const built = {}; // key -> { api, k, items: [{ o, full, delay }] }
  let want = null;
  const lampDefaults = (view.lamps || []).map((l) => ({ glass: l.glass.material.color.getHex(), emissive: l.glass.material.emissive.getHex(), halo: l.halo.material.color.getHex(), pool: l.pool.material.color.getHex() }));
  let lampTheme = null;

  function build(key) {
    if (built[key]) return built[key];
    // each theme keeps its own spots (so one switched off stops blocking the sheep)
    const ctx = makeThemeContext(view, { attach, reduced });
    const api = BUILDERS[key](ctx);
    api.root.name = `${key} theme`;
    host.add(api.root);
    // nothing may clip into anything: what would is left out
    const dropped = clearClipping(api.root, ctx, { obstacles: view.obstacles || [] });
    if (dropped && typeof import.meta !== 'undefined' && import.meta.env?.DEV) console.debug(`[themes] ${key}: left out ${dropped} things that would clip`);
    if (api.barnBits && view.barn) view.barn.add(api.barnBits);
    attach?.(api.root);
    if (api.barnBits) attach?.(api.barnBits);
    const items = api.root.children.map((o, i) => ({ o, full: o.scale.clone(), delay: (i % 14) * 0.035, pop: !o.userData.noPop }));
    // a costume on every sheep (the festival's own if its module makes some, else ./costumes.js)
    const b = { api, ctx, k: 0, items, wear: [], dressed: new Set(), dress: api.sheepWear || ((i) => costumeFor(key, i)), key };
    dressSheep(b);
    show(b, 0);
    built[key] = b;
    return b;
  }

  /** Puts the theme's costume on every sheep that hasn't got one yet (sheep can arrive later). */
  function dressSheep(b) {
    (view.flock?.sheep || []).forEach((sh, i) => {
      if (b.dressed.has(sh)) return;
      const g = sh.g;
      // not while it's still popping in (its scale isn't its own yet)
      if (g?.isObject3D && g.userData.finalScale && g.scale.x < g.userData.finalScale * 0.99) return;
      b.dressed.add(sh);
      const anchor = headAnchor(sh);
      if (!anchor) return;
      const c = b.dress(i);
      if (!c) return;
      c.name = `${b.key} costume`;
      anchor.add(c);
      attach?.(c);
      b.wear.push({ o: c, full: c.scale.clone() });
    });
  }

  // where a sheep's costume goes: on top of its head, on the sheep's body (so it dips with the head
  // when the sheep grazes), in a holder that cancels the sheep's scale so costumes are made in
  // island units (+z the way it faces)
  const anchors = new Map();
  const v3 = new THREE.Vector3(), q1 = new THREE.Quaternion(), s1 = new THREE.Vector3();
  function headAnchor(sh) {
    if (anchors.has(sh)) return anchors.get(sh);
    const g = sh.g;
    if (!g?.isObject3D) { anchors.set(sh, null); return null; } // (not a drawn sheep)
    let face = null, ears = [];
    g.traverse((o) => { if (o.isMesh && /Face_mask/.test(o.name)) face = o; if (o.isMesh && /Ear_[LR]$/.test(o.name)) ears.push(o); });
    if (!face) { anchors.set(sh, null); return null; }
    const body = sh.body?.isObject3D ? sh.body : face.parent || g;
    g.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const o of [face, ...ears]) box.expandByObject(o);
    // just behind the face (the way the sheep faces), at the height of the ear tops
    box.getCenter(v3);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(g.getWorldQuaternion(q1)).setY(0).normalize();
    const at = new THREE.Vector3(v3.x, box.max.y, v3.z).addScaledVector(fwd, -0.06);
    const anchor = new THREE.Group();
    anchor.name = 'Costume';
    body.add(anchor);
    anchor.position.copy(body.worldToLocal(at));
    // upright and facing the sheep's way, whatever pose the body is in right now
    const bodyQ = body.getWorldQuaternion(new THREE.Quaternion());
    anchor.quaternion.copy(bodyQ.invert().multiply(g.getWorldQuaternion(q1)));
    anchor.scale.setScalar(1 / (body.getWorldScale(s1).x || 1));
    anchors.set(sh, anchor);
    return anchor;
  }

  function show(b, k) {
    b.api.root.visible = k > 0.001;
    if (b.api.barnBits) b.api.barnBits.visible = k > 0.001;
    for (const w of b.wear) {
      w.o.visible = k > 0.001;
      const s = Math.max(0.001, k >= 1 ? 1 : easeOutBack(clamp01(k)));
      w.o.scale.set(w.full.x * s, w.full.y * s, w.full.z * s);
    }
    for (const it of b.items) {
      if (!it.pop) { it.o.visible = k > 0.001; continue; }
      const kk = clamp01((k - it.delay) / (1 - 0.5));
      it.o.visible = kk > 0.001;
      const s = Math.max(0.001, kk >= 1 ? 1 : easeOutBack(kk));
      it.o.scale.set(it.full.x * s, it.full.y * s, it.full.z * s);
    }
  }

  function paintLamps(key) {
    if (lampTheme === key) return;
    lampTheme = key;
    const cols = key && built[key]?.api.lampColors;
    (view.lamps || []).forEach((l, i) => {
      const d = lampDefaults[i];
      const c = cols?.length ? cols[i % cols.length] : null;
      l.glass.material.color.setHex(c ?? d.glass);
      l.glass.material.emissive.setHex(c ?? d.emissive);
      l.halo.material.color.setHex(c ?? d.halo);
      l.pool.material.color.setHex(c ?? d.pool);
    });
  }

  /**
   * The festival to dress the farm for (null: none), built the first time it's wanted. year: the
   * farm year on show (New Year's sign shows the year after it); handed to the module's setYear.
   */
  function setTheme(key, { year } = {}) {
    want = key && BUILDERS[key] ? key : null;
    if (want) {
      const b = build(want);
      if (year != null) b.api.setYear?.(year);
    }
    paintLamps(want);
  }

  function update(dt, time, { night = 0 } = {}) {
    const still = reduced();
    for (const [key, b] of Object.entries(built)) {
      const to = key === want ? 1 : 0;
      if (b.k === to && !to) continue;
      const was = b.k;
      b.k = still ? to : clamp01(b.k + (to ? dt * 0.9 : -dt * 2.2));
      // its spots block the sheep only while it's out
      if (was === 0 && b.k > 0) b.ctx.reblock();
      if (was > 0 && b.k === 0) b.ctx.release();
      if (b.k > 0 && b.dressed.size < (view.flock?.sheep?.length || 0)) dressSheep(b);
      show(b, b.k);
      if (b.k > 0) {
        b.api.update?.(dt, still ? 0.4 : time, { night, k: b.k });
        for (const w of b.wear) w.o.userData.update?.(still ? 0.4 : time, night);
      }
    }
  }

  function snap() {
    for (const [key, b] of Object.entries(built)) {
      const was = b.k;
      b.k = key === want ? 1 : 0;
      if (was === 0 && b.k) b.ctx.reblock();
      if (was > 0 && !b.k) b.ctx.release();
      show(b, b.k);
    }
  }

  function dispose() {
    paintLamps(null);
    for (const b of Object.values(built)) {
      b.api.dispose?.();
      b.api.barnBits?.parent?.remove(b.api.barnBits);
      b.ctx.clear();
    }
    for (const a of anchors.values()) a?.parent?.remove(a);
    anchors.clear();
    host.parent?.remove(host);
  }

  return { setTheme, update, snap, dispose, get theme() { return want; } };
}
