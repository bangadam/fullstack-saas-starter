# Panduan Setup (Lokal)

Panduan menjalankan boilerplate ini secara lokal. Tidak memerlukan Docker, PostgreSQL, Redis, atau Node server yang listen pada port — seluruh compute dan persistence disimulasikan oleh tooling Cloudflare (workerd) pada local state.

Alur cepat (satu perintah setelah install):

```bash
pnpm install        # Node >= 22, pnpm via corepack
pnpm wizard --yes   # saas.config.ts + .env.local; file lama dipertahankan
pnpm bootstrap      # .dev.vars + migrate + seed (idempoten)
pnpm dev            # web + api + jobs — http://localhost:3000
```

Login demo setelah seed: `budi@example.com` / `password123`, `sari@example.com` / `password123`.

> Penting: `pnpm doctor` dan `pnpm setup` adalah command bawaan pnpm dan tidak sampai ke skrip repo ini. Padanannya `pnpm check` (doctor) dan `pnpm wizard` (setup wizard).

## Prasyarat

- **Node.js >= 22** (LTS). Cek: `node -v`.
- **pnpm** via corepack (versi mengikuti `packageManager` di `package.json`, saat ini `pnpm@12.14.0`):

  ```bash
  corepack enable
  corepack prepare pnpm@12.14.0 --activate
  ```

- **Wrangler** datang sebagai devDependency workspace — tidak perlu install global.
- Tidak perlu Docker. Tidak perlu akun Cloudflare untuk development lokal; login hanya dibutuhkan saat deploy.

## Instalasi

```bash
git clone <repo-url> my-saas && cd my-saas
pnpm install
pnpm wizard --yes
pnpm bootstrap --preflight
pnpm bootstrap
```

`pnpm bootstrap` mengerjakan tiga hal secara idempoten (aman diulang):

1. Membaca objek statis `saas.config.ts` dan `.env.local`, lalu merencanakan `.dev.vars` untuk API, jobs, dan web. Tidak menjalankan kode dari konfigurasi. File yang belum ada dibuat dengan mode 0600; file lama tidak ditimpa secara default. Jika nilai terkelola berbeda atau belum lengkap, proses berhenti **sebelum** menulis file/migrasi/seed dan menampilkan nama key saja (bukan nilainya).
2. Apply migration D1 lokal (`pnpm db:migrate`).
3. Seed data dummy (`pnpm db:seed`) — akun, projects, subscription pro, audit log.

Langkah manual yang setara bila ingin dijalankan terpisah: `pnpm db:migrate`, `pnpm db:seed`.

## Setup wizard dan rekonsiliasi aman

```bash
pnpm wizard          # interaktif
pnpm wizard --yes    # non-interaktif (CI) — pakai default, tidak menunggu prompt
```

Wizard menulis `saas.config.ts` (bertipe, di-gitignore) dan `.env.local` (mode 0600, di-gitignore) berisi `BETTER_AUTH_SECRET` yang di-generate kriptografis. Wizard **tidak** melakukan provisioning resource apa pun dan tidak menghubungi Cloudflare. `--yes` hanya memilih default tanpa prompt, **bukan izin overwrite**. Wizard berulang mempertahankan kedua file. `--force` hanya mengganti konfigurasi aplikasi; `.env.local` tetap dipertahankan agar secret tidak terotasi diam-diam.

```bash
pnpm wizard --yes --billing stripe --environment sandbox --app-url http://localhost:3000
pnpm wizard --yes --dry-run
pnpm bootstrap --dry-run
pnpm bootstrap --preflight
# Setelah review perbedaan dan backup lokal yang aman:
pnpm bootstrap --force
```

`--dry-run`/`--preflight` bootstrap hanya memvalidasi dan menampilkan rencana; tidak mengubah `.dev.vars`, database, atau menjalankan subprocess migrasi/seed. Script pnpm terlebih dahulu mengompilasi CLI ke `packages/cli/dist` (artefak build lokal). `--force` bootstrap secara eksplisit merekonsiliasi key terkelola dari konfigurasi/root env, mempertahankan key worker tambahan, lalu menjalankan migrasi lokal dan seed. Jangan gunakan flag ini untuk mengatasi konflik tanpa review.

