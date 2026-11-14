// Island layout for the reveal animation (pure maths, no three.js).
//
// The farmer picks 1 to 15 real fields. They can be kilometres apart. The reveal slides them
// together onto one floating island. This module works out where every field goes:
//
//   1. Project every field from lng/lat to flat metres around one origin (x east, y north).
//   2. Group fields that chain together within about a mile of each other. The group with the
//      most area is the "main group" (the home farm); the others are outlying places.
//   3. Inside each group, close up the big gaps: the field nearest the group's middle stays put,
//      and every other field slides straight towards the middle until it bumps into a field
//      already placed (leaving a small path-like gap). Fields that already sit close to a placed
//      field stay exactly where they are.
//   4. Then do the same with whole groups: the main group stays put, every outlying group slides
//      in as one rigid piece towards the main group until it bumps into the island.
//      Outlying groups get a label with their real distance and direction, e.g. "3.5 mi east".
//   5. Draw a rounded grass outline around everything with a margin, as one closed ring.
//
// Fields are never rotated or scaled, and because every field only slides along the line between
// it and the middle, north fields stay north and east fields stay east.

const EARTH_RADIUS_M = 6371008.8;
const M_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M; // metres per degree of latitude
const RAD = Math.PI / 180;
const MILE_M = 1609.344;

const FAR_M = 1609; // fields further than this (about a mile) from every other field are "far"
const COLLISION_SIMPLIFY_M = 2; // collision shapes are simplified by this much, for speed
const STAY_FACTOR = 3; // fields already within max(3 * gapM, 40 m) of a placed field stay put
const STAY_MIN_M = 40;
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

// ---------------------------------------------------------------------------
// Small planar helpers (all in metres)

/** The polygons of a Polygon / MultiPolygon geometry, each an array of rings. */
const partsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/** Ring without its closing duplicate point. */
function openRing(ring) {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, n - 1);
  return ring.slice();
}

/** Signed area (positive = counter-clockwise) and centroid of an open ring. */
function ringAreaCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-12) {
    // Degenerate ring: fall back to the average point.
    let sx = 0, sy = 0;
    for (const p of ring) { sx += p[0]; sy += p[1]; }
    return { area: 0, c: [sx / Math.max(1, n), sy / Math.max(1, n)] };
  }
  return { area: a, c: [cx / (6 * a), cy / (6 * a)] };
}

/** Area (holes removed) and area-weighted centroid of a list of polygons (open rings). */
function polygonsAreaCentroid(polygons) {
  let total = 0, sx = 0, sy = 0, fx = 0, fy = 0, fn = 0;
  for (const rings of polygons) {
    rings.forEach((ring, k) => {
      const { area, c } = ringAreaCentroid(ring);
      const w = (k === 0 ? 1 : -1) * Math.abs(area);
      total += w;
      sx += c[0] * w;
      sy += c[1] * w;
      for (const p of ring) { fx += p[0]; fy += p[1]; fn++; }
    });
  }
  if (total <= 1e-9) return { area: 0, c: [fx / Math.max(1, fn), fy / Math.max(1, fn)] };
  return { area: total, c: [sx / total, sy / total] };
}

