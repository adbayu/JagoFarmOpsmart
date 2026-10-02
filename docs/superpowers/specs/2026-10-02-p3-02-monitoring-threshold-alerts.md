# P3-02 — Monitoring dan threshold alerts

**Status:** spesifikasi disetujui 2026-10-02; implementasi berjalan berdasarkan rencana yang disetujui.

## Tujuan

Anggota farm dapat melihat bacaan perangkat, riwayat telemetry, dan alert yang
memiliki penyebab yang jelas. Alert hanya dibuat dari threshold atau timeout
yang dikonfigurasi secara eksplisit. Data telemetry tetap append-only dan alert
tidak menjalankan perubahan operasional.

## Keputusan desain yang disetujui

- Threshold diatur per perangkat dan pasangan metric/unit yang sudah terdaftar.
- Batas bawah, batas atas, dan timeout stale tidak memiliki nilai bawaan.
  Threshold kosong berarti tidak ada alert threshold; timeout stale kosong
  berarti pemeriksaan stale nonaktif.
- Sistem tidak mengonversi satuan. Angka threshold harus memakai unit yang sama
  persis dengan metric perangkat.
- Hanya bacaan `GOOD` yang menjadi dasar perubahan status alert. `SUSPECT` dan
  `INVALID` tetap terlihat pada riwayat, tetapi tidak membuka, memulihkan, atau
  memperpanjang umur freshness alert.
- Bacaan terlambat atau di luar urutan tetap disimpan, tetapi tidak mengubah
  status alert jika tidak lebih baru dari bacaan `GOOD` yang sudah dievaluasi.
- Satu episode terbuka per kondisi threshold dan per metric. Episode berakhir
  saat kondisi pulih; pelanggaran berikutnya membuka episode baru.
- Timeout stale diperiksa oleh worker notifikasi yang sudah ada, sekitar satu
  kali per 60 detik. UI tidak mengklaim pembaruan realtime.
- Alert dikirim lewat inbox in-app untuk anggota farm. Status dibaca tetap per
  anggota; tidak ada email atau SMS.
- Halaman perangkat menampilkan bacaan terbaru, umur bacaan, kualitas, dan
  histori bacaan yang dapat ditelusuri per halaman.

## Aturan threshold

Konfigurasi berlaku pada `(farm, device, metric, unit)` dan dapat memiliki batas
bawah, batas atas, keduanya, atau tidak keduanya. Jika kedua batas diisi, batas
bawah harus lebih kecil dari batas atas. Nilai disimpan sebagai decimal tanpa
konversi satuan.

- Kondisi bawah terbuka saat nilai `GOOD` lebih kecil dari batas bawah dan pulih
  saat nilainya mencapai atau melewati batas bawah.
- Kondisi atas terbuka saat nilai `GOOD` lebih besar dari batas atas dan pulih
  saat nilainya mencapai atau berada di bawah batas atas.
- Nilai tepat pada batas tidak dianggap melanggar.
- MVP tidak memakai hysteresis. Perubahan perilaku ini memerlukan revisi aturan
  yang ditinjau pemilik.
- Bacaan diproses sesuai urutan deterministik yang sudah dipakai query latest:
  `observed_at`, lalu `received_at`, lalu ID bacaan. Bacaan yang lebih lama
  disimpan di histori tetapi tidak boleh menimpa status yang lebih baru.
- Membuka atau memulihkan episode menyimpan ID, nilai, unit, kualitas, dan waktu
  bacaan sumber serta snapshot versi/batas threshold yang berlaku.

Jika threshold diubah, episode yang memakai konfigurasi lama ditutup dengan
alasan `CONFIG_CHANGED`. Dalam transaksi yang sama, konfigurasi baru dievaluasi
terhadap bacaan `GOOD` terbaru. Jika nilai masih melanggar batas baru, episode
baru dibuat dengan versi konfigurasi baru. Menonaktifkan metric atau mencabut
perangkat menutup episode terkait tanpa menghapus histori.

## Aturan stale

Timeout stale disimpan per pasangan metric/unit sebagai jumlah detik, dengan
rentang konfigurasi MVP 60 detik sampai 90 hari. Nilai kosong berarti nonaktif.
Worker menggunakan bacaan `GOOD` terbaru berdasarkan `observed_at`; bila belum
ada bacaan `GOOD`, hitung umur sejak timeout stale diaktifkan. Episode stale
terbuka saat umur mencapai timeout dan pulih saat tersedia bacaan `GOOD` baru
yang masih berada di dalam jendela freshness. Bacaan `SUSPECT` atau `INVALID`
tidak memulihkan stale.

Worker berjalan kira-kira per 60 detik. Waktu alarm dapat terlambat sampai satu
siklus worker ditambah waktu antrean; sistem tidak menjanjikan notifikasi
seketika.

## Episode dan notifikasi

Simpan konfigurasi berversi, episode aktif/selesai, dan histori transisi
append-only. Kendala unik di basis data memastikan hanya ada satu episode
terbuka untuk tiap `(device, metric, unit, condition)`. Episode merekam alasan
buka/tutup, konfigurasi/threshold version, sumber bacaan atau waktu evaluasi
stale, serta actor jika perubahan berasal dari konfigurasi anggota.

