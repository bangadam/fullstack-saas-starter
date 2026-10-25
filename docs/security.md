# Security

Checklist keamanan baseline. Mengacu pada plan bagian 3, 4, 6.

## Tenant isolation

- [ ] Semua tabel resource tenant punya `organization_id` NOT NULL dengan FK/constraint.
- [ ] Read/update/delete selalu di-scope `organization_id` di layer service (`packages/domain`); tidak ada query tenant lintas organisasi.
- [ ] Membership dan role diverifikasi server-side per request — jangan percaya `organization_id` dari client.
- [ ] Constraint tenant-aware: referensi lintas organisasi (mis. project milik org lain) ditolak oleh schema, bukan hanya aplikasi.
- [ ] Owner terakhir tidak dapat di-demote/di-kick; invitation punya expiry; token reset/invite sekali pakai.
- [ ] Job membawa tenant context dan memvalidasi ulang sebelum efek samping.
- [ ] Negative isolation tests wajib: request lintas tenant harus 403/404, diuji di CI (Tahap 2 plan).

## Auth & cookie

- Better Auth + Drizzle SQLite adapter; kompatibilitas D1 harus dibuktikan di Tahap 0 (signup, session, OAuth, organisasi, concurrency) sebelum perluasan fitur.
- Cookie: host-only, `Secure`, `HttpOnly`, `SameSite` yang diuji untuk alur OAuth. Base URL auth = origin publik Web Worker.
- Forwarding service binding mempertahankan cookie dan seluruh `Set-Cookie`; jangan konsumsi body sebelum sempat di-forward utuh.
- SSR memakai credential request relevan; jangan serialisasi cookie/token ke browser.
- Auth response dan halaman personal tidak masuk shared cache; cache query SSR request-scoped, dibersihkan pada logout/pergantian workspace.
- Session/token tidak pernah masuk log.
- **Origin/CSRF**: API Worker menolak mutasi tanpa `Origin` yang cocok dengan `APP_URL` (atau `EXTRA_ALLOWED_ORIGINS`), kecuali `/webhooks/*` (diautentikasi via signature) dan request bearer-token. Login CSRF ikut dilindungi karena sign-in adalah mutasi.
- **Turnstile server-side** wajib untuk endpoint kredensial bila `TURNSTILE_SECRET_KEY` dikonfigurasi; tanpanya token diabaikan (mode dev saja, dicatat di log). Token dikirim lewat header `cf-turnstile-response` agar tidak mengganggu body Better Auth.

## Webhook signature

- Verifikasi signature atas **raw body** sebelum payload dipercaya — di endpoint `/webhooks/polar` dan `/webhooks/stripe` (masing-masing secret sendiri).
- Persist event durable sebelum acknowledgment (HTTP 2xx), proses setelahnya secara idempotent; outbox memulihkan kegagalan enqueue.
- Dedup event bernamespace `provider + environment + external event id`; tangani out-of-order dan lakukan reconciliation.
- Checkout redirect bukan bukti pembayaran.

## Secret handling

- Secret hanya lewat `wrangler secret put` / `.dev.vars` lokal — tidak pernah di `wrangler.jsonc`, tidak di public frontend vars, tidak di log.
- `.gitignore` menutup `.dev.vars`, `.env*` (kecuali `.env.example` dan `*.example`). File example hanya berisi nama variabel/placeholder, tanpa nilai asli.
- `pnpm scan:secrets` (juga dijalankan di CI) memindai file ter-track git untuk pola kredensial; exit 1 bila menemukan. Findings tidak pernah menayangkan nilai secret.
- File secret lokal permission owner-only (chmod 600) bila didukung OS.
- CLI wizard wajib redaction secret pada output; input token masked atau environment, bukan CLI args.
- Scope API token CI minimum (deploy Workers + baca resource terkait); secret berbeda antar staging/production.
- Rotasi: ganti secret via `wrangler secret put`, lalu verifikasi smoke test; secret lama billing dihapus hanya setelah lifecycle subscription lama selesai.

## Rate limiting & Turnstile

- Cloudflare Turnstile untuk form auth/mahal, dengan **verifikasi server-side** — bukan pengganti rate limit.
- Rate limiting pada endpoint auth dan mahal. Batasan isolate-local tidak cukup untuk limit global yang ketat; boilerplate ini memakai counter atomik D1 per client (header `cf-connecting-ip`, fallback X-Forwarded-For) dengan bucket terpisah: `auth-strict` (10/10 menit, endpoint kredensial), `webhooks` (120/menit), `write` (120/menit, mutasi lain). Header `X-RateLimit-*` dan `Retry-After` (429) dikembalikan ke client.
- Override lewat env `RATE_LIMIT_AUTH_STRICT|WRITE|WEBHOOKS` ("limit/windowSeconds") — dev memakai nilai longgar, production default ketat. Nilai malformed membuat request fail-closed (bukan limit dimatikan).
- Batasan isolate-local tidak cukup untuk limit global yang ketat; pilih mekanisme platform rate limiting sesuai kemampuan paket (verifikasi kemampuan per paket di dokumentasi Cloudflare saat implementasi).
- Limit bisnis yang harus presisi (kuota, saldo) ditegakkan lewat D1 atomic conditional writes, bukan counter rate limiter.

## Audit logging

- Event penting dicatat: perubahan membership/role, invitation, perubahan billing/entitlement, reset password, hapus resource tenant.
- Audit log tersimpan di D1 (`organization_id`, aktor, aksi, metadata, waktu UTC), immutable dari sisi aplikasi.
- Tidak ada secret/token/session di entri audit maupun aplikasi log.
- Pembacaan audit log juga scoped tenant.

## D1 recovery

- D1 menyediakan **Time Travel** point-in-time recovery dengan retensi sesuai paket — verifikasi retensi paket kamu di dokumentasi Cloudflare sebelum mengandalkan.
- Definisikan prosedur: identifikasi titik kejadian → restore ke database baru/timetravel → verifikasi data → switch binding. **Uji restore secara berkala**, restore yang belum pernah diuji bukan recovery.
- Export tambahan (`wrangler d1 export`) untuk snapshot jadwal bila dibutuhkan compliance.
- Queue bukan backup database. R2 retention/backup strategy dirancang terpisah (Tahap 5 plan).

## R2 access policy

- Akses server memakai R2 binding (credential milik Worker), bukan access key global.
- Presigned URL: expiry pendek, hanya method yang diperlukan (PUT untuk upload, GET untuk download), scope ke key object milik tenant yang sedang diberi izin.
- R2 CORS: restrict origin (staging/production terpisah), method, dan header minimum.
- File privat: tidak ada public bucket; download selalu lewat signed URL setelah authorization API.
- Batas size/type/quota diperiksa sebelum memberi signed URL (`storageQuotaDecision` + `PLAN_ENTITLEMENTS.maxStorageBytes`, 402 bila melebihi), plus verifikasi server-side setelah upload (mode langsung membandingkan `Content-Length` body dengan ukuran yang dideklarasikan); orphan cleanup via job; file berisiko jalani quarantine/scanning sebelum distribusi.
- Mode langsung hanya aktif ketika kredensial S3 tidak ada (development); di production presigned URL wajib dan endpoint langsung mengembalikan 404.
