# Verifikasi terbaru - 2026-10-01

MVP masih parsial. Verifikasi terbaru: `npx tsx --test --test-concurrency=1
tests/*.test.ts` **82 lulus, 0 gagal** pada PGlite; `npm run build` dan
`npm run format:check` lulus.
`npm run format:check` lulus. Finance MVP mencakup uji service/API untuk true-zero HPP,
klasifikasi dan kelengkapan biaya, konsumsi terukur, berat hilang, revenue
payment/refund, pembayaran parsial, interval `[from,toExclusive)`, dan reversal
COGS saat sale dibatalkan. Reversal serta pembayaran menjadi source IDs pada
proyeksi.

PostgreSQL 18.4 lokal lulus verifikasi gabungan Task 20. Database uji terpisah
`opsmart_test` menerima migrasi 001-013 melalui `scripts/migrate.ts`; grant runtime
diterapkan dan privilege matrix mengonfirmasi CONNECT/USAGE/baca-tulis yang dibutuhkan,
penolakan CREATE dan penghapusan farm, keanggotaan migrator yang ditolak, serta proteksi
ledger transfer air dan pembatasan kolom outbox. `npm run test:postgres` lulus 1/1,
0 gagal, 0 skipped pada dua koneksi.

Di sandbox Windows ini `os.userInfo()` menghasilkan `ENOMEM`, sementara direktori Temp
default tidak dapat ditulis. Agar `tsx` dapat menjalankan skrip/test proyek, proses
Node menerima preload sementara dari `.tools` yang memasok username sintetis dan
direktori sementara di workspace yang diizinkan. Tidak ada source/config aplikasi yang
diubah untuk workaround tersebut. Grant SQL dijalankan melalui `pg`; perintah psql-only
`\gexec` untuk CONNECT diganti grant literal khusus `opsmart_test`. Server hanya
dipakai lokal untuk pengujian; browser dengan DB ini dan deployment produksi tidak
diverifikasi.
Tes perjalanan membuat farm ikan dari awal sampai penjualan: buat unit/siklus/
aktivitas, stok pakan, konsumsi, biaya mentah, panen parsial dua grade,
penjualan dari dua lot, proyeksi, dan reversal. Tes PGlite berbasis folder
membuktikan migrasi schema lama ke terbaru, lalu farm dan receipt tetap ada
setelah proses database dibuka ulang. `db/runtime-grants.sql` menyediakan
grant least-privilege. Uji smoke PGlite memvalidasi schema CREATE ditolak,
grant kolom `app_user.display_name`, DELETE subtype, dan penolakan UPDATE/DELETE
ledger; statement database CONNECT sengaja tidak termasuk smoke tersebut.
Penerapan pada PostgreSQL nyata juga memastikan runtime tidak dapat CREATE
schema atau mengubah ledger, tetapi dapat menjalankan operasi auth dan farm.

`npm run dev:server:preview` menjalankan API loopback dengan PGlite tersimpan di
`.pglite/preview`; tes baru memastikan pendaftaran dan sesi tetap ada setelah
database preview dibuka ulang.

