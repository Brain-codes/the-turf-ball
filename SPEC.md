# THE TURF BALL — Master Technical Specification

**Version:** 1.0 (pre-build lock)
**Date:** 16 August 2026
**Status:** Specification only. No code is written until this document is approved.

---

## 0. Document purpose

This is the single source of truth for the product. Everything below is locked before implementation begins: terminology, features, roles, journeys, screens, database, APIs, algorithms, design system, animation system, scope boundaries, roadmap, deployment and testing.

Two constraint documents govern this build and cannot be overridden by convenience:

1. **`rule2.txt` — Supabase Architecture Rules.** No direct table access from any client. All data access through resource-based Edge Functions. One Edge Function per resource. `index.ts` is a router. Handlers in separate files. Shared utilities in `shared/`. Standard response envelope on every endpoint. Supabase Auth for simple auth, Edge Functions for complex signup. Native Supabase email verification only — no SendGrid/Resend/Mailchimp.
2. **Operator note (supersedes rule2.txt §10).** Supabase CLI is installed and working. Migrations ship via `supabase db push` from versioned migration files in the repo. The web SQL Editor is a fallback, not the workflow. Edge Functions deploy via `supabase functions deploy <name>`.

---

## 1. Product definition

### 1.1 What it is

A **football competition engine** for grassroots and recreational football groups. Organizers run sessions, record what happens on the pitch in real time, and the system automatically produces statistics, rankings, awards and a public shareable page.

Player of the Month is the *first feature* built on the engine — not the product itself. Anything that can be expressed as "count events, weight them, rank players, name a winner" must work without a database redesign.

### 1.2 Working name

**The Turf Ball.** Public-facing surface: `theturfball.com` (placeholder until domain is confirmed).

### 1.3 The core loop

```
CREATE TEAM → ADD PLAYERS → CONFIGURE RULES → CREATE SESSION → PLAY
    → RECORD EVENTS → CALCULATE STATS → APPLY SCORING → RANK
    → AWARD → SHARE → PLAY AGAIN
```

Every feature must serve a step in this loop. Anything that doesn't is out of scope for V1.

### 1.4 Non-goals for V1

Payments, subscriptions, chat/messaging, social feed, tournament brackets, fantasy leagues, transfers, video, AI analysis, formations, player marketplace. Explicitly deferred.

---

## 2. Terminology (locked)

These words mean exactly one thing across the database, the API, the UI and every conversation.

| Term | Definition |
|---|---|
| **Organization** | The top-level tenant. One football group. Owned by one user, may have several members. Example: "Abuja Sunday Ballers". |
| **Member** | A user account attached to an organization with a role. |
| **Player** | A person who plays. **Not** a user account. A roster record owned by the organization. |
| **Season** | A long container for competition, e.g. "2026". Optional in V1 — one implicit season is auto-created. |
| **Period** | A monthly competition window inside a season, e.g. "August 2026". This is what Player of the Month is computed over. Has a lifecycle: `open → closed`. |
| **Session** | One turn-up day. "Sunday 16 Aug, 5:00 PM at XYZ Arena." Contains attendance, punctuality and one or more matches. |
| **Match** | One game within a session. Two sides, a scoreline, a set of events. |
| **Side** | A team-of-the-day within a match (Blue / Red). Ad-hoc, not persistent. |
| **Match event** | An atomic recorded fact: goal, assist, card, clean sheet, etc. **The single source of truth for all statistics.** |
| **Statistic** | A derived count over match events for a player in a period. Never authored directly. |
| **Scoring rule** | A configurable weight mapping an event type to points. |
| **Player score** | Statistics × scoring rules = ranking points. |
| **Award** | A named recognition granted for a period, e.g. Player of the Month. |
| **Public page** | The unauthenticated, shareable read-only view of an organization. |

**Deliberate naming decision:** the chat history used "team" for both the tenant and the sides in a match. That ambiguity is removed. The tenant is an **Organization**; the in-match teams are **Sides**.

---

## 3. Roles and permissions

Three roles in V1, plus the anonymous viewer.

| Role | Scope | Can do |
|---|---|---|
| **Owner** | Organization | Everything, including deleting the org, managing members, closing periods, editing scoring rules. |
| **Admin** | Organization | Manage players, sessions, matches, events, publish/unpublish public page. Cannot delete the org, cannot change billing/ownership. |
| **Recorder** | Organization | Match-day only: mark attendance, record events, finish matches. Cannot edit scoring rules, cannot delete players. Exists so the organizer can hand a phone to a friend on the pitch. |
| **Viewer (anonymous)** | Public page | Read published statistics, leaderboard, awards, match results. No writes ever. |
| **Platform admin** | Global | Support/ops only. Not a product surface in V1 — a flag on the profile, used by internal tooling. |

**Hard rule:** authorization is enforced in the Edge Function on every request by resolving the caller's membership in the target organization. The React app hiding a button is a convenience, never a control.

---

## 4. Multi-tenancy model

