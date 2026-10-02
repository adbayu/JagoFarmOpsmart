# P3-01 IoT Telemetry Implementation Plan

**Status:** Baseline spec disetujui pada 2026-10-02; rencana menunggu tinjauan pemilik. Belum ada kode P3-01.

> **For agentic workers:** Use `superpowers:executing-plans` after the owner approves this plan. Do not write application code before that review. Git version control is configured with the user's GitHub repository; keep implementation changes reviewable and commit them after verification.

**Goal:** Menyediakan registry perangkat yang farm-scoped, ingest telemetry netral-protokol yang idempoten, serta retensi bacaan yang aman tanpa mengubah domain operasional farm.

**Architecture:** Reuse `Database.transaction`, `Sql`, membership checks, command receipts, Express `createApp`, React shell, dan Zod yang sudah ada. Pisahkan kontrak/validasi, perintah registry, ingest token bearer, query halaman, dan sweep retensi di modul `src/modules/iot/`. Daftarkan route ingest sebelum parser JSON umum dan middleware session/CSRF; route manajemen tetap memakai session, CSRF, membership, dan command transaksional. PostgreSQL menjadi sumber waktu ingest dan penyimpan token bucket lintas proses.

**Tech Stack:** TypeScript, Express, React, React Router, Zod, PostgreSQL, PGlite, `node:crypto`, dan adapter `Database`/`Sql` yang sudah tersedia. Tidak menambah dependency.

**Spec:** `docs/superpowers/specs/2026-10-01-p3-01-iot-telemetry-design.md`

## Global Constraints

- Terapkan persetujuan desain di spec, termasuk semua anggota aktif farm yang boleh mengelola perangkat; aturan Owner untuk administrasi anggota tetap seperti sekarang.
- Tentukan farm dan unit fisik hanya dari registry token. Abaikan atau tolak field otoritas yang dikirim di payload ingest.
- Simpan hanya hash SHA-256 token. Secret mentah hanya boleh keluar dari create/rotate pertama; jangan tulis ke receipt, log, URL, localStorage, analytics, atau pesan error.
- Kunci transaksi ingest pada baris perangkat, bukan baris farm. Lock perangkat menyerialkan rate bucket, rotasi/pencabutan, dan bacaan yang sedang disimpan.
- Konsumsi rate bucket dalam transaksi terpisah sebelum parser body agar setiap request dengan bearer valid ikut dibatasi, termasuk JSON rusak atau body terlalu besar. Transaksi penyimpanan mengunci perangkat lagi dan memvalidasi ulang token/status.
- Pertahankan batch ingest all-or-nothing untuk bacaan baru. Conflict/validation saat menyimpan tidak membatalkan state limiter yang telah commit.
- Bacaan dan event audit bersifat append-only. Runtime tidak memiliki UPDATE/DELETE pada tabel tersebut; retensi memanggil hanya fungsi DB `SECURITY DEFINER` dengan search path tetap dan jumlah hapus terbatas.
- Batasi autentikasi ingest ke `Authorization: Bearer`. Tidak ada secret di cookie, query string, maupun body. Batasi parser route ingest 128 KiB; parser 100 KB untuk route lain tidak berubah.
- Jangan menambah driver, vendor/protokol, konversi unit, grafik, threshold, alert, AI/RAG, kontrol hardware, ataupun mutasi stok, biaya, HPP, ledger, jadwal, siklus, dan panen.
- Gunakan schema migration `014_iot_telemetry.sql`; jangan mengubah migration yang telah ada.
- Semua error API memakai envelope aman `{error:{code,message,requestId}}`. Batas rate mengembalikan 429 dengan `Retry-After`; body ingest terlalu besar mengembalikan 413.
- Tidak ada klaim bahwa migrasi, tes PostgreSQL, atau deployment berhasil sebelum perintah verifikasi benar-benar dijalankan.

## Files

- Create: `db/migrations/014_iot_telemetry.sql`, `src/modules/iot/contracts.ts`, `src/modules/iot/service.ts`, `src/modules/iot/queries.ts`, `src/modules/iot/ingest.ts`, `src/modules/iot/retention.ts`, `src/client/devices.tsx`, `tests/iot.test.ts`, `tests/postgres/iot.test.ts`.
- Modify: `db/runtime-grants.sql`, `src/server/command.ts`, `src/server/app.ts`, `src/server/main.ts`, `src/server/local-preview-main.ts`, `src/shared/errors.ts`, `src/client/routes.ts`, `src/client/main.tsx`, `src/client/farms.tsx` (shared `request` options only), `src/client/styles.css`, `docs/implementation-roadmap.md`, `docs/feature-status.md`, `docs/verification.md`, and the approved P3-01 spec status line.