Di pratinjau PGlite lokal, alur ikan mencakup panen dua grade, sale, pembatalan
sale, pembayaran parsial, refund, serta penolakan pembatalan sale yang masih
berbayar. Dashboard dan analitik membaca angka SQL aktual. Pada viewport
390 px, dashboard, panen, penjualan dan analitik tidak overflow dokumen.
Dialog pembatalan panen, penjualan, dan pembayaran menampilkan pesan yang
terhubung ke kolom saat alasan kosong. Snapshot aksesibilitas seluruh menu dan
halaman detail tersedia. Traversal Tab pada 14 halaman menu di sesi farm kosong
mencapai kontrol bernama tanpa fokus tersangkut; form pembuatan farm juga dapat
dilalui sampai tombol submit. Pada 2026-09-30, audit UI lanjutan memakai akun dan
farm sintetis pada stack PGlite sementara yang terpisah dari preview utama. Dashboard
menunjukkan tiga unit dan tiga siklus aktif; daftar serta detail unit ikan, ayam,
dan tanaman, daftar/detail siklus, dan observasi siklus menampilkan data/relasi yang
sesuai. Jadwal, persediaan, dan biaya menunjukkan empty state beserta form. Panen,
produk, dan penjualan menjelaskan prasyarat item/produk/stok. Audit UI itu dilakukan
sebelum persetujuan finance; HPP saat itu unavailable karena kebijakan belum ada.
Implementasi finance sesudahnya memiliki tes API/query PGlite, tetapi belum diaudit
ulang secara visual dengan akun sintetis.
Enam
tes transport/status/sesi menguji pesan aman untuk fetch farm/akun yang gagal,
pelestarian status 401/503, serta klasifikasi bahwa hanya 401 berarti keluar. AuthGate menampilkan login hanya
untuk 401 dan panel aman dengan tombol coba lagi untuk kegagalan lain. Simulasi
browser pada stack terisolasi mematikan API: `/me` menampilkan panel “Sesi belum
tersedia”; setelah API hidup kembali, “Coba lagi” mengulang `/me` dan status 401
kembali ke layar masuk. Submit buat kolam saat API mati menampilkan error aman dan
mempertahankan nama/lokasi; setelah API hidup, kirim ulang menyimpan tepat satu
kolam. Klik ganda tombol Buat kolam menghasilkan satu kolam. Audit AST pada 37
call-site mutasi POST/PATCH memastikan semuanya memiliki kunci idempotensi dan
`try/catch`; blok `catch` tidak mengubah draft pengguna atau kunci retry. Perilaku
transport bersama juga tercakup tes otomatis. Basis revenue saat pembayaran
diterima dipilih pada audit awal; kebijakan lengkap kemudian disetujui sebagai
`finance-mvp-v1` dan implementasinya tercakup pada hasil terbaru di atas.

Preview browser PGlite lokal pada 2026-09-30 memiliki sesi aktif tanpa farm.
Form login dan pendaftaran menampilkan label Nama/Email/Kata sandi dan tombol
bernama; urutan Tab login melewati Email, kata sandi, Masuk, lalu Daftar. Menu,
dashboard, farm, unit, siklus, jadwal, persediaan, panen, produk, penjualan,
biaya, HPP, dan analitik diperiksa melalui keyboard pada keadaan farm kosong.

## Catatan fondasi Phase 1 — 2026-09-28

**Status: COMPLETE untuk fondasi Phase 1. MVP belum selesai.**

## Hasil aktual

| Pemeriksaan                                   | Hasil                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run typecheck                             | Lulus, TypeScript strict                                                                                                                                                                                                                                                                                                 |
| npm test                                      | 31 lulus, 0 gagal, 0 skipped; SQL migrations 001–003 diterapkan pada PGlite baru                                                                                                                                                                                                                                         |
| npm run build                                 | Lulus, client Vite dan server tsc; dist/client/index.html dan dist/server/server/main.js tersedia                                                                                                                                                                                                                        |
| npm run format:check                          | Lulus                                                                                                                                                                                                                                                                                                                    |
| npm run test:postgres                         | 1 skipped, 0 dijalankan: TEST_DATABASE_URL tidak tersedia                                                                                                                                                                                                                                                                |
| npm run db:migrate terhadap server PostgreSQL | Belum dijalankan; server/database lokal tidak tersedia                                                                                                                                                                                                                                                                   |
| Visual browser                                | Login, dashboard, menu ponsel, /farms, /farm/fish, /farm/chicken, /farm/crops, dan placeholder /harvest diperiksa pada viewport sempit. Login, dashboard, dan daftar/form ikan juga diperiksa pada viewport desktop; unit demo terlihat melalui API PGlite sementara. Alur browser dengan PostgreSQL belum diverifikasi. |

Revisi visual dashboard diperiksa pada lebar 390 px, 638 px, dan 1600 px.
Jumlah unit diambil dari endpoint farm aktif; kartu siklus, panen, biaya,
jadwal, aktivitas, notifikasi, dan performa saat itu menandai modul yang belum tersedia.
Halaman Jadwal kini tersedia dari Task 08; panel dashboard belum memakai read model aktivitas.
Lima aset gambar baru disimpan di `public/dashboard-*.jpg`.

