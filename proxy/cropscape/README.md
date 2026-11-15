# CropScape and NASS proxy (Cloudflare Worker)

Two USDA services the app can't call straight from a browser on GitHub Pages go through this one
Worker (`worker.js`):

- **CropScape** (`app/src/data/cdlHistory.js`, crop-history years) sends no CORS header. The Worker
  forwards **only** CDL point lookups (`GET /axis2/services/CDLService/GetCDLValue?year=&x=&y=`).
  Good answers are cached at Cloudflare's edge for a year, because a point's CDL value for a given
  year never changes.
- **NASS Quick Stats** (`app/src/data/nass.js`, local crops, yields and prices for the planner) needs
  an API key and sends no CORS header. The Worker forwards **only** `GET /nass/api_GET/?<filters>`
  to `https://quickstats.nass.usda.gov/api/api_GET/`, adding the key from the Worker secret
  `NASS_API_KEY`. Any `key` the browser sends is dropped, only Quick Stats filter parameters in
  `NASS_PARAMS` pass (anything else is a 403), and answers are always JSON. Good answers are cached
  for a day. Without the secret, `/nass/` answers 503 and the app's plans say NASS isn't set up.

Both add `Access-Control-Allow-Origin` for the app's own origins only (`ALLOWED_ORIGINS` in
`worker.js`). Any other path, method, or origin gets a 403, 404 or 405.

Cloudflare's free plan covers it: 100,000 requests a day. One field uses at most 3 points × 7 years
of CropScape; one farm's plans use 6 or 7 NASS requests (cached a day per county).

## Deploy (about 5 minutes)

**Option A: the dashboard, no install**
1. Sign in at https://dash.cloudflare.com, then go to **Workers & Pages** > **Create** > **Create Worker**.
2. Name it `cropscape-proxy`, then **Deploy**.
3. **Edit code**: replace the code with the contents of `worker.js`, then **Deploy**.
4. Copy the Worker's address, e.g. `https://cropscape-proxy.<your-subdomain>.workers.dev`.
5. **Settings** > **Variables and Secrets** > **Add** > type **Secret**, name `NASS_API_KEY`, value your
   Quick Stats key (free at https://quickstats.nass.usda.gov/api), then **Deploy**.

**Option B: the command line**
```sh
cd proxy/cropscape
npx wrangler@4 login
npx wrangler@4 deploy
npx wrangler@4 secret put NASS_API_KEY   # paste the key when asked; it never goes in a file
```

## Check it
```sh
curl -i -H "Origin: https://nila-fernando.github.io" \
  "https://cropscape-proxy.<your-subdomain>.workers.dev/axis2/services/CDLService/GetCDLValue?year=2025&x=264000.0&y=2088000.0"
```
You should get `200`, `Access-Control-Allow-Origin: https://nila-fernando.github.io`, and a body
with `category: "Soybeans"`. Run it again and you should see `X-Proxy-Cache: HIT`.

And NASS (the key is added by the Worker; the URL has none):
```sh
curl -i -H "Origin: https://nila-fernando.github.io" \
  "https://cropscape-proxy.<your-subdomain>.workers.dev/nass/api_GET/?short_desc=CORN%2C+GRAIN+-+PRICE+RECEIVED%2C+MEASURED+IN+%24+%2F+BU&reference_period_desc=MARKETING+YEAR&agg_level_desc=STATE&state_alpha=KS&year__GE=2024"
```
You should get `200` and `{"data":[...]}` with Kansas corn prices. A `503 NASS key not configured`
means the secret isn't set.

## Turn it on for the live site
1. GitHub repo > **Settings** > **Secrets and variables** > **Actions** > **Variables** >
   **New repository variable**: name `VITE_CDL_PROXY`, value the Worker address **with no trailing slash**.
   Add a second one: name `VITE_NASS_PROXY`, value the Worker address followed by `/nass`
   (e.g. `https://cropscape-proxy.<your-subdomain>.workers.dev/nass`). Never put the key itself in
   a repository variable: `VITE_` values are built into the public site.
2. **Actions** > "Deploy the app to GitHub Pages" > **Run workflow** (or push to `main`).
3. On the live site, pick a field outside Story County. Its check-up should show 8 years, with a
   `CDL` chip next to `CSB`. "Plan my next seasons" should list the county's crops and the NASS
   prices under "Good to know".

## Other origins
To use the proxy from another domain, add the origin to `ALLOWED_ORIGINS` in `worker.js`, or set
`EXTRA_ORIGINS` in `wrangler.toml` (comma separated) and redeploy.

## Test
```sh
node --test proxy/cropscape/worker.test.mjs
```
