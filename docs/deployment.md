# Deployment

Lihat [architecture.md](./architecture.md) untuk topologi Worker. Deployment dipisahkan dari local setup; Wrangler + GitHub Actions adalah satu pemilik deployment. Contoh nilai konfigurasi per environment ada di [infra/cloudflare/](../infra/cloudflare/) — konfigurasi kanonik tetap di `wrangler.jsonc` tiap app.

## Staging vs production

- Resource **sepenuhnya terpisah**: D1, R2, queues, DLQ, secrets, identitas Worker, dan service binding masing-masing punya nama per environment (lihat `infra/cloudflare/staging.example.jsonc` dan `production.example.jsonc`).
- Tidak ada preview yang diam-diam memakai data production. Akun Cloudflare dipilih eksplisit.
- Staging diuji via workers.dev URL Web Worker atau hostname staging; production memakai custom domain lewat konfigurasi eksplisit/DNS.

## Provisioning resource

Provision manual atau via CLI assistant (rencana) — **tidak ada step otomatis pembuatan resource di CI**:

1. Login Cloudflare / API token CI dengan scope minimum.
2. Verifikasi paket dan fitur yang dibutuhkan (Queues, D1 paid limits, dsb.).
3. Buat resource per environment dan catat IDs (nama base sesuai `wrangler.jsonc` apps; suffix per environment):
   - D1: `saas-db-staging` / `saas-db-production`
   - R2 bucket: `saas-files-staging` / `saas-files-production`
   - Queues: `saas-email-queue`, `saas-billing-queue`, `saas-cleanup-queue` per environment (lihat `apps/api/wrangler.jsonc` producer dan `apps/jobs/wrangler.jsonc` consumer)
   - DLQ bersama: `saas-dlq-staging` / `saas-dlq-production`
4. Isi `database_id`, bucket name, dan queue name ke `wrangler.jsonc` app terkait untuk environment tersebut. Rerun provisioning harus mengenali resource sendiri tanpa duplikat atau menghapus resource tak dikenal.

## Secrets per Worker

Unggah via `wrangler secret put` per Worker (bukan di config). Prinsip:

- Token billing, webhook secret, OAuth secret, email API key **hanya di Worker yang memakainya** (api, jobs bila perlu) — tidak pernah di public frontend vars.
- Shared auth secret konsisten di semua replica API, tetapi **berbeda antar-environment**.
- Scope token CI minimum: deploy Workers + baca resource yang dideploy saja. Jangan beri token yang bisa hapus resource.

## Preflight dan workflow manual

Kedua workflow `.github/workflows/deploy-staging.yml` dan `deploy-production.yml` hanya memakai `workflow_dispatch` pada branch `main`; **tidak ada trigger push**. Keduanya memerlukan teks konfirmasi target dan checklist `migrations_reviewed`, lalu memakai GitHub Environment sesuai target. Atur **required reviewers**, larangan self-approval, dan deployment branch restriction ke `main` di Settings → Environments. YAML tidak dapat membuat kebijakan reviewer ini; tanpa konfigurasi tersebut GitHub tidak menyediakan approval manusia.

Environment secrets: `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID`, terpisah antara staging/production. Environment variable `APP_URL` berisi origin HTTPS publik tanpa path/trailing slash. Jangan isi secret aplikasi di workflow: provision terlebih dahulu ke Worker yang menggunakannya. Token deployment hanya diberikan pada langkah release, bukan langkah test/build quality gates sebelumnya.

```bash
# Tidak menghubungi Cloudflare, tidak menulis config deployment, tidak apply SQL:
CLOUDFLARE_ACCOUNT_ID=<account-id> DEPLOY_APP_URL=https://staging.example.com pnpm deploy:staging --preflight
CLOUDFLARE_ACCOUNT_ID=<account-id> DEPLOY_APP_URL=https://staging.example.com pnpm deploy:staging --dry-run

# Hanya operator yang telah mereview SQL/resource/secret boleh menjalankan:
pnpm deploy:staging --confirm staging --migrations-reviewed
pnpm deploy:production --confirm production --migrations-reviewed
```

Perintah aktual memerlukan account ID, token, dan `DEPLOY_APP_URL` pada environment proses; jangan menaruh token dalam argumen command atau history shell. `--app-url` dapat menggantikan `DEPLOY_APP_URL`. Mode preflight/dry-run melakukan validasi statis lokal saja; tidak membuktikan resource, permission, secrets, atau DNS sudah tersedia. Script pnpm mengompilasi CLI lokal terlebih dahulu.

`env.staging`/`env.production` pada **ketiga** `apps/*/wrangler.jsonc` harus eksplisit. Nama Worker, D1, bucket, queue, dan DLQ wajib berakhiran target environment; UUID D1 valid dan sama antara API/jobs. API/jobs `APP_URL` harus cocok dengan URL smoke; `API_WORKER` pada web harus mengarah ke nama API target. Binding/vars lokal tidak diwariskan ke release. Production web wajib memiliki `routes` eksplisit dan `workers_dev: false`. API/jobs selalu dipaksa privat (`workers_dev: false`, `preview_urls: false`, tanpa routes). Kredensial tidak boleh ada di `vars`. Bila `R2_BUCKET_NAME` disetel, nilainya harus sama dengan binding bucket; jika secret S3 diaktifkan, operator wajib menyetel public bucket name tersebut. Secrets remote tidak dapat diperiksa oleh preflight offline.

