# JagoFarm / OpSmart

Fondasi Phase 1 untuk sistem operasional farm. **MVP belum selesai.**

Mulai dari [AGENTS.md](AGENTS.md), [arsitektur](docs/architecture.md), lalu
[roadmap implementasi](docs/implementation-roadmap.md). Status verifikasi ada di
[verification.md](docs/verification.md) dan [peta status fitur](docs/feature-status.md).

## Yang tersedia

- Schema PostgreSQL: farm, unit dan siklus bertipe, aktivitas, ledger inventory, biaya,
  hasil panen, katalog produk, lot stok, penjualan beserta item, dan command receipt.
- Kontrak Zod/TypeScript per modul, nilai status/satuan bersama, aturan transisi,
  perhitungan kuantitas dan nominal tanpa floating point.
- Contoh service konsumsi dan penjualan multi-item, atomik dan idempoten, dengan
  otorisasi pemilik farm. Endpoint runtime memakai sesi akun lokal yang diverifikasi server.
- Shell React berbahasa Indonesia dengan logo yang diberikan, navigasi ponsel,
  dan dashboard pengantar farm aktif. Halaman farm, ikan, ayam, tanaman, dan
  modul berikutnya mengikuti gaya visual dashboard. Ikan memiliki detail
  kolam, kondisi, dan daftar siklus terkait. Ayam memiliki detail kandang,
  tanaman memiliki detail area tanam. Menu Siklus mendukung perencanaan,
  transisi status, dan observasi. Menu Jadwal mendukung aktivitas satu kali
  yang terkait siklus. Persediaan memiliki katalog item dan lot dengan saldo
  dari ledger serta alur stok masuk, koreksi, transfer, rusak/kedaluwarsa,
  pembalikan, dan riwayat pergerakan.
  Tidak ada statistik palsu atau koneksi AI/IoT.
- Farm registry: create/list/get/update/arsip dengan akses owner, retry idempoten, pilihan
  farm aktif di UI, dan penyimpanan pilihan lokal.
- Unit farm: buat/daftar/baca/ubah/arsip kolam, kandang, dan area tanam dengan detail
  bertipe, akses owner, serta transaksi dan retry idempoten.
- Detail kolam: atribut Pond, edit kondisi, dan daftar siklus owner-scoped.
- Detail kandang: atribut Coop, edit lokasi/luas/kapasitas, dan arsip unit owner-scoped.
- Detail area tanam: atribut GrowingArea, edit lokasi/media/luas/kapasitas, dan arsip unit owner-scoped.
- Siklus: komoditas per tipe unit, buat/daftar/detail siklus ikan/ayam/tanaman,
  transisi status, dan observasi kehilangan populasi, bobot, serta kondisi.
- Jadwal: buat aktivitas pada siklus aktif, daftar berdasarkan rentang waktu,
  lihat detail, ubah status dengan catatan waktu selesai/batal, dan catat
  pemakaian stok per aktivitas dengan riwayat.
- Persediaan: buat/daftar/detail/ubah item dan lot, nonaktifkan item kosong,
  stok minimum, lokasi dan kedaluwarsa lot, saldo dari ledger, serta command
  pergerakan stok dengan receipt dan alasan audit.
- Biaya: catat nominal dengan klasifikasi `PRODUCTION`, `INVENTORY_PURCHASE`,
  `CAPITAL`, atau `UNCLASSIFIED`; tautkan konsumsi terukur ke siklus; koreksi
  dan batalkan secara terjejak.
- Produk, panen, dan penjualan: katalog per grade dan item hasil panen,
  posting multi-output yang membentuk lot/stok, penjualan multi-item dengan
  jejak lot sampai siklus, serta pembatalan beralasan dan reversal stok.
- Pembayaran dan keuangan: penerimaan/refund per sale, status dari saldo bersih,
  revenue saat pembayaran diterima, HPP/COGS terukur menurut siklus, serta
  alasan `UNAVAILABLE` saat data wajib belum lengkap. Kebijakan ada di
  [finance policy](docs/decisions/finance-policy.md).
- Dashboard dan analitik dasar: ringkasan SQL farm, produksi, revenue, HPP/COGS,
  dan profit per rentang tanggal eksplisit. Metrik yang belum didukung data
  ditandai `UNAVAILABLE` dengan alasannya.
- Akun lokal: daftar, masuk, keluar, sesi tujuh hari, pembatasan percobaan masuk,
  pemeriksaan origin dan CSRF untuk mutasi.
