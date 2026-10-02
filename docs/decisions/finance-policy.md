# Kebijakan keuangan MVP

Versi: `finance-mvp-v1`  
Status: **disetujui pemilik produk pada 2026-09-30**.

## Pendapatan

- Pendapatan diakui saat pembayaran diterima, memakai tanggal `sale_payment.payment_date`.
- Hanya entri payment/refund berstatus `POSTED` yang dihitung. Refund mengurangi pendapatan pada tanggal refund.
- Nilai penjualan memakai harga akhir per item; model belum menyimpan diskon terpisah.
- Penjualan yang sudah dibayar hanya dapat dibatalkan setelah saldo penerimaan bersih menjadi nol melalui refund.

## Biaya produksi dan HPP

- HPP hanya memasukkan biaya berstatus `POSTED` dan bertreatment `PRODUCTION` yang tertaut langsung ke siklus atau ke pergerakan konsumsi pada siklus itu.
- Pembelian persediaan tidak dihitung saat stok masuk. Biaya persediaan baru masuk HPP ketika dipakai dan biaya pemakaiannya dapat diukur serta ditautkan ke pergerakan konsumsi. Jika konsumsi tidak memiliki biaya terukur, HPP siklus belum lengkap.
- Biaya `UNCLASSIFIED` membuat HPP siklus belum lengkap. `CAPITAL` dan depresiasi tidak dimasukkan pada MVP.
- Biaya bersama harus dialokasikan manual sebagai nominal biaya produksi untuk masing-masing siklus.
- HPP nol hanya tersedia setelah pemilik menandai pencatatan biaya siklus lengkap. Biaya atau konsumsi baru setelah penandaan membuat konfirmasi itu usang sampai ditandai lengkap lagi.
- Biaya produksi dibagi berdasarkan berat `weight_kg`. Semua output dalam siklus harus memiliki berat yang dapat dibandingkan; campuran satuan yang tak dapat dikonversi membuat HPP tidak tersedia. Alokasi antar-grade mengikuti proporsi berat.
- HPP per kg dihitung dari seluruh berat output siklus. COGS hanya diakui untuk kuantitas panen yang telah dialokasikan ke penjualan; panen yang belum terjual tidak disajikan sebagai aset finansial.
- Untuk pembayaran parsial, HPP/COGS diakui sebanding dengan nilai pembayaran yang diterima terhadap nilai jual item. Refund mengurangi revenue, tetapi tidak membalik HPP/COGS. Pembatalan sale mengembalikan stok melalui reversal dan membalik HPP/COGS yang sudah diakui pada tanggal reversal.
- Perhitungan uang memakai integer unit terkecil; pembulatan dibulatkan setengah ke atas dan sisa alokasi diberikan ke alokasi terakhir.

## Reproduksibilitas dan batas MVP

- Projection menyertakan versi kebijakan, waktu `asOf`, method, dan ID sumber biaya, panen, penjualan, payment/refund, serta pergerakan stok yang dipakai.
- Jika data sumber wajib tidak lengkap atau unit tidak sebanding, hasil adalah `UNAVAILABLE` dengan alasan; ketidaklengkapan tidak boleh ditampilkan sebagai nol.
- Projection selalu dibatasi oleh farm yang dimiliki aktor. Nilai dashboard memakai semua tanggal sampai `asOf`; analitik memakai rentang `[from,toExclusive)`.
- Pembelian barang untuk dijual kembali, retur fisik stok, pajak, depresiasi, dan penilaian aset panen tidak dimodelkan oleh MVP saat ini. Penambahan alur itu memerlukan kebijakan dan sumber biaya/kuantitas yang dapat ditelusuri.
