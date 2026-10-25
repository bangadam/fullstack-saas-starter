-- A durable freeze prevents new uploads and checkouts while existing work drains.
ALTER TABLE users ADD COLUMN deletion_requested_at integer;
