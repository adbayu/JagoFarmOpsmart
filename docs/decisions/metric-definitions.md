# Definisi metrik operasional v1

- **Produksi**: jumlah `harvest_output.quantity` dari panen berstatus `POSTED`,
  dikelompokkan menurut siklus, komoditas, dan satuan produk. Panen dibatalkan
  dikeluarkan. Grade boleh digabung hanya bila satuannya sama.
- **Periode**: tanggal panen `harvest_date` dalam `[from,toExclusive)`, berdasarkan
  tanggal lokal farm yang dicatat, bukan waktu pembuatan record.
- **Volume transfer air tercatat**: jumlah `circular_water_transfer.quantity_liters`
  dalam `[from,toExclusive)`, dikelompokkan per bulan, kolam sumber, dan area tanam
  tujuan. Setiap grup menampilkan jumlah catatan dan ID sumber transfer; volume bukan
  ukuran air yang diserap tanaman, penghematan, atau efisiensi.
- **Periode transfer**: tanggal `transfer_date` yang dimasukkan pengguna; bulan pertama
  atau terakhir pada filter dapat mencakup sebagian bulan. `asOf` menunjukkan waktu
  snapshot query.
- **Input limbah batch maggot tercatat**: jumlah `maggot_batch_input.quantity`,
  dikelompokkan menurut bulan UTC `created_at` dan satuan input. Setiap grup menyertakan
  jumlah catatan, ID input, ID limbah, dan ID batch. Ini mengukur kuantitas yang dicatat
  masuk ke batch; bukan rasio pemanfaatan atau efisiensi.
- **Hasil maggot tercatat**: jumlah `maggot_batch_output.quantity`, dikelompokkan menurut
  bulan UTC `harvested_at` dan satuan output. Setiap grup menyertakan jumlah catatan serta
  ID output dan batch. Angka ini tidak menyatakan kuantitas yang sudah dipakai atau
  diposting ke stok pakan.
- **Kejadian panen**: jumlah `harvest.id` berbeda di setiap grup produksi.
- **Tingkat hidup**: belum tersedia. Populasi awal ada, tetapi definisi akhir
  harus memperhitungkan panen parsial, kehilangan, dan penjualan hidup.
- **Pertumbuhan**: belum tersedia sampai bobot awal dan akhir yang sebanding
  menurut umur/tanggal siklus tercatat lengkap.
- **Efisiensi pakan**: belum tersedia sampai konsumsi pakan dan pertambahan
  biomassa dapat dicocokkan pada periode dan satuan yang sama.
- **Revenue**: penerimaan payment POSTED dikurangi refund POSTED menurut tanggal transaksi.
- **HPP/kg**: biaya PRODUCTION POSTED teralokasi ke seluruh output siklus menurut berat;
  HPP nol perlu penanda kelengkapan biaya yang masih berlaku.
- **COGS**: porsi HPP output yang terjual, diakui proporsional terhadap penerimaan pembayaran.
  Refund tidak membalik COGS; pembatalan sale membalik COGS yang sudah diakui pada tanggal
  reversal stok.
- **Profit kotor**: revenue dikurangi COGS. HPP/profit tidak diturunkan dari total biaya
  mentah atau nilai transaksi selesai saja; kebijakan rinci ada di `finance-policy.md`.