```
auth.users → profiles
                │
                └── organization_members ──→ organizations
                                                 │
                        ┌────────────────────────┼─────────────────────┐
                     players                  seasons               settings
                                                 │                  scoring_rules
                                              periods               public_page
                                                 │
                                             sessions
                                                 │
                                    ┌────────────┴───────────┐
                            session_attendance           matches
                                                             │
                                                    ┌────────┴────────┐
                                              match_players     match_events
```

Every row below `organizations` carries `organization_id`. Every query in every handler filters on the caller's resolved organization. Cross-tenant reads are impossible by construction, not by convention.

A user may belong to multiple organizations. The app has an active-organization concept (stored client-side, validated server-side on every call).

---

## 5. User journeys

### 5.1 Organizer first run

1. Sign up with email + password → Supabase sends verification email.
2. Verify email → land in onboarding.
3. **Step 1 — Create organization.** Name, short name, logo (optional), location, venue, format (5-a-side / 7-a-side / 11-a-side / custom), playing day(s), default kick-off time.
4. **Step 2 — Add players.** Fast-entry list: type a name, hit enter, repeat. Position and photo optional and editable later. Minimum 1 player to continue, skippable.
5. **Step 3 — Choose a scoring preset.** Three presets (Balanced / Goal-heavy / Team-first) plus "Customize". Sensible defaults so nobody is forced to think about weights on day one.
6. **Step 4 — Done.** Public link generated and shown with a copy button. Prompt: "Create your first session."

Onboarding must be completable in under two minutes.

### 5.2 Match day (the critical path)

1. Organizer opens the app on a phone at the pitch.
2. **Start session** — confirms date, kick-off time, venue.
3. **Attendance & punctuality** — roster list, tap a player to mark present; arrival time defaults to *now*, editable. Punctuality band computed from kick-off time.
4. **Create match** — assign present players to Side A / Side B (auto-split button available), set duration.
5. **Record events** — the fast dashboard (see §7.4). Goal is three taps maximum.
6. **Finish match** — confirm scoreline, optionally add clean sheets, optionally start the next match with the same players.
7. **End session** — summary screen: goals, assists, cards, top performer of the day, share button.

### 5.3 Player / group member

1. Receives a WhatsApp link.
2. Opens the public page. No login, no install.
3. Sees the current month's leaderboard, their own row highlighted if they tap their name, top scorers, last session's results, current Player of the Month standing.
4. Optionally shares their own player card.

### 5.4 Month close

1. On the 1st of the next month (or manually), the organizer opens the period-close screen.
2. System shows final standings and the computed winner, with the full points breakdown per player.
3. Organizer confirms → period locks, awards are recorded permanently, next period opens automatically.
4. The public page shows an award reveal.

---

## 6. Feature inventory

### 6.1 MVP (V1)

- Email/password auth with native Supabase verification, password reset.
- Organization creation, settings, logo upload.
- Member invitations (Admin, Recorder) by email.
- Player CRUD: name, display name, jersey number, position, photo, status (active/inactive/guest).
- Session creation, attendance, arrival time, punctuality banding.
- Match creation, side assignment, event recording (goal, assist, own goal, yellow, red, clean sheet), match finish.
- Automatic statistics derivation from events.
- Configurable scoring rules with presets.
- Live leaderboard for the current period.
- Player profile with per-period stats and recent form.
- Period close, Player of the Month calculation and award record.
- Public page with slug URL, leaderboard, top performers, recent results, current award holder.
- Share actions: copy link, share player card.

### 6.2 V1.1

- Voting (organizer-controlled and authenticated member voting).
- Additional awards: Golden Boot, Playmaker, Golden Glove, Iron Man, Most Punctual, Fan Favourite.
- Match timeline view with minute markers.
- Player comparison.
- Session history and analytics.
- CSV export.

### 6.3 V2

- Multiple competitions per organization.
- Persistent teams and team-vs-team leagues with fixtures and a points table.
- Season concept surfaced in UI.
- Generated social image cards.
- Player self-claim of a roster profile.

---

## 7. Screen inventory and navigation

### 7.1 Route map

```
PUBLIC (no auth)
  /                          Marketing / landing
  /login
  /register
  /verify-email
  /forgot-password
  /reset-password
  /t/:slug                   Public organization page
  /t/:slug/player/:playerId  Public player card
  /t/:slug/session/:id       Public session result

ONBOARDING (auth, no org yet)
  /onboarding/organization
  /onboarding/players
  /onboarding/scoring
  /onboarding/done

APP (auth + org)
  /app                       Dashboard
  /app/players
  /app/players/new
  /app/players/:id
  /app/sessions
  /app/sessions/new
  /app/sessions/:id
  /app/sessions/:id/live     MATCH DAY MODE (chrome-less)
  /app/matches/:id
  /app/leaderboard
  /app/awards
  /app/settings/general
  /app/settings/football
  /app/settings/scoring
  /app/settings/public-page
  /app/settings/members
  /app/settings/account
```

### 7.2 Navigation

