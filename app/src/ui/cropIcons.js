// Small drawn icons for the crops (no emoji): one per CROP_KEYS entry in src/island/crops.js.
// 24×24, in colour, so a field list reads at a glance.

const S = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

// a grain (wheat, barley) leaning out from the stem
const grain = (x, y, side, fill, line, rx = 1.55) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="2.5" transform="rotate(${side * 32} ${x} ${y})" fill="${fill}" stroke="${line}" stroke-width=".9"/>`;
// slim: narrower grains set closer to the stem (rye)
const ear = (fill, line, awns, slim = false) => {
  let g = `<path d="M12 21.5V6" stroke="${line}" stroke-width="1.6" stroke-linecap="round"/>`;
  const dx = slim ? 1.5 : 2, rx = slim ? 1.15 : 1.55;
  for (const [y, i] of [[8, 0], [11.4, 1], [14.8, 2]]) {
    g += grain(12 - dx, y, -1, fill, line, rx) + grain(12 + dx, y, 1, fill, line, rx);
    if (awns) g += `<path d="M9 ${y - 2}l-3.2-${3 - i * 0.4}M15 ${y - 2}l3.2-${3 - i * 0.4}" stroke="${line}" stroke-width=".9" stroke-linecap="round"/>`;
  }
  g += `<ellipse cx="12" cy="4.6" rx="1.4" ry="2.3" fill="${fill}" stroke="${line}" stroke-width=".9"/>`;
  if (awns) g += '<path d="M12 2.4V.6" stroke="#a5813d" stroke-width=".9" stroke-linecap="round"/>';
  return g;
};

// n petals round (cx, cy), each reaching r out (a sunflower's ring)
const petals = (cx, cy, n, r, fill, line) => {
  let g = '';
  for (let k = 0; k < n; k++) {
    g += `<ellipse cx="${cx}" cy="${cy - r * 0.62}" rx="1.25" ry="${(r * 0.42).toFixed(2)}" transform="rotate(${((k * 360) / n).toFixed(1)} ${cx} ${cy})" fill="${fill}" stroke="${line}" stroke-width=".8"/>`;
  }
  return g;
};
// a little four-petal flower (canola)
const blossom = (x, y, fill, line) =>
  [[0, -1.4], [1.4, 0], [0, 1.4], [-1.4, 0]].map(([dx, dy]) => `<circle cx="${x + dx}" cy="${y + dy}" r="1.5" fill="${fill}" stroke="${line}" stroke-width=".7"/>`).join('') +
  `<circle cx="${x}" cy="${y}" r=".8" fill="#c98a12"/>`;

export const CROP_ICONS = {
  corn: S(
    '<path d="M12 2.8c2.5 0 3.9 3.3 3.9 8.1S14.3 20 12 20s-3.9-4.3-3.9-9.1S9.5 2.8 12 2.8z" fill="#f2c94c" stroke="#b9862a" stroke-width="1.3"/>' +
    '<path d="M10.2 7.4h3.6M9.6 10.4h4.8M9.7 13.4h4.6M10.4 16.4h3.2M12 4.2v14.5" stroke="#c9952f" stroke-width="1" stroke-linecap="round"/>' +
    '<path d="M12 21.4c-3.6-1-6-4.6-6.5-9.6 2.1 1.6 3.7 4.4 4.5 7.7M12 21.4c3.6-1 6-4.6 6.5-9.6-2.1 1.6-3.7 4.4-4.5 7.7" fill="#7cc174" stroke="#3f8a4a" stroke-width="1.2" stroke-linejoin="round"/>',
  ),
  soybeans: S(
    '<path d="M4.9 17.3c-1.4-1.5-.5-4 1.5-5.1l8.8-5.9c2-1.3 4.4.1 3.7 2.4-.5 1.6-1.6 2.9-3.2 4L9.3 17.4c-1.6 1.1-3.2 1.2-4.4-.1z" fill="#a5d68e" stroke="#4f9d63" stroke-width="1.3"/>' +
    '<circle cx="8.2" cy="14.7" r="1.65" fill="#d6edc0"/><circle cx="11.5" cy="12.4" r="1.65" fill="#d6edc0"/><circle cx="14.8" cy="10" r="1.65" fill="#d6edc0"/>' +
    '<path d="M18.6 6.6l2.3-2.3" stroke="#4f9d63" stroke-width="1.6" stroke-linecap="round"/>',
  ),
  wheat: S(ear('#e9c46a', '#a5813d', false)),
  barley: S(ear('#e4cf86', '#a5813d', true)),
  oats: S(
    '<path d="M12 21.5c0-6 0-11 .6-17.5" fill="none" stroke="#8f8a4a" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M12.2 7.5c-2 .6-3.6 2-4.4 3.6M12.3 11c2 .5 3.6 1.8 4.4 3.4M12.2 14c-2 .5-3.4 1.6-4.1 3" fill="none" stroke="#8f8a4a" stroke-width="1.1" stroke-linecap="round"/>' +
    '<path d="M7.8 11.1c-.9 1.1-.9 2.6 0 3.4.9-.8.9-2.3 0-3.4zM16.7 14.4c-.9 1.1-.9 2.6 0 3.4.9-.8.9-2.3 0-3.4zM8.1 17c-.9 1.1-.9 2.6 0 3.4.9-.8.9-2.3 0-3.4zM12.6 4c-.9 1.1-.9 2.6 0 3.4.9-.8.9-2.3 0-3.4z" fill="#ddd29a" stroke="#8f8a4a" stroke-width=".9"/>',
  ),
  sorghum: S(
    '<path d="M12 21.5V11" stroke="#6f9a3a" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M12 17c-2.6-.4-4.6-2-5.4-4.4 2.2.4 4 1.6 5.4 3.4M12 15.6c2.4-.6 4.2-2.2 4.8-4.4-2 .4-3.7 1.6-4.8 3.2" fill="#8cc06e" stroke="#4f8a3a" stroke-width="1" stroke-linejoin="round"/>' +
    '<circle cx="12" cy="4.4" r="1.8" fill="#c0603e"/><circle cx="10" cy="6.6" r="1.9" fill="#b55436"/><circle cx="14" cy="6.6" r="1.9" fill="#c86a45"/><circle cx="12" cy="8.9" r="2" fill="#b55436"/><circle cx="9.9" cy="9.6" r="1.4" fill="#c86a45"/><circle cx="14.1" cy="9.6" r="1.4" fill="#c0603e"/>',
  ),
  alfalfa: S(
    '<path d="M12 21.5v-9" stroke="#4f8a3a" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="12" cy="9.4" r="3.3" fill="#7fc27a" stroke="#3f8a4a" stroke-width="1.1"/><circle cx="8.6" cy="14" r="3.3" fill="#7fc27a" stroke="#3f8a4a" stroke-width="1.1"/><circle cx="15.4" cy="14" r="3.3" fill="#7fc27a" stroke="#3f8a4a" stroke-width="1.1"/>' +
    '<circle cx="12" cy="3.6" r="1.5" fill="#9b7fd1"/><circle cx="10.4" cy="5" r="1.4" fill="#8a6cc4"/><circle cx="13.6" cy="5" r="1.4" fill="#b29be0"/>',
  ),
  hay: S(
    '<rect x="2.6" y="7" width="18.8" height="12.6" rx="6.3" fill="#e3c06a" stroke="#a5813d" stroke-width="1.3"/>' +
    '<circle cx="8.9" cy="13.3" r="5" fill="#ecd08a" stroke="#a5813d" stroke-width="1.1"/>' +
    '<path d="M8.9 13.3m-2.6 0a2.6 2.6 0 1 0 2.6-2.6M8.9 13.3h.01" fill="none" stroke="#a5813d" stroke-width="1.1" stroke-linecap="round"/>' +
    '<path d="M14.6 8.6v9.4M17.6 8.2v10.2" stroke="#c49a46" stroke-width="1" stroke-linecap="round"/>',
  ),
  pasture: S(
    '<path d="M3 20.5h18" stroke="#5f8f45" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M5 20.5c0-3 .6-5.4 2-7.6.3 2.6 0 5 0 7.6M7.4 20.5c.4-3.6 1.6-6.8 3.6-9.4.1 3.4-.6 6.6-1.4 9.4M10.6 20.5c.2-4.2 1-8 2.6-11.6.9 3.8.6 7.8-.2 11.6M13.4 20.5c.8-3.4 2.4-6.2 4.6-8.4-.1 3.1-1 5.9-2.4 8.4M16.4 20.5c.8-2.4 2-4.2 3.6-5.6-.1 2.1-.6 3.9-1.4 5.6" fill="#8fd08a" stroke="#4f8a3a" stroke-width="1" stroke-linejoin="round"/>',
  ),
  fallow: S(
    '<path d="M2.5 18.5c2.4-4.6 5.8-7 9.5-7s7.1 2.4 9.5 7z" fill="#b08665" stroke="#7d5a40" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M6.5 16.6c1.4-1.8 3.4-2.9 5.5-2.9M9.5 18c.8-1.2 1.9-1.9 3.1-2M14.6 15.2c1.4.4 2.6 1.3 3.5 2.6" fill="none" stroke="#7d5a40" stroke-width="1" stroke-linecap="round"/>' +
    '<path d="M12 11.5V8.6" stroke="#6f9a3a" stroke-width="1.3" stroke-linecap="round"/><path d="M12 9c-.2-1.6.8-2.8 2.6-3-.1 1.7-1.1 2.8-2.6 3z" fill="#8cc06e"/>',
  ),
  other: S(
    '<path d="M4 20.5h16" stroke="#7d5a40" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M12 20.5V12" stroke="#4f8a3a" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M12 13c0-4.2 2.8-6.8 7.2-6.8 0 4.3-2.9 6.8-7.2 6.8zM12 14.4c0-3.4-2.3-5.6-6.1-5.6 0 3.6 2.4 5.6 6.1 5.6z" fill="#8cc06e" stroke="#4f8a3a" stroke-width="1" stroke-linejoin="round"/>',
  ),
  cotton: S(
    '<path d="M12 21.5v-7" stroke="#6f8a3c" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M12 19c-2.6-.2-4.4-1.6-5-3.8 2.3.1 4 1.4 5 3.2zM12 18.2c2.4-.4 4-1.9 4.4-4-2.2.3-3.7 1.6-4.4 3.4z" fill="#8cc06e" stroke="#4f8a3a" stroke-width="1" stroke-linejoin="round"/>' +
    '<path d="M8.2 12.4c-.4 1.6.9 2.8 3.8 2.8s4.2-1.2 3.8-2.8" fill="#a5733f" stroke="#7d5a40" stroke-width="1" stroke-linejoin="round"/>' +
    '<g fill="#fbf8ef" stroke="#a9a290" stroke-width="1"><circle cx="8.8" cy="9.6" r="3"/><circle cx="15.2" cy="9.6" r="3"/><circle cx="12" cy="6.4" r="3.2"/><circle cx="12" cy="10.6" r="2.7"/></g>',
  ),
  sunflower: S(
    '<path d="M12 21.5v-8" stroke="#5f8f45" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M12 18.6c-2.4 0-4.2-1.2-4.9-3.2 2.2-.1 3.9.9 4.9 2.6" fill="#8cc06e" stroke="#4f8a3a" stroke-width="1" stroke-linejoin="round"/>' +
    petals(12, 8.6, 12, 4.3, '#f5c518', '#c28f12') +
    '<circle cx="12" cy="8.6" r="3" fill="#6b4428" stroke="#4a2e1a" stroke-width="1"/><path d="M11 7.8h.01M13 7.8h.01M12 9.6h.01" stroke="#a5733f" stroke-width="1.1" stroke-linecap="round"/>',
  ),
  canola: S(
    '<path d="M12 21.5v-9M12 16l-4.2-5M12 14.6l4.4-5.2" fill="none" stroke="#5f8f45" stroke-width="1.4" stroke-linecap="round"/>' +
    blossom(12, 8.4, '#f4d31f', '#b8951a') + blossom(7.4, 8.6, '#f7dc3b', '#b8951a') + blossom(16.6, 7.4, '#f4d31f', '#b8951a'),
  ),
  rye: S(ear('#c4cf9a', '#7d8f5e', true, true)),
  drybeans: S(
    '<path d="M5.2 9.6c1.8-3.4 7.2-3.6 9.4-.6 1.5 2.1.8 4.2-1 4.6-1.4.3-2.1-.7-3.4-.7s-2 1.5-4 1.5c-2 0-2.4-2.6-1-4.8z" fill="#b5523b" stroke="#7a3326" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M9.6 17.2c1.4-2.6 5.6-2.8 7.3-.5 1.2 1.6.6 3.2-.8 3.5-1.1.2-1.6-.5-2.6-.5s-1.6 1.2-3.1 1.2c-1.6 0-1.9-2-.8-3.7z" fill="#efe2c4" stroke="#a58a5c" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M7.6 9c.8-.7 1.9-1 3-.9M12 17.4c.6-.5 1.4-.7 2.2-.6" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1" stroke-linecap="round"/>' +
    '<path d="M17.4 8.6c.4-2.4 2-3.8 4.2-3.8-.2 2.3-1.7 3.7-4.2 3.8z" fill="#8cc06e" stroke="#4f8a3a" stroke-width="1" stroke-linejoin="round"/>',
  ),
  springwheat: S(ear('#cfcf86', '#7f8a45', true)),
  potatoes: S(
    '<path d="M3.6 14.6c0-2.8 2.4-4.6 5.4-4.6 2.4 0 3.4 1 5 1 2.4 0 4.4 1.4 4.4 3.8 0 2.8-2.6 4.6-6.4 4.6-4.8 0-8.4-1.8-8.4-4.8z" fill="#c99a62" stroke="#8a6238" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M7 13.6h.01M10.6 15.8h.01M14.4 13.4h.01M15.6 16.6h.01" stroke="#8a6238" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M12 10.6V7" stroke="#4f8a3a" stroke-width="1.3" stroke-linecap="round"/>' +
    '<path d="M12 7.6c-.4-2.4 1-4 3.6-4.2-.1 2.4-1.5 3.9-3.6 4.2zM12 8.6c-.2-1.9-1.5-3.1-3.6-3.1.1 1.9 1.4 3 3.6 3.1z" fill="#6aa552" stroke="#3f7a35" stroke-width="1" stroke-linejoin="round"/>',
  ),
  sugarbeets: S(
    '<path d="M12 7.4c-.6-2.6-2.6-4.4-5.2-4.6.2 2.8 2.2 4.6 5.2 4.6zM12 7.4c.6-2.6 2.6-4.4 5.2-4.6-.2 2.8-2.2 4.6-5.2 4.6zM12 7.6c-.8-2-.6-4 .1-5.6 1 1.6 1.1 3.6-.1 5.6z" fill="#4a8a3c" stroke="#2f6a2c" stroke-width="1" stroke-linejoin="round"/>' +
    '<path d="M12 22c-1.1-1.8-4.2-4.6-4.2-8 0-2.5 1.9-4.2 4.2-4.2s4.2 1.7 4.2 4.2c0 3.4-3.1 6.2-4.2 8z" fill="#f0e6cf" stroke="#a58a5c" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M10.2 13.4c.9.3 2.1.3 3 0M10.8 16.4c.6.2 1.5.2 2.2 0" fill="none" stroke="#c9b48a" stroke-width="1" stroke-linecap="round"/>',
  ),
  peanuts: S(
    '<g transform="rotate(-35 12 12)">' +
    '<path d="M12 3.2c2.6 0 4 1.9 4 4 0 1.3-.7 2-.7 3.2s.7 2 .7 3.3c0 2.2-1.5 4.1-4 4.1s-4-1.9-4-4.1c0-1.3.7-2 .7-3.3S8 8.5 8 7.2c0-2.1 1.4-4 4-4z" fill="#e0b77a" stroke="#9a6f3c" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M10.2 6.2h.01M13.6 7.4h.01M11.4 8.6h.01M10.4 13h.01M13.4 12.8h.01M12 15.2h.01" stroke="#b08550" stroke-width="1.3" stroke-linecap="round"/>' +
    '</g>',
  ),
  rice: S(
    '<path d="M2.5 20.5c1.6-1 3.2-1 4.8 0s3.2 1 4.8 0 3.2-1 4.8 0 3.2 1 4.6 0" fill="none" stroke="#5f9fc0" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M9 19V9.6c0-2.6 2-4.6 5-5" fill="none" stroke="#5f8f45" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M9.4 19c-.4-3-1.6-5.2-3.6-6.6.2 2.6.9 4.8 2.4 6.6" fill="#8cc06e" stroke="#4f8a3a" stroke-width="1" stroke-linejoin="round"/>' +
    '<g fill="#ead79a" stroke="#a58a4c" stroke-width=".9">' +
    '<ellipse cx="14.6" cy="5.6" rx="1.1" ry="1.8" transform="rotate(50 14.6 5.6)"/><ellipse cx="16.8" cy="7.4" rx="1.1" ry="1.8" transform="rotate(30 16.8 7.4)"/><ellipse cx="18" cy="10" rx="1.1" ry="1.8" transform="rotate(10 18 10)"/>' +
    '<ellipse cx="18.2" cy="13" rx="1.1" ry="1.8"/><ellipse cx="14.8" cy="9" rx="1.1" ry="1.8" transform="rotate(25 14.8 9)"/><ellipse cx="15.6" cy="12" rx="1.1" ry="1.8" transform="rotate(5 15.6 12)"/></g>',
  ),
  vegetables: S(
    '<path d="M3.8 20.2c4-1.2 8.4-5.6 10-9.2.7-1.6-.8-3.1-2.4-2.4-3.6 1.6-8 6-9.2 10-.3 1 .6 1.9 1.6 1.6z" fill="#f08a2e" stroke="#b45a1c" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M6.4 15.4l1.4 1.2M8.8 12.8l1.3 1.1" stroke="#b45a1c" stroke-width="1" stroke-linecap="round"/>' +
    '<path d="M13.4 8.8c.2-2.2 1.2-3.8 3-4.6-.1 1.8-1.1 3.4-3 4.6zM14 9.6c1.6-1.4 3.4-1.8 5.4-1.2-1.4 1.3-3.2 1.7-5.4 1.2z" fill="#6aa552" stroke="#3f7a35" stroke-width="1" stroke-linejoin="round"/>' +
    '<circle cx="17.6" cy="16.6" r="3.6" fill="#e0483a" stroke="#a52e24" stroke-width="1.2"/>' +
    '<path d="M16.2 13.4l1.4.9 1.4-.9" fill="none" stroke="#3f7a35" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  strawberries: S(
    '<path d="M12 21.4c-3.6-1.6-7-5.6-7-9.6 0-2.4 1.8-3.8 3.6-3.8 1.4 0 2.4.6 3.4.6s2-.6 3.4-.6c1.8 0 3.6 1.4 3.6 3.8 0 4-3.4 8-7 9.6z" fill="#e2464a" stroke="#a62b31" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M9 11.6h.01M12 11h.01M15 11.6h.01M10.4 14.4h.01M13.6 14.4h.01M12 17.4h.01M8.4 14.6h.01M15.6 14.6h.01" stroke="#f7e39a" stroke-width="1.2" stroke-linecap="round"/>' +
    '<path d="M12 8.4c-1-1.2-2.6-1.6-4.2-1.2 1 1.2 2.4 1.6 4.2 1.2zM12 8.4c1-1.2 2.6-1.6 4.2-1.2-1 1.2-2.4 1.6-4.2 1.2zM12 8.6c-.4-1.6 0-3 1.2-4.2.5 1.6.1 3-1.2 4.2z" fill="#6aa552" stroke="#3f7a35" stroke-width="1" stroke-linejoin="round"/>',
  ),
  berries: S(
    '<path d="M13.4 8.2c.4-2.6 2.4-4.4 5.2-4.6-.3 2.7-2.3 4.4-5.2 4.6z" fill="#6aa552" stroke="#3f7a35" stroke-width="1" stroke-linejoin="round"/>' +
    '<g fill="#5b6fb8" stroke="#33427e" stroke-width="1.2"><circle cx="8.4" cy="12.4" r="3.6"/><circle cx="15.6" cy="12.8" r="3.4"/><circle cx="11.8" cy="17.6" r="3.6"/></g>' +
    '<path d="M7.6 11.6l1.6 1.6M9.2 11.6l-1.6 1.6M14.8 12l1.6 1.6M16.4 12l-1.6 1.6M11 16.8l1.6 1.6M12.6 16.8L11 18.4" stroke="#2a3768" stroke-width=".9" stroke-linecap="round"/>' +
    '<path d="M6.6 10.6c.5-.5 1.1-.7 1.8-.7M13.9 11c.5-.4 1-.6 1.6-.6M10 15.8c.5-.5 1.1-.7 1.8-.7" fill="none" stroke="#c6d0f2" stroke-width=".9" stroke-linecap="round"/>',
  ),
  grapes: S(
    '<path d="M12 6.6c0-1.8.8-3.2 2.4-4" fill="none" stroke="#7d5a40" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M12.6 5.4c1.4-1.6 3.6-2 5.8-1.2-1.2 1.9-3.4 2.5-5.8 1.2z" fill="#6aa552" stroke="#3f7a35" stroke-width="1" stroke-linejoin="round"/>' +
    '<g fill="#7a4f9e" stroke="#4e3168" stroke-width="1"><circle cx="8.6" cy="8.6" r="2.3"/><circle cx="12.4" cy="8.4" r="2.3"/><circle cx="16" cy="8.8" r="2.3"/><circle cx="10.4" cy="12.2" r="2.3"/><circle cx="14.2" cy="12.2" r="2.3"/><circle cx="12.2" cy="15.8" r="2.3"/><circle cx="12.2" cy="19.4" r="2.1"/></g>',
  ),
  orchard: S(
    '<path d="M12 21.5v-6.6M12 17l-2.4-2.2M12 16.2l2.2-1.8" fill="none" stroke="#7a5a3c" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M12 2.8c3.4 0 6.2 2.4 6.2 5.6 0 3.4-2.8 6-6.2 6s-6.2-2.6-6.2-6c0-3.2 2.8-5.6 6.2-5.6z" fill="#7fc27a" stroke="#3f8a4a" stroke-width="1.3"/>' +
    '<g fill="#e0483a" stroke="#a52e24" stroke-width=".8"><circle cx="9.4" cy="8" r="1.3"/><circle cx="14.4" cy="6.4" r="1.3"/><circle cx="13.6" cy="10.8" r="1.3"/></g>' +
    '<path d="M4 21.5h16" stroke="#5f8f45" stroke-width="1.6" stroke-linecap="round"/>',
  ),
  sugarcane: S(
    '<g stroke-linecap="round"><path d="M9 21.5V6.4M14.4 21.5V8.4" stroke="#a3ad62" stroke-width="2.6"/>' +
    '<path d="M7.8 10.4h2.4M7.8 15h2.4M7.8 19.2h2.4M13.2 12.6h2.4M13.2 17h2.4" stroke="#6f7a3a" stroke-width="1.1"/></g>' +
    '<path d="M9 6.6c-1-2-2.8-3.4-5.2-3.8M9 6.6c1.6-1.8 3.6-2.6 6-2.4M14.4 8.6c1.2-2 3.2-3 5.6-3M14.4 8.6c-.8-1.8-.6-3.8.4-5.6" fill="none" stroke="#5f9a3a" stroke-width="1.5"/>',
  ),
  tobacco: S(
    '<path d="M12 21.5c-5.2-1.8-8-6.4-7.6-11.6C4.8 5.6 8 2.8 12 2.4c4 .4 7.2 3.2 7.6 7.5.4 5.2-2.4 9.8-7.6 11.6z" fill="#8cc06e" stroke="#4f8a3a" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M12 21.5V5M12 9.4l-3.6-2.6M12 9.4l3.6-2.6M12 13.4l-4.6-3M12 13.4l4.6-3M12 17.4l-4-2.6M12 17.4l4-2.6" fill="none" stroke="#4f8a3a" stroke-width="1" stroke-linecap="round"/>',
  ),
};

/** The icon for a crop key; unknown keys get the sprout. */
export const cropIcon = (key) => CROP_ICONS[key] || CROP_ICONS.other;
