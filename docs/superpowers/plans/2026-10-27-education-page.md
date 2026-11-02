# Education page

## Tujuan dan batas

Permintaan: periksa progres AI RAG Education dan buat halamannya. Source checkout
ini belum memuat registry knowledge, ingestion/index, adapter provider, endpoint
jawaban, atau halaman Education. RAG-01 masih draft; sumber SOP internal telah
dipilih sebagai arah, tetapi dokumen dan provider belum diberikan.

Buat halaman frontend `/education` dengan Tanya AI, Kelola Knowledge, Kelola API.
Gunakan shell, ikon, tipografi, warna krem/putih/hijau dashboard yang ada; antislop
mode during mengikuti pilihan pengguna. Tidak menampilkan jawaban/dokumen/statistik
buatan atau menganggap engine RAG aktif. Jangan menyimpan API key di browser atau
mengirim dokumen ke provider yang belum dipilih. Halaman ini bukan implementasi
backend RAG-02–06. Pertanyaan provider/SOP diajukan sambil mengerjakan UI.

## Langkah

1. Tambahkan EducationPage: navigasi bagian melalui query URL, area pertanyaan
   dengan contoh yang mengisi draf, state sumber belum terhubung, persyaratan
   dokumen dan status koneksi API. Tindakan yang belum didukung diberi alasan.
2. Hubungkan route dan sidebar, tambahkan ikon dalam sistem ikon aplikasi.
3. Tambahkan CSS responsif terisolasi. Perbarui status/roadmap untuk membedakan
   halaman yang tersedia dari layanan RAG yang belum diimplementasikan.
4. Build/typecheck, format, dan tinjau tampilan. Tidak menambah atau menjalankan
   suite tes tanpa permintaan pengguna, mengikuti instruksi pengembang.

## Fokus tinjauan

Tidak mengesankan koneksi AI sudah aktif; tidak ada source/kutipan/angka palsu;
tidak ada penyimpanan rahasia; draf pertanyaan bertahan saat mengganti bagian;
tautan/query dapat dibuka langsung; keyboard/focus dan layout sempit tetap layak.

## Hasil pelaksanaan

- Route dan sidebar Education tersedia. Tiga bagian memakai URL query, label
  navigasi aktif, serta copy yang menyatakan layanan belum terhubung.
- Browser memperlihatkan Tanya AI, Kelola Knowledge, dan Kelola API. Contoh
  pertanyaan mengisi textarea, dan draf tetap ada saat berpindah bagian.
- Pengukuran DOM pada lebar CSS 325 px menunjukkan scrollWidth/clientWidth sama
  306 px setelah scrollbar; seluruh elemen Education berada dalam lebar viewport.
  Ukuran browser dikembalikan dan pratinjau akhir dibuka pada tab baru.
- Build akhir lulus termasuk typecheck serta kompilasi client/server. Prettier
  berkas terkait dan git diff whitespace check lulus. Ada peringatan ukuran chunk
  client >500 kB serta anotasi dependensi Zod. Tidak menjalankan suite tes otomatis.
- Provider dan SOP belum diberikan pada tahap ini; ingestion/index, jawaban,
  unggah dokumen, dan penyimpanan konfigurasi API belum diimplementasikan.
