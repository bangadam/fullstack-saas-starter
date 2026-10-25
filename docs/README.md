# Dokumentasi

Index dokumen boilerplate. Ringkasan arsitektur ada di [architecture.md](./architecture.md), dan panduan pengembangan ada di [extending.md](./extending.md). Untuk AI agent, mulai dari [AGENTS.md](../AGENTS.md).

| Dokumen | Isi |
|---|---|
| [setup.md](./setup.md) | Prasyarat, instalasi satu perintah (`pnpm bootstrap`), topologi dev lokal, migration/seed, OAuth & webhook lokal, quality gates |
| [extending.md](./extending.md) | Resep menambah modul domain, job, adapter billing, mematikan billing, dan jalur upgrade multi-tenant |
| [architecture.md](./architecture.md) | Topologi 3 Worker, request flows, batasan D1, at-least-once/idempotency Queues, isolasi tenant, kontrak billing adapter |
| [deployment.md](./deployment.md) | Staging vs production, provisioning resource, secrets, deploy order api→jobs→web, migration expand/contract, smoke test, rollback |
| [security.md](./security.md) | Tenant isolation checklist, auth/cookie, webhook signature, secret handling, rate limit/Turnstile, audit log, D1 recovery, R2 policy |
| [operations.md](./operations.md) | Observability, alerting, runbook DLQ/replay, monitoring kapasitas, budget checklist, incident response |
| [../infra/cloudflare/README.md](../infra/cloudflare/README.md) | Referensi nilai per-environment (staging/production) — konfigurasi kanonik tetap di `wrangler.jsonc` tiap app |

Urutan baca yang disarankan: setup → architecture → extending → deployment → security → operations.

Catatan penting: `pnpm doctor` dan `pnpm setup` adalah command bawaan pnpm dan tidak menjalankan skrip repo ini. Padanan di repo: `pnpm check` (doctor) dan `pnpm wizard` (setup).
