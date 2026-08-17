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
11. **NEW, BACKLOG — configurable "live session" behaviour.** When deciding to make a session one continuous match (session 6, 17 Aug), the user explicitly said finer-grained settings around this ("live settings to decide a lot of things") should come later, not now. Nothing scoped yet — raise it next time live-session behaviour comes up rather than assuming the current unconditional "always one match per session" is final.

10. **KNOWN, EXPLICITLY DEFERRED — a session-machinery issue the user mentioned but hasn't described yet** ("there's something I saw an issue concerning the session issue but we'll come back to that"). Not investigated as part of this rebuild, on purpose — stayed scoped to onboarding/players/schedule. Raise it next time the user is ready to look at it; nothing in this session touched `materialize_and_flag_sessions()` or related session-lifecycle code.

---

## Session 4 (17 Aug 2026) — live match-day "Add player" fixes

The user personally tested the live match-day view (`/app/sessions/:id/live`) and reported two bugs:

1. In the "Someone just arrived" sheet, tapping a squad member in the search results appeared to do nothing.
2. Adding a brand-new name via "Not in the squad list yet" gave no visible confirmation the player was actually added, and there was no way to see the current player list from the live view to check.

**Root cause for both:** `addLatecomer()` in `app/src/features/matchday/MatchDay.tsx` had a `try { ... } finally { ...close the sheet... }` with no `catch` — any failure (network, validation, a rejected write) closed the sheet silently with no error shown, indistinguishable from "nothing happened." On success it also just closed the sheet with no confirmation, so even a working add looked like a no-op unless you separately went looking for the new player.

**Fixed, not yet clicked through by the user (their choice — they're testing this round themselves):**
- `addLatecomer()` now has a real `catch`: shows the actual error message inline in the sheet (`addingLateError` state) instead of swallowing it. `createAndAddLatecomer()` does the same.
- On success, shows a brief "`<name>` added to the pitch" confirmation banner at the top of the live screen (`addedFeedback` state, auto-clears after 2.5s).
- New **Squad** button next to "+ Add player" in the live view's top bar, opening a full-screen bottom sheet listing everyone: "On the pitch" (current roster, sorted alphabetically) and "Not present" (everyone else in the org not yet on this match's roster), each with a one-tap "+ Add" that calls the same `addLatecomer()` path. A "+ Add player not in squad" button at the bottom routes into the existing add-new-player sheet.
- `allOrgPlayers` query's `enabled` condition widened from `addingLate` to `addingLate || viewingSquad` so the Squad sheet has data to show without needing the other sheet open first.

**Verified:** `npx tsc -b --noEmit` clean. **NOT verified:** not exercised in a browser — the user asked to test this themselves this round rather than have it driven for them.

**Follow-up, found by the user's own testing:** the "tap does nothing" bug had a second, more direct cause — `addLatecomer()` was calling `api.post('matches/:id/roster', ...)` but `supabase/functions/matches/index.ts` only registers `:id/roster` under **PATCH**, so every add-latecomer call was hitting a real `404 Endpoint not found` (confirmed by the user via their browser's network tab). The error-handling fix above is what made this 404 visible instead of silently swallowed — that part of the diagnosis held up. Fixed by changing the frontend call to `api.patch(...)` (`app/src/features/matchday/MatchDay.tsx:654`) to match the existing backend route rather than adding a POST route — PATCH is the more correct verb for "replace the roster" anyway, and it was the only call site. `tsc -b --noEmit` clean. **Still not verified in a browser** — this exact call path (add-latecomer → roster PATCH) has not been re-tested end-to-end since the fix; worth confirming first thing next test pass.

---

## Session 5 (17 Aug 2026) — appearances per session, and dropping the red/blue team framing

Two more things the user raised from using the app, not asked to be tested live by me this round either — fixed and deployed, verification below is honest about what actually ran.

### 1. An appearance is now once per SESSION, not once per match

**The bug:** `recompute_period_stats()` (the single SQL function that computes every stat) counted `count(distinct mp.match_id)` for appearances. If a session went to full time and a new match was started afterward (same day, same players — e.g. re-starting after a break), that created a second `matches` row with its own `match_players` roster, so a player who never left the pitch got 2 appearances for one day.

