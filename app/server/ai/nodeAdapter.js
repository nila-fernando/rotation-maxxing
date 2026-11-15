// Connect/Node middleware around the web-standard handler (for Vite's dev and preview servers).

import { Readable } from 'node:stream';

export function toNodeMiddleware(handle) {
  return async function aiMiddleware(req, res, next) {
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    try {
      const host = req.headers.host || 'localhost';
      const url = new URL(req.originalUrl || req.url, `http://${host}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const request = new Request(url, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: hasBody ? 'half' : undefined, signal: ac.signal });
      const response = await handle(request, { ip: req.socket?.remoteAddress || 'unknown' });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) { res.end(); return; }
      const reader = response.body.getReader();
      ac.signal.addEventListener('abort', () => reader.cancel().catch(() => {}), { once: true });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      if (ac.signal.aborted) return;
      console.warn('[ai] middleware', err?.name || 'error');
      if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: { code: 'server_error', message: 'Server error.', retryable: false } })); } else res.end();
      void next;
    }
  };
}
