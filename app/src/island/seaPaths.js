// Where the sea animals may go round the island: pure maths, no three.js (src/island/seaLife.js
// draws and moves them).
//
// Everything keeps to its own lane, measured as a distance out from the real shoreline, so nothing
// can meet anything else whatever the timing:
//
//   shore  0 ............................................................ out to sea
//          | fish schools | the two swimming sheep | dolphins | orca |
//                                                 |      the whale, now and then      |
//
//   - fish:     small schools in the shallows; the swimmers paddle there too, so a school darts
//               along its stretch out of a swimmer's way (fishRefuge) and dives if it can't
//   - swimmers: the reveal's two sheep (src/screens/reveal.js, makeSwimmers): every route they can
//               pick is sampled here, so the lanes further out keep clear of all of them
//   - dolphins: a pod of three on one lane, in a fixed formation
//   - orca:     one lane further out
//   - whale:    a spot past the swimmers' water, where the camera can see it and where neither the
//               orca nor the dolphins will pass while it's up (they move on their lanes at a steady
//               speed, so where they'll be is known)
//
// Each lane also keeps clear of the dock and the rowboat (round keep-outs), stays in deep water and
// never runs further out than the sea the camera shows (OUTER_LIMIT past the shore).
//
//   const sea = seaGeometry({ center, shoreR, heightAt })
//   const lanes = planSea(sea, { keepOuts, rnd })   { fish, dolphin, orca, whaleBand }
//   lane.at(s)                                      { x, z, dir } at distance s along a lane (wraps)
//   whaleSpot(sea, lanes, { rnd, visible, busy })   where the whale may come up, or null
//   showPath(lanes, { orcaAt, podAt }, seconds)      where the orca and the pod will be meanwhile (busy)
//   createWhaleClock({ rnd, date })                 when the whale comes by by itself
//   fishRefuge(school, at, swimmerRoutes)           where a school goes to keep out of a swimmer's way
//   createTapCounter()                              three taps on the open sea call it

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** How the reveal's two swimming sheep move (src/screens/reveal.js, makeSwimmers), mirrored here. */
export const SWIMMERS = {
  inner: 0.8, // they come up between 0.8 and 2.2 past the shore line (by angle)
  outer: 2.2,
  maxRoute: 9 * 0.13, // and paddle along (sideways to the shore) for up to 9 s at 0.13 a second
  body: 0.45, // a swimming sheep, nose to tail and side to side, round its middle
  minDepth: 0.3, // only where the sea floor is at least this deep, all along the route
  avoidDock: 2.2, // and never this close to the dock or the boat
};

/**
 * The pod's formation: [along the lane, across it (times SEA.dolphin.spread)] for each dolphin. Side by
 * side they're a spread apart (more than two dolphins' width, flippers and all); one behind the
 * other, more than a dolphin's length.
 */
export const POD = [[0, 0], [-0.85, 1], [-0.6, -1]];
export const DOLPHIN_WIDTH = 0.36; // flipper tip to flipper tip

/**
 * A fish school's layout round its middle ([x, z] each): one in the middle and six in a ring, the
 * school turning as one so no fish ever swims into another (they're FISH_LENGTH long, and every
 * two are further apart than that, however they face).
 */
export const FISH_LENGTH = 0.14;
export const SCHOOL = [[0, 0], ...Array.from({ length: 6 }, (_, k) => [Math.cos((k / 6) * Math.PI * 2) * 0.16, Math.sin((k / 6) * Math.PI * 2) * 0.16])];

/** The animals' sizes (round their middles, flat on the water) and lanes. */
export const SEA = {
  fish: { radius: 0.24, minDepth: 0.12, gap: 0.15 }, // a school, as one disc
  dolphin: { radius: 0.5, spread: 0.45, gap: 0.3 }, // one dolphin, nose to flukes; the pod sits ±spread across its lane
  orca: { radius: 0.78, gap: 0.45 },
  whale: { radius: 1.5, gap: 0.5 }, // a whale breaching or slapping its tail, splash and all
  outerLimit: 11.5, // the furthest past the shore anything goes: the overview still shows the sea there (and the whale checks it can be seen)
  minDepth: 0.45, // the dolphins, orca and whale swim where the sea is at least this deep
};

