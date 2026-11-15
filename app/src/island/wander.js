// Sheep that wander about the island without walking through anything (ported from the prototype's
// "sheep walk around without passing through things").
//
// Each sheep idles (grazing about half the time), then picks a spot a short walk away that it can
// reach in a straight, clear line, turns towards it and walks there with a little hop. If the way
// ahead turns out to be blocked (another sheep stepped in), it stops and thinks again.
//
// Blocked: the beach and the sea, steep slopes, the crag and ponds, every field (with a margin for
// its fence), round obstacles (buildings, trees, hay…), and other sheep.
//
//   const flock = createFlock({ heightAt, field, fields, obstacles, seed })
//   flock.add(group, { size, graze })   // group: the sheep's own (or wrapper) group, already placed
//   flock.update(dt, t)                 // every frame

const lerp = (a, b, t) => a + (b - a) * t;

/** Distance from a point to a polygon's edges, and whether it's inside (outer ring, minus holes). */
function polyCheck(x, z, rings) {
  let inside = false;
  let best = Infinity;
  rings.forEach((ring, ri) => {
    let inRing = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inRing = !inRing;
      const vx = xi - xj, vz = zi - zj;
      const t = Math.max(0, Math.min(1, ((x - xj) * vx + (z - zj) * vz) / (vx * vx + vz * vz || 1)));
      best = Math.min(best, Math.hypot(x - xj - vx * t, z - zj - vz * t));
    }
    if (ri === 0) inside = inRing;
    else if (inRing) inside = false; // in a hole
  });
  return { inside, dist: best };
}

/**
 * @param {object} o
 * @param {(x: number, z: number) => number} o.heightAt   ground height
 * @param {object} [o.field]      the terrain's helpers (coastR, center, cragMask, pondMask)
 * @param {Array} o.fields        field polygons: [[ring [[x, z]...], holes...], ...] per field
 * @param {Array} o.obstacles     round things: [{ x, z, r }]
 * @param {number} [o.minHeight]  lowest walkable ground (keeps them off the beach)
 * @param {() => number} o.rnd    a seeded random function
 */