Sumber kebenaran nilai publik adalah `saas.config.ts` (`appUrl`, provider dan environment billing); sumber secret adalah `.env.local`. Root env boleh memuat `APP_URL`, `BILLING_PROVIDER`, atau `POLAR_ENVIRONMENT` hanya jika sama dengan konfigurasi. Konfigurasi lama hasil wizard tetap dapat dibaca. Ekspresi/import dinamis di dalam objek config tidak didukung. Instalasi lama harus menyelaraskan secret worker yang ingin dipertahankan ke `.env.local` secara manual sebelum rekonsiliasi; bootstrap tidak menyalin placeholder kredensial dari file example.

Periksa keadaan lokal kapan saja dengan:

```bash
pnpm check
```

Output: status `ready` / `pending` / `failed` untuk node, pnpm, config, `.dev.vars`, database lokal, kredensial billing, dan auth secret — masing-masing dengan remediation. `config` yang belum ada adalah `pending` (bukan `failed`) karena itu langkah setup normal pada clone bersih.

## Topologi dev lokal

Tiga Worker berjalan bersamaan lewat `pnpm dev` (`scripts/dev.mjs`, start bertahap untuk menghindari race wrangler):

```text
apps/web    TanStack Start + Cloudflare Vite plugin (vite dev + wrangler dev) — http://localhost:3000
apps/api    Hono Worker (wrangler dev) — diakses lewat service binding dari web, bukan URL publik
apps/jobs   Queues consumer + Cron (wrangler dev) — dikonsumsi dari queue yang diproduce api
```

- Browser hanya berbicara ke Web Worker (`http://localhost:3000`). Route `/api/*` dan `/webhooks/*` di-forward ke API Worker via service binding **tanpa mengubah path** (web `/api/auth/*` → api `/api/auth/*`), sehingga link email auth dan callback OAuth yang digenerate server selalu valid. `pnpm dev` menunggu `/api/health` siap lalu menampilkan banner berisi URL dan kredensial demo; tunggu banner itu sebelum membuka browser.
- D1, R2, dan Queues diemulasi secara lokal oleh wrangler dengan persistent local state (`.wrangler/state`). Data lokal bertahan antar-restart sampai state dibersihkan.
- Email lokal memakai email capture (adapter `packages/email`), bukan Resend asli; pesan yang diantre tetap tercatat di tabel `email_outbox`, jadi alur reset password/verifikasi email bisa diperiksa dari D1. Billing default sandbox/pending bila token kosong.
- Upload file berjalan tanpa kredensial S3: bila `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`CLOUDFLARE_ACCOUNT_ID` kosong, API memakai mode langsung (`PUT /api/files/upload/:id` menulis lewat binding R2) dan download distream lewat Worker. Di production mode presigned dipakai otomatis.
- `pnpm stop` mematikan seluruh proses dev; `pnpm restart` = stop + dev.

Jalankan per-app bila perlu:

```bash
pnpm --filter @saas/web dev
pnpm --filter @saas/api dev
pnpm --filter @saas/jobs-worker dev
```

## Environment per app

`pnpm bootstrap` membatasi key menurut Worker yang memakainya, bukan menyalin seluruh `.env.local` ke setiap app:

- **web**: `APP_URL` dan `TURNSTILE_SITE_KEY` publik saja. Tidak menerima auth/billing/email/Turnstile secret.
- **api**: auth secret, Google OAuth, Turnstile site/secret key, billing provider/environment dan kredensial provider, pengaturan guard, serta kredensial R2 opsional. `R2_BUCKET_NAME` wajib sama dengan binding `BUCKET` bila tiga kredensial S3/account diaktifkan.
- **jobs**: `APP_URL`, nama aplikasi, `RESEND_API_KEY`, `EMAIL_FROM`, retention/grace/outbox settings. Tidak menerima auth/billing secret yang tidak digunakan handler.

Bindings D1/R2/Queue tetap didefinisikan di `wrangler.jsonc`, bukan `.dev.vars`. Nilai `.env.local` yang tidak masuk daftar key Worker tidak disebarkan. Untuk menambah integrasi, perluas daftar terkelola beserta test terlebih dahulu.

Aturan: secret hanya di Worker yang memakainya. Jangan menaruh token billing di public frontend vars. `.dev.vars` dan `.env.local` tidak pernah di-commit.

## Database: migration dan seed

Schema Drizzle ada di `packages/db`. Migration menggunakan `drizzle-kit generate` + `wrangler d1 migrations apply`:

```bash
# 1. Generate SQL migration dari schema (review hasil SQL sebelum apply)
pnpm --filter @saas/db generate