/**
 * The shoreline as a polyline round the island, and distances to it.
 * @param {{ center: [number, number], shoreR: (th: number) => number, heightAt: (x: number, z: number) => number }} f
 *   the terrain's field (src/island/terrain.js): the coast centre and where the ground meets the sea by angle
 */
export function seaGeometry({ center, shoreR, heightAt }, { samples = 360 } = {}) {
  const [cx, cz] = center;
  const shore = [];
  for (let i = 0; i < samples; i++) {
    const th = (i / samples) * TAU;
    const r = shoreR(th);
    shore.push([cx + Math.cos(th) * r, cz + Math.sin(th) * r, r]);
  }
  // a coarse grid of the shore points, so the nearest one is quick to find
  const cell = 1;
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  shore.forEach((p, i) => {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const segDist = (x, z, a, b) => {
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1), 0, 1);
    return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
  };
  const shoreAt = (th) => {
    const u = ((((th / TAU) * samples) % samples) + samples) % samples;
    const i = Math.floor(u), j = (i + 1) % samples, t = u - i;
    return shore[i][2] * (1 - t) + shore[j][2] * t;
  };
  /** Distance from (x, z) to the shoreline (positive whichever side). */
  function distToShore(x, z) {
    const gi = Math.floor(x / cell), gj = Math.floor(z / cell);
    let best = Infinity;
    // look in growing squares of cells until the best found can't be beaten further out
    for (let ring = 0; ring < 40; ring++) {
      for (let i = gi - ring; i <= gi + ring; i++) {
        for (let j = gj - ring; j <= gj + ring; j++) {
          if (Math.max(Math.abs(i - gi), Math.abs(j - gj)) !== ring) continue;
          for (const n of grid.get(key(i, j)) || []) {
            best = Math.min(best, segDist(x, z, shore[n], shore[(n + 1) % samples]), segDist(x, z, shore[(n + samples - 1) % samples], shore[n]));
          }
        }
      }
      if (best < (ring - 1) * cell) break;
    }
    return best;
  }
  /** How far out past the shoreline (x, z) is, by its angle: negative on land. */
  const outAt = (x, z) => Math.hypot(x - cx, z - cz) - shoreAt(Math.atan2(z - cz, x - cx));
  return { center: [cx, cz], shore, shoreAt, distToShore, outAt, heightAt };
}

/**
 * Every route the swimming sheep can take, as points along it (sampled the way makeSwimmers picks
 * them: a start 0.8 to 2.2 out, paddling either way along the shore, in deep water all along and
 * clear of the dock and the boat). The lanes are checked against all of these.
 */
export function swimmerRoutes(sea, { dockPoints = [], angles = 120 } = {}) {
  const [cx, cz] = sea.center;
  const out = [];
  for (let a = 0; a < angles; a++) {
    const th = (a / angles) * TAU;
    for (let r0 = SWIMMERS.inner; r0 <= SWIMMERS.outer + 1e-6; r0 += 0.35) {
      const r = sea.shoreAt(th) + Math.min(r0, SWIMMERS.outer);
      const x0 = cx + Math.cos(th) * r, z0 = cz + Math.sin(th) * r;
      for (const side of [1, -1]) {
        const dir = th + (side * Math.PI) / 2;
        const pts = [];
        let ok = true;
        for (let d = 0; d <= SWIMMERS.maxRoute + 0.01; d += 0.15) {
          const x = x0 + Math.cos(dir) * d, z = z0 + Math.sin(dir) * d;
          if (sea.heightAt(x, z) > -SWIMMERS.minDepth) { ok = false; break; }
          if (dockPoints.some(([px, pz]) => Math.hypot(x - px, z - pz) < SWIMMERS.avoidDock)) { ok = false; break; }
          pts.push([x, z]);
        }
        // (a shorter route along the first part may still fit, for a swimmer up for less time: keep it)
        if (ok || pts.length * 0.15 >= 6 * 0.13) out.push(...pts);
      }
    }
  }
  return out;
}

