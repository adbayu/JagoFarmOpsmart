# P3-04 — Rekomendasi transparan dan read-only

Status: spesifikasi tertulis disetujui pemilik produk pada 2026-10-01. Rencana
implementasi menunggu tinjauan sebelum kode ditulis.

## Tujuan

Memberi anggota farm saran operasional yang dapat ditelusuri ke catatan farm
dan bagian SOP/panduan budidaya yang telah dikurasi serta disetujui. Sistem
menerbitkan saran secara deterministik, menampilkan batas kelengkapan buktinya,
dan tidak mengubah catatan agronomi, stok, biaya, jadwal, atau perangkat.

## Pemahaman dan batas produk yang disetujui

- Sumber farm yang dapat dipakai: siklus dan observasi, panen, konsumsi serta
  biaya/HPP, catatan limbah dan batch maggot, serta transfer air kolam ke area
  tanam. Jadwal dan stok boleh menjadi konteks pendukung, bukan satu-satunya
  dasar saran.
- SOP/panduan budidaya terkurasi menjadi sumber pengetahuan tambahan. Setiap
  kutipan harus menunjuk ke sumber, revisi, dan bagian/halaman tertentu.
- Semua anggota farm memiliki akses operasional yang setara. Status selesai
  atau abaikan hanya berlaku untuk anggota yang mengubah status itu.
- Saran tidak memakai LLM, prediksi, angka keyakinan tanpa kalibrasi, atau
  tindakan otomatis. Modul hanya boleh mengubah state saran pribadi anggota;
  catatan farm sumber tidak dapat dimutasi dari modul ini.
- Survival, growth, dan feed-efficiency yang belum memiliki definisi metrik
  tidak boleh dipakai sebagai kondisi pemicu.

Definisi metrik yang saat ini berlaku ada di
[`metric-definitions.md`](../../decisions/metric-definitions.md) dan aturan
HPP di [`finance-policy.md`](../../decisions/finance-policy.md). P3-04 memakai
kontrak tersebut apa adanya; perubahan definisi memerlukan keputusan produk.

## Sumber dan bukti

### Catatan farm

Evaluasi membaca fakta terkini melalui query farm-scoped yang sudah ada.
Setiap fakta yang dipakai mencatat tipe dan ID sumber, waktu pencatatan, serta
waktu snapshot evaluasi (`asOf`). Angka HPP hanya layak menjadi bukti bila
status kelengkapan biaya masih berlaku; nilai nol tidak boleh disamakan dengan
data yang belum lengkap. Kuantitas dari satuan berbeda tidak boleh digabung.

Jadwal dan stok dapat membantu menjelaskan konteks kartu bila sebuah rule
memakainya, tetapi tidak dengan sendirinya menerbitkan rekomendasi P3-04.

### SOP dan panduan

Rule aktif harus memiliki referensi ke sumber yang disetujui. Referensi
mencakup identitas sumber, revisi atau hash, pemilik/penerbit, hak pakai yang
telah diverifikasi, status persetujuan, dan bagian atau halaman. Sumber yang
belum disetujui, kedaluwarsa, dicabut, atau tidak dapat diakses membuat rule
abstain. Tidak ada konten SOP yang boleh ditebak atau dihasilkan oleh model.

Belum ada korpus SOP/panduan budidaya yang tercatat di repo ini. RAG-01 harus
menyetujui allowlist dan hak sumber; RAG-02 menyediakan registry/revisi yang
akan dirujuk. P3-04 tidak mengindeks dokumen, melakukan pencarian semantik,
atau memilih provider. Sebelum dua gate tersebut selesai, rule SOP tidak aktif.

## Evaluasi rule

Katalog rule mempunyai ID dan versi yang tidak berubah setelah diterbitkan,
jenis/komoditas yang berlaku, kondisi pemicu, bukti wajib, batas kesegaran
data, referensi SOP, alasan yang ditampilkan, dan tindakan manual yang
disarankan. Perubahan perilaku membuat versi baru.

Evaluator berjalan di server pada farm yang telah diotorisasi. Filter farm
diterapkan saat query sumber, bukan setelah data diambil. Rule menghasilkan
saran hanya bila seluruh prasyarat terpenuhi, bukti tidak basi, satuannya
sebanding, dan SOP cocok serta masih berlaku. Jika tidak, rule abstain dan
tidak mengirim saran operasional tanpa dasar.

