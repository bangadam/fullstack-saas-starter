# Operations

Observability, alerting, runbook kegagalan job, monitoring kapasitas, biaya, dan incident response.

## Observability

- **Workers Logs** dan metrics dashboard Cloudflare adalah baseline (per plan bagian 2 — Sentry opsional, tidak wajib).
- Request memakai request ID; Jobs hanya mencatat event/kind/provider/environment tervalidasi, outcome, duration dan counts. Jangan log idempotency key lama (dapat berisi token reset), tenant/recipient, payload, cookie, body, exception object, atau object key.
- Log level: `debug` hanya di dev; `info` untuk event bisnis penting; `error` untuk kode kegagalan tetap dan metadata aman (kind/provider/environment), tanpa tenant/PII, secret/token/session, atau exception text.
- Bila Sentry diaktifkan, hanya di api/jobs; jangan kirim PII/secret; sampling disesuaikan.

## Alerting

Minimal dua kanal alert:

1. **Error rate / exception** per Worker (Workers metrics/logs) — naik tajam dibanding baseline = incident.
2. **DLQ depth > 0** — pekerjaan gagal permanen menumpuk, butuh triage (runbook di bawah).

Tambahan yang disarankan setelah Tahap 5: outbox tertinggal (scheduled repair gagal membersihkan), latency p95 API, kegagalan webhook signature berulang (indikasi misconfig atau serangan).

## Runbook: kegagalan job (DLQ)

1. **Identifikasi**: cek jumlah DLQ, tipe job, dan metadata minimum di dashboard Cloudflare. Jangan dump pesan queue: producer lama bisa membawa recipient/body/token. Durable D1 row adalah sumber recovery; akses exact row hanya oleh operator berizin.
2. **Klasifikasi akar masalah**:
   - Bug kode / payload tidak valid → perbaiki kode, deploy, baru replay.
   - Kegagalan sementara (dependency down, D1 contention) → pastikan penyebab hilang, lalu replay.
   - Payload rusak / tenant invalid → jangan replay; catat, tangani manual bila perlu dampak bisnisnya.
3. **Replay**: gunakan CLI exact-row di bawah setelah memperbaiki akar masalah. Jangan mass-replay DLQ atau menganggap external exactly-once terjamin; email acceptance ambigu melewati provider idempotency window wajib direkonsiliasi manual.
4. **Verifikasi**: DLQ kembali 0, log consumer bersih, data akhir konsisten (cek tabel target/outbox).
5. **Follow-up**: tambahkan test regresi bila bug; catat di incident log.

Aturan dasar: **jangan replay sebelum akar masalah diperbaiki/dipastikan hilang**, kecuali kegagalan sementara yang jelas.

## Monitoring kapasitas

- **D1**: pantau ukuran database, latency query, `rows_read`/`rows_written` (metrics dashboard), dan contention. Batas 500 MB (Free) / 10 GB (Paid, tidak dapat dinaikkan) — periksa ulang [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) sebelum launch dan pasang alert jauh sebelum batas. Tetapkan alert kapasitas sesuai rencana Tahap 5.
- **Workers CPU/time**: pekerjaan berat dipecah sesuai CPU/time/memory limits Workers (verifikasi angka limits di dokumentasi saat implementasi); alert bila job sering mendekati batas. Load test D1 contention dan Workers limits ada di Tahap 5.
- **Queues**: depth antrean, lag konsumsi, retry rate.
- Latency diukur dari pasar target (Indonesia/Asia Tenggara); placement D1 mengikuti kemampuan Cloudflare, jangan menjanjikan query di setiap edge.

## Budget / pricing checklist