Build awal terhalang izin baca direktori induk oleh esbuild dalam sandbox. Build diulang
dengan akses yang diizinkan dan berhasil. Instalasi awal cache npm terhalang izin; cache
dipindah ke work/npm-cache, install berhasil. Tidak ada perubahan konfigurasi sistem global.

Tes mencakup enum parity SQL/TS, exact decimals dan rounding, validation dates/quantity/money,
state transitions, consumption commit/retry/conflict, insufficient stock rollback,
cross-farm identity/reference, subtype mismatch, unit mismatch/duplicate lot,
ledger immutability, multi-item sale/replay/server total, rollback baris kedua,
dan penolakan forged identity header. PGlite tidak membuktikan lock contention multi-connection.

Task 01 menambah 6 tes: create/list/get dan replay, penolakan owner asing, update idempoten
termasuk menghapus lokasi, validasi, rollback jika receipt gagal, serta arsip yang menjaga
siklus terkait dan menolak mutasi baru. Task 02 menambah 6 tes: sesi owner dan farm asing,
cookie/header palsu, sesi kedaluwarsa, pembatasan percobaan login, cookie produksi,
origin/CSRF/logout, dan login benar/salah. Build frontend/server, typecheck, serta format
lulus. API runtime sekarang memasang autentikasi akun lokal.

Task 03 menambah 7 tes: tiga subtype dan detail yang sesuai, validasi/duplikasi,
idempotency, rollback parent saat detail gagal, isolasi owner, pelestarian atribut
detail ketika diubah, pembatasan perubahan tipe sesudah siklus, dan arsip yang
menolak siklus PLANNED/ACTIVE sambil menjaga riwayat. UI dasar unit tersedia pada
menu ikan, ayam, dan tanaman.

## Pemeriksaan Task 04 dan penyelarasan UI — 2026-09-28

Build client/server dan pemeriksaan format dijalankan sesudah perubahan Task 04.
Tes otomatis tidak dijalankan pada tahap ini. Di browser pratinjau PGlite lokal,
detail Kolam A1 menampilkan kondisi Pond dan siklus Lele aktif; Kolam B1
menampilkan keadaan siklus kosong. Perubahan kondisi Kolam B1 tetap ada setelah
refresh. Halaman farm, ikan, ayam, tanaman, dan placeholder panen diperiksa pada
viewport ponsel; detail kolam juga diperiksa pada desktop. Pratinjau ini bukan
verifikasi PostgreSQL nyata atau audit semua rute dan aksesibilitas.

## Definition of done mapping

| Kebutuhan Phase 1                  | Bukti                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Inspect existing project           | docs/phase-1-plan.md: workspace kosong, stack lama tidak ada                  |
| Architecture/module boundaries     | docs/architecture.md dan src/modules                                          |
| Domain vocabulary/relationships    | docs/domain-glossary.md, domain-model.md                                      |
| Actual schema/migration            | db/migrations/001_foundation.sql, scripts/migrate.ts                          |
| Shared types/statuses/units        | src/shared/domain.ts, enum parity test                                        |
| Money/unit strategy                | src/shared/decimal.ts, architecture.md                                        |
| Validation/error pattern           | Zod contracts, shared/errors.ts, server/app.ts                                |
| Transaction/idempotency boundaries | server/command.ts, server/db.ts, api-contracts.md                             |
| Inventory ledger                   | immutable SQL ledger + stock_balance view + inventory/ledger.ts               |
| Frontend foundation                | client routes, primitives, CSS, supplied logo                                 |
| Service examples                   | inventory/service.ts, sales/service.ts                                        |
| Test foundation                    | tests/foundation.test.ts dan tests/postgres/concurrency.test.ts               |
| Agent handoff                      | AGENTS.md, 20 task implementation-roadmap.md; Task 01–15 dan 17–19 fungsional |
| Build/typecheck                    | Perintah lulus di atas                                                        |
| Future phases honest               | Tidak ada endpoint/modul/menu AI/IoT/waste palsu                              |

