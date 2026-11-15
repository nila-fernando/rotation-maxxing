// Part 3.5 · The field check-up panel, on the right when a field is chosen on the hub.
//
//   header        name (editable, saved back to the app), acres, irrigated switch
//   crop history  8 crop icons, 2018–2025 (CSB)
//   soil          texture, drainage, organic matter, water-holding capacity (SSURGO)
//   slope         average % and an erosion risk label (elevation tiles: USGS 3DEP)
//   rain          growing-season rain, last 10 years, against the 30-year average (POWER); once
//                 there are plans, Manami's weather risk and any spring freeze on this field's wheat
//   greenness     last season's NDVI curve (NASA HLS); says so when there's no imagery yet
//   Manami says   1–2 flags from src/data/flags.js
//
// Every section's numbers come from one source, shown as a chip in the section's heading (acres:
// CSB, in the header). Every number is the field's own fetched data; a section with none says so.
//
// The soil section ends with the jar test strip: "Try a jar test", or the farmer's own jar test
// (src/plan/jarTest.js) when one is in use, with "See your jar", "Test again" and "Stop using it".
//
//   const panel = createFieldPanel({ onRename, onIrrigated, onJar, onClose })
//   panel.open(report)     a report from src/data/fieldReport.js
//   panel.update(report)   after a rename, the irrigated switch or a jar test
//   panel.jarNote(id, text)   a short line under the jar strip (said to screen readers too)
//   panel.close()
//   panel.insets()         { right, bottom }: how much of the screen it covers (for the camera)
import { formatAcres } from '../fields/geometry.js';
import { SOURCES } from '../data/fieldReport.js';
import { cropIcon } from '../ui/cropIcons.js';
import { LENS_ICONS } from '../ui/futureIcons.js';
import { JAR } from '../ui/jarIcons.js';
import { asset } from '../ui/asset.js';

const MANAMI_SVG = asset('/manami.svg');

const MM_PER_IN = 25.4;
const RISK_TEXT = { low: 'Low erosion risk', medium: 'Medium erosion risk', high: 'High erosion risk' };
const SHEET_QUERY = '(max-width: 900px) and (min-height: 521px)'; // as in hub.js and styles.css

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const inches = (mm) => (mm / MM_PER_IN).toFixed(1);
const CONFIDENCE = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', adjusted: 'Adjusted by you' };

/** The line under a crop history with years missing; on a site with no CropScape proxy, it says why. */
export function historyGap(knownYears, cdlOff = false) {
  const have = knownYears ? `${knownYears} of 8 years on record.` : 'No crop records for this field yet.';
  return cdlOff ? `${have} The rest come from CropScape, and I can’t reach it from this site yet.` : have;
}

/**
 * A tiny jar in the record's own layer colours (3 to 5 bands, top to bottom; with more layers the
 * biggest 5 are kept), for the check-up's jar strip. Decoration only: the text beside it says it all.
 */
export function jarSwatch(layers) {
  let bands = (layers || []).filter((l) => l && l.share > 0 && Array.isArray(l.rgb) && l.type !== 'air');
  if (bands.length > 5) {
    const keep = new Set([...bands].sort((a, b) => b.share - a.share).slice(0, 5));
    bands = bands.filter((l) => keep.has(l));
  }
  const total = bands.reduce((s, l) => s + l.share, 0) || 1;
  const top = 7, bottom = 29, h = bottom - top;
  let y = top;
  const rects = bands.map((l) => {
    const bh = (l.share / total) * h;
    const [r, g, b] = l.rgb.map((v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0))));
    const out = `<rect x="4" y="${y.toFixed(2)}" width="16" height="${(bh + 0.3).toFixed(2)}" fill="rgb(${r} ${g} ${b})"/>`;
    y += bh;
    return out;
  }).join('');
  return `<svg viewBox="0 0 24 32" aria-hidden="true" focusable="false">
    <defs><clipPath id="ckJarClip"><rect x="4" y="6" width="16" height="23" rx="3"/></clipPath></defs>
    <g clip-path="url(#ckJarClip)"><rect x="4" y="6" width="16" height="23" fill="#eef6f8"/>${rects}</g>
    <rect x="3.5" y="5.5" width="17" height="24" rx="3.5" fill="none" stroke="#9c714f" stroke-width="1.6"/>
    <rect x="5.5" y="1.5" width="13" height="4" rx="1.2" fill="#b98a5e" stroke="#7d5840" stroke-width="1.2"/>
  </svg>`;
}