Hitung memakai harga aktual sebelum provisioning; paket gratis untuk eksperimen bukan janji production gratis. Cek di [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) dan [R2 pricing](https://developers.cloudflare.com/r2/pricing/) — jangan memakai angka dari dokumen ini:

- [ ] Workers: request, duration/CPU per plan yang dipilih
- [ ] D1: rows read, rows written, storage
- [ ] R2: storage (GB-bulan), Class A/B operations, egress (gratis untuk R2, verifikasi)
- [ ] Queues: operasi per pesan
- [ ] Logs retention (bila melebihi baseline gratis)
- [ ] Eksternal: Resend (email), Polar/Stripe fee transaksi, domain
- [ ] Turnstile: gratis pada baseline, verifikasi batas fitur per paket

Angka batas kuota (Requests, CPU ms, dsb.) berbeda per paket dan bisa berubah — selalu verifikasi di halaman pricing/limits Cloudflare terkini.

## Incident response

1. **Deteksi**: alert error/DLQ/latency menyala atau laporan pengguna. Catat waktu mulai dan scope (environment, tenant, fitur).
2. **Mitigasi cepat dulu, akar masalah kemudian**:
   - Kode baru bermasalah → `wrangler rollback` Worker terkait (lihat [deployment.md](./deployment.md) untuk semantik rollback vs schema).
   - Job menumpuk → jeda konsumen/pause queue bila perlu, jangan replay massal sebelum diagnosis.
3. **Komunikasi**: status internal dulu; status page/pengguna bila dampak terlihat.
4. **Diagnosis**: trace via request ID/jobId lintas Worker; cek perubahan terakhir (deploy, migration, rotasi secret).
5. **Recovery data** (bila perlu): D1 Time Travel/restore + verifikasi, prosedur di [security.md](./security.md). Konfirmasi restore pernah diuji.
6. **Post-incident**: catat timeline, akar masalah, action item; tambah alert/test supaya tidak berulang.

## Durable recovery dan rollout

Tidak ada endpoint admin publik. Semua tes menggunakan SQLite in-memory dan mock HTTP/R2; tidak ada deployment atau cloud action yang dilakukan sebagai bagian implementasi. Migrasikan berurutan 0002 storage, 0003 recovery, lalu account/billing sebelum consumer baru berjalan. Pause cron/consumer saat rollout schema dan restore. Migration 0003 mengarantina legacy pending email dengan attempts>0 karena riwayat provider idempotency tidak diketahui.

Cron Jobs setiap lima menit memilih maksimal **50 email + 50 billing event** yang due dan menjalankan handler langsung dari row durable, tanpa bergantung pada keberhasilan queue publish. Kegagalan satu item tidak menghentikan item lain; cleanup dijalankan independen. Batas throughput ini harus dipantau melalui lag.

Email memakai atomic `UPDATE RETURNING` claim dengan lease token unik 120 detik. Satu claim menaikkan attempt sekali; failure tidak menaikkan lagi. Crash sebelum send tetap memakan attempt, jadi attempts bukan bukti provider acceptance. Completion/failure menggunakan token fencing. Provider timeout 15 detik. Network/timeout, HTTP408/409/429/5xx retry dengan backoff60–3600 detik; maksimum delapan claims. Missing RESEND_API_KEY gagal tertutup, tidak menandai dry-run sebagai sent. Umur pending saja tidak lagi dibuang oleh STALE_OUTBOX_HOURS (env lama kompatibel tetapi tidak dipakai untuk failure policy).

Header provider selalu `Idempotency-Key: email:<outbox-id>`, bukan queue delivery ID atau reset token. Resend retention saat ini24 jam; setelah23 jam dari first_attempt_at otomatis quarantine sebelum dedup kadaluwarsa. **Exactly-once eksternal tidak dijamin:** D1 tidak dapat bertransaksi bersama provider; timeout bukan bukti send gagal. Lease mencegah concurrent sends normal, sedangkan provider dedup menutup acceptance-before-DB-commit crash dalam window provider. Isolate tertahan lebih lama dari lease tetap bergantung pada provider dedup. Jangan mengubah template, APP_NAME, APP_URL, EMAIL_FROM, penerima, atau credential/provider account selama intent ambigu outstanding: request ber-key sama harus berisi sama. Validasi ulang retention/semantik bila provider berubah. CLI tidak mereset first_attempt_at atau memaksa kirim lewat window; rekonsiliasi provider dan keputusan manusia dibutuhkan.

Billing memverifikasi raw body sebelum parsing dan persist sebelum2xx. Key durable adalah `(provider,environment,external_event_id)`; queue reference saja, payload queue tidak dipercaya. Scope berasal dari konfigurasi credential; Stripe livemode wajib cocok. Entitlement pro hanya dari configured PRO_MONTHLY/PRO_YEARLY product/price ID, bukan arbitrary metadata. Non-subscription events tetap marked processed. Subscription write dan processed marker memakai atomic D1 batch; provider subscription tidak dapat dipindahkan antar-tenant melalui upsert. Invalid payload atau delapan kegagalan dikarantina. **Ordering antar-event berbeda tidak dijamin**; setelah backlog/reorder signifikan gunakan authoritative provider subscription refresh, bukan hanya replay. Recovery tidak melakukan provider billing calls.

## Bounded storage cleanup

Cron atomically mengubah maksimal50 `pending`/`deleting` menjadi `expired` hanya ketika expires_at<=now (unix detik). Storage menetapkan deadline signature issuance+600detik TTL+3600detik in-flight grace. Completed/legacy NULL deadlines tidak pernah disentuh. Cleaner **tidak** melakukan bucket-wide orphan deletion atau menghapus arbitrary ready objects.

Maksimal50 expired tombstones dihapus objeknya tiap tick dengan durable keyset cursor `recovery_cursors`, berotasi supaya bukan hanya50 row pertama. Tombstone dipertahankan dan didelete lagi pada putaran berikut untuk late PUT. R2 delete idempotent; kegagalan tidak memblokir objek berikutnya. Key immutable, tidak boleh dipakai ulang atau mengembalikan expired ke completed. Tidak ada bukti absolut upload in-flight tidak selesai setelah grace; repeated sweep memberi eventual cleanup. Objek tanpa row (misalnya cascade user deletion/restore inkonsisten) membutuhkan inventory/reconciliation operator dan tidak dihapus otomatis.

## CLI inspect/retry (dry-run default)

Gunakan Node>=22, pnpm, Wrangler lokal; binding DB dari apps/api/wrangler.jsonc. Environment wajib eksplisit, remote wajib flag tambahan. Pastikan env produksi benar-benar dikonfigurasi; tidak ada fallback ke default deployment.

```bash
# Hanya rencana SQL; tidak menjalankan Wrangler atau cloud.
node scripts/operations.mjs inspect --env local
node scripts/operations.mjs inspect --env staging --remote
node scripts/operations.mjs inspect --env production --remote
# Read-only live inspection pun butuh execute eksplisit.
node scripts/operations.mjs inspect --env staging --remote --execute
# Retry exact email row (email_outbox.id), default dry-run.
node scripts/operations.mjs retry email --id OUTBOX_ID --env staging --remote
node scripts/operations.mjs retry email --id OUTBOX_ID --env staging --remote --execute --confirm staging:email:OUTBOX_ID
# Billing id adalah billing_events.id, bukan external_event_id; scope wajib.
node scripts/operations.mjs retry billing --id ROW_ID --provider polar --billing-env sandbox --env staging --remote
node scripts/operations.mjs retry billing --id ROW_ID --provider polar --billing-env sandbox --env staging --remote --execute --confirm staging:billing:ROW_ID
```

Retry hanya failed rows tanpa lease aktif, tidak pernah sent/processed. Attempt budget direset tetapi first-attempt window/key email tetap. Legacy ambigu dan expired window tidak eligible. `changed:0` bukan sukses retry; tinjau prasyarat/ID. Retry membuat row due, cron melakukan side effect. Inspect memerlukan semua migration termasuk billing_checkout_intents0005. Tidak ada shell interpolation, stdout/stderr Wrangler disembunyikan, output hanya allowlisted numeric counts. Jangan enable debug HTTP capture. CLI tidak membaca recipient, subject/body, URL token, payload webhook, atau last_error lama.

Untuk menemukan exact ID gunakan D1 console berizin dengan metadata minimum (`id,status,attempts,created_at,next_attempt_at,lease_until` atau billing `id,provider,environment,external_event_id,failed_at,processed_at`), jangan SELECT*. Jangan salin identifiers ke tiket publik. CLI bukan general SQL console.

### Checkout intent reconciliation

billing_checkout_intents adalah blocker konservatif penghapusan akun dan tidak autoexpire. CLI hanya aggregate count. Sebelum manual delete exact intent/user, buktikan provider checkout expired/canceled, atau completed dengan subscription terminal **dan** tidak ada outstanding charges. Catat bukti, minta explicit operator confirmation, filter exact `id AND user_id`, periksa affected count. Jangan mass-clear atau menganggap umur cukup membuktikan aman. Tidak ada command otomatis untuk clear intent.

## Alert rules awal

Sesuaikan threshold dengan volume dan SLO. Workers metrics/Queue metrics melengkapi JSON log aplikasi.

| Sinyal | Threshold awal | Respons |
|---|---|---|
| Tidak ada job_recovery healthy | >15menit | Cek cron, binding, schema, deployment |
| job_recovery_failed atau healthy=false |2tick | Cek D1, config provider, lag |
| emailLagSeconds/billingLagSeconds | >900detik selama10menit | Cek kapasitas50/tick, leases, provider |
| emailFailed/billingFailed meningkat | delta>0 | Triage quarantine, bukan mass replay |
| DLQ/retries meningkat | delta>0 | Producer/routing/dependency; durable replay |
| job_invalid_payload/job_unrouted |1event | Schema/queue regression; unrouted retry, malformed ack+alert |
| storage_cleanup.failed | >0 selama2tick | R2 permission/availability, tombstones retained |
| storageLagSeconds | >900detik setelah deadline | Cleanup capacity/cursor |
| billing_intake_failed |1event | Provider belum ack, pulihkan DB |
| billing_enqueue_failed | meningkat | Durable intent aman, pastikan cron sehat |
| D1/R2 quota/cost/capacity |70/85/95% | Capacity planning tanpa destructive purge |

Pending mencakup leased/backoff; lag sejak created_at bukan due. Failed count adalah gauge, gunakan delta untuk alert baru. Lease count bukan jumlah worker pasti aktif. Jika health query sendiri gagal, gunakan missing-heartbeat alert. Jangan expose health administratif melalui endpoint publik. Retensi dan izin log harus minimum.

## D1 backup/restore (instruksi saja, tidak dijalankan)

1. Tetapkan RPO/RTO, retention, encryption, least privilege, operator ownership, dan latihan restore staging. Verifikasi Time Travel retention aktual untuk plan/account (jangan mengasumsikan angka lama).
2. Contoh backup logis yang perlu review/approval sebelum dijalankan: `pnpm --filter @saas/api exec wrangler d1 export DB --config wrangler.jsonc --env staging --remote --output <absolute-encrypted-workspace>/d1.sql`. Dump mengandung PII/auth secrets/email tokens/payload. Enkripsi, checksum, catat migration version/timestamp, jangan commit atau upload publik. Periksa local `--help` untuk syntax versi Wrangler yang terpasang.
3. Restore ke database/binding terpisah dahulu; pause traffic/cron/queue, backup keadaan sekarang, pilih restore point atau import resmi. Time Travel restore adalah mutasi berkonfirmasi. Validasi schema/FK/tenant counts/subscription scope/pending jobs/R2 refs dan session policy sebelum cutover.
4. Restore dapat menghidupkan kembali email/event yang sudah diproses. Jangan auto-resume consumer. Cocokkan provider acceptance ledger, quarantine ambiguous email terutama lewat24jam, refresh billing authoritative, verifikasi cursor/tombstones, baru resume bertahap. Database restore tidak membatalkan email/payment eksternal.

## R2 backup/restore (instruksi saja, tidak dijalankan)

1. Jangan mengasumsikan undelete/versioning otomatis. Backup bytes ke bucket/account terpisah lewat tool resmi/S3-compatible dengan minimum credentials, access controls, encryption/retention, manifest key/size/checksum/content-type. Inventory listing bukan backup bytes. Uji restore terisolasi.
2. Cocokkan checkpoint dengan D1 file metadata/status/timestamp. Untuk RPO ketat pause upload/finalize/delete dan cleaner selama checkpoint; tidak ada transaksi lintas D1/R2.
3. Restore ke bucket staging baru dulu; validasi checksum/size/content-type. Jangan timpa completed production keys atau menghidupkan expired reservation. Rekonsiliasi completed row dengan object; unreferenced object bukan otomatis izin hapus.
4. Production cutover perlu approval, backup terbaru, pause cleanup/mutation, binding DB/R2 pasangan konsisten, validasi tenant download, resume bertahap. Jangan jalankan cleaner pada DB restore sebelum tombstone/late PUT reconciliation.

## Gate lokal

```bash
pnpm --filter @saas/jobs-worker test
pnpm --filter @saas/jobs-worker typecheck
pnpm --filter @saas/jobs-worker lint
pnpm --filter @saas/jobs typecheck
node --test scripts/operations.test.mjs
pnpm --filter @saas/api exec vitest run test/webhooks.test.ts
```

SQLite in-memory memvalidasi SQL claim/atomic batch; bukan bukti integrasi provider/Cloudflare live.
