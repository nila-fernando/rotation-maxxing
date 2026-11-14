// Part 3.5 · The field check-up panel, on the right when a field is chosen on the hub.
//
//   header        name (editable, saved back to the app), acres, irrigated switch
//   crop history  8 crop icons, 2018–2025 (CSB)
//   soil          texture, drainage, organic matter, water-holding capacity (SSURGO)
//   slope         average % and an erosion risk label (SRTM)
//   rain          growing-season rain, last 10 years, against the 30-year average (POWER)
//   greenness     last season's NDVI curve (Landsat/HLS); left out when there's no imagery
//   Manami says   1–2 flags from src/data/flags.js
//
// Every section's numbers come from one source, shown as a chip in the section's heading (acres:
// CSB, in the header). A chip with a dotted edge marks a demo stand-in (soil, slope, rain and
// greenness are realistic placeholders until the live sources are connected).
//
//   const panel = createFieldPanel({ onRename, onIrrigated, onClose })
//   panel.open(report)     a report from src/data/fieldReport.js
//   panel.update(report)   after a rename or the irrigated switch
//   panel.close()
//   panel.insets()         { right, bottom }: how much of the screen it covers (for the camera)
import { formatAcres } from '../fields/geometry.js';
import { SOURCES } from '../data/fieldReport.js';
import { cropIcon } from '../ui/cropIcons.js';

const MM_PER_IN = 25.4;
const RISK_TEXT = { low: 'Low erosion risk', medium: 'Medium erosion risk', high: 'High erosion risk' };
const SHEET_QUERY = '(max-width: 900px) and (min-height: 521px)'; // as in hub.js and styles.css

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const inches = (mm) => (mm / MM_PER_IN).toFixed(1);

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
 * @param {() => void} o.onClose
 */
export function createFieldPanel({ onRename, onIrrigated, onClose }) {
  const root = document.getElementById('checkup');
  const head = document.getElementById('checkupHead');
  const body = document.getElementById('checkupBody');
  const closeBtn = document.getElementById('checkupClose');
  const sheet = matchMedia(SHEET_QUERY);
  let report = null;
  let markedYear = null; // the year picked in the year bar, ringed in the crop history

  closeBtn.addEventListener('click', () => onClose?.());

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
      : empty('Soil data isn’t available for this field yet.');

    const slope = r.slope
      ? `<div class="slope">
          <p><b class="slope__pct">${r.slope.pct.toFixed(1)}%</b> <span class="slope__label">average</span></p>
          <p class="risk risk--${r.slope.risk}"><span class="risk__dot" aria-hidden="true"></span>${RISK_TEXT[r.slope.risk]}</p>
        </div>`
      : empty('Slope isn’t available for this field yet.');

    const rain = r.rain
      ? `${rainSparkline(r.rain)}
         <p class="ck-caption">Last ${r.rain.recentYears} years: <b>${inches(r.rain.recentAvg)} in</b> a season vs <b>${inches(r.rain.avg30)} in</b> normal</p>`
      : empty('Rain records aren’t available for this farm yet.');

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
      </div>`;

    body.innerHTML = `
      <section class="says" aria-labelledby="ckSays">
        <h3 id="ckSays" class="says__title"><img src="/manami.svg" alt="" width="24" height="22"> Manami says</h3>
        ${says}${more}
      </section>
      ${section('ckHist', 'Crop history', '2018–2025', chip('CSB'), `<ol class="history" aria-label="Crops by year">${history}</ol>
        ${knownYears < r.history.length ? `<p class="ck-caption">${knownYears ? `${knownYears} of 8 years on record.` : 'No crop records for this field yet.'}</p>` : ''}`)}
      ${section('ckSoil', 'Soil', '', r.soil ? chip('SSURGO', ph.soil) : '', soil)}
      ${section('ckSlope', 'Slope', '', r.slope ? chip('SRTM', ph.slope) : '', slope)}
      ${section('ckRain', 'Rain trend', 'Apr–Sep', r.rain ? chip('POWER', ph.rain) : '', rain)}
      ${r.ndvi ? section('ckGreen', 'Greenness', 'last season', chip('Landsat', ph.ndvi), ndviCurve(r.ndvi)) : ''}
      ${Object.values(ph).some(Boolean) ? '<p class="ck-legend"><span class="src-chip src-chip--demo" aria-hidden="true">ABC</span> Dotted chips are demo stand-ins until the live data is connected.</p>' : ''}`;
  }

  function open(r) {
    const scroll = report?.id === r.id ? body.scrollTop : 0;
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
    // away while this or the plans panel is open (both can't open at once, but either can close last)
    const m = document.getElementById('manami');
    if (m) m.inert = document.body.classList.contains('checkup-open') || document.body.classList.contains('plans-open');
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
    const keepFocus = active && root.contains(active) ? (active.matches('.checkup__irrigated') ? '.checkup__irrigated' : active.matches('.checkup__name') ? '.checkup__name' : null) : null;
    open(r);
    if (keepFocus) root.querySelector(keepFocus)?.focus({ preventScroll: true });
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
    rename,
    markYear,
    close,
    insets,
    get openId() { return report?.id ?? null; },
    el: root,
  };
}