**The fix:** new migration `supabase/migrations/20260817120000_appearance_per_session.sql` — a `create or replace function public.recompute_period_stats` that is byte-for-byte identical to the original in `20260816121000_engine.sql` except the `apps` CTE now does `count(distinct mt.session_id)` instead of `count(distinct mp.match_id)`. Nothing else about scoring changed — goals/assists/cards/punctuality/votes are all still read straight from `match_events`/`session_attendance`, independent of this.

**Verified:** applied via `supabase db push` (confirmed present in `supabase migration list`). The user ran `supabase db query --linked "select public.recompute_period_stats(id) from periods where status='open'"` directly — all 3 open periods recomputed with no error (6, 14, 17 player rows updated respectively). **Still not spot-checked:** nobody has confirmed a player who was in two matches within one session now shows `appearances = 1` instead of 2 — the function runs clean, but that specific before/after hasn't been eyeballed against real data yet.

### 2. Dropped the "red team / blue team" framing

**What it was:** the product has no team-vs-team play — everyone present goes on `side_a`, `side_b` stays empty (this was already true, per an existing code comment in `MatchDay.tsx`) — but the schema's two-sides shape (`match_side` enum, `side_a`/`side_b` columns) was still surfacing as literal "Blue"/"Red" text: `matches/handlers/create.ts` defaulted `side_a_label`/`side_b_label` to `'Blue'`/`'Red'`, shown as "Blue v Red" in the session detail screen and "Full time: Blue 3 - 2 Red" in the finish-match toast.

**What changed (schema untouched — this was a naming/display fix, not a data-model rewrite):**
- `matches/handlers/create.ts`: default labels changed from `'Blue'`/`'Red'` to `'Squad'`/`'Opposition'` — no longer color-coded, and `side_b` reads honestly as "own goals against" (own-goal events are the only thing that ever lands on `side_b_score` — see `refresh_match_score` in `engine.sql`) rather than an actual second team.
- `matches/handlers/lifecycle.ts` (`finishMatch`): toast changed from `"Full time: Blue 3 - 2 Red"` to `"Full time: 3 scored"`, or `"Full time: 3 scored, 1 own goal"` only when there were any.
- `app/src/features/sessions/screens.tsx`: session detail's match list no longer shows `"{label} v {label}"` — just `"Match #N"` and the goals-scored count, with an own-goals note only when non-zero.
- `app/src/features/stats/Dashboard.tsx` and `app/src/features/public/PublicPage.tsx`: the small score chips per match changed from `"3–1"` (reads as a scoreline between two teams) to `"3 goals"`.
- Deliberately **left alone**: the `match_side` enum, `match_players.side` (not-null), `match_events.side`, and the `side_a`/`side_b` request shape in `createMatch`/`updateRoster`/`events/handlers/record.ts`. Removing those would touch the clean-sheet-by-side logic in `finishMatch` and the own-goal scoring in `refresh_match_score`, both of which still work correctly as-is (own goals need *some* side to land on, and the whole "goals against" chip depends on it) — reframing the labels was enough to make the two-team language disappear from everything the user actually sees.

**Verified:** `npx tsc -b --noEmit` and `deno check --quiet */index.ts` both clean. `matches` function redeployed (`supabase functions deploy matches`). **NOT verified:** not clicked through in a browser — a new match hasn't been created/finished since this deploy to confirm the new toast wording and the session-detail card render correctly.

---

## Session 6 (17 Aug 2026) — a session is now one continuous match, not several

Follow-on from the appearance fix above. The user pointed out that even with appearances now counted once per session, the *live view itself* still reset to zero every time you hit "full time" and started again — the clock, the running goal/card totals, all of it — because each restart created a brand-new `matches` row with its own event list. Asked directly: "bring everything under one activity." Given the explicit choice between (a) keep multiple match rows but sum their totals for display, or (b) never create a second match row at all, the user picked **(b)** — no match-splitting, one continuous match per session — and asked to put finer-grained "live settings" flexibility in the backlog rather than build it now.

