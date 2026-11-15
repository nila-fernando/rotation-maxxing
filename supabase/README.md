# Supabase setup for Rotation-Maxxing

This sets up sign-in and a database, so farmers keep their farm, fields, plans and jar tests between visits. It also prepares a safe home for the AI (Ask Manami): the Claude API key lives in Supabase, never in the website. It takes about 45 minutes.

**You need:**
- a Supabase account (free plan is fine to start);
- admin on the GitHub repo **nila-fernando/rotation-maxxing**;
- the Supabase CLI for step 6. Use `npx supabase@latest`; nothing else to install.

**Don't paste secret values in chat.** That means the Supabase **secret / service_role** key, the **database password**, and the **Anthropic API key**. Those go only into Supabase's own settings screens.

---

## 1. Create the project

1. Go to https://supabase.com/dashboard, then **New project**.
2. Set it up:
   - **Name:** `rotation-maxxing`
   - **Database password:** generate a strong one and store it in your password manager.
   - **Region:** `East US (North Virginia)`. Most users are US farmers.
3. Wait until the project is ready (about 2 minutes).
4. In **Project Settings → API**, note two values:
   - the **Project URL**, e.g. `https://abcdefgh.supabase.co`;
   - the **publishable key**. It's called the `anon` / `public` key on older projects. It's safe to put in the website.

   The **secret key** (`service_role`) is NOT for the website. Leave it there.

## 2. Create the tables and the security rules

1. **SQL Editor → New query.**
2. Paste the whole of `supabase/migrations/20261115000000_init.sql` from the repo and click **Run**.
3. It creates these tables. Each one has **Row Level Security turned on**, so a signed-in farmer can only ever read or change their own rows.

| Table | What it holds |
|---|---|
| `profiles` | One row per person, made automatically when they sign up: check-in answers, AI consent, settings. |
| `farms` | A farmer's farm(s): name, location. |
| `fields` | Each field's outline (GeoJSON), name, acres, crop history, irrigated or not. |
| `field_data` | A cache of the real data fetched per field: USDA soil, slope, NASA rain, greenness, CropScape. |
| `jar_tests` | Soil jar test results: texture, sand/silt/clay, layer colours. **Photos are not stored**; the app promises they stay on the device. |
| `plans` | Saved plans for the next 3 seasons. One "current" plan per farm. |
| `ai_conversations`, `ai_messages` | Ask Manami chat history. |
| `ai_usage` | Claude tokens used per person. Only the AI function writes it; it's used for daily limits. |

4. **Check it worked:** open **Table Editor**. Each table should show "RLS enabled". Then go to **Authentication → Policies** and check each table has its policy.

## 3. Turn on sign-in (Authentication)

**Authentication → Sign In / Providers:**
- **Email: ON.**
  - Turn **"Confirm email"** ON.
  - Farmers sign in with a **magic link**: no password to forget. Passwords stay available too.
- **Google: optional, ON if you can.**
  1. In Google Cloud Console, create an OAuth client (type "Web application").
  2. Add Supabase's callback URL, shown on the Google provider screen, as an authorised redirect URI.
  3. Paste the client ID and secret into Supabase.
- **Leave the rest off.**

**Authentication → URL Configuration:**
- **Site URL:** `https://nila-fernando.github.io/rotation-maxxing/`
- **Redirect URLs** (add each one):
  - `https://nila-fernando.github.io/rotation-maxxing/**`
  - `http://localhost:5173/**` (local development)
  - `http://localhost:4173/**` (`npm run preview`)

**Authentication → Emails (important):**
- Supabase's built-in email sender only allows a few emails an hour. That's fine for testing, but it will block real farmers signing in.
- **Set up custom SMTP** before inviting anyone: **Authentication → Emails → SMTP Settings.**
  - Use any provider, e.g. Resend, SendGrid or Postmark.
  - Use a sender like `hello@<your-domain>`.
- Optionally, make the **Magic link** and **Confirm signup** templates friendly. Plain words, e.g. "Here's your link to Rotation-Maxxing. It works once and for the next hour."

**Authentication → Rate Limits:** leave the defaults.

**Authentication → Attack Protection:** turn on **CAPTCHA (Turnstile)** later, if sign-up spam shows up.

## 4. Storage (optional; skip for now)

Not needed yet. Jar photos stay on the farmer's device. If we ever store them:
- make a **private** bucket `jar-photos`;
- add a policy that a user can only read and write files under the folder named after their user id.

## 5. Put the website's settings into GitHub

These are **variables, not secrets**: the browser sees them anyway, and that's safe.

1. In the repo, go to **Settings → Secrets and variables → Actions → Variables**.
2. Add:
   - `VITE_SUPABASE_URL` = the Project URL from step 1
   - `VITE_SUPABASE_ANON_KEY` = the publishable / anon key from step 1
3. Leave `VITE_AI_ENDPOINT` for now. It's added in step 6, once the AI function exists.
4. `VITE_CDL_PROXY` is already set (the CropScape proxy).

The deploy workflow passes these to the build.

## 6. The AI function (with the developers, after the code lands)

The Ask Manami server code runs locally today (`app/server/ai`, behind `npm run dev`). It moves into a Supabase **Edge Function** called `ai`, so the live site can use AI. The developers will add the function code in `supabase/functions/ai/`. Your part is the secrets and the deploy:

```sh
# from the repo root, once
npx supabase@latest login
npx supabase@latest link --project-ref <your-project-ref>     # the 'abcdefgh' part of the URL

# the Claude key and settings live ONLY here (never in GitHub, never in the website)
npx supabase@latest secrets set ANTHROPIC_API_KEY=<the key> AI_MODEL=claude-sonnet-5-5 AI_DAILY_TOKEN_LIMIT=200000

# deploy (when supabase/functions/ai exists in the repo)
npx supabase@latest functions deploy ai
```

**How the function behaves:**
- **Only signed-in users can call it.** It checks the user's sign-in token (JWT) and refuses anyone else.
- **It only answers the app's own sites:** `https://nila-fernando.github.io` and `http://localhost:5173`. That's its CORS allow-list.
- **Daily limits.** It writes each request's token use to `ai_usage` with the service role, and refuses a person once they pass `AI_DAILY_TOKEN_LIMIT` for the day.

Then add the GitHub variable `VITE_AI_ENDPOINT` = `https://<project-ref>.supabase.co/functions/v1/ai`, and re-run the deploy workflow (**Actions → Deploy the app to GitHub Pages → Run workflow**).

## 7. Send back to the team (safe to share)

- The Project URL
- The publishable / anon key (it's public by design)
- Which sign-in providers are on (email magic link, Google?)
- Whether custom SMTP is set up
- That the SQL ran, with RLS on for every table

**Never send** the secret / service_role key, the database password or the Anthropic key. Those stay in Supabase.

## Checklist

- [ ] Project created (East US), URL and publishable key noted
- [ ] `20261115000000_init.sql` ran with no errors; RLS on for all 9 tables
- [ ] Email sign-in (magic link) on, "Confirm email" on
- [ ] Google sign-in on (optional)
- [ ] Site URL and the 3 redirect URLs set
- [ ] Custom SMTP set up (before real farmers sign in)
- [ ] GitHub variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` added
- [ ] (later) `ANTHROPIC_API_KEY` set as a Supabase secret, `ai` function deployed, `VITE_AI_ENDPOINT` added
