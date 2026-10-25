# Verifikasi pengembangan self-service — 25 Oktober 2026

## Cakupan

Implementasi poin 1–5: setup/deploy aman, billing self-service, lifecycle storage, pengaturan akun, serta monitoring/recovery. Generator modul tidak dikerjakan. Perubahan lokal sebelumnya dipertahankan; tidak ada commit, push, provisioning, deployment, atau transaksi provider nyata.

## Hasil gate

- `pnpm test`: **323 tes lulus** di 11 paket dengan test runner.
- `pnpm typecheck`: **15 paket lulus**.
- `pnpm lint`: **15 paket lulus**.
- `pnpm test:scripts`: **10 tes lulus**.
- `pnpm scan:secrets`: tidak menemukan secret pada file yang dipindai (pemindaian git-tracked, bukan jaminan seluruh file untracked).
- `pnpm build`: **4 task build lulus**. Wrangler memberi warning target environment tidak disebut pada dry-run build lokal; tidak terjadi deploy.
- `git diff --check`: lulus.
- `pnpm smoke`: **6/6 lulus**.
- `pnpm smoke:lifecycle`: sesi/security/deletion state/subscription, export tenant-scoped tanpa credential, reservasi file, larangan download pending, upload langsung, completion idempotent, download byte-identik, dan penghapusan fixture lulus.
- `pnpm operations inspect --env local --execute`: berhasil; output hanya metrik numerik. Saat pengecekan ada 12 email pending lokal yang sudah ada dan dua tombstone file fixture. Tidak dilakukan retry email atau pengiriman eksternal.

## Database

Migration `0002`–`0005` diterapkan hanya ke D1 lokal setelah backup. Migration `0006` memperbaiki index token sesi menjadi unique; pemeriksaan lokal menemukan nol kelompok token duplikat sebelum diterapkan. Tidak ada migration remote.

Snapshot Drizzle `0002`–`0006` dan journal diselaraskan dengan SQL. Snapshot baseline `0000`/`0001` tidak diubah oleh pekerjaan ini. Validasi SQLite sementara membandingkan schema hasil migration; `drizzle-kit generate` di direktori sementara menghasilkan “No schema changes, nothing to migrate”. Tes duplicate token membuktikan migration gagal atomik tanpa membuang data ketika ada duplikat.

## Browser lokal

- Login akun demo berhasil.
- Account, Billing, dan Files berhasil dibuka melalui navigasi sisi klien dan full reload.
- Penyimpanan nama yang sama mengembalikan “Name updated.” tanpa mengubah identitas demo.
- Account menampilkan sesi aktif, export, dan peringatan lifecycle deletion.
- Billing menampilkan paket/usage; checkout dan portal dinonaktifkan dengan penjelasan ketika provider/customer belum tersedia.
- Tampilan Account, Billing, dan Files diperiksa pada desktop dan lebar 390px; tidak ada overflow dokumen. Tabel Files memakai scroll horizontal di layar kecil.
- Upload melalui file chooser browser tidak dijalankan karena backend browser tidak mendukungnya; alur bytes diuji melalui HTTP lokal.
- Password change, session revocation, dan deletion destruktif diuji pada fixture SQLite/Better Auth, bukan akun demo pengguna.

## Batasan operasional

1. Deployment memerlukan resource/secret yang sudah disiapkan dan persetujuan environment GitHub. Environment production Wrangler belum ada sehingga preflight production sengaja menolak.
2. R2 presigned upload, pembayaran, portal, dan Turnstile nyata belum diuji terhadap layanan eksternal. Tes menggunakan mock/provider fixtures; upload lokal melalui binding sudah diuji.
3. Persiapan penghapusan akun membekukan upload/checkout dan tidak dapat dibatalkan melalui UI. Ada masa tunggu minimal 70 menit. Intent checkout ambigu harus direkonsiliasi operator sebelum checkout baru/penghapusan akun.
4. Jaminan deduplikasi email mengikuti jendela provider; pengiriman ambigu lewat 23 jam dikarantina untuk pemeriksaan manual. Urutan event billing berbeda dapat memerlukan refresh dari provider.
5. Cleanup menghapus objek berdasarkan reservation tombstone yang kedaluwarsa, bukan sembarang objek bucket tanpa referensi. Grace upload adalah batas operasional, bukan pembatalan mutlak PUT yang sudah berjalan.
6. Alert dan prosedur backup/restore didokumentasikan, tetapi belum dipasang atau dijalankan di Cloudflare. Cron lokal tidak otomatis dijalankan oleh dev server seperti Cron Trigger deployment.