Desktop: persistent left rail — Dashboard, Players, Sessions, Leaderboard, Awards, Settings. Organization switcher at the top, period selector in the header.

Mobile: bottom tab bar — Dashboard, Players, Sessions, Leaderboard, More. Match-day mode replaces all navigation with its own chrome.

### 7.3 Dashboard

Hero band: greeting, organization name, active period, the organization's headline number (total goals this period) with a count-up animation over a subtle animated pitch background.

Below: four stat tiles (Players, Sessions, Goals, Assists) · Top-5 leaderboard preview · three top-performer cards (Top Scorer, Top Assister, Most Clean Sheets) · recent sessions list · primary CTA "Start Session" pinned on mobile.

Empty states are designed, not accidental: no players → "Add your squad"; no sessions → "Run your first session".

### 7.4 Match day mode — the most important screen

Design constraints: one-handed, outdoors, bright sunlight, possibly wet hands, organizer is watching a game and cannot look down for long.

- Full-bleed dark layout, minimum 56px tap targets, high contrast, no hover-dependent affordances.
- Persistent header: scoreline, match clock (start/pause/stop), exit.
- Action row, always reachable with the thumb: **GOAL · ASSIST-less GOAL · CARD · CLEAN SHEET · SUB**.
- **Goal flow (3 taps):** GOAL → tap scorer from a grid of present players (photo + jersey, sorted by side, most-recent-scorers first) → tap assister *or* "No assist" → auto-confirm with a 5-second undo toast. No modal stacking, no keyboard.
- **Card flow (2 taps):** CARD → colour → player.
- **Clean sheet:** offered at match finish, defaulting per the org's clean-sheet policy setting (GK only / whole side / manual selection).
- Every action produces an immediate optimistic UI update plus a goal animation burst, and every action is undoable for 5 seconds.
- Offline tolerance: events queue locally and flush when connectivity returns. Each event carries a client-generated idempotency key so a retry never double-counts.

### 7.5 Public page

Hero: crest, organization name, period selector. Then: Player of the Month card (or "current leader" while the period is open) · leaderboard with points breakdown on tap · top-performer cards · recent sessions · squad grid. Sticky share button. Fast first paint — this page is opened on Nigerian mobile data from a WhatsApp link and must be usable in under 2 seconds on 3G.

---

## 8. Database design

Postgres on Supabase. All tables in `public`. All tables have `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz`. Mutable domain tables also carry `created_by uuid` referencing `profiles`.

**RLS posture:** RLS is enabled and set to deny-all on every table. Edge Functions use the service role. Because clients never touch tables directly (rule2.txt §1), RLS is a hard backstop, not the authorization mechanism. Authorization lives in the Edge Function membership check.

### 8.1 Tables

**profiles** — mirrors `auth.users`.
`id` (= auth.users.id, pk) · `email` unique · `full_name` · `avatar_url` · `is_platform_admin` bool default false · `onboarded_at`

**organizations**
`id` · `owner_id` → profiles · `name` · `short_name` · `slug` unique · `logo_url` · `description` · `location` · `venue` · `format` enum(`5aside`,`7aside`,`11aside`,`custom`) · `players_per_side` int · `playing_days` text[] · `default_kickoff` time · `timezone` default `Africa/Lagos` · `status` enum(`active`,`archived`)

**organization_members**
`id` · `organization_id` → organizations · `user_id` → profiles nullable · `invited_email` · `role` enum(`owner`,`admin`,`recorder`) · `status` enum(`invited`,`active`,`revoked`) · `invite_token` · `invite_expires_at`
Unique: (`organization_id`, `user_id`), (`organization_id`, `invited_email`) where status ≠ revoked.

**players**
`id` · `organization_id` · `first_name` · `last_name` · `display_name` · `photo_url` · `jersey_number` int · `position` enum(`GK`,`DEF`,`MID`,`FWD`) · `preferred_foot` enum(`left`,`right`,`both`) · `status` enum(`active`,`inactive`,`guest`) · `joined_at`
Unique: (`organization_id`, `jersey_number`) where jersey_number not null. Index on (`organization_id`, `status`).

**seasons**
`id` · `organization_id` · `name` · `starts_on` · `ends_on` · `is_current` bool
One auto-created season per org in V1.

**periods** — the monthly competition window.
`id` · `organization_id` · `season_id` · `label` (e.g. "August 2026") · `year` int · `month` int · `starts_on` · `ends_on` · `status` enum(`open`,`closed`) · `closed_at` · `closed_by`
Unique: (`organization_id`, `year`, `month`). Exactly one `open` period per organization enforced by a partial unique index.

**sessions**
`id` · `organization_id` · `period_id` · `title` · `session_date` · `kickoff_at` timestamptz · `venue` · `status` enum(`scheduled`,`live`,`completed`,`cancelled`) · `notes`
Index on (`organization_id`, `session_date` desc).

**session_attendance**
`id` · `session_id` · `player_id` · `status` enum(`present`,`absent`,`excused`) · `arrived_at` timestamptz · `punctuality_band` enum(`early`,`on_time`,`late`,`very_late`) · `punctuality_points` numeric
Unique: (`session_id`, `player_id`).

