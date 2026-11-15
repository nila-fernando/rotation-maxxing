// "When they see me rotate…": Manami turning slowly on the spot, like the spinning-cat video but
// at a sheep's pace.
//
//   turntable   the real 3D Manami (manami.glb) turning on top of the "Getting your farm's data"
//               card while the data loads, with her line in a bubble beside her
//   farm        on the island, every now and then she stops wherever she is, turns twice on the
//               spot, and the same bubble floats over her head
//
// Turning on the spot keeps her on her own patch of ground, so nothing new can clip. With reduced
// motion she doesn't turn: the card shows her still, and the farm leaves her be.
//
//   const tt = createTurntable(hostEl)          tt.start()  tt.stop()
//   const spins = createFarmSpins(view)         spins.now()  spins.dispose()
import * as THREE from 'three';
import { loadSheepTemplate, makeSheep } from '../island/props.js';

export const ROTATE_LINE = 'When they see me rotate…';
const TURN_SPEED = (Math.PI * 2) / 1.8; // one turn in 1.8 s: slow, for a spinning cat
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Manami turning on a little stage of her own (a small canvas with its own scene and light).
 * @param {HTMLElement} host   where her stage and bubble go (the checklist card)
 */
export function createTurntable(host) {
  let el = null;
  let renderer = null;
  let raf = 0;
  let run = 0;

  async function start() {
    stop();
    const id = ++run;
    el = document.createElement('div');
    el.className = 'rotate-manami';
    el.setAttribute('aria-hidden', 'true'); // a joke for the eyes; the screen reader keeps to the checklist
    el.innerHTML = `<p class="rotate-bubble">${ROTATE_LINE}</p><canvas class="rotate-manami__stage" width="240" height="240"></canvas>`;
    host.appendChild(el);
    const canvas = el.querySelector('canvas');
    let template;
    try {
      template = await loadSheepTemplate();
    } catch {
      return; // no model: the bubble still shows, she just isn't there to turn
    }
    if (id !== run) return;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.setSize(canvas.clientWidth || 120, canvas.clientHeight || 120, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a6a4f, 2.2));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const manami = makeSheep(template, { wool: 'black', pose: 'stand', scale: 1 });
    manami.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    scene.add(manami);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 0.85, 2.6);
    camera.lookAt(0, 0.48, 0);
    let last = performance.now();
    const frame = (now) => {
      if (id !== run) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!reducedMotion()) manami.rotation.y += dt * TURN_SPEED;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    run++;
    cancelAnimationFrame(raf);
    raf = 0;
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = null;
    }
    el?.remove();
    el = null;
  }

  return { start, stop };
}

/**
 * Manami turning on the spot on the island, now and then, with her bubble over her head.
 * @param {object} view   the reveal's view (flock, camera, canvas, onAfterFrame)
 * @param {object} [o]
 * @param {number} [o.firstAfter]   seconds before the first turn
 * @param {[number, number]} [o.every]  seconds between turns (a random time in this range)
 */
export function createFarmSpins(view, { firstAfter = 14, every = [40, 80] } = {}) {
  const sheep = view.flock?.sheep?.find((s) => s.g.children[0]?.name === 'Manami');
  if (!sheep || !view.flock.spin) return { now() {}, dispose() {} };
  const bubble = document.createElement('p');
  bubble.className = 'rotate-bubble rotate-bubble--farm';
  bubble.setAttribute('aria-hidden', 'true');
  bubble.textContent = ROTATE_LINE;
  bubble.hidden = true;
  document.body.appendChild(bubble);
  const head = new THREE.Vector3();
  let showing = false;
  let timer = setTimeout(tryTurn, firstAfter * 1000);
  const later = (s) => { clearTimeout(timer); timer = setTimeout(tryTurn, s * 1000); };
  const nextGap = () => every[0] + Math.random() * (every[1] - every[0]);

  /** Where her head is on screen, or null when she's out of sight or under the UI. */
  function headOnScreen() {
    sheep.g.getWorldPosition(head);
    head.y += sheep.size * 1.25;
    const v = head.project(view.camera);
    if (v.z > 1 || v.z < -1) return null;
    const r = view.canvas.getBoundingClientRect();
    const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
    if (x < 40 || x > innerWidth - 40 || y < 70 || y > innerHeight - 40) return null;
    // not under the field list, Manami's own bubble, the plan dock or a panel
    const under = document.elementFromPoint(x, y);
    if (under && under !== view.canvas && !under.closest?.('.rotate-bubble, .fut-chips, .isle-badges')) return null;
    return { x, y };
  }

  // a farmer busy in a panel, planning, or walking through the plans with her doesn't need a
  // dancing sheep (her bubble would sit on the plan chips and talk over her own walk)
  const busy = () => document.hidden || reducedMotion()
    || ['plans-open', 'checkup-open', 'isle-dragging', 'isle-planning', 'plan-futures'].some((c) => document.body.classList.contains(c));

  function tryTurn() {
    if (busy() || !headOnScreen()) { later(8); return; }
    view.flock.spin(sheep, { turns: 2, duration: 2 * 1.8 * 1.15, onDone: () => { setTimeout(hide, 700); } });
    showing = true;
    bubble.hidden = false;
    requestAnimationFrame(() => bubble.classList.add('is-on'));
    later(nextGap());
  }

  function hide() {
    showing = false;
    bubble.classList.remove('is-on');
    setTimeout(() => { if (!showing) bubble.hidden = true; }, 250);
  }

  // over her head every frame she's turning, once the frame is drawn (so it never lags her)
  const off = view.onAfterFrame?.(() => {
    if (!showing) return;
    const at = headOnScreen();
    if (!at) { bubble.style.visibility = 'hidden'; return; }
    bubble.style.visibility = '';
    bubble.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
  });

  return {
    /** Turns now (if she's in sight): for trying it out in the console. */
    now() { clearTimeout(timer); tryTurn(); },
    dispose() {
      clearTimeout(timer);
      off?.();
      bubble.remove();
    },
  };
}
