// Coin stacks floating over the fields in a plan view: each coin is a share of that field's cash
// margin over 3 seasons (src/screens/planFutures.js works out how much one coin is worth and how
// many each field gets). The coins it has in common with keeping going are a soft gold; the ones
// a plan adds on top are bright gold, so a field that earns more shows it at a glance.
//
// Every coin on the island is one InstancedMesh: one draw call, no shadows, no snow (noSeason).
// Coins drop in (and lift away) one by one; the matrices are only written while that's going on.
//
//   const coins = createCoinStacks(view)
//   coins.place({ keepOuts })      where each field's stack goes (src/island/stackSpots.js)
//   coins.set(counts, base)        Map id -> coins on show; base: keeping going's counts
//   coins.step(dt)                 every frame (view.onFrame): moves the drop-ins on
//   await coins.prewarm(camera)    compiles the material before the first coins show
//   coins.dispose()                takes the mesh off the island and frees what it made
//
// Also: sailSpheres(view.spinners) and themeKeepOuts(festivalRoot), the three.js side of what the
// stacks keep clear of.
import * as THREE from 'three';
import { COIN_PITCH, MAX_COINS, stackSpot } from './stackSpots.js';

const COIN_R = 0.22; // big enough to read as coins from the whole-farm view
const COIN_H = 0.07;
const DROP = 0.25; // a new coin falls from this far over its place
const DROP_TIME = 0.22;
const DROP_GAP = 0.04; // seconds between coins dropping in, bottom one first
const LIFT = 0.15; // a coin taken away rises this far as it shrinks
const LIFT_TIME = 0.18;
const FLASH_TIME = 0.15; // a new coin shines pale for a moment
// the coins keeping going also has, then the ones the plan adds (each pair alternates up the stack)
const SOFT = [new THREE.Color('#e9cf8a'), new THREE.Color('#dcc07a')];
const BRIGHT = [new THREE.Color('#ffd040'), new THREE.Color('#ffc21f')];
const FLASH = new THREE.Color('#fff3c9');
const THEME_PAD = 0.6; // festival things drift a little (ghosts bob, bunting sways)

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const entriesOf = (m) => (m instanceof Map ? [...m.entries()] : Object.entries(m || {}));
const defaultReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * How far the windmill sails reach: one ball per set of sails, round its hub. The box is measured
 * at whatever angle the sails are at; a ball over its half-diagonal holds at every angle, since
 * the blades are the same all round the hub.
 * @returns {{x: number, y: number, z: number, r: number}[]}
 */
export function sailSpheres(spinners) {
  const out = [];
  const box = new THREE.Box3(), c = new THREE.Vector3(), s = new THREE.Vector3();
  for (const sp of spinners || []) {
    if (!sp?.isObject3D) continue;
    sp.updateWorldMatrix(true, true);
    box.setFromObject(sp);
    if (box.isEmpty()) continue;
    box.getCenter(c);
    box.getSize(s);
    out.push({ x: c.x, y: c.y, z: c.z, r: 0.5 * Math.hypot(s.x, s.y, s.z) + 0.1 });
  }
  return out;
}

/**
 * The boxes a festival's things fill (src/island/themes: the host group, 'Festival themes'): one
 * per mesh, one per instance of an instanced mesh, and a firework's whole burst. Each is grown a
 * little (things drift), and the ones that stay low (under floorY) are left out: no stack is that
 * low. Only what's on show counts. Measure it once the pop-ins have settled.
 *
 * pad is how much each box grows. The stacks float high, where ghosts bob and bunting sways, so
 * they keep well away (0.6). Something standing on the grass by a fence (a soil jar) only needs a
 * little room (about 0.12): with 0.6 a lit fence would block every spot near it.
 *
 * split (0: off): a long thing in one geometry (a string of lights or tinsel all round a fence)
 * fills a box as big as the whole field, which would keep everything off the grass round it. With
 * split, a geometry wider than that is measured in pieces about that size instead (its triangles
 * by where they are), so only where it really runs is kept clear.
 * points (true: on): whether sparkles and firework bursts (THREE.Points) count. The camera's
 * floor leaves them out: they are light in the air, not something solid to keep out of.
 * @param {THREE.Object3D|null} root
 * @param {{floorY?: number, pad?: number, split?: number, points?: boolean}} [o]
 * @returns {THREE.Box3[]}
 */
