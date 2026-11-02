import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";

const origin = "https://absen.kolab.top";
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const prompt = createInterface({ input: stdin, output: stdout });

try {
  const page = await context.newPage();
  await page.goto(`${origin}/?page=rekap`, { waitUntil: "domcontentloaded" });
  console.log("Masuk ke akun Kolab Anda pada jendela browser yang terbuka.");
  await prompt.question(
    "Setelah terlihat halaman rekap, tekan Enter di sini. ",
  );

  if (new URL(page.url()).origin !== origin) {
    throw new Error("Browser belum kembali ke halaman Kolab.");
  }
  const greeting = page.getByRole("heading", { name: /^Halo / });
  if ((await greeting.count()) !== 1 || !(await greeting.isVisible())) {
    throw new Error(
      "Login Kolab belum terdeteksi. Jalankan ulang setelah berhasil login.",
    );
  }

  const captured = await context.storageState();
  const sessionStorage = await page.evaluate(() =>
    Object.entries(window.sessionStorage).map(([name, value]) => ({
      name,
      value,
    })),
  );
  const state = {
    storageState: {
      cookies: captured.cookies.filter((cookie) => {
        const domain = cookie.domain.toLowerCase().replace(/^\./, "");
        return domain === "kolab.top" || domain === "absen.kolab.top";
      }),
      origins: captured.origins.filter((entry) => entry.origin === origin),
    },
    sessionStorage,
  };
  if (
    state.storageState.cookies.length === 0 &&
    state.storageState.origins.every(
      (entry) => entry.localStorage.length === 0,
    ) &&
    state.sessionStorage.length === 0
  ) {
    throw new Error("Tidak ada sesi Kolab yang dapat disimpan.");
  }

  const directory = join(tmpdir(), "opsmart-kolab");
  await mkdir(directory, { recursive: true });
  const file = join(directory, `kolab-session-${randomUUID()}.json`);
  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).length > 80_000) {
    throw new Error("File sesi Kolab melebihi batas 80 KB.");
  }
  await writeFile(file, serialized, {
    mode: 0o600,
    flag: "wx",
  });
  console.log(`File sesi disimpan sementara: ${file}`);
  console.log(
    "Unggah file ini hanya ke akun OpSmart Anda, lalu hapus file lokalnya.",
  );
} finally {
  prompt.close();
  await context.close();
  await browser.close();
}