- Pengujian nyata schema/transaksi dengan PGlite serta tes konkurensi PostgreSQL terpisah.

Panduan untuk grant database, sesi produksi, proxy, dan logging ada di
[deployment-security.md](docs/deployment-security.md).

## Menjalankan

Prasyarat: Node >=22.12, npm, Docker Desktop aktif. Versi dependency aktual
dikunci di package-lock.json.

```sh
npm ci
npm run dev
```

Buka `http://127.0.0.1:5173`. Perintah ini menyalakan PostgreSQL 17 di Docker,
menunggu database siap, menjalankan migrasi, lalu menyalakan API dan frontend.
Database hanya bind ke loopback dan datanya bertahan di Docker volume
`opsmart-postgres-data`. Ctrl+C menghentikan API dan frontend; database tetap
hidup. Untuk menghentikan container database tanpa menghapus datanya, jalankan:

```sh
npm run db:down
```

`npm run dev` menggunakan database Docker. Akun di database PGlite preview tidak
ikut dipindahkan; buat akun lagi melalui UI setelah pertama kali menjalankan stack.

Untuk menjalankan API PGlite preview saja:

```sh
npm run dev:server:preview
```

API ini hanya bind ke `127.0.0.1` dan mengikuti Vite pada port 5173. Cara ini
terpisah dari database Docker yang digunakan `npm run dev`.

Untuk memakai PostgreSQL lain, salin `.env.example` menjadi `.env`, isi
DATABASE_URL dan APP_ORIGIN (harus sama dengan alamat browser), lalu jalankan:

```sh
npm run db:migrate
npm run dev:server
```

Di terminal lain, jalankan frontend dengan `npm run dev:frontend`.

`GET /api/health` memeriksa proses, bukan kesiapan database. Daftar akun melalui UI,
lalu buat farm pertama. Identitas hanya berasal dari cookie sesi; header user diabaikan.
Di produksi, set `NODE_ENV=production` dan `APP_ORIGIN` ke origin HTTPS publik,
jalankan API di belakang reverse proxy TLS, dan terapkan pembatasan request di tepi
terutama untuk pendaftaran. Email belum diverifikasi dan pemulihan kata sandi belum ada;
jangan menganggap alur ini siap untuk layanan publik tanpa melengkapi keduanya.

```sh
npm run typecheck
npm test
npm run build
npm run format:check
# Opsional, database uji tersendiri dengan nama mengandung "test":
npm run test:postgres
```

`npm test` mencakup alur ikan, ayam, dan tanaman pada PGlite. Tes konkurensi
PostgreSQL hanya berjalan jika `TEST_DATABASE_URL` diisi; status terkini ada di
[verification.md](docs/verification.md).

`dist/client` adalah aset frontend; host harus mengarahkan route non-file ke index.html.
`npm start` menjalankan API hasil build di `127.0.0.1:3001`. Production reverse proxy
mengirim `/api` ke API dan route lainnya ke frontend. Hosting/deployment belum dibuat.

## Education (halaman persiapan AI RAG)

Menu **Education** (`/education`) memiliki Tanya AI, Kelola Knowledge, dan Kelola API.
Contoh pertanyaan mengisi draf; jawaban AI, unggah dokumen, dan penyimpanan koneksi
belum aktif. Sumber SOP dan provider belum ditetapkan; status rinci ada di
[keputusan RAG](docs/decisions/rag-architecture.md).

## Daily Standup internal

Menu **Daily Standup** menyediakan draf privat, pengiriman eksplisit, rekap tim
lintas farm, serta pengingat Senin–Jumat sebelum 12.00 WIB, kecuali libur nasional
dan cuti bersama. Terapkan migration 014 dan perbarui runtime grants saat deploy.
Lihat [alur dan deployment Daily Standup](docs/daily-standup.md).

## Sumber dan status

Workspace awal kosong; tidak ada stack lama yang diganti. Sumber kebutuhan:
[feature breakdown asli](docs/reference/feature-breakdown.md), master prompt yang
dibaca pada percakapan ini, dan brief Phase 1 dari pengguna. Logo asli disalin ke
public/jagofarm-logo.png. Tidak ada database produksi yang disentuh.

Dokumen keputusan teknis adalah pilihan fondasi, bukan aturan akuntansi/agronomi dari
sumber. Lihat [keputusan terbuka](docs/architecture.md#keputusan-produk-terbuka).
Phase 2/3 hanya dijelaskan sebagai titik pengembangan.
