# P3-02 — Monitoring dan threshold alerts

**Status:** implementasi lokal pada branch codex/p3-02-monitoring-threshold-alerts telah melewati review statis kedua. Empat koreksi review terakhir belum diuji ulang; verifikasi PostgreSQL serta beberapa smoke test manual masih tertunda.

> **Untuk pelaksana:** pemilik menyetujui implementasi pada 2026-10-02. Ikuti tahapan dan batas pada rencana ini. Jangan push atau merge tanpa instruksi eksplisit.

**Tujuan:** memberi anggota farm bacaan telemetry, histori yang dapat ditelusuri, dan alert dengan sebab yang jelas. Alert hanya bersumber dari batas atau timeout yang dikonfigurasi. Alert tidak mengubah operasi farm.

**Desain:** gunakan transaksi, membership, command receipt, worker outbox, query keyset, React dashboard shell, dan gaya PGlite/PostgreSQL yang sudah ada. Ingest mengevaluasi threshold sesudah bacaan baru tersimpan dan sebelum transaksi commit. Evaluasi timeout stale berjalan pada worker notifikasi sekitar tiap 60 detik. Konfigurasi diberi versi; setiap episode punya transisi append-only dan satu event outbox. Tidak menambah dependency atau provider.

**Spesifikasi:** docs/superpowers/specs/2026-10-02-p3-02-monitoring-threshold-alerts.md

## Batas implementasi

- Ikuti aturan nilai batas strict, unit exact, kualitas GOOD, bacaan out-of-order, pemulihan, stale, inbox, dan retensi pada spesifikasi.
- Semua anggota farm dapat mengatur konfigurasi. Membership session menjadi otoritas; token perangkat hanya untuk ingest.
- Gunakan migration baru 015_iot_alerts.sql. Jangan mengubah migration 001–014.
- Pertahankan telemetry_reading append-only. Tidak ada konversi unit, hysteresis, polling browser, WebSocket, AI, tindakan otomatis, email/SMS, atau mutasi ledger.
- Satu row perangkat dikunci ketika ingest, konfigurasi, atau worker mengevaluasi perangkat tersebut. Ikuti urutan lock yang sama untuk menghindari race konfigurasi/ingest/worker.
- Duplikat ingest tidak menghasilkan transisi/event baru. Operasi konfigurasi memakai Idempotency-Key dan command helper yang sudah ada.
- Episode lama yang pulih sebelum outbox terkirim tetap menghasilkan satu inbox alert berstatus selesai setelah worker fan-out.
- Retensi 90 hari menghapus episode selesai, transisinya, dan notifikasi sesuai aturan di spec. Episode yang masih terbuka tetap ada. Config version menjadi audit metadata dan dipertahankan selama masih menjadi versi aktif atau dirujuk histori yang disimpan.
- Error tetap memakai envelope aman dan query selalu farm-scoped.

## Berkas dan interface

Buat:

- db/migrations/015_iot_alerts.sql
- src/modules/iot/alerts.ts
- src/modules/notifications/outbox.ts
- tests/iot-alerts.test.ts

Ubah:

- db/runtime-grants.sql
- src/modules/iot/contracts.ts
- src/modules/iot/ingest.ts
- src/modules/iot/queries.ts
- src/modules/iot/service.ts
- src/modules/notifications/contracts.ts
- src/modules/notifications/worker.ts
- src/server/app.ts
- src/client/devices.tsx
- src/client/notifications.tsx
- src/client/styles.css
- tests/iot.test.ts
- tests/notifications.test.ts
- tests/postgres/iot.test.ts
- docs/implementation-roadmap.md
- docs/feature-status.md
- docs/architecture.md
- docs/verification.md

Kontrak yang dihasilkan:

- setDeviceMetricAlertConfig(db, context, deviceId, idempotencyKey, input) membuat versi konfigurasi berikutnya dan mengevaluasi ulang bacaan GOOD terbaru dalam transaksi yang sama.
- evaluateThresholdAlerts(tx, device, metricPairs, now) memproses hanya bacaan GOOD terbaru untuk pasangan metric/unit yang disentuh, menutup atau membuka episode dan menambah transisi/outbox secara atomik.
- materializeStaleAlerts(tx, now) memeriksa batch konfigurasi aktif tanpa mengunci seluruh farm, lalu membuka atau memulihkan episode stale.
- listTelemetryReadings(db, actorId, farmId, deviceId, query) dan listDeviceAlerts(db, actorId, farmId, deviceId, query) memeriksa membership dan keterikatan perangkat sebelum membaca halaman ber-cursor.
- API config: PUT /api/farms/:farmId/devices/:deviceId/metrics/:metric/alert-config; body memuat unit, low, high, dan staleAfterSeconds.
- API histori: GET /api/farms/:farmId/devices/:deviceId/readings?metric=&unit=&cursor=&limit= dan GET /api/farms/:farmId/devices/:deviceId/alerts?cursor=&limit=.

