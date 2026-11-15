// A small season strip for one crop and season: March to November with month initials underneath,
// the usual sowing run (soft green), the best window (solid green, rounded caps), the recent halfway
// tick, the last day for full insurance (dashed wood-brown, with a small shield), the harvest run
// (gold), the frost medians (snowflakes) and a cover crop's seeding run (sage). Winter wheat's fall
// sowing band is labelled "the fall before". An SVG string (role="img" with an aria-label) followed
// by an sr-only list of the same facts with their sources. Colours are CSS tokens (calendar.css).
import { windowsFor, coverFor, frostFor, fmt, rangeWords, partWords, dayOf, LABEL } from '../plan/cropCalendar.js';
import { word } from '../plan/futuresVoice.js';
import { CAL_ICONS } from './rotationIcons.js';
import { LENS_ICONS } from './futureIcons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = (n) => Math.round(n * 10) / 10;

const AXIS_FROM = dayOf('03-01');
const AXIS_TO = dayOf('12-01');
const MONTH_STARTS = ['03-01', '04-01', '05-01', '06-01', '07-01', '08-01', '09-01', '10-01', '11-01'];
const INITIALS = ['M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N'];

const SRC_NAME = {
  h628: 'USDA Handbook 628', nassProgress: 'USDA NASS Crop Progress', rma2026: 'USDA RMA 2026', isuCorn2010: 'Iowa State',
  isuLicht2020: 'Iowa State', pfiWheat: 'Practical Farmers of Iowa', nrcsRyeIA2025: 'NRCS and Iowa State', noaaNormals: 'NOAA normals',
};

/** An icon placed inside the strip: the 24×24 drawing scaled to `size` at (x, y). */
const placeIcon = (svg, x, y, size, cls) => svg.replace('<svg ', `<svg x="${r1(x)}" y="${r1(y)}" width="${size}" height="${size}" class="${cls}" `);

/** The x scale of a strip: "MM-DD" → pixels, clamped to March–November. */
export function stripScale(width = 300, pad = 6) {
  const span = AXIS_TO - AXIS_FROM;
  return (mmdd) => {
    const d = Math.min(AXIS_TO, Math.max(AXIS_FROM, dayOf(mmdd) ?? AXIS_FROM));
    return r1(pad + ((d - AXIS_FROM) / span) * (width - 2 * pad));
  };
}

