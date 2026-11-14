/**
 * Paddock geometry: lat/lng -> local metres, areas, and which paddocks touch
 * (and on which side). Computed once per farm by prepareFarm().
 */
import type { Farm, LngLat, Neighbour, PaddockId, PolygonInput, PreparedFarm, XY } from './types';

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** Two boundary segments closer than this (m) count as shared. */
const EDGE_TOLERANCE_M = 0.5;

/** Throws for farms we can't handle yet. North-side shading is hard-coded for the northern hemisphere. */
export function assertNorthernHemisphere(latitude: number): void {
  if (!(latitude >= 0)) {
    throw new Error(
      `Farm latitude ${latitude} is in the southern hemisphere. Shade logic currently assumes the ` +
        'northern hemisphere (tall crops shade the neighbour to their NORTH). Southern farms are not supported yet.',
    );
  }
}

/**
 * Equirectangular projection around a reference point, +y north.
 * Accurate to well under 1% across a farm (a few km).
 */
export function lngLatToLocal(points: LngLat[], origin: LngLat): XY[] {
  const [lng0, lat0] = origin;
  const kx = Math.cos(lat0 * DEG) * EARTH_RADIUS_M * DEG;
  const ky = EARTH_RADIUS_M * DEG;
  return points.map(([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky]);
}

/** Signed shoelace area: positive when the ring runs counter-clockwise. */
export function signedArea(ring: XY[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function polygonArea(ring: XY[]): number {
  return Math.abs(signedArea(ring));
}

/** Drop a repeated closing vertex and make the ring counter-clockwise. */
function normaliseRing(ring: XY[]): XY[] {
  let r = ring.slice();
  const first = r[0];
  const last = r[r.length - 1];
  if (r.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) r = r.slice(0, -1);
  if (signedArea(r) < 0) r.reverse();
  return r;
}

interface SharedEdge {
  lengthM: number;
  /** Outward normal of A's edge (unit), pointing toward B. */
  nx: number;
  ny: number;
  /** |east-west component| of the edge direction. */
  ewShare: number;
}

/** Collinear overlaps between the boundaries of ring A and ring B. */
function sharedEdges(a: XY[], b: XY[]): SharedEdge[] {
  const out: SharedEdge[] = [];
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const ux = dx / len;
    const uy = dy / len;
    for (let j = 0; j < b.length; j++) {
      const r = b[j]!;
      const s = b[(j + 1) % b.length]!;
      // Perpendicular distance of B's endpoints from A's edge line.
      const dr = Math.abs((r[0] - p[0]) * uy - (r[1] - p[1]) * ux);
      const ds = Math.abs((s[0] - p[0]) * uy - (s[1] - p[1]) * ux);
      if (dr > EDGE_TOLERANCE_M || ds > EDGE_TOLERANCE_M) continue;
      // Overlap of the projections onto A's edge.
      const tr = (r[0] - p[0]) * ux + (r[1] - p[1]) * uy;
      const ts = (s[0] - p[0]) * ux + (s[1] - p[1]) * uy;
      const lo = Math.max(0, Math.min(tr, ts));
      const hi = Math.min(len, Math.max(tr, ts));
      const overlap = hi - lo;
      if (overlap > EDGE_TOLERANCE_M) {
        // Ring is counter-clockwise, so the outward normal is (uy, -ux).
        out.push({ lengthM: overlap, nx: uy, ny: -ux, ewShare: Math.abs(ux) });
      }
    }
  }
  return out;
}

function toLocal(polygon: PolygonInput, origin: LngLat | null): XY[] {
  if ('localM' in polygon) return polygon.localM;
  if (!origin) throw new Error('Internal: lng/lat polygon without an origin');
  return lngLatToLocal(polygon.lngLat, origin);
}

/** Centroid (vertex mean) of all lng/lat vertices on the farm, or null if none are lng/lat. */
function lngLatOrigin(farm: Farm): LngLat | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of farm.paddocks) {
    if ('lngLat' in p.polygon) {
      for (const [lng, lat] of p.polygon.lngLat) {
        sx += lng;
        sy += lat;
        n++;
      }
    }
  }
  return n > 0 ? [sx / n, sy / n] : null;
}

/**
 * Resolve geometry once: local polygons (m), areas and the adjacency graph
 * with shared edge lengths and the side each neighbour is on.
 */
export function prepareFarm(farm: Farm): PreparedFarm {
  assertNorthernHemisphere(farm.latitude);
  const origin = lngLatOrigin(farm);
  const polygons: Record<PaddockId, XY[]> = {};
  const areaM2: Record<PaddockId, number> = {};
  for (const p of farm.paddocks) {
    const ring = normaliseRing(toLocal(p.polygon, origin));
    polygons[p.id] = ring;
    areaM2[p.id] = polygonArea(ring);
  }

  const adjacency: Record<PaddockId, Neighbour[]> = {};
  for (const a of farm.paddocks) {
    const list: Neighbour[] = [];
    for (const b of farm.paddocks) {
      if (a.id === b.id) continue;
      const edges = sharedEdges(polygons[a.id]!, polygons[b.id]!);
      if (edges.length === 0) continue;
      let shared = 0;
      let north = 0;
      let nx = 0;
      let ny = 0;
      for (const e of edges) {
        shared += e.lengthM;
        nx += e.nx * e.lengthM;
        ny += e.ny * e.lengthM;
        // B is north of A along this edge: noon shadows from A fall across it.
        if (e.ny > 1e-6) north += e.lengthM * e.ewShare;
      }
      const side: Neighbour['side'] =
        Math.abs(ny) >= Math.abs(nx) ? (ny > 0 ? 'north' : 'south') : nx > 0 ? 'east' : 'west';
      list.push({ paddockId: b.id, sharedEdgeM: shared, northEdgeM: north, side });
    }
    adjacency[a.id] = list;
  }
  return { farm, polygons, areaM2, adjacency };
}

export const SQ_M_PER_ACRE = 4046.8564224;
