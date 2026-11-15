// App-wide settings. Change these here rather than in the screens.

import { asset } from './ui/asset.js';

/** Where the logo goes: the marketing landing page. Set VITE_LANDING_URL in .env when it has a home;
 *  until then, the app's own start (under the site's base path, so on GitHub Pages it stays on the site). */
export const LANDING_URL = import.meta.env.VITE_LANDING_URL || asset('/');

/** Satellite imagery for the map and for the globe's last stretch of the dive.
 *  Esri World Imagery is fine for a prototype; a live app needs its own imagery licence. */
export const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const TILE_ATTRIBUTION = 'Imagery &copy; Esri, Maxar, Earthstar Geographics &amp; the GIS User Community';

/** Where the globe faces when the app opens (tilted toward the continental US). */
export const OPENING_VIEW = { lat: 34, lon: -86 };
/** The slow idle spin, in degrees of longitude per second. */
export const SPIN_DEG_PER_SEC = 0.9;

/** Map zoom where the globe hands over to the flat satellite map (from the globe kit). */
export const HANDOFF_ZOOM = 7;
/** How close we land, by kind of place, so field boundaries are easy to see. */
export const LAND_ZOOM = { farm: 15.5, house: 16, street: 15.5, place: 14, county: 12.5, other: 14 };
/** Counties and towns are fitted to their outline, but never further out than this. */
export const MIN_AREA_ZOOM = 11.5;

/** The intro: how long after the globe appears the search bar and then Manami show up. */
export const INTRO = { searchAfterMs: 450, manamiAfterMs: 1400 };