/**
 * A closed lane round the island, `offset` out from the shoreline everywhere (never closer, as the
 * crow flies, not just by angle), smoothed so it doesn't follow every wiggle of the coast.
 * at(s) gives the point s along it (wrapping), with the heading.
 */
export function makeLane(sea, offset, { samples = 240 } = {}) {
  const [cx, cz] = sea.center;
  const raw = [];
  for (let i = 0; i < samples; i++) {
    const th = (i / samples) * TAU;
    let r = sea.shoreAt(th) + offset;
    for (let k = 0; k < 200 && sea.distToShore(cx + Math.cos(th) * r, cz + Math.sin(th) * r) < offset; k++) r += 0.04;
    raw.push(r);
  }
  // the most of each neighbourhood, then the mean of those: smooth, and never inside the raw lane
  const w = Math.max(2, Math.round(samples / 48));
  const maxed = raw.map((_, i) => { let m = -Infinity; for (let k = -w; k <= w; k++) m = Math.max(m, raw[(i + k + samples) % samples]); return m; });
  const radii = maxed.map((_, i) => { let s = 0; for (let k = -w; k <= w; k++) s += maxed[(i + k + samples) % samples]; return s / (2 * w + 1); });
  const pts = radii.map((r, i) => { const th = (i / samples) * TAU; return [cx + Math.cos(th) * r, cz + Math.sin(th) * r]; });
  const cum = [0];
  for (let i = 0; i < samples; i++) {
    const a = pts[i], b = pts[(i + 1) % samples];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[samples];
  function at(s) {
    s = ((s % length) + length) % length;
    let lo = 0, hi = samples;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[(lo + 1) % samples];
    const t = (s - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  /** Where the lane crosses angle th (for the formation's sideways offsets). */
  const radiusAt = (th) => {
    const u = ((((th / TAU) * samples) % samples) + samples) % samples;
    const i = Math.floor(u), j = (i + 1) % samples, t = u - i;
    return radii[i] * (1 - t) + radii[j] * t;
  };
  return { offset, pts, length, at, radiusAt };
}

/**
 * The dock and the rowboat as round keep-outs ({ x, z, r, dock: true }): the dock as three discs from
 * its landward end out along `out` (the way it points to sea), the boat as one.
 */
export function dockKeepOuts(dockAt, out, boatAt) {
  const k = [];
  if (dockAt && out) for (const d of [0.2, 0.85, 1.5]) k.push({ x: dockAt[0] + out[0] * d, z: dockAt[1] + out[1] * d, r: 0.75, dock: true });
  if (boatAt) k.push({ x: boatAt[0], z: boatAt[1], r: 0.95, dock: true });
  return k;
}

/** Least distance from any of `pts` to any of `others` ([x, z] each). */
export function leastDistance(pts, others) {
  let best = Infinity;
  for (const [x, z] of pts) for (const [ox, oz] of others) best = Math.min(best, Math.hypot(x - ox, z - oz));
  return best;
}

/**
 * Lays out the sea: each lane as far in as it can be while clearing everything nearer the shore by
 * its own gap, and every keep-out (the dock and the boat as discs).
 * @param {object} sea   seaGeometry()
 * @param {object} o
 * @param {{x: number, z: number, r: number}[]} [o.keepOuts]   the dock and the boat
 * @param {() => number} [o.rnd]   seeded random (where the fish schools go)
 * @param {number} [o.schools=3]
 * @param {number} [o.prefer]   the angle (round the coast centre) the fish schools gather round first: the camera's side
 * @returns {{ fish: object[], dolphin: object, orca: object, whaleBand: [number, number], swimmers: number[][] }}
 */
export function planSea(sea, { keepOuts = [], rnd = Math.random, schools = 3, prefer = Math.PI / 2 } = {}) {
  const swimmers = swimmerRoutes(sea, { dockPoints: keepOuts.filter((k) => k.dock).map((k) => [k.x, k.z]) });
  // how far out the swimmers' bodies ever reach (along the shore's normal), and how near in
  let swimOut = 0;
  for (const [x, z] of swimmers) swimOut = Math.max(swimOut, sea.distToShore(x, z));
  swimOut += SWIMMERS.body;

  const keepClear = (lane, r, gap) => keepOuts.every((k) => lane.pts.every(([x, z]) => Math.hypot(x - k.x, z - k.z) >= k.r + r + gap));
  const deep = (lane, r) => lane.pts.every(([x, z]) => sea.heightAt(x, z) < -SEA.minDepth
    && sea.heightAt(x + r, z) < -SEA.minDepth && sea.heightAt(x - r, z) < -SEA.minDepth
    && sea.heightAt(x, z + r) < -SEA.minDepth && sea.heightAt(x, z - r) < -SEA.minDepth);
  const laneFrom = (from, r, gap, extra = 0) => {
    let off = from + gap + r + extra;
    for (let k = 0; k < 60; k++, off += 0.1) {
      const lane = makeLane(sea, off);
      if (keepClear(lane, r + extra, gap) && deep(lane, r + extra)) return lane;
    }
    return makeLane(sea, off);
  };
  const D = SEA.dolphin, O = SEA.orca;
  const dolphin = laneFrom(swimOut, D.radius, D.gap, D.spread);
  const dolphinOut = dolphin.offset + D.spread + D.radius;
  const orca = laneFrom(dolphinOut, O.radius, O.gap);
  // the whale: anywhere in deep water (whaleSpot keeps it clear of the swimmers' routes and of where
  // the orca and the dolphins will be during its show, and the swimmers keep out of its way while
  // it's up: src/screens/reveal.js asks whaleKeepOut)
  const whaleIn = SEA.whale.radius + 0.6;
  const whaleBand = [whaleIn, Math.max(whaleIn, SEA.outerLimit - SEA.whale.radius)];

  // fish: schools in the shallows, each a disc wholly in water deep enough to swim in, clear of the
  // dock, the boat and the other schools. The swimmers paddle through the shallows too, so a school
  // keeps out of their way as they go (fishRefuge, every frame): it darts along its stretch.
  const F = SEA.fish;
  const fish = [];
  const [cx, cz] = sea.center;
  const wet = (x, z) => {
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * TAU, rr = k === 8 ? 0 : F.radius;
      if (sea.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr) > -F.minDepth) return false;
    }
    return true;
  };
  const fishSpot = (th) => {
    for (let d = 0.05; d < 1.2; d += 0.05) {
      const r = sea.shoreAt(th) + d;
      const x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r;
      if (!wet(x, z) || sea.distToShore(x, z) < F.radius) continue;
      if (keepOuts.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + F.radius + F.gap)) return null;
      return { x, z, th };
    }
    return null;
  };
  // every angle where a school fits; then up to `schools` of them, spread round the island from `prefer`
  const spots = [];
  for (let a = 0; a < 180; a++) { const s = fishSpot((a / 180) * TAU); if (s) spots.push(s); }
  const wants = [0, 1.1, -1.1, 2.2, -2.2].map((a) => prefer + a + (rnd() - 0.5) * 0.4);
  for (let n = 0; n < schools && spots.length; n++) {
    const want = wants[n % wants.length];
    const ranked = spots.filter((s) => fish.every((f) => Math.hypot(f.x - s.x, f.z - s.z) > 2.5
      && f.range.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > F.radius * 2 + F.gap + 0.3)))
      .sort((p, q) => Math.abs(Math.sin((p.th - want) / 2)) - Math.abs(Math.sin((q.th - want) / 2)));
    if (!ranked.length) break;
    // its stretch of shallows: the free spots either side of it, unbroken (each next to the last),
    // within reach of home and well clear of the other schools' stretches, so a dart along it only
    // ever crosses water a school may be in
    const home = ranked[0];
    const free = (s) => Math.hypot(s.x - home.x, s.z - home.z) < 2.2
      && fish.every((f) => f.range.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > F.radius * 2 + F.gap + 0.3));
    const i0 = spots.indexOf(home);
    const run = [home];
    for (const step of [1, -1]) {
      let prev = home;
      for (let k = 1; k < spots.length; k++) {
        const s = spots[(i0 + step * k + spots.length) % spots.length];
        if (s === home || !free(s) || Math.hypot(s.x - prev.x, s.z - prev.z) > 0.45) break;
        if (step > 0) run.push(s); else run.unshift(s);
        prev = s;
      }
    }
    fish.push({ ...home, range: run, home: run.indexOf(home) });
  }
  return { fish, dolphin, orca, whaleBand, swimmers, swimOut };
}