## Langkah implementasi

### 1. Kontrak dan evaluator murni

- [x] **Tes dulu** di tests/iot-alerts.test.ts: batas bawah/atas strict, nilai tepat di batas, batas tunggal, tanpa batas, validasi low < high, decimal tanpa konversi ke JS number, unit exact, stale 60..7_776_000 detik atau kosong, serta kualitas bukan GOOD.
- [x] Tambahkan schema Zod strict dan tipe untuk konfigurasi alert, kondisi (LOW, HIGH, STALE), transisi, pembacaan histori, dan cursor.
- [x] Buat fungsi evaluator murni untuk menentukan kondisi low/high dan transisi pulih. Jangan memasukkan query database, waktu sistem tersembunyi, konversi satuan, atau hysteresis ke fungsi tersebut.
- [x] Jalankan tes terfokus dan pastikan kasus batas gagal sebelum implementasi, kemudian lulus setelah evaluator tersedia.

### 2. Migration dan least privilege

- [x] **Tes dulu** di tests/iot.test.ts: default tidak membuat alert, kendala batas, versi konfigurasi unik per perangkat/metric/unit, satu episode terbuka per kondisi, hubungan farm/device/metric konsisten, dan transisi tidak dapat diubah.
- [x] Tambahkan tabel versi konfigurasi, episode aktif/selesai, serta transisi append-only. Simpan snapshot nilai batas, source reading ID/nilai/unit/waktu, alasan buka/tutup, versi config, dan actor bila berasal dari perubahan anggota.
- [x] Tambahkan unique partial index yang menjamin satu episode terbuka untuk (device, metric, unit, condition) dan index untuk latest/config/retention queries.
- [x] Perluas constraint notification_outbox.event_type dengan satu jenis IOT_ALERT; jangan mengubah event yang sudah ada.
- [x] Beri runtime hanya hak yang diperlukan: insert versi/transisi; baca konfigurasi/episode; update kolom resolusi episode; dan gunakan fungsi SECURITY DEFINER dengan search path tetap untuk menghapus batch episode selesai yang sudah lewat 90 hari. Transisi terkait dihapus hanya melalui retensi.
- [x] Pertahankan episode terbuka walau sudah berumur 90 hari. Jangan hapus config version yang aktif atau masih dirujuk episode yang dipertahankan.
- [x] Terapkan semua migration melalui harness PGlite; constraint/FK lulus di PGlite. Grant dan perilaku PostgreSQL tetap menunggu TEST_DATABASE_URL.

### 3. Layanan konfigurasi dan transisi episode

- [x] **Tes dulu**: semua anggota farm yang sah dapat mengatur config; farm/device asing ditolak; payload lintas metric/unit ditolak; key idempotensi yang sama mengembalikan hasil sama; key sama dengan payload berbeda menghasilkan conflict.
- [x] Implementasikan setDeviceMetricAlertConfig dengan pola command receipt yang ada. Lock perangkat, verifikasi membership/farm, pastikan metric/unit terdaftar dan aktif, tulis versi baru, lalu tutup episode versi lama dengan CONFIG_CHANGED.
- [x] Dalam transaksi itu evaluasi ulang bacaan GOOD terbaru terhadap versi baru. Config seluruhnya kosong berarti tidak dipantau dan menyelesaikan episode yang terbuka; bila nilai terbaru masih melanggar, buat episode baru dengan versi baru.
- [x] Implementasikan pembukaan/pemulihan episode dan transisi append-only. Simpan snapshot sumber agar riwayat tetap bisa dibaca setelah telemetry sumber melewati retensi.
- [x] Saat metric dinonaktifkan atau device dicabut, tutup episode terkait dengan alasan yang tepat dan selesaikan event/inbox terkait tanpa menghapus histori.

### 4. Integrasi ingest dan outbox atomik

- [x] **Tes dulu** di tests/iot.test.ts: satu breach membuka satu episode/event; duplikat tidak menggandakan; nilai batas tidak breach; nilai pulih menutup episode; SUSPECT/INVALID tidak membuka, memulihkan, atau memperbarui threshold; bacaan terlambat tidak menimpa bacaan GOOD lebih baru.
- [x] Ekstrak addOutboxEvent ke src/modules/notifications/outbox.ts agar worker dan evaluator memakai kontrak idempotensi yang sama tanpa dependensi melingkar.
- [x] Sesudah seluruh bacaan baru batch tersimpan, evaluasi pasangan metric/unit yang tersentuh menggunakan urutan latest deterministik (observed_at, received_at, id). Pertahankan transaksi dan lock perangkat yang sudah dimiliki ingestReadings.
- [x] Hanya buat outbox event saat episode baru dibuka. Gunakan event_key stabil dari episode ID. Pada recovery/configuration/device change, set resolved_at pada event dan semua salinan inbox; jangan kirim event recovery kedua.
- [x] Jika event belum dikirim saat episode selesai, pastikan worker tetap mengirim satu salinan yang sudah memiliki resolved_at.
- [x] Uji batch campuran reading baru dan duplikat; kegagalan batch tetap rollback seluruh writing/episode/outbox sesuai kontrak ingest yang ada.

