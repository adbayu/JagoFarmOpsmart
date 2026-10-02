# Business rules

## Farm, unit dan cycle

- Actor harus terverifikasi dan berhak pada farm. Semua relasi tenant harus farm yang sama.
- Cycle terkait tepat satu unit dan satu commodity bertipe sama. Parent+detail wajib atomik.
- PLANNED -> ACTIVE/CANCELLED; ACTIVE -> COMPLETED/CANCELLED; terminal tidak dibuka kembali.
- Status transition helper hanya memeriksa graph. Service juga wajib memeriksa prasyarat:
  unit aktif, subtype lengkap untuk aktivasi; tidak ada aktivitas terbuka saat selesai;
  pembatalan tidak boleh menghilangkan catatan konsumsi/biaya/panen sebelumnya.
- Tidak ada asumsi satu unit hanya boleh satu cycle aktif, atau satu cycle satu harvest.

## Activity dan schedule

- SCHEDULED -> IN_PROGRESS/COMPLETED/MISSED/CANCELLED.
- IN_PROGRESS -> COMPLETED/CANCELLED; MISSED -> IN_PROGRESS/CANCELLED.
- COMPLETED dan CANCELLED terminal. expectedStatus mencegah menimpa update pengguna lain.
- Konsumsi diizinkan hanya untuk cycle ACTIVE dan activity SCHEDULED/IN_PROGRESS.
- Pencatatan konsumsi tidak otomatis menyelesaikan pekerjaan. Retry command completion
  harus terpisah dari retry consumption. Tidak ada recurring/agronomic template otomatis.
- MISSED tidak diciptakan berdasarkan tebakan toleransi waktu; aturan penandaan dicatat
  ketika penjadwalan diimplementasikan.

## Inventory

- Stock = jumlah seluruh signed movements; movement asli dan reversal sama-sama dihitung.
- Tidak boleh UPDATE/DELETE movement. Cache saldo, jika ditambahkan, bukan authority.
- Item satu base unit; lot terkait tepat satu item. Satuan product sama dengan item.
- Deduction > 0, qty tersisa >= 0, discrete unit tidak boleh pecahan.
- Semua write stok harus memegang farm lock dalam transaksi; UI check saja tidak cukup.
- Duplicate key+payload menghasilkan receipt yang sama. Key sama payload berbeda -> 409.
- Satu consumption dapat menghabiskan beberapa lot, setiap lot sekali pada alokasi command.
- Transfer harus pasangan equal/opposite, satu farm/item/unit; expired/damaged adalah
  pencatatan write-off terotorisasi, bukan penghilangan histori. Expiry policy penjualan
  masih perlu ditetapkan sebelum membuat klaim bahwa produk expired otomatis diblokir.

## Harvest dan product

- Harvest terkait cycle; output commodity harus sesuai cycle, product/grade boleh berbeda.
- Panen parsial dan banyak output sah. Satu output satu lot; unit output dari produk.
- quantity dan weight_kg terpisah: 50 HEAD dan 80 KG tidak dijumlahkan.
- Buat output, lot dan stock-in atomik. Jangan stock-in dua kali saat retry.
- Product ACTIVE menunjukkan eligibility katalog, bukan jaminan stok tersedia.
- Jangan menggunakan Growing/Sold sebagai satu enum untuk cycle, activity dan product.

## Sales

- Semua item harus product aktif milik farm; stok dialokasikan ke lot eksplisit.
- Input tidak menerima total dari client. Harga ditetapkan oleh actor berwenang, total
  dihitung server dengan half-up sekali per baris.
- Sale langsung COMPLETED pada contoh service. DRAFT -> COMPLETED/CANCELLED pada flow
  edit draft mendatang; COMPLETED -> CANCELLED hanya melalui reversal transaction.
- PaymentStatus terpisah: contoh selalu UNPAID. Saat payment ledger dibuat, status
  diturunkan dari jumlah pembayaran sah (0, sebagian, penuh), bukan bebas diubah UI.
- Sale, semua line, stock deduction, receipt satu transaction. Tidak ada backorder.
- Pembatalan tidak berarti uang otomatis direfund; return/refund butuh keputusan dan record.

## Finance dan analytics

- Raw costs, pembelian inventory, nilai transaksi, penerimaan pembayaran, dan revenue adalah
  konsep terpisah. Revenue memakai payment/refund POSTED menurut tanggal penerimaan.
- Pembelian inventory bukan biaya produksi saat stok masuk. Hanya konsumsi yang memiliki
  biaya terukur dan tertaut ke siklus yang bisa masuk HPP; pemakaian tanpa biaya membuat HPP
  tidak tersedia.
- PRODUCTION cost memerlukan cycle_id dan policy_version. Biaya bersama dialokasikan manual;
  UNCLASSIFIED membuat HPP tidak tersedia. CAPITAL dan depresiasi dikecualikan dari MVP.
- HPP nol memerlukan penanda kelengkapan biaya yang masih berlaku. Biaya atau konsumsi baru
  sesudah penanda membuat HPP tidak tersedia sampai siklus ditandai lengkap kembali.
- HPP cycle dibagi menurut berat kg seluruh output panen. COGS mengikuti kuantitas yang
  terjual dan pembayaran diterima; refund tidak membalik COGS, sedangkan pembatalan sale
  membalik HPP yang telah diakui pada tanggal reversal stok.
- Semua kalkulator ada di finance/, analytics hanya menyusun query dan presentasi DTO.
- Formula sesuai `finance-mvp-v1`: HPP/kg = biaya produksi teralokasi / berat output; gross
  profit = revenue diterima - matched COGS; margin = profit / revenue × 100 bila revenue positif.
- Survival/growth/yield/FCR memerlukan baseline, measurement window dan denominator yang
  sesuai; bila input hilang, denominator nol, atau basis berbeda -> UNAVAILABLE + reason.
- Jangan mengurangkan seluruh biaya cycle dari penjualan parsial lalu menyebutnya net profit.
- CompletedSalesValue boleh SUM completed sale totals, label itu bukan revenue otomatis.
- Agregasi memakai interval [from,toExclusive) dan timezone jelas; grup quantity menurut unit.
- Tidak ada klaim efisiensi/circular savings tanpa data pembanding.

## Cakupan enforcement sekarang

Farm, unit, commodity, cycle, observation, consumption, dan direct sale melaksanakan
transaction/auth/idempotency sesuai service masing-masing. Cycle menegakkan tipe
unit/komoditas, transition graph, expectedStatus, dan prasyarat aktivasi/penyelesaian.
Harvest, koreksi biaya, payment/refund, HPP dan metrik finance telah diterapkan pada service
dan query farm-scoped; verifikasi rinci dicatat di `docs/verification.md`. Jangan
menafsirkan metrik yang `UNAVAILABLE` sebagai nol.