/** The soil section's jar strip: "Try a jar test", or the jar test in use with its three links. */
export function jarStrip(jar, note = '') {
  const said = `<p class="ck-caption ck-jar__note" role="status">${esc(note)}</p>`;
  if (!jar) {
    return `<div class="ck-jar ck-jar--empty">
      <span class="ck-jar__icon" aria-hidden="true">${JAR}</span>
      <p>Want to check it yourself? A jar of soil and water shows your sand, silt and clay.</p>
      <button class="btn btn--quiet btn--small" type="button" data-jar="new">${JAR}<span>Try a jar test</span></button>
    </div>${said}`;
  }
  const pct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '?');
  const conf = CONFIDENCE[jar.confidence] || '';
  return `<div class="ck-jar">
    <span class="ck-jar__swatch" aria-hidden="true">${jarSwatch(jar.layers)}</span>
    <div class="ck-jar__text">
      <p class="ck-jar__title">Your jar test: <b>${esc(jar.textureClass)}</b> <span class="src-chip src-chip--jar"><span class="sr-only">Source: </span>Jar</span></p>
      <p class="ck-caption">Sand ${pct(jar.sandPct)} · Silt ${pct(jar.siltPct)} · Clay ${pct(jar.clayPct)}${conf ? ` · ${conf}` : ''}${jar.sample ? ' · A sample jar' : ''}</p>
      <p class="ck-caption">${jar.sameAsMap ? 'It agrees with the soil map.' : 'I’m planning with your jar here.'}</p>
      <div class="ck-jar__acts">
        <button class="linkish" type="button" data-jar="open">See your jar</button>
        <button class="linkish" type="button" data-jar="new">Test again</button>
        <button class="linkish" type="button" data-jar="remove">Stop using it</button>
      </div>
    </div>
  </div>${said}`;
}

/** A source chip; placeholder = a demo stand-in for that source. */
function chip(key, placeholder = false) {
  const src = SOURCES[key];
  const title = placeholder ? `${src.name}: demo stand-in until the live data is connected` : `Source: ${src.name}`;
  return `<span class="src-chip${placeholder ? ' src-chip--demo' : ''}" title="${esc(title)}"><span class="sr-only">Source: </span>${esc(src.label)}${placeholder ? '<span class="sr-only"> (demo stand-in)</span>' : ''}</span>`;
}

