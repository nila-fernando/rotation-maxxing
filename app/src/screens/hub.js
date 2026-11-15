// Step 5 · The island hub: the farm's home screen from here on (Part 3.4).
//
//   centre        the 3D island (built by the reveal; drag to turn, scroll or pinch to zoom, clamped
//                 so the island can't be lost off screen, and kept over the windmill, the barn and
//                 everything else solid: the camera never goes inside them)
//   left          "Your fields": name, acres, last crop icon and a status dot per field
//   top           the current season and year; "Plan my next seasons" on the right
//   bottom right  Manami
//
// Hover a field (on the island or in the list): its outline lights up and a tooltip shows its name
// and acres. Click one (either place): the camera eases to it and an openFieldPanel event fires:
//   document.addEventListener('openFieldPanel', (e) => e.detail.id)   (the panel is Part 3.5)
// Esc, "Show the whole farm" or a click on open ground eases back out.
//
//   const hub = createHub({ onOpenFieldPanel, onPlan })
//   hub.show(island)              island = the reveal's result ({ fields, view })
//   hub.setStatus(id, status)     Part 3.5 colours the dots ('unknown' = grey)
//   hub.select(id) / hub.overview() / hub.hide()
//   hub.setPropPicker(fn)         things on the island a tap can open (the soil jars): fn(origin, dir)
//                                 -> { fieldId, tip: { title, note } } | null, asked before the fields;
//                                 a hit goes to the plan mode's onTap, else to onJarTap(fieldId)
//   hub.focusOn(spec, seconds)    the camera eases to { center, radius, y } (jumps with reduced motion)
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { formatAcres } from '../fields/geometry.js';
import { CROP_STYLE, cropKeyFor } from '../island/crops.js';
import { createCameraRig, MAX_POLAR } from '../island/cameraRig.js';
import { makeTents } from '../island/cameraSafety.js';
import { sailSpheres, themeKeepOuts } from '../island/coinStacks.js';
import { footprint, pickField } from '../island/picking.js';
import { cropBadge, hideCropTip, installCropTips } from '../ui/cropTip.js';

const CLICK_SLOP = 6; // px a press may move and still be a click rather than a turn of the island
const CLICK_MS = 650;
const EDGE_TOLERANCE = 0.08; // island units: a hover on the fence line still counts
const OUTLINE_LIFT = 0.05; // the outline floats just above the soil
const HOVER_COLOR = 0xfffaf0;
const SELECT_COLOR = 0xffd35c;
const EDGE_COLOR = 0x4a3020;
const MARK_CHANGED = 0x8fd8a4; // a plan view's "this field changes" outline (src/screens/planFutures.js)
export const MARK_FROST = 0x7cc6f2; // and its "a spring freeze can hurt the wheat here" outline (ice blue, on the dark edge so it reads on snow)
// the field list is a bottom sheet on narrow, tall-enough screens (same query as src/styles.css);
// everywhere else (including landscape phones) it's the left sidebar
export const SHEET_QUERY = '(max-width: 900px) and (min-height: 521px)';

export const STATUS_TEXT = {
  unknown: 'Not checked yet',
  green: 'Nothing to flag',
  amber: 'One thing to look at',
  red: 'A few things to look at',
};

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} [o]
 * @param {(id: string) => void} [o.onOpenFieldPanel]   a field was chosen (the check-up panel opens)
 * @param {() => void} [o.onCloseFieldPanel]           back to the whole farm (the panel closes)
 * @param {() => {right?: number, bottom?: number}} [o.getPanelInsets]  how much of the screen the panel covers
 * @param {() => void} [o.onPlan]   "Plan my next seasons" (Part 4)
 * @param {(fieldId: string) => void} [o.onJarTap]   a field's soil jar was tapped on the island
 * @param {(fn: () => any) => any} [o.atFullTheme]   fn() with the festival's things at full size
 *   (src/screens/timeTravel.js), so the camera's floor is measured over what they grow to
 */
