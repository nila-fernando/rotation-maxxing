// Small drawn icons for the soil jar test (src/screens/jarPanel.js and the field check-up). No emoji.
//
// The cozy-kit line style, as src/ui/futureIcons.js: 24×24, stroke currentColor at 2.2 with round
// caps and joins, soft fills at fill-opacity .2, hidden from screen readers (the button or label
// next to each says it). Size comes from CSS.

const S = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** A jar with a lid and two lines of settled soil, the bottom one shaded. */
export const JAR = S('<path d="M8.5 3h7v3h-7z"/><path d="M7 6h10a1 1 0 0 1 1 1v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7a1 1 0 0 1 1-1z"/><path d="M6.5 13.5h11M6.5 17h11"/><path d="M6.5 17h11v2a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z" fill="currentColor" fill-opacity=".2" stroke="none"/>');

/** A camera, for "Take a photo". */
export const CAMERA = S('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>');

/** A picture with a sun and hills, for "Choose a photo". */
export const IMAGE = S('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 3-3 4 4"/>');

// as the field step's Split and Merge tools (index.html)
/** A field with a dashed line across it, for "Split". */
export const SPLIT = S('<rect x="4" y="5" width="16" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 2L9 22" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="3 2.4"/>');

/** Two fields side by side, one dashed, for "Merge". */
export const MERGE = S('<rect x="3" y="6" width="9" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="12" y="6" width="9" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="3 2"/>');

export const JAR_ICONS = { JAR, CAMERA, IMAGE, SPLIT, MERGE };
