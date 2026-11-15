// The soil jar test dialog (#jar): a photo of a settled jar of soil and water -> the field's sand,
// silt and clay, which the planner then uses instead of the soil map's texture.
//
//   1 How to      Manami's line, the four steps, "How long has it settled?", and a photo: take one
//                 (phones), choose one, or try the sample jar
//   2 Photo       draw the box round the jar's contents (drag on the photo, or pick an edge and use
//                 the arrow keys or the step buttons: the keyboard way round)
//   3 Layers      the layers found, over the photo and in a list to fix (label, move the lines,
//                 split, join up, or "I'll mark the layers myself")
//   4 Your soil   the result beside the layers (below them on phones), and "Use for West 140" once
//                 the gates in src/plan/jarTest.js let it through
//
// A field whose jar test was saved earlier but whose photo isn't in this session opens on step 4
// with the saved bands (the photo is never kept: "Your photo stays on this device").
//
//   const jar = createJarPanel({ getFields, isDemoFarm, getMapTexture, onUse, onRemove, onOpen, onClose, session })
//   jar.open({ fieldId?, step?: 'howto' | 'result', from: 'checkup' | 'island' | 'farm' | 'futures' })
//   jar.close()
//   jar.isOpen
//
// onUse(record, { from }) gets the JarRecord (src/plan/jarTest.js toRecord); onRemove(fieldId, { from })
// "Stop using it". session is a Map fieldId -> this session's photo and layers, so "See your jar"
// comes back to them. All the jar logic is in src/plan/jarTest.js; this file is the DOM round it.
import {
  LAYER_TYPES, LAYER_TYPE_ORDER, setLayerType, splitLayer, mergeLayerUp, boundaryLines,
  WORK_MAX, SAMPLE_BOX, defaultBox, cleanBox, nudgeBox, boxLabel, edgeLabel, analysePhoto, safeMove, withElapsed,
  markByHand, verdict, layerRows, layersLabel, toRecord, warnLines, reasonLine, JAR_LINES,
} from '../plan/jarTest.js';
import { paintSampleJar } from '../plan/jarSample.js';
import { JAR, CAMERA, IMAGE, SPLIT, MERGE } from '../ui/jarIcons.js';
import { ACTION_ICONS } from '../ui/futureIcons.js';
import { asset } from '../ui/asset.js';

const MANAMI_SVG = asset('/manami.svg');