## Batas hasil

Verifikasi email, pemulihan kata sandi, CRUD modul lain, harvest posting, payment ledger,
accounting policy, HPP calculator, operational dashboard/analytics dan alur UI penuh
masih pekerjaan MVP. Tidak ada deployment atau integrasi eksternal yang diklaim selesai.
Database checks sekarang tidak menggantikan aturan service yang belum diimplementasikan.

## Task 05 — Chicken unit flow (2026-09-29)

`npm run build` lulus. Pratinjau PGlite lokal diperiksa pada desktop 1600 px dan
ponsel 390 px: daftar kandang menuju detail, field edit hanya atribut Coop,
dan perubahan kapasitas dari 1.200 ke 1.300 ekor tetap tampil setelah refresh.
Tidak terlihat overflow horizontal. Tes otomatis dan PostgreSQL tidak dijalankan
pada pengerjaan Task 05.

## Task 06 — Crop area flow (2026-09-29)

`npm run build` dan `npm run format:check` lulus.
Pratinjau PGlite lokal diperiksa pada desktop 1600 px dan ponsel 390 px:
tautan daftar membuka detail area, field dan kartu menampilkan media, luas,
serta kapasitas tanaman tanpa atribut ikan atau ayam. Perubahan media dari
"Tanah" ke "Tanah organik" tetap tampil setelah refresh. Tidak terlihat
overflow horizontal. Tes otomatis dan PostgreSQL tidak dijalankan pada
pengerjaan Task 06.

## Task 07 — Cycle dan observation dasar (2026-09-29)

`npm run build` dan `npm run format:check` lulus.
Pratinjau PGlite lokal menjalankan migrasi `004_cycle_observations.sql`. Di UI,
komoditas Sawi dan Broiler dibuat pada tipe masing-masing; siklus tanaman,
ayam, dan ikan dibuat dengan atribut subtype yang benar. Siklus tanaman
diaktifkan, diberi observasi kehilangan 12 tanaman serta catatan kondisi,
lalu diselesaikan. Data awal dan observasi tetap terlihat setelah selesai.
Desktop 1600 px dan ponsel 390 px diperiksa tanpa overflow horizontal.
Aktivasi awal menemukan konflik inferensi tipe parameter SQL; query diperbaiki
dengan cast `cycle_status`, kemudian aktivasi berhasil.

Tes otomatis dan PostgreSQL tidak dijalankan pada pengerjaan Task 07. Migrasi
di server PostgreSQL nyata dan konkurensi banyak koneksi belum diverifikasi.

## Task 08 — Activity / Schedule (2026-09-29)

`npm run build` dan `npm run format:check` lulus. Di pratinjau PGlite lokal,
aktivitas pada siklus ikan aktif dibuat, ditandai terlewat, dimulai terlambat,
kemudian diselesaikan. Status akhir dan waktu selesai tetap ada setelah refresh.
Halaman Jadwal diperiksa pada lebar desktop 1440 px dan ponsel 390 px;
overflow horizontal ponsel diperbaiki.

Tes otomatis dan PostgreSQL nyata tidak dijalankan pada pengerjaan Task 08.
Konkurensi banyak koneksi, zona waktu batas rentang, dan replay receipt belum
diverifikasi dengan tes terfokus.

## Task 09 — Inventory item dan lot (2026-09-29)

`npm run build` lulus. Di pratinjau PGlite lokal, item pakan dibuat dengan
minimum 10 kg; saldo awal 0 kg. Lot berlokasi Gudang Utama dan kedaluwarsa
2026-12-31 dibuat dengan saldo 0 kg. Item, lot, dan saldo tetap terbaca
setelah refresh. Detail item diperiksa pada ponsel 390 px tanpa overflow
horizontal. Tes otomatis dan PostgreSQL nyata belum dijalankan.

## Task 10 — Inventory movement engine (2026-09-29)