/**
 * Where a fish school should be now: the spot along its stretch nearest to where it is (index
 * `at`) that is clear of every swimmer's route (the whole paddle, start to end, while it's up or
 * about to be), or -1 if there's none (the school dives out of the way). A spot it's already at that
 * is clear stays put.
 * @param {{range: {x: number, z: number}[]}} school
 * @param {number} at   where along its stretch it is now
 * @param {{ax: number, az: number, bx: number, bz: number}[]} routes   the swimmers' routes now
 */
export function fishRefuge(school, at, routes) {
  const need = SWIMMERS.body + SEA.fish.radius + SEA.fish.gap;
  const clear = (p) => routes.every((r) => segDistance(p.x, p.z, r.ax, r.az, r.bx, r.bz) >= need);
  const n = school.range.length;
  const i0 = Math.max(0, Math.min(n - 1, Math.round(at)));
  for (let k = 0; k < n; k++) {
    for (const i of k ? [i0 + k, i0 - k] : [i0]) if (i >= 0 && i < n && clear(school.range[i])) return i;
  }
  return -1;
}

/** Distance from (x, z) to the segment a-b. */
export function segDistance(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1), 0, 1);
  return Math.hypot(x - ax - vx * t, z - az - vz * t);
}

/**
 * Where the whale comes up: in its band (inside the sea the camera shows), deep water all round,
 * clear of the dock and the boat, of the swimmers' routes now (`swimmers`: { ax, az, bx, bz }; they
 * pick their next ones round it, whaleKeepOut), of everything in `busy` (where the orca and the
 * dolphins will be over the whole show, { x, z, r } each) and somewhere `visible(x, z)` says the
 * farmer can see (on screen, not behind the island). Of the good spots found, the one with the
 * lowest `score(x, z)` (nearest the camera, say). Returns { x, z, dir } (dir: which way it faces,
 * along the shore) or null.
 */
