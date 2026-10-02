# JagoFarm / OpSmart — handoff agent

Tujuan: Farm Operating System; kerjakan MVP per tugas kecil. Alur inti farm hingga
penjualan sudah tersedia; beberapa keputusan keuangan dan verifikasi produksi masih
terbuka. Baca README, docs/architecture.md,
docs/business-rules.md dan tugas terkait di docs/implementation-roadmap.md dahulu.

## Struktur

- src/modules/{farms,farming,schedules,inventory,finance,harvest,products,sales,analytics}:
  kontrak/domain/service/query milik modul. Tambahkan persistence dan API wiring saat diperlukan.
- src/shared: domain values, validation scalar, errors, exact decimal helpers.
- src/server: transaction adapter, idempotency/authorization wrapper, Express boundary.
- src/client: React shell, route map, reusable states/forms/tables/dialog.
- db/migrations: SQL authority, bernomor dan append-only; scripts/migrate.ts memeriksa checksum.
- tests: PGlite memakai SQL yang sama; tests/postgres untuk multiple connections.
- docs: source of truth dan roadmap. docs/reference merupakan sumber produk, bukan bukti implementasi.

## Aturan wajib

1. Jangan membuat domain yang menduplikasi cycle, item, product atau activity.
2. Semua kueri tenant memfilter farm_id. Actor berasal dari session server terverifikasi.
3. Pertahankan composite FK farm_id pada setiap relasi tenant. Jangan hanya menyembunyikan UI.
4. Jangan mengubah saldo secara langsung. Stock = SUM inventory_movement.quantity_delta.
   Ledger tidak boleh UPDATE/DELETE. Koreksi memakai reversal, bukan menghapus histori.
5. Semua mutasi inventory mengambil lock farm dalam transaksi yang sama. Baca ulang saldo
   setelah lock. Gunakan command() untuk idempotency; jangan mengirim network request di transaksi.
6. Jangan menjalankan command() bersarang. Orkestrator memakai helper tx yang sama.
7. Jangan menghitung HPP/profit di React, menebak kebijakan akuntansi, atau menggandakan
   biaya pembelian dan konsumsi. Nilai unavailable berbeda dengan nol.
8. Semua status berasal dari shared/domain.ts. Ubah enum SQL melalui migration baru dan tes parity.
9. Jangan hard-code angka dashboard. Jangan menyamarkan fixtures sebagai data pengguna.
10. UUID untuk ID; decimal quantity dan nominal uang sebagai string di API. BigInt hanya internal.
11. SQL snake_case; TypeScript camelCase; komponen PascalCase; UI Bahasa Indonesia.
12. Scalar Zod + input modul di boundary backend. Kuantitas, unit dan tanggal divalidasi ulang.
13. Selalu tambah/perbarui tes saat mengubah logika bisnis; cek rollback, retry dan tenant isolation.
14. Jangan mengedit migration yang telah diterapkan secara destruktif. Gunakan migration berikutnya.
15. Jangan mengimplementasikan Phase 2/3 saat tugas MVP tanpa permintaan eksplisit.
16. Jangan membuka akses melalui x-user-id atau identitas dari body. ResolveIdentity default deny.
17. Ubah updated_at secara eksplisit pada UPDATE entitas mutable. Ledger/child immutable memakai waktu induk.

## Commands

`npm ci`, `npm run dev`, `npm run dev:server`, `npm run db:migrate`, `npm test`,
`npm run test:postgres`, `npm run typecheck`, `npm run build`, `npm run format:check`.
No lint framework is configured; strict TS + Prettier are the initial checks.

## Status per 2026-10-01

Task 01–20 selesai untuk cakupan MVP/Core yang disepakati. Task 16 menerapkan
kebijakan `finance-mvp-v1`: revenue berbasis pembayaran, klasifikasi biaya, HPP
berbobot, dan COGS/reversal untuk sale. Task 19 mencakup error transport aman,
pembedaan 401/503, retry sesi, audit keyboard/browser, dan grant PostgreSQL.
Task 20 diverifikasi dengan suite serial PGlite 82/82, build/typecheck, dan format;
PostgreSQL 18.4 menerapkan migrasi 001–013, runtime grants lolos pemeriksaan
least-privilege, dan `npm run test:postgres` lulus 1/1 tanpa skip. Detail bukti dan
batas deployment ada di `docs/verification.md`.

Phase 2/3 masih berlangsung. P2-04 selesai untuk dua jalur sirkular yang ditentukan
sumber produk; P2-05 masih parsial karena definisi survival, growth, dan feed
efficiency belum disetujui. Phase 3 belum diimplementasikan: rancangan P3-01 menunggu
tinjauan, RAG-01 masih draft karena korpus/hak pakai/hosting/retensi/provider/biaya
belum ditetapkan, dan P3-04 menunggu tinjauan rencana serta sumber SOP yang disetujui.
Deployment produksi dan browser dengan PostgreSQL belum diverifikasi.

## Codebase memory (inherited workspace rule)

Before structural exploration call codebase-memory-mcp list_projects, match this absolute
repo path, check index_status; index_repository(persistence=false) if absent. Use explicit
project name in graph queries, check_index_coverage before exhaustive/negative claims, and
source reads for partial/stale coverage. Refresh after substantial edits. Keep graph artifacts
outside the repo. If tools are unavailable, report briefly and use rg/source reads.
When /graphify is explicitly requested, load the installed graphify skill first.

<!-- antislop:start -->

## antislop

Salinan skill dari [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop)
tersimpan di `.codex/skills/` (lisensi dan versi di
`.codex/skills/THIRD_PARTY_NOTICES.md`). Untuk UI, copy, aksesibilitas, layout mobile,
atau komentar kode, baca `.codex/skills/antislop/SKILL.md` lalu skill spesifiknya:

- UI: `.codex/skills/antislop-ui/SKILL.md`
- Copy: `.codex/skills/antislop-copywriting/SKILL.md`
- Aksesibilitas: `.codex/skills/antislop-human/SKILL.md`
- Responsif/mobile: `.codex/skills/antislop-layoutmobile/SKILL.md`
- Komentar kode: `.codex/skills/antislop-code/SKILL.md`

Ikuti resolusi mode `during`/`after` di skill inti sebelum review, perencanaan,
atau perubahan UI. Untuk UI OpSmart, gunakan arah visual dashboard dan keputusan
produk yang sudah ada; antislop menyaring pola tanpa tujuan, bukan mengganti arah
desain. Skill ini hanya untuk proses agen, bukan prompt atau kebijakan runtime RAG.
<!-- antislop:end -->
