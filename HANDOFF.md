# Handoff — The Turf Ball

**Updated:** 16 August 2026 (session 3 — onboarding rebuilt as a 4-step wizard)
**Project:** `/Users/Efe/Projects/Web/theturfball`

---

## Start here

The Turf Ball is a football competition platform for grassroots Sunday-league groups. Organizers record goals and assists pitch-side on a phone; the app derives statistics, ranks players by configurable scoring rules, crowns a Player of the Month, and exposes a public link to drop in a WhatsApp group.

**The MVP is built, deployed and working, and the four features requested on top of it (account deletion, the fuller onboarding schedule, self-starting sessions, attendance-first live view) are now built and deployed too.** Everything passes automated checks (deno check, tsc, build) and the two new scheduled database jobs have been run directly against production and completed without error. **None of it has been driven by a real human yet** — see "What's verified vs unverified" below before telling the user something works end-to-end.

Read `SPEC.md` before any structural decision; it already answers most design questions. Read `rule2.txt` (referenced from `/Users/Efe/Projects/Mobile/finclar_ai/rule2.txt`, summarised below) before touching the backend.

---

## Where we are right now

**Database — live.** Seven migrations applied to Supabase project `dzrklwoenqexwfypmvxg`, confirmed with `supabase migration list`:
`20260816120000` (initial schema), `20260816121000` (engine), `20260816140000` (session slots), `20260816150000` (account deletion — `deleted_at` columns, `purge_deleted_accounts()`, daily pg_cron job), `20260816160000` (auto sessions — new `sessions` columns, `materialize_and_flag_sessions()`, 15-minute pg_cron job), `20260816161000` (fixes a SQL bug in the function from `20260816160000` — see "Setbacks" below), `20260816170000` (onboarding rebuild — adds `'pending'` to the `player_status` enum, creates the public-read `player-photos` Storage bucket).

**pg_cron is available on this project** — both new scheduled jobs use it directly. No Edge Function fallback was needed. Confirmed via `supabase db query --linked "select jobname, schedule from cron.job"` — both `purge-deleted-accounts` (`0 3 * * *`) and `materialize-and-flag-sessions` (`*/15 * * * *`) are registered.

**Backend — live.** All 12 Edge Functions deployed, including the changes for this round (`players`, `public`). All typecheck clean under Deno 2.9 (`deno check --quiet */index.ts`).

**Frontend — builds clean, running locally only.** Not yet deployed to any host. `app/.env.local` holds the project URL and anon key. `tsc -b --noEmit` and `npm run build` both clean after this round's changes.

**Manual dashboard config — done.** The user has confirmed email verification is working.

**Not a fresh repo:** this *is* a git repository. Nothing has been committed by the assistant; check `git status` before assuming a clean tree.

---

## What's verified vs unverified (session 3 — onboarding rebuild)

