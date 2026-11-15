// Small drawn icons for the crops (no emoji): one per CROP_KEYS entry in src/island/crops.js.
// 24×24, in colour, so a field list reads at a glance.

const S = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

// a grain (wheat, barley) leaning out from the stem
const grain = (x, y, side, fill, line) =>
  `<ellipse cx="${x}" cy="${y}" rx="1.55" ry="2.5" transform="rotate(${side * 32} ${x} ${y})" fill="${fill}" stroke="${line}" stroke-width=".9"/>`;
const ear = (fill, line, awns) => {
  let g = `<path d="M12 21.5V6" stroke="${line}" stroke-width="1.6" stroke-linecap="round"/>`;
  for (const [y, i] of [[8, 0], [11.4, 1], [14.8, 2]]) {
    g += grain(10, y, -1, fill, line) + grain(14, y, 1, fill, line);
    if (awns) g += `<path d="M9 ${y - 2}l-3.2-${3 - i * 0.4}M15 ${y - 2}l3.2-${3 - i * 0.4}" stroke="${line}" stroke-width=".9" stroke-linecap="round"/>`;
  }
  g += `<ellipse cx="12" cy="4.6" rx="1.4" ry="2.3" fill="${fill}" stroke="${line}" stroke-width=".9"/>`;
  if (awns) g += '<path d="M12 2.4V.6" stroke="#a5813d" stroke-width=".9" stroke-linecap="round"/>';
  return g;
};

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
};

/** The icon for a crop key; unknown keys get the sprout. */
export const cropIcon = (key) => CROP_ICONS[key] || CROP_ICONS.other;