/** Douglas-Peucker simplification of an open ring; keeps at least 3 points. */
export function simplifyRing(ring, tol) {
  const n = ring.length;
  if (n <= 4) return ring.slice();
  // Split the ring at point 0 and the point furthest from it, then simplify both halves.
  let far = 0, farD = -1;
  for (let i = 1; i < n; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const pt = (i) => ring[i % n];
  const stack = [[0, far], [far, n]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = pt(a);
    const [bx, by] = pt(b);
    let best = -1, bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pt(i)[0], pt(i)[1], ax, ay, bx, by);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  return out.length >= 3 ? out : ring.slice();
}

/** Squared distance from point (px, py) to segment (ax, ay)-(bx, by). */
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/** Point-in-ring test (even-odd) for an open ring given as flat arrays. */
function pointInShape(px, py, s) {
  let inside = false;
  const { xs, ys, n } = s;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if ((ys[i] > py) !== (ys[j] > py) && px < ((xs[j] - xs[i]) * (py - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
  }
  return inside;
}

/** Point-in-ring test for an array-of-points ring. */
export function pointInRing(p, ring) {
  let inside = false;
  const r = openRing(ring);
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Collision shapes: one simplified outer ring in flat typed arrays, plus its bounding box.

function makeShape(ring) {
  const n = ring.length;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = ring[i][0], y = ring[i][1];
    xs[i] = x; ys[i] = y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { xs, ys, n, minX, minY, maxX, maxY, area: Math.abs(ringAreaCentroid(ring).area) };
}

function shiftShape(s, dx, dy) {
  const xs = new Float64Array(s.n), ys = new Float64Array(s.n);
  for (let i = 0; i < s.n; i++) { xs[i] = s.xs[i] + dx; ys[i] = s.ys[i] + dy; }
  return { xs, ys, n: s.n, area: s.area, minX: s.minX + dx, minY: s.minY + dy, maxX: s.maxX + dx, maxY: s.maxY + dy };
}

/** Do any segments of a (shifted by ox, oy) strictly cross any segments of b? */
function shapesCross(a, ox, oy, b) {
  const an = a.n, bn = b.n;
  for (let i = 0, pi = an - 1; i < an; pi = i++) {
    const x1 = a.xs[pi] + ox, y1 = a.ys[pi] + oy, x2 = a.xs[i] + ox, y2 = a.ys[i] + oy;
    const sMinX = Math.min(x1, x2), sMaxX = Math.max(x1, x2), sMinY = Math.min(y1, y2), sMaxY = Math.max(y1, y2);
    if (sMaxX < b.minX || sMinX > b.maxX || sMaxY < b.minY || sMinY > b.maxY) continue;
    for (let j = 0, pj = bn - 1; j < bn; pj = j++) {
      const x3 = b.xs[pj], y3 = b.ys[pj], x4 = b.xs[j], y4 = b.ys[j];
      if (Math.max(x3, x4) < sMinX || Math.min(x3, x4) > sMaxX || Math.max(y3, y4) < sMinY || Math.min(y3, y4) > sMaxY) continue;
      const d1 = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
      const d2 = (x4 - x3) * (y2 - y3) - (y4 - y3) * (x2 - x3);
      const d3 = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
      const d4 = (x2 - x1) * (y4 - y1) - (y2 - y1) * (x4 - x1);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

/** Vertex-to-segment part of the distance: min distance from vertices of p (shifted) to edges of q. */
function vertsToEdges(p, ox, oy, q, best2) {
  const qn = q.n;
  for (let i = 0; i < p.n; i++) {
    const px = p.xs[i] + ox, py = p.ys[i] + oy;
    // Skip vertices that are further from q's box than the best distance so far.
    const bx = Math.max(0, q.minX - px, px - q.maxX), by = Math.max(0, q.minY - py, py - q.maxY);
    if (bx * bx + by * by >= best2) continue;
    for (let j = 0, pj = qn - 1; j < qn; pj = j++) {
      const d = segDist2(px, py, q.xs[pj], q.ys[pj], q.xs[j], q.ys[j]);
      if (d < best2) best2 = d;
    }
  }
  return best2;
}

/**
 * Distance in metres between shape a moved by (ox, oy) and shape b; 0 when they overlap.
 * Returns `best` unchanged when the true distance can't beat it (saves work).
 */
function shapeDist(a, ox, oy, b, best) {
  const dx = Math.max(0, b.minX - (a.maxX + ox), a.minX + ox - b.maxX);
  const dy = Math.max(0, b.minY - (a.maxY + oy), a.minY + oy - b.maxY);
  if (dx * dx + dy * dy >= best * best) return best;
  if (dx === 0 && dy === 0) {
    if (shapesCross(a, ox, oy, b)) return 0;
    if (pointInShape(a.xs[0] + ox, a.ys[0] + oy, b) || pointInShape(b.xs[0] - ox, b.ys[0] - oy, a)) return 0;
  }
  let best2 = best * best;
  best2 = vertsToEdges(a, ox, oy, b, best2);
  best2 = vertsToEdges(b, -ox, -oy, a, best2);
  return Math.sqrt(best2);
}

/** Distance from a body's shapes (moved by ox, oy) to a list of placed entries {shape}. */
function bodyDist(shapes, ox, oy, placed, filter) {
  let best = Infinity;
  for (const s of shapes) {
    for (const p of placed) {
      if (filter && !filter(p)) continue;
      best = shapeDist(s, ox, oy, p.shape, best);
      if (best === 0) return 0;
    }
  }
  return best;
}

/**
 * True when two shapes genuinely overlap (share real area, not just an edge). Estimated by
 * sampling a 32 x 32 grid over the box where they could overlap: cheap and plenty accurate for
 * telling "drawn next to each other" from "the same field twice".
 */
function shapesOverlap(a, ox, oy, b) {
  const x0 = Math.max(a.minX + ox, b.minX), x1 = Math.min(a.maxX + ox, b.maxX);
  const y0 = Math.max(a.minY + oy, b.minY), y1 = Math.min(a.maxY + oy, b.maxY);
  if (x1 <= x0 || y1 <= y0) return false;
  const N = 32;
  let hits = 0;
  for (let i = 0; i < N; i++) {
    const x = x0 + ((i + 0.5) / N) * (x1 - x0);
    for (let j = 0; j < N; j++) {
      const y = y0 + ((j + 0.5) / N) * (y1 - y0);
      if (pointInShape(x - ox, y - oy, a) && pointInShape(x, y, b)) hits++;
    }
  }
  const area = (hits / (N * N)) * (x1 - x0) * (y1 - y0);
  const smaller = Math.min(a.area, b.area);
  return area > Math.max(5, 0.01 * smaller);
}

// ---------------------------------------------------------------------------
// Sliding bodies together

/**
 * Clearance between a body's shapes (moved by ox, oy) and placed entries {shape, key}: the
 * smallest (distance - wanted gap) over all pairs. Negative means closer than the gap allows.
 * The wanted gap is opts.gapOf(keyA, keyB) (a constant gapM unless gapBetween was given).
 */
function bodyClear(b, ox, oy, placed, opts) {
  let best = Infinity;
  for (let i = 0; i < b.shapes.length; i++) {
    const s = b.shapes[i], k = b.keys[i];
    for (const p of placed) {
      const g = opts.gapOf(k, p.key);
      const d = shapeDist(s, ox, oy, p.shape, best + g);
      if (d - g < best) best = d - g;
    }
  }
  return best;
}

/**
 * Slide body b from offset (ox, oy) along -(ux, uy) by up to maxS, stopping where its clearance
 * to `placed` would go negative. c is the clearance at the start. Returns the new offset.
 */
function slideBody(b, ox, oy, ux, uy, maxS, c, placed, opts) {
  const { minStep } = opts;
  let s = 0;
  for (let k = 0; k < 2000 && s < maxS; k++) {
    // Moving by the clearance can never cause a collision, so take steps of that size; once
    // steps get tiny, take a minimum step and bisect back if it collides.
    const next = Math.min(maxS, s + Math.max(c, minStep));
    const cn = bodyClear(b, ox - next * ux, oy - next * uy, placed, opts);
    if (cn >= 0) { s = next; c = cn; continue; }
    let lo = s, hi = next;
    while (hi - lo > 0.25) {
      const mid = (lo + hi) / 2;
      if (bodyClear(b, ox - mid * ux, oy - mid * uy, placed, opts) >= 0) lo = mid; else hi = mid;
    }
    s = lo;
    break;
  }
  return [ox - s * ux, oy - s * uy];
}

/**
 * Tight mode only: let already placed bodies settle towards the anchor like pebbles in a bowl.
 * Each body (nearest the anchor first, the nearest one stays) tries to slide towards the anchor
 * straight on and turned by up to about 70 degrees either side, and keeps the move that brings it
 * closest. The turn is limited, so fields keep roughly their compass direction.
 * Bodies are { shapes, keys, c, offset } with shapes at offset 0; offsets are updated in place.
 */
function settleBodies(bodies, anchor, opts, passes = 2) {
  if (bodies.length < 2) return;
  const turns = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2];
  for (let pass = 0; pass < passes; pass++) {
    const pos = (b) => [b.c[0] + b.offset[0], b.c[1] + b.offset[1]];
    const order = bodies
      .map((b, i) => ({ b, i, d: Math.hypot(pos(b)[0] - anchor[0], pos(b)[1] - anchor[1]) }))
      .sort((p, q) => p.d - q.d || p.i - q.i);
    for (let k = 1; k < order.length; k++) {
      const b = order[k].b;
      const others = [];
      for (const o of bodies) if (o !== b) o.shapes.forEach((s, i) => others.push({ shape: shiftShape(s, o.offset[0], o.offset[1]), key: o.keys[i] }));
      const [px, py] = pos(b);
      const D = Math.hypot(px - anchor[0], py - anchor[1]);
      if (D < 1e-6) continue;
      const c = bodyClear(b, b.offset[0], b.offset[1], others, opts);
      if (c < 0) continue; // never make an existing overlap worse
      let best = b.offset, bestD = D - 1;
      for (const t of turns) {
        // Unit vector pointing away from the anchor, turned by t; slideBody moves against it.
        const ax = (px - anchor[0]) / D, ay = (py - anchor[1]) / D;
        const ux = ax * Math.cos(t) - ay * Math.sin(t), uy = ax * Math.sin(t) + ay * Math.cos(t);
        const o = slideBody(b, b.offset[0], b.offset[1], ux, uy, D * Math.cos(t), c, others, opts);
        const d = Math.hypot(b.c[0] + o[0] - anchor[0], b.c[1] + o[1] - anchor[1]);
        if (d < bestD) { bestD = d; best = o; }
      }
      b.offset = best;
    }
  }
  // Anything still far from its neighbours (blocked towards the anchor) goes to the nearest one.
  for (const b of bodies) {
    const others = [];
    for (const o of bodies) if (o !== b) o.shapes.forEach((s, i) => others.push({ shape: shiftShape(s, o.offset[0], o.offset[1]), key: o.keys[i] }));
    b.offset = pullToNearest(b, b.offset[0], b.offset[1], others, opts);
  }
}

/**
 * Tight mode: while body b (at offset ox, oy) is more than 1.5 gaps from everything placed, slide
 * it towards the middle of its nearest placed shape. Returns the new offset.
 */
function pullToNearest(b, ox, oy, placed, opts) {
  const { gapM } = opts;
  for (let pass = 0; pass < 4; pass++) {
    const c = bodyClear(b, ox, oy, placed, opts);
    if (c <= 0.5 * gapM || !Number.isFinite(c)) break;
    let near = null, nd = Infinity;
    for (const p of placed) {
      const d = bodyClear(b, ox, oy, [p], opts);
      if (d < nd) { nd = d; near = p; }
    }
    const sh = b.shapes.reduce((a, q) => (q.area > a.area ? q : a));
    const bx = (sh.minX + sh.maxX) / 2 + ox, by = (sh.minY + sh.maxY) / 2 + oy;
    const tx = (near.shape.minX + near.shape.maxX) / 2, ty = (near.shape.minY + near.shape.maxY) / 2;
    const D = Math.hypot(bx - tx, by - ty);
    if (D < 1e-6) break;
    [ox, oy] = slideBody(b, ox, oy, (bx - tx) / D, (by - ty) / D, D, c, placed, opts);
  }
  return [ox, oy];
}

/**
 * Place bodies one by one, nearest the anchor first. Each body is
 * { shapes, keys, c: [x, y], fixed? } (keys[i] = item index of shapes[i]). Fills body.offset.
 * `placed` collects {shape, moved, key}.
 *
 * Normal mode: fields already near a placed field (within stayM) stay at their real position, and
 * real neighbours may touch edge to edge. Tight mode (opts.tight): every body ends up about one
 * wanted gap from what is already placed: touching neighbours are pushed apart, every other body
 * slides in, and a body that slides past everything is pulled towards its nearest placed shape.
 */
function placeBodies(bodies, anchor, placed, opts) {
  const { gapM, stayM, minStep, tight } = opts;
  const clear = (b, ox, oy, list = placed) => bodyClear(b, ox, oy, list, opts);
  const order = bodies
    .map((b, i) => ({ b, i, d: b.fixed ? -1 : Math.hypot(b.c[0] - anchor[0], b.c[1] - anchor[1]) }))
    .sort((p, q) => p.d - q.d || p.i - q.i);

  const slide = (b, ox, oy, ux, uy, maxS, c) => slideBody(b, ox, oy, ux, uy, maxS, c, placed, opts);

  for (const { b } of order) {
    const commit = (ox, oy) => {
      b.offset = [ox, oy];
      const moved = Math.hypot(ox, oy) > 1e-6;
      b.shapes.forEach((s, i) => placed.push({ shape: moved ? shiftShape(s, ox, oy) : s, moved, key: b.keys[i] }));
    };
    if (placed.length === 0) { commit(0, 0); continue; }

    // Direction from the anchor out to this body; the body slides back along it.
    let vx = b.c[0] - anchor[0], vy = b.c[1] - anchor[1];
    const L = Math.hypot(vx, vy);
    let ux, uy;
    if (L > 1e-6) { ux = vx / L; uy = vy / L; } else { ux = 1; uy = 0; }

    const c0 = clear(b, 0, 0);

    if (c0 < 0) {
      // Already touching something at its real position. In normal mode that's fine when it only
      // touches real, unmoved neighbours edge to edge. Overlapping a field that has slid in (or a
      // genuine overlap, e.g. the same field chosen twice) gets pushed outwards until it is clear;
      // in tight mode anything closer than the gap is.
      const blocked = tight || placed.some((p) => {
        if (clear(b, 0, 0, [p]) >= 0) return false;
        if (p.moved) return true;
        return bodyDist(b.shapes, 0, 0, [p]) === 0 && b.shapes.some((s) => shapeDist(s, 0, 0, p.shape, Infinity) === 0 && shapesOverlap(s, 0, 0, p.shape));
      });
      if (!blocked) { commit(0, 0); continue; }
      let s = 0, c = c0;
      for (let k = 0; k < 400 && c < 0; k++) {
        s += Math.max(-c, minStep);
        c = clear(b, s * ux, s * uy);
      }
      // Pushed out along a ray that runs alongside a neighbour, it can end up far from everything.
      if (tight) commit(...pullToNearest(b, s * ux, s * uy, placed, opts));
      else commit(s * ux, s * uy);
      continue;
    }

    if (!tight && (c0 + gapM <= stayM || L < 1e-6)) { commit(0, 0); continue; }

    let [ox, oy] = L > 1e-6 && c0 > 0.05 * gapM ? slide(b, 0, 0, ux, uy, L, c0) : [0, 0];
    // Slid past everything (or started right on the anchor): pull it in to its nearest neighbour.
    if (tight) [ox, oy] = pullToNearest(b, ox, oy, placed, opts);
    commit(ox, oy);
  }
}

// ---------------------------------------------------------------------------
// Outline
//
// The grass outline is worked out on a fine grid rather than with polygon buffering (which is
// far too slow for 15 detailed fields):
//   1. Mark the grid points that lie inside a field.
//   2. Distance transform: how far every grid point is from the nearest field.
//   3. "Closing": keep points within margin + r of a field, then shave r off that shape again.
//      Growing then shrinking rounds the notches between fields and fills narrow inlets, so the
//      edge has no spikes, while bulges stay about `margin` from the fields.
//   4. If that still leaves separate pieces, try a bigger r; as a last resort use a convex hull.
//   5. Trace the edge with marching squares, then smooth it with Chaikin corner cutting.

const INF = 1e20;

/** One round of Chaikin corner cutting on an open ring. */
export function chaikin(ring) {
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
    out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
  }
  return out;
}

/** 1D squared distance transform (Felzenszwalb & Huttenlocher), in place over a strided line. */
function edt1d(grid, start, stride, n, f, d, v, z) {
  for (let q = 0; q < n; q++) f[q] = grid[start + q * stride];
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k] && k > 0) k--; else break;
    }
    if (s <= z[k]) { // k === 0 and the new parabola wins everywhere
      v[0] = q; z[0] = -INF; z[1] = INF; continue;
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
  for (let q = 0; q < n; q++) grid[start + q * stride] = d[q];
}

/** Euclidean distance (in grid steps) from every node to the nearest seed node. */
export function distanceTransform(seed, W, H) {
  const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = seed[i] ? 0 : INF;
  const m = Math.max(W, H);
  const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let x = 0; x < W; x++) edt1d(g, x, W, H, f, d, v, z);
  for (let y = 0; y < H; y++) edt1d(g, y * W, 1, W, f, d, v, z);
  for (let i = 0; i < W * H; i++) g[i] = Math.sqrt(g[i]);
  return g;
}

/** Mark grid nodes inside any ring (even-odd scanline fill per ring). */
export function rasterise(rings, x0, y0, h, W, H) {
  const inside = new Uint8Array(W * H);
  const xs = [];
  for (const ring of rings) {
    const n = ring.length;
    let rMin = Infinity, rMax = -Infinity;
    for (const p of ring) { if (p[1] < rMin) rMin = p[1]; if (p[1] > rMax) rMax = p[1]; }
    const j0 = Math.max(0, Math.ceil((rMin - y0) / h)), j1 = Math.min(H - 1, Math.floor((rMax - y0) / h));
    for (let j = j0; j <= j1; j++) {
      const y = y0 + j * h;
      xs.length = 0;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const [xa, ya] = ring[a];
        const [xb, yb] = ring[b];
        if ((ya > y) !== (yb > y)) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
      }
      if (!xs.length) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - x0) / h));
        const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / h));
        for (let i = i0; i <= i1; i++) inside[j * W + i] = 1;
      }
    }
  }
  return inside;
}

