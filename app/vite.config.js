import { defineConfig } from 'vite';

// CropScape (USDA Cropland Data Layer) sends no CORS header, so the browser asks us and we ask it
// (src/data/cdlHistory.js). Works for `npm run dev` and `npm run preview`; a static host needs the same rewrite.
const cropscape = {
  '/cropscape': { target: 'https://nassgeodata.gmu.edu', changeOrigin: true, rewrite: (p) => p.replace(/^\/cropscape/, '') },
};

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: cropscape },
  preview: { proxy: cropscape },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
