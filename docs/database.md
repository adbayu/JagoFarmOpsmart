# Database reference

DDL awal ada di db/migrations/001_foundation.sql; migrasi berikutnya menambah
arsip farm, autentikasi lokal, observasi siklus, koreksi biaya, ledger pembayaran,
dan penanda kelengkapan biaya siklus. `npm run db:migrate` menjalankan file bernomor
sekali per database, memeriksa checksum, dan membungkus tiap file dalam transaksi.
Jangan mengedit file yang sudah diterapkan. Tidak ada migrasi downgrade otomatis.

`002_farm_archive.sql` menambah archived_at/archived_by dan indeks daftar aktif. Arsip
mempertahankan unit/siklus/aktivitas/stok. Layanan mutasi menolak farm terarsip, tetapi
GET detail owner tetap tersedia untuk audit. Pemulihan arsip belum memiliki command/UI.
`004_cycle_observations.sql` menambah catatan monitoring eksplisit per siklus:
kehilangan populasi, bobot rata-rata dalam gram, catatan kondisi, waktu, dan actor.

## Konvensi audit dan nullability

`id` adalah UUID tanpa default; aplikasi membuat UUID. Semua tabel tenant memuat farm_id.
Secara SQL, field tanpa NOT NULL boleh kosong; optional field di tabel ringkas berikut
ditandai `?`. Null berarti belum dicatat/tidak berlaku, tidak sama dengan nol.

Entitas mutable memiliki created_at dan updated_at. UPDATE service wajib memperbarui
updated_at. Unit/cycle subtype adalah komposisi dari parent dan mewarisi timestamp parent.
HarvestOutput/SaleItem adalah immutable child dari dokumen posting; memakai audit parent.
Consumption/Movement/Lot/Receipt memiliki created_at; ledger immutable tidak punya updated_at.
Actor creation dicatat pada cycle, activity, consumption, movement, cost, harvest, sale, receipt.
Farm owner dicatat langsung. Dokumen yang bisa dibatalkan menyimpan cancelled_at/by;
cancel service wajib mengisi pasangan itu serta alasan pada notes/reversal.

## Entity dictionary