/** Label 4-connected components of nodes with F > 0; returns {label, count, biggest}. */
export function components(F, W, H) {
  const label = new Int32Array(W * H);
  const sizes = [0];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (F[s] <= 0 || label[s]) continue;
    const id = sizes.length;
    let size = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % W, y = (p - x) / W;
      if (x > 0 && F[p - 1] > 0 && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); }
      if (x < W - 1 && F[p + 1] > 0 && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && F[p - W] > 0 && !label[p - W]) { label[p - W] = id; stack.push(p - W); }
      if (y < H - 1 && F[p + W] > 0 && !label[p + W]) { label[p + W] = id; stack.push(p + W); }
    }
    sizes.push(size);
  }
  let biggest = 0;
  for (let i = 1; i < sizes.length; i++) if (!biggest || sizes[i] > sizes[biggest]) biggest = i;
  return { label, count: sizes.length - 1, biggest };
}

/** Marching squares: the longest closed contour of F = 0 (inside is F > 0), as an open ring. */
export function traceContour(F, x0, y0, h, W, H) {
  // Edge ids: horizontal edge from node (i, j) to (i+1, j) is 2*(j*W+i); vertical edge from
  // (i, j) to (i, j+1) is 2*(j*W+i)+1. Each contour segment joins two edge crossings.
  const point = new Map();
  const crossing = (id) => {
    let p = point.get(id);
    if (p) return p;
    const n = id >> 1, i = n % W, j = (n - i) / W;
    const a = F[n], b = id & 1 ? F[n + W] : F[n + 1];
    const t = a / (a - b);
    p = id & 1 ? [x0 + i * h, y0 + (j + t) * h] : [x0 + (i + t) * h, y0 + j * h];
    point.set(id, p);
    return p;
  };
  const segA = [], segB = [];
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const n = j * W + i;
      const fa = F[n], fb = F[n + 1], fc = F[n + W + 1], fd = F[n + W];
      const c = (fa > 0 ? 1 : 0) | (fb > 0 ? 2 : 0) | (fc > 0 ? 4 : 0) | (fd > 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const B = 2 * n, T = 2 * (n + W), L = 2 * n + 1, R = 2 * (n + 1) + 1;
      const add = (p, q) => { segA.push(p); segB.push(q); };
      const centreIn = fa + fb + fc + fd > 0;
      switch (c) {
        case 1: case 14: add(L, B); break;
        case 2: case 13: add(B, R); break;
        case 3: case 12: add(L, R); break;
        case 4: case 11: add(R, T); break;
        case 6: case 9: add(B, T); break;
        case 7: case 8: add(L, T); break;
        case 5: if (centreIn) { add(B, R); add(T, L); } else { add(L, B); add(R, T); } break;
        case 10: if (centreIn) { add(L, B); add(R, T); } else { add(B, R); add(T, L); } break;
      }
    }
  }
  // Link segments into loops through the edge crossings they share.
  const at = new Map();
  const link = (e, s) => { const l = at.get(e); if (l) l.push(s); else at.set(e, [s]); };
  for (let s = 0; s < segA.length; s++) { link(segA[s], s); link(segB[s], s); }
  const used = new Uint8Array(segA.length);
  let best = null, bestA = -1;
  for (let s0 = 0; s0 < segA.length; s0++) {
    if (used[s0]) continue;
    const loop = [];
    let s = s0, e = segB[s0];
    used[s0] = 1;
    loop.push(crossing(segA[s0]));
    for (let guard = 0; guard < segA.length; guard++) {
      loop.push(crossing(e));
      const next = at.get(e).find((t) => !used[t]);
      if (next === undefined) break;
      used[next] = 1;
      e = segA[next] === e ? segB[next] : segA[next];
      s = next;
    }
    if (loop.length > 2 && loop[0] === loop[loop.length - 1]) loop.pop();
    const a = Math.abs(ringAreaCentroid(loop).area);
    if (a > bestA) { bestA = a; best = loop; }
  }
  return best;
}