**matches**
`id` · `organization_id` · `session_id` · `sequence` int · `duration_minutes` int · `started_at` · `ended_at` · `status` enum(`pending`,`live`,`completed`,`abandoned`) · `side_a_label` default 'Blue' · `side_b_label` default 'Red' · `side_a_score` int · `side_b_score` int
Scores are **denormalized cache** recomputed from events; events remain authoritative.

**match_players**
`id` · `match_id` · `player_id` · `side` enum(`a`,`b`) · `is_goalkeeper` bool · `minutes_played` int nullable
Unique: (`match_id`, `player_id`). This is what generates an appearance.

**match_events** — the heart of the system.
`id` · `organization_id` · `match_id` · `session_id` · `period_id` · `player_id` → players · `related_player_id` → players nullable · `event_type` enum · `side` enum(`a`,`b`) · `minute` int nullable · `metadata` jsonb · `client_key` text · `created_by` · `voided_at` timestamptz nullable · `voided_by`
Unique: (`match_id`, `client_key`) — idempotency for offline retries.
Indexes: (`organization_id`, `period_id`, `event_type`), (`match_id`), (`player_id`, `period_id`).

`event_type` values in V1: `goal`, `own_goal`, `assist`, `yellow_card`, `red_card`, `clean_sheet`, `appearance`, `punctuality`, `save`, `motm`.

**Denormalization rationale:** `organization_id`, `session_id` and `period_id` are copied onto `match_events` deliberately. Statistics aggregate over a period across thousands of events; carrying the period on the row turns a four-table join into a single indexed scan. The copies are written once, at insert, and never updated — a match cannot move between periods.

**Deletion policy:** events are never hard-deleted. `voided_at` is set, and all aggregation excludes voided rows. Undo, correction and dispute resolution all use voiding. This preserves the audit trail an organizer needs when a player argues about a goal.

**Assist modelling decision:** an assisted goal writes **two** rows — one `goal` for the scorer (with `related_player_id` = assister) and one `assist` for the assister (with `related_player_id` = scorer). The redundancy is intentional: it makes every statistic a uniform `COUNT(*) WHERE event_type = X AND player_id = Y`, with no special-casing in the scoring engine and no risk of the two counts drifting. The two rows share a `metadata.group_id` so voiding a goal voids its assist atomically.

**scoring_rules**
`id` · `organization_id` · `period_id` nullable (null = org default) · `event_type` · `points` numeric · `enabled` bool
Unique: (`organization_id`, `period_id`, `event_type`). When a period closes, its effective rules are snapshotted into period-scoped rows so historical results can never be retroactively changed by editing the defaults. **This is non-negotiable for historical integrity.**

**player_period_stats** — materialized cache.
`id` · `organization_id` · `period_id` · `player_id` · `appearances` · `goals` · `own_goals` · `assists` · `clean_sheets` · `yellow_cards` · `red_cards` · `punctuality_score` · `vote_points` · `total_points` numeric · `rank` int · `computed_at`
Unique: (`organization_id`, `period_id`, `player_id`).
Recomputed after every event write (cheap — one aggregate query scoped to the period) and fully rebuilt on period close. **Never** written to directly by a client; there is no endpoint that sets a stat.

**award_types**
`id` · `organization_id` nullable (null = system-defined) · `code` · `name` · `icon` · `description` · `enabled`
Seeded: `player_of_month`, `golden_boot`, `playmaker`, `golden_glove`, `iron_man`, `most_punctual`, `fan_favourite`.

**awards**
`id` · `organization_id` · `period_id` · `award_type_id` · `player_id` · `value` numeric · `breakdown` jsonb · `awarded_at`
Unique: (`organization_id`, `period_id`, `award_type_id`). `breakdown` stores the full points calculation at award time — permanently reproducible.

**award_votes** (V1.1)
`id` · `organization_id` · `period_id` · `voter_user_id` nullable · `voter_fingerprint` nullable · `player_id` · `weight` numeric · `source` enum(`organizer`,`member`)
Unique: (`period_id`, `voter_user_id`) and (`period_id`, `voter_fingerprint`).

**public_pages**
`id` · `organization_id` unique · `slug` unique · `is_published` bool · `show_photos` bool · `show_cards` bool · `show_punctuality` bool · `show_sessions` bool · `theme` · `view_count` int

**audit_log**
`id` · `organization_id` · `actor_id` · `action` · `entity_type` · `entity_id` · `before` jsonb · `after` jsonb

### 8.2 Storage buckets

`org-logos` (public read), `player-photos` (public read). Uploads go through the Edge Function, which validates ownership, size (≤ 2MB) and mime type, then issues a signed upload URL. Clients never get raw bucket credentials.

---

## 9. Statistics and scoring engines

### 9.1 Pipeline