export function themeKeepOuts(root, { floorY = -Infinity, pad = THEME_PAD, split = 0, points = true } = {}) {
  const out = [];
  if (!root?.isObject3D) return out;
  root.updateWorldMatrix(true, true);
  const m = new THREE.Matrix4();
  const size = new THREE.Vector3();
  const keep = (b) => {
    if (b.isEmpty()) return;
    // an instance scaled to nothing is one that's put away (not on show)
    if (b.getSize(size).x < 1e-6 && size.y < 1e-6 && size.z < 1e-6) return;
    b.expandByScalar(pad);
    if (b.max.y >= floorY) out.push(b);
  };
  const walk = (o) => {
    if (!o.visible) return;
    const g = o.geometry;
    if (g && (o.isMesh || (points && o.isPoints))) {
      if (!g.boundingBox) g.computeBoundingBox();
      const parts = split > 0 ? piecesOf(g, split, !!o.isPoints) : [g.boundingBox];
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          for (const b of parts) keep(b.clone().applyMatrix4(m).applyMatrix4(o.matrixWorld));
        }
      } else for (const b of parts) keep(b.clone().applyMatrix4(o.matrixWorld));
    }
    for (const k of o.children) walk(k);
  };
  walk(root);
  return out;
}

// a geometry's pieces (see themeKeepOuts' split), worked out once per geometry and size
const piecesCache = new WeakMap();
function piecesOf(g, split, points) {
  const bb = g.boundingBox;
  const pos = g.attributes?.position;
  if (!pos || (bb.max.x - bb.min.x <= split && bb.max.z - bb.min.z <= split)) return [bb];
  let byGeo = piecesCache.get(g);
  if (!byGeo) piecesCache.set(g, (byGeo = new Map()));
  if (byGeo.has(split)) return byGeo.get(split);
  const cells = new Map();
  const idx = g.index;
  const step = points ? 1 : 3;
  const n = points ? pos.count : idx ? idx.count : pos.count;
  const v = new THREE.Vector3();
  const tri = new THREE.Box3();
  for (let i = 0; i + step - 1 < n; i += step) {
    tri.makeEmpty();
    for (let k = 0; k < step; k++) tri.expandByPoint(v.fromBufferAttribute(pos, idx && !points ? idx.getX(i + k) : i + k));
    tri.getCenter(v);
    const key = `${Math.floor(v.x / split)},${Math.floor(v.y / split)},${Math.floor(v.z / split)}`;
    const cell = cells.get(key);
    if (cell) cell.union(tri);
    else cells.set(key, tri.clone());
  }
  const out = cells.size ? [...cells.values()] : [bb];
  byGeo.set(split, out);
  return out;
}

/**
 * @param {object} view   the reveal's view (island, fields, props, spinners, lamps, heightAt, renderer, scene)
 * @param {object} [o]
 * @param {() => boolean} [o.reduced]   reduced motion: counts snap
 */