## Review Focus

1. Respons create/rotate hilang setelah transaksi commit: replay dengan key sama tidak boleh mengeluarkan token; receipt tidak mengandung secret; UI memberi jalan rotasi dengan key baru. Uji melalui `tests/iot.test.ts` dan endpoint API.
2. Batch berisi bacaan baru lalu ID yang sudah ada dengan payload berbeda: hasil harus 409, semua bacaan baru dari batch tersebut rollback, dan jatah request limiter tetap terpakai. Uji atomisitas dan receipt per input di `tests/iot.test.ts`.
3. Batas waktu tepat `now - 90 days` dan `now + 5 minutes`, presisi decimal maksimum, quality `INVALID`, serta bacaan datang di luar urutan: batas inklusif benar, precision tidak melewati JavaScript `number`, dan bacaan INVALID tidak tampil sebagai latest operasional. Uji validator dan query.
4. Ingest paralel dari dua koneksi bersamaan dengan rate limit, rotasi, atau pencabutan: tidak boleh melewati bucket 120/menit, memakai token lama setelah commit rotasi, atau menyimpan bacaan setelah pencabutan menang. Uji pada `tests/postgres/iot.test.ts`.
5. Perangkat, unit, dan metric dari farm berbeda atau metric/unit yang tidak didaftarkan: tidak boleh membuat atau membaca telemetry lintas farm; kegagalan tidak membocorkan detail registry asing. Uji service, FK, dan route.

---

## Implementation Steps

### 1. Kontrak input, output, dan normalisasi

- [ ] **Test first:** buat `tests/iot.test.ts` untuk `acceptsReadingBatchWithinBounds`, `acceptsInclusiveTimestampBoundsAndRejectsOutside`, `rejectsMalformedOrOversizedBatch`, `rejectsTenantAuthorityFields`, `acceptsDecimalPrecisionAndRejectsOverflow`, `normalizesDecimalWithoutFloatingPoint`, `requiresOffsetTimestamp`, `defaultsQualityToGood`, dan `rejectsUnknownQuality`.
- [ ] Buat `src/modules/iot/contracts.ts` berisi schema Zod strict untuk `DeviceCreateInput`, `DeviceRenameInput`, `DeviceMetricsInput`, `ReadingBatch`, `ReadingInput`, cursor/limit halaman, DTO `DeviceSummary`, `DeviceList`, dan `IngestResult`.
- [ ] Tetapkan fungsi pure yang dapat diuji `canonicalDecimal(value: string): string` serta `validateObservedAt(value: string, databaseNow: Date): Date`; jangan mengubah decimal menjadi JS `number`. Pertahankan batas regex dan ukuran sesuai spec.
- [ ] Ingest DTO hanya menerima `reading_id`, `metric`, `unit`, `value`, `observed_at`, dan `quality` opsional. Unknown key ditolak, termasuk farm, unit fisik, device ID, dan `received_at`.
- [ ] Jalankan `npx tsx --test tests/iot.test.ts`. Hasil yang diharapkan: seluruh kasus kontrak/normalisasi lulus sebelum service ditambahkan.

### 2. Migration dan least-privilege database

- [ ] **Test first:** tambahkan tes migration/database ke `tests/iot.test.ts`: pasangan farm/unit wajib cocok, pasangan metric/unit wajib terdaftar, reading ID unik per perangkat selama retensi, enum status/quality menolak nilai lain, dan purge hanya menyasar bacaan expired.
- [ ] Buat `db/migrations/014_iot_telemetry.sql` dengan `farm_device`, `farm_device_metric`, `telemetry_reading`, dan `farm_device_event`. Terapkan FK komposit untuk menjaga `farm_id`, `farm_unit_id`, device, dan konfigurasi metric tetap konsisten; simpan nilai bacaan pada `numeric(18,6)`.
- [ ] Tambahkan index untuk daftar perangkat terurut, lookup bacaan terbaru per farm/unit/metric/unit ukur (`observed_at DESC`, `received_at DESC`, tie-break ID), idempotensi `(device_id, reading_id)`, dan retensi `received_at`.
- [ ] Buat fungsi `purge_expired_telemetry(p_batch_size integer)` yang menolak ukuran di luar 1–1000, menghapus hanya `received_at < clock_timestamp() - interval '90 days'`, mengunci batch dengan `SKIP LOCKED`, dan mengembalikan jumlah yang dihapus. Fungsi dimiliki role migrasi, memakai `SECURITY DEFINER` dengan search path tetap, dan mencabut `EXECUTE` dari `PUBLIC`.
- [ ] Ubah `db/runtime-grants.sql`: runtime hanya mendapat SELECT/INSERT pada event dan reading; UPDATE hanya pada kolom label/status/hash/actor/waktu registry, status metric, dan token bucket yang memang diperlukan. Tidak ada DELETE pada tabel IoT; beri EXECUTE hanya untuk fungsi purge.
- [ ] Uji batas batch purge, pemilihan hanya data kedaluwarsa berdasarkan `received_at`, dan hasil nol ketika tidak ada bacaan lama. Uji privilege runtime, function ACL, konfigurasi search path/SECURITY DEFINER di `tests/postgres/iot.test.ts`. Jalankan `npx tsx --test tests/iot.test.ts`.

