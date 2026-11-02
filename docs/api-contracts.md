# Service dan API contracts

## Pola bersama

Write service: `(db: Database, context: CommandContext, raw: unknown) => Promise<Receipt>`.
Context = `{farmId, actorId}` dari route + server identity. Parse dengan schema Zod modul
sebelum command(). Field tak dikenal pada body ditolak. Quantity dan MoneyMinor string.
Semua write menyertakan UUID idempotencyKey; actor tidak pernah diambil dari body.

HTTP sukses `{data: Receipt}`, error `{error:{code,message}}`. POST command memakai 200
baik pertama maupun replay. List mendatang: `{data: T[], nextCursor: string|null}`;
limit default 25, max 100, urut stabil created_at/id; detail tidak membocorkan farm lain.

## Endpoint yang sudah terhubung

| Method/path                            | Service/input                   | Output                      | Validation / transaction                                                      |
| -------------------------------------- | ------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| GET /api/health                        | tidak butuh identity            | status=ok, phase=foundation | liveness saja                                                                 |
| GET /api/farms                         | listFarms                       | FarmSummary[] aktif         | owner_id terverifikasi; arsip tidak termasuk                                  |
| POST /api/farms                        | createFarmInput                 | FarmSummary                 | lock actor; farm ID = key; farm+receipt satu transaksi                        |
| GET /api/farms/:farmId                 | getFarm                         | FarmSummary                 | owner; arsip dapat dibaca untuk audit                                         |
| PATCH /api/farms/:farmId               | updateFarmInput                 | FarmSummary                 | owner; farm lock; retry; nama/lokasi                                          |
| POST /api/farms/:farmId/archive        | archiveFarmInput                | FarmSummary                 | owner; soft archive dan receipt atomik                                        |
| POST /api/farms/:farmId/consumptions   | inventory.consume; consumeInput | consumptionId, quantity     | owner; cycle/activity valid; item/unit/lot cocok; stock cukup; satu transaksi |
| POST /api/farms/:farmId/sales/complete | sales.completeSale; saleInput   | saleId, totalMinor          | owner; product aktif; totals server; alokasi stock; satu transaksi            |

Route siklus aktif pada farm milik owner:

| Method/path                                              | Input / output                     | Aturan utama                                                       |
| -------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| GET/POST /api/farms/:farmId/commodities                  | daftar / createCommodityInput      | komoditas unik per farm, nama, dan tipe                            |
| GET/POST /api/farms/:farmId/cycles                       | daftar / createCycleInput          | unit dan komoditas satu tipe; parent+detail atomik; mulai PLANNED  |
| GET /api/farms/:farmId/cycles/:cycleId                   | CycleDetail                        | detail subtype hanya dari farm owner                               |
| POST /api/farms/:farmId/cycles/:cycleId/transition       | transitionCycleInput → CycleDetail | expectedStatus, graph status, prasyarat aktif/selesai, receipt     |
| GET/POST /api/farms/:farmId/cycles/:cycleId/observations | daftar / createObservationInput    | POST hanya ACTIVE; GET mempertahankan riwayat setelah status akhir |

Default ResolveIdentity null: semua route farm dan operasi menolak 401. Integrasi identity harus diverifikasi,
bukan mengaktifkan header tiruan. Sampel service dapat dipanggil langsung oleh tes dengan
trusted context; itu bukan desain autentikasi publik.

```ts
// consumeInput
{
  idempotencyKey: 'UUID', cycleId: 'UUID', activityId: 'UUID',
  inventoryItemId: 'UUID', unit: 'KG',
  allocations: [{ lotId: 'UUID', quantity: '2.125' }]
}
// saleInput (date ISO date-only; price in IDR minor units)
{
  idempotencyKey: 'UUID', buyer: 'Nama pembeli', saleDate: '2026-09-28',
  items: [{ productId: 'UUID', unitPriceMinor: '3500000',
    allocations: [{ lotId: 'UUID', quantity: '2.125' }] }]
}
```

## Kontrak implementasi berikutnya

Ini kontrak internal API untuk pekerjaan berikutnya. Unit, siklus, jadwal, dan
persediaan sudah memiliki route aktif; baris berikut tetap rencana. Tiap input sudah punya Zod schema kecuali
query filters/koreksi yang ditetapkan pada task pemiliknya. Base path `/api/farms/:farmId`.

