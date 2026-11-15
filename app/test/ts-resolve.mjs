// Lets node:test import the vendored TypeScript planner (src/vendor/rotation-maxxing). Node strips
// TypeScript types itself, but it doesn't guess file extensions, and the planner imports
// './evidence' rather than './evidence.ts' (Vite resolves both). This adds the '.ts'.
import { register } from 'node:module';

register('./ts-resolve-hooks.mjs', import.meta.url);