/** The strip's SVG plus a following <ul class="sr-only">. */
export function seasonStripSvg(cropId, year, place, { width = 300, height = 36, cover = null } = {}) {
  const w = windowsFor(cropId, place);
  const c = cover ? coverFor(cover, place) : null;
  const f = frostFor(place);
  const x = stripScale(width);
  const bandY = 12, bandH = 10, labelY = height - 2;
  const parts = [];
  const facts = [];
  const band = (kind, a, b, { rx = 2, y = bandY, h = bandH } = {}) => {
    const x0 = x(a), x1 = Math.max(x(b), x0 + 2);
    parts.push(`<rect class="ss-${kind}" data-kind="${kind}" data-x0="${x0}" data-x1="${r1(x1)}" x="${x0}" y="${y}" width="${r1(x1 - x0)}" height="${h}" rx="${rx}"/>`);
  };

  // month initials and faint month lines
  MONTH_STARTS.forEach((m, i) => {
    const x0 = x(m);
    const next = i + 1 < MONTH_STARTS.length ? x(MONTH_STARTS[i + 1]) : x('12-01');
    parts.push(`<line class="ss-month" x1="${x0}" y1="${bandY - 2}" x2="${x0}" y2="${bandY + bandH + 2}"/>`);
    parts.push(`<text class="ss-initial" x="${r1((x0 + next) / 2)}" y="${labelY}" text-anchor="middle">${INITIALS[i]}</text>`);
  });

  let sowWords = null, harvestWords = null;
  if (w) {
    const u = w.sow.usual, b = w.sow.best;
    if (u?.active[0] && u.active[1]) {
      band('usual', u.active[0], u.active[1]);
      facts.push(`${LABEL.usual} ${rangeWords(u.active[0], u.active[1])} (${SRC_NAME[u.src]})`);
    }
    if (b?.to) {
      const from = b.from ?? u?.active[0] ?? u?.begin ?? b.to;
      band('best', from, b.to, { rx: bandH / 2 });
      facts.push(`${LABEL.best} ${b.from ? rangeWords(b.from, b.to) : `by ${fmt(b.to)}`} (${SRC_NAME[b.src]}${b.secondary ? ', a farmer group' : ''})`);
    }
    sowWords = b?.from && b.to ? rangeWords(b.from, b.to) : b?.to ? `by ${fmt(b.to)}` : u?.active[0] ? rangeWords(u.active[0], u.active[1]) : null;
    if (w.sow.plantsFallBefore && (u || b)) {
      // to the left of the sowing band (late summer is clear: the harvest is in July), so it never
      // runs into the frost and insurance marks drawn above the band in October
      const at = Math.min(x(b?.from ?? u?.active[0]), x(u?.active[0] ?? b?.from)) - 3;
      parts.push(`<text class="ss-note" x="${r1(at)}" y="${bandY + 6}" text-anchor="end">the fall before</text>`);
      if (sowWords) sowWords = `${sowWords} the fall before`;
    }
    const r = w.sow.recent;
    if (r?.p50) {
      const xt = x(r.p50);
      parts.push(`<line class="ss-half" data-kind="half" data-x="${xt}" x1="${xt}" y1="${bandY - 2}" x2="${xt}" y2="${bandY + bandH + 2}"/>`);
      facts.push(`${LABEL.recent} ${fmt(r.p50)}, ${r.years} (${SRC_NAME[r.src]})`);
    }
    const h = w.harvest.usual;
    if (h?.active[0] && h.active[1]) {
      band('harvest', h.active[0], h.active[1]);
      harvestWords = `${partWords(h.active[0])} to ${partWords(h.active[1])}`;
      facts.push(`${LABEL.harvest} ${rangeWords(h.active[0], h.active[1])} (${SRC_NAME[h.src]})`);
    }
    const ins = w.sow.insurance;
    if (ins?.final) {
      const xi = x(ins.final);
      parts.push(`<line class="ss-insurance" data-kind="insurance" data-x="${xi}" x1="${xi}" y1="${bandY - 3}" x2="${xi}" y2="${bandY + bandH + 3}"/>`);
      parts.push(placeIcon(CAL_ICONS.insurance, xi - 4.5, 0, 9, 'ss-icon ss-icon--insurance'));
      facts.push(`${LABEL.insurance}${ins.what === 'spring' ? ' on a spring seeding' : ''} ${ins.scopeWords}: ${fmt(ins.final)} (${SRC_NAME[ins.src]})`);
    }
  }
  if (c) {
    band('cover', c.seed[0], c.seed[1], { y: bandY + bandH - 3, h: 4, rx: 2 });
    facts.push(`Cereal rye cover seeded ${rangeWords(c.seed[0], c.seed[1])} (${SRC_NAME[c.src]})`);
  }
  if (f) {
    for (const [mmdd, what] of [[f.lastSpring.p50, 'Last spring frost, usually'], [f.firstFall?.p50, 'First fall frost, usually']]) {
      if (!mmdd) continue;
      parts.push(placeIcon(LENS_ICONS.frost, x(mmdd) - 4.5, 0, 9, 'ss-icon ss-icon--frost').replace('<svg ', `<svg data-kind="frost" data-x="${x(mmdd)}" `));
      facts.push(`${what} ${fmt(mmdd)} (${SRC_NAME[f.src]}, ${f.stationName})`);
    }
  }

  const name = word(cropId);
  const label = !w
    ? `${year} ${name}: no sowing dates here yet`
    : `${year} ${name}: ${[sowWords ? `sow ${sowWords}` : null, harvestWords ? `${cropId === 'alfalfa' ? 'cut' : 'harvest'} ${harvestWords}` : null, c ? `rye cover from ${partWords(c.seed[0])}` : null].filter(Boolean).join(', ')}`;
  const svg = `<svg class="season-strip" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}" focusable="false">${parts.join('')}</svg>`;
  const list = `<ul class="sr-only">${facts.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  return svg + list;
}