export function whaleSpot(sea, lanes, { rnd = Math.random, visible = () => true, keepOuts = [], busy = [], swimmers = [], score = null } = {}) {
  const [cx, cz] = sea.center;
  const [lo, hi] = lanes.whaleBand;
  const R = SEA.whale.radius;
  const swimGap = R + SWIMMERS.body + SEA.whale.gap;
  let best = null;
  let found = 0;
  for (let tries = 0; tries < 160 && found < 12; tries++) {
    const th = rnd() * TAU;
    const out = lo + rnd() * Math.max(0, hi - lo);
    let r = sea.shoreAt(th) + out;
    let x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r;
    for (let k = 0; k < 40 && sea.distToShore(x, z) < out; k++) { r += 0.05; x = cx + Math.cos(th) * r; z = cz + Math.sin(th) * r; }
    if (sea.distToShore(x, z) > SEA.outerLimit - R + 0.3) continue;
    let deep = true;
    for (let k = 0; k <= 8 && deep; k++) {
      const a = (k / 8) * TAU, rr = k === 8 ? 0 : R;
      if (sea.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr) > -SEA.minDepth) deep = false;
    }
    if (!deep) continue;
    if (keepOuts.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + R + SEA.whale.gap)) continue;
    if (busy.some((b) => Math.hypot(x - b.x, z - b.z) < R + b.r + SEA.whale.gap)) continue;
    if (swimmers.some((w) => segDistance(x, z, w.ax, w.az, w.bx, w.bz) < swimGap)) continue;
    if (!visible(x, z)) continue;
    const spot = { x, z, dir: th + Math.PI / 2 };
    if (!score) return spot;
    found++;
    const sc = score(x, z);
    if (!best || sc < best.sc) best = { spot, sc };
  }
  return best ? best.spot : null;
}