| Tabel / tanggung jawab             | Field utama dan optional                                                                                                                   | Key/relasi unik                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| app_user: identity mapping         | auth_subject, display_name                                                                                                                 | PK id; unique auth_subject                                     |
| farm: scope dan pemilik            | owner_id, name, location?, timezone, currency IDR                                                                                          | PK id; owner -> user; index owner                              |
| commodity: jenis produksi          | farm_id, name, farming_type                                                                                                                | PK id; UQ farm/id/type dan farm/name/type                      |
| farm_unit: unit fisik              | farm_id, name, type, location?, active                                                                                                     | PK id; UQ farm/name dan farm/id/type                           |
| pond: detail kolam                 | farm_id, unit_id, area_m2?, depth_m?, capacity_heads?, condition?                                                                          | PK unit_id; FK parent farm/id/FISH                             |
| coop: detail kandang               | farm_id, unit_id, area_m2?, capacity_heads?                                                                                                | PK unit_id; FK parent farm/id/CHICKEN                          |
| growing_area: detail area          | farm_id, unit_id, area_m2?, media?, capacity_plants?                                                                                       | PK unit_id; FK parent farm/id/CROP                             |
| farming_cycle: periode produksi    | unit_id, commodity_id, farming_type, name, status, start_date, target_harvest_date?, ended_at?                                             | PK id; composite FK unit/commodity match farm+type             |
| fish_cycle: detail siklus ikan     | cycle_id, farm_id, initial_population, seed_source?, initial_weight_g?                                                                     | PK cycle_id; typed FK parent                                   |
| chicken_cycle: detail siklus ayam  | cycle_id, farm_id, initial_population, strain?, initial_age_days?, seed_source?                                                            | PK cycle_id; typed FK parent                                   |
| crop_cycle: detail siklus tanaman  | cycle_id, farm_id, seed_count, variety?, seedling_date?                                                                                    | PK cycle_id; typed FK parent                                   |
| cycle_observation: monitoring      | cycle_id, actor_id, observed_at, population_loss?, average_weight_g?, condition_notes?                                                     | PK id; FK cycle farm sama; minimal satu datum                  |
| activity: pekerjaan terjadwal      | cycle_id, kind, status, scheduled_at, completed_at?, notes?                                                                                | PK id; UQ farm/id/cycle; FK cycle                              |
| inventory_item: definisi stok      | name, category, unit, minimum_stock, active                                                                                                | PK id; UQ farm/name/unit dan farm/id/unit                      |
| product: katalog jual              | commodity_id, inventory_item_id, name, grade?, unit, status, target_price_minor?                                                           | PK id; satu item per product; item+unit FK                     |
| harvest: kejadian panen            | cycle_id, harvest_date, location?, notes?, status                                                                                          | PK id; FK cycle                                                |
| harvest_output: hasil/grade        | harvest_id, product_id, inventory_item_id, quantity, weight_kg?                                                                            | PK id; composite FK product+item; FK harvest                   |
| inventory_lot: asal stok           | inventory_item_id, harvest_output_id?, label, location?, expires_on?                                                                       | PK id; UQ farm/output; FK output+item jika ada                 |
| consumption: pemakaian             | cycle_id, activity_id, inventory_item_id, quantity                                                                                         | PK id; composite FK activity+cycle; FK item                    |
| inventory_movement: perubahan stok | lot_id, inventory_item_id, type, quantity_delta, unit, consumption_id?, sale_item_id?, reversal_of?, transfer_group?, reason               | PK id; UQ farm/reversal; compound lot/item/unit/source FKs     |
| cost_entry: biaya sumber           | cycle_id?, activity_id?, inventory_movement_id?, source_key, category, treatment, amount_minor, cost_date, policy_version?, status, notes? | PK id; UQ farm/source_key, farm/movement; activity needs cycle |
| cycle_cost_completion: audit biaya | farm_id, cycle_id, completed_at, completed_by, updated_at                                                                                  | PK (farm_id,cycle_id); FK cycle                                |
| sale: dokumen jual                 | buyer, sale_date, status, payment_status, total_minor                                                                                      | PK id; payment_status is projected from sale_payment           |
| sale_item: baris jual              | sale_id, product_id, inventory_item_id, quantity, unit_price_minor, total_minor                                                            | PK id; compound product/item FK; FK sale                       |
| sale_payment: penerimaan/refund    | sale_id, kind, amount_minor, payment_date, source_key, status, reason?                                                                     | PK id; UQ farm/source_key; FK sale                             |
| command_receipt: retry record      | farm_id, operation, idempotency_key, request_hash, response, created_by                                                                    | PK (farm_id,operation,idempotency_key)                         |
| stock_balance: view                | farm_id, inventory_item_id, lot_id, quantity                                                                                               | SUM ledger; no independent stored quantity                     |

All tenant parents expose UNIQUE(farm_id,id) where needed for composite FK. FK deletion
defaults to RESTRICT/NO ACTION; there are no cascading business-record deletes.

## Index decisions

Unique indexes begin with farm_id to support scoped lookup. Additional indexes cover
cycle(unit,status), cycle(commodity,date), activity(status,scheduled_at), activity(cycle),
harvest(cycle,date), output(harvest), lot(item), movement(lot), movement(item,created_at),
movement(sale_item/consumption), cost(cycle,date), sale(date,status), sale_item(sale/product).
Read queries aggregate in SQL; do not fetch a ledger per inventory row (N+1).
Add indexes only when new query patterns require them, with EXPLAIN evidence.

## Enforcement boundary

DB enforces same farm/type references, unit compatibility, nonzero ledger movement,
positive quantities/nonnegative money, sign for core movement types, immutable ledger,
unique source/receipt/reversal, and basic start/target date order.

Service enforces owner authorization, allowed state transitions, exactly one subtype,
nonnegative stock under lock, one+ child per posting, total=sum(lines), reversal amount/lot
matching original, paired transfers, product commodity matching harvest cycle, linkage
of financial source to correct cycle, and policy-versioned HPP/revenue projections.
Referential integrity alone cannot prove accounting consistency.

Transfer_group is a UUID grouping two equal/opposite lot movements of the same item and
unit, within one farm. Cross-farm transfers need a future explicit business transaction.
Reversal must be exact opposite on the same lot/item/unit, once per original; reverse a
reversal is rejected by the future correction service. Cancellation keeps both movements
in sums, and reverses any source-specific effects atomically. A harvest cannot be cancelled
if its reversal would make stock negative.

Observasi terstruktur hanya menyimpan angka kehilangan populasi, bobot rata-rata dalam
gram, dan catatan kondisi. Activity.notes tidak menjadi sumber metrik terhitung.