UI menunjukkan kelengkapan bukti secara kategoris berdasarkan prasyarat rule;
UI tidak menampilkan persentase atau probabilitas keyakinan. Semua saran
memuat versi rule, waktu evaluasi, kondisi pemicu, penjelasan, tautan/ID
catatan farm, dan sitasi SOP yang dapat dibuka.

## Siklus hidup dan status anggota

Instance saran menyimpan snapshot rule/version, waktu, pemicu, serta referensi
bukti yang menghasilkan saran tersebut. Penerbitan ulang dengan rule/version
dan fingerprint bukti yang sama tidak menggandakan instance. Perubahan bukti
yang membentuk pemicu baru menghasilkan instance yang dapat ditelusuri;
instance lama tidak menimpa histori.

Evaluasi boleh menulis snapshot dan state rekomendasi untuk deduplikasi serta
riwayat. Penulisan itu hanya menyentuh tabel P3-04 dan tidak mengubah record
farm sumber.

Status anggota (`OPEN`, `COMPLETED`, `DISMISSED`) disimpan terpisah per instance
dan anggota. Setiap perubahan status menyimpan actor dan waktu. Mengubah status
hanya memperbarui state saran milik anggota itu, bukan sumber farm. Anggota
farm lain tetap melihat state mereka sendiri.

## UI dan API

- Halaman `/recommendations` mengikuti shell, tipografi, warna, kartu, dan pola
  state dashboard OpSmart yang telah ada.
- Kartu menyediakan penjelasan pemicu, bukti farm beserta waktu dan tautan,
  sitasi SOP versi/bagian, serta tindakan manual yang disarankan.
- Anggota dapat menandai saran selesai atau mengabaikannya. Tidak ada tombol
  yang menjalankan tindakan operasional.
- Loading, kosong, error/coba lagi, tidak ada rule aktif, dan bukti tidak cukup
  memiliki state yang jelas. Kegagalan sumber tidak ditampilkan sebagai saran
  yang valid.
- API membaca actor dari session server dan memeriksa membership farm. Satu-satunya
  command perubahan yang dipicu pengguna adalah perubahan status
  pribadi anggota dengan validasi dan idempotensi. Evaluasi dapat menyimpan
  snapshot rekomendasi; API tidak menyediakan command untuk modul farm lain.

## Penerimaan

1. Bukti farm lengkap dan segar bersama SOP yang disetujui menghasilkan saran
   dengan rule/version dan seluruh rujukan yang dapat ditelusuri.
2. Bukti hilang, basi, tidak sebanding, atau SOP tidak disetujui/kedaluwarsa/
   dicabut menghasilkan abstain, bukan saran generik.
3. Metrik survival, growth, dan feed-efficiency yang belum didefinisikan tidak
   pernah menjadi pemicu.
4. Rule version lama tetap terbaca setelah versi katalog baru diterbitkan.
5. Request berulang untuk rule/version dan bukti identik tidak menggandakan
   instance.
6. Status `COMPLETED` atau `DISMISSED` untuk satu anggota tidak mengubah status
   anggota lain dan tidak mengubah catatan sumber.
7. Akses anggota farm lain ditolak pada query, sitasi, dan perubahan status.
8. UI dapat digunakan dengan keyboard dan pada lebar ponsel; konten, sitasi,
   status, dan aksi tetap dapat dibaca tanpa horizontal overflow.

## Di luar cakupan

- Chat RAG/LLM, ingestion atau pencarian semantik, provider/model berbayar.
- Prediksi waktu panen, angka probabilitas keyakinan, dan metrik biologis yang
  belum disetujui.
- Pembuatan atau perubahan jadwal, persediaan, biaya, panen, siklus, atau
  pengaturan IoT oleh saran.
- Pengelolaan/unggah sumber SOP oleh pengguna farm. Konten dan hak pakai sumber
  ditetapkan lewat gate RAG-01/02.
- Notifikasi proaktif atau worker khusus untuk mengevaluasi rule.

## Gate sebelum implementasi

1. Pemilik meninjau dan menyetujui spesifikasi tertulis ini.
2. Rencana implementasi disusun dan ditinjau sebelum kode ditulis.
3. RAG-01/02 menetapkan sumber SOP/panduan yang boleh dipakai, hak pakai,
   retensi, pencabutan, serta cara merujuk revisi dan bagian.
4. Setidaknya satu rule awal dan dokumen SOP yang sesuai harus disetujui secara
   substantif sebelum rule tersebut diaktifkan untuk anggota farm. Belum ada
   korpus SOP atau rule agronomi spesifik di repo ini, jadi tidak ada rule
   produksi yang dapat diaktifkan hanya dari spesifikasi ini.
