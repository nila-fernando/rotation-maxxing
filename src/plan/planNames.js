// The words for the plans and the crops: the names on the cards, and how Manami says them out loud.
// Pure (no DOM, no imports), so the plans panel, the plan views and the tests share them.

/** The three plans, in the order they are shown. */
export const PLANS = [
  { kind: 'current', name: 'Keep going', blurb: 'Your rotation as it is' },
  { kind: 'maxProfit', name: 'Most profit', blurb: 'The most cash over 3 seasons' },
  { kind: 'priority', name: 'Manami’s pick', blurb: 'The best fit for your priorities' },
];

/** Planner crop id -> the name on a card ("Winter wheat"). */
export const CROP_NAME = {
  corn: 'Corn', soybeans: 'Soybeans', 'winter-wheat': 'Winter wheat', 'spring-wheat': 'Spring wheat', sorghum: 'Sorghum',
  cotton: 'Cotton', alfalfa: 'Alfalfa', oats: 'Oats', barley: 'Barley', sunflower: 'Sunflower', canola: 'Canola',
  'dry-beans': 'Dry beans', 'cereal-rye': 'Cereal rye', fallow: 'Fallow',
};

/** How Manami names a plan in a sentence: "more than keeping going", "on my pick". */
export const SPEECH = { current: 'keeping going', maxProfit: 'the most-profit plan', priority: 'my pick', mix: 'your plan' };

/**
 * Planner crop id -> how Manami says it: the word the first time in a line, the short word after
 * that ("soybeans", then "beans"), and whether it takes a plural verb ("beans leave", "corn leaves").
 */
export const CROP_WORD = {
  corn: { word: 'corn', short: 'corn', plural: false },
  soybeans: { word: 'soybeans', short: 'beans', plural: true },
  'winter-wheat': { word: 'winter wheat', short: 'wheat', plural: false },
  'spring-wheat': { word: 'spring wheat', short: 'wheat', plural: false },
  sorghum: { word: 'sorghum', short: 'sorghum', plural: false },
  cotton: { word: 'cotton', short: 'cotton', plural: false },
  alfalfa: { word: 'alfalfa', short: 'alfalfa', plural: false },
  oats: { word: 'oats', short: 'oats', plural: true },
  barley: { word: 'barley', short: 'barley', plural: false },
  sunflower: { word: 'sunflowers', short: 'sunflowers', plural: true },
  canola: { word: 'canola', short: 'canola', plural: false },
  'dry-beans': { word: 'dry beans', short: 'beans', plural: true },
  'cereal-rye': { word: 'cereal rye', short: 'rye', plural: false },
  fallow: { word: 'fallow', short: 'fallow', plural: false },
};

// a percentage as a fraction word, from the top down (anything under the last reads as itself)
const FRACTIONS = [
  [90, 'nearly all'], [70, 'three-quarters'], [60, 'two-thirds'], [45, 'half'], [30, 'a third'], [20, 'a quarter'],
];
const fraction = (pct) => FRACTIONS.find(([min]) => pct >= min)?.[1] ?? null;

/** A share of the say as words: 65 -> "about two-thirds", 92 -> "nearly all", 12 -> "12%". */
export function share(pct) {
  const n = Math.round(pct);
  const f = fraction(n);
  if (!f) return `${n}%`;
  return f === 'nearly all' ? f : `about ${f}`;
}

/** Ground cover as words, for "only about {coverWord} of the ground covered": 24 -> "a quarter". */
export function coverWord(pct) {
  const n = Math.round(pct);
  return fraction(n) ?? `${n}%`;
}
