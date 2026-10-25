# Arsitektur

Ringkasan topologi, request flow, dan batasan runtime. Keputusan model akun dan panduan pengembangan ada di [extending.md](./extending.md).

## Topologi 3 Worker

```text
Browser
   |
   v
app.example.com — Web Worker / TanStack Start          apps/web
   |-- halaman publik, pricing, dashboard, SSR, assets
   |-- /api/*          -- service binding --> API Worker / Hono    apps/api
   |-- /webhooks/*     -- service binding --> API Worker / Hono
                                              |-- Better Auth        packages/auth
                                              |-- organization authorization
                                              |-- D1 binding         packages/db
                                              |-- R2 binding         packages/storage
                                              |-- Polar / Stripe / email HTTP API
                                              |-- Queues producer
                                                        |
                                                        v
                                                   Jobs Worker             apps/jobs
                                                   Queues consumer
                                                   Cron Triggers
                                                   D1 / R2 bindings

Payment provider -> app.example.com/webhooks/{provider}
Browser -> R2 signed URL setelah izin diberikan API
```

- API Worker **tanpa public route**; `workers.dev` dinonaktifkan. Akses hanya via service binding dari Web Worker dalam akun Cloudflare yang sama. Endpoint webhook tetap publik di Web Worker karena provider tidak bisa memanggil service binding.
- Modular monolith: business logic tetap satu API (`packages/domain`), bukan microservices per domain. Pemisahan Worker adalah boundary deployment/dependency, bukan pemisahan domain.

## Request flows

**SSR.** Browser → Web Worker; server-side memanggil API via helper server-only + service binding dengan credential request yang relevan. Cache query SSR request-scoped; auth dan halaman personal tidak masuk shared cache; cookie/token tidak diserialisasi ke browser.

**REST (`/api/*`).** Web Worker forward method, query, raw body, cookie, dan seluruh `Set-Cookie` via fixed service binding (bukan URL dari input pengguna), **tanpa mengubah path**: jalur publik = jalur internal (`/api/auth/*` → `/api/auth/*`). Ini wajib karena Better Auth menyusun link email dan callback OAuth dari `basePath`-nya; pernah dicoba dengan strip prefix dan hasilnya link `/auth/reset-password/<token>` yang 404 di app publik. API Worker tetap memvalidasi session, role, tenant, Origin/CSRF — service binding privat bukan pengganti authorization.

**Webhook (`/webhooks/{provider}`).** Provider → Web Worker → API Worker. Verifikasi signature atas raw body sebelum payload dipercaya; persist event durable sebelum acknowledgment; proses idempotently; outbox memulihkan kegagalan enqueue.

**Upload direct-to-R2.** Browser minta izin ke API → API memvalidasi tenant + kuota → API generate presigned URL (S3 signing dengan Web Crypto, credential terbatas server-side) → browser PUT langsung ke R2 (CORS dibatasi origin/method/header). Akses server ke object memakai R2 binding. Expiry signed URL pendek; metadata file di D1; orphan cleanup via job.

**Queue job.** API Worker menyimpan outbox/mutation bisnis secara atomik di D1 bila event tidak boleh hilang → enqueue ke Queues → Jobs Worker konsumsi → tulis hasil ke D1/R2. Cron Triggers memicu job singkat atau enqueue pekerjaan, termasuk scheduled repair outbox tertinggal.

## Batasan D1

D1 = SQLite terkelola, bukan PostgreSQL. Konsekuensi:

- Dialect SQLite: tipe, SQL, constraint, dan perilaku ORM mengikuti SQLite.
- **Tidak ada interactive transactions** (`BEGIN/COMMIT` callback). Gunakan `batch()` — prepared statements dieksekusi berurutan dalam satu transaksi atomik; kegagalan membatalkan seluruh batch. (Ref: [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/))
- Kuota/tenant invariants ditegakkan lewat SQL conditional writes, constraint, dan atomic batch — bukan read-count lalu insert terpisah.
- Batas ukuran per database: 500 MB (Free) dan 10 GB (Paid), batas 10 GB tidak dapat dinaikkan; query per database dieksekusi serial — periksa ulang [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) sebelum launch.
- Satu database per environment untuk mulai; multi-database per tenant bukan fitur v1. Read replication tidak diaktifkan tanpa desain konsistensi session/bookmark.
- D1 + Queues bukan transaksi lintas layanan → pola outbox dengan idempotency key.

## Queues: at-least-once dan idempotency

- Delivery guarantee **at-least-once**: duplikasi dan redelivery pasti terjadi setelah crash/retry. Ref: [delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).
- Aturan idempotency:
  - Setiap job payload punya `jobId`/idempotency key; efek samping dicek-dan-tulis secara atomic (conditional write di D1) sebelum dieksekusi.
  - Billing webhook events dinormalisasi dengan dedup key bernamespace `provider + environment + external event id`.
  - Gagal diproses → retry sesuai konfigurasi queue → melewati batas retry → **dead-letter queue (DLQ)** untuk inspeksi/replay (lihat [operations.md](./operations.md)).
  - Outbox publisher mengirim ulang dengan idempotency key; repair scheduled memproses outbox tertinggal.
- Queues tidak menghapus batas CPU/time/memory Workers; pecah pekerjaan berat, jangan taruh encoding panjang di baseline.

## Isolasi tenant

- Semua resource tenant memiliki `organization_id` non-null. Read/update/delete di-scope tenant di layer service/query (`packages/domain`) — tidak ada PostgreSQL RLS, jadi enforcement terpusat dan diuji negatif.
- Membership diverifikasi server-side untuk setiap request; role `owner/admin/member`.
- Constraint tenant-aware mencegah referensi lintas organisasi.
- Owner terakhir terlindungi; invitation punya expiry; token sekali pakai.
- Job membawa tenant context dan memvalidasinya sebelum efek samping.

## Kontrak billing adapter

Server-only (`packages/billing`), dua adapter + mode none:

```ts
createCheckout(...)
createCustomerPortal(...)
getSubscription(...)
verifyAndNormalizeWebhook(...)
```

- Satu provider aktif untuk checkout baru per deployment; subscription lama tetap memakai adapter asal.
- Catalog map plan/interval internal → product/price ID per provider per environment.
- Simpan: provider, environment, external customer/subscription ID, organization ID, status asli, normalized entitlement. Dedup event bernamespace provider + environment.
- Checkout redirect bukan bukti pembayaran; organisasi ditentukan dari mapping server.
- Billing core satu sumber entitlement; quota ditegakkan backend secara concurrency-safe (atomic D1).