**Verified — ran directly against the live systems:**
- Migration `20260816170000` applied via `supabase db push`, confirmed present via `supabase migration list`.
- `player-photos` Storage bucket confirmed to exist via `supabase db query --linked "select id, public, file_size_limit from storage.buckets where id='player-photos'"` — `public: true`, 5MB limit.
- `players` and `public` Edge Functions: `deno check --quiet */index.ts` clean across all 12 functions, both redeployed.
- Frontend: `npx tsc -b --noEmit` and `npm run build` both clean with the new 4-step Onboarding.tsx and the new public JoinTeam.tsx page.
- Live curl smoke tests against the real project: `POST /public/<bogus-slug>/join` → 404 (doesn't leak whether a slug exists), `POST /players/:id/approve` and `POST /players/:id/reject` both → 401 without a token.

**NOT verified — compiles/deploys/curls correctly but has not been clicked through by a human:**
- The onboarding wizard itself, in a browser, end to end — creating a group, picking multiple days with different times, adding a player with a real photo upload, generating and opening the invite link on another device, approving a pending player, and landing on the review screen with a real "next session" countdown.
- Whether `minutesBetween()` (the kickoff/finish → `duration_minutes` calculation in `Onboarding.tsx`) matches what a real user expects for every combination of times entered — only reasoned through, not tested against a live save-and-reload.
- The self-serve `/play/:slug` flow's photo upload specifically — the upload code path is shared with the admin manual-add path in `players/handlers/create.ts` and `public/handlers/publicJoin.ts`, both going through the same `_shared/storage.ts` helper, but no photo has actually been uploaded through either yet.

## What's verified vs unverified (session 2)

**Verified — ran directly against the live systems:**
- Both new migrations applied via `supabase db push`, confirmed present via `supabase migration list`.
- `select public.purge_deleted_accounts();` and `select public.materialize_and_flag_sessions();` both run against the production database with no errors (via `supabase db query --linked`).
- pg_cron jobs registered and visible in `cron.job`.
- All 12 Edge Functions: `deno check --quiet */index.ts` clean. Changed functions redeployed.
- Frontend: `npx tsc -b --noEmit` and `npm run build` both clean.
- New endpoints reject unauthenticated requests with 401 (curl smoke test against the live project): `GET /auth/delete-account`, `POST /sessions/:id/approve`.

**NOT verified — compiles/deploys but has not been exercised by a human, or against real data:**
- The actual account-deletion flow end-to-end: preview → confirm → soft-delete → log back in → reactivation. No test account was deleted.
- What a real materialised session looks like once a group has active `session_slots` in the next 7 days — the live test ran against the existing data, which had none due at the time, so zero rows were created. The function is confirmed *not to error*, not confirmed to produce a session that then behaves correctly through attendance → live → flag → approve.
- The flagging logic's timing in practice (a session actually reaching its end time with no activity and getting flagged).
- The new onboarding schedule step, the Sessions screen countdown/flagged badges, and the MatchDay attendance-first flow — all pass `tsc`/`build` but have not been clicked through in a browser.
- Match-day recording and the public share page were already flagged unproven in the previous handoff and remain so.

---

## What works, and how I know

| Area | Status | How it was verified |
|---|---|---|
| Schema — 20 tables, RLS deny-all | Live | Applied locally to Postgres 16, then pushed; remote confirmed |
| Scoring engine — stats, ranking, tie-breakers | Live | **End-to-end run on local Postgres**: 3 players, 2 goals, 1 assist, 1 yellow, 1 clean sheet. Every point total matched the hand calculation. Voiding a goal correctly dropped 13 → 8 and corrected the scoreline. |
| Period close + awards | Live | Same local run: closed a month, got 6 awards with a frozen breakdown, next month opened automatically |
| Auth — register, login, verify, reset | Live | User has signed up and logged in successfully; email confirmed working |
| All 12 Edge Functions | Live | `deno check` clean; live curl against the real project for 401 / 404 / validation / CORS |
| Session slots (flexible schedule) | Live | Local test with 4 slots across 3 days incl. a morning/evening pair — correct chronological order in Africa/Lagos. Live curl confirmed all 4 routes resolve. |
| Frontend build + routing | Builds | `tsc -b` clean, `npm run build` succeeds, landing and register pages rendered in a browser with no console errors |
| Demo seed script | Works | Ran locally: 20 players, 4 played Sundays, tie-breakers resolving correctly |
| Match-day recorder UI | **Built, NOT user-tested** | Compiles and renders; nobody has yet recorded a real goal through it |
| Public share page | **Built, NOT user-tested** | Compiles; no real group has been viewed through it |

**Be honest about that last block.** The match-day flow and public page have never been exercised against live data by a human. Treat them as unproven.

---

## What was built this round (16 Aug, session 2)

All four items the user asked for, in their stated priority order. All deployed; see "What's verified vs unverified" above for the honest line between "passes checks" and "a human clicked it."

### 1. Delete my account, with a 30-day grace period — DONE

- Migration `20260816150000_account_deletion.sql`: `deleted_at timestamptz` on both `profiles` and `organizations`, `purge_deleted_accounts()` (deletes owned organizations then `auth.users`, which cascades to `profiles` via its FK — order matters because `organizations.owner_id` is `ON DELETE RESTRICT`), and a daily `pg_cron` job at 03:00 UTC.
- `supabase/functions/auth/handlers/deleteAccount.ts`: two-step. `GET /auth/delete-account` previews every group the caller owns (name, active player count, session count, other active members). `POST /auth/delete-account` with `{ confirm: true }` sets `deleted_at` on the profile and on every owned organization with the *same* timestamp (so reactivation only restores what was deleted in that batch, not something deleted independently later), then revokes all sessions via `ctx.db.auth.admin.signOut(user.id, 'global')` (best-effort).
- Reactivation lives in `supabase/functions/auth/handlers/me.ts` — the app calls `/auth/me` on every boot, so that's where a soft-deleted profile is noticed. Within 30 days: clears `deleted_at` on the profile and on organizations deleted at that same timestamp, then proceeds normally. **Past 30 days: throws 403 "This account has been deleted."** This was my call, not explicitly discussed with the user — flagged as an open decision below.
- Visibility during the grace window: `_shared/auth.ts`'s `requireMember()` now joins `organizations!inner(deleted_at)` and filters `is('organizations.deleted_at', null)` — this is the single choke point most handlers go through, so it covers almost everything. Also applied directly in `organizations/handlers/list.ts` (doesn't use `requireMember`) and `public/handlers/publicPage.ts`'s `loadPage()` (no auth at all, needed its own filter).
- Frontend: new **Account** tab in Settings (`app/src/features/settings/Settings.tsx`, `AccountSettings` component) — preview then a typed confirmation, danger-red styling, signs out and redirects home 3s after confirming. Route added at `/app/settings/account`. `AuthProvider.tsx` signs the Supabase session out if `/auth/me` returns 403, so a post-purge zombie session can't get stuck.