export function createHub({ onOpenFieldPanel, onCloseFieldPanel, getPanelInsets = () => ({}), panelEl = null, onPlan, onJarTap, atFullTheme = (fn) => fn() } = {}) {
  const $ = (id) => document.getElementById(id);
  const root = $('hub');
  const panel = $('hubPanel');
  const list = $('hubList');
  const countEl = $('hubCount');
  const planBtn = $('hubPlan');
  const wholeBtn = $('hubWhole');
  const tip = $('hubTip');
  const statuses = new Map(); // id -> status key; kept across shows
  let session = null;
  let propPicker = null; // the soil jars' picker (main.js), asked before the fields
  // a dialog over the island (the jar test) has the island wait: no taps, no hover
  const dialogUp = () => document.body.classList.contains('jar-open');

  planBtn.addEventListener('click', () => {
    onPlan?.();
    document.dispatchEvent(new CustomEvent('planSeasons'));
  });
  wholeBtn.addEventListener('click', () => session?.overview());

  function show(island) {
    hide();
    if (!island?.view) return;
    session = startSession(island);
  }

  function hide() {
    session?.dispose();
    session = null;
    root.hidden = true;
    tip.hidden = true;
    list.replaceChildren();
    document.body.classList.remove('is-hub');
  }

  function setStatus(id, status) {
    statuses.set(id, status);
    session?.paintStatus(id);
  }

  // ------------------------------------------------------------------ one showing of the hub
  function startSession(island) {
    const { view } = island;
    const { camera, controls, canvas, scene } = view;
    const infoById = new Map(island.fields.map((f) => [f.id, f]));
    const fields = view.fields.map((vf) => {
      const info = infoById.get(vf.id) || {};
      const fp = footprint(vf.polygons);
      const cropKey = info.cropKey || cropKeyFor(info.crop || 'other');
      return {
        id: vf.id,
        name: info.name || 'Field',
        acres: info.acres,
        cropKey,
        cropLabel: info.crop ? (cropKey === 'other' ? String(info.crop) : CROP_STYLE[cropKey]?.label || String(info.crop)) : 'No crop on record',
        polygons: vf.polygons,
        topY: vf.topY,
        center: fp.center,
        radius: fp.radius,
        bbox: fp.bbox,
        row: null,
        outline: null,
      };
    });
    const byId = new Map(fields.map((f) => [f.id, f]));
    const offs = []; // undo list

    let hover = null; // { id, source: 'island' | 'list' }
    let selected = null;
    let pointer = null; // last pointer position over the canvas (client px)
    let pointerDirty = false;
    let press = null; // { x, y, t, id } of a press on the canvas
    let pressed = false; // a button is down on the canvas (turning the island): no hover
    let propHit = null; // a jar under the pointer ({ fieldId, tip }): its tooltip instead of a field's

    // ---------------------------------------------------------------- the field list
    const total = fields.reduce((s, f) => s + (Number.isFinite(f.acres) ? f.acres : 0), 0);
    countEl.textContent = `${fields.length} ${fields.length === 1 ? 'field' : 'fields'} · ${formatAcres(total)}`;
    list.replaceChildren(...fields.map((f) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hub-field';
      b.dataset.id = f.id;
      const crop = document.createElement('span');
      crop.className = 'hub-field__crop';
      crop.setAttribute('role', 'img');
      crop.setAttribute('aria-label', `Last crop: ${f.cropLabel}`);
      crop.dataset.crop = f.cropKey;
      // its name in the shared crop tip (no native title: that made a second tooltip)
      crop.dataset.cropTip = f.cropLabel;
      crop.dataset.cropSub = 'Last crop';
      crop.innerHTML = cropBadge(null, { key: f.cropKey, name: f.cropLabel, sub: 'Last crop', inControl: true, cls: 'crop-ico' });
      const text = document.createElement('span');
      text.className = 'hub-field__text';
      const name = document.createElement('span');
      name.className = 'hub-field__name';
      name.textContent = f.name;
      const meta = document.createElement('span');
      meta.className = 'hub-field__meta';
      meta.textContent = Number.isFinite(f.acres) ? formatAcres(f.acres) : '';
      text.append(name, meta);
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      b.append(crop, text, dot);
      li.appendChild(b);
      f.row = b;
      paintStatus(f.id);
      return li;
    }));

    const onListOver = (e) => {
      const b = e.target.closest?.('.hub-field');
      if (b) setHover(b.dataset.id, 'list');
    };
    const onListOut = (e) => {
      const b = e.target.closest?.('.hub-field');
      if (b && !b.contains(e.relatedTarget) && hover?.source === 'list') setHover(focusedRowId(), 'list');
    };
    const onListFocus = (e) => {
      const b = e.target.closest?.('.hub-field');
      if (b && b.matches(':focus-visible')) setHover(b.dataset.id, 'list');
    };
    // focus leaving a row: fall back to the row under the pointer (a mouse click moves focus
    // between rows without :focus-visible, and the hovered row should stay lit)
    const onListBlur = (e) => {
      if (hover?.source !== 'list') return;
      const next = e.relatedTarget?.closest?.('.hub-field');
      if (next && list.contains(next) && next.matches(':focus-visible')) return; // onListFocus takes it
      setHover(list.querySelector('.hub-field:hover')?.dataset.id ?? null, 'list');
    };
    const onListClick = (e) => {
      const b = e.target.closest?.('.hub-field');
      if (b) select(b.dataset.id);
    };
    const onListKey = (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const rows = [...list.querySelectorAll('.hub-field')];
      const i = rows.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
    };
    list.addEventListener('pointerover', onListOver);
    list.addEventListener('pointerout', onListOut);
    list.addEventListener('focusin', onListFocus);
    list.addEventListener('focusout', onListBlur);
    list.addEventListener('click', onListClick);
    list.addEventListener('keydown', onListKey);
    offs.push(() => {
      list.removeEventListener('pointerover', onListOver);
      list.removeEventListener('pointerout', onListOut);
      list.removeEventListener('focusin', onListFocus);
      list.removeEventListener('focusout', onListBlur);
      list.removeEventListener('click', onListClick);
      list.removeEventListener('keydown', onListKey);
    });
    const focusedRowId = () => (list.contains(document.activeElement) && document.activeElement.matches?.('.hub-field:focus-visible') ? document.activeElement.dataset.id : null);

    function paintStatus(id) {
      const f = byId.get(id);
      if (!f?.row) return;
      const st = statuses.get(id) || 'unknown';
      const dot = f.row.querySelector('.status-dot');
      dot.dataset.status = st;
      const label = `Status: ${STATUS_TEXT[st] || st}`;
      dot.title = label;
      dot.innerHTML = `<span class="sr-only">${label}</span>`;
    }

    // ---------------------------------------------------------------- outlines on the island
    // each outline is a dark edge with a bright line on top, so it reads on pale grass and dark soil
    const lineOpts = { depthTest: false, depthWrite: false, transparent: true };
    const lineMats = {
      hover: new LineMaterial({ ...lineOpts, color: HOVER_COLOR, linewidth: 3.5 }),
      hoverEdge: new LineMaterial({ ...lineOpts, color: EDGE_COLOR, linewidth: 7, opacity: 0.55 }),
      select: new LineMaterial({ ...lineOpts, color: SELECT_COLOR, linewidth: 4.5 }),
      selectEdge: new LineMaterial({ ...lineOpts, color: EDGE_COLOR, linewidth: 8, opacity: 0.6 }),
      // marks a plan view puts on fields (same shader as the others, so nothing new to compile):
      // green where the crop changes, a fainter green where only the money does
      markCrop: new LineMaterial({ ...lineOpts, color: MARK_CHANGED, linewidth: 4 }),
      markMargin: new LineMaterial({ ...lineOpts, color: MARK_CHANGED, linewidth: 4, opacity: 0.55 }),
      markFrost: new LineMaterial({ ...lineOpts, color: MARK_FROST, linewidth: 4 }),
    };
    const setResolution = () => Object.values(lineMats).forEach((m) => m.resolution.set(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight));
    setResolution();
    const outlineGroup = new THREE.Group();
    outlineGroup.name = 'field outlines';
    scene.add(outlineGroup);
    for (const f of fields) {
      const g = new THREE.Group();
      g.visible = false;
      for (const rings of f.polygons) {
        for (const ring of rings) {
          const pts = [];
          for (const [x, z] of ring) pts.push(x, f.topY + OUTLINE_LIFT, z);
          const [x0, z0] = ring[0], [xn, zn] = ring[ring.length - 1];
          if (x0 !== xn || z0 !== zn) pts.push(x0, f.topY + OUTLINE_LIFT, z0); // close the loop
          const geo = new LineGeometry();
          geo.setPositions(pts);
          for (const [mat, order] of [[lineMats.hoverEdge, 30], [lineMats.hover, 31]]) {
            const line = new Line2(geo, mat);
            line.renderOrder = order;
            line.frustumCulled = false;
            line.userData.edge = order === 30;
            g.add(line);
          }
        }
      }
      outlineGroup.add(g);
      f.outline = g;
    }
    offs.push(() => {
      scene.remove(outlineGroup);
      outlineGroup.traverse((o) => o.geometry?.dispose?.()); // shared by a ring's two lines: dispose is safe twice
      Object.values(lineMats).forEach((m) => m.dispose());
    });

    // marks a plan view has put on fields: id -> 'focus' | 'crop' | 'margin' | 'frost' (see setMarks)
    let marks = new Map();
    // which look a lit outline takes: selected (gold), then hover (cream), then the marks
    const OUTLINE_LOOK = {
      select: [lineMats.selectEdge, lineMats.select],
      hover: [lineMats.hoverEdge, lineMats.hover],
      focus: [lineMats.selectEdge, lineMats.select],
      crop: [lineMats.hoverEdge, lineMats.markCrop],
      margin: [lineMats.hoverEdge, lineMats.markMargin],
      frost: [lineMats.hoverEdge, lineMats.markFrost],
    };
    function paintOutlines() {
      for (const f of fields) {
        const look = f.id === selected ? 'select' : f.id === hover?.id ? 'hover' : OUTLINE_LOOK[marks.get(f.id)] ? marks.get(f.id) : null;
        f.outline.visible = !!look;
        if (!look) continue;
        const [edge, line] = OUTLINE_LOOK[look];
        f.outline.children.forEach((l) => { l.material = l.userData.edge ? edge : line; });
      }
    }

    /**
     * Lights fields up for a plan view: a Map (or [id, mark] pairs) of id -> 'focus' (gold),
     * 'crop' (green: the crop changes), 'margin' (faint green: same crop, different money) or
     * 'frost' (ice blue: a spring freeze can hurt the wheat there).
     * null clears them. Selection and hover still show over a mark.
     */
    function setMarks(map) {
      marks = new Map(map || []);
      paintOutlines();
    }

    // ---------------------------------------------------------------- hover and the tooltip
    function setHover(id, source = 'island') {
      if (id && propHit) { propHit = null; } // a field lit from the list (or the pointer moved off the jar)
      const next = id && byId.has(id) ? { id, source } : null;
      if (next?.id === hover?.id && next?.source === hover?.source) return;
      const prevId = hover?.id;
      hover = next;
      if (prevId !== next?.id) {
        byId.get(prevId)?.row?.classList.remove('is-hover');
        const row = byId.get(next?.id)?.row;
        row?.classList.add('is-hover');
        if (row && source === 'island') row.scrollIntoView({ block: 'nearest' });
      }
      canvas.style.cursor = hover?.source === 'island' || propHit ? 'pointer' : '';
      paintOutlines();
      if (!hover) { if (!propHit) tip.hidden = true; return; }
      fillTip(byId.get(hover.id));
      tip.hidden = false;
      tip.dataset.anchor = source;
      placeTip();
    }

    function fillTip(f) {
      const b = document.createElement('b');
      const s = document.createElement('span');
      if (propHit && planMode) {
        // planning: a tap on a jar goes to its field (not the jar test), so the tip is the field's
        const pf = byId.get(propHit.fieldId);
        const t = planMode.tipFor?.(propHit.fieldId) || {};
        b.textContent = t.title || pf?.name || '';
        s.textContent = t.note || '';
        tip.dataset.sev = String(t.sev || 0);
      } else if (propHit) {
        b.textContent = propHit.tip?.title || '';
        s.textContent = propHit.tip?.note || '';
        delete tip.dataset.sev;
      } else if (planMode?.tipFor) {
        // planning on the island: what's planned there, and what Manami thinks of it
        const t = planMode.tipFor(f.id) || {};
        b.textContent = t.title || f.name;
        s.textContent = t.note || '';
        tip.dataset.sev = String(t.sev || 0);
      } else {
        b.textContent = f.name;
        s.textContent = Number.isFinite(f.acres) ? formatAcres(f.acres) : '';
        delete tip.dataset.sev;
      }
      tip.replaceChildren(b, s);
    }

    // ---------------------------------------------------------------- planning on the island
    // While a plan mode is set (src/screens/islandPlanner.js): a tap on a field goes to it instead
    // of opening the check-up, the tooltip shows its view of the field, and while it's dragging a
    // crop it drives the hover itself (so touch drags light fields up too).
    let planMode = null;
    function setPlanMode(mode) {
      planMode = mode || null;
      if (hover || propHit) { fillTip(hover ? byId.get(hover.id) : null); placeTip(); }
    }
    /** Lights up the field under (x, y) (or none); returns its id. */
    function hoverAt(x, y) {
      pointer = { x, y };
      const id = pickAt(x, y);
      setHover(id, 'island');
      if (hover) { fillTip(byId.get(hover.id)); placeTip(); }
      return id;
    }
    /** The tooltip again (what's under the pointer changed, or the plan did). */
    function refreshTip() {
      if (hover || propHit) { fillTip(hover ? byId.get(hover.id) : null); placeTip(); }
    }

    const v = new THREE.Vector3();
    function placeTip() {
      if ((!hover && !propHit) || tip.hidden) return;
      if (pressed && (propHit || hover.source === 'island')) { tip.style.visibility = 'hidden'; return; } // turning the island
      const W = innerWidth - (getPanelInsets()?.right || 0); // keep clear of the check-up panel
      const H = innerHeight;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x, y;
      if ((propHit || hover.source === 'island') && pointer) {
        x = pointer.x + 16;
        y = pointer.y + 18;
        if (x + tw > W - 8) x = pointer.x - tw - 12;
        if (y + th > H - 8) y = pointer.y - th - 12;
      } else {
        const f = byId.get(hover.id);
        v.set(f.center[0], f.topY + 0.5, f.center[1]).project(camera);
        if (v.z > 1) { tip.style.visibility = 'hidden'; return; }
        const r = canvas.getBoundingClientRect();
        x = r.left + ((v.x + 1) / 2) * r.width - tw / 2;
        y = r.top + ((1 - v.y) / 2) * r.height - th - 10;
      }
      x = Math.max(8, Math.min(W - tw - 8, x));
      y = Math.max(8, Math.min(H - th - 8, y));
      tip.style.visibility = '';
      tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    // ---------------------------------------------------------------- picking on the canvas
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function pickAt(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      return pickField(raycaster.ray.origin, raycaster.ray.direction, fields, EDGE_TOLERANCE)?.id ?? null;
    }
    /** A jar (or other picked prop) under (x, y), or null. */
    function pickPropAt(clientX, clientY) {
      if (!propPicker) return null;
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      try { return propPicker(raycaster.ray.origin, raycaster.ray.direction) || null; } catch (e) { console.error('hub: prop picker', e); return null; }
    }
    /** The jar under the pointer: its tooltip and a pointer cursor (null: none). */
    function setPropHover(hit) {
      if (!hit && !propHit) return;
      if (hit && propHit && hit.fieldId === propHit.fieldId) { placeTip(); return; }
      propHit = hit || null;
      if (propHit) {
        if (hover) setHover(null);
        fillTip(null);
        tip.hidden = false;
        tip.dataset.anchor = 'island';
        canvas.style.cursor = 'pointer';
        placeTip();
      } else {
        canvas.style.cursor = hover?.source === 'island' ? 'pointer' : '';
        if (!hover) tip.hidden = true;
        else { fillTip(byId.get(hover.id)); placeTip(); }
      }
    }

    const onMove = (e) => {
      if (e.pointerType === 'touch') return; // no hover on touch; a tap selects
      if (planMode?.dragging) return; // the drag drives the hover
      pointer = { x: e.clientX, y: e.clientY };
      pointerDirty = true;
    };
    const onLeave = () => {
      pointer = null;
      setPropHover(null);
      if (hover?.source === 'island') setHover(null);
    };
    // A press is a tap only if it's the one pointer down: a second finger makes it a pinch.
    const down = new Set();
    const onDown = (e) => {
      if (e.button !== 0) return;
      down.add(e.pointerId);
      pressed = true;
      press = down.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null;
      placeTip(); // hides the tooltip while the island turns
    };
    const onUp = (e) => {
      if (!down.delete(e.pointerId)) return; // not a press that started on the island
      pressed = down.size > 0;
      pointerDirty = true; // look again for what's under the pointer (and show its tooltip again)
      const p = press;
      if (p?.id !== e.pointerId) return;
      press = null;
      if (e.button !== 0) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP || performance.now() - p.t > CLICK_MS) return; // a turn
      if (dialogUp()) return; // (the jar test is open over the island)
      // a soil jar first: it stands outside the fields, but a ray past it can still reach one
      const hit = pickPropAt(e.clientX, e.clientY);
      if (hit) {
        if (planMode) planMode.onTap?.(hit.fieldId);
        else onJarTap?.(hit.fieldId);
        return;
      }
      const id = pickAt(e.clientX, e.clientY);
      if (planMode) { planMode.onTap?.(id); return; }
      if (id) select(id);
      else if (selected || rig.focused) overview();
    };
    const onCancel = (e) => {
      down.delete(e.pointerId);
      pressed = down.size > 0;
      press = null;
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    offs.push(() => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.style.cursor = '';
    });
    // the camera moved without the pointer moving (wheel or pinch zoom, the turn coasting to a stop,
    // a flight, the drift back to the middle): look again for what's under the pointer
    const onCameraChange = () => { pointerDirty = true; };
    controls.addEventListener('change', onCameraChange);
    offs.push(() => controls.removeEventListener('change', onCameraChange));
    // turning the island hides a crop name left showing (it would float off its row)
    installCropTips(); // idempotent: main.js may have done it already
    controls.addEventListener('start', hideCropTip);
    offs.push(() => controls.removeEventListener('start', hideCropTip));

    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || dialogUp()) return;
      // text boxes keep Esc for themselves (the name box puts the old name back); switches don't
      if (e.target.closest?.('textarea, select, [contenteditable="true"], input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range])')) return;
      if (selected || rig.focused) { e.preventDefault(); overview(); }
    };
    addEventListener('keydown', onKey);
    offs.push(() => removeEventListener('keydown', onKey));

    // ---------------------------------------------------------------- camera
    const sheet = matchMedia(SHEET_QUERY);
    // planning on the island (src/screens/islandPlanner.js): the crop dock along the bottom, and
    // Manami above it on the right on wide screens (smaller ones tuck her away to her face)
    const dockEl = document.getElementById('isleDock');
    const planning = () => document.body.classList.contains('isle-planning') && dockEl && !dockEl.hidden;
    const dockInset = (H) => Math.max(0, H - dockEl.getBoundingClientRect().top + 12);
    // the plan views (src/screens/planFutures.js): their dock along the bottom, and the field card
    // on the right (or over the dock on phones), which getPanelInsets reports while they're on
    // (looked up each time: that mode is loaded later, and its markup may come with it)
    const futDock = () => document.getElementById('futDock');
    const futures = () => document.body.classList.contains('plan-futures') && !!futDock() && !futDock().hidden;
    const futInset = (H) => Math.max(0, H - futDock().getBoundingClientRect().top + 12);
    const getInsets = () => {
      const W = innerWidth, H = innerHeight;
      const side = getPanelInsets() || {};
      if (!sheet.matches) {
        // the sidebar on the left (offsetLeft/Width ignore its slide-in transform), the check-up on the right
        // (a short landscape phone tucks the sidebar away while the check-up is open)
        const shown = getComputedStyle(panel).visibility !== 'hidden';
        const left = shown ? Math.min(W * 0.4, panel.offsetLeft + panel.offsetWidth + 8) : 0;
        if (futures()) {
          const manamiRoom = W > 1000 && H > 520 ? Math.min(W * 0.22, 300) : 0;
          return { left, right: Math.min(Math.max(0, W - left - 120), Math.max(manamiRoom, side.right || 0)), top: 24, bottom: Math.min(H * 0.6, futInset(H)) };
        }
        if (planning()) {
          const manamiRoom = W > 1000 && H > 520 ? Math.min(W * 0.22, 300) : 0;
          return { left, right: Math.min(Math.max(0, W - left - 120), manamiRoom), top: 24, bottom: Math.min(H * 0.6, dockInset(H)) };
        }
        return { left, right: Math.min(Math.max(0, W - left - 120), side.right || 0), top: 64, bottom: 0 };
      }
      // phones and tablets: the field list (or the check-up over it) is a sheet along the bottom; while
      // planning the list steps aside for the dock
      if (futures()) return { left: 0, right: 0, top: 24, bottom: Math.min(H * 0.7, Math.max(futInset(H), side.bottom || 0)) };
      if (planning()) return { left: 0, right: 0, top: 24, bottom: Math.min(H * 0.6, dockInset(H)) };
      return { left: 0, right: 0, top: 104, bottom: Math.min(H * 0.6, Math.max(H - panel.offsetTop, side.bottom || 0, 0)) };
    };
    const rig = createCameraRig({ camera, controls, center: view.center, radius: view.radius, getInsets, reducedMotion });
    offs.push(() => rig.dispose());

    // Nothing solid may come between the camera and the farm: a floor shaped over the windmill (and
    // its sails), the barn, the silo, the trees, the festival's things and the ground, which the rig
    // keeps the camera over from now on (src/island/cameraSafety.js makeTents; the plan tour adds its
    // own flat floor on top and hands back to this one). The festival comes and goes and pops in, so
    // its things are measured again every second, at the size they grow to. Anything that can't
    // reach the lowest the camera can ever be (looking at the lowest field from the closest zoom any
    // layout allows, at the lowest angle) is left out.
    const lowestLook = Math.min(view.center.y, ...fields.map((f) => f.topY));
    const minCamY = lowestLook + view.radius * 0.3 * Math.cos(MAX_POLAR) - 0.25;
    const measureTents = () => {
      const theme = view.island?.getObjectByName('Festival themes');
      const boxes = theme ? atFullTheme(() => themeKeepOuts(theme, { pad: 0.15, split: 1, points: false, floorY: minCamY - 0.3 })) : [];
      return makeTents({ props: view.props || [], sails: sailSpheres(view.spinners), boxes, heightAt: view.heightAt, minY: minCamY });
    };
    let tentsAge = 0;
    rig.setClearance(measureTents());
    offs.push(() => rig.setClearance(null));

    const onResize = () => {
      rig.layout();
      setResolution();
      pointerDirty = true;
    };
    offs.push(view.onResize(onResize));
    const onLayoutChange = () => onResize();
    sheet.addEventListener('change', onLayoutChange);
    offs.push(() => sheet.removeEventListener('change', onLayoutChange));

    // ---------------------------------------------------------------- selection
    function select(id) {
      const f = byId.get(id);
      if (!f) return;
      selected = id;
      for (const g of fields) g.row?.setAttribute('aria-current', String(g.id === id));
      wholeBtn.hidden = false;
      paintOutlines();
      // the check-up panel opens first, so the free area (and the field's spot in it) is measured with it
      onOpenFieldPanel?.(id);
      document.dispatchEvent(new CustomEvent('openFieldPanel', { detail: { id } }));
      rig.layout({ animate: true }); // the panel and the button change the free area: measure it again
      rig.focus({ center: f.center, radius: f.radius, y: f.topY });
    }

    function overview() {
      const prev = selected;
      // focus on the button that hides, or inside the panel that closes: bring it back to the field's row
      const hadFocus = document.activeElement === wholeBtn || !!panelEl?.contains(document.activeElement);
      selected = null;
      for (const g of fields) g.row?.removeAttribute('aria-current');
      wholeBtn.hidden = true;
      // the button hides itself: keep keyboard focus in the list, on the field just left
      if (hadFocus) (byId.get(prev)?.row || list.querySelector('.hub-field'))?.focus({ preventScroll: true });
      paintOutlines();
      onCloseFieldPanel?.();
      document.dispatchEvent(new CustomEvent('closeFieldPanel'));
      rig.layout({ animate: true });
      rig.overview();
    }

    /**
     * The crop icon on a field's row for the year being looked at (the year selector), or back to
     * its last crop with info = null.
     */
    function setRowCrop(id, info) {
      const f = byId.get(id);
      const el = f?.row?.querySelector('.hub-field__crop');
      if (!el) return;
      const key = info ? info.key : f.cropKey;
      const text = info ? `${info.year}: ${info.label}` : `Last crop: ${f.cropLabel}`;
      el.dataset.crop = key || 'none';
      el.setAttribute('aria-label', text);
      const name = info ? info.label : f.cropLabel;
      const sub = info ? String(info.year) : 'Last crop';
      if (key) {
        el.dataset.cropTip = name;
        el.dataset.cropSub = sub;
      } else {
        delete el.dataset.cropTip;
        delete el.dataset.cropSub;
      }
      el.innerHTML = key ? cropBadge(null, { key, name, sub, inControl: true, cls: 'crop-ico' }) : '';
      el.classList.toggle('is-none', !key);
    }

    /** A field's new name: its row, and the tooltip if it's showing. */
    function renameField(id, name) {
      const f = byId.get(id);
      if (!f || !name) return;
      f.name = name;
      const n = f.row?.querySelector('.hub-field__name');
      if (n) n.textContent = name;
      if (hover?.id === id) fillTip(f);
    }

    // ---------------------------------------------------------------- every frame
    // Keeps 60 fps on slower laptops: if frames run long for a couple of seconds, draw at a lower
    // pixel ratio (down to 1).
    const perf = { sum: 0, n: 0 };
    // The reveal's fog is sized for a laptop's view of the island. A tall, narrow screen (or a dock
    // along the bottom) puts the camera further back, which would leave the whole island in the
    // haze: the fog moves back with the camera. A laptop's plain hub is left as it was (the check-up
    // opening on the right moves the camera back a little, and the fog shouldn't jump with it), and
    // when the fog does move it eases there with the camera instead of in one frame.
    let fogBase = null;
    let fogK = null; // how far back the fog sits now (1: where the reveal left it)
    const fitFog = (dt) => {
      const fog = view.scene?.fog;
      if (!fog) return;
      fogBase ??= { near: fog.near, far: fog.far };
      const follow = sheet.matches || futures() || planning();
      const want = follow ? Math.max(1, rig.overviewDist / (fogBase.near * 1.05)) : 1;
      if (want === fogK) return;
      if (fogK === null || reducedMotion()) fogK = want; // (the first frame: straight there)
      else {
        fogK += (want - fogK) * Math.min(1, Math.max(0, dt) * 4);
        if (Math.abs(want - fogK) < 1e-3) fogK = want;
      }
      fog.near = fogBase.near * fogK;
      fog.far = fogBase.far * fogK;
    };
    offs.push(() => { const fog = view.scene?.fog; if (fog && fogBase) { fog.near = fogBase.near; fog.far = fogBase.far; } });
    const frame = (dt) => {
      fitFog(dt);
      tentsAge += dt;
      if (tentsAge >= 1) { tentsAge = 0; rig.setClearance(measureTents()); }
      rig.update(dt);
      if (pointerDirty && pointer && !pressed && !dialogUp()) {
        pointerDirty = false;
        const hit = planMode?.dragging ? null : pickPropAt(pointer.x, pointer.y);
        if (hit) setPropHover(hit);
        else {
          setPropHover(null);
          const id = pickAt(pointer.x, pointer.y);
          if (id) setHover(id, 'island');
          else if (hover?.source === 'island') setHover(null);
        }
      }
      if (hover || propHit) placeTip();
      if (!document.hidden && dt > 0 && dt < 0.25) {
        perf.sum += dt;
        perf.n++;
        if (perf.sum > 2) {
          const avg = perf.sum / perf.n;
          const pr = view.renderer.getPixelRatio();
          if (avg > 1 / 45 && pr > 1) view.renderer.setPixelRatio(Math.max(1, pr - 0.25));
          perf.sum = 0;
          perf.n = 0;
        }
      }
    };
    offs.push(view.onFrame(frame));

    // ---------------------------------------------------------------- show
    root.hidden = false;
    wholeBtn.hidden = true;
    document.body.classList.add('is-hub');
    // the sidebar slides in; ease the island over to the space it leaves
    rig.layout({ animate: true });
    rig.overview(reducedMotion() ? 0 : 0.9);

    return {
      select,
      overview,
      paintStatus,
      renameField,
      setRowCrop,
      /** Measure the free area again (the check-up panel changed size). */
      relayout: () => rig.layout({ animate: true }),
      get selected() { return selected; },
      get hovered() { return hover?.id ?? null; },
      /** For debugging in the console: what the pointer handling thinks is going on. */
      get pointerState() { return { pressed, pointer, pointerDirty, down: [...down], press }; },
      fields,
      rig,
      pickAt,
      setPlanMode,
      setMarks,
      hoverAt,
      refreshTip,
      /** The reveal's island view this session draws on (camera, scene, props, frame hooks...). */
      view,
      /** No field lit, and the pointer forgotten (so a turn of the island doesn't re-light one under an old spot). */
      clearHover: () => { pointer = null; pointerDirty = false; setPropHover(null); setHover(null); },
      /** Look again for what's under the pointer (a jar came or went). */
      repick: () => { pointerDirty = true; },
      dispose() {
        offs.reverse().forEach((fn) => fn());
        offs.length = 0;
      },
    };
  }

  return {
    show,
    hide,
    setStatus,
    select: (id) => session?.select(id),
    overview: () => session?.overview(),
    renameField: (id, name) => session?.renameField(id, name),
    setRowCrop: (id, info) => session?.setRowCrop(id, info),
    setPlanMode: (m) => session?.setPlanMode(m),
    /** What a tap can open on the island besides the fields (the soil jars' pick), or null. */
    setPropPicker(fn) {
      propPicker = typeof fn === 'function' ? fn : null;
      session?.repick();
    },
    /** The camera eases to { center: [x, z], radius, y } (a soil jar, say); with reduced motion it jumps. */
    focusOn(spec, seconds = 0.75) {
      if (!spec || !session) return;
      session.rig.layout({ animate: !reducedMotion() });
      session.rig.focus(spec, reducedMotion() ? 0 : seconds);
    },
    get session() { return session; },
  };
}
