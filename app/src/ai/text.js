// Manami never uses emoji (the app draws its icons). Model text is cleaned defensively on the way in.

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️⃣‍]/gu;

/** Removes emoji (and their joiners, skin tones, flags and keycap marks); collapses the doubled spaces left behind. */
export function stripEmoji(s) {
  return String(s ?? '').replace(EMOJI, '').replace(/ {2,}/g, ' ');
}

/** For streamed pieces: only the emoji, so spacing across pieces is kept. */
export function stripEmojiDelta(s) {
  return String(s ?? '').replace(EMOJI, '');
}

/** The finished answer: no emoji, no markdown leftovers (bold, headings), trimmed. */
export function tidyAnswer(s) {
  return stripEmoji(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/[ \t]+\n/g, '\n').trim();
}