### 2. Onboarding sets up the full schedule — SUPERSEDED, see session 3 below

~~`app/src/features/onboarding/Onboarding.tsx` gained a new step (now 5 steps, not 4) between group details and squad: a repeatable weekday+time list, matching the pattern in `Settings → Schedule`. On continue, it `POST`s each slot to `organizations/:id/slots` (the same endpoint Schedule.tsx uses), swallowing 409s (duplicate day+time) rather than blocking setup. Group creation itself no longer sends `playing_days`/`default_kickoff`.~~

**This entire onboarding shape is obsolete as of session 3.** The user tested it and said it was insufficient: only one shared kickoff time (no finish time, so `duration_minutes` was always the 90-minute default even for a group that plays 2-hour sessions), and players could only be added by typing names — no photos, no self-serve. See "What was built this round (session 3)" below for the replacement. Do not resurrect this 5-step version.

### 3. Sessions start themselves — DONE

- Migration `20260816160000_auto_sessions.sql` (fixed by `20260816161000_fix_session_scheduler.sql` — see Setbacks) adds `is_auto_generated boolean`, `flagged_inactive_at timestamptz`, `approved_at timestamptz`, `approved_by uuid` to `sessions`, and `materialize_and_flag_sessions()`, scheduled via `pg_cron` every 15 minutes. The function, per org (skipping soft-deleted ones):
  1. Materialises sessions from `upcoming_slots(org, 30)` for anything up to 7 days out and not already scheduled.
  2. Flips `scheduled` → `live` once `kickoff_at <= now()`.
  3. Flags sessions `live` past their end time (`kickoff_at + slot.duration_minutes`, or 90 minutes with no slot) with zero present attendance and zero matches: sets `flagged_inactive_at = now()` and `status = 'completed'`.
- **The counted rule, applied everywhere:** a session counts unless `flagged_inactive_at IS NOT NULL AND approved_at IS NULL`. Applied via `.or('flagged_inactive_at.is.null,approved_at.not.is.null')` in `stats/handlers/dashboard.ts` (session count) and `public/handlers/publicPage.ts` (both the session list and the session count). Grepped for other `status = 'completed'` filters — the only other hits were in `matches/handlers/lifecycle.ts` and `sessions/handlers/attendance.ts`, which *set* status rather than filter by it for counting, so they didn't need the rule.
- New `POST /sessions/:id/approve` (admin-only, `supabase/functions/sessions/handlers/approve.ts`) sets `approved_at`/`approved_by`.
- Frontend: Sessions screen (`app/src/features/sessions/screens.tsx`) shows a "Next session" banner with a live countdown (ticks every 30s via `countdown()` in `app/src/lib/format.ts` — "2 hours remaining" under 24h, a date beyond that), flagged badges on session rows, and an "Approve anyway" button for admins on unapproved flagged sessions. `Session` type gained the new fields plus a `sessionCounted()` helper (`app/src/types/index.ts`) so the frontend rule matches the backend one.

### 4. Live session view with attendance inside it — DONE

`app/src/features/matchday/MatchDay.tsx` gained an `AttendanceStep` component (the old tick-list logic from `SessionDetailScreen`, moved wholesale) shown whenever the session is still `status: 'scheduled'`. Confirming it posts to `sessions/:id/attendance` then `sessions/:id/start`, which flips the session live and falls through to the existing team-picker/recorder — unchanged. `SessionDetailScreen` (`app/src/features/sessions/screens.tsx`) was simplified: it no longer ticks attendance or gates on `start`; it shows a read-only summary of who's marked present (once set) and matches played, with a single "Enter session" button that goes straight to `/live`.