/** Whether (x, z) is too near a whale at `spot` for a swimming sheep to paddle there. */
export function whaleKeepOut(spot, x, z) {
  return !!spot && Math.hypot(x - spot.x, z - spot.z) < SEA.whale.radius + SWIMMERS.body + SEA.whale.gap;
}

export const ORCA_SPEED = 0.38; // along its lane, units a second
export const DOLPHIN_SPEED = 1.05;
export const WHALE_SHOW = 11; // seconds, up to sinking away

/**
 * Where the orca and the pod will be from now for `seconds` (every quarter second), as { x, z, r }:
 * the whale keeps out of all of it. orcaAt / podAt: how far along their lanes they are now.
 */
export function showPath(lanes, { orcaAt, podAt }, seconds = WHALE_SHOW + 1) {
  const out = [];
  for (let t = 0; t <= seconds; t += 0.25) {
    const o = lanes.orca.at(orcaAt + ORCA_SPEED * t);
    out.push({ x: o.x, z: o.z, r: SEA.orca.radius });
    for (const [along, across] of POD) {
      const p = lanes.dolphin.at(podAt + DOLPHIN_SPEED * t + along);
      const k = across * SEA.dolphin.spread;
      out.push({ x: p.x - Math.sin(p.dir) * k, z: p.z + Math.cos(p.dir) * k, r: SEA.dolphin.radius });
    }
  }
  return out;
}

// ---------------------------------------------------------------- when the whale comes by

/**
 * World Whale Day (the third Sunday in February, from the Maui whale festival): the one day the
 * whale is sure to come by, soon after the island opens, and more often after.
 */
export function isWhaleDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  if (date.getMonth() !== 1 || date.getDay() !== 0) return false;
  const d = date.getDate();
  return d >= 15 && d <= 21;
}

export const WHALE_TIMING = {
  firstAfter: 180, // never in the first three minutes (a whale day: 25 s)
  every: 60, // then a roll of the dice once a minute
  chance: 0.05, // ...that comes up about once in 20 minutes
  whaleDayFirst: 25,
  whaleDayChance: 0.25,
  rest: 90, // and never again within a minute and a half of the last one
};

/**
 * The whale's own clock: step(dt) says true on the frame it should come by. after() restarts the
 * rest after a whale (tapped up, or a dev shortcut).
 */
export function createWhaleClock({ rnd = Math.random, date = new Date(), timing = WHALE_TIMING } = {}) {
  const special = isWhaleDay(date);
  let t = 0;
  let next = special ? timing.whaleDayFirst : timing.firstAfter;
  let firstOnWhaleDay = special;
  const chance = special ? timing.whaleDayChance : timing.chance;
  return {
    special,
    step(dt) {
      t += Math.max(0, dt);
      if (t < next) return false;
      next = t + timing.every;
      if (firstOnWhaleDay || rnd() < chance) {
        firstOnWhaleDay = false;
        next = t + Math.max(timing.every, timing.rest);
        return true;
      }
      return false;
    },
    /** A whale just came by some other way: rest before the next. */
    after() { next = Math.max(next, t + timing.rest); firstOnWhaleDay = false; },
    get time() { return t; },
  };
}

/** Taps on the open sea: tap(time) says true on the third within `within` seconds of the first. */
export function createTapCounter({ need = 3, within = 4 } = {}) {
  let taps = [];
  return {
    tap(time) {
      taps = taps.filter((t) => time - t <= within);
      taps.push(time);
      if (taps.length >= need) { taps = []; return true; }
      return false;
    },
    reset() { taps = []; },
  };
}