/** Convex hull (monotone chain) of points, counter-clockwise. */
function convexHull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function buildOutline(islandRings, marginM) {
  const m = Math.max(1, marginM);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of islandRings) for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const tryClose = (rings, factors) => {
    for (const factor of factors) {
      const r = m * factor;
      const pad = m + r + 0;
      // Grid step: fine enough for about 1/12 of the margin, but at most ~450 steps a side.
      const spanX = maxX - minX + 2 * pad, spanY = maxY - minY + 2 * pad;
      const h = Math.max(m / 12, Math.max(spanX, spanY) / 450, 0.25);
      const x0 = minX - pad - 3 * h, y0 = minY - pad - 3 * h;
      const W = Math.ceil((spanX + 6 * h) / h) + 1, H = Math.ceil((spanY + 6 * h) / h) + 1;
      const seed = rasterise(rings, x0, y0, h, W, H);
      // Distance from each node to the nearest field; nodes inside fields sit up to half a step
      // in from the true edge, hence the -h/2 corrections.
      const d1 = distanceTransform(seed, W, H);
      const grown = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) grown[i] = d1[i] * h - 0.5 * h <= m + r ? 0 : 1; // 1 = outside
      const d2 = distanceTransform(grown, W, H);
      const F = new Float64Array(W * H);
      for (let i = 0; i < W * H; i++) F[i] = d2[i] * h - 0.5 * h - r;
      const { label, count, biggest } = components(F, W, H);
      if (count === 1 || factor === factors[factors.length - 1]) {
        if (count > 1) for (let i = 0; i < W * H; i++) if (label[i] !== biggest) F[i] = -h;
        const ring = traceContour(F, x0, y0, h, W, H);
        if (ring && (count === 1 || factors.length === 1)) return { ring, h };
      }
    }
    return null;
  };
  let res = tryClose(islandRings, [1, 2, 4, 8]);
  // Last resort: wrap all fields in one convex hull and give that a margin.
  if (!res) res = tryClose([convexHull(islandRings.flat())], [1]);
  let out = simplifyRing(res.ring, 0.15 * res.h);
  out = chaikin(chaikin(out));
  out = simplifyRing(out, 0.03 * res.h);
  // Counter-clockwise, closed.
  if (ringAreaCentroid(out).area < 0) out.reverse();
  out.push([out[0][0], out[0][1]]);
  return out;
}

