# Domain glossary

| Istilah                   | Definisi stabil                                                                |
| ------------------------- | ------------------------------------------------------------------------------ |
| Farm                      | Batas kepemilikan/akses dan konteks operasional usaha farming.                 |
| Farm Unit                 | Satu unit fisik tempat produksi berlangsung; bukan siklus produksi.            |
| Pond / Kolam              | FarmUnit bertipe FISH dengan dimensi dan kapasitas kolam.                      |
| Coop / Kandang            | FarmUnit bertipe CHICKEN dengan luas dan kapasitas ayam.                       |
| Growing Area / Area tanam | FarmUnit bertipe CROP dengan media, luas dan kapasitas.                        |
| Commodity                 | Jenis komoditas farm: nila, broiler, kangkung; terpisah dari produk/grade.     |
| Farming Cycle / Siklus    | Satu periode budidaya pada satu unit dan satu komoditas.                       |
| Activity / Aktivitas      | Pekerjaan atau pemeriksaan satu kali yang terkait cycle dan jadwal.            |
| Inventory Item            | Definisi bahan/barang dengan tepat satu base unit; bukan jumlah saldo.         |
| Inventory Lot             | Kelompok fisik item dengan asal/lokasi/expiry tertentu; menjaga provenance.    |
| Inventory Movement        | Fakta perubahan stok bertanda positif/negatif yang tidak boleh dihapus.        |
| Consumption / Pemakaian   | Catatan penggunaan resource pada activity dan cycle; menghasilkan movement.    |
| Harvest / Panen           | Kejadian panen dari cycle, dapat parsial dan berulang.                         |
| Harvest Output            | Satu hasil/grade/product dari harvest; menjadi satu lot.                       |
| Product / Produk          | Definisi komersial komoditas+grade+unit terkait satu InventoryItem.            |
| Sale / Penjualan          | Transaksi komersial yang berisi satu atau lebih SaleItem.                      |
| Sale Item                 | Baris produk, kuantitas, harga dan total; movement menentukan lot sumbernya.   |
| Cost / Biaya              | Nominal sumber operasional dengan klasifikasi; belum tentu beban produksi.     |
| HPP                       | Biaya produksi teralokasi dibagi hasil sesuai unit dan metode yang dinyatakan. |
| Revenue / Pendapatan      | Pembayaran POSTED dikurangi refund POSTED menurut tanggal penerimaan.          |
| Profit / Laba             | Revenue dikurangi COGS yang diakui menurut policy dan periode yang sama.       |
| Command Receipt           | Bukti command sukses untuk replay retry tanpa mengulang side effect.           |
| Reversal                  | Movement lawan yang merujuk movement asli; keduanya tetap dalam ledger.        |

Nama tabel memakai snake_case; nama type/property memakai camelCase/PascalCase.
Lifecycle produk pada sumber dipisahkan secara teknis: pertumbuhan di Cycle, panen di
Harvest, stok tersedia dari ledger, eligibility penjualan di ProductStatus.
