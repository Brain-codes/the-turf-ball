# The Turf Ball

Goals, assists and Player of the Month for grassroots football groups. Record events pitch-side on a phone, and the league table, awards and public share page work themselves out.

- **`SPEC.md`** — the full product and technical specification. Read this before changing anything structural.
- **`dashboard/index.html`** — plain-English build progress tracker. Open it straight from Finder.

---

## What's here

```
app/                  React + Vite frontend
supabase/
  migrations/         Database schema and engine (apply with the CLI)
  functions/          12 resource-based Edge Functions
  seed_demo.sql       Optional demo group, fully populated
dashboard/            Build progress tracker (no build step)
SPEC.md               Master specification
```

---

## Running it — the short version

You need three things done in order: database, backend, frontend.

### 1. Database

```bash
supabase link --project-ref dzrklwoenqexwfypmvxg
```

```bash
supabase db push
```

That applies two migrations: the schema (19 tables) and the engine (statistics, scoring, period close). Both have been verified against Postgres 16 locally, including a full end-to-end run of a session through to a closed month with awards.

### 2. Turn on email confirmation

In the Supabase dashboard: **Authentication → Providers → Email → Confirm email: ON**.

Set the site URL under **Authentication → URL Configuration** to wherever the app runs (`http://localhost:5173` for now).

This uses Supabase's built-in verification email. No third-party mail provider is involved anywhere, per `rule2.txt` §14.

### 3. Backend

Give the functions the site URL so confirmation emails link back correctly:

```bash
supabase secrets set SITE_URL=http://localhost:5173
```

Then deploy all twelve:

```bash
supabase functions deploy auth organizations members players sessions matches events stats scoring periods awards public
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically — you don't set those.

### 4. Frontend

```bash
cd app && npm install && npm run dev
```

`app/.env.local` already has the project URL and anon key. The anon key is publishable by design; the **service role key must never appear here**.

---

## Trying it out

1. Open the app, create an account, confirm your email.
2. Onboarding walks you through: name your group, paste in your squad one name per line, pick how points work.
3. Create a session, tick off who turned up, split into two sides, kick off.
4. Record goals — three taps each.
5. Full time, then end the session.
6. Open **Table** to see the rankings, **Awards** to close the month.
7. **Settings → Share page** gives you the WhatsApp link.

### Want it pre-populated?

After signing up, grab your user id from the Supabase dashboard (Authentication → Users) and run:

```bash
psql "$DATABASE_URL" -v owner_id="your-user-uuid" -f supabase/seed_demo.sql
```

That creates a second group, *Demo Sunday Ballers*, with 20 players and four fully played Sundays. Remove it any time with `delete from public.organizations where slug = 'demo-sunday-ballers';`.

---

## Architecture rules this project follows

From `rule2.txt`, non-negotiable:

- **No client ever touches a table.** There is no `supabase.from()` call anywhere in `app/`. The Supabase client is imported for authentication only.
- **One Edge Function per resource**, not per operation. `index.ts` routes on method and path; all logic lives in `handlers/`.
- **One response shape**, everywhere: `{ success, message, data, meta, errors }`, produced only by `_shared/response.ts`.
- **Native Supabase email** only.
- **Simple auth through the SDK, compound auth through a function.** Login and password reset go direct; signup goes through `/auth/register` because it creates a profile and attaches pending invites in the same breath.

Two deliberate deviations, both flagged:

1. **`supabase/functions/_shared/` instead of a `shared/` folder inside each function.** The rule asks for shared utilities in a shared folder; copying nine utility files into twelve functions would mean 108 copies to keep in sync. Supabase's own convention is a leading-underscore folder, which the CLI bundles on deploy. Same intent, one copy.
2. **Migrations via `supabase db push`.** `rule2.txt` §10 says paste SQL into the web editor because CLI pushes used to fail. You've confirmed the CLI works now, so the migrations are real versioned files.

---

## Deploying the frontend

Any static host. On Vercel or Netlify:

- Build command: `npm run build`
- Output: `dist`
- Root directory: `app`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_FUNCTIONS_URL`

It's a single-page app, so configure a rewrite of all paths to `/index.html` — otherwise share links like `/t/your-group` will 404 on refresh.

After deploying, update `SITE_URL` and the Supabase site URL to the live domain.

---

## The one thing to understand about the data

`match_events` is the only source of truth. Every number the product displays — goals, assists, points, rankings, awards — is derived from it.

Nothing is ever authored: there is no endpoint that sets a player's goal count, and no way to type in a total. Events are voided rather than deleted, so undoing a goal preserves the audit trail. Closing a month freezes that month's scoring rules, so changing your weights in October cannot rewrite August's winner.

The practical consequence: adding "Best Defender" or "Most Improved" later means adding an event type or a scoring rule. It never means redesigning the database.