```
match_events (source of truth, excluding voided)
        ↓  aggregate by player × period
player_period_stats (raw counts)
        ↓  apply scoring_rules
total_points
        ↓  rank with tie-breakers
leaderboard
        ↓  at period close
awards (with frozen breakdown)
```

### 9.2 Statistic definitions

| Statistic | Derivation |
|---|---|
| Appearances | Distinct matches in the period where the player has a `match_players` row |
| Goals | Count of `goal` events (own goals excluded) |
| Assists | Count of `assist` events |
| Clean sheets | Count of `clean_sheet` events |
| Yellow / Red cards | Count of respective card events |
| Punctuality score | Sum of `punctuality_points` from session attendance in the period |

### 9.3 Punctuality banding

Relative to session `kickoff_at`, configurable per organization:

| Band | Default window | Default points |
|---|---|---|
| Early | ≥ 10 min before kick-off | +2 |
| On time | within 10 min before → 5 min after | +1 |
| Late | 5–20 min after | 0 |
| Very late | > 20 min after | −1 |

### 9.4 Scoring defaults (Balanced preset)

Appearance +1 · Goal +5 · Assist +3 · Clean sheet +2 · Own goal −2 · Yellow −1 · Red −3 · Punctuality (as banded) · Vote weight: member +1, organizer +3.

Every value is organization-editable. The engine reads rules from the database; **no weight is ever hard-coded in application code.**

### 9.5 Total points

```
total_points = Σ (statistic_count × rule_points) for every enabled rule
             + punctuality_score
             + vote_points          (V1.1)
```

### 9.6 Tie-breakers (in order, configurable)

1. Higher total points
2. More goals
3. More assists
4. Fewer red cards, then fewer yellow cards
5. More appearances
6. Better punctuality score
7. Earlier `joined_at` (deterministic final fallback — never a coin flip)

### 9.7 Period close procedure

Transactional, all-or-nothing:

1. Verify the caller is Owner.
2. Verify no session in the period is `live`.
3. Snapshot effective scoring rules into period-scoped `scoring_rules` rows.
4. Full recompute of `player_period_stats` for the period.
5. Rank and resolve ties.
6. Insert `awards` rows for every enabled award type, each with a frozen `breakdown`.
7. Set period `status = closed`.
8. Create the next period as `open`.
9. Write to `audit_log`.

Once closed, no event may be created, voided or edited within that period. Corrections require an Owner to explicitly reopen the period, which is itself audited.

---

## 10. API architecture

### 10.1 Edge Function inventory

One function per resource, per rule2.txt §3–4.

| Function | Responsibility |
|---|---|
| `auth` | Register (with profile + validation), resend verification, invite acceptance |
| `organizations` | Org CRUD, settings, logo, slug availability |
| `members` | Invite, list, change role, revoke |
| `players` | Player CRUD, photo, bulk create (onboarding) |
| `periods` | List, get current, close, reopen |
| `sessions` | Session CRUD, attendance, punctuality |
| `matches` | Match CRUD, sides, start, finish |
| `events` | Record event, batch record, void event |
| `stats` | Player stats, leaderboard, dashboard summary |
| `scoring` | Scoring rules read/write, presets |
| `awards` | Award list, award history, votes |
| `public` | All unauthenticated public-page reads, by slug |

### 10.2 Endpoint contracts (representative)

```
POST   /auth/register              { email, password, full_name }
POST   /auth/resend-verification
POST   /auth/accept-invite         { token }

GET    /organizations              caller's orgs
POST   /organizations
GET    /organizations/:id
PATCH  /organizations/:id
GET    /organizations/slug-check?slug=

GET    /players?status=&search=&page=
POST   /players
POST   /players/bulk               { names: [] }
GET    /players/:id                includes period stats + recent form
PATCH  /players/:id
DELETE /players/:id                soft: status → inactive

GET    /sessions?period_id=&page=
POST   /sessions
GET    /sessions/:id
PATCH  /sessions/:id
POST   /sessions/:id/attendance    { entries: [{ player_id, status, arrived_at }] }
POST   /sessions/:id/complete

POST   /matches                    { session_id, side_a[], side_b[], duration }
GET    /matches/:id
POST   /matches/:id/start
POST   /matches/:id/finish         { clean_sheets: [] }

POST   /events                     { match_id, event_type, player_id,
                                     related_player_id?, minute?, client_key }
POST   /events/batch               offline queue flush
DELETE /events/:id                 void, not delete

GET    /stats/leaderboard?period_id=
GET    /stats/dashboard?period_id=
GET    /stats/player/:id?period_id=

GET    /scoring/rules?period_id=
PUT    /scoring/rules              { rules: [{ event_type, points, enabled }] }
GET    /scoring/presets

GET    /periods
POST   /periods/:id/close
POST   /periods/:id/reopen

GET    /awards?period_id=
GET    /awards/history

GET    /public/:slug
GET    /public/:slug/leaderboard?period_id=
GET    /public/:slug/player/:playerId
GET    /public/:slug/sessions
```

### 10.3 Response envelope

Every endpoint, success or failure, returns exactly:

