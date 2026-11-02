# Daily Standup Implementation Plan

Spec: `docs/superpowers/specs/2026-10-26-daily-standup-design.md`.
Goal: laporan harian internal dengan draf privat dan rekap global.
Architecture: modul standups, tabel global per akun, Express session boundary,
React route dan pengingat di shell. Tech: PostgreSQL, TypeScript, Zod, React.

## Global constraints

Actor dari sesi, tidak menerima userId dari body. Draf tidak masuk DTO rekap.
Waktu server WIB; setelah lock periksa lagi tenggat. Publikasi eksplisit.
Tidak menyentuh domain inventory/finance atau migration terdahulu. Pertahankan
perubahan login dan launcher yang sudah ada. Implementasi inline di workspace
karena penulisan branch dibatasi. Tidak membuat commit perubahan pengguna.

## Task 1: Persistence dan kebijakan server

Migration 014: kalender, konfigurasi awal, laporan, reminder, receipt.
Modul: kontrak DTO/input, kalender cache, waktu/eligibility, query dan mutasi.
Kunci akun untuk setiap mutasi; versi konflik dan receipt untuk retry.

## Task 2: API dan UI

Endpoint session-only current/recap/save/reminder; perlindungan CSRF yang ada.
Menu, dashboard indicator, reminder sekali, form autosave dan publikasi eksplisit,
rekap bertanggal serta pembacaan publikasi. Form tetap aman bila offline/konflik.

## Task 3: Dokumentasi dan pemeriksaan

Dokumentasikan batas global dan deployment migration/grants, API kalender serta
fallback. Pemeriksaan build/typecheck dan format berkas terkait; pengujian tidak
ditambahkan atau dijalankan tanpa permintaan, mengikuti instruksi pengembang.

## Review focus

Kebocoran draf; cutoff saat menunggu lock; edit stale/cross-tab; idempotensi
sesudah cutoff; kegagalan kalender/response malformed; reminder multi-device;
mutasi tanpa sesi/CSRF; autosave bentrok submit; rollout dan timezone.

## Pelaksanaan

- Task 1 selesai: schema 014 diterapkan ke PostgreSQL lokal, modul kalender dan
  transaksi per akun tersedia. Tidak ada migration lama yang diubah.
- Task 2 selesai: menu, form, rekap, indikator dashboard/menu dan reminder tersedia.
- Review independen membaca source dan menemukan tiga masalah UI: blur menahan
  publikasi, unmount navigasi membuang state gagal tersimpan, dan response malformed
  dianggap berhasil. Ketiganya diperbaiki: autosave debounce tanpa blur, editor
  tetap mounted dalam shell saat berpindah route, dan parsing DTO dengan Zod.
- Ruling: rekap dimulai pada tanggal migration, bukan sebelum fitur tersedia.
  Konsekuensi: tidak ada status ketidakhadiran historis sebelum tanggal tersebut.
- Ruling: branch tidak dapat dibuat karena sandbox membatasi penulisan `.git`;
  implementasi berada di working tree yang sama dan tidak membuat commit.
- Build pertama lulus termasuk typecheck dan kompilasi client/server. Vite memberi
  peringatan chunk client >500 kB dan anotasi dari dependensi Zod; bukan kegagalan.
- Tes otomatis dan browser tidak dijalankan mengikuti instruksi pengembang.
  Review statis dan build tidak membuktikan behavior waktu/konkurensi di runtime.
- Pemeriksaan akhir: `npm run build` exit 0 (typecheck, Vite, kompilasi server),
  Prettier pada semua berkas perubahan standup lulus, dan `git diff --check` lulus.
  Tidak ada perubahan product code setelah build akhir.