Saat episode terbuka, satu event outbox idempoten dibuat dalam transaksi yang
sama dengan perubahan episode. Worker P2-06 mengirimkannya kepada anggota farm
aktif. Saat episode pulih atau ditutup karena konfigurasi/perangkat berubah,
event dan salinan inbox ditandai selesai melalui `resolved_at`; MVP tidak
mengirim kartu recovery kedua. Setiap anggota tetap membaca atau menutup
notifikasi secara independen.

Jika sebuah episode pulih sebelum event outbox terkirim, worker tetap membuat
notifikasi yang sudah berstatus selesai, sehingga histori episode tidak hilang.
Sumber notifikasi menunjuk ke ID episode dan tautan menuju halaman perangkat.
Retensi episode, transisi, dan notifikasi mengikuti batas 90 hari yang telah
digunakan telemetry dan inbox.

## API dan UI

- `PUT /api/farms/:farmId/devices/:deviceId/metrics/:metric/alert-config`
  memperbarui batas dan timeout stale untuk unit terdaftar. Body tidak boleh
  menentukan actor atau farm lain. Gunakan `Idempotency-Key` dan pola transaksi
  command yang ada.
- `GET /api/farms/:farmId/devices/:deviceId/readings` menerima pasangan metric/
  unit dan cursor/limit untuk histori bacaan.
- `GET /api/farms/:farmId/devices/:deviceId/alerts` menampilkan episode aktif
  dan histori episode perangkat.
- Semua endpoint memverifikasi sesi dan membership farm di server serta
  memastikan perangkat berada pada farm di path.
- UI `/devices` mengikuti shell dashboard. Anggota dapat mengatur threshold dan
  stale timeout, membaca kondisi/versi yang berlaku, melihat nilai terbaru
  beserta umur/kualitas, menelusuri histori, dan membuka sumber alert.
- Tampilkan loading, kosong, error dengan coba lagi, batas data, dan perbedaan
  `GOOD`/`SUSPECT`/`INVALID`. Perangkat tanpa threshold atau timeout harus jelas
  terlihat sebagai tidak dipantau untuk kondisi tersebut.
- Refresh dilakukan saat memuat halaman dan lewat kontrol refresh. Tidak ada
  polling browser, WebSocket, klaim realtime, atau alur perangkat tertentu.

## Keamanan dan batas

- Semua anggota farm memiliki kewenangan setara untuk mengatur threshold dan
  timeout; tidak ada matriks role.
- Token perangkat hanya untuk ingest. API konfigurasi dan histori memakai
  session pengguna, bukan bearer token perangkat.
- Evaluasi threshold berjalan di transaksi ingest setelah autentikasi device,
  verifikasi metric aktif, dan validasi bacaan. Duplikat idempoten tidak
  membuat episode atau event baru.
- Evaluasi stale dibatasi pada perangkat aktif dan konfigurasi metric aktif.
- Jangan menambah auto-tindakan, konversi unit, deteksi anomali prediktif,
  notifikasi eksternal, atau kompatibilitas hardware yang belum diuji.

## Penerimaan

1. Threshold tanpa batas tidak membuat alert; batas bawah/atas dapat diatur
   secara independen dan unit tidak dapat dicampur.
2. Nilai pada batas tidak memicu alert; nilai yang melampaui batas membuka satu
   episode; nilai yang kembali ke/dalam batas memulihkannya.
3. Hanya bacaan `GOOD` yang lebih baru memengaruhi threshold. Bacaan ganda,
   terlambat, `SUSPECT`, dan `INVALID` tidak menggandakan atau menimpa episode.
4. Timeout stale nonaktif secara default; timeout aktif memicu satu episode
   setelah umur freshness lewat batas dan pulih setelah bacaan `GOOD` yang segar.
5. Mengubah konfigurasi mencatat versi/actor/waktu, menyelesaikan episode lama,
   dan mengevaluasi ulang bacaan terbaru secara atomik.
6. Event outbox terkirim ke anggota farm dan hanya sekali per episode; status
   baca tetap terpisah per anggota; pemulihan memperbarui resolusi inbox.
7. Query histori dan alert tidak dapat membaca perangkat atau farm lain; cursor
   stabil dan membatasi ukuran halaman.
8. Riwayat, kualitas, error, serta konfigurasi dapat digunakan dengan keyboard
   dan layar ponsel tanpa overflow horizontal.
9. Tes PostgreSQL memverifikasi migrasi, transaksi ingest/outbox, duplikasi,
   konkurensi konfigurasi-ingest-worker, grant runtime, dan isolasi farm.

## Persetujuan dan tahap berikutnya

Pemilik menyetujui spesifikasi ini pada 2026-10-02 dengan instruksi
“lanjutkan”. Rencana implementasi terperinci disimpan di
docs/superpowers/plans/2026-10-02-p3-02-monitoring-threshold-alerts.md dan
menunggu tinjauan pemilik sebelum kode dimulai.
