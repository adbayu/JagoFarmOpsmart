# Integrasi aset login OpSmart

Halaman autentikasi memakai `public/login-scene.png` sebagai latar dekoratif.
Form masuk dan pendaftaran, judul, logo, serta kartu fitur dirender sebagai HTML.
Prompt dan asal referensi gambar ada di `output/imagegen/login-scene-prompt.txt`.

## Arah visual

Referensi: mockup yang disetujui pengguna dalam percakapan. Halaman masuk untuk
pengguna operasional farm, dengan krem, putih, hijau tua, foto farm, dan laptop
berisi ilustrasi dashboard dari screenshot pengguna. ENERGY 2 / RHYTHM 2 / MOTION 2.
Antislop mode `during` dipilih pengguna untuk integrasi ini.

- Foto farm dan laptop menghubungkan halaman masuk dengan produk OpSmart.
- Warna, font keluarga Segoe, logo, dan ikon memakai identitas aplikasi yang ada.
- Kartu Farm, Operasional, dan Laporan merangkum kemampuan yang sudah tersedia.
  Kartu adalah informasi statis, bukan tombol atau data farm aktif.
- Permukaan putih dan shadow memisahkan form dari ilustrasi. Tidak ada animasi
  berulang; aksen hijau menegaskan tombol Masuk dan tindakan Daftar.
- Latar mempertahankan rasio gambar dengan `contain`; fade di tepi atas mencegah
  sambungan tajam. Lebar komposisi dibatasi 1720 px agar jarak antarkolom stabil.
- Tablet memakai dua kolom; ilustrasi berada di bawah pengantar, di sebelah kiri
  form. Ponsel memakai urutan pengantar singkat, form, lalu ilustrasi ringkas.
  Tinggi halaman mengikuti isi form masuk, daftar, dan pesan kesalahan.

## Transisi autentikasi 2026-10-27

Pengguna menetapkan bahwa halaman tujuan setelah autentikasi adalah dashboard.
Tujuan motion: memperjelas perubahan field saat Masuk/Daftar dan perpindahan dari
form ke ruang kerja setelah server mengonfirmasi autentikasi.

- Judul dan label mode masuk dengan fade serta pergeseran 5 px selama 240 ms.
  Field Nama dan petunjuk kata sandi membuka/menutup dengan grid selama 300 ms.
  Input tetap terpasang sehingga nilai form dipertahankan saat berganti mode.
- Autentikasi berhasil memakai View Transition API: halaman lama memudar 180 ms,
  halaman baru masuk 360 ms. Browser tanpa API tersebut memakai fade dashboard.
  Halaman awal `/` berpindah ke `/dashboard`; URL modul yang diminta sebelumnya
  tetap menjadi tujuan. Mode `prefers-reduced-motion` meniadakan efek gerak.
- Field Nama yang tertutup disabled dan inert. Fokus berpindah ke judul form
  saat mode berubah; Tab berikutnya masuk ke field pertama yang tersedia.
  Selama request, field, submit, dan pergantian mode dinonaktifkan.
- Chrome: pergantian dua arah, penyimpanan Nama, tinggi field tertutup 0 px,
  fokus judul lalu Tab ke Email diperiksa melalui UI. Pada lebar CSS 312 px,
  clientWidth dan scrollWidth sama-sama 297 px. Outline Nama terlihat utuh.
- Screenshot ada di `output/verification/auth-login-desktop.jpg` dan
  `output/verification/auth-register-mobile.jpg`. Browser pemeriksaan melaporkan
  reduced motion aktif; durasi transisi form tetap terukur 300/200 ms dan
  animasi masuk form 420 ms. API View Transition tidak tersedia di browser uji,
  sehingga jalur fade dashboard menjadi fallback aktif. Login akun nyata belum
  diperiksa langsung. Tidak ada akun baru yang dibuat.

## Perapihan 2026-10-27

Masalah yang terlihat pada ukuran laptop: kartu fitur terlalu tinggi sehingga
menutupi bagian layar laptop, teks terlalu dekat dengan area foto, dan tagline
di kiri bawah membentuk kotak putih tersendiri. Di ponsel, ilustrasi mendahului
form sehingga pengguna harus melewati gambar untuk mulai masuk.

Perubahan: proporsi kolom dan ukuran judul disesuaikan, kartu fitur dipadatkan,
lebar form dibatasi 440 px, margin antar-field dan tombol diseragamkan. Tagline
dekoratif di kiri bawah dihapus. Latar memakai `contain` agar foto tidak dipotong
karena tinggi viewport; viewport desktop pendek memakai kartu fitur lebih ringkas.
Pada tablet gambar ditempatkan di bawah teks; pada ponsel form berada sebelum gambar.
CSS dibatasi pada selector autentikasi, tanpa mengubah handler/API autentikasi.