const SHEET_QUERY = '(max-width: 900px) and (min-height: 521px)'; // as in hub.js and styles.css
const EDGE_GRAB = 12; // css px: a drag starting this near an edge moves that edge
const LINE_GRAB = 12; // css px: and this near a layer line moves the line
const ANNOUNCE_MS = 250;
const STEP_INDEX = { howto: 0, photo: 1, layers: 2, earlier: 3 };
const SETTLE = [['short', 'Under 2 hours'], ['mid', '2 to 24 hours'], ['ok', 'A day or more']];
const EDGES = [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']];
const CONFIDENCE = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', adjusted: 'Adjusted by you' };
const HOWTO = [
  'Fill a clear, straight-sided jar a third full with soil from this field.',
  'Top it up with water and a drop of dish soap. Shake it hard for 3 minutes.',
  'Set it down and leave it. Clay takes a day or two to settle.',
  'Take a photo from the side, in even light, with the jar filling the picture.',
];
const RECORD_SIZE = { width: 200, height: 300 }; // the drawn jar for a saved record (no photo)

/**
 * This session's photo and layers for a field, but only while they are what the field uses: the
 * entry made the record the field holds now (an Undo or a newer jar leaves it behind). Else null.
 */
export function keptFor(kept, saved) {
  return kept && saved && kept.at != null && kept.at === saved.at ? kept : null;
}

const UP = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 14.5l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lower = (s) => String(s ?? '').toLowerCase();
const pct = (v) => (Number.isFinite(v) ? Math.round(v) : 0);

/** The sand, silt and clay bar: its segments in the module's layer colours, the numbers for screen readers. */
export function barHtml(sandPct, siltPct, clayPct) {
  const parts = [['sand', 'Sand', sandPct], ['silt', 'Silt', siltPct], ['clay', 'Clay', clayPct]];
  const label = parts.map(([, name, v], i) => `${i ? name.toLowerCase() : name} ${pct(v)}%`).join(', ');
  return `<div class="jar-bar" role="img" aria-label="${esc(label)}">${parts.map(([key, name, v]) => `<span class="jar-bar__seg is-${key}" style="--w:${Math.max(0, pct(v))}%; background:${LAYER_TYPES[key].color}">${pct(v) >= 12 ? `${name} ${pct(v)}%` : ''}</span>`).join('')}</div>`;
}

/** A radio group of buttons (roving tabindex): the settling time, or the box edge. */
function segHtml(name, labelId, options, value) {
  return `<div class="jar-seg" role="radiogroup" aria-labelledby="${labelId}" data-seg="${name}">${options.map(([v, text]) => {
    const on = v === value;
    return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-v="${v}" data-key="${name}-${v}">${esc(text)}</button>`;
  }).join('')}</div>`;
}

/**
 * @param {object} o
 * @param {() => Array} o.getFields              the app's fields ({ id, name, jar? })
 * @param {() => boolean} [o.isDemoFarm]          the sample jar may only be used on the demo farm
 * @param {(id: string) => string|null} [o.getMapTexture]   the soil map's texture for a field
 * @param {(record: object, info: { from: string }) => void} o.onUse
 * @param {(fieldId: string, info: { from: string }) => void} [o.onRemove]
 * @param {(info: { from: string }) => void} [o.onOpen]   [o.onClose]
 * @param {Map} [o.session]   fieldId -> this session's photo and layers
 */
export function createJarPanel({ getFields, isDemoFarm = () => false, getMapTexture = () => null, onUse, onRemove, onOpen, onClose, session = new Map() }) {
  const $ = (id) => document.getElementById(id);
  const root = $('jar');
  const title = $('jarTitle');
  const select = $('jarField');
  const stepsEl = $('jarSteps');
  const body = $('jarBody');
  const foot = $('jarFoot');
  const live = $('jarLive');
  const sheet = matchMedia(SHEET_QUERY);
  const coarse = matchMedia('(pointer: coarse)');

  // the photo (or the drawn jar) lives in one canvas, moved into each step's markup
  const canvas = document.createElement('canvas');
  canvas.className = 'jar-canvas';
  const ctx = canvas.getContext('2d');
  // (only a change of width refits: the canvas's own height changes the wrap's)
  let wrapW = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
    const w = Math.round(entries[0]?.contentRect.width || 0);
    if (w !== wrapW) { wrapW = w; requestAnimationFrame(() => fit()); }
  }) : null;

  let from = 'farm';
  let opener = null;
  let run = 0; // a close (or a newer read) makes a late "Find the layers" moot
  let fieldId = null;
  let step = 'howto';
  let img = null; // { data, width, height } at most WORK_MAX on its long side
  let photo = null; // a canvas holding img, for drawing
  let sample = false;
  let box = null;
  let edge = 'top';
  let elapsed = 'ok';
  let analysis = null;
  let record = null; // a saved jar test shown without its photo (step 'earlier')
  let says = []; // Manami's lines in the dialog
  let note = ''; // a module message (a split that can't be done), said under her lines
  let busy = false;
  let drag = null;
  let scale = 1;
  let view = { x: 0, y: 0, w: 1, h: 1 }; // the part of the photo the canvas shows (image pixels)
  let dpr = 1;
  let resultSig = '';
  let announceTimer = 0;

  const fields = () => getFields?.() || [];
  const fieldOf = (id) => fields().find((f) => f.id === id) || null;
  const nameOf = (id) => fieldOf(id)?.name || 'this field';
  const dims = () => (step === 'earlier' ? RECORD_SIZE : img ? { width: img.width, height: img.height } : RECORD_SIZE);

  // ---------------------------------------------------------------- open and close

  function open({ fieldId: want = null, step: wantStep = 'howto', from: f = 'farm' } = {}) {
    const list = fields();
    if (!list.length) return;
    if (root.hidden) {
      const a = document.activeElement;
      opener = a && a !== document.body && a.getClientRects().length ? a : null;
    }
    from = f;
    run++;
    endDrag();
    fieldId = list.some((x) => x.id === want) ? want : (list.find((x) => !x.jar) || list[0]).id;
    resetWork();
    const saved = fieldOf(fieldId)?.jar || null;
    const kept = keptFor(session.get(fieldId), saved);
    if (wantStep === 'result' && kept) {
      ({ img, photo, box, analysis, elapsed, sample } = kept);
      step = 'layers';
      says = [JAR_LINES.found(analysis.layers.length)];
    } else if (wantStep === 'result' && saved) {
      record = saved;
      step = 'earlier';
      says = [JAR_LINES.earlier];
    } else {
      step = 'howto';
      says = [JAR_LINES.howto];
    }
    const wasHidden = root.hidden;
    root.hidden = false;
    document.body.classList.add('jar-open');
    if (wasHidden) onOpen?.({ from });
    fillSelect();
    render();
    title.focus({ preventScroll: true });
  }

  function resetWork() {
    img = photo = box = analysis = record = null;
    sample = false;
    edge = 'top';
    elapsed = 'ok';
    note = '';
    busy = false;
    resultSig = '';
  }

  function close({ restore = true } = {}) {
    if (root.hidden) return;
    run++;
    endDrag();
    clearTimeout(announceTimer);
    ro?.disconnect();
    const hadFocus = root.contains(document.activeElement) || document.activeElement === document.body;
    root.hidden = true;
    document.body.classList.remove('jar-open');
    resetWork();
    body.replaceChildren();
    foot.replaceChildren();
    try { onClose?.({ from }); } catch (e) { console.error(e); }
    if (restore && hadFocus) {
      const back = opener?.isConnected && opener.getClientRects().length ? opener
        : document.querySelector('#checkup:not([hidden]) [data-jar]') || $('hubJar') || $('hubPlan');
      back?.focus({ preventScroll: true });
    }
    opener = null;
  }

  function fillSelect() {
    select.innerHTML = fields().map((f) => `<option value="${esc(f.id)}"${f.id === fieldId ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
  }

  // ---------------------------------------------------------------- drawing the steps

  function render() {
    const focusKey = root.contains(document.activeElement) ? document.activeElement.dataset?.key || null : null;
    const i = STEP_INDEX[step];
    [...stepsEl.children].forEach((li, k) => {
      if (k === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.classList.toggle('is-done', k < i);
    });
    canvas.remove();
    resultSig = '';
    if (step === 'howto') renderHowto();
    else if (step === 'photo') renderPhoto();
    else if (step === 'layers') renderLayers();
    else renderEarlier();
    const wrap = body.querySelector('.jar-canvas-wrap');
    if (wrap) {
      wrap.appendChild(canvas);
      ro?.disconnect();
      wrapW = Math.round(wrap.clientWidth);
      ro?.observe(wrap);
      fit();
    }
    if (focusKey) refocus(focusKey);
  }

  /** Focus back on the control it was on before a redraw (or the nearest one left). */
  function refocus(key) {
    let el = root.querySelector(`[data-key="${key}"]`);
    const m = /^(type|up|down|split|merge)-(\d+)$/.exec(key);
    if (!el && m) el = root.querySelector(`[data-key="type-${Math.max(0, Number(m[2]) - 1)}"]`);
    if (el && !el.disabled) el.focus({ preventScroll: true });
    else if (el) el.closest('li')?.querySelector('select')?.focus({ preventScroll: true });
    else title.focus({ preventScroll: true }); // (that control is gone: Back to How to, say)
  }

  const saysHtml = () => `<div class="says jar-says">
      <p class="says__title"><img src="${MANAMI_SVG}" alt="" width="24" height="22">Manami</p>
      ${says.map((l) => `<p>${esc(l)}</p>`).join('')}
      ${note ? `<p class="jar-says__note">${esc(note)}</p>` : ''}
    </div>`;

  function renderHowto() {
    body.innerHTML = `${saysHtml()}
      <ol class="jar-howto">${HOWTO.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <div class="jar-q"><p class="jar-q__label" id="jarSettleLabel">How long has it settled?</p>${segHtml('settle', 'jarSettleLabel', SETTLE, elapsed)}</div>
      <div class="jar-pick">
        ${coarse.matches ? `<label class="btn btn--primary jar-file">${CAMERA}<span>Take a photo</span><input type="file" accept="image/*" capture="environment" class="sr-only" data-key="camera"></label>` : ''}
        <label class="btn ${coarse.matches ? 'btn--quiet' : 'btn--primary'} jar-file">${IMAGE}<span>Choose a photo</span><input type="file" accept="image/*" class="sr-only" data-key="file"></label>
        <button class="btn btn--quiet" type="button" data-act="sample" data-key="sample">${JAR}<span>Try a sample jar</span></button>
      </div>`;
    foot.innerHTML = '<button class="btn btn--quiet btn--small" type="button" data-act="close" data-key="fclose">Close</button>';
  }

  function renderPhoto() {
    const vertical = edge === 'top' || edge === 'bottom';
    const [a, b] = vertical ? [['up', UP, 'up'], ['down', DOWN, 'down']] : [['left', ACTION_ICONS.chevronLeft, 'left'], ['right', ACTION_ICONS.chevronRight, 'right']];
    const edgeName = EDGES.find(([k]) => k === edge)[1].toLowerCase();
    body.innerHTML = `${saysHtml()}
      <div class="jar-photo">
        <div class="jar-canvas-wrap"></div>
        <div class="jar-photo__side">
          <p class="ck-caption" id="jarBoxHelp">Drag on the photo to draw the box. Or pick an edge, then use the arrow keys or these buttons (Shift moves it further).</p>
          <div class="jar-nudge">
            <p class="jar-q__label" id="jarEdgeLabel">Edge</p>
            ${segHtml('edge', 'jarEdgeLabel', EDGES, edge)}
            <span class="jar-line" role="group" aria-label="Move the ${edgeName} edge">
              <button class="jar-step" type="button" data-act="nudge" data-d="-1" data-key="nudge-a" aria-label="Move the ${edgeName} edge ${a[2]}">${a[1]}</button>
              <button class="jar-step" type="button" data-act="nudge" data-d="1" data-key="nudge-b" aria-label="Move the ${edgeName} edge ${b[2]}">${b[1]}</button>
            </span>
            <button class="linkish" type="button" data-act="reset" data-key="reset">Reset box</button>
          </div>
        </div>
      </div>`;
    foot.innerHTML = `<button class="btn btn--quiet btn--small" type="button" data-act="back" data-key="fback">${ACTION_ICONS.arrowLeft}<span>Back</span></button>
      <button class="btn btn--primary btn--small" type="button" data-act="find" data-key="find"${busy ? ' aria-disabled="true"' : ''}>${busy ? 'Reading…' : 'Find the layers'}</button>`;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-describedby', 'jarBoxHelp');
    labelCanvas();
  }

  function rowHtml(r) {
    const options = LAYER_TYPE_ORDER.map((t) => `<option value="${t}"${t === r.type ? ' selected' : ''}>${esc(LAYER_TYPES[t].label)}</option>`).join('');
    const line = r.lineAbove == null
      ? '<span class="jar-line jar-line--none" aria-hidden="true"></span>'
      : `<span class="jar-line" role="group" aria-label="Line above ${esc(r.label)}">
          <button class="jar-step" type="button" data-act="lineUp" data-i="${r.i}" data-key="up-${r.i}" aria-label="Move the line above ${esc(r.label)} up">${UP}</button>
          <button class="jar-step" type="button" data-act="lineDown" data-i="${r.i}" data-key="down-${r.i}" aria-label="Move the line above ${esc(r.label)} down">${DOWN}</button>
        </span>`;
    return `<li class="jar-layer">
      <span class="jar-layer__seen" style="background:rgb(${r.rgb.join(' ')})" aria-hidden="true"></span>
      <select class="jar-layer__type" data-i="${r.i}" data-key="type-${r.i}" aria-label="${esc(r.ariaLabel)}">${options}</select>
      <span class="jar-layer__pct" aria-hidden="true">${r.pct}%</span>
      <div class="jar-layer__tools">
      ${line}
      <span class="jar-layer__acts">
        <button class="btn btn--quiet btn--small" type="button" data-act="split" data-i="${r.i}" data-key="split-${r.i}" aria-label="Split ${esc(r.label)} in two"${r.canSplit ? '' : ' disabled'}>${SPLIT}<span>Split</span></button>
        ${r.canMerge ? `<button class="btn btn--quiet btn--small" type="button" data-act="merge" data-i="${r.i}" data-key="merge-${r.i}" aria-label="Join ${esc(r.label)} to the layer above">${MERGE}<span>Join up</span></button>` : ''}
      </span>
      </div>
      ${r.why ? `<p class="jar-layer__why">${esc(r.why)}</p>` : ''}
    </li>`;
  }

  function renderLayers() {
    const v = currentVerdict();
    const rows = layerRows(analysis, v.result);
    const lines = [...says];
    if (v.hint === 'smooth' && !lines.includes(JAR_LINES.smooth)) lines.push(JAR_LINES.smooth);
    body.innerHTML = `<div class="jar-cols">
        <div class="jar-work">
          <div class="says jar-says">
            <p class="says__title"><img src="${MANAMI_SVG}" alt="" width="24" height="22">Manami</p>
            ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
            ${note ? `<p class="jar-says__note">${esc(note)}</p>` : ''}
          </div>
          <div class="jar-work__grid">
            <div class="jar-canvas-wrap jar-canvas-wrap--layers"></div>
            <div class="jar-work__list">
              <ol class="jar-layers" aria-label="Layers, top to bottom">${rows.map((r) => rowHtml(r)).join('')}</ol>
              <button class="linkish jar-hand" type="button" data-act="hand" data-key="hand">I’ll mark the layers myself</button>
            </div>
          </div>
        </div>
        <section class="jar-result" aria-live="polite" aria-busy="false" aria-labelledby="jarResultH"></section>
      </div>`;
    paintResult(v);
    paintFoot(v);
    canvas.removeAttribute('tabindex');
    canvas.setAttribute('role', 'img');
    canvas.removeAttribute('aria-describedby');
    labelCanvas();
  }

  /** The result card, redrawn only when it has changed (it's a live region). */
  function paintResult(v = currentVerdict()) {
    const el = body.querySelector('.jar-result');
    if (!el) return;
    const r = v.result;
    const sig = JSON.stringify([r.textureClass, r.sandPct, r.siltPct, r.clayPct, r.confidence.key, r.warnings, r.drainage, elapsed, r.notes.map((x) => x.type)]);
    if (sig === resultSig) return;
    resultSig = sig;
    el.setAttribute('aria-busy', 'true');
    const map = getMapTexture?.(fieldId);
    const warn = warnLines(r.warnings);
    el.innerHTML = `
      <p class="jar__kicker">Your soil, by the jar</p>
      <h3 class="jar-result__class" id="jarResultH">${r.textureClass ? esc(r.textureClass) : 'Not worked out yet'}${r.textureClass ? ` <span class="jar-badge jar-badge--${r.confidence.key}">${esc(r.confidence.label)}</span>` : ''}</h3>
      ${r.textureClass ? barHtml(r.sandPct, r.siltPct, r.clayPct) : ''}
      <p class="ck-caption">By layer height: a rough guide, not a lab test.${map ? ` The soil map says ${esc(lower(map))}.` : ''}</p>
      ${r.textureClass ? `<dl class="facts jar-facts">
        <div><dt>Drains <span class="jar-by">(by the jar)</span></dt><dd>${esc(r.drainage || 'Unknown')}</dd></div>
        <div><dt>Holds water <span class="jar-by">(by the jar)</span></dt><dd>${esc(r.waterHolding || 'Unknown')}</dd></div>
        <div><dt>Organic matter seen <span class="jar-by">(by the jar)</span></dt><dd>${esc(r.organicMatterLevel)}</dd></div>
        <div><dt>Stones <span class="jar-by">(by the jar)</span></dt><dd>${esc(r.stoneLevel)}</dd></div>
      </dl>` : ''}
      ${r.propertyNote ? `<p class="jar-result__note">${esc(r.propertyNote)}</p>` : ''}
      ${warn.length ? `<ul class="jar-warn">${warn.map((w) => `<li class="flag flag--amber"><span class="flag__dot" aria-hidden="true"></span>${esc(w)}</li>`).join('')}</ul>` : ''}
      <p class="ck-caption">${esc(JAR_LINES.onlyTexture)}</p>
      <div class="jar-q"><p class="jar-q__label" id="jarSettleLabel2">How long had it settled?</p>${segHtml('settle', 'jarSettleLabel2', SETTLE, elapsed)}</div>
      ${r.notes.length ? `<details class="jar-more"><summary>What else is in your jar</summary><dl>${r.notes.map((x) => `<dt>${esc(x.label)}</dt><dd>${esc(x.note)}</dd>`).join('')}</dl></details>` : ''}`;
    el.setAttribute('aria-busy', 'false');
  }

  function paintFoot(v = currentVerdict()) {
    const why = v.canUse ? '' : reasonLine(v.reason) || '';
    const focusKey = foot.contains(document.activeElement) ? document.activeElement.dataset?.key : null;
    foot.innerHTML = `<p class="ck-caption jar-why" id="jarWhy" tabindex="-1"${why ? '' : ' hidden'}>${esc(why)}</p>
      <button class="btn btn--quiet btn--small" type="button" data-act="back" data-key="fback">${ACTION_ICONS.arrowLeft}<span>Back</span></button>
      <button class="btn btn--quiet btn--small" type="button" data-act="close" data-key="fclose">Close</button>
      <button class="btn btn--primary btn--small" id="jarUse" type="button" data-act="use" data-key="use"${v.canUse ? '' : ' aria-disabled="true" aria-describedby="jarWhy"'}>${ACTION_ICONS.tick}<span>Use for ${esc(nameOf(fieldId))}</span></button>`;
    if (focusKey) foot.querySelector(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  function renderEarlier() {
    const r = record;
    const map = getMapTexture?.(fieldId);
    body.innerHTML = `<div class="jar-cols">
        <div class="jar-work">
          ${saysHtml()}
          <div class="jar-canvas-wrap jar-canvas-wrap--layers"></div>
        </div>
        <section class="jar-result" aria-labelledby="jarResultH">
          <p class="jar__kicker">Your soil, by the jar</p>
          <h3 class="jar-result__class" id="jarResultH">${esc(r.textureClass)} <span class="jar-badge jar-badge--${esc(r.confidence)}">${esc(CONFIDENCE[r.confidence] || '')}</span></h3>
          ${barHtml(r.sandPct, r.siltPct, r.clayPct)}
          <p class="ck-caption">By layer height: a rough guide, not a lab test.${map ? ` The soil map says ${esc(lower(map))}.` : ''}${r.sample ? ' This was the sample jar.' : ''}</p>
          ${r.warnings?.length ? `<ul class="jar-warn">${r.warnings.map((w) => `<li class="flag flag--amber"><span class="flag__dot" aria-hidden="true"></span>${esc(w)}</li>`).join('')}</ul>` : ''}
          <p class="ck-caption">${esc(JAR_LINES.onlyTexture)}</p>
        </section>
      </div>`;
    foot.innerHTML = `<button class="btn btn--quiet btn--small" type="button" data-act="close" data-key="fclose">Close</button>
      <button class="btn btn--quiet btn--small" type="button" data-act="remove" data-key="remove">Stop using it</button>
      <button class="btn btn--primary btn--small" type="button" data-act="again" data-key="again">${CAMERA}<span>Take a new photo</span></button>`;
    canvas.removeAttribute('tabindex');
    canvas.setAttribute('role', 'img');
    canvas.removeAttribute('aria-describedby');
    const bands = (r.layers || []).map((l) => `${LAYER_TYPES[l.type]?.label || l.type} ${Math.round(l.share * 100)}%`).join(', ');
    canvas.setAttribute('aria-label', `Your jar from earlier: ${bands}`);
  }

  const currentVerdict = () => verdict(analysis, { isDemoFarm: !!isDemoFarm?.(), sample });

  function labelCanvas() {
    const { width, height } = dims();
    if (step === 'photo' && box) canvas.setAttribute('aria-label', `Your photo. ${boxLabel(box, width, height)}`);
    else if (step === 'layers' && analysis) canvas.setAttribute('aria-label', layersLabel(analysis));
  }

  /** Sizes the canvas to its place (and the screen's pixel ratio), then draws it. */
  function fit() {
    const wrap = canvas.parentElement;
    if (!wrap || root.hidden) return;
    const { width, height } = dims();
    view = { x: 0, y: 0, w: width, h: height };
    if (step === 'layers' && analysis) {
      // the layers: just the box and a little round it, so the bands and lines are big enough to use
      const b = analysis.box, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      const x0 = Math.max(0, b.x0 - bw * 0.45), x1 = Math.min(width, b.x1 + bw * 0.45);
      const y0 = Math.max(0, b.y0 - bh * 0.06), y1 = Math.min(height, b.y1 + bh * 0.06);
      view = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const maxW = Math.max(120, wrap.clientWidth || 300);
    // as tall as the room left in the dialog (on phones, under half the screen)
    const top = wrap.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    const room = body.clientHeight - top - 18;
    const maxH = sheet.matches ? innerHeight * 0.46 : Math.max(220, Math.min(room, innerHeight * 0.66));
    scale = Math.min(maxW / view.w, Math.max(140, maxH) / view.h);
    dpr = Math.min(2, devicePixelRatio || 1);
    const cw = Math.round(view.w * scale), ch = Math.round(view.h * scale);
    if (canvas.style.width !== `${cw}px`) canvas.style.width = `${cw}px`;
    if (canvas.style.height !== `${ch}px`) canvas.style.height = `${ch}px`;
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    draw();
  }

  function draw() {
    if (!canvas.parentElement) return;
    const k = scale * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
    const px = 1 / scale; // one css pixel, in image pixels
    if (step === 'earlier') { drawRecord(); return; }
    if (photo) ctx.drawImage(photo, 0, 0);
    if (step === 'photo') drawBox(drag?.kind === 'new' ? drag.temp : box, px);
    else if (step === 'layers' && analysis) drawLayers(px);
  }

  function drawBox(b, px) {
    if (!b) return;
    const { width, height } = dims();
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    // the outside dimmed
    ctx.fillStyle = 'rgba(30, 20, 10, .38)';
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.fill('evenodd');
    // a dashed white line over a dark one
    ctx.lineWidth = 4 * px;
    ctx.strokeStyle = 'rgba(40, 25, 15, .85)';
    ctx.setLineDash([]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([7 * px, 5 * px]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    // a grip on each edge; the chosen one bigger and green
    const mid = { top: [(x0 + x1) / 2, y0], bottom: [(x0 + x1) / 2, y1], left: [x0, (y0 + y1) / 2], right: [x1, (y0 + y1) / 2] };
    for (const [key, [cx, cy]] of Object.entries(mid)) {
      const on = key === edge;
      const r = (on ? 7 : 5) * px;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#8fd8a4' : '#fff';
      ctx.fill();
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = on ? '#24502f' : 'rgba(40, 25, 15, .85)';
      ctx.stroke();
    }
  }

  function drawLayers(px) {
    const b = analysis.box;
    const lines = boundaryLines(analysis);
    ctx.font = `600 ${12 * px}px Fredoka, Nunito, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    analysis.layers.forEach((l) => {
      const info = LAYER_TYPES[l.type] || LAYER_TYPES.other;
      ctx.globalAlpha = l.type === 'ignore' ? 0.15 : 0.3;
      ctx.fillStyle = info.color;
      ctx.fillRect(b.x0, l.y0, b.x1 - b.x0, l.y1 - l.y0);
      ctx.globalAlpha = 1;
      if ((l.y1 - l.y0) / px >= 15) {
        const x = b.x0 + 5 * px, y = (l.y0 + l.y1) / 2;
        ctx.lineWidth = 3 * px;
        ctx.strokeStyle = 'rgba(30, 20, 10, .9)';
        ctx.strokeText(info.short, x, y, b.x1 - b.x0 - 8 * px);
        ctx.fillStyle = '#fff';
        ctx.fillText(info.short, x, y, b.x1 - b.x0 - 8 * px);
      }
    });
    lines.forEach((y, k) => {
      const on = drag?.kind === 'line' && drag.k === k;
      ctx.lineWidth = 3 * px;
      ctx.strokeStyle = 'rgba(30, 20, 10, .8)';
      ctx.beginPath();
      ctx.moveTo(b.x0, y);
      ctx.lineTo(b.x1, y);
      ctx.stroke();
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      // the handle, just right of the box
      ctx.beginPath();
      ctx.arc(Math.min(view.x + view.w - 8 * px, b.x1 + 8 * px), y, (on ? 7 : 5.5) * px, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#8fd8a4' : '#fff';
      ctx.fill();
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = 'rgba(30, 20, 10, .85)';
      ctx.stroke();
    });
  }

  /** A saved jar test with no photo: its bands drawn in a plain jar, top to bottom. */
  function drawRecord() {
    const { width, height } = RECORD_SIZE;
    ctx.fillStyle = '#f7ecd9';
    ctx.fillRect(0, 0, width, height);
    const x0 = 50, x1 = 150, top = 46, bottom = 278;
    ctx.fillStyle = '#b98a5e';
    ctx.fillRect(x0 + 4, top - 22, x1 - x0 - 8, 18);
    ctx.fillStyle = '#eef6f8';
    ctx.fillRect(x0, top, x1 - x0, bottom - top);
    const layers = (record?.layers || []).filter((l) => l.share > 0);
    const total = layers.reduce((s, l) => s + l.share, 0) || 1;
    let y = top + 8;
    const h = bottom - y;
    for (const l of layers) {
      const bh = (l.share / total) * h;
      if (l.type !== 'air') {
        const [r, g, b] = l.rgb;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.globalAlpha = ['water', 'tea', 'cloudy', 'foam'].includes(l.type) ? 0.75 : 1;
        ctx.fillRect(x0, y, x1 - x0, bh + 0.5);
        ctx.globalAlpha = 1;
      }
      y += bh;
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#9c714f';
    ctx.strokeRect(x0, top, x1 - x0, bottom - top);
  }

  // ---------------------------------------------------------------- the photo

  function usePhoto(data, canvasEl, isSample, startBox) {
    img = data;
    photo = canvasEl;
    sample = isSample;
    box = cleanBox(startBox, img.width, img.height) || cleanBox(defaultBox(img.width, img.height), img.width, img.height)
      || cleanBox({ x0: 0, x1: img.width, y0: 0, y1: img.height }, img.width, img.height); // a small photo: all of it
    if (!box) {
      // too small to read at all
      img = photo = null;
      sample = false;
      step = 'howto';
      says = [JAR_LINES.photo];
      render();
      title.focus({ preventScroll: true });
      return;
    }
    analysis = null;
    note = '';
    edge = 'top';
    step = 'photo';
    says = isSample ? [JAR_LINES.sample, JAR_LINES.box] : [JAR_LINES.box];
    render();
    title.focus({ preventScroll: true });
  }

  function trySample() {
    run++; // (a photo still opening is moot)
    const { img: s, box: b } = paintSampleJar({ seed: 1 });
    const c = document.createElement('canvas');
    c.width = s.width;
    c.height = s.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(s.data), s.width, s.height), 0, 0);
    usePhoto(s, c, true, b);
  }

  async function loadFile(file) {
    if (!file) return;
    const id = ++run; // (an earlier photo still opening is moot)
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, WORK_MAX / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      const d = g.getImageData(0, 0, w, h);
      if (id !== run || root.hidden) return;
      usePhoto({ data: d.data, width: w, height: h }, c, false, defaultBox(w, h));
    } catch (e) {
      if (id !== run || root.hidden) return;
      console.warn('jar test: could not open the photo', e);
      says = [JAR_LINES.photo];
      render();
    }
  }

  // ---------------------------------------------------------------- the box

  function setBox(b, { announce = true } = {}) {
    if (!b) return;
    box = b;
    labelCanvas();
    draw();
    if (announce) sayLater(edgeLabel(box, edge, img.width, img.height));
  }

  function sayLater(text) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { live.textContent = text; }, ANNOUNCE_MS);
  }

  /** Moves the chosen edge by `by` steps of 1% (of the height for top and bottom, the width for the sides). */
  function nudge(by) {
    if (!img) return;
    const vertical = edge === 'top' || edge === 'bottom';
    const d = by * (vertical ? img.height : img.width) * 0.01;
    setBox(nudgeBox(box, edge, d, img.width, img.height));
  }

  function findLayers() {
    if (busy || !img) return;
    busy = true;
    says = [JAR_LINES.reading];
    note = '';
    render();
    const id = ++run;
    // (a frame for "Reading your layers…" to show before the work)
    setTimeout(() => {
      if (id !== run || root.hidden) return;
      busy = false;
      const out = analysePhoto(img, box, elapsed);
      if (out.error) {
        says = [out.error === 'box' ? JAR_LINES.smallBox : JAR_LINES.photo];
        render();
        foot.querySelector('[data-act="find"]')?.focus({ preventScroll: true });
        return;
      }
      analysis = out.analysis;
      step = 'layers';
      says = [JAR_LINES.found(analysis.layers.length)];
      render();
      title.focus({ preventScroll: true });
    }, 40);
  }

  // ---------------------------------------------------------------- the layers

  function edit(fn) {
    try {
      analysis = fn(analysis);
      note = '';
    } catch (e) {
      note = e?.message || String(e); // the module's own words ("That layer is too thin to split.")
    }
    render();
  }

  function moveLine(i, by) {
    const lines = boundaryLines(analysis);
    const b = analysis.box;
    const stepPx = Math.max(1, (b.y1 - b.y0) * 0.01);
    edit((a) => safeMove(a, i, lines[i] + by * stepPx));
  }

  function use() {
    const v = currentVerdict();
    if (!v.canUse) {
      const why = $('jarWhy');
      why?.focus({ preventScroll: false });
      return;
    }
    const rec = toRecord(analysis, v.result, { fieldId, sample });
    session.set(fieldId, { img, photo, box, analysis, elapsed, sample, at: rec.at }); // (tied to this record: see keptFor)
    const f = from;
    close({ restore: false });
    onUse?.(rec, { from: f });
  }

  // ---------------------------------------------------------------- input

  $('jarClose').addEventListener('click', () => close());
  select.addEventListener('change', () => {
    fieldId = select.value;
    if (step === 'earlier') {
      // that field's jar from earlier, or a fresh start for one without
      const saved = fieldOf(fieldId)?.jar;
      if (saved || session.get(fieldId)) open({ fieldId, step: 'result', from });
      else { resetWork(); step = 'howto'; says = [JAR_LINES.howto]; render(); }
      select.focus();
      return;
    }
    if (step === 'layers') {
      // the button's name, and the soil map's texture in the result is this field's
      resultSig = '';
      paintResult();
      paintFoot();
    }
  });

  root.addEventListener('click', (e) => {
    const radio = e.target.closest?.('.jar-seg [role="radio"]');
    if (radio) { pickSeg(radio); return; }
    const b = e.target.closest?.('[data-act]');
    if (!b || !root.contains(b)) return;
    const i = Number(b.dataset.i);
    switch (b.dataset.act) {
      case 'close': close(); break;
      case 'sample': trySample(); break;
      case 'back':
        if (step === 'layers') { step = 'photo'; says = [JAR_LINES.box]; note = ''; render(); }
        else if (step === 'photo') { step = 'howto'; says = [JAR_LINES.howto]; render(); }
        break;
      case 'nudge': nudge(Number(b.dataset.d)); break;
      case 'reset': if (img) setBox(sample ? cleanBox(SAMPLE_BOX, img.width, img.height) : cleanBox(defaultBox(img.width, img.height), img.width, img.height)); break;
      case 'find': findLayers(); break;
      case 'lineUp': moveLine(i, -1); break;
      case 'lineDown': moveLine(i, 1); break;
      case 'split': edit((a) => splitLayer(a, i)); break;
      case 'merge': edit((a) => mergeLayerUp(a, i)); break;
      case 'hand':
        analysis = markByHand(box, img?.height, img, elapsed);
        says = [JAR_LINES.byHand];
        note = '';
        render();
        break;
      case 'use': use(); break;
      case 'remove': { const id = fieldId, f = from; close({ restore: false }); onRemove?.(id, { from: f }); break; }
      case 'again': { const id = fieldId; open({ fieldId: id, step: 'howto', from }); break; }
      default:
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.matches?.('input[type="file"]')) { loadFile(e.target.files?.[0]); e.target.value = ''; return; }
    if (e.target.matches?.('.jar-layer__type')) {
      const i = Number(e.target.dataset.i);
      const t = e.target.value;
      edit((a) => setLayerType(a, i, t));
    }
  });

  /** A radio in one of the segmented groups: the settling time or the box edge. */
  function pickSeg(radio) {
    const seg = radio.closest('.jar-seg');
    const v = radio.dataset.v;
    if (seg.dataset.seg === 'settle') {
      if (v === elapsed) return;
      elapsed = v;
      if (analysis) { analysis = withElapsed(analysis, v, img); render(); }
      else paintSeg(seg, v);
    } else if (seg.dataset.seg === 'edge') {
      edge = v;
      render();
      if (box && img) sayLater(edgeLabel(box, edge, img.width, img.height));
    }
    root.querySelector(`[data-key="${seg.dataset.seg}-${v}"]`)?.focus({ preventScroll: true });
  }
  function paintSeg(seg, v) {
    seg.querySelectorAll('[role="radio"]').forEach((r) => {
      const on = r.dataset.v === v;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
    });
  }

  root.addEventListener('keydown', (e) => {
    const radio = e.target.closest?.('.jar-seg [role="radio"]');
    if (radio) {
      const all = [...radio.closest('.jar-seg').querySelectorAll('[role="radio"]')];
      const i = all.indexOf(radio);
      const by = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      const to = by ? (i + by + all.length) % all.length : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
      if (to == null) return;
      e.preventDefault();
      pickSeg(all[to]);
      return;
    }
    if (e.target === canvas && step === 'photo') {
      const dir = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      nudge(dir * (e.shiftKey ? 5 : 1));
      return;
    }
    // the disabled Use: a key press says why, as a click does
    if (e.target.id === 'jarUse' && (e.key === 'Enter' || e.key === ' ') && e.target.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      use();
    }
  });

  // Esc: a drag ends first, then the dialog closes (a select keeps Esc for itself)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || root.hidden) return;
    if (drag) { e.preventDefault(); e.stopPropagation(); cancelDrag(); return; }
    if (e.target.closest?.('select')) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }, true);

  // ---- dragging on the canvas: the box (step 2) or a layer line (step 3)
  const toImage = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: view.x + (e.clientX - r.left) / scale, y: view.y + (e.clientY - r.top) / scale };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !img) return;
    const p = toImage(e);
    const tol = EDGE_GRAB / scale;
    if (step === 'photo' && !box) {
      drag = { kind: 'new', sx: p.x, sy: p.y, temp: null, before: box };
    } else if (step === 'photo') {
      const inX = p.x >= box.x0 - tol && p.x <= box.x1 + tol;
      const inY = p.y >= box.y0 - tol && p.y <= box.y1 + tol;
      const near = [
        ['top', inX ? Math.abs(p.y - box.y0) : Infinity], ['bottom', inX ? Math.abs(p.y - box.y1) : Infinity],
        ['left', inY ? Math.abs(p.x - box.x0) : Infinity], ['right', inY ? Math.abs(p.x - box.x1) : Infinity],
      ].filter(([, d]) => d <= tol).sort((a, b) => a[1] - b[1])[0];
      drag = near ? { kind: 'edge', edge: near[0], before: box } : { kind: 'new', sx: p.x, sy: p.y, temp: null, before: box };
      if (near && edge !== near[0]) { edge = near[0]; refreshEdgeSeg(); }
    } else if (step === 'layers' && analysis) {
      const b = analysis.box;
      const lt = LINE_GRAB / scale;
      if (p.x < b.x0 - lt || p.x > b.x1 + 3 * lt) return;
      const lines = boundaryLines(analysis);
      let best = -1, bd = lt;
      lines.forEach((y, k) => { const d = Math.abs(p.y - y); if (d <= bd) { bd = d; best = k; } });
      if (best < 0) return;
      drag = { kind: 'line', k: best, before: analysis };
    } else return;
    e.preventDefault();
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* (a pointer that's already gone) */ }
    draw();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      if (e.pointerType === 'mouse' && img) canvas.style.cursor = hoverCursor(toImage(e));
      return;
    }
    const p = toImage(e);
    const w = img.width, h = img.height;
    if (drag.kind === 'edge') {
      const key = { top: 'y0', bottom: 'y1', left: 'x0', right: 'x1' }[drag.edge];
      const to = drag.edge === 'top' || drag.edge === 'bottom' ? p.y : p.x;
      setBox(nudgeBox(box, drag.edge, to - box[key], w, h), { announce: false });
    } else if (drag.kind === 'new') {
      const cx = Math.max(0, Math.min(w, p.x)), cy = Math.max(0, Math.min(h, p.y));
      drag.temp = { x0: drag.sx, y0: drag.sy, x1: cx, y1: cy };
      draw();
    } else if (drag.kind === 'line') {
      analysis = safeMove(analysis, drag.k, p.y);
      draw();
    }
  });

  const finishDrag = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'new') {
      const t = d.temp;
      const moved = t && Math.hypot(t.x1 - t.x0, t.y1 - t.y0) * scale > 6;
      const c = t && cleanBox(t, img.width, img.height);
      if (c) { setBox(c, { announce: false }); sayLater(boxLabel(box, img.width, img.height)); if (says[0] === JAR_LINES.smallBox) { says = [JAR_LINES.box]; render(); } }
      else if (moved) { says = [JAR_LINES.smallBox]; render(); }
      else draw();
    } else if (d.kind === 'edge') {
      sayLater(edgeLabel(box, d.edge, img.width, img.height));
      draw();
    } else if (d.kind === 'line') {
      if (analysis !== d.before) { note = ''; render(); } else draw();
    }
  };
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('lostpointercapture', finishDrag);

  function cancelDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'line') analysis = d.before;
    else box = d.before;
    draw();
  }
  function endDrag() { drag = null; }

  function hoverCursor(p) {
    const tol = (step === 'photo' ? EDGE_GRAB : LINE_GRAB) / scale;
    if (step === 'photo' && box) {
      const inX = p.x >= box.x0 - tol && p.x <= box.x1 + tol, inY = p.y >= box.y0 - tol && p.y <= box.y1 + tol;
      if (inX && (Math.abs(p.y - box.y0) <= tol || Math.abs(p.y - box.y1) <= tol)) return 'ns-resize';
      if (inY && (Math.abs(p.x - box.x0) <= tol || Math.abs(p.x - box.x1) <= tol)) return 'ew-resize';
      return 'crosshair';
    }
    if (step === 'layers' && analysis) return boundaryLines(analysis).some((y) => Math.abs(p.y - y) <= tol) ? 'ns-resize' : '';
    return '';
  }

  function refreshEdgeSeg() {
    const seg = root.querySelector('.jar-seg[data-seg="edge"]');
    if (seg) paintSeg(seg, edge);
  }

  addEventListener('resize', () => { if (!root.hidden) fit(); });

  return {
    open,
    close,
    get isOpen() { return !root.hidden; },
    /** For the console and the browser check: where the dialog is. */
    get state() { return { fieldId, step, from, sample, box, elapsed, layers: analysis?.layers.length ?? null, verdict: analysis ? (({ canUse, reason, hint }) => ({ canUse, reason, hint }))(currentVerdict()) : null }; },
  };
}
