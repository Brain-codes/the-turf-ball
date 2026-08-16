/* The Turf Ball — build progress data.
   Edit this file to update the dashboard. No build step, no server needed. */

window.PROGRESS = {
  project: "The Turf Ball",
  tagline: "Football stats & Player of the Month, automatically",
  updated: "16 Aug 2026",
  currentlyDoing: "You are in the app. Fixing things as you find them — flexible session times just went live.",

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
        { name: "Quick setup walkthrough", plain: "A short guided setup, done in under two minutes.", tech: "4-step onboarding: organization, bulk players, scoring preset, done + share link.", status: "done" },
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
        { name: "Pick your days during setup", plain: "The setup walkthrough still only lets you choose one day. Needs to allow several.", tech: "Onboarding step 1 sends playing_days: [single]. Change to multi-select and create slots directly.", status: "todo" }
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
    { time: "16 Aug 2026", text: "Good news on that one: the database already allowed several sessions in a single day, so nothing you have recorded needed changing. Your existing Sunday time was carried over automatically.", kind: "note" }
  ],

  blockers: [
    "The setup walkthrough still only offers one playing day. Not urgent — you can now add as many times as you like in Settings → Schedule — but new groups will hit the same limit until it is fixed."
  ],

  decisions: [
    { q: "Product name", a: "The Turf Ball — used throughout. Say the word and I'll change it.", open: true },
    { q: "Clean sheets: goalkeeper only, or the whole defending side?", a: "Built as a setting — defaults to goalkeeper only, change it in Settings → Football", open: false },
    { q: "Do one-off guest players count on the leaderboard?", a: "Built as a setting — defaults to yes, toggle in Settings → Football", open: false },
    { q: "Voting for Player of the Month in the first version?", a: "No — first version ranks on statistics only", open: false }
  ]
};
