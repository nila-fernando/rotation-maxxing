import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { handle as proxyHandle } from '../proxy/cropscape/worker.js';
import { aiServerPlugin } from './server/ai/vitePlugin.js';

// CropScape (USDA Cropland Data Layer) sends no CORS header, so the browser asks us and we ask it
// (src/data/cdlHistory.js). The dev server and `npm run preview` proxy /cropscape themselves.
const cropscape = {
  '/cropscape': { target: 'https://nassgeodata.gmu.edu', changeOrigin: true, rewrite: (p) => p.replace(/^\/cropscape/, '') },
};

/**
 * USDA NASS Quick Stats needs an API key and sends no CORS header (src/data/nass.js). The dev server
 * and `npm run preview` answer /nass/api_GET/ themselves, with the same code as the live site's
 * Cloudflare Worker (proxy/cropscape/worker.js): only allowed filter parameters, any client `key`
 * dropped, and the key added here on the server. The key comes from NASS_API_KEY in the environment
 * (or a git-ignored .env / .env.local): it is never defined into the client bundle.
 */
function nassProxy(key) {
  const memo = new Map(); // a tiny stand-in for the Worker's edge cache, for the life of the server
  const cache = {
    match: async (req) => memo.get(req.url)?.clone(),
    put: async (req, res) => { if (memo.size > 200) memo.clear(); memo.set(req.url, res); },
  };
  const middleware = async (req, res, next) => {
    if (!req.url?.startsWith('/nass/')) return next();
    try {
      // the browser is on this same server, so no Origin check here (it's a local dev server)
      const answer = await proxyHandle(new Request(`http://localhost${req.url}`, { method: req.method }), { nassKey: key, cache, waitUntil: (p) => p });
      res.statusCode = answer.status;
      answer.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await answer.arrayBuffer()));
    } catch (e) {
      res.statusCode = 502;
      res.end('NASS proxy error');
      console.warn('[nass proxy]', e?.message);
    }
  };
  return {
    name: 'nass-proxy',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

// Where the app asks for CropScape and NASS: VITE_CDL_PROXY / VITE_NASS_PROXY (environment or .env)
// when set, '' to turn one off. Otherwise '/cropscape' and '/nass' for `npm run dev` and the local
// build that `npm run preview` serves, and off for the GitHub Pages build (`npm run build:pages`,
// mode "pages"): a static host can't proxy, so the check-up says those years are out of reach and the
// plans use the bundled stand-in prices (and say so), instead of asking and failing.
export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, root, 'VITE_');
  const cdlProxy = env.VITE_CDL_PROXY ?? (mode === 'pages' ? '' : '/cropscape');
  const nassProxyBase = env.VITE_NASS_PROXY ?? (mode === 'pages' ? '' : '/nass');
  // Where the page asks Manami: blank = this site's own /api/ai; off on the GitHub Pages build
  // (no server there) unless VITE_AI_ENDPOINT is set.
  const aiEndpoint = env.VITE_AI_ENDPOINT || (mode === 'pages' ? 'off' : '');
  // Ask Manami's server (server/ai) gets every .env value, read here on the server only; the page
  // only ever gets the VITE_ values defined below.
  const serverEnv = loadEnv(mode, root, '');
  // server side only (never defined into the page)
  const nassKey = process.env.NASS_API_KEY || serverEnv.NASS_API_KEY || '';
  return {
    define: {
      'import.meta.env.VITE_CDL_PROXY': JSON.stringify(cdlProxy),
      'import.meta.env.VITE_NASS_PROXY': JSON.stringify(nassProxyBase),
      'import.meta.env.VITE_AI_ENDPOINT': JSON.stringify(aiEndpoint),
    },
    plugins: [aiServerPlugin(serverEnv), nassProxy(nassKey)],
    server: { port: 5173, strictPort: true, proxy: cropscape },
    preview: { proxy: cropscape },
    build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  };
});
