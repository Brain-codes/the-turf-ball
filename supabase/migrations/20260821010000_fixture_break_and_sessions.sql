-- ============================================================================
-- Three more things the fixture scheduler needed to be configurable, not
-- hardcoded:
--
-- 1. The gap between matches was a fixed 5 minutes. Groups vary — some
--    need longer to clear the pitch and get the next two teams on.
-- 2. A match is often two halves with a break, not one continuous block.
--    Halftime is now an explicit, optional part of the schedule's own
--    maths rather than something the organizer had to remember to pad in
--    manually via a longer "minutes per match".
-- 3. A day of football is sometimes two separate windows — a morning
--    session and an evening session — not one continuous block. The
--    existing day_starts_at/day_ends_at columns become "session one";
--    these add an optional "session two".
--
-- None of this touches how a match actually plays out — matches already
-- track their own real started_at/ended_at and MatchDay's live clock runs
-- off elapsed real time, never off the plan. Everything here is about
-- building a sensible plan up front, not constraining what happens once a
-- fixture actually kicks off.
-- ============================================================================

alter table public.competitions
  add column break_between_matches_minutes integer not null default 5
    check (break_between_matches_minutes between 0 and 120),
  add column split_into_halves boolean not null default false,
  add column halftime_break_minutes integer
    check (halftime_break_minutes is null or halftime_break_minutes between 0 and 60),
  add column evening_starts_at time,
  add column evening_ends_at time;

comment on column public.competitions.break_between_matches_minutes is
  'Gap between one match ending and the next kicking off. Replaces the old fixed 5-minute assumption.';
comment on column public.competitions.split_into_halves is
  'Whether each match is treated as two halves with a break, for scheduling purposes only.';
comment on column public.competitions.halftime_break_minutes is
  'Length of the halftime break when split_into_halves is on. Ignored otherwise.';
comment on column public.competitions.evening_starts_at is
  'Optional second daily play window (session two) alongside day_starts_at/day_ends_at (session one) — e.g. a morning session and a separate evening session.';
comment on column public.competitions.evening_ends_at is
  'End of the optional second daily play window.';
