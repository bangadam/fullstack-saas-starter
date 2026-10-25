-- All recovery timestamps are unix seconds. Apply after storage migration 0002.
ALTER TABLE email_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE email_outbox ADD COLUMN lease_until INTEGER;
ALTER TABLE email_outbox ADD COLUMN first_attempt_at INTEGER;
ALTER TABLE email_outbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
-- Legacy attempted sends have no stable provider dedup history: require reconciliation.
UPDATE email_outbox SET status = 'failed', last_error = 'legacy_attempt_requires_review'
WHERE status = 'pending' AND attempts > 0;
CREATE INDEX email_outbox_recovery_idx ON email_outbox(status, next_attempt_at, lease_until);
ALTER TABLE billing_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_events ADD COLUMN lease_token TEXT;
ALTER TABLE billing_events ADD COLUMN lease_until INTEGER;
ALTER TABLE billing_events ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_events ADD COLUMN failed_at INTEGER;
ALTER TABLE billing_events ADD COLUMN last_error TEXT;
CREATE INDEX billing_events_recovery_idx ON billing_events(processed_at, failed_at, next_attempt_at, lease_until);
CREATE TABLE recovery_cursors (name TEXT PRIMARY KEY NOT NULL, cursor TEXT NOT NULL DEFAULT '');
