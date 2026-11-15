import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { aiServerPlugin } from './server/ai/vitePlugin.js';

// CropScape (USDA Cropland Data Layer) sends no CORS header, so the browser asks us and we ask it
// (src/data/cdlHistory.js). The dev server and `npm run preview` proxy /cropscape themselves.
const cropscape = {
  '/cropscape': { target: 'https://nassgeodata.gmu.edu', changeOrigin: true, rewrite: (p) => p.replace(/^\/cropscape/, '') },
};

// Where the app asks for CropScape: VITE_CDL_PROXY (environment or .env) when set, '' to turn it off.
// Otherwise '/cropscape' for `npm run dev` and the local build that `npm run preview` serves, and off
// for the GitHub Pages build (`npm run build:pages`, mode "pages"): a static host can't proxy, and
// the check-up says those years are out of reach instead of asking and failing.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  // Where the page asks Manami: blank = this site's own /api/ai; off on the GitHub Pages build
  // (no server there) unless VITE_AI_ENDPOINT is set.
  const aiEndpoint = env.VITE_AI_ENDPOINT || (mode === 'pages' ? 'off' : '');
  const cdlProxy = env.VITE_CDL_PROXY ?? (mode === 'pages' ? '' : '/cropscape');
  // Ask Manami's server (server/ai) gets every .env value, read here on the server only; the page
  // only ever gets the VITE_ values defined below.
  const serverEnv = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  return {
    plugins: [aiServerPlugin(serverEnv)],
    define: { 'import.meta.env.VITE_CDL_PROXY': JSON.stringify(cdlProxy), 'import.meta.env.VITE_AI_ENDPOINT': JSON.stringify(aiEndpoint) },
    server: { port: 5173, strictPort: true, proxy: cropscape },
    preview: { proxy: cropscape },
    build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  };
});