# 2. Apply ke D1 lokal
pnpm db:migrate

# 3. Seed data lokal
pnpm db:seed
```

- Selalu review file SQL migration sebelum apply; ini juga berlaku untuk remote (lihat [deployment.md](./deployment.md)).
- Migration remote hanya dilakukan sebagai release step terkontrol dengan persetujuan eksplisit — tidak ada reset/drop otomatis.

## OAuth Google (callback lokal)

1. Buat OAuth Client di Google Cloud Console, tipe **Web application**.
2. Authorized redirect URI untuk lokal: `http://localhost:3000/api/auth/callback/google`.
3. Isi `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` ke `.env.local`, periksa `pnpm bootstrap --preflight`, lalu rekonsiliasi terkontrol dengan `pnpm bootstrap --force` jika file worker sudah ada.
4. Better Auth base URL memakai origin publik aplikasi (Web Worker lokal), bukan URL internal API Worker.

Callback mengalir: browser → Web Worker → (service binding) → API Worker → Better Auth. Cookie diuji host-only, Secure, HttpOnly, SameSite agar OAuth loop tidak rusak di lokal.

## Testing webhook pembayaran

Dua opsi:

- **Provider sandbox UI**: Polar sandbox dan Stripe CLI/test dashboard punya tombol "send test event" — gunakan itu untuk trigger event tanpa tunnel. Endpoint: `http://localhost:3000/webhooks/polar` dan `/webhooks/stripe` (di-forward ke API Worker).
- **Tunnel** (bila perlu event asli dari checkout sandbox): expose Web Worker lokal via tunnel (mis. `cloudflared tunnel --url http://localhost:3000`), lalu daftarkan URL tunnel sebagai webhook endpoint di provider sandbox dan samakan `*_WEBHOOK_SECRET` di `.dev.vars`.

Aturan penting: webhook memverifikasi signature atas **raw body** sebelum payload dipercaya; forwarding tidak boleh mengonsumsi raw body terlebih dahulu.

## Quality gates dan verifikasi

```bash
pnpm check       # doctor: prerequisites + state lokal
pnpm typecheck   # turbo run typecheck
pnpm lint        # biome, via turbo run lint
pnpm test        # vitest di seluruh workspace (unit)
pnpm build       # build seluruh workspace
pnpm smoke       # uji HTTP terhadap stack dev yang sedang jalan (butuh `pnpm dev`)
```

Vertikal pengujian:

- **Unit (vitest)** — rule domain (`packages/domain`, memakai port in-memory), contract Zod, SDK client, lib web, aturan doctor.
- **Smoke HTTP (`pnpm smoke`)** — landing, halaman login, `/api/health` lewat proxy, auth gate, probe session, login kredensial seed. Cocok untuk CI ringan tanpa browser.
- **Browser E2E (`apps/web/e2e/flows.mjs`)** — login → dashboard → projects CRUD → settings → billing → logout → gate → signup, dijalankan melalui sesi browser agent (bukan CI).

Integration test yang menjalankan binding D1/R2/Queues pada Workers runtime (`@cloudflare/vitest-pool-workers`) tersedia untuk `apps/api`; dependency Node-only akan tertangkap di sini.

## Status & batasan

- Wizard dan doctor sudah berjalan (`pnpm wizard`, `pnpm check`). Wizard hanya menulis konfigurasi lokal; tidak ada provisioning, deploy, atau pembuatan resource.
- Deployment memakai preflight dan workflow dispatch manual ber-approval, tanpa deploy otomatis saat push; lihat [deployment.md](./deployment.md).
- Model data saat ini **B2C user-scoped** (tanpa organizations). Jalur upgrade multi-tenant didokumentasikan di [extending.md](./extending.md).
