// Mounts Ask Manami's server at /api/ai for `npm run dev` and `npm run preview`. The key is read
// here, on the server, from app/.env (no VITE_ prefix), and never reaches the page.

import { configFromEnv, createAiHandler } from './handler.js';
import { toNodeMiddleware } from './nodeAdapter.js';

/** Sign-in hook: null (open) until Supabase sign-in is in. */
export async function getUser(/* request */) { return null; }

export function aiServerPlugin(env) {
  const config = configFromEnv(env);
  let client = null;
  const getClient = () => {
    if (!client) throw new Error('AI client not ready');
    return client;
  };
  const handle = createAiHandler({ config, getClient, getUser });
  const mount = async (server) => {
    if (config.ai && !client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      client = new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 120_000 });
    }
    server.middlewares.use('/api/ai', toNodeMiddleware(handle));
  };
  return {
    name: 'ask-manami-ai',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