```json
{ "success": true, "message": "Request successful", "data": {}, "meta": {}, "errors": null }
```

Produced solely by `shared/response.ts`. A handler that constructs a `Response` by hand is a bug.

`meta` carries pagination (`page`, `per_page`, `total`, `total_pages`) and timing where relevant. `errors` carries field-keyed validation detail: `{ "email": ["Email already registered"] }`.

### 10.4 Standard error codes

`400` validation · `401` unauthenticated · `403` not a member / insufficient role · `404` not found in this tenant · `409` conflict (duplicate slug, jersey, closed period) · `422` business rule violation (e.g. event on a completed match) · `429` rate limited · `500` unexpected.

**404-over-403 rule:** a resource belonging to another organization returns `404`, never `403`. Never confirm the existence of another tenant's data.

### 10.5 Shared utilities (per function)

```
shared/
  cors.ts        preflight + headers
  response.ts    successResponse / errorResponse — the only response constructors
  auth.ts        JWT verification → user, then org membership → role
  guard.ts       requireRole(role), requireOpenPeriod(period)
  validation.ts  Zod schemas per endpoint
  db.ts          service-role Supabase client
  router.ts      method + path-segment routing
  errors.ts      typed AppError → HTTP mapping
  log.ts         structured logging with request id
```

`index.ts` does four things only: handle CORS preflight, parse method and path segments, run auth middleware, delegate to a handler. No business logic.

### 10.6 Every mutating request is authorized this way

1. Verify JWT → user id.
2. Resolve `organization_members` row for (user, target org) with `status = active`.
3. Compare role against the endpoint's required role.
4. Scope every subsequent query by `organization_id`.

No exceptions, no shortcuts, on any handler.

---

## 11. Authentication

- **Signup:** through the `auth` Edge Function, because it must create `auth.users` + `profiles` + `organization_members` and validate email uniqueness against profiles — exactly the compound case rule2.txt §12 requires a function for. On partial failure the created auth user is rolled back.
- **Login / logout / password reset:** Supabase Auth client SDK directly (rule2.txt §11).
- **Email verification:** native Supabase, "Confirm email" enabled in Dashboard → Authentication → Providers → Email. No third-party mail provider, ever. Custom email templates are configured in the Dashboard so the messages carry The Turf Ball branding.
- **Session handling:** Supabase's own token refresh in the client; the access token is sent as `Authorization: Bearer` to every Edge Function.
- **Invites:** an `organization_members` row in `invited` status plus a signed token. The invitee signs up or logs in, calls `/auth/accept-invite`, and the row activates.

---

## 12. Realtime architecture

Rule2.txt forbids clients subscribing to tables. Realtime is therefore built as a **broadcast** channel, not a table-change channel:

1. Organizer records an event → `events` Edge Function.
2. The function writes the event, recomputes stats, then publishes to a Supabase Realtime **broadcast** channel named `org:{organization_id}:period:{period_id}`.
3. The public page and any open dashboard subscribe to that broadcast channel. They receive a payload describing what changed and re-fetch the affected slice through the public Edge Function.

Clients therefore never subscribe to `postgres_changes` and never read a table. The channel is a notification bus; the Edge Function remains the only data path. This satisfies the architecture rule without giving up live updates.

Realtime is Phase 12 — everything works with pull-to-refresh and a 30-second poll before it exists.

---

## 13. Frontend architecture

**Stack:** React 19 + Vite + TypeScript · React Router · TanStack Query (server state) · Zustand (small UI/session state) · Tailwind CSS · Framer Motion · React Three Fiber + drei (limited, lazy-loaded) · React Hook Form + Zod · Recharts (light usage).

Vite over Next.js deliberately: this is an authenticated SPA with one public marketing surface, and the operator asked for fast and light. The public page is pre-rendered at build time for SEO and instant paint; everything else is client-rendered.

```
src/
  app/            router, providers, layouts, error boundaries
  components/ui/  design-system primitives (Button, Card, Stat, Sheet, ...)
  components/motion/  reusable animation primitives
  features/
    auth/ onboarding/ organizations/ players/ sessions/
    matches/ matchday/ stats/ leaderboard/ awards/ settings/ public/
      └─ each: components/ hooks/ api.ts types.ts
  hooks/          cross-cutting hooks
  services/       api client, single fetch wrapper, envelope unwrapping
  lib/            supabase client, formatters, date/tz, offline queue
  types/          shared domain types (generated from the API contracts)
  styles/
```

**One API client.** Every request goes through `services/client.ts`: attaches the bearer token, unwraps the envelope, throws a typed `ApiError` on `success: false`. No component ever calls `fetch` and no component ever imports the Supabase client except for auth.

**Offline queue.** Match-day writes go through `lib/offlineQueue.ts` — IndexedDB-backed, each entry carrying a `client_key`, flushed on reconnect, deduplicated server-side by the unique index.

---

## 14. Design system

### 14.1 Direction

Football broadcast graphics meet premium sports app. Dark, high-contrast, big numbers, decisive motion. Explicitly not a generic admin dashboard, and not a clone of any one league's brand.