`npm run build` lulus setelah implementasi. Di pratinjau PGlite lokal, 25 kg
pakan masuk pada Lot 001; transfer 7 kg ke Lot 002 menghasilkan saldo 18/7 kg,
lalu reversal dua sisi mengembalikan 25/0 kg. Koreksi -2 kg dan stok rusak
-1 kg menghasilkan saldo akhir 22 kg. Pengeluaran 999 kg ditolak tanpa
mengubah saldo dan input form tetap terisi. Riwayat memperlihatkan catatan
asal serta pasangan pembalikan. Pada viewport 390 px, dokumen tidak melebar;
tabel riwayat bergeser di dalam kartunya.

Tes otomatis, database PostgreSQL nyata, dan konkurensi multi-koneksi belum
dijalankan pada pengerjaan Task 10. Langkah berikutnya: Task 11 Consumption UI.

## Task 11 — Pemakaian stok pada aktivitas (2026-09-29)

`npm run build` lulus setelah implementasi. Di pratinjau PGlite lokal,
aktivitas pemberian pakan terjadwal dibuat pada siklus lele aktif. Form
pemakaian menampilkan item pakan dan lot dengan saldo 22 kg. Pemakaian 3 kg
tercatat pada riwayat aktivitas dan saldo menjadi 19 kg tanpa mengubah status
aktivitas. Permintaan 999 kg ditolak dengan pesan stok tidak mencukupi; nilai
999 tetap pada form. Halaman Jadwal tidak melebar pada viewport 390 px.

Tes otomatis, respons jaringan hilang, dan PostgreSQL nyata belum dijalankan.
Langkah berikutnya: Task 12 raw cost recording.

## Task 12 — Pencatatan biaya mentah (2026-09-29)

`npm run build` lulus. Migrasi 005 diterapkan pada pratinjau PGlite lokal.
Pembelian persediaan yang terhubung movement stok masuk dicatat Rp 4.250.000,
lalu dikoreksi menjadi Rp 4.200.000; versi asal menjadi CANCELLED dan versi
baru tetap terhubung movement yang sama. Biaya aktivitas Rp 150.000 dikoreksi
menjadi Rp 140.000 dengan alasan "Nota diperbarui oleh pemasok"; alasan tampil
pada catatan asal yang dibatalkan. Semua nominal diberi label biaya mentah,
bukan HPP. Halaman tidak melebar pada viewport 390 px.

Tes otomatis dan PostgreSQL nyata belum dijalankan. Langkah berikutnya:
Task 13 product catalog.

## Task 13–15 — Produk, panen, penjualan (2026-09-29)

`npm run build` lulus setelah implementasi. Di pratinjau PGlite lokal,
produk Lele Segar A/B dibuat dengan item hasil panen terpisah; A berhasil
dinonaktifkan dan diaktifkan kembali. Satu panen memposting 12,5 kg grade A
dan 6,25 kg grade B sebagai lot bersaldo sama. Penjualan dua grade 3 kg dan
2 kg menghasilkan total server Rp 142.000 serta detail lot dan siklus.
Saldo panen turun menjadi 9,5/4,25 kg. Pembatalan panen pada kondisi tersebut
ditolak dengan `INSUFFICIENT_STOCK`. Pembatalan penjualan kemudian mencatat
reversal dan mengembalikan stok. Semua ini memakai data demo, bukan database
produksi. Tes otomatis dan PostgreSQL nyata belum dijalankan.

## Task 17–18 — Dashboard dan analitik dasar (2026-09-29)

`npm run build` lulus. Dashboard pratinjau menampilkan 4 unit aktif,
1 siklus aktif, biaya mentah Rp 4.340.000 bulan ini, serta produksi Lele
18,75 kg dari SQL farm-scoped. Halaman Analitik mengelompokkan 18,75 kg
pada siklus/komoditas/satuan yang sesuai dalam rentang tanggal eksplisit;
survival, pertumbuhan, efisiensi pakan dan HPP menampilkan alasan belum
tersedia. Tes otomatis, batas tanggal PostgreSQL nyata, dan konkurensi
belum dijalankan.

## Task 16 parsial — Ledger pembayaran (2026-09-29)

