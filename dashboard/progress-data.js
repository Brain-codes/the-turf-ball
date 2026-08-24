/* The Turf Ball — build progress data.
   Edit this file to update the dashboard. No build step, no server needed. */

window.PROGRESS = {
  project: "The Turf Ball",
  tagline: "Football stats & Player of the Month, automatically",
  updated: "24 Aug 2026",
  currentlyDoing: "MONTHS NOW CLOSE THEMSELVES, and every month now produces a full written round-up: who turned up on each date, everyone's goals/assists/clean sheets/appearances, the awards, every record broken, milestones passed, all-time top tens, and the finished WhatsApp message ready to copy. Built and passing every automated check. The database part has NOT been applied to your live project yet — you asked to run and test it yourself.",

  // status: "done" | "doing" | "todo" | "blocked"
  phases: [
    {
      id: 0,
      name: "Foundation",
      plain: "Setting up the empty shell of the app so there's something to build into.",
      status: "done",
      tasks: [
        { name: "Project folders and settings", plain: "Create the app skeleton so we can start adding screens.", tech: "Vite + React 19 + TypeScript + Tailwind 4, path aliases, ESLint config, .env.example.", status: "done" },
        { name: "The look and feel (colours, fonts)", plain: "Lock in the dark football-broadcast style so every screen matches.", tech: "CSS custom properties for the pitch/turf/volt palette, Space Grotesk + Bebas Neue + Inter loaded, Tailwind theme extension.", status: "done" },
        { name: "Reusable building blocks", plain: "Buttons, cards, stat tiles etc. built once and reused everywhere.", tech: "components/ui primitives: Button, Card, StatTile, PlayerAvatar, RankBadge, Sheet, Toast, Skeleton, EmptyState.", status: "done" },
        { name: "Connect to Supabase", plain: "Point the app at our database and login service.", tech: "Supabase client init with anon key, project link dzrklwoenqexwfypmvxg, functions base URL.", status: "done" }
      ]
    },
    {
      id: 1,
      name: "Database",
      plain: "Designing where every player, goal and assist actually gets stored.",
      status: "done",
      tasks: [
        { name: "All the data tables", plain: "The filing cabinets for organizations, players, sessions, matches and events.", tech: "Full migration: profiles, organizations, organization_members, players, seasons, periods, sessions, session_attendance, matches, match_players, match_events, scoring_rules, player_period_stats, award_types, awards, award_votes, public_pages, audit_log.", status: "done" },
        { name: "Safety rules on the data", plain: "Make sure one group can never see another group's players.", tech: "Row Level Security enabled deny-all on every table; Edge Functions use service role; tenant scoping enforced in handlers.", status: "done" },
        { name: "Starter data", plain: "Pre-load the list of award types so groups don't have to create them.", tech: "Seed award_types: player_of_month, golden_boot, playmaker, golden_glove, iron_man, most_punctual, fan_favourite.", status: "done" }
      ]
    },
    {
      id: 2,
      name: "Backend foundation",
      plain: "The shared plumbing every part of the backend will reuse.",
      status: "done",
      tasks: [
        { name: "Shared backend utilities", plain: "Common code so every part of the backend behaves the same way.", tech: "shared/: cors.ts, response.ts, auth.ts, guard.ts, validation.ts, db.ts, router.ts, errors.ts, log.ts.", status: "done" },
        { name: "Consistent replies", plain: "Every request gets an answer in exactly the same shape, success or failure.", tech: "Standard envelope { success, message, data, meta, errors } produced only by shared/response.ts per rule2.txt §7.", status: "done" },
        { name: "Permission checks", plain: "Verify who's asking and whether they're allowed, on every single request.", tech: "JWT verify -> resolve organization_members row -> role check -> tenant-scoped queries. 404-over-403 for cross-tenant.", status: "done" }
      ]
    },
    {
      id: 3,
      name: "Accounts & login",
      plain: "People can create an account and get in.",
      status: "done",
      tasks: [
        { name: "Sign up", plain: "Create an account with email and password.", tech: "auth Edge Function: creates auth.users + profiles atomically, rolls back on partial failure.", status: "done" },
        { name: "Email verification", plain: "Confirm the email address is real before letting people in.", tech: "Native Supabase confirm-email. No third-party mail provider (rule2.txt §14).", status: "done" },
        { name: "Log in, log out, forgot password", plain: "The everyday account actions.", tech: "Supabase Auth SDK directly — permitted for simple flows by rule2.txt §11.", status: "done" },
        { name: "Protected screens", plain: "Keep strangers out of the app pages.", tech: "Route guards + TanStack Query auth context, redirect to /login on 401.", status: "done" }
      ]
    },
    {
      id: 4,
      name: "Your football group",
      plain: "Setting up your group: name, crest, ground, playing day.",
      status: "done",
      tasks: [
        { name: "Create your group", plain: "Name it, add a crest, set where and when you play.", tech: "organizations Edge Function + slug uniqueness check + logo upload via signed URL.", status: "done" },
        { name: "Quick setup walkthrough", plain: "SUPERSEDED — see phase 18. This version only captured names, no photos, no self-serve invite, and only one playing time. Kept here for history, not the current build.", tech: "Old: 5-step onboarding (organization, single-shared-time schedule step, bulk-names-only players, scoring preset, done + share link).", status: "done" },
        { name: "Group settings", plain: "Change anything later without starting over.", tech: "Settings screens: general, football, scoring, public page, members, account.", status: "done" },
        { name: "Invite helpers", plain: "Let a friend help record goals on match day.", tech: "members function, invite tokens, roles owner/admin/recorder.", status: "done" }
      ]
    },
    {
      id: 5,
      name: "Your squad",
      plain: "Adding the players who turn up every week.",
      status: "done",
      tasks: [
        { name: "Add and edit players", plain: "Name, shirt number, position, photo.", tech: "players Edge Function CRUD, soft delete via status, jersey uniqueness per org.", status: "done" },
        { name: "Add a whole squad fast", plain: "Type names one after another instead of filling a form each time.", tech: "POST /players/bulk accepting a names array.", status: "done" },
        { name: "Player profile page", plain: "One page per player showing their goals, assists and form.", tech: "Player detail with per-period stats, recent form strip, award history.", status: "done" }
      ]
    },
    {
      id: 6,
      name: "Match days & games",
      plain: "Setting up a Sunday session and the games within it.",
      status: "done",
      tasks: [
        { name: "Create a session", plain: "Set up this Sunday's football.", tech: "sessions Edge Function, auto-attach to the open period.", status: "done" },
        { name: "Who turned up, and when", plain: "Tick off who came, and record arrival time for punctuality.", tech: "session_attendance with arrived_at, punctuality band computed against kickoff_at.", status: "done" },
        { name: "Split into sides", plain: "Put the players who showed up into two teams.", tech: "matches + match_players with side a/b, auto-split helper.", status: "done" }
      ]
    },
    {
      id: 7,
      name: "Match day recorder",
      plain: "The big one — tapping in goals on your phone at the pitch, fast.",
      status: "done",
      starred: true,
      tasks: [
        { name: "Record a goal in three taps", plain: "Goal, who scored, who assisted. Done.", tech: "ActionGrid -> player grid -> assist/none, optimistic write, auto-confirm.", status: "done" },
        { name: "Cards and clean sheets", plain: "Yellows, reds, and who kept a clean sheet.", tech: "Card flow 2 taps; clean sheets offered at match finish per org policy.", status: "done" },
        { name: "Undo mistakes", plain: "Tapped the wrong player? Undo it straight away.", tech: "5s undo toast with draining ring; server-side void (voided_at), never hard delete.", status: "done" },
        { name: "Works with bad signal", plain: "Keep recording even when the network drops at the pitch.", tech: "IndexedDB offline queue with client_key idempotency, flush on reconnect, unique index prevents double-count.", status: "done" },
        { name: "Match clock", plain: "Start, pause and stop the game timer.", tech: "Match started_at/ended_at, client timer with server reconciliation.", status: "done" }
      ]
    },
    {
      id: 8,
      name: "Working out the stats",
      plain: "Turning everything tapped in into goals, assists and appearance counts.",
      status: "done",
      tasks: [
        { name: "Count everything up", plain: "Add up each player's goals, assists, clean sheets and appearances.", tech: "Aggregate match_events (excluding voided) into player_period_stats, recompute on write.", status: "done" },
        { name: "Punctuality scoring", plain: "Reward the people who actually show up on time.", tech: "Bands early/on_time/late/very_late with configurable windows and points.", status: "done" },
        { name: "Dashboard numbers", plain: "The headline figures on your home screen.", tech: "GET /stats/dashboard: totals, top performers, recent sessions.", status: "done" }
      ]
    },
    {
      id: 9,
      name: "Points & league table",
      plain: "Deciding how much a goal is worth, and ranking everyone.",
      status: "done",
      tasks: [
        { name: "Set your own rules", plain: "You decide: is a goal worth 5 points or 3? Your group, your rules.", tech: "scoring_rules per org, three presets, no weights hard-coded anywhere in app code.", status: "done" },
        { name: "The league table", plain: "Everyone ranked by points, updating as you record.", tech: "Leaderboard with FLIP reorder animation, points breakdown on tap.", status: "done" },
        { name: "Settling ties", plain: "If two players are level, a fair and consistent way to separate them.", tech: "Ordered tie-breakers: points, goals, assists, fewer cards, appearances, punctuality, joined_at.", status: "done" }
      ]
    },
    {
      id: 10,
      name: "Player of the Month",
      plain: "Closing off the month and crowning a winner.",
      status: "done",
      tasks: [
        { name: "Monthly cycle", plain: "Each month is its own competition, and old months are kept forever.", tech: "periods table, exactly one open per org via partial unique index.", status: "done" },
        { name: "Close the month", plain: "Lock in the results so they can never change later.", tech: "Transactional close: snapshot scoring rules to period scope, recompute, rank, insert awards with frozen breakdown, open next period.", status: "done" },
        { name: "Award history", plain: "A permanent record of every past winner.", tech: "awards table with breakdown jsonb, surfaced on player profiles.", status: "done" }
      ]
    },
    {
      id: 11,
      name: "The share link",
      plain: "One link you drop in the WhatsApp group so everyone can see the table.",
      status: "done",
      tasks: [
        { name: "Public page", plain: "A page anyone can open — no account, no app install.", tech: "/t/:slug, public Edge Function reads only, no auth required.", status: "done" },
        { name: "Loads fast on mobile data", plain: "Opens quickly even on a slow connection.", tech: "Pre-rendered public shell, LCP target under 2s on simulated 3G, JS budget 200KB gzipped.", status: "done" },
        { name: "Share buttons", plain: "Copy the link, or share a single player's card.", tech: "Web Share API with clipboard fallback.", status: "done" }
      ]
    },
    {
      id: 12,
      name: "Making it beautiful",
      plain: "The goal celebrations, the animations, the polish.",
      status: "doing",
      tasks: [
        { name: "Goal celebration", plain: "A proper moment when someone scores.", tech: "Full-screen volt flash, Bebas GOAL scale-in with overshoot, particle burst, 1.4s interruptible.", status: "done" },
        { name: "Table movement", plain: "Watch players climb the rankings.", tech: "FLIP-based row transitions with glow trail, 60fps at 40 rows.", status: "done" },
        { name: "3D moments", plain: "A rotating ball and a trophy reveal for the winner.", tech: "React Three Fiber, 3 lazy-loaded scenes only, gated on prefers-reduced-motion and device capability.", status: "todo" },
        { name: "Works well on phones", plain: "Big tap targets, readable in sunlight, one-handed.", tech: "56px minimum targets in match day, contrast >= 4.5:1 verified, full keyboard nav.", status: "done" }
      ]
    },
    {
      id: 13,
      name: "Live updates",
      plain: "Goals appearing on everyone's phone the moment they're recorded.",
      status: "todo",
      tasks: [
        { name: "Live public page", plain: "The group sees the table update without refreshing.", tech: "Supabase Realtime broadcast channel as notification bus, client re-fetches via Edge Function — never subscribes to tables (rule2.txt §1).", status: "todo" }
      ]
    },
    {
      id: 14,
      name: "Ready for real use",
      plain: "Final checks before your group actually uses it.",
      status: "doing",
      tasks: [
        { name: "Guard against abuse", plain: "Stop anyone hammering or breaking the system.", tech: "Rate limiting on public + auth endpoints, request size caps.", status: "todo" },
        { name: "Record of changes", plain: "A trail of who changed what, for settling disputes.", tech: "audit_log writes on destructive and administrative actions.", status: "todo" },
        { name: "Demo data", plain: "A sample group so you can see it full of data immediately.", tech: "Seed script generating an org with 20 players and 4 played sessions.", status: "done" },
        { name: "Deployment notes", plain: "Clear instructions for pushing it live.", tech: "README with supabase db push, functions deploy list, env vars, Vercel config.", status: "done" }
      ]
    },
    {
      id: 15,
      name: "Changes from using it",
      plain: "Things we're fixing now that you're actually in the app.",
      status: "doing",
      tasks: [
        { name: "Flexible session times", plain: "Set up as many regular playing times as you want — different days, or the same day twice for a morning and an evening game. Change them any time.", tech: "New session_slots table (weekday 0-6 + time + optional label/venue), upcoming_slots() function resolving the next real dates in the org timezone, CRUD under /organizations/:id/slots, Schedule settings tab, one-tap booking on the new-session screen. Old single playing_day + default_kickoff backfilled into slots automatically.", status: "done" },
        { name: "Pick your days during setup", plain: "SUPERSEDED — see phase 18. That version only let you set one shared kickoff time for every day picked, no separate finish time. Replaced by the full multi-day, multi-time schedule step.", tech: "Old: single weekday+kickoff-only editor posting to /organizations/:id/slots.", status: "done" }
      ]
    },
    {
      id: 16,
      name: "Sessions that run themselves",
      plain: "You should never have to create a session by hand. It knows when you play, so it just starts.",
      status: "done",
      starred: true,
      tasks: [
        { name: "Sessions start on their own", plain: "Because you set your playing times during setup, the session appears and goes live by itself at 5pm on Wednesday. No tapping 'new session' every week.", tech: "materialize_and_flag_sessions() Postgres function on a pg_cron schedule (every 15 minutes) creates real sessions rows from session_slots via upcoming_slots(), then flips scheduled -> live at kick-off. Live-tested by running the function directly against the production database — completed with no errors.", status: "done" },
        { name: "Empty sessions get flagged, not counted", plain: "If a session comes and goes with nobody marked present and nothing recorded, it gets flagged as inactive. It shows on your dashboard so you know it happened, but it does not count towards any of your records or totals.", tech: "Same scheduled function sets flagged_inactive_at once a session passes its end time (kickoff + slot duration, or 90 minutes for one-offs) with zero present attendance and zero matches. Excluded from session counts in stats/dashboard.ts and both counting sites in public/publicPage.ts. Player stats are unaffected either way — an empty session has no matches or events to contribute.", status: "done" },
        { name: "Approve a flagged session to make it count", plain: "Played but forgot to record it? Approve the flagged session and it joins your records like any other.", tech: "New POST /sessions/:id/approve (admin-only) sets approved_at + approved_by. Counted rule NOT (flagged_inactive_at IS NOT NULL AND approved_at IS NULL) applied everywhere sessions are aggregated. Sessions screen shows a badge and an 'Approve anyway' button for admins.", status: "done" },
        { name: "Countdown to the next session", plain: "Your sessions page shows the next one with time remaining — '2 hours remaining', '5 hours remaining' — or the date if it is further off.", tech: "Sessions screen now shows a banner for the soonest scheduled/live session with a countdown that ticks every 30s, falling back to a formatted date beyond 24 hours.", status: "done" },
        { name: "Change the time whenever it changes", plain: "Moved from 5pm to 6pm? Now playing Tuesdays and Thursdays? Change it in settings and future sessions follow.", tech: "Already possible in Settings → Schedule; the scheduled job re-reads session_slots on every run, so newly materialised sessions always follow the current schedule.", status: "done" },
        { name: "Live session view starts with who came", plain: "When a session goes live it opens full screen, starting with the squad list so you tap who turned up — then flows straight into recording goals, like a live match page.", tech: "Attendance moved from the session detail screen into MatchDay.tsx as its first step. A session still marked 'scheduled' opens into an attendance tick-list; confirming it saves attendance, starts the session, and falls through into team picking / recording — the existing recorder, scoreboard, clock, undo and offline queue are unchanged.", status: "done" }
      ]
    },
    {
      id: 17,
      name: "Deleting your account",
      plain: "You can delete your account, change your mind within 30 days, and get it back.",
      status: "done",
      tasks: [
        { name: "Delete my account", plain: "A way to delete your account from settings, with a clear warning about what happens.", tech: "New Account tab in Settings. Two-step: GET /auth/delete-account previews the group(s) you own (name, player count, session count, other members affected), POST /auth/delete-account?confirm=true soft-deletes profile + owned organizations with the same timestamp.", status: "done" },
        { name: "30 days to change your mind", plain: "Told clearly that it clears in 30 days. Log back in before then and it comes back exactly as it was.", tech: "GET /auth/me (called on every app boot) checks deleted_at: within 30 days it clears deleted_at on the profile and any organizations deleted at that same moment, and login proceeds normally. Past 30 days it returns 403 and the frontend signs the session out — decided to treat this as 'account does not exist' since the daily purge job should have already removed it for real.", status: "done" },
        { name: "Warn clearly before deleting your group", plain: "DECIDED: deleting your account deletes your football group too — but only after showing you exactly what you are about to lose. It names the group, the number of players and sessions, and warns that anyone you invited loses access.", tech: "Preview step lists every owned group with player/session/other-member counts before the destructive confirm. During the 30-day window the group is hidden from everyone (requireMember, /auth/me and the public page all filter organizations.deleted_at IS NULL) but not destroyed. A daily pg_cron job (purge_deleted_accounts()) hard-deletes anything whose grace period has expired — live-tested against the production database.", status: "done" }
      ]
    },
    {
      id: 18,
      name: "Onboarding rebuilt (setback)",
      plain: "You tried the setup walkthrough from phase 4/15 and said it wasn't enough. This is not a small tweak — it's a rebuild of the whole thing into a proper 4-step wizard. Logging it as a setback, not quietly overwriting the old 'done' status above, because real time was spent on a version that didn't hold up once you actually used it.",
      status: "done",
      starred: true,
      tasks: [
        { name: "Step 1 — Your group", plain: "Unchanged: name, format, where you play.", tech: "Same as before — organizations POST.", status: "done" },
        { name: "Step 2 — Real schedule, not just one time", plain: "Pick every day you play, then either one kick-off/finish time for all of them, or a different one per day — e.g. Tuesday and Thursday 6-8pm exactly like your own team.", tech: "Multi-day picker + shared-or-per-day kickoff+finish inputs. Duration is computed from the gap between kick-off and finish and sent as duration_minutes to the existing /organizations/:id/slots endpoint — no schema change needed, that column already existed.", status: "done" },
        { name: "Step 3 — Add players two ways", plain: "Add players yourself with a name, kit name, preferred foot and a photo — or copy a link and let players add themselves. You approve each one before they count.", tech: "Manual add: players POST with photo_base64, uploaded server-side to a new player-photos Storage bucket (public-read, no client-facing write policies — uploads only ever happen through the service-role key inside an Edge Function, never direct from the browser). Self-serve: new unauthenticated POST /public/:slug/join creates a players row with status='pending' (new enum value). Admin sees a live pending queue right there in onboarding with Approve/Reject buttons.", status: "done" },
        { name: "Step 4 — Review, then straight to the dashboard", plain: "A summary screen: your next session with a countdown, how many players are ready, your share link. No further setup needed once you land on the dashboard.", tech: "My call on what step 4 should contain, since you said you weren't sure — a review/confirm screen reading from the existing /organizations/:id/slots/upcoming endpoint for the next-session preview, so it doesn't depend on the (separately reported, not-yet-investigated) session auto-start issue you mentioned.", status: "done" },
        { name: "Approve or reject a self-added player", plain: "New pending-players queue, usable from onboarding and later from Settings.", tech: "POST /players/:id/approve sets status='active'. POST /players/:id/reject DELETES the row (my call: a rejected self-submission was never a real roster member — no attendance or events reference it yet — so there's nothing worth keeping, unlike 'inactive' which is for someone who WAS active and stopped playing).", status: "done" }
      ]
    },
    {
      id: 19,
      name: "Months close themselves + the full monthly round-up",
      plain: "You said you don't want to be closing the month by hand, and that every month should produce a proper breakdown like the one your group posts in WhatsApp. Both are built.",
      status: "done",
      starred: true,
      tasks: [
        { name: "The month closes on its own", plain: "Once the month is over, the app locks it, crowns Player of the Month and opens the new month by itself. You can still close early if you're finished, and you can turn the whole thing off in Settings.", tech: "New auto_close_due_periods() Postgres function on an hourly pg_cron job. It works out today's date in your group's own timezone, waits the grace days you set (default 1, so it closes on the 2nd), then calls the existing close_period(). Settings gained auto_close_months and auto_close_grace_days.", status: "done" },
        { name: "An unfinished session holds the month open", plain: "If a session is still live or paused, the month waits rather than locking someone's half-recorded game into a closed month. The Awards screen tells you that's why, and it closes itself as soon as you finish that session.", tech: "The job checks for sessions with status live/paused, writes auto_close_blocked_reason onto the period and retries on the next run. The manual close was also tightened to block on paused, matching the preview screen which already did.", status: "done" },
        { name: "Records that break records", plain: "The app now knows its own history. Most goals in a month, most assists, most clean sheets, most appearances, most points — when someone beats the old mark, it says so, names who held it before, and with what.", tech: "build_period_report() compares this month's best against every previous month, per metric, and emits a record entry with the previous holder, their value, apps and month.", status: "done" },
        { name: "Milestones and firsts", plain: "50 appearances, 100 goal contributions, 50 assists — the app spots when someone crosses one, and says 'first player ever to' when nobody had reached it before.", tech: "Career totals are computed before and after the month; crossing a threshold emits a milestone, flagged first_ever when no other player had reached that number previously. Also detects the top-scorer-and-top-assister double.", status: "done" },
        { name: "The whole month, written out", plain: "A 'Full breakdown' tab on the Awards page: attendance for every single date, who never missed one, everyone's numbers, the awards, past Players of the Month, most nominated, all-time top tens, and every member's career totals.", tech: "New GET /periods/:id/report. A closed month serves a frozen copy stored at close time so the numbers can never drift; an open month is built live and clearly marked as still to play for.", status: "done" },
        { name: "The WhatsApp message, ready to paste", plain: "The round-up your group already posts, written for you — headline records, the awards, and the goals/assists/apps list. One button copies it.", tech: "Headlines are generated in plain English in the database, so the same wording appears in the app, in the copied message, and anywhere else the report is read.", status: "done" }
      ]
    }
  ],

  log: [
    { time: "16 Aug 2026", text: "Project specification written and locked (SPEC.md).", kind: "done" },
    { time: "16 Aug 2026", text: "Progress dashboard created — this page.", kind: "done" },
    { time: "16 Aug 2026", text: "App skeleton created and libraries installed.", kind: "done" },
    { time: "16 Aug 2026", text: "Colours, fonts and the dark football look locked in.", kind: "done" },
    { time: "16 Aug 2026", text: "Full database designed — 19 tables covering players, sessions, matches and every recorded event.", kind: "done" },
    { time: "16 Aug 2026", text: "Points engine written: counts up stats, applies your scoring rules, ranks players, settles ties.", kind: "done" },
    { time: "16 Aug 2026", text: "TESTED: ran a fake Sunday session through it end to end — 3 players, 2 goals, an assist, a card, a clean sheet. Every number came out exactly right, including undoing a goal and closing the month with awards. Nothing is guesswork here.", kind: "done" },
    { time: "16 Aug 2026", text: "Backend built: 12 services covering accounts, groups, players, sessions, matches, goal recording, stats, scoring, months, awards, helpers and the public share page.", kind: "done" },
    { time: "16 Aug 2026", text: "Goal recording handles bad signal — if your phone drops the network mid-session, goals queue up and sync later without ever being counted twice.", kind: "done" },
    { time: "16 Aug 2026", text: "CHECKED: every backend service passed a full code check with zero errors.", kind: "done" },
    { time: "16 Aug 2026", text: "All the screens built: sign up, setup walkthrough, home, squad, sessions, match day recorder, league table, awards, settings, and the public share page.", kind: "done" },
    { time: "16 Aug 2026", text: "Goal celebration, count-up numbers and the league table sliding when someone changes position — all in.", kind: "done" },
    { time: "16 Aug 2026", text: "Made the share page load light: it no longer downloads the whole organizer app just to show a table. Roughly 150KB instead of 220KB.", kind: "done" },
    { time: "16 Aug 2026", text: "CHECKED: the app builds and runs, opens in a browser with no errors.", kind: "done" },
    { time: "16 Aug 2026", text: "Demo data script written and tested — creates a sample group with 20 players and four Sundays already played.", kind: "done" },
    { time: "16 Aug 2026", text: "Deployment instructions written in README.md. Ready for you to push and deploy.", kind: "done" },
    { time: "16 Aug 2026", text: "SETBACK: the first push reported \"database is up to date\" but had actually done nothing — it was run from the wrong folder and was looking at an empty directory. Fixed the folder layout; no data was affected.", kind: "issue" },
    { time: "16 Aug 2026", text: "DATABASE IS LIVE. Both migrations applied to your real Supabase project and confirmed present on the remote.", kind: "done" },
    { time: "16 Aug 2026", text: "SETBACK: first attempt to deploy the backend failed. My fault — I had changed how one library was referenced to satisfy a code-style check, and Supabase's builder could not resolve it. Reverted and turned the style rule off instead.", kind: "issue" },
    { time: "16 Aug 2026", text: "BACKEND IS LIVE. All 12 services deployed.", kind: "done" },
    { time: "16 Aug 2026", text: "CAUGHT A REAL BUG before you hit it: Supabase rejects any request that does not carry a key, including the public share page and sign-up. Both would have failed instantly for everyone. Fixed and redeployed.", kind: "issue" },
    { time: "16 Aug 2026", text: "Tidied error messages — forms now say \"Your name must be at least 2 characters\" instead of \"full_name must be at least 2 characters\".", kind: "done" },
    { time: "16 Aug 2026", text: "TESTED LIVE: signed-out access is refused, missing pages return the right error, bad sign-ups are rejected field by field. Everything answering correctly.", kind: "done" },
    { time: "16 Aug 2026", text: "YOU ASKED: session times were locked to one day at one time, with no way to change them after setup. Now you can add as many as you play — Sunday morning AND Sunday evening, plus a Tuesday, whatever you want. Live now under Settings → Schedule.", kind: "done" },
    { time: "16 Aug 2026", text: "Good news on that one: the database already allowed several sessions in a single day, so nothing you have recorded needed changing. Your existing Sunday time was carried over automatically.", kind: "note" },
    { time: "16 Aug 2026", text: "You confirmed email verification is working.", kind: "done" },
    { time: "16 Aug 2026", text: "NEW REQUESTS ADDED: sessions that start themselves with a countdown, attendance inside the live view, a fuller setup walkthrough, and account deletion with 30 days to change your mind. Progress dropped because the finish line moved, not because anything broke.", kind: "note" },
    { time: "16 Aug 2026", text: "Wrote HANDOFF.md so a fresh session can pick this up without re-reading everything, and added a /handoff command to regenerate it any time.", kind: "done" },
    { time: "16 Aug 2026", text: "YOU DECIDED: deleting your account also deletes your football group, but only after a clear warning naming the group and everything in it.", kind: "note" },
    { time: "16 Aug 2026", text: "YOU DECIDED: sessions get created automatically in advance. If one passes with nobody present and nothing recorded, it is flagged as inactive and left out of your records — but still shown so you know it happened, and you can approve it to make it count. Better than either option offered.", kind: "note" },
    { time: "16 Aug 2026", text: "ALL FOUR REQUESTS BUILT: account deletion with a 30-day undo window, a fuller setup walkthrough that lets you add every playing time up front, sessions that create and start themselves with a countdown, and the live view now opens straight into 'who came?' before recording.", kind: "done" },
    { time: "16 Aug 2026", text: "Two new database migrations pushed to your real project and confirmed present on the remote — one for account deletion, one for self-starting sessions. Both schedule a daily/15-minute background job using pg_cron, which turned out to be available on your project.", kind: "done" },
    { time: "16 Aug 2026", text: "SETBACK: the first version of the session-scheduling function had a SQL mistake (a table reference Postgres doesn't allow inside an UPDATE). Caught it by running the function directly against your live database rather than assuming it worked — fixed with a follow-up migration and re-verified.", kind: "issue" },
    { time: "16 Aug 2026", text: "TESTED LIVE: ran both new background jobs directly against your production database. The account-purge job ran cleanly. The session scheduler ran cleanly after the fix above — no sessions were created in that run because there were no upcoming regular playing times to materialise from at the time.", kind: "done" },
    { time: "16 Aug 2026", text: "CHECKED: all 12 backend services still pass a full code check with zero errors, and the changed ones (accounts, groups, sessions, stats, the public page) were redeployed.", kind: "done" },
    { time: "16 Aug 2026", text: "CHECKED: the app builds and type-checks clean with the new Account settings tab, the multi-time setup step, and the reworked sessions and live-recording screens.", kind: "done" },
    { time: "16 Aug 2026", text: "SETBACK: you personally tested the setup walkthrough and said it wasn't enough — one shared time only, no end time, players by name only, no way for players to add themselves. Logging this honestly rather than quietly marking it 'done' still.", kind: "issue" },
    { time: "16 Aug 2026", text: "Rebuilt onboarding as a proper 4-step wizard: real multi-day/multi-time schedule (matching your own Tue/Thu 6-8pm team), manual player add with photo/foot/kit-name, a self-serve invite link, and a review screen before the dashboard.", kind: "done" },
    { time: "16 Aug 2026", text: "New database change: players can now be 'pending' (self-submitted, awaiting approval), and a new player-photos storage area was created for headshots — uploads always go through the backend, never straight from the browser, same rule as everything else in this app.", kind: "done" },
    { time: "16 Aug 2026", text: "New approve/reject buttons for self-added players — approving makes them a real squad member, rejecting removes the request entirely since it was never a real player yet.", kind: "done" },
    { time: "16 Aug 2026", text: "CHECKED: the new database change applied to your real project and confirmed present. The new backend endpoints and the storage area were tested directly against the live project (correct pass/fail responses, bucket confirmed to exist).", kind: "done" },
    { time: "16 Aug 2026", text: "CHECKED: all 12 backend services still pass a full code check, and the app still builds and type-checks clean with the new onboarding.", kind: "done" },
    { time: "16 Aug 2026", text: "NOT YET DONE: the new onboarding has not been clicked through in a browser by a human — see blockers.", kind: "note" },
    { time: "17 Aug 2026", text: "SETBACK, YOU FOUND IT BY TESTING: on the live match-day screen, tapping a squad member in the \"Someone just arrived\" search did nothing, and adding a brand-new name gave no confirmation it worked.", kind: "issue" },
    { time: "17 Aug 2026", text: "Fixed: adding a player now shows a clear success message (\"X added to the pitch\") or, if the save actually failed, a real error message — instead of silently closing the sheet either way. Also added a new \"Squad\" button on the live screen so you can see everyone at a glance: who's present, who isn't, with a one-tap \"+ Add\" next to anyone not yet on the pitch. The \"+ Add player\" button is still there too. Passed the type/build checks; not yet clicked through by you.", kind: "done" },
    { time: "17 Aug 2026", text: "FOUND BY YOU, TESTING: the error message above surfaced the real bug — adding a latecomer was hitting a genuine 404. The app was asking the server to update the match roster the wrong way (POST instead of PATCH), so the server never recognised the request. Fixed by matching the request to how the server actually expects it. This was the true cause of \"tapping does nothing\" — not yet re-tested by you.", kind: "issue" },
    { time: "17 Aug 2026", text: "SETBACK, YOU CAUGHT IT: an appearance was being counted once per MATCH, not once per SESSION — so going to full time and starting a new match on the same day (same players, same pitch time) doubled a player's appearance count for one day's play. Fixed: appearances now count once per session, no matter how many times a match is restarted within it. Applied to the live database AND run for real — you ran it yourself against all 3 open periods, no errors.", kind: "done" },
    { time: "17 Aug 2026", text: "Removed the \"red team / blue team\" language everywhere it showed up — match screens now just say things like \"Match #3 — 4 goals\" instead of \"Blue 4 - 1 Red\". You're not running two-team matches, just tracking one squad's playing time, so the display now matches that. Nothing about how points are scored changed. Passed all automated checks; not yet clicked through by you.", kind: "done" },
    { time: "17 Aug 2026", text: "YOUR CALL, ASKED DIRECTLY: a session is now one continuous activity, not a series of separate matches. Hitting \"Full time\" and coming back used to start everything over — clock at zero, goals at zero — even though it's the same group of people carrying on the same day. Now \"Full time\" just pauses; hitting Resume picks up the exact same clock and goal count where you left off. You chose this over the lighter option (adding up totals from separate matches) and asked to leave finer live-session settings for later. Passed all automated checks; not yet clicked through by you.", kind: "done" },
    { time: "17 Aug 2026", text: "FIXED YOUR TWO ACTUAL LIVE SESSIONS: both of your current sessions had already split into 3 pieces before today's fix went in. Merged each one back into a single activity directly in the real database — checked afterward and confirmed every player now shows exactly 1 appearance with their full day's goals added up (11 goals total per session, correctly combined), instead of being split across 3 separate records. Nothing else in the database was in this state, so this was the only cleanup needed.", kind: "done" },
    { time: "17 Aug 2026", text: "You said a lot of people don't recognise the name on the roster, but do know each other by WhatsApp name — so now every player's WhatsApp nickname shows up in small, faint text wherever their name appears: the squad list, match-day recording, the leaderboard, awards, the public share page, everywhere. It only shows if a nickname was actually set and it's different from the roster name. This was already something you could type in when adding a player, it just wasn't being shown anywhere until now. Passed all automated checks; not yet clicked through by you.", kind: "done" },
    { time: "17 Aug 2026", text: "FOUR CHANGES TO LIVE SESSIONS, built in the order you asked: (1) a 5-hour window after a session ends where you can now fix a missed goal, add a forgotten assist, correct who scored, or remove a wrongly-recorded card — every correction is logged so it's clear what was recorded live versus fixed afterward. After 5 hours it locks for good. (2) A session that's gone quiet past its scheduled end time now checks in — \"still going?\" if you're still on the screen, otherwise it just wraps up on its own instead of sitting live forever or getting force-closed on you. (3) Punctuality is now judged against when the session actually kicked off, not the scheduled time — if your group always starts 20 minutes late, nobody gets unfairly marked late for showing up when everyone else did. (4) The session detail page now shows the real timeline: how late it started, how long it actually ran, any overtime. Passed all automated checks and the database function was run for real with no errors; none of the four has been exercised end to end by a human yet — this is the biggest untested piece shipped so far, worth going through carefully.", kind: "done" },
    { time: "17 Aug 2026", text: "PUBLIC LIVE TRACKING: anyone with your public share link — no login needed — now sees a pulsating \"LIVE\" banner whenever a session is in progress. Tapping it opens a watch-only tracker: running goal count and a live activity feed, refreshing automatically every few seconds, with each player's name tapping through to their profile. Nothing on it can be clicked to change anything — pure spectator view, exactly as asked. Tested directly against the real database with a real live session and it returned correct data; not yet opened in an actual browser.", kind: "done" },
    { time: "17 Aug 2026", text: "Upgraded that guest live tracker to match your own organizer view: full stat board (goals, assists, own goals, yellow/red cards), top scorer and top assist cards, a real running match clock, WhatsApp nicknames showing throughout, and a small animated ball drifting across a pitch strip while the session is live, just for atmosphere. All done on the screen side — the data was already available from the round before. Build passes clean; not yet opened in a browser.", kind: "done" },
    { time: "17 Aug 2026", text: "REBUILT THE ANIMATION: you pointed at a real lineup-graphic image and said the first attempt was too plain. Now it's a full tilted pitch (like looking at a broadcast lineup graphic) with two teams' worth of dots in formation, and a ball actually bouncing between them — left, right, forward, back, growing and shrinking with a matching shadow to fake height as it moves. This one I actually opened and looked at myself before calling it done — the pitch, the tilt, both teams, and the bounce all render correctly on a phone-width screen against your real live session data.", kind: "done" },
    { time: "17 Aug 2026", text: "Made the pitch animation fully random and added a hide button: the ball's speed now varies hop to hop instead of a fixed pace, it can bounce to any of all 22 players in any order (not a repeating path), and the formation itself is mixed/shuffled differently every time the page loads rather than always the same lineup shape. Added a \"Hide pitch\" toggle for anyone who'd rather just see the numbers. Checked in the browser again — the mixed formation, the collapse toggle, and no console errors all confirmed against your real live session.", kind: "done" },
    { time: "17 Aug 2026", text: "The formation now actually changes while you watch — every 15-ish seconds the players drift to new spots, sliding smoothly rather than popping or vanishing and reappearing. Passed the build check; you asked to check this one yourself rather than have it previewed here.", kind: "done" },
    { time: "17 Aug 2026", text: "REBUILT THE SESSION SUMMARY PAGE — you called the old one trash and you were right. Reordered it so the short stuff (matches, timeline, correcting the record) comes before the potentially-huge \"who turned up\" list, not after — no more scrolling past 500 names to fix a goal. Everything long is now collapsible, showing 5 at a time with \"view all\". And the correcting-the-record screen is a proper modal now, not cramped inline dropdowns. The bigger fix: an assist can never exist by itself anymore — it's always attached to a specific goal, exactly how you described it. Editing a goal is now the one place you assign, change, or remove its assist; adding a new goal lets you add the assist right there in the same step. Removing a goal takes its assist with it; removing just the assist leaves the goal standing on its own. All checks pass and the backend is live; you're checking this one yourself.", kind: "done" },
    { time: "24 Aug 2026", text: "YOU ASKED FOR TWO THINGS: no more closing the month by hand, and a proper monthly breakdown like the one your group posts. Both built. The month now locks itself, crowns Player of the Month and opens the next one, a day after the month ends (you can change that wait, close early, or switch it off entirely in Settings). If a session is still live or paused, it waits and tells you why on the Awards screen rather than locking someone's half-recorded game away.", kind: "done" },
    { time: "24 Aug 2026", text: "THE APP NOW KNOWS ITS OWN HISTORY. Every month it works out which records fell — most goals, assists, clean sheets, appearances and points in a single month — names who held the record before and with what, and spots milestones like a 50th appearance or a 100th goal contribution, saying 'first player ever' when nobody had got there before. There's a new 'Full breakdown' tab on the Awards page with attendance for every date, who never missed one, everyone's numbers, past winners, most nominated, all-time top tens, and a copy button that hands you the finished WhatsApp message.", kind: "done" },
    { time: "24 Aug 2026", text: "HOW THE NUMBERS ARE KEPT HONEST: a closed month's report is frozen the moment it closes, so it can never quietly change afterwards. An open month is worked out fresh each time you look and is clearly labelled as still to play for. Reopening a month throws its old report away rather than leaving a stale one lying around.", kind: "note" },
    { time: "24 Aug 2026", text: "NOT DONE, BEING HONEST: the new database changes have NOT been applied to your live project — you told me to stop and that you'd run and test it yourself. Until you push that migration, nothing above is active on your real data. The app side passes every type and build check, and the backend passes its code check.", kind: "issue" },
    { time: "24 Aug 2026", text: "NOT INCLUDED, ON PURPOSE: the money side of your club report — subscriptions, walk-ins, card fines, expenses, closing balance. The app has no financial records in it at all, so that half would be a separate feature rather than something I could generate from what's already there. Say the word if you want it.", kind: "note" }
  ],

  blockers: [
    "The automatic month-closing and the full monthly breakdown are built but NOT applied to your live database yet — you asked to run the migration and test it yourself. Nothing about them is active until that push happens.",
    "Not yet tried by a human: recording an actual goal on match day, opening the public share link, deleting an account and logging back in to undo it, and the new attendance-first live view. All are built, deployed and pass every automated check, but none has been driven by a real person yet.",
    "The live-view \"add player\" fix and new Squad list (17 Aug) haven't been clicked through by you yet — you asked to test it yourself rather than have it driven for you.",
    "The rebuilt onboarding wizard — schedule step, manual player add with photo upload, the self-serve invite link, the approval queue, the review screen — is brand new and equally unproven by a human. It compiles, builds, and the new backend endpoints answer correctly when curled directly, but nobody has clicked through the actual wizard in a browser yet.",
    "There's a known session-scheduling issue mentioned but explicitly deferred — not investigated or touched as part of this rebuild, on purpose. Worth raising again when you're ready to look at it.",
    "The 30-days-past-purge login behaviour (treat as if the account never existed) was my call, not yet confirmed with you — see the open decisions below."
  ],

  decisions: [
    { q: "Product name", a: "The Turf Ball — used throughout. Say the word and I'll change it.", open: true },
    { q: "Clean sheets: goalkeeper only, or the whole defending side?", a: "Built as a setting — defaults to goalkeeper only, change it in Settings → Football", open: false },
    { q: "Do one-off guest players count on the leaderboard?", a: "Built as a setting — defaults to yes, toggle in Settings → Football", open: false },
    { q: "Voting for Player of the Month in the first version?", a: "No — first version ranks on statistics only", open: false },
    { q: "What happens if you try to log in more than 30 days after deleting your account?", a: "My call, not yet confirmed: treated as if the account no longer exists (blocked with a clear message), since the daily cleanup job should already have removed it for real by then.", open: true },
    { q: "What should the last onboarding step show?", a: "You said you weren't sure. My call: a review screen with the next session's countdown, squad size, and share link — confirms setup worked without adding another decision to make.", open: true },
    { q: "What happens when you reject a self-added player?", a: "My call: the request is deleted outright, not marked inactive — it was never a real roster member (no attendance/events reference it), so there's nothing worth keeping.", open: true }
  ]
};