Konfigurasi production yang belum lengkap ditolak sebelum build/migrasi/deploy; workflow bukan provisioning otomatis. Jangan menyalin ID staging ke production untuk melewati validasi.

Workflow menjalankan install frozen lockfile, preflight, lint/typecheck/test, secret scan, lalu helper `scripts/deploy.mjs`. Helper membangun `@saas/api`, `@saas/jobs-worker`, `@saas/web` lebih dahulu; sesudah seluruh build sukses ia memvalidasi konfigurasi web hasil Vite, menulis config release ke direktori gitignored, apply migrasi D1 remote, deploy API → jobs → web, lalu `SMOKE_BASE_URL=<target> pnpm smoke`. Kegagalan menghentikan langkah berikutnya; tidak ada seed remote, reset database, unggah secret, atau provisioning.

Patch web menggunakan pola yang sudah ada pada `apps/web/scripts-deploy-staging.sh`: identitas Worker dan service binding diganti pada konfigurasi **hasil build**. Helper baru mempertahankan bundled `main` dan path `assets`, menyimpan hasil ke `apps/web/dist/server/wrangler.<environment>.json`, lalu memakai `wrangler deploy --config <path>` eksplisit. Jangan memakai skrip staging lama untuk promotion karena melewati gate helper. Konfigurasi API/jobs hasil normalisasi berada di `.wrangler/deploy/<environment>.json`; file sumber dan config Vite asli tidak ditimpa.

## Deploy order: api → jobs → web

```text
1. apps/api    — schema kontrak versi baru aktif, backward-compatible dengan jobs/web lama
2. apps/jobs   — consumer + bindings mengikuti api baru
3. apps/web    — service binding menunjuk api target, UI baru rilis terakhir
```

Alasan: API adalah sumber kontrak. Dengan deploy api dulu (plus expand/contract migration), jobs dan web lama tetap kompatibel selama rollout. Validasi compatibility antarversi tiap step. API tidak diberi route publik.

## Migration sebagai release step terkontrol

- Migration remote dijalankan **eksplisit** (`wrangler d1 migrations apply <db> --remote` dengan konfirmasi target environment) — bukan efek samping deploy.
- Pola **expand/contract**: tambah kolom/tabel nullable dulu (expand), deploy kode yang menulis-dua-ars/ membaca baru, baru kontrak (drop/harden) setelah seluruh versi lama tidak lagi berjalan.
- **Database rollback tidak otomatis mengikuti rollback Worker.** Worker rollback memulihkan kode, bukan schema. Kontrak migration harus tetap menerima kode lama maupun baru selama rollout — itulah fungsi expand/contract.
- Jangan reset/drop otomatis, di lokal maupun remote.

## OAuth / webhook / base URL per domain

Setelah domain final ditentukan (staging & production terpisah):

- Base URL auth diturunkan otomatis dari `APP_URL` + `/api` (lihat `packages/auth/src/base-url.ts`) — jangan menyetel origin telanjang; link reset/verifikasi dan callback OAuth akan 404.
- Google OAuth redirect URI: `https://<domain>/api/auth/callback/google` per environment.
- Webhook endpoint di provider: `https://<domain>/webhooks/polar` dan `/webhooks/stripe`, secret per environment, uji signature + event replay + checkout sandbox + portal.
- R2 CORS dibatasi ke origin per environment; izinkan metode `PUT`, `GET`, `HEAD` dan request headers `Content-Type`, `If-None-Match` untuk upload create-only bertanda tangan. Set `R2_BUCKET_NAME` API sama dengan binding `BUCKET` sebelum mengaktifkan kredensial S3.
- Custom domain production via konfigurasi eksplisit/DNS yang disetujui; jangan biarkan workers.dev aktif untuk production bila domain custom dipakai.

## Smoke test checklist

Smoke otomatis memakai URL web target dan secara default read-only untuk remote; tidak bergantung pada akun demo/seed production. Smoke HTTP ini bukan bukti keseluruhan integrasi provider. Nyatakan release sehat hanya setelah checklist tambahan berikut lolos:

- [ ] SSR halaman publik + dashboard
- [ ] Login (email/password) dan Google OAuth
- [ ] Tenant isolation: akses lintas pengguna (B2C `userId`) ditolak
- [ ] `/api/*` via service binding berfungsi
- [ ] Query D1 (read + write) pada environment target
- [ ] Signed upload ke R2 + download privat
- [ ] Queue consumption: enqueue → consumer memproses
- [ ] Retry/DLQ: trigger kegagalan, konfirmasi masuk DLQ
- [ ] Billing: checkout sandbox, webhook signature, portal
- [ ] Webhook replay tidak menggandakan efek samping (idempotency)

## Rollback

- `wrangler rollback` per Worker memulihkan kode Worker pada environment itu — cepat dan aman untuk kode.
- **Tidak memulihkan D1 schema maupun data.** Jika deploy menyertakan migration, rollback Worker harus dievaluasi bersama state schema (kode baru vs schema lama = kontrak expand harus masih valid).
- Recovery data memakai fasilitas D1 (Time Travel/restore per retensi paket, export) — lihat [security.md](./security.md) dan [operations.md](./operations.md). Queue bukan backup database.
- CI: lint/typecheck/test/build + migration review → deploy staging melalui manual dispatch + environment approval → promotion production manual dispatch + approval. Workflow yang gagal setelah migrasi tidak mengembalikan schema; evaluasi SQL dan versi Worker sebelum rerun.
