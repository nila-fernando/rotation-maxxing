// The hub's camera: orbit round the island (drag to turn, scroll or pinch to zoom), eased flights to
// a field and back to the whole farm, and limits so the island can never be lost off screen.
//
// - The island is centred in the part of the screen the UI leaves free (the sidebar covers the
//   left edge on a laptop, the field sheet covers the bottom on a phone): the camera's view offset
//   moves the picture's centre without changing what the camera looks at.
// - Zoom is clamped between a close look at a field and a little past the whole island.
// - The look-at point never leaves the island, and when you zoom right out it drifts back to the
//   middle, so turning round a field near the edge can't swing the island away.
//
//   const rig = createCameraRig({ camera, controls, center, radius, getInsets })
//   rig.layout()               after a resize or when the UI around the island changes
//   rig.overview()             ease back to the whole farm
//   rig.focus({ center, radius, y })   ease to a field
//   rig.update(dt)             every frame, before controls.update()
import * as THREE from 'three';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * How far back the camera sits so a circle of `radius` fits the free part of the screen.
 * @param {object} o
 * @param {number} o.radius      the island's radius
 * @param {number} o.fovDeg      the camera's vertical field of view
 * @param {number} o.height      full canvas height (px)
 * @param {number} o.freeWidth   width left free by the UI (px)
 * @param {number} o.freeHeight  height left free by the UI (px)
 * @param {number} [o.margin=0.8] below 1 lets the island's far side run a little behind the UI
 *   (the view is tilted, so a circle looks shorter than it is wide)
 */
export function fitDistance({ radius, fovDeg, height, freeWidth, freeHeight, margin = 0.8 }) {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const halfV = Math.atan((tanV * Math.max(1, freeHeight)) / Math.max(1, height));
  const halfH = Math.atan((tanV * Math.max(1, freeWidth)) / Math.max(1, height));
  return ((radius * 1.02) / Math.sin(Math.min(halfV, halfH))) * margin;
}

/** (x, z) pulled back inside a disc round (cx, cz). */
export function clampToDisc(x, z, cx, cz, r) {
  const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
  if (d <= r || d === 0) return [x, z];
  return [cx + (dx / d) * r, cz + (dz / d) * r];
}

/**
 * @param {object} o
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {import('three/examples/jsm/controls/OrbitControls.js').OrbitControls} o.controls
 * @param {THREE.Vector3} o.center       the middle of the island (the overview's look-at point)
 * @param {number} o.radius              the island's radius
 * @param {() => {left: number, right: number, top: number, bottom: number}} o.getInsets
 *   how much of each canvas edge the UI covers (px)
 * @param {() => boolean} [o.reducedMotion]  jump instead of easing
 */
