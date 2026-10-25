-- Fail closed: never automatically expire unresolved external checkout attempts.
-- Before deleting an intent, an operator must verify with the scoped provider
-- that its checkout cannot complete and reconcile any resulting subscription.
CREATE TABLE billing_checkout_intents (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX billing_checkout_intents_user_unique ON billing_checkout_intents(user_id);