| Service yang dibuat nanti | Input schema/file                                | Receipt / output | Invariant dan commit boundary                                       |
| ------------------------- | ------------------------------------------------ | ---------------- | ------------------------------------------------------------------- |
| products.createProduct    | createProductInput                               | productId        | item category HARVEST_PRODUCT, commodity farm valid; unit dari item |
| harvest.postHarvest       | postHarvestInput                                 | HarvestReceipt   | cycle ACTIVE, date>=start; outputs+lots+stock-in+receipt            |
| finance.recordCost        | recordCostInput                                  | costId           | simpan UNCLASSIFIED; source unique; cycle/activity/source valid     |
| finance.calculateHpp      | HppInputs (trusted data, bukan HTTP body mentah) | HppResult        | hanya approved policy dan input lengkap; method/asOf disertakan     |
| analytics.getDashboard    | AnalyticsScope + identity                        | DashboardSummary | owner checked; scoped grouped SQL queries; no write                 |

Route unit aktif: `GET/POST /api/farms/:farmId/units`,
`GET/PATCH /api/farms/:farmId/units/:unitId`, dan
`POST /api/farms/:farmId/units/:unitId/archive`. POST create mengembalikan
`{unitId}`; GET/PATCH/archive mengembalikan unit dengan detail tipe. Daftar hanya
unit aktif. Arsip mempertahankan riwayat dan ditolak saat siklus PLANNED/ACTIVE.
Perubahan tipe hanya boleh sebelum unit memiliki siklus.
Kolam FISH menerima `condition` opsional (maksimum 500 karakter) saat dibuat dan
`null` untuk mengosongkannya saat diubah. `GET
/api/farms/:farmId/units/:unitId/cycles` mengembalikan
`FishCycleSummary[]` (nama, status, komoditas, tanggal mulai/target panen) hanya
untuk kolam aktif pada farm milik pengguna; unit tipe lain atau farm asing tidak
mengungkap daftar siklus.

Route aktivitas aktif: `GET/POST /api/farms/:farmId/activities`,
`GET /api/farms/:farmId/activities/:activityId`, dan
`POST /api/farms/:farmId/activities/transition`. GET daftar wajib menerima
`from` dan `to` berupa ISO datetime dengan offset; hasil memakai rentang
`[from,to)` berdasarkan waktu terjadwal. POST create memakai
`createActivityInput` dan mengembalikan `{activityId}` pada status `SCHEDULED`;
siklus harus aktif. POST transition memakai `transitionActivityInput`,
`expectedStatus`, dan transition graph. Perubahan ke `MISSED` hanya perintah
eksplisit. Waktu `completed_at` atau `cancelled_at` serta `cancelled_by`
dicatat dalam transaksi yang sama dengan status dan receipt.

Route persediaan aktif: `GET/POST /api/farms/:farmId/items`,
`GET/PATCH /api/farms/:farmId/items/:itemId`,
`GET /api/farms/:farmId/items/:itemId/lots`, `POST /api/farms/:farmId/lots`,
`GET/PATCH /api/farms/:farmId/lots/:lotId`. Item dan lot baru bersaldo nol;
kuantitas hanya berubah melalui ledger. `GET /api/farms/:farmId/movements`
menerima `itemId` opsional serta `limit` (1–100) dan `offset`; hasil terurut
terbaru dengan `nextOffset`. Semua GET farm-scoped.

Command `POST /api/farms/:farmId/movements/{stock-in,adjust,transfer,dispose,reverse}`
memerlukan `idempotencyKey` UUID dan `reason` (1–500 karakter). Payload khusus:
`stock-in` = `{lotId,quantity}`, `adjust` = `{lotId,quantityDelta}` bertanda,
`transfer` = `{fromLotId,toLotId,quantity}`, `dispose` =
`{lotId,quantity,type: "EXPIRED" | "DAMAGED"}`, `reverse` = `{movementId}`.
Kuantitas adalah string desimal maksimal tiga digit fraksi; UNIT/HEAD/SEED
bilangan bulat. Transfer mencatat dua baris dengan `transferGroup` dan saldo
total nol; reversal menambah baris lawan pada lot yang sama dan hanya sekali.
Command manual tidak boleh menciptakan stok HARVEST_PRODUCT tanpa asal panen.
Lot kedaluwarsa tidak ditawarkan sebagai opsi pemakaian dan ditolak oleh
helper pengurangan stok pada konsumsi maupun penjualan.

Task 11 mengaktifkan `GET /api/farms/:farmId/consumption-options` untuk item
aktif dan lot bersaldo positif, serta
`GET /api/farms/:farmId/activities/:activityId/consumptions` untuk histori
aktivitas. `POST /api/farms/:farmId/consumptions` menerima `consumeInput`
dengan alokasi lot; aktivitas harus SCHEDULED/IN_PROGRESS dan siklus ACTIVE.
Pemakaian tidak otomatis menyelesaikan aktivitas.

