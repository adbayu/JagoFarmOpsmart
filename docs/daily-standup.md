# Daily Standup

Menu **Ringkasan → Daily Standup** (`/standups`) menyediakan laporan pekerjaan
harian internal per akun, tanpa harus memilih atau memiliki farm.

## Alur pengguna

1. Pada hari kerja sebelum 12.00 WIB, tulis **Rencana hari ini**. Pekerjaan
   sebelumnya dan kendala opsional; setiap kolom dibatasi 6.000 karakter.
2. Tunggu status **Draf tersimpan**. Draf otomatis disimpan setelah jeda mengetik
   650 ms. Draf dan permintaan yang hasilnya belum pasti tetap tersedia ketika
   berpindah menu dalam sesi aplikasi yang sama.
3. Pilih **Kirim** untuk memublikasikan laporan pertama. Setelah itu, perubahan
   tetap berupa draf sampai memilih **Simpan perubahan**.
4. Pada pukul 12.00 WIB semua pengisian dan perubahan ditutup. Revisi yang belum
   dikirim tidak mengganti publikasi terakhir. Teks yang belum tersimpan tetap
   ditampilkan agar dapat disalin; jangan menutup tab saat koneksi bermasalah.
5. Pilih tanggal pada **Rekap tim**, lalu **Baca laporan** untuk melihat publikasi.

Status rekap: Sudah mengisi, Belum mengisi (sebelum tenggat), atau Tidak mengisi
(sesudah tenggat). Pengingat tampil maksimal sekali per akun per hari, dapat
dilewati melalui **Nanti**. Indikator menu/dashboard tetap tersedia.

Akun baru mulai wajib pada hari kerja setelah tanggal pembuatan akun menurut WIB.
Pengguna yang tidak login tetap masuk rekap. Rekap dimulai pada tanggal penerapan
migration; tanggal sebelum fitur tersedia tidak menghasilkan ketidakhadiran.

## Akses dan penyimpanan

Semua akun terautentikasi dapat membaca publikasi seluruh pengguna lintas farm,
sesuai keputusan untuk penggunaan internal. Draf hanya dapat dibaca/diubah akun
pemilik. Tidak ada endpoint hapus atau retensi otomatis. Aturan akses farm lainnya
tetap berlaku pada domain masing-masing. Signup tidak diubah; deployment harus
mempertahankan pembatasan akses lingkungan internal yang dipilih pengguna.

Mutasi memakai lock `app_user`, versi optimistis, serta receipt idempotensi per
akun dalam satu transaksi. Waktu diperiksa kembali setelah lock; retry receipt
yang sudah berhasil tetap dapat dikonfirmasi setelah tenggat. Draf dan publikasi
memakai kolom terpisah. DTO rekap hanya memilih kolom publikasi. Actor berasal
dari sesi dan mutasi melewati pelindung origin/CSRF yang sudah ada.

## Pengiriman ke Kolab

OpSmart dapat mengirim publikasi final setiap akun ke akun Kolab milik akun itu
sendiri. Antrean dibuat hanya saat laporan dipublikasikan. Worker server berjalan
setiap menit dan baru membuka Kolab setelah pukul 12.00 WIB; draf tidak dikirim.
Jika server tidak aktif saat tenggat, antrean dapat diproses setelah server hidup
kembali selama laporan belum lebih dari 20 hari.

Kolab belum menyediakan integrasi API yang dipakai fitur ini. Worker memakai
Playwright pada halaman rekap yang terlihat. Setiap anggota harus menautkan akun
Kolab sendiri satu kali:

1. Jalankan `npx playwright install chromium` pada komputer anggota dan server.
2. Jalankan `npm run kolab:connect`, login manual pada jendela yang terbuka, lalu
   tekan Enter di terminal setelah halaman rekap menampilkan sapaan akun.
3. Unggah file JSON sementara yang dihasilkan ke akun OpSmart sendiri pada kartu
   **Kirim standup ke Kolab**. Hapus file lokal setelah unggah.