export function createCoinStacks(view, { reduced = defaultReduced } = {}) {
  const fields = view.fields || [];
  const capacity = Math.max(1, fields.length * MAX_COINS);
  const geometry = new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_H, 18);
  // a darker rim and bright faces, with a little warm glow of their own, so a stack reads as coins
  // (not hay) from far off, and still shows at night; the instance colours tint both
  const face = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.3, emissive: 0x5a3a00, emissiveIntensity: 0.55 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xc08a2c, roughness: 0.4, metalness: 0.3, emissive: 0x3a2400, emissiveIntensity: 0.5 });
  const material = [rim, face, face]; // CylinderGeometry's groups: side, top, bottom
  for (const m of [face, rim]) m.userData.noSeason = true; // no snow on the coins
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'coin stacks';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.noBox = true; // not part of the island's solid shape (src/island/cameraSafety.js measures the columns itself)
  // the colours exist from the start, so the material is compiled with them (no hitch later)
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  view.island.add(mesh);

  // per field: its spot, and its coins { k, state: 'in' | 'rest' | 'out', t }
  const stacks = new Map(fields.map((f) => [f.id, { spot: null, coins: [], base: 0 }]));
  let dirty = false; // something to write on the next step
  let alive = true;

  /**
   * Works out where each field's stack goes, clear of the props, the sails, the lamps and these
   * keep-outs (themeKeepOuts). A field with no clear spot gets no stack. Returns Map id -> spot | null.
   */
  function place({ keepOuts = [] } = {}) {
    const env = { props: view.props || [], sails: sailSpheres(view.spinners), lamps: view.lamps || [], keepOuts, heightAt: view.heightAt };
    const spots = new Map();
    for (const f of fields) {
      const spot = stackSpot({ polygons: f.polygons, topY: f.topY, isPivot: !!f.paddock?.userData?.isPivot }, env);
      const st = stacks.get(f.id);
      st.spot = spot;
      if (!spot) st.coins = [];
      spots.set(f.id, spot);
    }
    dirty = true;
    write();
    return spots;
  }

  /**
   * The coins on show: counts (Map or object id -> 0..12) and keeping going's counts, which they're
   * coloured against (the ones over it are bright). New coins drop in, spare ones lift away.
   */
  function set(counts, base = null) {
    const baseMap = new Map(entriesOf(base));
    const snap = reduced();
    let changed = false;
    for (const [id, n0] of entriesOf(counts)) {
      const st = stacks.get(id);
      if (!st) continue;
      const n = st.spot ? Math.max(0, Math.min(MAX_COINS, Math.round(Number(n0) || 0))) : 0;
      const b = baseMap.has(id) ? Number(baseMap.get(id)) || 0 : n;
      if (b !== st.base) { st.base = b; changed = true; } // (the colours change)
      const live = st.coins.filter((c) => c.state !== 'out');
      if (snap) {
        if (st.coins.length === n && live.length === n && st.coins.every((c) => c.state === 'rest')) continue; // as it is
        st.coins = Array.from({ length: n }, (_, k) => ({ k, state: 'rest', t: 0 }));
        changed = true;
        continue;
      }
      if (n > live.length) {
        // the new ones drop in one after another from the bottom up (any lifting away there goes)
        st.coins = st.coins.filter((c) => c.state !== 'out' || c.k < live.length || c.k >= n);
        for (let k = live.length; k < n; k++) st.coins.push({ k, state: 'in', t: -(k - live.length) * DROP_GAP });
        changed = true;
      } else if (n < live.length) {
        // the spare ones lift away from wherever they are now (one still waiting to drop just goes)
        st.coins = st.coins.filter((c) => !(c.k >= n && c.state === 'in' && c.t <= 0));
        for (const c of st.coins) {
          if (c.k < n || c.state === 'out') continue;
          const { off, s } = pose(c);
          c.state = 'out';
          c.t = 0;
          c.from = { off, s };
        }
        changed = true;
      }
    }
    if (!changed) return; // the same coins again: nothing to write
    dirty = true;
    write();
  }

  // how far over its place a coin is, and its size, now
  function pose(c) {
    if (c.state === 'in') {
      const e = c.t < 0 ? 0 : easeOutCubic(clamp01(c.t / DROP_TIME));
      return { off: DROP * (1 - e), s: e };
    }
    if (c.state === 'out') {
      const e = clamp01(c.t / LIFT_TIME), from = c.from || { off: 0, s: 1 };
      // (never over the drop-in height, so it stays inside the column the stack keeps clear)
      return { off: Math.min(DROP, from.off + LIFT * e), s: from.s * (1 - e) };
    }
    return { off: 0, s: 1 };
  }

  /** Moves the coins on; true while any is still dropping in or lifting away. */
  function step(dt) {
    if (!alive) return false;
    let moving = false;
    for (const st of stacks.values()) {
      for (const c of st.coins) {
        if (c.state === 'rest') continue;
        c.t += dt;
        moving = true;
        if (c.state === 'in' && c.t >= DROP_TIME) c.state = 'rest';
      }
      if (st.coins.some((c) => c.state === 'out' && c.t >= LIFT_TIME)) st.coins = st.coins.filter((c) => !(c.state === 'out' && c.t >= LIFT_TIME));
    }
    if (moving) dirty = true;
    if (dirty) write();
    return moving;
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const color = new THREE.Color();
  // every coin's matrix and colour, packed from instance 0 (only when something changed)
  function write() {
    if (!dirty || !alive) return;
    dirty = false;
    let i = 0;
    for (const st of stacks.values()) {
      if (!st.spot) continue;
      for (const c of st.coins) {
        const { off, s } = pose(c);
        p.set(st.spot.x, st.spot.baseY + c.k * COIN_PITCH + COIN_H / 2 + off, st.spot.z);
        sc.setScalar(Math.max(1e-4, s));
        mesh.setMatrixAt(i, m.compose(p, q, sc));
        const flash = c.state === 'in' && c.t >= 0 && c.t < FLASH_TIME;
        color.copy(flash ? FLASH : (c.k < st.base ? SOFT : BRIGHT)[c.k % 2]);
        mesh.setColorAt(i, color);
        i++;
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    bound();
  }

  // the stacks' reach (drop-in room included), so the camera's culling never cuts a coin off
  const sphereBox = new THREE.Box3();
  function bound() {
    sphereBox.makeEmpty();
    for (const st of stacks.values()) {
      if (!st.spot || !st.coins.length) continue;
      sphereBox.expandByPoint(p.set(st.spot.box.min.x, st.spot.box.min.y, st.spot.box.min.z));
      sphereBox.expandByPoint(p.set(st.spot.box.max.x, st.spot.box.max.y, st.spot.box.max.z));
    }
    if (!mesh.boundingSphere) mesh.boundingSphere = new THREE.Sphere();
    if (sphereBox.isEmpty()) mesh.boundingSphere.set(new THREE.Vector3(), 0);
    else sphereBox.getBoundingSphere(mesh.boundingSphere);
  }

  /** Compiles the coins' material ahead (renderer.compileAsync), so the first drop doesn't hitch. */
  function prewarm(camera = view.camera) {
    const r = view.renderer;
    if (!alive || !r?.compileAsync || !camera) return Promise.resolve();
    return r.compileAsync(mesh, camera, view.scene || null).catch(() => {});
  }

  /** Coins on show on a field now (not counting the ones lifting away). */
  const countOf = (id) => stacks.get(id)?.coins.filter((c) => c.state !== 'out').length ?? 0;

  function dispose() {
    if (!alive) return;
    alive = false;
    mesh.parent?.remove(mesh);
    mesh.dispose();
    geometry.dispose();
    face.dispose();
    rim.dispose();
    for (const st of stacks.values()) st.coins = [];
  }

  return {
    mesh,
    place,
    set,
    step,
    prewarm,
    dispose,
    countOf,
    /** Where a field's stack is (null: no stack on it, its chip carries the money). */
    spotOf: (id) => stacks.get(id)?.spot ?? null,
    /** The top of a field's coins now (for its chip), or null with no stack. */
    topOf: (id) => {
      const st = stacks.get(id);
      return st?.spot ? st.spot.baseY + countOf(id) * COIN_PITCH : null;
    },
    /** The highest any stack's column reaches (for the camera's floor), or -Infinity with none. */
    get columnTop() {
      let top = -Infinity;
      for (const st of stacks.values()) if (st.spot) top = Math.max(top, st.spot.top);
      return top;
    },
    get animating() {
      for (const st of stacks.values()) if (st.coins.some((c) => c.state !== 'rest')) return true;
      return false;
    },
  };
}
