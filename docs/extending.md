# Menambah Modul dan Memvariasikan Boilerplate

Resep kanonis untuk memperluas boilerplate tanpa merusak invariants di [AGENTS.md](../AGENTS.md). Contoh rujukan: modul `projects` end-to-end (contract → domain → route → SDK → UI).

## Keputusan arsitektur: B2C user-scoped

Boilerplate ini pernah organization-first (organizations, memberships, invitations) dan secara sadar dipangkas ke **B2C user-scoped**: setiap resource tenant memakai `user_id` non-null, dan scoping ditegakkan di layer service (`packages/domain`). Alasannya: lebih sedikit moving parts untuk produk single-user, dan upgrade multi-tenant tetap terbuka (lihat "Jalur upgrade multi-tenant" di bawah).

Jangan mencampur keduanya: tabel baru selalu memakai `user_id`; jangan memakai `organization_id` kecuali kamu menempuh upgrade multi-tenant penuh.

## Resep: modul domain baru

Urutan lapisan (setiap langkah punya test):

1. **Contract** — tambah schema Zod di `packages/contracts/src/<modul>.ts`, ekspor dari `index.ts`. Tambah kasus di `contracts.test.ts`. Contract browser-safe: tidak boleh import kode server.
2. **Schema DB** — tambah `sqliteTable` di `packages/db/src/schema.ts` dengan `userId` non-null + index. Generate migration (`pnpm --filter @saas/db generate`), review SQL, apply lokal (`pnpm db:migrate`).
3. **Domain** — tulis interface + service di `packages/domain/src/<modul>.ts` melawan **port** repository dan `audit`, bukan Drizzle langsung. Inject batas plan (`maxXFor`) dari pemanggil — jangan hardcode. Tulis `*test.ts` dengan repository in-memory; uji: happy path, quota, 404, dan isolasi tenant (user lain tidak bisa akses).
4. **Adapter** — implementasi port di `packages/domain/src/adapters/<modul>-drizzle.ts` memakai `INSERT … SELECT … WHERE` untuk enforcement atomik (D1 tanpa interactive transactions). Batch bila perlu atomic dengan outbox.
5. **Route** — pasang router Hono di `apps/api/src/routes/<modul>.ts` di belakang `requireSession`, validasi body dengan `parse(contractSchema, …)`, map error domain ke `ApiError` (contoh: `QuotaExceededError → 402`). Daftarkan di `apps/api/src/index.ts`.
6. **SDK** — tambah method di `packages/sdk/src/index.ts` (typed, validasi Zod) + test fetch mock. UI web memakai method ini, bukan fetch mentah.
7. **UI** — hook di `apps/web/src/lib/<modul>.ts` (TanStack Query, key stabil, invalidate on mutation) + route/page. Auth pakai `~/lib/auth-client.ts`.

Contoh jejak `projects`: `packages/contracts/src/projects.ts` → `packages/domain/src/{projects.ts,adapters/drizzle-projects.ts}` → `apps/api/src/routes/projects.ts` → `packages/sdk/src/index.ts` (`listProjects/getProject/createProject/…`) → `apps/web/src/lib/projects.ts` + `routes/dashboard.projects.*`.

Contoh jejak `files` (termasuk kuota plan dan dua mode upload): `apps/api/src/routes/files.ts` (kuota via `storageQuotaDecision`, metadata D1, presigned vs direct) → `apps/web/src/lib/files.ts` → `routes/dashboard.files.tsx`. Baca ini kalau modul baru menyentuh storage/R2.

## Resep: background job baru

1. Definisikan payload + idempotency key di `packages/jobs/src/payloads.ts` (key stabil per efek samping, mis. `email:<template>:<id>`).
2. Producer di API: simpan outbox row atomik dengan mutasi bisnis bila event tidak boleh hilang (`INSERT … batch`), enqueue ke Queues.
3. Consumer di `apps/jobs/src/handlers.ts`: cek-dan-tulis kondisional di D1 sebelum efek samping; duplikasi setelah crash harus no-op.
4. Retry → DLQ untuk inspeksi/replay (lihat `docs/operations.md`). Uji redelivery ganda tidak menggandakan efek.

## Resep: adapter billing baru

Kontrak server-only (`packages/billing`): `createCheckout`, `createCustomerPortal`, `getSubscription`, `verifyAndNormalizeWebhook`.

1. Implementasi adapter murni (tanpa akses env langsung — terima config sebagai argumen).
2. Catalog map plan/interval → product/price ID tetap di env; tanpa mapping = pending, bukan aktif.
3. Webhook: verifikasi signature atas raw body → persist `billing_events` (dedup key = provider + environment + external event id) → ack → proses idempoten.
4. Satu provider aktif untuk checkout baru; subscription lama tetap memakai adapter asal.
5. Tambah contract test + sandbox test per adapter di Workers runtime (bukan hanya Node).

## Mematikan billing

`BILLING_PROVIDER=none` (atau adapter tanpa token) berarti pending/disabled, bukan error: UI menampilkan pesan konfigurasi, bukan crash. Uji negatif path ini saat menambah surface berbayar baru.

## Jalur upgrade multi-tenant

Bila produkmu butuh workspace/organisasi, ini touchpoint-nya (estimasi besar — perlakukan sebagai epic tersendiri):

1. Schema: `organizations`, `memberships(user, role)`, `invitations(token, expires)`; ganti `user_id` foreign key resource → `organization_id` non-null; migrasi data existing (satu org personal per user).
2. Domain: `requireRole(orgId, userId, min)` di setiap service; lindungi owner terakhir; token invitation sekali pakai + expiry; uji negatif isolasi antar-org (wajib).
3. Auth/session: bawa active org di session/context; audit log mencatat org.
4. API: semua route scope org, bukan user; switcher di UI; jobs membawa tenant context.
5. Billing: entitlement dan subscription per org (bukan per user); reconcile saat user pindah org.

Jangan setengah jalan: tabel tanpa `organization_id` non-null di mode multi-tenant adalah bug isolasi.