Pemeriksaan saat perapihan:

- Screenshot Chrome pada viewport CSS 1920 × 914 menunjukkan kartu fitur berada
  di atas layar laptop, form terpisah dari ilustrasi, dan judul tidak menutupi foto.
- Pengukuran DOM di ponsel CSS 390 px: lebar konten dan clientWidth sama-sama
  367 px (setelah scrollbar). Form masuk berada sebelum ilustrasi; tombol Masuk
  masih berada dalam viewport tinggi 845 px. Mode daftar tetap memakai field
  Nama, Email, Kata sandi dengan lebar yang sama dan scroll vertikal alami.
- Pada lebar CSS 321 px, clientWidth dan scrollWidth sama-sama 298 px. Pada
  tablet CSS 900 px, keduanya sama-sama 900 px; layout memakai dua kolom.
- Pergantian Masuk/Daftar diamati melalui UI, tanpa mengirim kredensial atau
  membuat akun. Capture screenshot saat emulasi viewport sesekali timeout atau
  menampilkan artefak; ukuran CSS/overflow di atas dibaca langsung dari DOM.
- `npm run build` lulus, termasuk typecheck dan kompilasi client/server. Vite
  memberi peringatan chunk client >500 kB dan anotasi dependensi Zod.
- Suite tes otomatis tidak dijalankan dalam perapihan ini.

## Bukti pemeriksaan integrasi sebelumnya

- `npm run build`: lulus, termasuk TypeScript client/server. Aset tersedia di
  `dist/client/login-scene.png`.
- Prettier untuk `src/client/auth.tsx` dan `src/client/styles.css`: lulus.
- `git diff --check`: lulus.
- `tests/client-network.test.ts`: 6/6 lulus. Status 401 tetap dibedakan dari
  kegagalan server/transport yang dapat dicoba ulang.
- Browser Chrome: tampilan desktop, tablet 900 px, dan ponsel 390 px diperiksa.
  Lebar CSS aktual dibaca dari DOM karena emulasi browser memakai faktor skala.
  Pengukuran pada lebar 321 px juga lulus: `scrollWidth` dan `clientWidth`
  sama-sama 298 px setelah ruang scrollbar diperhitungkan.
- Login kosong: browser memblokir submit pada Email yang wajib diisi.
- Daftar: tombol Daftar menampilkan field Nama dan batas minimal kata sandi
  12 karakter. Submit kosong memicu validasi Nama. Tombol Masuk mengembalikan
  form ke mode login.
- Keyboard: Email -> Kata sandi -> Masuk -> Daftar. Field memiliki outline fokus
  solid 3 px; tombol mode juga memiliki outline yang terlihat.
- Tidak ditemukan error console dari aplikasi. Pesan console dari ekstensi
  Zotero pada browser pengguna tidak berasal dari source OpSmart.
- Rasio kontras terhitung: judul/krem 13,39:1; teks sekunder/putih 5,64:1;
  kicker/krem 5,10:1; teks kartu/putih 5,52:1; batas input/latar 3,11:1;
  putih/hijau tombol 8,34:1; footer/krem 9,24:1.

## Delivery gate antislop integrasi awal

- Hard Gate PASS: layout tanpa overflow pada ukuran yang diperiksa; form kosong
  dan toggle mode bekerja; outline fokus terlihat; angka di gambar bersumber
  dari screenshot yang diberikan pengguna. Gambar bersifat dekoratif dan
  disembunyikan dari teknologi bantu.
- Purpose Gate PASS: foto dan laptop mengikuti referensi pengguna; ikon memakai
  aset aplikasi; elevasi form dan kartu memisahkan teks dari foto; tidak ada
  animasi dekoratif berulang atau kontrol tanpa perilaku.
- Liveliness PASS: dials 2/2/1 mengikuti referensi; form menjadi fokus tindakan;
  komposisi foto, tanaman, warna, dan ruang kosong membentuk identitas farm.
- Craftsmanship PASS: form tetap memakai handler autentikasi yang ada, memiliki
  mode masuk/daftar, validasi, pending, dan error; build, format, tes transport,
  serta pemeriksaan browser yang disebutkan di atas lulus.

Pemeriksaan browser tidak mengirim kredensial nyata atau membuat akun baru.
Keberhasilan login dengan akun nyata dan deployment produksi tidak diuji ulang.
