# infra/cloudflare

This folder is **not** the home of canonical deployment configuration. Each Worker's canonical config is its own `wrangler.jsonc`:

- `apps/web/wrangler.jsonc`
- `apps/api/wrangler.jsonc`
- `apps/jobs/wrangler.jsonc`

The files here are reference material for comparing environments:

- `staging.example.jsonc` — example staging values (`-staging` resource suffix, workers.dev URL)
- `production.example.jsonc` — example production values (custom domain, `-production` suffix)

What the example files document:

- Per-environment `vars` differences (`APP_BASE_URL`, `BETTER_AUTH_URL`, `ENVIRONMENT`).
- Binding names and resource mapping per environment (D1, R2, queues, DLQ, service bindings).
- `account_id`, `database_id` placeholders — fill `<...>` during real provisioning, in the app's `wrangler.jsonc`, not here.
- The list of secrets to set via `wrangler secret put` per Worker.

Rules:

- No real IDs or secrets are ever committed in this folder.
- Secrets never live in config files; only via `wrangler secret put` / CI secrets.
- Rerunning provisioning must recognize existing resources — never create duplicates or delete unknown resources (see [docs/deployment.md](../../docs/deployment.md)).
