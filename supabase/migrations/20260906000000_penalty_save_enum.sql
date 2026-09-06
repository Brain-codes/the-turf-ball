-- Penalty saves become a first-class statistic.
--
-- Split into its own migration: a new enum value can't be referenced by
-- another statement in the same transaction it was added in (SQLSTATE 55P04).
-- See 20260906000100_penalty_saves_and_clean_sheets.sql for what uses it.
--
-- The pre-existing 'save' value stays as it is. It has never been recorded
-- through any screen and means "a shot stopped" in general; 'penalty_save'
-- is the specific, countable moment groups actually argue about.
alter type event_type add value if not exists 'penalty_save';