`npm run build` lulus. Migrasi 006 diterapkan pada PGlite pratinjau lokal.
Sale demo Rp 30.000 menerima pembayaran parsial Rp 10.000 (status Sebagian).
Pembatalan sale saat penerimaan masih positif ditolak. Refund Rp 10.000
menurunkan penerimaan bersih menjadi Rp 0 (Belum dibayar), dengan alasan
refund tampil pada riwayat. HPP, revenue, profit, PostgreSQL nyata dan tes
otomatis belum diverifikasi; keputusan kebijakan finansial masih terbuka.

## UX, grant, dan verifikasi gabungan (2026-09-29)

Snapshot aksesibilitas memeriksa 14 rute menu dan 11 detail demo untuk heading
halaman serta tombol/tautan bernama; tidak ditemukan tombol atau tautan tanpa
nama. Fokus keyboard pertama pada dashboard dan halaman ikan mencapai tautan
"Ke konten utama"; CSS menyediakan outline `:focus-visible` dan tombol minimum
44 px. Ini belum mencakup traversal keyboard penuh, pembaca layar, atau simulasi
putus jaringan. Preview dikembalikan ke dashboard.

`npm test` lulus 39/39, termasuk dua pemeriksaan pesan aman untuk transport farm
dan akun. `npm run typecheck`, build standar (`npm run build`), kompilasi server,
`npx vite build --configLoader runner`, dan `npm run format:check` lulus pada
verifikasi 2026-09-30.
`npm run test:postgres` melewati satu tes karena `TEST_DATABASE_URL` tidak
tersedia. Template grant belum diterapkan pada PostgreSQL nyata.

## Task 20 - Cakupan end-to-end tiga cabang (2026-10-01)

Perjalanan ayam dan tanaman pada `tests/business-flow.test.ts` kini mencakup
aktivitas operasional, penerimaan stok, konsumsi yang ditautkan ke aktivitas,
biaya pembelian dan biaya produksi, dua panen parsial dengan berat terukur,
penjualan dari kedua panen, pembayaran, HPP siklus, dashboard revenue, dan
analitik per satuan. Analitik memastikan HEAD dan UNIT tetap terpisah. Tes alur
terarah lulus 16/16; `npm test` lulus 62/62; `npm run build` dan
`npm run format:check` lulus.

Pemeriksaan PostgreSQL 18.4 lokal yang dicatat di bagian verifikasi terbaru
melengkapi migrasi 001-013, grant runtime, dan jalur multi-koneksi. Task 20
selesai untuk kriteria MVP yang disepakati; deployment produksi tetap di luar
verifikasi ini.

## P2-05 — Perbandingan siklus (2026-09-30)

`npm test` lulus 63/63 dan `npm run build` lulus. Tes baru memverifikasi
perbandingan panen serta biaya POSTED untuk dua siklus pada farm yang sama,
rentang `[from,toExclusive)`, pembatalan dan data di luar rentang, biaya
farm-wide, ID sumber, akses farm asing, dan siklus yang sama. `npm run
format:check` lulus setelah format dokumentasi diperbaiki. Di browser pratinjau,
halaman Analitik hanya menampilkan empty state karena akun pratinjau tidak
memiliki farm aktif; UI dengan data perbandingan belum diverifikasi secara
visual. PostgreSQL nyata tetap belum tersedia.

## P2-03 — Batch maggot (2026-09-30)

Migrasi 010 dan halaman Maggot mencatat batch, alokasi kuantitatif dari sumber
waste dalam satuan yang sama, observasi bebas, panen, pemakaian, sisa, dan
penyelesaian beralasan. Input/output bersifat append-only; hasil tidak menulis ke
inventory. `npx tsx --test tests/maggot.test.ts` lulus 3/3; tes mencakup batas
alokasi sumber, unit diskrit, pemakaian hasil, replay idempoten, penutupan batch,
tenant scope, dan saldo inventory tidak berubah. `npm test` lulus 66/66,
`npm run build` dan `npm run format:check` lulus. Halaman `/maggot` terlihat di
pratinjau pada empty state; UI berisi data belum diverifikasi karena akun itu tidak
memiliki farm aktif. Migrasi dan hak runtime belum diuji pada PostgreSQL nyata.