### 5. Smaller items still on the board

- Three.js moments (rotating ball, trophy reveal) — deferred, never started.
- Rate limiting, and frontend deployment.

---

## What was built this round (16 Aug, session 3) — onboarding rebuilt

The user personally clicked through the previous (session 2) onboarding and said it wasn't enough. This is a full rebuild of `app/src/features/onboarding/Onboarding.tsx` into a 4-step wizard, not an incremental patch — logged as a deliberate setback in `dashboard/progress-data.js`, not a silent overwrite of the old "done" status.

**Step 1 — Team.** Unchanged: name, format, venue.

**Step 2 — Schedule.** Pick any number of weekdays, then either one shared kick-off + finish time for all of them, or a distinct kick-off + finish per day (this is the exact shape the user described: their own team plays Tue/Thu 6-8pm — two different days, one shared two-hour block). `minutesBetween(start, end)` in `Onboarding.tsx` converts the kick-off/finish pair into `duration_minutes` (clamped 15-480, wraps past midnight if finish < start) and posts each selected day to the existing `POST organizations/:id/slots` endpoint — **no backend change needed here**, `session_slots.duration_minutes` already existed and `createSlot` already accepted it directly.

**Step 3 — Players, two paths:**
1. **Manual add** (`PlayersStep` in `Onboarding.tsx`): admin fills in name, kit/nickname (`display_name`), preferred foot, and an optional photo file. The photo is read client-side as a base64 data URL (`fileToDataUrl`) and sent as `photo_base64` in the `POST players` body — no direct client-to-Storage write, per rule2.txt. `players/handlers/create.ts` now accepts `photo_base64` and, if present, calls `uploadPlayerPhoto()` (new `supabase/functions/_shared/storage.ts`) which decodes the base64, uploads through the **service-role** client to the new `player-photos` bucket, and returns the public URL.
2. **Self-serve invite**: the admin gets a copyable link `${origin}/play/:slug` (new page `app/src/features/onboarding/JoinTeam.tsx`, route `/play/:slug` in `router.tsx`, eager-loaded like the other public pages). Visiting it unauthenticated and submitting calls the one new write path in the `public` function: `POST /public/:slug/join` (`supabase/functions/public/handlers/publicJoin.ts`) — resolves the org by its own `slug` column (not the leaderboard's `public_pages.slug`/`is_published`, since inviting your squad and publishing your stats page are separate decisions), inserts a `players` row with `status = 'pending'` and `created_by = null`, uploads a photo the same way as the manual path. `player_status` gained `'pending'` via migration `20260816170000`.

   Admins see a live **pending-approval queue** in onboarding step 3 (polls `GET players?status=pending` every 15s) with Approve/Reject buttons calling the two new endpoints `POST players/:id/approve` (sets `status = 'active'`) and `POST players/:id/reject` (**deletes the row** — judgment call, documented in `players/handlers/approve.ts`: a rejected self-submission was never a real roster member, nothing else references it yet, so there's no history worth preserving, unlike `'inactive'` which is for someone who WAS active and stopped). `players/handlers/list.ts`'s default (no `?status=`) query now excludes both `'inactive'` and `'pending'`, so pending submissions never leak into the normal squad list or count toward squad size anywhere else in the app.

**Step 4 — Review.** Judgment call, since the user said they weren't sure what belonged here: a summary screen (`ReviewStep`) showing the next session's countdown (reads `GET organizations/:id/slots/upcoming`, limit 1 — deliberately NOT the materialized `sessions` table, so this preview doesn't depend on the 15-minute cron job having run yet, and doesn't touch the session-scheduling machinery the user asked to leave alone), squad size, and the leaderboard share link, then "Go to my dashboard."

**Storage.** New bucket `player-photos`, created by migration `20260816170000_onboarding_players.sql` (`insert into storage.buckets ...`), `public: true`, 5MB limit, `image/jpeg|png|webp` only. **Access control:** there are no Storage RLS policies for `anon` or `authenticated` at all — every upload goes through `_shared/storage.ts`'s `uploadPlayerPhoto()`, called only from inside `players/handlers/create.ts` (authenticated, admin-gated by `requireMember`) and `public/handlers/publicJoin.ts` (unauthenticated by design, but the only thing it can write is a `pending` player row — same shape as every other write in this project: client never touches the resource directly, an Edge Function using the service-role key does). The bucket is public-**read** so photo URLs work directly in `<img src>` without a signed-URL round trip, matching how `photo_url` already worked for every other player.

---

## Setbacks this round

- **The previous onboarding wasn't good enough, and the user found that out by using it.** Session 2's 5-step version (single shared kickoff time, names-only players) is now fully superseded by the session 3 rebuild above. This is the setback the user explicitly asked to have logged honestly in the dashboard rather than silently overwritten — see `dashboard/progress-data.js` phase 18 and its `currentlyDoing`/`log` entries.

- **SQL bug in `materialize_and_flag_sessions()`:** the first version of the flagging `UPDATE` referenced the update target table (`s`) from inside a `FROM`-clause `LEFT JOIN`'s `ON` condition — Postgres rejects this ("invalid reference to FROM-clause entry for table s"). Caught by actually running the function against the live database (`supabase db query --linked`) rather than assuming it worked because `db push` succeeded — `db push` only validates that the SQL parses and the DDL applies, not that a function body is semantically callable. Fixed in `20260816161000_fix_session_scheduler.sql` by replacing the join with a scalar subquery for the slot's duration. **Lesson for next time: always invoke a new Postgres function once against the live database after migrating, not just push the migration.**

---

## Open decisions needing the user

1. **Product name.** "The Turf Ball" is used throughout — assumed from the folder name, never confirmed.
2. ~~What happens to a group when its owner deletes their account?~~ **Answered 16 Aug: delete it, with a clear warning first.** Built this round.
3. ~~Auto-sessions: materialised or virtual?~~ **Answered 16 Aug: materialise in advance, flag the empty ones, allow manual approval.** Built this round.
4. ~~Does "activity" mean attendance marked, or a match played?~~ **Went with the recommendation: either counts** (attendance alone, or at least one match) — implemented in `materialize_and_flag_sessions()`. Not explicitly re-confirmed with the user, so worth a mention if it comes up.
5. **NEW, unconfirmed — login more than 30 days after account deletion.** HANDOFF didn't specify this precisely ("treat as if the account doesn't exist, or block login — decide sensibly, document your choice"). Decided: block with a 403 and a clear message, on the reasoning that the daily purge job should already have hard-deleted the account for real by then, so this is a safety net for the gap between "30 days elapsed" and "the next 3am purge run," not the normal path. Worth confirming the wording/behaviour is what the user wants.
6. **Player of the Month voting** — deliberately left out of V1 so the first month runs on statistics alone. Not yet revisited.
7. **Staging project.** Everything is being built directly against production `dzrklwoenqexwfypmvxg`. No staging exists.
8. **NEW — what belongs on onboarding's final step.** The user said explicitly they didn't know what should go there. Built: a review screen (next-session countdown, squad size, share link). Not confirmed with the user — flag it if it comes up.
9. **NEW — rejecting a self-added player deletes the row rather than marking it `inactive`.** My call, reasoned through in the session 3 section above. Worth confirming this is the behaviour the user wants, especially if they'd rather keep a record of who was rejected and why.
10. **KNOWN, EXPLICITLY DEFERRED — a session-machinery issue the user mentioned but hasn't described yet** ("there's something I saw an issue concerning the session issue but we'll come back to that"). Not investigated as part of this rebuild, on purpose — stayed scoped to onboarding/players/schedule. Raise it next time the user is ready to look at it; nothing in this session touched `materialize_and_flag_sessions()` or related session-lifecycle code.

---

## Traps and hard-won context

These were all hit for real. Do not undo them.

**Supabase's gateway rejects any request with no `Authorization` header — including public ones.** `app/src/services/client.ts` therefore sends the anon key as a baseline `Bearer` token on *every* request, replaced by the user's token when signed in. Remove that and the public share page and sign-up both 401 at the edge, before reaching any of our code.

**Registration must use the anon client's `signUp()`, never `admin.createUser()`.** `admin.createUser()` does not send Supabase's native confirmation email, and `rule2.txt` bans every third-party mail provider. Switching this "to use the admin API properly" silently breaks email verification.

**`deno lint`'s `no-import-prefix` rule is wrong for this project.** Rewriting `jsr:@supabase/supabase-js@2` to a bare specifier to satisfy it makes the Supabase bundler fail at deploy with "Relative import path not prefixed". The rule is disabled in `supabase/functions/deno.json`. Leave it disabled.

**`successResponse()` always sets `success: true`.** Never call it with a 4xx status — throw an `AppError` from `_shared/errors.ts` instead. This mistake has been made twice and fixed twice.

**Run `supabase` commands from the project root**, not from inside `supabase/`. Running from inside creates a nested `supabase/supabase/` and reports "Remote database is up to date" while doing nothing.

**Events are voided, never deleted.** `voided_at` is set and all aggregation excludes those rows. This exists so an argument about whether a goal counted can be settled from the record.

**Scoring rules are frozen into a period when it closes.** Editing weights in October must not rewrite August's winner. Period-scoped `scoring_rules` rows are the mechanism.

**After editing `dashboard/progress-data.js`, validate it parses.** A stray missing comma renders the whole dashboard blank:
`node -e "global.window={};require('./dashboard/progress-data.js');console.log('ok')"`

---

## The rules that govern this project

From `rule2.txt`, the user's portable Supabase standard, reused across all their projects:

1. No client ever touches a table. There is no `supabase.from()` anywhere in `app/`; the Supabase client is imported for **authentication only**.
2. One Edge Function per resource, not per operation. `index.ts` routes on method and path segments; logic lives in `handlers/`.
3. Identical response envelope everywhere: `{ success, message, data, meta, errors }`, produced only by `_shared/response.ts`.
4. Native Supabase email only.
5. Simple auth through the SDK; compound auth (signup) through an Edge Function.

**Two deliberate, documented deviations** (both explained in `README.md` — do not "fix" them):

- `supabase/functions/_shared/` instead of a `shared/` folder inside each function. Nine utilities across twelve functions would be 108 copies to keep in sync.
- Migrations ship via `supabase db push`, superseding `rule2.txt` §10. The user confirmed the CLI works; that rule was a workaround for a broken toolchain.

---

## Key files

```
SPEC.md                          Master specification — read before structural changes
README.md                        How to run and deploy, plus the deviations
HANDOFF.md                       This file
dashboard/index.html             Plain-English progress tracker (open from Finder)
dashboard/progress-data.js       Its data — update this as work completes
.claude/skills/handoff/SKILL.md  Regenerates this file via /handoff

supabase/migrations/             7 migrations: schema, engine, session slots, account deletion, auto sessions, auto-sessions fix, onboarding rebuild (pending status + player-photos bucket)
supabase/functions/_shared/      cors, response, auth, errors, validation, helpers, router, db, log, storage (NEW — player photo uploads)
supabase/functions/<resource>/   12 functions, each index.ts + handlers/
supabase/functions/auth/handlers/deleteAccount.ts    Account deletion preview + confirm
supabase/functions/sessions/handlers/approve.ts      Approve a flagged session
supabase/functions/players/handlers/approve.ts       NEW — approve/reject a pending self-added player
supabase/functions/public/handlers/publicJoin.ts     NEW — the one write path in `public`: self-serve player invite
supabase/seed_demo.sql           Optional demo group, 20 players, 4 played Sundays

app/src/services/client.ts       The ONLY door to the backend
app/src/features/matchday/       The match-day recorder — now opens with attendance first
app/src/features/settings/       Includes Schedule.tsx and the new Account tab (delete account)
app/src/features/onboarding/Onboarding.tsx   REBUILT session 3 — 4-step wizard (team, schedule, players, review). The 5-step version is obsolete, see above.
app/src/features/onboarding/JoinTeam.tsx     NEW — public unauthenticated page at /play/:slug for the self-serve player invite
app/src/lib/offlineQueue.ts      IndexedDB queue for pitch-side writes
```

The user's memory directory (path is in the system prompt, under `~/.claude/projects/-Users-Efe-Projects-Web-theturfball/memory/`) holds standing preferences — read `MEMORY.md` there first.

---

## How to run it

Always from the project root.

```bash
cd app && npm run dev
```

```bash
supabase db push
```

```bash
supabase functions deploy auth organizations members players sessions matches events stats scoring periods awards public
```

Verification commands worth running before claiming anything works:

```bash
supabase migration list
```

```bash
cd supabase/functions && deno check --quiet */index.ts
```

```bash
cd app && npx tsc -b --noEmit && npm run build
```

---

## Working style the user expects

- **Plain English first.** They said explicitly they don't want to be bothered with jargon. Lead with what a change means for the product; keep implementation detail behind the `?` toggle on the dashboard.
- **Keep the dashboard current.** It is their status channel — they read it instead of asking. Log setbacks there too, not just wins. Adding new requirements should visibly move the percentage.
- **Verify, don't assert.** They value being told what was actually tested versus what merely compiles.
