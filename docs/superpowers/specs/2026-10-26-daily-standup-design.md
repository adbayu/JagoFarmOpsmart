# Daily Standup — keputusan yang disetujui

Laporan operasional internal per akun, satu laporan per tanggal WIB, lintas farm.
Semua akun terautentikasi dapat membaca versi terkirim seluruh pengguna. Draf
dan revisi belum terkirim hanya dapat dibaca pemilik; tidak ada penghapusan laporan.

- Hari wajib: Senin–Jumat, kecuali libur nasional dan cuti bersama Indonesia.
- Akun mulai dihitung pada hari kerja setelah tanggal pembuatannya, termasuk
  pengguna yang tidak membuka aplikasi pada hari itu.
- Rencana hari ini wajib saat mengirim. Pekerjaan sebelumnya dan kendala opsional.
- Draf otomatis tersimpan. Kirim memublikasikan laporan pertama; Simpan perubahan
  mengganti versi publik. Revisi belum dipublikasikan tidak mengganti versi terkirim.
- Semua penulisan laporan berhenti tepat pukul 12.00 WIB, menurut waktu server.
- Pengingat dapat dilewati dan tampil maksimal sekali per akun per hari kerja.
  Indikator Belum diisi tetap tersedia. Setelah tenggat, status Tidak mengisi.
- Menu tersendiri, rekap per tanggal, semua pengguna yang sudah wajib melapor.
- API kalender publik; hasil berhasil disimpan permanen dan disegarkan berkala.
  Gangguan tanpa cache tidak menghalangi pengisian weekday sebelum tenggat;
  kalender ditandai belum terverifikasi.
- Tidak mengubah domain operasional, stok, keuangan, sesi, atau signup.

## Keputusan teknis

Rekap dimulai pada tanggal WIB penerapan migration, supaya tidak menciptakan
ketidakhadiran sebelum fitur tersedia. Kalender lama tetap dipakai jika refresh
gagal. Data draf memakai versi optimistis; transaksi mengunci akun dan menyimpan
receipt idempotensi agar retry tidak menggandakan publikasi. Panggilan kalender
selalu dilakukan di luar transaksi. Reminder diklaim atomik sebelum ditampilkan.
Tidak ada perubahan struktur farm; akses global merupakan keputusan produk khusus
standup, bukan perluasan akses data farm.