Task 12 mengaktifkan `GET/POST /api/farms/:farmId/costs`,
`GET /api/farms/:farmId/costs/:costId`,
`POST /api/farms/:farmId/costs/:costId/correct`,
`POST /api/farms/:farmId/costs/:costId/cancel`, dan
`GET /api/farms/:farmId/cost-activities`. Pencatatan memakai
`recordCostInput`; koreksi menambah `correctionReason`, sourceKey baru, dan
mengganti versi POSTED secara atomik. Pembatalan memakai alasan wajib.
Setiap biaya tetap `UNCLASSIFIED`; movement sumber hanya STOCK_IN non-panen
tanpa konteks siklus/aktivitas atau CONSUMPTION yang cocok siklus/aktivitas.
Koreksi/pembatalan mempertahankan catatan asal dan dibuat idempoten.

Task 13–15 mengaktifkan `GET/POST /api/farms/:farmId/products`,
`GET/PATCH /api/farms/:farmId/products/:productId`, dan
`GET /api/farms/:farmId/product-item-options`; item harus HARVEST_PRODUCT dan
grade tidak dapat diubah setelah dipakai panen/penjualan. `GET/POST
/api/farms/:farmId/harvests`, `GET /api/farms/:farmId/harvests/:harvestId`,
dan `POST /api/farms/:farmId/harvests/:harvestId/cancel` membaca/memposting
panen dengan output multi-grade, lot, stok masuk dan pembatalan reversal.
`GET /api/farms/:farmId/sales/lot-options`, `GET /api/farms/:farmId/sales`,
`GET /api/farms/:farmId/sales/:saleId`, dan
`POST /api/farms/:farmId/sales/:saleId/cancel` melengkapi
`POST /api/farms/:farmId/sales/complete`. Semua read farm-scoped, command
memakai receipt idempoten. Penjualan belum menyatakan pembayaran diterima.

Task 17–18 mengaktifkan `GET /api/farms/:farmId/dashboard` dan
`GET /api/farms/:farmId/analytics/production?from=YYYY-MM-DD&toExclusive=YYYY-MM-DD`
(`cycleId` opsional). Dashboard mengembalikan read model farm-scoped dengan
`asOf`; analitik memakai batas `[from,toExclusive)` dan tidak menjumlahkan
unit berbeda. Metrik yang belum bisa dihitung memakai `UNAVAILABLE` dengan
alasan, bukan nol.

Task 16 mengaktifkan `GET/POST
/api/farms/:farmId/sales/:saleId/payments`, `POST
/api/farms/:farmId/sales/:saleId/refunds`, dan `POST
/api/farms/:farmId/payments/:paymentId/cancel`. Semua mutasi memakai
`idempotencyKey` dan `sourceKey` bukti unik untuk entri baru. Refund tidak
boleh melebihi penerimaan bersih; penerimaan tidak boleh melebihi nilai sale.
Pembatalan sale ditolak jika penerimaan bersih masih positif. `payment_status`
adalah proyeksi dari ledger POSTED, bukan dasar pengakuan pendapatan.

Finance juga menyediakan `GET /api/farms/:farmId/finance/hpp/:cycleId` untuk
proyeksi HPP siklus dan `POST
/api/farms/:farmId/finance/hpp/:cycleId/cost-complete` untuk menandai pencatatan
biaya lengkap dengan `idempotencyKey`. HPP hanya tersedia bila semua output
panen POSTED memiliki berat, biaya produksi/consumsi terukur, tidak ada biaya
UNCLASSIFIED, dan penanda kelengkapan masih berlaku. Biaya atau konsumsi baru
memerlukan penandaan ulang.

Dashboard menyertakan `finance.revenue`, `finance.hpp`, `finance.profit` serta
ID sumber payment/refund/sale/cost/harvest/movement. Analytics production
mengembalikan metrik dan sumber yang sama dalam interval `[from,toExclusive)`.
Revenue mengikuti tanggal payment/refund; COGS mengikuti penerimaan parsial,
dan reversal sale mengurangi COGS pada tanggal pembatalan.
Parameter `cycleId` analytics hanya memfilter baris produksi; metrik keuangan
tetap agregat seluruh farm karena satu sale dapat mengambil stok dari beberapa
siklus dan MVP belum mengalokasikan revenue per siklus.

Farm creation special case: belum ada farm untuk dilock. Lock app_user dahulu, buat farm
dengan id=creation key; cek existing owner dan receipt hash sebelum replay. Simpan farm dan
receipt dalam transaksi yang sama; jangan memanggil command() nested. Hak owner/user tidak
boleh bisa diubah lewat create body. Tugas pertama merinci pola ini.

## Errors