Jangan membagikan file sesi tersebut. Isinya dapat dipakai untuk mengakses akun
Kolab. OpSmart mengenkripsi file dengan AES-256-GCM sebelum menyimpannya dan tidak
menyimpan password. Satu nilai `KOLAB_SESSION_ENCRYPTION_KEY` base64 berisi 32 byte
harus disimpan sebagai secret server dan dipertahankan saat restart. Mengganti key
membuat sesi tersimpan tidak dapat dibaca, sehingga setiap anggota perlu menautkan
ulang akunnya.

Untuk mengaktifkan pengiriman, set `KOLAB_SYNC_ENABLED=true` dan
`KOLAB_SESSION_ENCRYPTION_KEY` pada server API, pasang Chromium beserta dependensi
sistemnya, terapkan migration 015, lalu terapkan ulang `db/runtime-grants.sql`.
Gunakan server Node yang selalu hidup dan dapat membuka koneksi HTTPS ke Kolab.
Worker tidak dijalankan dari preview lokal. Tanpa konfigurasi lengkap, fitur tetap
nonaktif.

Status menunjukkan menunggu, terkirim, sesi perlu dihubungkan ulang, gagal, atau
perlu diperiksa. Worker mencoba ulang kegagalan jaringan yang diketahui maksimal
tiga kali. Hasil simpan yang tidak pasti dan perubahan pada formulir Kolab masuk
ke **Perlu diperiksa**; periksa rekap Kolab sebelum memilih kirim ulang. Pengiriman
ulang terlebih dahulu memeriksa apakah laporan hari itu sudah ada. Sesi dapat
kedaluwarsa dan perubahan tampilan Kolab dapat memerlukan tautan ulang atau tinjauan
manual.

Jika versi konflik, salin teks sebelum memilih **Muat versi terbaru**. Jika hasil
penyimpanan belum pasti, **Coba lagi** memakai key dan payload yang sama. Response
tidak valid diperlakukan sebagai hasil belum pasti; key tidak dibuang.

## Kalender libur

Provider: [Indonesian Holidays](https://github.com/ahrulsyamil/indonesian-holidays),
`GET https://indonesian-holidays.ahrulsyamil.com/holidays/{year}` tanpa API key.
Tipe `national_holiday` dan `joint_leave` keduanya mengecualikan kewajiban standup.
Kalender tahunan berhasil disimpan di PostgreSQL dan disegarkan setelah 24 jam.
Response diperiksa untuk tahun, jumlah, tipe, dan tanggal; response kosong/tidak
valid tidak mengganti cache. Request menggunakan timeout 5 detik dan jeda retry
5 menit setelah kegagalan dalam proses server yang sama.

Jika pembaruan gagal, cache lama tetap dipakai dan UI memberi keterangan. Jika
belum ada cache untuk tahun itu, weekday tetap dapat diisi sebelum tenggat dengan
peringatan **Kalender libur belum terverifikasi**. Tahun yang belum didukung
provider dapat memakai fallback ini. Publikasi lama tetap terbaca meskipun
perubahan kalender kemudian menjadikan tanggalnya hari libur.

## Deployment

- Jalankan `npm run db:migrate` dengan `MIGRATION_DATABASE_URL` milik migrator.
- Terapkan ulang `db/runtime-grants.sql` sebagai administrator jika menggunakan
  role runtime terpisah. Tabel `daily_standup` dan `standup_holiday_calendar`
  memerlukan UPDATE; reminder/receipt hanya SELECT dan INSERT. Integrasi Kolab
  memerlukan SELECT/INSERT/UPDATE pada `kolab_standup_delivery` dan
  SELECT/INSERT/UPDATE/DELETE pada `kolab_account_session`.
- Restart API setelah migration. `npm run dev` menerapkan migration sebelum
  menjalankan API; preview lokal menggunakan migration yang sama.
- Pastikan server dapat mengakses HTTPS provider dan jam sistem tersinkron.

Migration `014_daily_standup.sql` diterapkan ke PostgreSQL lokal pada 2026-10-26.
Typecheck dan build client/server lulus. Build memberi peringatan ukuran chunk
client >500 kB. Pemeriksaan akhir dicatat pada rencana pelaksanaan. Suite
tes dan pemeriksaan browser tidak dijalankan pada perubahan ini; belum ada bukti
runtime untuk autosave, konflik, atau perbatasan tenggat.