### 3. Registry perangkat dan secret sekali tampil

- [ ] **Test first:** tambahkan `createDeviceStoresOnlyHash`, `createDeviceBindsUnitFromSameFarm`, `renameDeviceAppendsEvent`, `metricRetirementKeepsReadings`, `rotateTokenInvalidatesOldToken`, `revokeCannotBeReactivated`, `sameKeyReplayDoesNotReturnSecret`, `sameKeyDifferentPayloadConflicts`, `receiptContainsNoRawToken`, dan `lostSecretCanOnlyBeReplacedByNewRotation` ke `tests/iot.test.ts`.
- [ ] Perluas `src/server/command.ts` dengan helper khusus `commandWithOneTimeSecret<TReceipt,TFirst>(db, context, operation, key, parsedInput, execute)`, dengan `execute(tx)` mengembalikan `{receipt:TReceipt, firstResponse:TFirst}` dan helper mengembalikan `{receipt:TReceipt, firstResponse:TFirst|null, replayed:boolean}`. Simpan hanya `receipt`; replay dengan request hash sama mengembalikan `firstResponse: null`. Service membentuk hasil replay dengan `token: null` dan `secretIssued: false`. Pertahankan lock farm, pemeriksaan membership, arsip, dan conflict semantics dari helper yang ada.
- [ ] Buat operasi registry di `src/modules/iot/service.ts`: `createDevice(db, context, key, input)`, `renameDevice(db, context, deviceId, key, input)`, `setDeviceMetrics(db, context, deviceId, key, input)`, `rotateDeviceToken(db, context, deviceId, key)`, dan `revokeDevice(db, context, deviceId, key)`. Setiap mutasi memakai command receipt dan menambah satu event audit nonrahasia dalam transaksi yang sama.
- [ ] Generate token dengan `randomBytes(32).toString("base64url")`; persist hanya SHA-256. Binding farm/unit immutable. Rotasi mengganti hash atomik, revoke menghentikan ingest, device revoked tidak dapat diaktifkan lagi, dan konfigurasi metric yang dinonaktifkan tetap tersimpan agar FK histori bacaan valid.
- [ ] Buat `listDevices(db, actorId, farmId, {cursor,limit})` di `src/modules/iot/queries.ts`. Query harus membership-scoped, default 50/maksimum 100, tidak mengembalikan hash token, dan menyertakan `last_received_at` dari bacaan mana pun tanpa menafsirkan nilai sebagai latest operasional.
- [ ] Jalankan `npx tsx --test tests/iot.test.ts`. Hasil yang diharapkan: replay secret dan isolasi farm lulus; receipt database tidak berisi string token yang dikeluarkan pada pemanggilan pertama.

### 4. Ingest idempoten, timestamp, dan limiter lintas proses

