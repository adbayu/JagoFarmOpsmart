# Batas keamanan deployment

## Database

Jalankan `npm run db:migrate` dengan `MIGRATION_DATABASE_URL` yang memakai
login DDL terpisah `opsmart_migrator`. Role ini menjadi pemilik database
aplikasi (atau diberi `CREATE` pada schema `public`) agar objek migrasi dimiliki
olehnya. API runtime membaca `DATABASE_URL` sebagai `opsmart_runtime`; role ini
tidak boleh menjadi anggota migrator atau memiliki hak DDL. Buat kedua role,
lalu terapkan grant lewat [runtime-grants.sql](../db/runtime-grants.sql)
sebagai database admin. Skrip memberi akses baca/tambah ke tabel, UPDATE pada tabel dengan
lifecycle mutable, dan DELETE terbatas pada detail subtype unit (kolam, kandang,
area tanam) saat tipe unit berubah sebelum memiliki siklus. Satu grant kolom
`display_name` memungkinkan row lock saat farm dibuat; API tidak mengubah
nilainya. Skrip menolak membership runtime ke role migrasi dan mencabut hak
`CREATE` schema `public` dari `PUBLIC`. Ledger pergerakan, output panen, item
penjualan, observasi siklus, dan command receipt tidak dapat diubah role
runtime-nya. Role runtime tidak boleh `CREATE`, `ALTER`, `DROP`, `TRUNCATE`,
atau menjadi owner schema. Jangan gunakan role superuser untuk API.

Kredensial produksi disimpan di pengelola secret host, bukan `.env` yang
di-commit. Jalankan migrasi sebelum menaikkan versi API dan simpan backup
database. Skrip migrasi memeriksa checksum agar file SQL yang sudah diterapkan
tidak diubah diam-diam. Setelah migrasi yang menambah tabel, grant skrip
kembali: tabel baru hanya mendapat SELECT/INSERT secara default; beri UPDATE
secara eksplisit bila tabel memiliki lifecycle mutable.

## Sesi dan jaringan

Set `NODE_ENV=production` dan `APP_ORIGIN` ke origin HTTPS publik. Terminasikan
TLS pada reverse proxy tepercaya; jangan paparkan port API `127.0.0.1:3001`
langsung. Cookie sesi memakai `Secure`, `HttpOnly`, `SameSite=Lax`, dan prefiks
`__Host-` pada produksi. Mutasi memerlukan origin dan CSRF. Tambahkan rate
limit di proxy, khususnya pendaftaran dan login. Nonaktifkan pendaftaran publik
sampai verifikasi email dan pemulihan kata sandi disiapkan.

Respons error hanya mengungkap kode umum, pesan aman, dan `requestId`.
Header `X-Request-Id` memudahkan penelusuran tanpa menyalin SQL atau secret
ke klien. Log internal hanya menyimpan requestId/kode untuk error INTERNAL.
