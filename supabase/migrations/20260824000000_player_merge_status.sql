-- Split into its own migration: a new enum value can't be referenced by
-- another statement in the same transaction it was added in (SQLSTATE 55P04).
-- See 20260824000001_player_merge.sql for what actually uses 'merged'.
alter type player_status add value if not exists 'merged';