**What changed:**
- New `POST matches/:id/resume` (`supabase/functions/matches/handlers/lifecycle.ts`, `resumeMatch`): sets the match back to `status: 'live'`, clears `ended_at`, and deletes any `clean_sheet` events that were awarded at the earlier finish (they were only ever provisional against that moment's score — same reasoning `finishMatch` already uses when called twice). Registered in `matches/index.ts` under `POST ':id/resume'`.
- `app/src/features/matchday/MatchDay.tsx`: the branch that used to appear after a match finished — an `AttendanceStep` that silently created a second `matches` row via `POST matches` + `POST matches/:id/start` — is replaced by a new `MatchPausedStep` component. It's a simple two-button screen: **Resume** (calls the new `POST matches/:id/resume` on the *same* match, then re-renders `LiveMatch` for it) or **End session** (unchanged — closes the day out for good). Because `LiveMatch` is keyed by `match.id` and that id no longer changes across a pause/resume, the clock (`elapsed`, computed from `match.started_at`) and the `match-events` query both continue exactly where they left off — nothing to reset.
- The very first "who's here?" attendance step (session still `status: 'scheduled'`) is untouched — it still creates the session's one and only match, same as before. `AttendanceStep`'s old "offer to start match N+1" role is gone; a defensive fallback keeps the old create-a-match code path only for the edge case of a live session with literally zero matches (shouldn't happen going forward, kept for old data).
- **Deliberately not touched, per the user's own request to backlog it:** any settings UI for choosing *whether* a session should split into multiple matches, half-time handling, or anything configurable about this. Right now it's unconditionally "one match per session" for every organization.

**Data model note:** `matches`/`match_players`/`match_events` schema is untouched — a session *can* still technically end up with more than one `matches` row (e.g. any left over from before this change), and `activeMatch` / `MatchPausedStep` always operate on `session.matches[session.matches.length - 1]` (the most recent one), so old multi-match sessions won't break, they just won't gain more matches going forward.

**Verified:** `npx tsc -b --noEmit` and `deno check --quiet */index.ts` both clean. `matches` function redeployed. **NOT verified:** not clicked through in a browser — nobody has actually finished a match, hit Resume, and confirmed the clock/goal totals kept counting instead of resetting.

**Data fix for the two sessions that already existed in this split state:** the user had two live sessions from earlier testing (`74a84787-b290-458f-b108-3fb9368742c4` and `ebdab7ba-555e-4f8e-af3f-076e265df018`), each already split into 3 matches (2 completed, 1 live) from before this session's fix. Ran a one-off `DO $$ ... $$` block directly against production (not a migration file — data cleanup, not a schema change) that, per session: picked the earliest match (by `sequence`) as the survivor, reassigned every `match_events` row from the other two matches onto it, copied over any `match_players` roster rows not already present (`on conflict do nothing`), deleted the now-empty duplicate `matches` rows, deleted stale `clean_sheet` events, set the survivor back to `status: 'live'`/`ended_at: null`, called `refresh_match_score()` and `recompute_period_stats()`. **Verified for real, not just "ran without error":** confirmed afterward that both sessions now have exactly 1 match each (was 3), with all 11 goals from the day combined onto it, and every player who appeared now shows `appearances = 1` with their full day's goal count — checked directly via `supabase db query --linked`. No other sessions in the database were in this split state, so no further cleanup needed.

---

## Session 7 (17 Aug 2026) — WhatsApp nickname shown next to every player name

The user pointed out that a lot of people at the pitch know each other by their WhatsApp name, not whatever's on the roster (`display_name`) — so wherever the app shows a player's name, it should also show their WhatsApp nickname, small and faint, as an identification hint rather than a second name competing for attention.

**The `whatsapp_nickname` column already existed** (migration `20260816180000_whatsapp_nickname.sql`, from an earlier round) and every add/edit player form already captured it — it just wasn't shown anywhere. This round wired it through to display.

**New shared component:** `PlayerName` in `app/src/components/ui/index.tsx`, right next to `PlayerAvatar`. Renders the display name, and — only if a WhatsApp nickname exists and differs from the display name (skips the redundant case where someone set both to the same thing) — a small `(nickname)` in `text-[11px]` at `chalk-faint/70` opacity, deliberately unobtrusive.

**Backend:** every handler that joins a `players` row for display now selects `whatsapp_nickname` alongside `display_name` — `periods`, `matches` (both `get` selects), `sessions` (`get` and `attendance`), `stats` (`dashboard` and `leaderboard`), `awards`, `events` (the created-event echo), and `public` (`publicPage.ts`'s `projectPlayer()` plus its raw selects). The public share page **does** expose it — deliberate, not an oversight: that page's whole audience is the same WhatsApp group the nickname refers to, so it's exactly the right context, not a leak. `players` list/get endpoints already selected `*`, so they had it all along.

**Frontend:** `PlayerName` (or, in the handful of places using a big centered `<h1>` header where inline didn't fit the layout — player detail pages, hero/winner cards — a small line placed directly underneath instead) was applied everywhere a player's name renders: the squad list and player detail page, match-day's attendance list/roster grid/goal-scorer grid/stat board/activity feed/squad sheet/add-player sheet, the session detail attendance list, the internal leaderboard and dashboard, the awards screen (provisional leader, other awards, past winners, close-period preview), and the entire public share page (hero card, leaderboard, awards, top-performer cards, individual player page). Every nested TypeScript type that carries a player join (`MatchEvent.players`, `PublicPlayerRef`) got the field added so this typechecks end to end.

**Verified:** `npx tsc -b --noEmit` and `deno check --quiet */index.ts` both clean. Confirmed real data exists and behaves correctly — queried the live database directly and found real players with `whatsapp_nickname` set (e.g. "Mazz" → "Ashxr"), including one player where it exactly matches `display_name` (correctly won't render, avoiding the redundant case). `periods`, `matches`, `sessions`, `public`, `awards`, `stats`, `events` functions all redeployed. **NOT verified:** not clicked through in a browser — nobody has looked at any of these screens since the deploy to confirm the nickname actually renders in the right place, at the right size, without breaking any layout (especially the tight goal-scorer grid in match-day, where a second line of text was added under each player's name).

---

## Session 8 (17 Aug 2026) — post-session editing, no more force-closed live sessions, punctuality from real kick-off, session timeline

Four related asks about the live-session flow, given in one message and explicitly built in the order requested (asked directly, not my call — see the question I put to the user before starting). All four ship in migration `20260817130000_edit_window_and_session_timing.sql`, deployed and confirmed present in the live schema (`actual_kickoff_at`, `ended_at`, `scheduled_end_at`, `last_activity_at`, `last_viewed_at`, `awaiting_confirmation` on `sessions`; `edited_at`/`edited_by` on `match_events`; new `match_event_edits` table). `sessions` and `events` functions redeployed.

### 1. Post-session edit window (5 hours) with an audit trail

New shared rule in `_shared/helpers.ts`: `editWindowOpen(matchStatus, sessionEndedAt)` — true while a match is still `live`/`pending` (normal in-play recording, unrestricted, unchanged), OR the match's session ended ≤ `EDIT_WINDOW_HOURS` (5) ago. False otherwise — the session is locked for good.

- `events/handlers/record.ts`: `recordEvent` no longer hard-blocks writes to a `completed` match — it now checks `editWindowOpen()` instead (still blocks `abandoned` matches outright). This is what lets "I forgot to record a goal" get fixed after full time, not just during play.
- `voidEvent` (undo/delete) gained the same check — previously unrestricted beyond the period being open; now also locked out past the 5-hour window.
- New `PATCH events/:id` (`updateEvent`, new handler + route): corrects an existing event's scorer (`player_id`), assister (`related_player_id`), or minute. Every change writes a row to the new `match_event_edits` table (`event_id`, `edited_by`, `edited_at`, `changes` as `{field: {from, to}}` jsonb) — a real audit trail, separate from voiding's existing `voided_at`/`voided_by`. The event row itself also gets `edited_at`/`edited_by` stamped, so a corrected record is visibly different at a glance from one nobody touched (`(edited)` tag in the UI, `created_at` vs `edited_at` tells the "was this the real live record or a later correction" story the user asked for — deliberately not framed as fraud detection, just transparency).
- Frontend: `app/src/features/sessions/screens.tsx` gained `EditEventsPanel`, shown on a completed session's detail page whenever the window is still open (client-side mirrors the same 5-hour math for the UI gate; the backend is the actual enforcement). Lists every goal/assist/card, lets you reassign who it belongs to (dropdown) or remove it (voids it), and has a "+ Add something missed" form for a forgotten goal/assist/card. When the window's closed, it just says when it closed instead of showing the panel.

### 2. A live session with real activity no longer gets silently force-closed — and never actually was, but now proactively checks in

Re-reading `materialize_and_flag_sessions()` (the existing 15-minute cron): it already only auto-closed genuinely empty "ghost" sessions (zero attendance, zero matches) — a session with real play was never being force-closed automatically. What was missing, which the user asked for: proactively noticing a session that's gone quiet — activity stopped, past its scheduled end — and checking in rather than leaving it live forever or guessing.

New step 4 in the same cron function:
- A `live` session past `scheduled_end_at` with no activity (`last_activity_at`, bumped by every event write and attendance change via new `touchSessionActivity()` helper) in the last 15 minutes gets evaluated.
- If `last_viewed_at` (a heartbeat — `sessions/handlers/get.ts` now stamps this on every `GET` while the session is `live`, and the live view already polls every 30s) is fresher than 3 minutes — someone's plausibly still on the live screen — sets `awaiting_confirmation = true` instead of touching status. The live view (`MatchDay.tsx`) shows a new `StillGoingPrompt` banner: "Still going?" / "End session". Tapping "Still going" calls new `POST sessions/:id/keep-alive`, which clears the flag and resets the activity clock.
- If nobody's watching (`last_viewed_at` stale or null), it closes the session and any still-open matches for real (`status: 'completed'`, `ended_at: now()`).

### 3. Punctuality judged against the real kick-off, not the scheduled one

`sessions/handlers/attendance.ts`'s `setAttendance` now bands arrival against `session.actual_kickoff_at ?? session.kickoff_at` instead of always `session.kickoff_at`. `startSession` now records `actual_kickoff_at` (once — idempotent, so resuming after full time never overwrites the real kick-off moment), and if this is the session's first real start, **recomputes punctuality for everyone already marked present** (they tapped in during the "who's here?" screen, before `actual_kickoff_at` existed, so their bands were computed against the wrong — scheduled — reference the first time). This is what makes "anyone present when the session actually starts is early, not late" true even when the group itself got going 30 minutes behind schedule. The existing `early_before_mins`/`on_time_after_mins`/`late_after_mins`/`very_late_points` settings (Settings → Football, already built) are unchanged and already exactly the "configurable how many minutes counts as late" the user asked for — no new setting needed.

### 4. Session detail shows the real timeline

`sessions/handlers/create.ts` now computes and stores `scheduled_end_at` (kickoff + slot duration, or 90 min default) at creation time — needed by both the new cron step and this display. `SessionDetailScreen` gained a "Timeline" card: scheduled vs. actual kick-off (with the delay, "15m late"/"10m early"), when it ended (with overtime if it ran past `scheduled_end_at`), and total time played.

**Verified:** `npx tsc -b --noEmit` and `deno check --quiet */index.ts` both clean. Migration applied and confirmed present via direct schema query. `select public.materialize_and_flag_sessions()` invoked directly against production — ran with no error (the project's own hard-won lesson: always run a new/changed function once against live data, not just trust that `db push` succeeded). `sessions` and `events` functions redeployed. **NOT verified:** none of the four behaviors has been exercised end-to-end by a human yet — no session has gone quiet to trigger the still-going prompt, no post-session correction has been made through the new panel, no punctuality band has been checked against a real late kickoff, and the timeline card hasn't been looked at on a real completed session. This is the biggest unverified surface shipped in one round so far — worth working through deliberately rather than assuming it all holds up.

---

## Session 9 (17 Aug 2026) — public, view-only live tracking

While the user was still testing the above, they asked for a second thing in parallel: from the public share page (no login), a pulsating "LIVE" banner should appear whenever a session is in progress, linking to a view-only tracker — real-time-feeling stats and activity, no interaction, guests can look at player detail pages but can't do anything.

**Discovered along the way:** a public session endpoint (`GET public/:slug/session/:sessionId`) already existed in `publicPage.ts`/`public/index.ts`, fully built — but had zero frontend consumer anywhere in the router or `PublicPage.tsx`. Dead code from an earlier round. This request is what finally wired it up, rather than building a new endpoint from scratch.

**Backend (`public` function, redeployed):**
- `getPublicPage` (the main `/t/:slug` payload) now also looks up the org's current `status = 'live'` session (respecting the existing `show_sessions` page setting — off means no live banner either) and returns it as `live_session: {id, title, session_date} | null`.
- `getPublicSession` (the existing dead endpoint) extended: now includes cards (`yellow_card`/`red_card`) in the event feed when the page's `show_cards` setting allows it (previously only pulled goals/assists), plus `match.started_at` and `session.actual_kickoff_at`/`kickoff_at` for a real timeline. Still strictly read-only — no write path was added, consistent with the rest of `public`.
- Both confirmed working with a live curl against production (anon key only, no session token): the main page payload correctly returned the real live session (`ebdab7ba-555e-4f8e-af3f-076e265df018`, from the session-6 merge earlier today), and the session endpoint returned its full event feed with player names.

**Frontend:**
- `PublicPage.tsx`: pulsating LIVE banner (red dot with an `animate-ping` ring, matching the pattern already used for "Live" badges elsewhere) shown on the main public page whenever `live_session` is present, linking to `/t/:slug/live/:sessionId`.
- New `PublicLiveSessionScreen` (same file, alongside the existing `PublicPlayerScreen`): shows the live/ended badge, running goal total (and own goals if any), and a reverse-chronological activity feed — each entry's player name links through to the existing `/t/:slug/player/:id` page ("view player details," exactly as asked), nothing else is interactive. Polls every 8 seconds while mounted — fast enough to feel live for a guest without hammering the function if several people have it open. New route `/t/:slug/live/:sessionId` added to `router.tsx`.
- No realtime channel/websocket used — kept to polling, consistent with how the rest of the public page already works (60s poll) and with rule2.txt's "no client subscribes to table changes" rule; broadcast events are for authenticated in-app listeners, not unauthenticated public ones.

**Verified:** `npx tsc -b --noEmit` and `deno check --quiet */index.ts` both clean. `public` function redeployed. Both endpoints curled directly against production with just the anon key (no auth token) and returned correct real data, including the live session the earlier merge produced. **NOT verified:** not opened in an actual browser — nobody has seen the pulsating banner render, tapped through to the live tracker, or watched it auto-refresh with a real goal being scored during the 8-second poll window.

**Follow-up in the same session — full stat parity + clock + animation, no backend change needed.** The user asked the guest tracker match the organizer's own live stat board (goals/assists/own goals/yellow/red, top scorer, top assister), show a running match clock, add a "this is happening now" animation, and make sure the WhatsApp nickname shows there too. The backend from the first pass already returned everything needed (`match.started_at`, and events already carried `own_goal`/`yellow_card`/`red_card`/`whatsapp_nickname` when the page's `show_cards` setting allows it) — this was purely a frontend rebuild of `PublicLiveSessionScreen` in `PublicPage.tsx`:
- Per-player stat rows computed client-side from the event feed (same shape as `LiveMatch`'s `statRows` in `MatchDay.tsx`: goals, assists, own goals, yellow/red counts), sorted by goals×2+assists, with top-scorer/top-assister cards above it.
- A real match clock (`useLiveClock` hook) ticking off `matches[last].started_at`, same MM:SS shape as the organizer's own clock, only while the session is live.
- `LivePitchAnimation` — a small decorative strip with a ball drifting and spinning across a pitch-lined bar via a CSS `@keyframes` animation, shown only while live. Purely ambient, not functional.
- `PlayerName` (the WhatsApp-nickname component from an earlier round) now used in the stat rows, top-performer cards, and the activity feed on this screen — it was previously using raw `display_name` here, so the nickname wasn't actually showing yet on this one screen even though the backend already sent it.

**Verified:** `npx tsc -b --noEmit` clean, and `npm run build` (full production build, not just typecheck) succeeds. No backend redeploy needed — this round touched only `app/src/features/public/PublicPage.tsx`. **NOT verified:** still not opened in a browser — the animation, clock, and new stat sections have not been visually confirmed to render correctly or look right on a phone screen.

**Follow-up — the animation wasn't what was meant.** The user pointed at a real lineup-graphic screenshot (two teams in formation, portrait pitch) and clarified: they wanted a ball actually bouncing between player positions in multiple directions with a 3D feel, not the flat drifting-dot strip from the first pass. Rebuilt `LivePitchAnimation` from scratch:
- A full portrait pitch (markings: center circle, halfway line, both penalty boxes, both goal lines) tilted with `perspective(700px) rotateX(22deg)` for a broadcast-camera angle.
- Two banks of 11 dots each (roughly GK/back-4/mid-3/front-3, mirrored top and bottom) standing in for two teams — chalk-white and volt-green to read clearly against the pitch green, purely decorative, not tied to real rosters.
- The ball travels a 12-point zigzag waypoint path across both halves (`live-ball-pos` keyframes) — left, right, forward, back — paired with a second keyframe (`live-ball-scale`) that grows the ball 1.7× at the midpoint of each pass and back to 1× at each "touch," plus a synced shadow dot (`live-ball-shadow` / `live-shadow-scale`) that squashes and fades opposite the ball's scale — the combination is what fakes the up-and-down bounce in a 2D scene. 7-second loop, `prefers-reduced-motion` respected (freezes the ball instead of animating).
- Verified visually in the Browser pane (not just typechecked) at mobile width against the real live session — pitch, tilt, both team's dots, and the ball mid-bounce all rendered as intended; confirmed the stat board/top-scorer/top-assist cards below it also render correctly with real data and WhatsApp nicknames.

**Verified:** `npx tsc -b --noEmit` clean, and this specific screen was opened and screenshotted in the Browser pane against real production data (unlike the rest of this session's work, which stayed unverified in-browser at the user's request) — the animation and layout look right at mobile width. **NOT verified:** desktop/tablet widths, and the animation hasn't been watched through a full 7-second loop to confirm every waypoint transition looks smooth (only sampled at a few points).

**Follow-up — collapsible, and everything randomized instead of a fixed loop.** The user asked for three more things: a hide/show toggle, ball speed that varies (not a constant pace) but staying "not too fast, not too slow," and the ball hopping between all 22 dots (11+11) in a genuinely random order rather than the fixed 12-point zigzag — plus the formation itself mixing/changing rather than being the same fixed lineup shape every time.

The fixed-keyframe approach from the previous pass couldn't do any of this (CSS `@keyframes` are static, can't re-roll per cycle), so `LivePitchAnimation` was rebuilt around actual randomness:
- `randomFormation()`: a wider pool of candidate pitch coordinates (with a little jitter so nothing looks grid-snapped) is shuffled, 22 are picked, and team membership (11 chalk-white, 11 volt-green) is independently shuffled onto them — mounts differently every time, dots from both "teams" interleaved across the whole pitch rather than banked top/bottom.
- `useBouncingBall()`: a small timer loop (not CSS animation) that, each hop, picks a random different dot out of all 22 as the next target and a random duration between 0.9s–2.3s (the "not too fast, not too slow" bound), eases position between them, and separately eases a scale value that peaks mid-hop (`sin(t·π)`) to fake the bounce height — paired with a shadow dot whose scale/opacity move inversely. Every hop re-rolls both the target and the speed, so no two hops look alike and it never repeats a visible pattern. Respects `prefers-reduced-motion` (freezes instead of animating).
- Collapse toggle: a small "Hide pitch"/"Show pitch" button above it — collapsing removes the pitch from the DOM entirely (the timer loop pauses rather than ticking in the background while hidden).

**Verified:** `npx tsc -b --noEmit` clean. Opened in the Browser pane again (mobile width, real live session): confirmed the formation now visibly mixes both colors across the whole pitch instead of two clean banks, the collapse button is positioned and labelled correctly, and toggling it (via a script-driven click — the pane's synthetic click was flaky this round, but the underlying state change and DOM update were confirmed directly) correctly hides/shows the pitch with no console errors. **NOT verified:** hasn't been watched over a long stretch to eyeball that hop speed and target selection actually feel random rather than falling into some accidental short cycle.

**Follow-up — formation changes now drift instead of popping.** Formation was only ever set once (on mount) before this, so "switching formation" didn't actually exist yet as a runtime behavior — the user asked for it, and for the transition itself to look like players walking there, not a sudden jump or disappearance. Added:
- Every 13–20 seconds (randomized so it doesn't feel metronomic), `LivePitchAnimation` re-rolls the 22 dots' coordinates via a new `reformation()` — same 22 dot identities, same team/color per dot, only the x/y changes — and each dot's `<span>` now has a `transition-[left,top] duration-[2200ms] ease-in-out` so React's re-render animates smoothly from the old spot to the new one instead of snapping.
- `useBouncingBall` was refactored to read positions through a ref (`pointsRef`) updated by a separate effect, rather than depending on the `points` array directly — otherwise every formation change would have restarted the hop loop from a random hop mid-flight, snapping the ball. Now the ball keeps its current hop smoothly and simply starts targeting the new formation's coordinates on its next hop.
- Respects `prefers-reduced-motion` and pauses (no scheduled reformation) while the pitch is collapsed.

**Verified:** `npx tsc -b --noEmit` clean, `npm run build` succeeds. **NOT verified in a browser this round — the user asked not to use the preview tool this time and will check it themselves.**

---

## Session 10 (17 Aug 2026) — session detail page rebuilt: hierarchy, collapsibility, and a real goal/assist data model

The user tested the completed-session page (from session 8's post-session edit window work) and said the UI wasn't acceptable: wrong section order (a long "who turned up" list sitting above the short, more-useful Timeline/Matches/corrections sections, forcing a scroll past hundreds of names to reach anything else), no collapsing anywhere, the correction UI itself ("trash," their word) using inline dropdowns on cramped cards instead of a proper modal, and — the actual domain bug — assist treated as a freestanding event type you could add/edit on its own, when in football an assist can never exist without the goal it credits.

### 1. Section order flipped

`SessionDetailScreen` (`app/src/features/sessions/screens.tsx`) now renders **Matches → Timeline → Correcting the record → Who turned up**. The short, glanceable sections come first; the potentially-very-long attendance list is last, so a 500-person "who turned up" list can never push the things you're more likely to be here for below the fold.

### 2. Collapsible everywhere a list can get long

- New `AttendanceList` component: shows the first 5 present players, with "View all N (X more)" / "Show fewer" toggling the rest. Applies regardless of squad size.
- The correcting-the-record list (goals/cards/own-goals) got the same treatment: first 5 rows, "View all" to expand.

### 3. Correcting the record — goal-centric data model, not "assist is just another event type"

This was the real fix, not just cosmetic. Football domain rule the user stated explicitly: **an assist always belongs to a specific goal; it can never exist standalone.** A goal, on the other hand, can absolutely stand alone (a solo goal) — same for own goals, yellow cards, red cards.

**Backend (`supabase/functions/events/handlers/record.ts`, redeployed):**
- `updateEvent` (`PATCH events/:id`) rewritten: when the target event is a `goal`, patching its `related_player_id` is now how you manage that goal's assist — not a separate call against the assist row. Passing a player id with no existing assist **inserts** a new linked `assist` match_events row (sharing the goal's `group_id`); passing `null` when one exists **voids** it; passing a different id **reassigns** it; leaving it untouched while changing the scorer keeps the assist's "assisted whom" pointer in sync automatically. The caller (frontend) never addresses an assist row directly — it only ever edits the goal.
- `voidEvent` cascade direction fixed: it used to void an event's entire `group_id` sibling set symmetrically (documented in the original comment as "an assisted goal voids its assist too"), which meant voiding *just the assist* incorrectly took the goal down with it. Now cascade only fires when the voided event **is** the goal — voiding a goal takes its assist with it (correct), voiding just the assist leaves the goal standing as a solo goal (correct, and wasn't true before).

**Frontend, complete rebuild of `EditEventsPanel` and everything under it:**
- Events are grouped into "plays" client-side: every `goal` event is paired with its `assist` sibling (matched by shared `group_id` in `metadata`) into a single row — "Efe — Assist: Reward" or "Efe — No assist," not two separate list items.
- Tapping a goal row opens `EditGoalSheet` (a proper modal via the existing `Sheet` component, not an inline card) — one Select for who scored, one Select for the assist ("No assist — solo goal" is a real option), Save, and "Remove this goal (and its assist)". This is the whole "select a goal, then either update the scorer, add an assist it didn't have, change the assist it did have, or remove the assist" flow the user described, mapped directly onto one screen.
- Own goals/cards get their own lightweight `EditSimpleEventSheet` modal (single player field, no assist concept).
- "+ Add something missed" is now `AddEventSheet`, a modal — type selector **without** "Assist" as a choice (`ADDABLE_TYPES = ['goal', 'own_goal', 'yellow_card', 'red_card']`, deliberately excludes it), and when adding a Goal, an inline optional assist field right there in the same modal — because a new goal's assist is decided at the moment you record the goal, not as a separate standalone action.

**Verified:** `npx tsc -b --noEmit` clean, `npm run build` succeeds, `deno check --quiet */index.ts` clean, `events` function redeployed. **NOT verified in a browser — the user asked not to use the preview tool this round and will check it themselves.** This is a meaningful behavior change to the edit/void endpoints on top of being a UI rebuild, so it's worth exercising all three paths deliberately: adding a goal with an assist from the modal, editing an existing goal to add/change/remove its assist, and voiding a goal vs. voiding just its assist — to confirm the cascade direction is right in practice, not just in the code.

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
