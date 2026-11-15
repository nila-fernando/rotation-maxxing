// A file from public/ (manami.svg, models/, data/), under the site's base path.
//
//   asset('/manami.svg')   '/manami.svg' locally, '/rotation-maxxing/manami.svg' on GitHub Pages
//
// Vite sets import.meta.env.BASE_URL from `base` (vite build --base=...). Under node:test there's
// no import.meta.env, so the base is '/' and the paths read as they always did.

const BASE = import.meta.env?.BASE_URL || '/';

export const asset = (p) => (BASE.endsWith('/') ? BASE : `${BASE}/`) + String(p).replace(/^\/+/, '');
