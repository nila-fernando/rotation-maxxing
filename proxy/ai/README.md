# Ask Manami server (Cloudflare Worker)

The live site is on GitHub Pages, which has no server, so Ask Manami is off there. This Worker runs
the app's own AI server (`app/server/ai/handler.js`, the same code `npm run dev` mounts at `/api/ai`)
on Cloudflare, so the live site can use it before Supabase is set up.

It serves everything under `/api/ai/`: `GET /api/ai/health`, `POST /api/ai/chat` (a streamed
Server-Sent Events answer) and any route the handler adds later (such as `jar`). On top of the
handler's own checks (body size, history length, context size) it adds:

- **CORS for the app only**: `https://nila-fernando.github.io`, `http://localhost:5173` and
  `http://localhost:4173`, plus `EXTRA_ORIGINS`. Other browser origins get a 403.
- **A per-IP limit**: 10 requests a minute (`AI_RATE_LIMIT_PER_MIN` to change it).
- **A soft daily cap**: `DAILY_REQUEST_LIMIT` (500) requests a day.

Both limits are kept in memory per Worker isolate, so they are rough: Cloudflare can run several
isolates, and a new one starts from zero. They slow down abuse; they don't stop it. See the warning below.

## Before you deploy: set a spend limit

**This endpoint has no sign-in yet.** Anyone who finds the address can use it from a browser on the
app's site, and every question costs money on your Anthropic key. Before deploying, go to the
Anthropic Console (https://console.anthropic.com) > **Settings** > **Limits** and set a **monthly
spend limit** you are happy to lose. Consider a separate key just for this Worker, so you can revoke
it on its own.

## Deploy

The Worker bundles the Anthropic SDK from the app's own install, so install the app first.

```sh
cd app
npm ci
cd ../proxy/ai
npx wrangler@4 login
npx wrangler@4 secret put ANTHROPIC_API_KEY
npx wrangler@4 deploy
```

`secret put` asks for the key and stores it encrypted at Cloudflare. **Never put the key in
`wrangler.toml`, `.env` or any file in the repo.** (If you deploy before setting the secret, the
Worker answers `ai: false, reason: "no_key"` and the app keeps Manami off.)

The deploy prints the Worker's address, e.g. `https://rotation-maxxing-ai.<your-subdomain>.workers.dev`.

To check the bundle without deploying: `npx wrangler@4 deploy --dry-run --outdir <some-folder>`.

## Check it

```sh
curl -i -H "Origin: https://nila-fernando.github.io" \
  "https://rotation-maxxing-ai.<your-subdomain>.workers.dev/api/ai/health"
```

You should get `200`, `Access-Control-Allow-Origin: https://nila-fernando.github.io` and
`{"ok":true,"v":1,"ai":true,"model":"claude-sonnet-5-5",...}`. The body never contains the key.

## Turn it on for the live site

1. GitHub repo > **Settings** > **Secrets and variables** > **Actions** > **Variables** >
   **New repository variable**: name `VITE_AI_ENDPOINT`, value the Worker address followed by
   `/api/ai`, with no trailing slash:

   ```
   https://rotation-maxxing-ai.<your-subdomain>.workers.dev/api/ai
   ```

   The app asks `<VITE_AI_ENDPOINT>/health` and `<VITE_AI_ENDPOINT>/chat` (`aiEndpoint()` in
   `app/src/ai/runner.js`). The Pages build keeps Manami off only when this variable is blank.
2. **Actions** > "Deploy the app to GitHub Pages" > **Run workflow** (or push to `main`).
3. On the live site, open Ask Manami. She should answer instead of saying she's away.

## Settings (`wrangler.toml` `[vars]`)

| Name | Default | What it does |
| --- | --- | --- |
| `AI_MODEL` | `claude-sonnet-5-5` | The model |
| `EXTRA_ORIGINS` | blank | More allowed origins, comma separated (exact match) |
| `DAILY_REQUEST_LIMIT` | `500` | Soft cap on POSTs a day, per isolate |
| `AI_RATE_LIMIT_PER_MIN` | `10` | Per-IP POSTs a minute (not set in the file; add it to change) |
| `AI_ENABLED` | `true` | `false` turns Manami off without removing the key |

To switch it off fast: `npx wrangler@4 secret delete ANTHROPIC_API_KEY`, or set `AI_ENABLED = "false"`
and redeploy.

## Later: Supabase

This Worker is a stopgap. Once the Supabase AI function is in (see `supabase/README.md`, step 6),
it runs the same handler with sign-in, `VITE_AI_ENDPOINT` points there instead, and this Worker
can be deleted (`npx wrangler@4 delete` from this folder).

## Test

```sh
node --test proxy/ai/worker.test.mjs
```