## P2-04 — Posting maggot ke inventory (2026-09-30)

Migration 011 dan halaman Maggot mendukung posting eksplisit dari batch `COMPLETED` ke
lot item aktif kategori `FEED`, dengan satuan dasar sama. Satu transaksi mencatat
`STOCK_IN` dan provenance posting; pemakaian serta posting sebelumnya mengurangi sisa
yang dapat diposting. Alasan wajib dan idempotency key mencegah penggandaan pada retry.
`npx tsx --test tests/circular.test.ts` lulus 4/4; cakupan meliputi atomicity,
idempotensi, status batch, satuan/kategori lot, jumlah maksimum, tenant isolation,
dan route API. `npm test` lulus 70/70; `npm run build` lulus. `npm run format:check`
lulus setelah perubahan dokumentasi ini. Browser `/maggot` memperlihatkan shell dan
empty state; akun pratinjau tidak memiliki farm aktif sehingga form posting belum
dapat diverifikasi visual. PostgreSQL nyata dan runtime grant untuk migrasi 011 tetap
belum diverifikasi.

## P2-06 — Inbox notifikasi (2026-09-30)

Migration 012 menambahkan transactional outbox, inbox dengan status baca per
anggota, state deduplikasi alert stok, dan heartbeat worker. Worker memproses
reminder jadwal 24 jam sebelum waktu jatuh tempo, kegiatan overdue, alert stok
minimum sampai stok pulih, fan-out aman untuk retry, serta retensi 90 hari.
Rancangan in-app only dan Outbox + worker disetujui; semua anggota farm menerima
event. Migrasi 012 dan grant runtime belum diverifikasi pada PostgreSQL nyata.

Tes notifikasi lulus 7/7 dan suite serial `npx tsx --test --test-concurrency=1
tests/*.test.ts` lulus 77/77. `npm run build` lulus. Preview UI memakai stack
PGlite sementara terisolasi, akun sintetis dan farm demo; inbox menampilkan alert
stok belum dibaca dengan tautan sumber. Akun dan data sintetis ini hanya ada di
`.pglite/ui-preview-data`, terpisah dari preview utama. `npm run format:check`
dan `npm run build` lulus setelah pemformatan dokumentasi dan tes.

## P2-01 — Keanggotaan farm dan pencabutan akses (2026-09-30)

Owner kini dapat mengeluarkan anggota non-owner dari halaman Anggota. Penghapusan
membership memakai command idempoten; pemeriksaan Owner dan penghapusan terjadi dalam
transaksi yang sama. Owner tidak dapat mengeluarkan dirinya sendiri. Ledger dan actor
historis tidak berubah. Suite penuh serial `npx tsx --test --test-concurrency=1
tests/*.test.ts` lulus 78/78; cakupan baru memeriksa otorisasi, replay idempoten,
akses member yang dicabut, proteksi Owner, dan actor receipt lama. `npm run build`
dan `npm run format:check` lulus. Pemeriksaan visual pada preview PGlite terisolasi
menunjukkan form tambah anggota khusus Owner, tombol “Keluarkan” pada baris anggota,
dialog konfirmasi, serta status sukses setelah pencabutan. Preview lokal tersedia di
`http://127.0.0.1:5175/farm/members`. PostgreSQL nyata tidak tersedia; migration 008
dan hak DELETE terbatas untuk runtime masih belum diverifikasi di PostgreSQL.

## P2-02 — Histori audit limbah (2026-09-30)

Halaman Limbah memuat histori secara lazy dan menampilkan nama pembuat, waktu
pencatatan, transisi status, waktu perubahan, actor, serta tujuan reuse bila ada.
Panel menyediakan state loading, error aman, dan retry. Migrasi 009, akses farm,
dan perilaku tanpa perubahan stok/biaya tetap dipertahankan. `npx tsx --test
tests/waste.test.ts` lulus 5/5; suite serial lulus 79/79. `npm run typecheck`,
`npm run build`, dan `npm run format:check` lulus. Browser pratinjau menunjukkan
histori tiga transisi dan menguji pemulihan retry setelah API sementara dihentikan.
Preview berada di `http://127.0.0.1:5175/waste` dengan data PGlite sintetis.
Migration 009 dan runtime grant belum diuji pada PostgreSQL nyata.

