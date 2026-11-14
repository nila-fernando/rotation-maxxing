// Which field is under the pointer on the island, without raycasting thousands of crop instances.
//
// Every field's soil bed has a flat top at a known height (its contour step plus the bed height),
// so a ray from the camera is intersected with each field's top plane and the hit point is tested
// against the field's real outline. The nearest hit along the ray wins (a field on a higher step
// in front hides one behind it).
//
// Polygons are [[outerRing, ...holes], ...], rings are [[x, z], ...] in island units.

/** Whether (x, z) is inside the polygons (inside an outer ring and not in one of its holes). */
export function pointInPolygons(x, z, polygons) {
  for (const rings of polygons) {
    if (!inRing(x, z, rings[0])) continue;
    let inHole = false;
    for (let h = 1; h < rings.length && !inHole; h++) inHole = inRing(x, z, rings[h]);
    if (!inHole) return true;
  }
  return false;
}

function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to the nearest edge of any ring. */
export function distanceToEdges(x, z, polygons) {
  let best = Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[j], [bx, bz] = ring[i];
        const vx = bx - ax, vz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
        best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
      }
    }
  }
  return best;
}

/**
 * The middle of a field (area-weighted centroid of its outer rings), the radius of a circle round
 * it that holds every corner, and its bounding box. Used to aim the camera and to skip far fields.
 */
export function footprint(polygons) {
  let ax = 0, az = 0, aw = 0;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const rings of polygons) {
    const ring = rings[0];
    let a = 0, cx = 0, cz = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      const cross = xj * zi - xi * zj;
      a += cross;
      cx += (xj + xi) * cross;
      cz += (zj + zi) * cross;
      x0 = Math.min(x0, xi); z0 = Math.min(z0, zi); x1 = Math.max(x1, xi); z1 = Math.max(z1, zi);
    }
    if (Math.abs(a) > 1e-12) {
      ax += cx / 3;
      az += cz / 3;
      aw += a;
    }
  }
  const center = Math.abs(aw) > 1e-12 ? [ax / aw, az / aw] : [(x0 + x1) / 2, (z0 + z1) / 2];
  let radius = 0;
  for (const rings of polygons) for (const [x, z] of rings[0]) radius = Math.max(radius, Math.hypot(x - center[0], z - center[1]));
  return { center, radius, bbox: [x0, z0, x1, z1] };
}

/**
 * The field a ray hits first, or null.
 * @param {{x: number, y: number, z: number}} origin
 * @param {{x: number, y: number, z: number}} dir   need not be normalised
 * @param {{id: string, polygons: Array, topY: number, bbox?: number[]}[]} fields
 * @param {number} [tolerance=0]  also count hits this close outside a field's edge (the fence line)
 * @returns {{id: string, t: number, point: [number, number, number]} | null}
 */
export function pickField(origin, dir, fields, tolerance = 0) {
  let best = null;
  if (Math.abs(dir.y) < 1e-9) return null; // looking dead level: never meets a top plane
  for (const f of fields) {
    const t = (f.topY - origin.y) / dir.y;
    if (!(t > 0) || (best && t >= best.t)) continue;
    const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
    if (f.bbox) {
      const [x0, z0, x1, z1] = f.bbox;
      if (x < x0 - tolerance || x > x1 + tolerance || z < z0 - tolerance || z > z1 + tolerance) continue;
    }
    if (pointInPolygons(x, z, f.polygons) || (tolerance > 0 && distanceToEdges(x, z, f.polygons) <= tolerance)) {
      best = { id: f.id, t, point: [x, f.topY, z] };
    }
  }
  return best;
}
