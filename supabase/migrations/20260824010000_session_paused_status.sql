-- ============================================================================
-- 'paused' session status.
--
-- Isolated in its own migration on purpose: Postgres will not let a new enum
-- value be USED in the same transaction that added it, and every migration
-- file runs in one transaction. The scheduler that writes 'paused' lives in
-- the next migration.
-- ============================================================================

alter type session_status add value if not exists 'paused';