### 14.2 Colour

| Token | Value | Use |
|---|---|---|
| `--pitch-void` | `#050706` | App background |
| `--pitch-900` | `#0B1210` | Surfaces |
| `--pitch-800` | `#111C18` | Raised surfaces, cards |
| `--pitch-700` | `#1A2B24` | Borders, dividers |
| `--turf-500` | `#0F7B4F` | Primary brand green |
| `--volt-400` | `#B4FF39` | Accent — CTAs, live indicators, #1 rank |
| `--volt-glow` | `rgba(180,255,57,0.35)` | Glow / focus rings |
| `--chalk` | `#F4F7F5` | Primary text |
| `--chalk-muted` | `#8A9691` | Secondary text |
| `--card-yellow` | `#FFC53D` | Yellow cards |
| `--card-red` | `#FF4D4D` | Red cards, destructive |
| `--assist-blue` | `#3DA9FC` | Assists, side A |

Volt is scarce by rule: at most one volt element per viewport region. Scarcity is what makes it read as important.

Light mode is **not** in V1 scope. The product is dark-native and says so.

### 14.3 Typography

Headings & UI — **Space Grotesk** (500/700). Numerals & scoreboards — **Bebas Neue**, tabular, tracked wide. Body — **Inter** (400/500).

Scale: display 72/64 · h1 40 · h2 30 · h3 22 · body 16 · small 14 · micro 12. Statistics use `font-variant-numeric: tabular-nums` everywhere so rankings never jitter during animation.

### 14.4 Layout and primitives

8px spacing grid. Radii: 8 (controls) / 16 (cards) / 24 (hero). Elevation via layered surfaces and glow, not soft grey shadows — shadows disappear on near-black backgrounds. Cards use a 1px `--pitch-700` border plus a subtle inner top highlight.

Component inventory: Button (primary/ghost/danger/icon) · Card · StatTile · PlayerAvatar · PlayerRow · RankBadge · Sheet (mobile) · Modal (desktop) · Tabs · Select · Toggle · Toast · Skeleton · EmptyState · PeriodSelector · ShareSheet · ActionGrid.

### 14.5 Accessibility

Text contrast ≥ 4.5:1 against its surface — verified, not assumed, for volt-on-dark. Every action reachable by keyboard with a visible volt focus ring. Colour never the sole carrier of meaning: cards use colour **and** a glyph. All motion respects `prefers-reduced-motion`, which disables Three.js scenes entirely and reduces transitions to opacity fades. Match-day targets ≥ 56px.

---

## 15. Animation system

### 15.1 Philosophy

If everything moves, nothing is important. Motion is reserved for moments that carry meaning: a goal, a rank change, an award, kick-off. Navigation and forms stay quick and quiet.

### 15.2 Tiers

**Tier 0 — Functional (everywhere).** 120–200ms opacity/transform transitions, spring-based sheets and modals, skeletons. Invisible by design.

