import type { Browser, BrowserContextOptions } from "playwright";
import type { StandupFields } from "../standups/contracts.js";
import type { KolabSessionState } from "./contracts.js";

const kolabUrl = "https://absen.kolab.top/?page=rekap";
const kolabOrigin = "https://absen.kolab.top";

export type KolabAutomationResult = {
  status:
    "SENT" | "ALREADY_PRESENT" | "NEEDS_SESSION" | "NEEDS_REVIEW" | "FAILED";
  errorCode?:
    "LOGIN_REQUIRED" | "FORM_CHANGED" | "SUBMIT_UNCERTAIN" | "NETWORK";
};

function dateButtonLabel(date: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(`${date}T12:00:00+07:00`));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function reportText(fields: StandupFields): string {
  const sections: [string, string][] = [
    ["Rencana hari ini", fields.todayPlan],
    ["Pekerjaan sebelumnya", fields.previousWork],
    ["Kendala", fields.blockers],
  ];
  return sections
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `${label}:\n${value.trim()}`)
    .join("\n\n");
}

export async function submitKolabReport(
  browser: Browser,
  state: KolabSessionState,
  input: { date: string; fields: StandupFields },
): Promise<KolabAutomationResult> {
  const context = await browser.newContext({
    storageState: state.storageState as NonNullable<
      BrowserContextOptions["storageState"]
    >,
  });
  let saveStarted = false;
  try {
    if (state.sessionStorage.length)
      await context.addInitScript(
        ({ origin, entries }) => {
          if (location.origin !== origin) return;
          for (const entry of entries)
            sessionStorage.setItem(entry.name, entry.value);
        },
        { origin: kolabOrigin, entries: state.sessionStorage },
      );
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(kolabUrl, { waitUntil: "networkidle", timeout: 20_000 });
    const greeting = page.getByRole("heading", { name: /^Halo / });
    try {
      await greeting.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      return { status: "NEEDS_SESSION", errorCode: "LOGIN_REQUIRED" };
    }

    const label = dateButtonLabel(input.date);
    const missingReport = page.getByRole("button", {
      name: new RegExp(`^${escapeRegex(label)}`),
    });
    const missingCount = await missingReport.count();
    if (missingCount === 0) {
      const visibleReportDate = await page.locator("body").innerText();
      return visibleReportDate.includes(label)
        ? { status: "ALREADY_PRESENT" }
        : { status: "NEEDS_REVIEW", errorCode: "FORM_CHANGED" };
    }
    if (missingCount !== 1)
      return { status: "NEEDS_REVIEW", errorCode: "FORM_CHANGED" };

    await missingReport.click();
    const modal = page.locator("#dr-user-edit-modal");
    await modal.waitFor({ state: "visible" });
    const modalDate = modal.getByText(`Tanggal: ${input.date}`, {
      exact: true,
    });
    if ((await modalDate.count()) !== 1) {
      await page.locator("#dr-user-edit-cancel").click();
      return { status: "NEEDS_REVIEW", errorCode: "FORM_CHANGED" };
    }

    const content = page.locator("#dr-user-edit-content");
    const save = page.locator("#dr-user-edit-save");
    if ((await content.count()) !== 1 || (await save.count()) !== 1) {
      await page.locator("#dr-user-edit-cancel").click();
      return { status: "NEEDS_REVIEW", errorCode: "FORM_CHANGED" };
    }
    await content.fill(reportText(input.fields));
    saveStarted = true;
    await save.click();
    try {
      await modal.waitFor({ state: "hidden", timeout: 15_000 });
      return (await missingReport.count()) === 0
        ? { status: "SENT" }
        : { status: "NEEDS_REVIEW", errorCode: "SUBMIT_UNCERTAIN" };
    } catch {
      if ((await missingReport.count()) === 0) return { status: "SENT" };
      return { status: "NEEDS_REVIEW", errorCode: "SUBMIT_UNCERTAIN" };
    }
  } catch {
    return saveStarted
      ? { status: "NEEDS_REVIEW", errorCode: "SUBMIT_UNCERTAIN" }
      : { status: "FAILED", errorCode: "NETWORK" };
  } finally {
    await context.close().catch(() => undefined);
  }
}
