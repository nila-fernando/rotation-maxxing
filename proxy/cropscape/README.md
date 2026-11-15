# CropScape proxy (Cloudflare Worker)

The app fills in crop-history years from USDA CropScape (`app/src/data/cdlHistory.js`). CropScape
sends no CORS header, so a browser on GitHub Pages can't call it directly. This Worker forwards
**only** CDL point lookups (`GET /axis2/services/CDLService/GetCDLValue?year=&x=&y=`) and adds
`Access-Control-Allow-Origin` for the app's own origins (`ALLOWED_ORIGINS` in `worker.js`). Any other
path, method, or origin gets a 403, 404 or 405. Good answers are cached at Cloudflare's edge for a
year, because a point's CDL value for a given year never changes.

Cloudflare's free plan covers it: 100,000 requests a day. One field uses at most 3 points × 7 years.

## Deploy (about 5 minutes)

**Option A: the dashboard, no install**
1. Sign in at https://dash.cloudflare.com, then go to **Workers & Pages** > **Create** > **Create Worker**.
2. Name it `cropscape-proxy`, then **Deploy**.
3. **Edit code**: replace the code with the contents of `worker.js`, then **Deploy**.
4. Copy the Worker's address, e.g. `https://cropscape-proxy.<your-subdomain>.workers.dev`.

**Option B: the command line**
```sh
cd proxy/cropscape
npx wrangler@4 login
npx wrangler@4 deploy
```

## Check it
```sh
curl -i -H "Origin: https://nila-fernando.github.io" \
  "https://cropscape-proxy.<your-subdomain>.workers.dev/axis2/services/CDLService/GetCDLValue?year=2025&x=264000.0&y=2088000.0"
```
You should get `200`, `Access-Control-Allow-Origin: https://nila-fernando.github.io`, and a body
with `category: "Soybeans"`. Run it again and you should see `X-Proxy-Cache: HIT`.

## Turn it on for the live site
1. GitHub repo > **Settings** > **Secrets and variables** > **Actions** > **Variables** >
   **New repository variable**: name `VITE_CDL_PROXY`, value the Worker address **with no trailing slash**.
2. **Actions** > "Deploy the app to GitHub Pages" > **Run workflow** (or push to `main`).
3. On the live site, pick a field outside Story County. Its check-up should show 8 years, with a
   `CDL` chip next to `CSB`.

## Other origins
To use the proxy from another domain, add the origin to `ALLOWED_ORIGINS` in `worker.js`, or set
`EXTRA_ORIGINS` in `wrangler.toml` (comma separated) and redeploy.

## Test
```sh
node --test proxy/cropscape/worker.test.mjs
```