## P2-04 — Transfer air kolam ke area tanam (2026-09-30)

Migration 013 dan halaman `/circular/water-transfers` mencatat pemindahan manual dari
unit ikan aktif ke area tanam aktif: liter, tanggal, actor, dan catatan opsional.
Catatan tersimpan append-only; endpoint tidak menyediakan edit/hapus dan runtime grant
membatasi tabel ke baca/tambah. Transfer tidak mengubah inventory maupun biaya, dan tidak
melakukan konversi satuan. Tes fokus `tests/water-transfer.test.ts` lulus 3/3, mencakup
replay, actor/waktu, batas farm/tipe unit, route/options API, serta ketiadaan mutasi stok
atau biaya. Suite serial penuh lulus 82/82 dan `npm run build` lulus. Migration 013 dan
runtime grant belum diverifikasi pada PostgreSQL nyata; Task 20 tetap terbuka.

## P2-05 — Volume transfer air tercatat (2026-09-30)

Advanced Analytics mengelompokkan jumlah liter transfer manual menurut bulan, kolam
sumber, dan area tanam tujuan pada periode `[from,toExclusive)`. Tabel menampilkan
periode, volume liter, jumlah catatan, ID unit dan ID transfer; rumusnya adalah jumlah
`quantity_liters` dari catatan pada grup tersebut. UI menyebut metrik sebagai volume
tercatat dan tidak menafsirkannya sebagai air terserap, penghematan, atau efisiensi.
Tes analitik memeriksa batas periode dan sumber transfer; suite serial lulus 82/82.
`npm run build` (termasuk typecheck) dan `npm run format:check` lulus.

## P2-05 — Input limbah dan hasil maggot di Analitik (2026-10-01)

Advanced Analytics menampilkan jumlah input limbah batch maggot menurut bulan UTC dan
satuan, serta hasil maggot menurut bulan UTC dan satuan. Setiap grup menyertakan hitungan
dan ID sumber; input limbah, hasil maggot, dan satuan berbeda tetap terpisah. Tes
`tests/business-flow.test.ts` memeriksa `[from,toExclusive)`, satuan berbeda, farm lain,
source IDs, serta bentuk respons HTTP. Tes fokus lulus; suite serial lulus 82/82 dengan
direktori temp diarahkan ke workspace karena sandbox menolak direktori temp profil
Windows. `npm run build` dan `npm run format:check` lulus. Tidak ada rasio efisiensi,
konversi unit, atau mutasi ledger yang ditambahkan.

## P3-01 — Registry perangkat dan ingest telemetry (2026-10-02)

Branch `codex/p3-01-iot-telemetry` menambahkan migration 014, registry perangkat
farm-scoped, token acak 256-bit yang hanya disimpan sebagai hash, konfigurasi
metric/unit, endpoint ingest netral-protokol, rate limit persisten, query telemetry,
dan worker retensi 90 hari. Halaman `/devices` menyediakan create/edit/rotate/revoke,
pagination, dan state loading/error/empty. Token hanya ditampilkan sekali; browser
preview ditinggalkan pada halaman ini dengan data akun/farm sintetis untuk pemeriksaan.

`npm run test` lulus 126/126; `npm run typecheck` dan `npm run build` lulus.
Tes lintas koneksi ada di `tests/postgres/iot.test.ts`, namun `npm run test:postgres`
melewati dua berkas tes PostgreSQL karena `TEST_DATABASE_URL` tidak tersedia. Tes
PostgreSQL nyata, deployment produksi, dan kompatibilitas hardware belum diverifikasi.
`npm run format:check` melaporkan 137 berkas tidak sesuai Prettier di seluruh repo;
pemeriksaan terarah pada file implementasi P3-01 lulus.

Preview lokal tersedia pada `http://127.0.0.1:5173/devices`. RAG masih berupa draft:
belum ada knowledge center, katalog sumber hidup, ingestion, maupun vector index.
