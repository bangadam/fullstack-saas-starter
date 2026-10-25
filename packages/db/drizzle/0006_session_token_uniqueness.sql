-- Forward-only correction: baseline created this named index without UNIQUE.
-- D1 applies migrations atomically. Existing duplicate tokens fail this migration;
-- investigate and revoke affected sessions explicitly, never silently delete rows.
DROP INDEX sessions_token_unique;
CREATE UNIQUE INDEX sessions_token_unique ON sessions(token);