export function createFlock({ heightAt, field, fields, obstacles, minHeight = 0.4, rnd }) {
  const sheep = [];
  const FENCE_PAD = 0.22;
  // each field's polygons with a bounding box for a quick reject
  const zones = fields.flatMap((polys) => polys.map((rings) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of rings[0]) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    return { rings, x0, z0, x1, z1 };
  }));

  function walkable(x, z, self, pad = 0.22) {
    const h = heightAt(x, z);
    if (h < minHeight) return false; // beach and sea
    if (field?.coastR && field.center) {
      const dx = x - field.center[0], dz = z - field.center[1];
      if (Math.hypot(dx, dz) > field.coastR(Math.atan2(dz, dx)) - 0.75) return false;
    }
    if (Math.hypot(heightAt(x + 0.1, z) - h, heightAt(x, z + 0.1) - h) / 0.1 > 1.6) return false; // too steep
    if ((field?.cragMask?.(x, z) ?? 0) > 0.05 || (field?.pondMask?.(x, z) ?? 0) > 0.02) return false;
    const reach = FENCE_PAD + pad * 0.5;
    for (const zn of zones) {
      if (x < zn.x0 - reach || x > zn.x1 + reach || z < zn.z0 - reach || z > zn.z1 + reach) continue;
      const { inside, dist } = polyCheck(x, z, zn.rings);
      if (inside || dist < reach) return false;
    }
    for (const o of obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + pad) return false;
    for (const q of sheep) {
      if (q === self) continue;
      const p = q.g.position;
      if (Math.hypot(x - p.x, z - p.z) < 0.15 + (q.size + (self ? self.size : 0.6)) * 0.38) return false;
    }
    return true;
  }

  function clearPath(x0, z0, x1, z1, self) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.12);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!walkable(lerp(x0, x1, t), lerp(z0, z1, t), self)) return false;
    }
    return true;
  }

  /** The nearest clear spot to (x, z) for a sheep of this size, or null. */
  function findSpot(x, z, size = 0.6) {
    const probe = { size, g: { position: { x: Infinity, z: Infinity } } };
    if (walkable(x, z, probe, 0.2)) return [x, z];
    for (let r = 0.1; r < 2.5; r += 0.1) {
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (walkable(px, pz, probe, 0.2)) return [px, pz];
      }
    }
    return null;
  }

  /** How many directions a sheep could walk ~1 unit from here (roomier is better to start in). */
  function roominess(x, z, self) {
    let ok = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (clearPath(x, z, x + Math.cos(a) * 1.1, z + Math.sin(a) * 1.1, self)) ok++;
    }
    return ok;
  }

  /**
   * Adds a sheep. Its group should already sit on the island; it's nudged to the roomiest clear
   * spot nearby. body (optional): the part tilted down when grazing (makeSheep's userData.body).
   */
  function add(g, { size = 0.6, graze = false, body = null } = {}) {
    const sh = { g, size, body, phase: rnd() * 6 };
    const p = g.position;
    const start = findSpot(p.x, p.z, size);
    if (start) { p.x = start[0]; p.z = start[1]; }
    let best = [p.x, p.z], score = roominess(p.x, p.z, sh);
    for (let k = 0; k < 30 && score < 10; k++) {
      const a = rnd() * Math.PI * 2, r = 0.3 + rnd() * 2.2;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (!walkable(x, z, sh, 0.2)) continue;
      const sc = roominess(x, z, sh);
      if (sc > score) { score = sc; best = [x, z]; }
    }
    p.x = best[0];
    p.z = best[1];
    p.y = heightAt(p.x, p.z);
    sh.walker = { mode: 'idle', timer: 0.5 + rnd() * 3, home: { x: p.x, z: p.z }, tx: 0, tz: 0, heading: g.rotation.y, tilt: graze ? 1 : 0, graze };
    sheep.push(sh);
    return sh;
  }

  function update(dt, t) {
    dt = Math.min(0.05, dt);
    if (!(dt > 0)) return;
    for (const sh of sheep) {
      const w = sh.walker, g = sh.g, p = g.position;
      if (w.spin) {
        // turning on the spot (spin()): stays put, head up, then goes back to idling
        const s = w.spin;
        s.t += dt;
        const k = Math.min(1, s.t / s.duration);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // eases in and out
        w.heading = s.from + s.turns * Math.PI * 2 * e;
        w.graze = false;
        if (k >= 1) {
          w.spin = null;
          w.heading = s.from;
          w.mode = 'idle';
          w.timer = 1.5 + rnd() * 2;
          s.onDone?.();
        }
      } else if (w.mode === 'idle') {
        w.timer -= dt;
        if (w.timer < 0) {
          for (let k = 0; k < 14; k++) {
            const a = rnd() * Math.PI * 2, d = 0.6 + rnd() * 1.4;
            const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
            if (Math.hypot(x - w.home.x, z - w.home.z) > 2.6) continue; // stay near home
            if (clearPath(p.x, p.z, x, z, sh)) { w.tx = x; w.tz = z; w.mode = 'walk'; w.graze = false; break; }
          }
          if (w.mode === 'idle') w.timer = 1 + rnd() * 2;
        }
      } else {
        const dx = w.tx - p.x, dz = w.tz - p.z, dist = Math.hypot(dx, dz);
        if (dist < 0.06) {
          w.mode = 'idle';
          w.timer = 1.5 + rnd() * 4;
          w.graze = rnd() < 0.5;
        } else {
          const want = Math.atan2(dx, dz);
          const diff = ((((want - w.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
          w.heading += Math.sign(diff) * Math.min(Math.abs(diff), dt * 3);
          if (Math.abs(diff) < 0.5) {
            const sp = 0.42 * sh.size;
            const nx = p.x + Math.sin(w.heading) * sp * dt, nz = p.z + Math.cos(w.heading) * sp * dt;
            if (walkable(nx, nz, sh, 0.22)) { p.x = nx; p.z = nz; } else { w.mode = 'idle'; w.timer = 0.8 + rnd() * 1.5; }
          }
        }
      }
      w.tilt += ((w.graze && w.mode === 'idle' ? 1 : 0) - w.tilt) * Math.min(1, dt * 3);
      if (sh.body) {
        sh.body.rotation.x = 0.32 * w.tilt;
        sh.body.position.set(0, -0.06 * w.tilt, 0.05 * w.tilt);
      }
      const hop = w.mode === 'walk' ? Math.abs(Math.sin(t * 9 + sh.phase)) * 0.045 * (sh.size / 0.6) : 0;
      p.y = heightAt(p.x, p.z) + hop;
      g.rotation.y = w.heading;
    }
  }

  /**
   * Turns a sheep on the spot: `turns` full turns over `duration` seconds, then back to idling.
   * It stays where it is (the same footprint), so it can't bump into anything.
   */
  function spin(sh, { turns = 2, duration = 4, onDone } = {}) {
    if (!sh?.walker) return;
    const w = sh.walker;
    w.mode = 'idle';
    w.spin = { t: 0, from: w.heading, turns, duration, onDone };
  }

  return { add, update, spin, walkable, findSpot, get sheep() { return sheep; } };
}