// ---------------------------------------------------------------------------
// Labels

function compassWord(dx, dy) {
  let deg = Math.atan2(dx, dy) / RAD; // 0 = north, 90 = east
  if (deg < 0) deg += 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

// ---------------------------------------------------------------------------
// Main entry point

/**
 * Lay out the chosen fields on one island.
 *
 * @param {{id: string, geometry: object, elevationM?: number|null, reserve?: object}[]} fields
 *   GeoJSON Polygon / MultiPolygon geometries in lng/lat. reserve: optional extra space (GeoJSON
 *   Polygon / MultiPolygon) that moves rigidly with the field and is kept clear like the field,
 *   but is not part of it (returned as fields[i].reserved, metres, real position).
 * @param {{gapM?: number, marginM?: number, exaggeration?: number, tight?: boolean,
 *   gapBetween?: (idA, idB) => number}} [options]
 *   gapM: path-like gap left between fields that slide together (metres).
 *   marginM: grass around the edge; default clamp(0.08 * sqrt(total area m^2), 25, 150).
 *   exaggeration: multiplier for elevation differences.
 *   tight: pack every field about one gap from a neighbour (real neighbours that touch are pushed
 *     apart, fields a few hundred metres apart slide together). Default false: fields near a
 *     neighbour keep their real position.
 *   gapBetween: wanted gap (metres) between two fields by id, instead of the one gapM (e.g. wider
 *     walkways between fields on different terrace levels). gapM still sets the step sizes.
 * @returns {{
 *   origin: [number, number],            projection origin, lng/lat (area-weighted centroid)
 *   project: (lngLat) => [x, y],         metres, x east, y north of origin
 *   unproject: ([x, y]) => [lng, lat],   the inverse
 *   marginM: number, totalAreaM2: number,
 *   fields: {
 *     id, polygons,                      [polygon][ring][point] = [x, y] metres, REAL position, rings closed
 *     offset: [dx, dy],                  add to every point to get the island position
 *     heightM, areaM2,
 *     centroid: [x, y],                  real position
 *     label: null | { text, at, distanceM, direction }   at = island position (metres)
 *   }[],                                 same order as the input
 *   outline: [x, y][],                   closed, counter-clockwise ring, island positions
 *   bounds: {minX, minY, maxX, maxY}, center: [x, y], radiusM   (radius from center to the outline)
 * }}
 */
export function layoutIsland(fields, { gapM = 12, marginM, exaggeration = 3, tight = false, gapBetween } = {}) {
  const input = (fields || []).filter((f) => f && f.geometry && partsOf(f.geometry).length);
  if (!input.length) throw new Error('layoutIsland needs at least one field with a polygon geometry');

  // --- 1. Projection origin: area-weighted centroid of all fields. -----------------------------
  // First project around a rough centre, find the centroid there, then re-centre on it.
  let lng0 = 0, lat0 = 0, cnt = 0;
  for (const f of input) for (const rings of partsOf(f.geometry)) for (const p of rings[0]) { lng0 += p[0]; lat0 += p[1]; cnt++; }
  lng0 /= cnt; lat0 /= cnt;
  const projectAbout = (o) => {
    const kx = M_PER_DEG * Math.cos(o[1] * RAD);
    return (p) => [(p[0] - o[0]) * kx, (p[1] - o[1]) * M_PER_DEG];
  };
  const unprojectAbout = (o) => {
    const kx = M_PER_DEG * Math.cos(o[1] * RAD);
    return (p) => [o[0] + p[0] / kx, o[1] + p[1] / M_PER_DEG];
  };
  const toPolys = (proj, g) => partsOf(g).map((rings) => rings.map((r) => openRing(r).map(proj)));
  {
    const rough = projectAbout([lng0, lat0]);
    const all = input.flatMap((f) => toPolys(rough, f.geometry));
    const { c } = polygonsAreaCentroid(all);
    [lng0, lat0] = unprojectAbout([lng0, lat0])(c);
  }
  const origin = [lng0, lat0];
  const project = projectAbout(origin);
  const unproject = unprojectAbout(origin);

  // --- 2. Per-field data in metres. ------------------------------------------------------------
  const elevs = input.map((f) => f.elevationM).filter((e) => typeof e === 'number' && Number.isFinite(e));
  const minElev = elevs.length ? Math.min(...elevs) : 0;

  const items = input.map((f) => {
    const polys = toPolys(project, f.geometry);
    const { area, c } = polygonsAreaCentroid(polys);
    // Reserved space (e.g. a farmyard) moves with the field and keeps others away, but is not
    // part of the field: not in its area, centroid, polygons or labels.
    const reserved = f.reserve && partsOf(f.reserve).length ? toPolys(project, f.reserve) : [];
    // Collision uses the outer ring of each polygon, simplified a little.
    const shapes = [...polys, ...reserved].map((rings) => makeShape(simplifyRing(rings[0], COLLISION_SIMPLIFY_M)));
    const e = f.elevationM;
    const heightM = typeof e === 'number' && Number.isFinite(e) ? Math.max(0, (e - minElev) * exaggeration) : 0;
    return { id: f.id, polys, reserved, area, c, shapes, heightM };
  });
  const totalArea = items.reduce((s, it) => s + it.area, 0);
  const margin = marginM ?? Math.min(150, Math.max(25, 0.08 * Math.sqrt(totalArea)));
  const stayM = Math.max(STAY_FACTOR * gapM, STAY_MIN_M);
  let thin = Infinity;
  for (const it of items) for (const s of it.shapes) thin = Math.min(thin, s.maxX - s.minX, s.maxY - s.minY);
  const minStep = Math.max(1, Math.min(tight ? 0.25 * gapM : 20, 0.2 * thin));
  // Wanted gap between two items (by index); a per-pair table when gapBetween is given.
  let gapOf = () => gapM;
  if (typeof gapBetween === 'function') {
    const n = items.length;
    const table = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const g = i === j ? gapM : Number(gapBetween(items[i].id, items[j].id));
      table[i * n + j] = Number.isFinite(g) && g >= 0 ? g : gapM;
    }
    gapOf = (a, b) => table[a * n + b];
  }
  const opts = { gapM, stayM, minStep, tight, gapOf };

  // --- 3. Groups: fields chained within about a mile of each other. -----------------------------
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (find(i) === find(j)) continue;
      const d = bodyDist(items[i].shapes, 0, 0, items[j].shapes.map((shape) => ({ shape })));
      if (d <= FAR_M) parent[find(j)] = find(i);
    }
  }
  const groupMap = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groupMap.has(r)) groupMap.set(r, []);
    groupMap.get(r).push(i);
  });
  const groups = [...groupMap.values()].map((idx) => {
    const area = idx.reduce((s, i) => s + items[i].area, 0);
    const c = [0, 0];
    for (const i of idx) { c[0] += items[i].c[0] * items[i].area; c[1] += items[i].c[1] * items[i].area; }
    if (area > 0) { c[0] /= area; c[1] /= area; } else { c[0] = items[idx[0]].c[0]; c[1] = items[idx[0]].c[1]; }
    return { idx, area, c };
  });
  // Main group: the most area (ties go to the one listed first).
  groups.sort((a, b) => b.area - a.area || a.idx[0] - b.idx[0]);
  const main = groups[0];

  // --- 4. Close the gaps inside each group. -----------------------------------------------------
  for (const g of groups) {
    const bodies = g.idx.map((i) => ({ shapes: items[i].shapes, keys: items[i].shapes.map(() => i), c: items[i].c, item: items[i] }));
    placeBodies(bodies, g.c, [], opts);
    for (const b of bodies) b.item.inner = b.offset;
    // The group as one rigid body, at its compacted positions.
    g.shapes = bodies.flatMap((b) => b.shapes.map((s) => shiftShape(s, b.offset[0], b.offset[1])));
    g.keys = bodies.flatMap((b) => b.keys);
    let ax = 0, ay = 0;
    for (const b of bodies) { ax += (b.c[0] + b.offset[0]) * b.item.area; ay += (b.c[1] + b.offset[1]) * b.item.area; }
    g.cc = g.area > 0 ? [ax / g.area, ay / g.area] : [bodies[0].c[0] + bodies[0].offset[0], bodies[0].c[1] + bodies[0].offset[1]];
  }

  // --- 5. Slide outlying groups in towards the main group. -------------------------------------
  const groupBodies = groups.map((g, k) => ({ shapes: g.shapes, keys: g.keys, c: g.cc, fixed: k === 0, group: g }));
  placeBodies(groupBodies, main.cc, [], opts);
  for (const b of groupBodies) for (const i of b.group.idx) {
    items[i].offset = [items[i].inner[0] + b.offset[0], items[i].inner[1] + b.offset[1]];
  }

  // --- 5b. Tight mode: one last pass over single fields, so whole groups that slid in as rigid
  // pieces don't leave wide gaps between them. Every field slides towards the island's middle.
  if (tight && items.length > 1) {
    let ax = 0, ay = 0;
    for (const it of items) { ax += (it.c[0] + it.offset[0]) * it.area; ay += (it.c[1] + it.offset[1]) * it.area; }
    const anchor = totalArea > 0 ? [ax / totalArea, ay / totalArea] : [items[0].c[0] + items[0].offset[0], items[0].c[1] + items[0].offset[1]];
    const fin = items.map((it, i) => ({
      shapes: it.shapes.map((s) => shiftShape(s, it.offset[0], it.offset[1])),
      keys: it.shapes.map(() => i),
      c: [it.c[0] + it.offset[0], it.c[1] + it.offset[1]],
      item: it,
    }));
    placeBodies(fin, anchor, [], opts);
    settleBodies(fin, anchor, opts);
    for (const b of fin) b.item.offset = [b.item.offset[0] + b.offset[0], b.item.offset[1] + b.offset[1]];
  }

  // --- 6. Labels for outlying groups (one label, on the group's biggest field). ----------------
  for (const g of groups.slice(1)) {
    const lead = g.idx.reduce((a, b) => (items[b].area > items[a].area ? b : a));
    // Real distance: from the lead field to the nearest field of the main group, centre to centre.
    let dist = Infinity;
    for (const m of main.idx) dist = Math.min(dist, Math.hypot(items[lead].c[0] - items[m].c[0], items[lead].c[1] - items[m].c[1]));
    const word = compassWord(g.c[0] - main.c[0], g.c[1] - main.c[1]);
    const it = items[lead];
    it.label = {
      text: `${(dist / MILE_M).toFixed(1)} mi ${word}`,
      at: [it.c[0] + it.offset[0], it.c[1] + it.offset[1]],
      distanceM: dist,
      direction: word,
    };
  }

  // --- 7. Island outline. ---------------------------------------------------------------------
  const islandRings = items.flatMap((it) => it.shapes.map((s) => {
    const r = [];
    for (let i = 0; i < s.n; i++) r.push([s.xs[i] + it.offset[0], s.ys[i] + it.offset[1]]);
    return r;
  }));
  const outline = buildOutline(islandRings, margin);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outline) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const center = [(minX + maxX) / 2, (minY + maxY) / 2];
  let radiusM = 0;
  for (const [x, y] of outline) radiusM = Math.max(radiusM, Math.hypot(x - center[0], y - center[1]));

  return {
    origin,
    project,
    unproject,
    marginM: margin,
    totalAreaM2: totalArea,
    fields: items.map((it) => ({
      id: it.id,
      polygons: it.polys.map((rings) => rings.map((r) => [...r.map((p) => [p[0], p[1]]), [r[0][0], r[0][1]]])),
      offset: it.offset,
      heightM: it.heightM,
      areaM2: it.area,
      centroid: it.c,
      label: it.label || null,
      ...(it.reserved.length ? { reserved: it.reserved.map((rings) => rings.map((r) => [...r.map((p) => [p[0], p[1]]), [r[0][0], r[0][1]]])) } : {}),
    })),
    outline,
    bounds: { minX, minY, maxX, maxY },
    center,
    radiusM,
  };
}