422 VALIDATION: salah bentuk/unit/precision/date. 401 UNAUTHORIZED: session tidak ada.
403 FORBIDDEN: farm tidak dapat diakses. 404 NOT_FOUND: item/lot/product tidak tersedia
di scope. 409 CONFLICT: status/relasi/key reuse/constraint. 409 INSUFFICIENT_STOCK:
saldo kurang. 500 INTERNAL: kegagalan lain dengan pesan generik, tanpa SQL/secret.
Retry network error dengan key+payload sama; jangan retry otomatis 422/403. Serialization
409 dapat dicoba ulang setelah refresh. UI tidak boleh menganggap respons hilang = gagal commit.

## Route UI map

Route `/farm/fish`, `/farm/chicken`, dan `/farm/crops` memuat registry unit.
Detail `/farm/fish/:unitId`, `/farm/chicken/:unitId`, dan
`/farm/crops/:unitId` sudah aktif.

| Route                                  | Tujuan / entity                | Aksi utama nanti                                                    | Modul                      |
| -------------------------------------- | ------------------------------ | ------------------------------------------------------------------- | -------------------------- |
| /dashboard                             | ringkasan aktual               | rentang waktu, buka aktivitas                                       | analytics, finance         |
| /farm/fish, /farm/chicken, /farm/crops | daftar typed unit              | buat/archive unit                                                   | farms,farming              |
| /farm/fish/:unitId                     | kolam + siklus terkait         | lihat, ubah, arsip kolam                                            | farming                    |
| /farm/chicken/:unitId                  | detail kandang Coop            | lihat, ubah, arsip kandang                                          | farming                    |
| /farm/crops/:unitId                    | detail area tanam GrowingArea  | lihat, ubah, arsip area tanam                                       | farming                    |
| /cycles                                | daftar + buat siklus/komoditas | pilih unit dan tipe komoditas                                       | farming                    |
| /cycles/:cycleId                       | detail + observasi siklus      | transisi, catat observasi                                           | farming                    |
| /schedule                              | Activity                       | buat, mulai, selesai, batalkan                                      | schedules                  |
| /inventory, /inventory/:itemId         | item,lot,movement              | item/lot, intake, koreksi, transfer, reversal; consumption menyusul | inventory                  |
| /harvest, /harvest/:harvestId          | harvest/outputs                | posting panen                                                       | harvest,products,inventory |
| /products                              | product catalog                | buat/nonaktif, target price                                         | products                   |
| /sales, /sales/:saleId                 | sale/lines                     | complete, lihat asal lot                                            | sales                      |
| /finance/costs                         | raw CostEntry                  | catat/koreksi dengan audit                                          | finance                    |
| /finance/hpp                           | HPP projection                 | scope cycle, lihat method/reason                                    | finance                    |
| /analytics                             | grouped operational data       | filter interval/commodity                                           | analytics                  |

Farm selection sudah aktif; tidak ada settings kosong atau Phase 2/3
menu yang berpura-pura aktif. Client forms memakai primitives; hubungkan aria-describedby
dan aria-invalid ke FormField error. ConfirmDialog dipakai untuk cancellation beralasan.

## Daily Standup (global, sesi wajib)

Tidak memakai farmId atau userId dari client. Semua mutasi menggunakan origin dan
CSRF sesi yang sama dengan endpoint aplikasi lainnya. Response memakai `{data}`
atau envelope error standar.

| Method/path                       | Input                                                                                               | Data                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GET /api/standups/current         | —                                                                                                   | Tanggal/jam server WIB, deadline, hari/kalender, status dan draf pemilik |
| GET /api/standups?date=YYYY-MM-DD | Tanggal sampai hari ini, tahun 2000–2100                                                            | Pengguna wajib dan versi publikasi saja                                  |
| POST /api/standups/save           | idempotencyKey UUID, date, version integer >= 0, todayPlan, previousWork, blockers, publish boolean | Draf pemilik dengan version baru dan publikasi terakhir                  |
| POST /api/standups/reminder       | date                                                                                                | `{show: boolean}`; klaim sekali per akun/tanggal                         |

Semua kolom teks maksimal 6000 karakter. `todayPlan.trim()` wajib tidak kosong
ketika publish=true. Body strict; penambahan actor/farm ditolak. Versi 0 untuk
draf pertama. Konflik versi atau key berbeda payload memberi 409 CONFLICT;
hari/tenggat tidak memenuhi aturan memberi 409 STANDUP_CLOSED. Replay receipt
berhasil mengembalikan response yang sama, termasuk setelah tenggat.

Kontrak TypeScript dan validator response ada di
`src/modules/standups/contracts.ts`. Lihat [kebijakan lengkap](daily-standup.md).