**Tier 1 — Signature (the loop's key moments).**
- *Goal burst:* full-screen volt flash, "GOAL" in Bebas scaling up with a slight overshoot, scorer name and jersey sliding in, confetti of pitch-green particles. 1.4s, interruptible, skippable by tapping.
- *Stat count-up:* numbers ease from previous to new value over 800ms with a spring settle.
- *Leaderboard reorder:* FLIP-based row transitions, the moving row lifting with a glow trail as it changes rank. This is the single most satisfying interaction in the product and gets the most polish.
- *Kick-off countdown:* 3 · 2 · 1 · KICK OFF, each digit scaling and blurring out.
- *Undo toast:* a volt progress ring draining over 5 seconds.

**Tier 2 — Three.js (three scenes only, lazy-loaded, never blocking).**
1. Dashboard hero: a slowly rotating low-poly football with subtle pitch-line reflections, pointer-parallaxed.
2. Award reveal: a 3D trophy rising through volume light with particles as the Player of the Month is named.
3. Public page hero: a stylised stadium-light environment behind the crest.

Each scene is code-split, gated behind `prefers-reduced-motion`, capped at 30fps when idle, disabled on low-end devices via a `deviceMemory`/`hardwareConcurrency` check, and always has a static image fallback. **Three.js never renders inside match-day mode** — that screen's job is speed.

### 15.3 Performance budgets

Public page LCP < 2.0s on simulated 3G · initial JS ≤ 200KB gzipped excluding lazy chunks · Three.js chunks lazy only · 60fps on leaderboard reorder with 40 rows · match-day event write acknowledged in UI in < 100ms (optimistic).

---

## 16. Development roadmap

Each phase ends at a checkpoint that is demonstrable, not merely committed.

| Phase | Scope | Exit criterion |
|---|---|---|
| **0. Foundation** | Repo, Vite+TS+Tailwind, design tokens, component skeleton, Supabase project link, CI lint/typecheck | `npm run dev` renders a styled shell |
| **1. Database** | Full migration set, enums, indexes, constraints, seed award types, RLS deny-all | `supabase db push` succeeds on a clean project |
| **2. Backend foundation** | `shared/` utilities, router pattern, auth+guard middleware, response envelope, error mapping, one reference function deployed | A deployed function returns a correct envelope for auth'd and unauth'd calls |
| **3. Auth** | Register/login/verify/reset, profiles, session handling, protected routes | A new user can sign up, verify by email and reach onboarding |
| **4. Organization & onboarding** | Org creation, settings, slug, logo, 4-step onboarding, members/invites | A user goes from signup to a configured org in under two minutes |
| **5. Players** | Player CRUD, bulk add, photos, profile page | A 24-player squad can be entered in one sitting |
| **6. Sessions & matches** | Sessions, attendance, punctuality, match creation, side assignment | A session with two matches exists with correct rosters |
| **7. Match day mode** ⭐ | The fast recorder, goal/card/clean-sheet flows, undo, offline queue, timer | A full real Sunday session is recorded on a phone at the pitch without frustration |
| **8. Statistics engine** | Aggregation, `player_period_stats`, recompute-on-write, dashboard summary | Stats match a hand-count of a recorded session exactly |
| **9. Scoring & leaderboard** | Scoring rules UI, presets, points calculation, ranking, tie-breakers, leaderboard screen | Changing a weight visibly reorders the leaderboard correctly |
| **10. Periods & awards** | Period lifecycle, close procedure, rule snapshotting, Player of the Month, award history | August closes, a winner is recorded with a frozen breakdown, September opens |
| **11. Public page** | Slug routing, public read endpoints, public leaderboard/player/session views, share | A WhatsApp link opens a correct, fast, login-free page |
| **12. Polish** | Signature animations, Three.js scenes, empty/loading/error states, mobile pass, a11y pass | Performance budgets in §15.3 are met and measured |
| **13. Realtime** | Broadcast channel, live public page updates | A goal recorded pitch-side appears on another phone within 2 seconds |
| **14. Hardening & launch** | Rate limits, audit log, error tracking, backups, seed/demo org, docs | First real group runs a full month on it |

**Milestone that matters most:** Phase 7. If match-day recording isn't genuinely faster than a WhatsApp note, nothing after it matters.

---

## 17. Deployment

- **Frontend:** Vercel or Netlify. Preview per branch, production on `main`. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_FUNCTIONS_URL`.
- **Migrations:** versioned files in `supabase/migrations/`, applied with `supabase db push`. Never edit an applied migration; always add a new one.
- **Edge Functions:** `supabase functions deploy <name>`. Secrets via `supabase secrets set` — the service role key lives only in function secrets and never in the frontend.
- **Environments:** a separate Supabase project for staging is strongly recommended before real data exists on production `dzrklwoenqexwfypmvxg`.
- **Backups:** Supabase daily backups plus a weekly manual export of `match_events` — it is the irreplaceable table.
- **Observability:** Sentry on the frontend, structured logs with request ids in functions.

**Credential note:** the anon key is publishable by design and safe in the frontend bundle. The service role key must never appear in the React app, in the repo, or in a chat message. If a service key is ever pasted anywhere shared, rotate it immediately.

---

## 18. Testing strategy

- **Unit (Vitest):** the scoring engine, punctuality banding and tie-breakers — pure functions, exhaustively tested, including negative points and full ties.
- **Integration:** each Edge Function against a local Supabase — auth required, wrong-role rejected, cross-tenant returns 404, envelope shape correct, idempotency key prevents duplicates.
- **E2E (Playwright):** the golden path — signup → onboard → add players → run session → record events → view leaderboard → close period → open public link.
- **Manual field test:** the real thing. A real Sunday session recorded on a real phone, outdoors, on mobile data, by someone who is not the developer.
- **Data integrity check:** a scheduled job comparing `player_period_stats` against a fresh aggregation of `match_events`; any drift is an alert, because the cache must never disagree with the source of truth.

---

## 19. Decisions requiring your confirmation before Phase 1

1. **Product name and domain.** "The Turf Ball" is assumed from the directory name. Confirm or replace — it propagates into the slug format, email templates and branding.
2. **Clean-sheet policy default.** GK only, whole side, or manual selection?
3. **Guest players.** Should a one-off friend brought along count toward stats, or be recorded as a guest excluded from the leaderboard? (Spec currently supports a `guest` status; the default behaviour needs your call.)
4. **Voting in V1 or V1.1.** Spec defers it to V1.1. Confirm you're happy for the first month to run on objective statistics only.
5. **Staging project.** Approve creating a second Supabase project, or accept building directly against production.

---

## 20. The one architectural commitment

Everything in this document rests on a single decision: **`match_events` is the only source of truth, and every number the product shows is derived from it.**

No statistic is ever authored. No total is ever typed in. Adding "Best Defender", "Most Improved", "Golden Glove", a league table, or a second competition means adding an event type or a scoring rule — never a migration that redesigns the model.

That is what makes this a football competition engine rather than a Player of the Month tracker.