- [ ] **Test first:** tambahkan `storesReadingsWithServerReceivedAt`, `identicalReplayIsDuplicate`, `conflictingReadingIdRollsBackButConsumesRateToken`, `invalidBatchStoresNothing`, `invalidQualityExcludedFromOperationalLatest`, `lateReadingRemainsHistorical`, dan `authenticatedRejectionCommitsLimiterState` ke `tests/iot.test.ts`.
- [ ] Implementasikan middleware `authenticateAndConsumeRateLimit(db)` di `src/modules/iot/ingest.ts`. Sebelum parser body, hash bearer token, cari registry aktif, lock baris perangkat, perbarui token bucket, lalu commit. Respons 401 tidak membedakan token hilang, tidak dikenal, atau dicabut; 429 membawa `Retry-After` dan menghentikan pipeline sebelum parsing body.
- [ ] Implementasikan `ingestReadings(db, bearerToken, input): Promise<IngestResult>` di file yang sama. Pada transaksi penyimpanan, lock perangkat lagi serta pastikan token hash/status masih cocok sebelum memeriksa metric dan menyimpan bacaan.
- [ ] Ambil satu `clock_timestamp()` dari database per batch; validasi `observed_at <= now + 5 menit` dan `observed_at >= now - 90 hari` secara inklusif. Simpan `received_at` database-side saat insert. Tolak metric/unit yang tidak persis cocok dengan konfigurasi aktif perangkat.
- [ ] Dalam transaksi limiter, kunci baris perangkat `FOR UPDATE`, refill token bucket persisted hingga kapasitas 120 pada laju 2 token/detik, dan konsumsi satu token per request. Jika bucket kosong, commit waktu refill terbaru lalu kembalikan 429 dengan `Retry-After`. Transaksi penyimpanan batch terpisah sehingga conflict tidak dapat membatalkan debit rate.
- [ ] Bandingkan replay memakai payload kanonis (metric, unit, decimal ternormalisasi, instant, quality default). Retry identik berstatus duplicate. ID sama dengan payload berbeda memberi 409 setelah transaksi menyimpan state limiter; tidak satu pun row bacaan baru pada batch itu boleh commit. Batch sukses memasukkan semua baris baru secara atomik.
- [ ] Query latest operasional mengecualikan `INVALID`, urut berdasarkan observed time, received time, lalu ID. Query histori tetap menyertakan kualitas dan urutan historis; data terlambat tidak mengganti bacaan lain.
- [ ] Jalankan `npx tsx --test tests/iot.test.ts`. Hasil yang diharapkan: batas waktu/angka tepat, idempotensi batch, kualitas, dan penolakan yang mengonsumsi rate teruji.

### 5. API manajemen dan machine ingest

- [ ] **Test first:** lengkapi `tests/iot.test.ts` dengan `memberCanManageFarmDevices`, `deviceMutationRequiresSessionAndCsrf`, `unauthenticatedManagementIsRejected`, `foreignFarmIsDeniedWithoutDetails`, `unregisteredMetricReturns422`, `revokeStopsIngest`, `ingestRequiresBearerHeader`, `ingestParserUses128KiBLimit`, dan `largeBodyReturns413`.
- [ ] Tambahkan `/api/farms/:farmId/devices` GET/POST, `/:deviceId` PATCH, `/:deviceId/metrics` PUT, `/:deviceId/token/rotate` POST, dan `/:deviceId/revoke` POST pada `src/server/app.ts`. Semua mutasi membaca `Idempotency-Key`, mewajibkan aktor session/CSRF dan membership farm, dan tidak menerima actor/farm authority dari body.
- [ ] Pasang `POST /api/iot/v1/readings` dengan urutan `authenticateAndConsumeRateLimit(db)`, `express.json({limit:"128kb"})`, lalu handler ingest—semuanya sebelum parser 100 KB umum dan middleware `/api` session/CSRF. Dengan urutan ini JSON rusak dan body terlalu besar dari bearer valid tetap dihitung rate. Hanya route ini menggunakan bearer token perangkat; jangan mencatat Authorization/body.
- [ ] Tambahkan error aman `RATE_LIMITED` (429) dan `PAYLOAD_TOO_LARGE` (413) di `src/shared/errors.ts`. `RateLimitedError` membawa integer `retryAfterSeconds`; handler error app menetapkan header `Retry-After` dan mempertahankan envelope error, serta memetakan `entity.too.large` ke envelope 413. Route lain mempertahankan limit parser 100 KB.
- [ ] Jalankan `npx tsx --test tests/iot.test.ts`. Hasil yang diharapkan: status HTTP, error envelope, parser order/limit, CSRF pada command browser, token bearer, dan farm scoping lulus.

### 6. Sweep retensi dengan batch terbatas

- [ ] **Test first:** tambahkan `retentionSweepUsesOnlyDatabaseFunction`, `retentionSweepIsBounded`, dan `retentionWorkerStopsCleanly` ke `tests/iot.test.ts`.
- [ ] Buat `src/modules/iot/retention.ts` dengan `runTelemetryRetentionTick(db, batchSize = 1000)` yang hanya memanggil fungsi DB. Tambahkan worker kecil yang menjalankan sweep saat start, mengulang setelah 60 detik bila satu batch penuh, dan kembali ke interval harian setelah backlog habis; `stop` membatalkan timer.
- [ ] Jalankan worker dari `src/server/main.ts` dan `src/server/local-preview-main.ts` lalu hentikan bersama worker notification saat shutdown. Jangan memberi jalur SQL `DELETE` tabel kepada worker.
- [ ] Jalankan `npx tsx --test tests/iot.test.ts`. Hasil yang diharapkan: satu tick menghapus maksimal batch yang diberikan dan stop tidak menjadwalkan tick berikutnya.