export function createCameraRig({ camera, controls, center, radius, getInsets, reducedMotion = () => false }) {
  const size = { w: 1, h: 1 };
  const offset = { x: 0, y: 0 }; // the view offset in use (px)
  let offsetGoal = { x: 0, y: 0 };
  let overviewDist = 1;
  let anim = null;
  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();

  controls.enablePan = false;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = 1.25; // never down to the horizon
  // a grab or a scroll takes over from an eased flight
  const onStart = () => { if (anim) { finishOffset(); anim = null; } };
  controls.addEventListener('start', onStart);

  function finishOffset() {
    offset.x = offsetGoal.x;
    offset.y = offsetGoal.y;
    applyOffset();
  }

  function applyOffset() {
    camera.setViewOffset(size.w, size.h, -offset.x, -offset.y, size.w, size.h);
  }

  function currentDistance() {
    return camera.position.distanceTo(controls.target);
  }

  /** Puts the camera `dist` from `target`, keeping the direction it looks from. */
  function place(target, dist) {
    dir.subVectors(camera.position, controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0, 1, 1);
    dir.normalize();
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(dir, dist);
  }

  /**
   * Measures the free area again. animate: ease the island to its new spot (when the UI slides in);
   * otherwise it moves at once (a window resize).
   */
  function layout({ animate = false } = {}) {
    const canvas = controls.domElement;
    size.w = canvas.clientWidth || innerWidth;
    size.h = canvas.clientHeight || innerHeight;
    const ins = getInsets();
    const freeW = Math.max(1, size.w - ins.left - ins.right);
    const freeH = Math.max(1, size.h - ins.top - ins.bottom);
    offsetGoal = { x: (ins.left - ins.right) / 2, y: (ins.top - ins.bottom) / 2 };
    const before = overviewDist;
    overviewDist = fitDistance({ radius, fovDeg: camera.fov, height: size.h, freeWidth: freeW, freeHeight: freeH, margin: freeW < 700 ? 0.95 : 0.82 });
    controls.minDistance = Math.max(radius * 0.3, overviewDist * 0.22);
    controls.maxDistance = overviewDist * 1.3;
    if (!animate || reducedMotion()) {
      finishOffset();
      // keep the same framing relative to the whole farm
      const d = currentDistance();
      if (before > 1 && d > 0) place(controls.target.clone(), Math.min(controls.maxDistance, Math.max(controls.minDistance, d * (overviewDist / before))));
    }
    camera.updateProjectionMatrix();
    return overviewDist;
  }

  function flyTo(target, dist, duration = 0.75) {
    dist = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist));
    if (reducedMotion() || duration <= 0) {
      finishOffset();
      place(target, dist);
      anim = null;
      return;
    }
    anim = {
      t: 0,
      dur: duration,
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      fromDist: currentDistance(),
      toDist: dist,
      fromOffset: { ...offset },
    };
  }

  function overview(duration = 0.8) {
    flyTo(center, overviewDist, duration);
  }

  /** Eases to a field: its middle, close enough that it fills a good part of the free height. */
  function focus({ center: [x, z], radius: r, y }, duration = 0.75) {
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const ins = getInsets();
    const freeFrac = Math.max(0.3, (size.h - ins.top - ins.bottom) / size.h);
    const dist = Math.min(overviewDist * 0.75, (r * 3.2) / (tanV * freeFrac * 2));
    const [cx, cz] = clampToDisc(x, z, center.x, center.z, radius * 0.85);
    flyTo(new THREE.Vector3(cx, y, cz), dist, duration);
  }

  function update(dt) {
    if (anim) {
      anim.t = Math.min(1, anim.t + dt / anim.dur);
      const k = easeInOut(anim.t);
      tmp.copy(anim.fromTarget).lerp(anim.toTarget, k);
      place(tmp, anim.fromDist + (anim.toDist - anim.fromDist) * k);
      offset.x = anim.fromOffset.x + (offsetGoal.x - anim.fromOffset.x) * k;
      offset.y = anim.fromOffset.y + (offsetGoal.y - anim.fromOffset.y) * k;
      applyOffset();
      if (anim.t >= 1) anim = null;
      return;
    }
    // zoomed right out: the look-at point drifts back to the middle of the island
    const d = currentDistance();
    const pull = smoothstep(overviewDist * 0.9, overviewDist * 1.15, d) * Math.min(1, dt * 3);
    let tx = controls.target.x, tz = controls.target.z, ty = controls.target.y;
    if (pull > 0) {
      tx += (center.x - tx) * pull;
      ty += (center.y - ty) * pull;
      tz += (center.z - tz) * pull;
    }
    // and never leaves the island
    [tx, tz] = clampToDisc(tx, tz, center.x, center.z, radius * 0.85);
    if (tx !== controls.target.x || ty !== controls.target.y || tz !== controls.target.z) {
      const dx = tx - controls.target.x, dy = ty - controls.target.y, dz = tz - controls.target.z;
      controls.target.set(tx, ty, tz);
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
    }
  }

  function dispose() {
    controls.removeEventListener('start', onStart);
    camera.clearViewOffset();
  }

  return {
    layout,
    overview,
    focus,
    flyTo,
    update,
    dispose,
    get overviewDist() { return overviewDist; },
    get animating() { return !!anim; },
    /** Whether the camera is looking at something other than the whole farm. */
    get focused() { return controls.target.distanceTo(center) > radius * 0.05 || currentDistance() < overviewDist * 0.8; },
  };
}