/** Growing-season rain bars for the last 10 years with the 30-year average as a dashed line. */
export function rainSparkline(rain) {
  const W = 284, H = 78, top = 12, bottom = 16, left = 4, right = 4;
  const vals = rain.years.map((y) => y.value);
  const max = Math.max(...vals, rain.avg30) * 1.08;
  const n = vals.length;
  const slot = (W - left - right) / n;
  const yOf = (v) => top + (H - top - bottom) * (1 - v / max);
  const bars = rain.years.map((r, i) => {
    const x = left + i * slot + slot * 0.18, w = slot * 0.64, y = yOf(r.value);
    const dry = r.value < rain.avg30;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(H - bottom - y).toFixed(1)}" rx="2.5" class="${dry ? 'bar bar--dry' : 'bar'}"><title>${r.year}: ${inches(r.value)} in</title></rect>`;
  }).join('');
  const ay = yOf(rain.avg30).toFixed(1);
  const first = rain.years[0].year, last = rain.years[n - 1].year;
  const label = `Growing-season rain, ${first} to ${last}: ${rain.years.map((r) => `${r.year} ${inches(r.value)} inches`).join(', ')}. 30-year average ${inches(rain.avg30)} inches.`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${bars}
    <line x1="${left}" x2="${W - right}" y1="${ay}" y2="${ay}" class="avg-line"/>
    <text x="${W - right}" y="${(Number(ay) - 4).toFixed(1)}" text-anchor="end" class="avg-text">30-yr avg ${inches(rain.avg30)} in</text>
    <text x="${left}" y="${H - 3}" class="axis-text">${first}</text>
    <text x="${W - right}" y="${H - 3}" text-anchor="end" class="axis-text">${last}</text>
  </svg>`;
}

/** Last season's NDVI as a filled curve, 0 to 1, with the peak marked. */
export function ndviCurve(ndvi) {
  const W = 284, H = 92, top = 10, bottom = 16, left = 22, right = 6;
  const pts = ndvi.map((p) => ({ t: Date.parse(p.date), v: p.value, date: p.date })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return '';
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t) => left + ((W - left - right) * (t - t0)) / Math.max(1, t1 - t0);
  const y = (v) => top + (H - top - bottom) * (1 - Math.max(0, Math.min(1, v)));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(t1).toFixed(1)} ${y(0).toFixed(1)} L${x(t0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const peak = pts.reduce((a, b) => (b.v > a.v ? b : a));
  const month = (t) => new Date(t).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const label = `Greenness (NDVI) from ${day(t0)} to ${day(t1)}, peaking at ${peak.v.toFixed(2)} on ${day(peak.t)}.`;
  return `<svg class="ndvi" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <line x1="${left}" x2="${W - right}" y1="${y(0.5).toFixed(1)}" y2="${y(0.5).toFixed(1)}" class="grid"/>
    <text x="${left - 4}" y="${(y(1) + 4).toFixed(1)}" text-anchor="end" class="axis-text">1</text>
    <text x="${left - 4}" y="${(y(0.5) + 4).toFixed(1)}" text-anchor="end" class="axis-text">.5</text>
    <text x="${left - 4}" y="${(y(0) + 1).toFixed(1)}" text-anchor="end" class="axis-text">0</text>
    <path d="${area}" class="ndvi-area"/>
    <path d="${line}" class="ndvi-line"/>
    <circle cx="${x(peak.t).toFixed(1)}" cy="${y(peak.v).toFixed(1)}" r="4" class="ndvi-peak"/>
    <text x="${x(t0).toFixed(1)}" y="${H - 3}" class="axis-text">${month(t0)}</text>
    <text x="${x(t1).toFixed(1)}" y="${H - 3}" text-anchor="end" class="axis-text">${month(t1)}</text>
  </svg>
  <p class="ck-caption">Peak <b>${peak.v.toFixed(2)}</b> on ${esc(day(peak.t))}</p>`;
}

/**
 * @param {object} o
 * @param {(id: string, name: string) => string} o.onRename   saves; returns the name actually kept
 * @param {(id: string, on: boolean) => void} o.onIrrigated
 * @param {(id: string, mode: 'new'|'open'|'remove') => void} [o.onJar]   the jar strip's buttons
 * @param {() => void} o.onClose
 */
// a speech bubble, for "Ask about this field"
const ASK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16v10H10l-4.5 3.5V15.5H4z" fill="currentColor" fill-opacity=".2"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/></svg>';

export function createFieldPanel({ onRename, onIrrigated, onJar, onAsk, onClose }) {
  const root = document.getElementById('checkup');
  const head = document.getElementById('checkupHead');
  const body = document.getElementById('checkupBody');
  const closeBtn = document.getElementById('checkupClose');
  const sheet = matchMedia(SHEET_QUERY);
  let report = null;
  let markedYear = null; // the year picked in the year bar, ringed in the crop history
  let jarSaid = null; // { id, text }: the jar strip's last line (kept through a redraw)

  closeBtn.addEventListener('click', () => onClose?.());
  // "Ask about this field": Ask Manami, about this field (the header is redrawn, so the click is caught here)
  head.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-ask]');
    if (b && report) onAsk?.(report.id, b);
  });
  // the jar strip's buttons (redrawn with the panel, so the click is caught here)
  body.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-jar]');
    if (b && report) onJar?.(report.id, b.dataset.jar);
  });

  // ---- the crop-history tooltip: one element on <body>, so the panel's scroll area never clips it
  const tip = document.createElement('div');
  tip.className = 'ck-tip';
  tip.setAttribute('aria-hidden', 'true'); // the icons carry their own screen-reader text
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor = null;
  function showTip(li) {
    tipFor = li;
    const b = document.createElement('b');
    b.textContent = li.dataset.crop;
    const y = document.createElement('span');
    y.textContent = li.dataset.year;
    tip.replaceChildren(b, y);
    tip.hidden = false;
    const icon = (li.querySelector('.hist__icon') || li).getBoundingClientRect();
    const panel = root.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    // centred over the icon, kept inside the panel's edges; below it if there's no room above
    const x = Math.max(panel.left + 8, Math.min(panel.right - tw - 8, icon.left + icon.width / 2 - tw / 2));
    let top = icon.top - th - 8;
    if (top < 8) top = icon.bottom + 8;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(top)}px)`;
  }
  function hideTip() {
    tipFor = null;
    tip.hidden = true;
  }
  body.addEventListener('pointerover', (e) => { const li = e.target.closest?.('.hist'); if (li && li !== tipFor) showTip(li); });
  body.addEventListener('pointerout', (e) => { const li = e.target.closest?.('.hist'); if (li && !li.contains(e.relatedTarget) && tipFor === li) hideTip(); });
  body.addEventListener('focusin', (e) => { const li = e.target.closest?.('.hist'); if (li) showTip(li); });
  body.addEventListener('focusout', (e) => { if (e.target.closest?.('.hist') === tipFor) hideTip(); });
  body.addEventListener('scroll', hideTip, { passive: true });

  // the name: saved on Enter or when it loses focus; Esc puts the old name back
  root.addEventListener('keydown', (e) => {
    if (!e.target.matches('.checkup__name')) return;
    if (e.isComposing || e.keyCode === 229) return; // Enter/Esc inside an IME composition belong to the IME
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.target.value = report?.name ?? ''; e.target.blur(); }
  });
  root.addEventListener('change', (e) => {
    if (!report) return;
    if (e.target.matches('.checkup__name')) {
      const kept = onRename?.(report.id, e.target.value);
      if (typeof kept === 'string') e.target.value = kept;
    } else if (e.target.matches('.checkup__irrigated')) {
      onIrrigated?.(report.id, e.target.checked);
    }
  });

  /** One section: title (and a quieter subtitle) on the left, its source chip on the right, then the content. */
  const section = (id, title, sub, source, content) => `
    <section class="ck-sec" aria-labelledby="${id}">
      <div class="ck-sec__head">
        <h3 id="${id}">${title}${sub ? ` <span class="ck-sec__sub">${sub}</span>` : ''}</h3>
        ${source || ''}
      </div>
      ${content}
    </section>`;

  function render(r) {
    const ph = r.placeholder || {};
    // each year: its crop icon, with the crop's name in a tooltip on hover, focus or tap
    const history = r.history.map((h) => (h.crop == null
      ? `<li class="hist hist--none" tabindex="0" data-crop="No record" data-year="${h.year}"><span class="hist__icon" aria-hidden="true"></span><span class="hist__year" aria-hidden="true">${String(h.year).slice(-2)}</span><span class="sr-only">${h.year}: no record</span></li>`
      : `<li class="hist" tabindex="0" data-crop="${esc(h.label)}" data-year="${h.year}"><span class="hist__icon">${cropIcon(h.key)}</span><span class="hist__year" aria-hidden="true">${String(h.year).slice(-2)}</span><span class="sr-only">${h.year}: ${esc(h.label)}</span></li>`)).join('');
    const knownYears = r.history.filter((h) => h.crop != null).length;
    const empty = (text) => `<p class="ck-empty">${text}</p>`;
    const fact = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;

    const soil = r.soil
      ? `<dl class="facts">
          ${fact('Texture', esc(cap(r.soil.texture) || 'Unknown'))}
          ${fact('Drainage', esc(cap(r.soil.drainage) || 'Unknown'))}
          ${fact('Organic matter', Number.isFinite(r.soil.organicMatterPct) ? `${r.soil.organicMatterPct}%` : 'Unknown')}
          ${fact('Water-holding capacity', Number.isFinite(r.soil.waterHoldingIn) ? `${r.soil.waterHoldingIn} in` : 'Unknown')}
        </dl>`
      : empty('No soil data available for this field.');

    const slope = r.slope
      ? `<div class="slope">
          <p><b class="slope__pct">${r.slope.pct.toFixed(1)}%</b> <span class="slope__label">average</span></p>
          <p class="risk risk--${r.slope.risk}"><span class="risk__dot" aria-hidden="true"></span>${RISK_TEXT[r.slope.risk]}</p>
        </div>`
      : empty('No slope data available for this field.');

    // Manami's weather words from the latest plans (none until there are plans)
    const pw = r.planWeather || {};
    const weather = [[LENS_ICONS.water, pw.water], [LENS_ICONS.frost, pw.frost]]
      .filter(([, text]) => text)
      .map(([icon, text]) => `<p class="ck-caption ck-weather">${icon}<span>${esc(text)}</span></p>`).join('');
    const rain = (r.rain
      ? `${rainSparkline(r.rain)}
         <p class="ck-caption">Last ${r.rain.recentYears} years: <b>${inches(r.rain.recentAvg)} in</b> a season vs <b>${inches(r.rain.avg30)} in</b> normal</p>`
      : empty('No rain data available for this farm.')) + weather;

    const says = r.shown.length
      ? `<ul class="flags">${r.shown.map((f) => `<li class="flag flag--${f.level}"><span class="flag__dot" aria-hidden="true"></span>${esc(f.text)}</li>`).join('')}</ul>`
      : r.status === 'unknown'
        ? '<p class="flag flag--none">I’ll have more to say once this field’s data is in.</p>'
        : '<ul class="flags"><li class="flag flag--green"><span class="flag__dot" aria-hidden="true"></span>Nothing to flag here. Nice work.</li></ul>';
    const extra = r.flags.length - r.shown.length;
    const more = extra > 0 ? `<p class="says__more">${extra} more ${extra === 1 ? 'thing' : 'things'} to look at in the planner.</p>` : '';

    // the header stays put while the sections scroll
    head.innerHTML = `
      <p class="checkup__kicker" id="checkupTitle">Field check-up<span class="sr-only">: ${esc(r.name)}</span></p>
      <input class="checkup__name" type="text" value="${esc(r.name)}" maxlength="40" aria-label="Field name" spellcheck="false" autocomplete="off">
      <div class="checkup__meta">
        <span class="checkup__acres">${r.acres != null ? esc(formatAcres(r.acres)) : 'Acres unknown'} ${chip('CSB')}</span>
        <label class="switch">
          <input class="checkup__irrigated" type="checkbox" role="switch" ${r.irrigated ? 'checked' : ''}>
          <span class="switch__track" aria-hidden="true"><span class="switch__knob"></span></span>
          Irrigated
        </label>
      </div>${onAsk ? `<button class="btn btn--quiet btn--small checkup__ask" type="button" data-ask>${ASK_ICON}<span>Ask about this field</span></button>` : ''}`;

    body.innerHTML = `
      <section class="says" aria-labelledby="ckSays">
        <h3 id="ckSays" class="says__title"><img src="${MANAMI_SVG}" alt="" width="24" height="22"> Manami says</h3>
        ${says}${more}
      </section>
      ${section('ckHist', 'Crop history', '2018–2025', `${chip('CSB')}${r.cdlYears?.length ? ` ${chip('CDL')}` : ''}`, `<ol class="history" aria-label="Crops by year">${history}</ol>
        ${knownYears < r.history.length ? `<p class="ck-caption">${historyGap(knownYears, r.cdlOff)}</p>` : ''}`)}
      ${section('ckSoil', 'Soil', '', r.soil ? chip('SSURGO', ph.soil) : '', soil + jarStrip(r.jar, jarSaid?.id === r.id ? jarSaid.text : ''))}
      ${section('ckSlope', 'Slope', '', r.slope ? chip('DEM', ph.slope) : '', slope)}
      ${section('ckRain', 'Rain trend', 'Apr–Sep', r.rain ? chip('POWER', ph.rain) : '', rain)}
      ${section('ckGreen', 'Greenness', 'last season', r.ndvi ? chip('HLS', ph.ndvi) : '', r.ndvi ? ndviCurve(r.ndvi) : empty('No satellite greenness for this field yet (it can take a minute to arrive).'))}
      ${Object.values(ph).some(Boolean) ? '<p class="ck-legend"><span class="src-chip src-chip--demo" aria-hidden="true">ABC</span> Dotted chips are demo stand-ins until the live data is connected.</p>' : ''}`;
  }

  function open(r) {
    const scroll = report?.id === r.id ? body.scrollTop : 0;
    if (report?.id !== r.id) jarSaid = null;
    report = r;
    hideTip();
    render(r);
    markYear(markedYear);
    body.scrollTop = scroll;
    root.hidden = false;
    document.body.classList.add('checkup-open');
    setManamiAway(true);
  }

  // Manami steps aside while the panel is open (her flags are in it): out of sight and out of the tab order
  function setManamiAway() {
    // away while this, the plans panel or the jar test is open (any of them can close last)
    const m = document.getElementById('manami');
    const cl = document.body.classList;
    if (m) m.inert = cl.contains('checkup-open') || cl.contains('plans-open') || cl.contains('jar-open');
  }

  /**
   * A new name for the open field, without redrawing the panel: the rename is saved as the name box
   * loses focus, often because something else in the panel is being clicked, and a redraw then
   * would swallow that click.
   */
  function rename(id, name) {
    if (!report || report.id !== id) return;
    report = { ...report, name };
    const input = head.querySelector('.checkup__name');
    if (input && input.value !== name) input.value = name;
    const sr = head.querySelector('#checkupTitle .sr-only');
    if (sr) sr.textContent = `: ${name}`;
  }

  /** Re-draws the open panel (after a rename or the irrigated switch), keeping the scroll. */
  function update(r) {
    if (!report || report.id !== r.id) return;
    const active = document.activeElement;
    const keepFocus = active && root.contains(active) ? (active.matches('.checkup__irrigated') ? '.checkup__irrigated' : active.matches('.checkup__name') ? '.checkup__name' : active.matches('[data-jar]') ? `[data-jar="${active.dataset.jar}"]` : null) : null;
    open(r);
    // (a jar button that went with the redraw: its strip's first button instead)
    if (keepFocus) (root.querySelector(keepFocus) || (keepFocus.startsWith('[data-jar') ? root.querySelector('[data-jar]') : null))?.focus({ preventScroll: true });
  }

  /** A short line under the jar strip ("Okay, West 140 is back on the soil map."), read out too. */
  function jarNote(id, text) {
    jarSaid = { id, text: String(text || '') };
    if (report?.id !== id) return;
    const el = body.querySelector('.ck-jar__note');
    if (el) el.textContent = jarSaid.text;
  }

  function close() {
    hideTip();
    report = null;
    root.hidden = true;
    document.body.classList.remove('checkup-open');
    setManamiAway(false);
  }

  /** Rings a year in the crop history (the year shown on the island), or none. */
  function markYear(year) {
    markedYear = year ?? null;
    body.querySelectorAll('.hist').forEach((li) => li.classList.toggle('is-year', String(markedYear) === li.dataset.year));
  }

  /** How much of the screen the panel covers, for centring the island beside it. */
  function insets() {
    if (root.hidden) return { right: 0, bottom: 0 };
    if (sheet.matches) return { right: 0, bottom: Math.max(0, innerHeight - root.offsetTop) };
    return { right: Math.max(0, innerWidth - root.offsetLeft) + 8, bottom: 0 };
  }

  return {
    open,
    update,
    jarNote,
    rename,
    markYear,
    close,
    insets,
    get openId() { return report?.id ?? null; },
    el: root,
  };
}