### 7. Halaman registry perangkat

- [ ] **Test first:** pertahankan tes API service di langkah 5 sebagai kontrak UI; jalankan typecheck/build setelah halaman selesai. Tidak menambah framework test UI baru.
- [ ] Tambahkan `/devices` pada `src/client/routes.ts`, pemetaan ikon `activity` yang sudah ada, dan route/import pada `src/client/main.tsx`; kelompokkan di Operasional serta gunakan shell dan pola halaman farm yang ada.
- [ ] Buat `src/client/devices.tsx` dengan list responsif, cursor paging, farm aktif, tambah/ubah nama, konfigurasi metric/unit, rotasi token, cabut, loading/error/retry/empty states, serta konfirmasi revoke. Perluas helper `request` di `src/client/farms.tsx` dengan opsi header agar command dapat mengirim CSRF dan `Idempotency-Key`.
- [ ] Tambahkan hanya style yang dibutuhkan pada `src/client/styles.css`; gunakan token warna, komponen, dan breakpoint OpSmart yang tersedia.
- [ ] Tampilkan token hanya pada dialog create/rotate pertama; simpan sementara di state komponen saja, bersihkan saat dialog ditutup/unmount, sediakan salin, dan tampilkan instruksi rotasi baru bila respons replay memiliki `secretIssued: false`. Jangan simpan secret ke storage browser.
- [ ] Halaman menampilkan nama, unit, status, pasangan metric/unit, dan waktu bacaan terakhir; tidak membuat grafik, threshold, stale alert, atau panel kontrol sensor.

### 8. Verifikasi lintas koneksi, build, dan dokumentasi

- [ ] **Test first:** buat `tests/postgres/iot.test.ts` memakai pola schema terisolasi dari `tests/postgres/concurrency.test.ts`. Tutup kasus `twoConnectionsShareDeviceBucket`, `concurrentIngestAndRevokeHasOneSerializedOutcome`, `oldTokenFailsAfterRotationCommit`, `foreignDeviceMetricCannotCrossFarm`, `purgeFunctionDeletesAtMostBatch`, dan function ACL/search-path.
- [ ] Jalankan `npx tsx --test tests/iot.test.ts`; hasil yang diharapkan: seluruh tes PGlite/HTTP lulus.
- [ ] Dengan `TEST_DATABASE_URL` yang menunjuk database disposable bernama mengandung `test`, jalankan `npx tsx --test tests/postgres/iot.test.ts`, lalu `npm run test:postgres`. Hasil yang diharapkan: migrasi 001–014 fresh, konkurensi dan limiter serial, retensi terbatas, schema test dibersihkan. Jika URL tidak tersedia, laporkan integration coverage sebagai belum diverifikasi; jangan menyatakan lulus.
- [ ] Jalankan `npm run test`, `npm run build`, dan `npm run format:check`. Hasil yang diharapkan: suite lokal, typecheck, Vite/server build, dan format seluruhnya lulus.
- [ ] Perbarui `docs/implementation-roadmap.md`, `docs/feature-status.md`, dan `docs/verification.md` hanya dengan hasil aktual; status P3-01 boleh dinyatakan tersedia lokal setelah implementasi lulus, sementara deployment produksi dan kompatibilitas perangkat tetap belum diverifikasi.
- [ ] Tinjau halaman `/devices` melalui preview pada desktop dan lebar ponsel: empty, loading, error/retry, konfigurasi, respons token satu kali, replay tanpa token, serta konfirmasi revoke.

## Acceptance Checklist

- Semua endpoint registry memeriksa session, CSRF untuk mutasi, membership farm, dan ID unit/perangkat/metric dalam scope farm.
- Ingest hanya menerima bearer token, membatasi body 128 KiB dan 100 bacaan, menegakkan 120 request/menit dengan bucket persisten, dan mengembalikan `Retry-After` saat 429.
- Token raw hanya tampil dari operasi pertama create/rotate; hash tersimpan unik dan receipt/event/log tidak memuat raw token.
- Replay bacaan identik aman; ID/payload berbeda memberi 409 dan seluruh batch bacaan baru rollback. Bacaan INVALID tersimpan untuk audit namun tidak menjadi latest operasional.
- Farm/device/unit/metric tidak dapat disilangkan; bacaan append-only dapat ditelusuri ke actor/device/metric/waktu/kualitas; cleanup hanya memakai fungsi purge berizin khusus.
- UI responsif mengikuti shell OpSmart dan tidak mengklaim dukungan vendor, alert, kontrol, ataupun efek keuangan/operasional.