### 5. Evaluasi stale, worker, histori dan API

- [x] **Tes dulu** di tests/notifications.test.ts: timeout kosong nonaktif; tepat pada timeout membuka stale; GOOD yang masih segar memulihkan; SUSPECT/INVALID tidak memulihkan; tanpa GOOD, umur dimulai saat timeout aktif; tick berulang tidak menggandakan event.
- [x] Implementasikan materializeStaleAlerts di worker tick sebelum outbox di-drain. Batas evaluasi per tick dan FOR UPDATE SKIP LOCKED menjaga worker yang bersaing tetap aman.
- [x] Dasarkan freshness pada observed_at latest GOOD. Jika belum ada bacaan GOOD, mulai dari created_at versi config aktif. Stale terbuka ketika umur mencapai timeout; pemulihan terjadi hanya jika umur kurang dari timeout.
- [x] Selesaikan inbox episode yang pulih, fan-out ke semua anggota aktif, dan pertahankan read state per anggota. Tambahkan pruning episode selesai/transisi dan gunakan fungsi DB yang dibatasi.
- [x] Tambahkan query keyset untuk histori bacaan dan alert. Cursor memakai urutan stabil; limit dibatasi; bacaan histori tetap menyertakan semua quality; halaman alert memuat episode aktif dan histori dalam retensi.
- [x] Daftarkan tiga route farm-scoped di src/server/app.ts. Semua route memakai actor dari session, membership, validasi UUID/query/body, dan memastikan device berada di farm path.
- [x] Uji cursor, batas limit, config command, reading/alert history, response error aman, outbox fan-out, recovery dan isolasi farm.

### 6. UI halaman perangkat

- [x] Tambahkan kontrol per pasangan metric/unit di src/client/devices.tsx: nilai minimum/maksimum opsional dan timeout stale opsional. Gunakan field desimal teks agar presisi tidak melewati JS number; tampilkan unit sebagai bagian label.
- [x] Tampilkan jelas “Tidak dipantau” untuk batas/timeout kosong, versi config aktif, actor/waktu perubahan, latest reading beserta GOOD/SUSPECT/INVALID, dan umur bacaannya.
- [x] Tambahkan bagian histori bacaan berpaginasi dan episode aktif/selesai dengan sumber, alasan, batas snapshot, waktu, dan tautan perangkat dari inbox.
- [x] Perbarui renderer inbox untuk IOT_ALERT; link kembali ke perangkat dan tampilkan status selesai tanpa membuat event recovery terpisah.
- [x] Sediakan loading, empty, error/retry, submit pending, fokus keyboard, label/screen reader, dan layout ponsel tanpa overflow. Jangan menambah grafik atau polling.
- [x] Periksa preview terisolasi /devices dengan metric/config sintetis dan /notifications pada empty state.
- [ ] Smoke test manual farm kosong, quality INVALID, simpan config sampai episode selesai, API failure/retry, refresh, dan viewport ponsel masih tertunda.

### 7. Konkurensi PostgreSQL dan penutupan task

- [x] Tambahkan tes ke tests/postgres/iot.test.ts: konkurensi ingest vs config menghasilkan satu urutan serial; ingest vs worker tidak menggandakan episode/outbox; dua worker stale tidak menggandakan event; isolasi farm; grant runtime tidak dapat mengubah transition atau menghapus histori di luar fungsi retensi.
- [x] Pemeriksaan terfokus, npm test (138/138), typecheck, build, dan Prettier terarah sempat lulus sebelum empat koreksi review terakhir. Hasil tersebut belum diulang setelah koreksi; format:check seluruh repo gagal pada 128 berkas lama yang tidak terformat.
- [x] Jalankan npm run test:postgres; dua berkas tes dilewati karena TEST_DATABASE_URL tidak tersedia. PostgreSQL dinyatakan belum terverifikasi.
- [x] Perbarui roadmap, status fitur, arsitektur dan catatan verifikasi. Catat batas worker sekitar 60 detik, tidak ada hardware/provider, dan kondisi verifikasi PostgreSQL.
- [x] Jangan push, merge, atau mengaktifkan perangkat fisik sebagai bagian dari task ini.

## Persetujuan pemilik

Pemilik menyetujui rencana ini dengan instruksi “setuju mulai implementasi” pada 2026-10-02.
