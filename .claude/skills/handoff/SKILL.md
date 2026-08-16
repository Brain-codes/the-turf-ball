---
name: handoff
description: Write or refresh HANDOFF.md so a brand-new session can pick up The Turf Ball exactly where this one stopped. Use when the user says the session is getting long, wants to continue elsewhere, or invokes /handoff.
---

# Handoff

Produce a single file, `HANDOFF.md` at the project root, that lets a completely cold session continue this project without re-reading the conversation.

## Rules

1. **Verify before you write.** Never describe a feature as done because it appears in the plan. Check the code, the migrations, and the deployed state. A handoff that overstates progress is worse than no handoff, because the next session will build on a lie.
2. **State the current live state explicitly** — which migrations are applied to the remote, which functions are deployed, what still needs a manual dashboard toggle.
3. **Separate "built" from "built and verified".** Say how each was verified (local Postgres run, live curl, browser check) or say it wasn't.
4. **Carry the open decisions forward**, including the ones the user has not answered yet.
5. **Record the traps.** Any bug that was hit and fixed, any non-obvious constraint, anything a fresh session would plausibly break by "tidying".
6. **Point at the other sources of truth** rather than duplicating them: `SPEC.md`, `rule2.txt`, `dashboard/progress-data.js`, and the memory directory.
7. Keep it plain English at the top, technical detail lower down — the user reads the top, the next agent reads all of it.

## Procedure

1. Read `dashboard/progress-data.js` for current status and the build log.
2. Run these checks and use the real output, not assumptions:
   - `supabase migration list` — what is actually on the remote
   - `deno check --quiet supabase/functions/*/index.ts`
   - `cd app && npx tsc -b --noEmit`
   - `git log --oneline -15` if the project is a git repo
3. Read the memory directory listed in the system prompt for standing user preferences and constraints.
4. Write `HANDOFF.md` using the structure below.
5. Update `dashboard/progress-data.js` if anything is out of date, then validate it parses:
   `node -e "global.window={};require('./dashboard/progress-data.js');console.log('ok')"`
6. Tell the user the file is ready and give them the exact sentence to paste into the new session.

## Structure of HANDOFF.md

```
# Handoff — <project>
Updated: <date>

## Start here
One paragraph: what this project is, and the single sentence the new session should act on.

## Where we are right now
Live state: database, backend, frontend. What is deployed and what is not.

## What works, and how I know
Table: feature | status | how it was verified

## What is not built yet
The open list, in priority order, with enough detail to act on.

## Open decisions needing the user
Questions that are still unanswered.

## Traps and hard-won context
Bugs already hit, constraints that are not obvious, things not to "fix".

## The rules that govern this project
Pointer to rule2.txt and the two deliberate deviations.

## Key files
Where to look for what.

## How to run it
Exact commands.
```

## After writing

Remind the user that the new session still needs the project directory open, and that `SPEC.md`, `rule2.txt` and the memory directory travel with the repo — the handoff is the index, not a replacement.
