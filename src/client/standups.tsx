import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getCsrfToken } from "./auth-api.js";
import type { z } from "zod";
import {
  currentStandupSchema,
  ownStandupSchema,
  standupRecapSchema,
  reminderResultSchema,
} from "../modules/standups/contracts.js";
import {
  Card,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import type {
  CurrentStandup,
  StandupFields,
  StandupRecap,
} from "../modules/standups/contracts.js";
import {
  kolabSyncStatusSchema,
  type KolabSyncStatus,
} from "../modules/kolab-sync/contracts.js";

class StandupError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  try {
    const response = await fetch(`/api/standups${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? undefined
          : {
              "Content-Type": "application/json",
              "x-csrf-token": getCsrfToken() ?? "",
            },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 401)
      window.dispatchEvent(new Event("opsmart-auth-expired"));
    const result = await response.json();
    if (!response.ok)
      throw new StandupError(
        result.error?.code ?? "INTERNAL",
        result.error?.message ?? "Layanan standup belum tersedia.",
      );
    if (!result || !("data" in result)) throw new Error("Invalid response");
    return schema.parse(result.data);
  } catch (error) {
    if (error instanceof StandupError) throw error;
    throw new StandupError(
      "TRANSPORT",
      "Koneksi standup terputus. Coba lagi untuk memastikan hasil penyimpanan.",
    );
  }
}
const statusLabels = {
  SUBMITTED: "Sudah mengisi",
  PENDING: "Belum mengisi",
  MISSED: "Tidak mengisi",
} as const;
const kolabStatusLabels = {
  PENDING: "Menunggu pengiriman setelah pukul 12.00 WIB",
  SENDING: "Sedang mengirim",
  SENT: "Terkirim",
  ALREADY_PRESENT: "Laporan sudah ada di Kolab",
  NEEDS_SESSION: "Akun Kolab perlu dihubungkan ulang",
  NEEDS_REVIEW: "Perlu diperiksa di Kolab",
  FAILED: "Pengiriman gagal setelah beberapa percobaan",
} as const;
const kolabErrorLabels: Record<string, string> = {
  SESSION_REQUIRED: "Sesi Kolab perlu dihubungkan ulang.",
  LOGIN_REQUIRED: "Sesi Kolab kedaluwarsa atau tidak lagi valid.",
  FORM_CHANGED: "Tampilan formulir Kolab berubah dan perlu diperiksa.",
  SUBMIT_UNCERTAIN: "Hasil pengiriman perlu diperiksa di Kolab.",
  NETWORK: "Koneksi ke Kolab gagal.",
  TOO_OLD: "Laporan terlalu lama untuk dikirim otomatis.",
};
function dateLabel(date: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full",
  }).format(new Date(`${date}T00:00:00+07:00`));
}
function timeLabel(date: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}
function dateTimeLabel(date: string) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}
function fields(own: StandupFields): StandupFields {
  return {
    todayPlan: own.todayPlan,
    previousWork: own.previousWork,
    blockers: own.blockers,
  };
}
export function useStandups() {
  const [current, setCurrent] = useState<CurrentStandup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const alive = useRef(true);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const data = await api("/current", currentStandupSchema);
      if (alive.current && sequence.current === id) {
        setCurrent(data);
        setReceivedAt(Date.now());
        setError(null);
      }
    } catch (e) {
      if (alive.current && sequence.current === id)
        setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const poll = window.setInterval(() => void refresh(), 30_000);
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      window.clearInterval(poll);
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  const serverEstimate = current
    ? new Date(current.serverNow).getTime() + Math.max(0, tick - receivedAt)
    : Infinity;
  const canEdit = Boolean(
    current?.state === "OPEN" &&
    serverEstimate < new Date(current.deadline).getTime(),
  );
  return { current, error, refresh, canEdit };
}
type StandupState = ReturnType<typeof useStandups>;

function CalendarNotice({
  day,
}: {
  day: { calendarVerified: boolean; calendarStale: boolean };
}) {
  if (!day.calendarVerified)
    return (
      <p className="standup-warning" role="status">
        Kalender libur belum terverifikasi. Untuk sementara, Senin–Jumat tetap
        dapat diisi sebelum pukul 12.00 WIB.
      </p>
    );
  if (day.calendarStale)
    return (
      <p className="standup-note">
        Kalender tersimpan digunakan karena pembaruan API libur belum tersedia.
      </p>
    );
  return null;
}
export function StandupShell({ state }: { state: StandupState }) {
  const location = useLocation();
  const path = useRef(location.pathname);
  path.current = location.pathname;
  const [reminder, setReminder] = useState(false);
  const attempted = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const data = state.current;
  useEffect(() => {
    if (
      !data ||
      !state.canEdit ||
      data.status !== "PENDING" ||
      attempted.current === data.date
    )
      return;
    attempted.current = data.date;
    let cancelled = false;
    void api("/reminder", reminderResultSchema, { date: data.date })
      .then((result) => {
        if (!cancelled && result.show && path.current !== "/standups")
          setReminder(true);
      })
      .catch(() => {
        /* The menu remains available when claiming the reminder fails. */
      });
    return () => {
      cancelled = true;
    };
  }, [data?.date, data?.status, state.canEdit]);
  useEffect(() => {
    if (!state.canEdit || location.pathname === "/standups") setReminder(false);
  }, [state.canEdit, location.pathname]);
  useEffect(() => {
    if (reminder && !dialog.current?.open) dialog.current?.showModal();
    if (!reminder) dialog.current?.close();
  }, [reminder]);
  const showBanner =
    location.pathname === "/dashboard" &&
    data?.eligible &&
    data.status !== "SUBMITTED";
  return (
    <>
      {showBanner && (
        <aside className="standup-banner" aria-label="Daily Standup">
          <div>
            <strong>
              {state.canEdit
                ? "Standup hari ini belum diisi"
                : "Standup hari ini ditutup"}
            </strong>
            <p>
              {state.canEdit
                ? "Bagikan rencana kerja sebelum pukul 12.00 WIB."
                : "Lihat rekap pekerjaan harian tim."}
            </p>
          </div>
          <Link className="button-link" to="/standups">
            {state.canEdit ? "Isi standup" : "Lihat rekap"}
          </Link>
        </aside>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="standup-reminder-title"
        onCancel={(e) => {
          e.preventDefault();
          setReminder(false);
        }}
      >
        <h2 id="standup-reminder-title">Rencana kerja hari ini</h2>
        <p>
          Isi Daily Standup sebelum pukul 12.00 WIB. Rencana hari ini wajib;
          pekerjaan sebelumnya dan kendala boleh dikosongkan.
        </p>
        <p>
          Anda dapat melanjutkan pekerjaan dan mengisinya nanti melalui menu
          Daily Standup.
        </p>
        <div className="actions">
          <button autoFocus type="button" onClick={() => setReminder(false)}>
            Nanti
          </button>
          <Link
            className="button-link"
            to="/standups"
            onClick={() => setReminder(false)}
          >
            Isi sekarang
          </Link>
        </div>
      </dialog>
      <div hidden={location.pathname !== "/standups"}>
        <StandupToday state={state} />
      </div>
    </>
  );
}

function Composer({
  current,
  canEdit,
  refresh,
}: {
  current: CurrentStandup;
  canEdit: boolean;
  refresh: () => Promise<void>;
}) {
  const [value, setValue] = useState<StandupFields>(() => fields(current.own));
  const latest = useRef(value);
  latest.current = value;
  const version = useRef(current.own.version);
  const saved = useRef(JSON.stringify(fields(current.own)));
  const [published, setPublished] = useState(current.own.published);
  const [publishedAt, setPublishedAt] = useState(current.own.publishedAt);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState(
    current.own.version
      ? "Draf tersimpan."
      : "Draf tersimpan otomatis saat Anda menulis.",
  );
  const pending = useRef<
    | (StandupFields & {
        idempotencyKey: string;
        date: string;
        version: number;
        publish: boolean;
      })
    | null
  >(null);
  const mounted = useRef(true);
  const flush = useRef(() => {});
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flush.current();
    };
  }, []);
  async function persist(publish: boolean, retry = false) {
    if (busyRef.current || blocked || (!canEdit && !retry)) return;
    const snapshot = fields(latest.current);
    if (!publish && !retry && JSON.stringify(snapshot) === saved.current)
      return;
    busyRef.current = true;
    if (mounted.current) {
      setBusy(true);
      setError(null);
    }
    const input =
      retry && pending.current
        ? pending.current
        : {
            ...snapshot,
            idempotencyKey: crypto.randomUUID(),
            date: current.date,
            version: version.current,
            publish,
          };
    pending.current = input;
    try {
      const result = await api("/save", ownStandupSchema, input);
      version.current = result.version;
      saved.current = JSON.stringify(fields(result));
      pending.current = null;
      if (mounted.current) {
        setUncertain(false);
        setPublished(result.published);
        setPublishedAt(result.publishedAt);
        setNotice(
          input.publish
            ? "Laporan berhasil dikirim dan dapat dibaca tim."
            : "Draf tersimpan. Perubahan belum dikirim ke tim.",
        );
        if (input.publish) void refresh();
      }
    } catch (e) {
      if (mounted.current) {
        const problem = e as StandupError;
        const conflict =
          problem.code === "CONFLICT" || problem.code === "STANDUP_CLOSED";
        const unknown =
          !conflict && ["TRANSPORT", "INTERNAL"].includes(problem.code);
        setBlocked(conflict);
        setUncertain(unknown);
        if (!unknown) pending.current = null;
        setError(
          problem.code === "CONFLICT"
            ? "Laporan berubah di tab atau perangkat lain. Salin teks Anda sebelum memuat versi terbaru."
            : problem.message,
        );
        if (problem.code === "STANDUP_CLOSED") void refresh();
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
      else if (
        !pending.current &&
        JSON.stringify(latest.current) !== saved.current
      )
        flush.current();
    }
  }
  flush.current = () => {
    if (!error && !uncertain && !blocked) void persist(false);
  };
  useEffect(() => {
    if (!canEdit || busy || error || blocked || uncertain) return;
    const timer = window.setTimeout(() => void persist(false), 650);
    return () => window.clearTimeout(timer);
  }, [value, canEdit, busy, error, blocked, uncertain]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (
        busyRef.current ||
        pending.current ||
        JSON.stringify(latest.current) !== saved.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);
  const changed = JSON.stringify(value) !== saved.current;
  const revision =
    published && JSON.stringify(value) !== JSON.stringify(published);
  return (
    <Card
      title={published ? "Laporan Anda" : "Tulis standup hari ini"}
      className="standup-composer"
    >
      <p id="standup-privacy">
        Draf hanya terlihat oleh Anda. Tim membaca versi yang sudah dikirim.
      </p>
      {!canEdit && (
        <p className="standup-warning">
          Pengisian ditutup. Draf yang belum dikirim tetap privat dan tidak
          dihitung sebagai laporan terkirim.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void persist(true);
        }}
      >
        <fieldset aria-describedby="standup-privacy">
          {(
            [
              ["todayPlan", "Rencana hari ini", true],
              ["previousWork", "Pekerjaan sebelumnya (opsional)", false],
              ["blockers", "Kendala (opsional)", false],
            ] as const
          ).map(([key, label, required]) => (
            <FormField key={key} id={`standup-${key}`} label={label}>
              <textarea
                id={`standup-${key}`}
                rows={key === "todayPlan" ? 5 : 3}
                maxLength={6000}
                required={required}
                readOnly={!canEdit || blocked || uncertain}
                value={value[key]}
                onChange={(e) => {
                  setValue((old) => ({ ...old, [key]: e.target.value }));
                  setError(null);
                }}
              />
            </FormField>
          ))}
        </fieldset>
        <p role="status" aria-live="polite" className="standup-note">
          {busy
            ? "Menyimpan…"
            : changed && !error
              ? "Ada perubahan yang belum tersimpan."
              : notice}
        </p>
        {error && (
          <div role="alert" className="standup-warning">
            <p>{error}</p>
            {uncertain && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void persist(false, true)}
              >
                Coba lagi
              </button>
            )}
            {blocked && (
              <button type="button" onClick={() => window.location.reload()}>
                Muat versi terbaru (mengganti teks di layar)
              </button>
            )}
          </div>
        )}
        {canEdit && (
          <button
            type="submit"
            disabled={
              busy ||
              blocked ||
              uncertain ||
              !value.todayPlan.trim() ||
              Boolean(published && !revision)
            }
          >
            {published ? "Simpan perubahan" : "Kirim"}
          </button>
        )}
      </form>
      {publishedAt && published && (
        <details className="standup-publication">
          <summary>Versi terkirim · {timeLabel(publishedAt)} WIB</summary>
          <Report fields={published} />
        </details>
      )}
    </Card>
  );
}
function Report({ fields: report }: { fields: StandupFields }) {
  return (
    <dl className="standup-report">
      <dt>Rencana hari ini</dt>
      <dd>{report.todayPlan}</dd>
      <dt>Pekerjaan sebelumnya</dt>
      <dd>{report.previousWork || "Tidak diisi."}</dd>
      <dt>Kendala</dt>
      <dd>{report.blockers || "Tidak diisi."}</dd>
    </dl>
  );
}

function StandupToday({ state }: { state: StandupState }) {
  const current = state.current;
  return (
    <>
      <PageHeader
        eyebrow="Operasional internal"
        title="Daily Standup"
        description="Rencana pekerjaan harian seluruh tim. Laporan berlaku per akun dan dapat dibaca lintas farm setelah dikirim."
      />
      {state.error && (
        <StatePanel
          kind="error"
          title="Standup belum dapat dimuat"
          onRetry={() => void state.refresh()}
        >
          {state.error}
        </StatePanel>
      )}
      {!current && !state.error && (
        <StatePanel kind="loading" title="Memuat standup…" />
      )}
      {current && (
        <>
          <section className="standup-day">
            <div>
              <h2>{dateLabel(current.date)}</h2>
              <p>Senin–Jumat · Batas pengiriman dan perubahan 12.00 WIB</p>
            </div>
            {current.status && (
              <span
                className={`standup-status ${current.status.toLowerCase()}`}
              >
                {
                  statusLabels[
                    current.status === "PENDING" && !state.canEdit
                      ? "MISSED"
                      : current.status
                  ]
                }
              </span>
            )}
          </section>
          <CalendarNotice day={current} />
          {current.state === "DAY_OFF" && (
            <StatePanel kind="empty" title="Hari ini tidak wajib standup">
              {current.holiday ??
                "Standup berlangsung pada hari Senin sampai Jumat."}
            </StatePanel>
          )}
          {current.state === "NOT_STARTED" && (
            <StatePanel kind="empty" title="Standup belum dimulai">
              Rekap dimulai pada {dateLabel(current.startsOn)}.
            </StatePanel>
          )}
          {current.state === "NOT_ELIGIBLE" && (
            <StatePanel
              kind="empty"
              title="Akun baru mulai pada hari kerja berikutnya"
            >
              Anda sudah dapat membaca laporan tim.
            </StatePanel>
          )}
          {(current.eligible || current.own.version > 0) && (
            <Composer
              key={current.date}
              current={current}
              canEdit={state.canEdit}
              refresh={state.refresh}
            />
          )}
        </>
      )}
    </>
  );
}

export function StandupsPage({ state }: { state: StandupState }) {
  const [selectedDate, setSelectedDate] = useState("");
  const date = selectedDate || state.current?.date || "";
  const [recap, setRecap] = useState<StandupRecap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = state.current;
  useEffect(() => {
    if (!date) return;
    let live = true;
    setLoading(true);
    setError(null);
    void api(`?date=${encodeURIComponent(date)}`, standupRecapSchema)
      .then((data) => {
        if (live) setRecap(data);
      })
      .catch((e) => {
        if (live) setError((e as Error).message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [date, attempt, current?.serverNow]);
  return (
    <>
      <KolabSyncCard />
      <Card title="Rekap tim" className="standup-recap">
        <FormField id="standup-date" label="Tanggal laporan (WIB)">
          <input
            id="standup-date"
            type="date"
            value={date}
            min="2000-01-01"
            max={current?.today}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </FormField>
        {loading && <p role="status">Memuat rekap…</p>}
        {error && (
          <StatePanel
            kind="error"
            title="Rekap belum dapat dimuat"
            onRetry={() => setAttempt((v) => v + 1)}
          >
            {error}
          </StatePanel>
        )}
        {recap && recap.date === date && (
          <>
            <CalendarNotice day={recap} />
            {recap.state === "DAY_OFF" && (
              <p>
                {recap.holiday ?? "Akhir pekan."} Tidak ada kewajiban standup.
              </p>
            )}
            {recap.state === "NOT_STARTED" && (
              <p>Rekap dimulai pada {dateLabel(recap.startsOn)}.</p>
            )}
            <DataTable
              caption={`Standup tim · ${dateLabel(recap.date)}`}
              rows={recap.users}
              rowKey={(row) => row.userId}
              emptyMessage="Tidak ada pengguna yang wajib melapor pada tanggal ini."
              columns={[
                {
                  key: "user",
                  label: "Pengguna",
                  render: (row) => row.displayName,
                },
                {
                  key: "status",
                  label: "Status",
                  render: (row) => (
                    <span
                      className={`standup-status ${row.status.toLowerCase()}`}
                    >
                      {statusLabels[row.status]}
                    </span>
                  ),
                },
                {
                  key: "report",
                  label: "Laporan terkirim",
                  render: (row) =>
                    row.published ? (
                      <details>
                        <summary>
                          Baca laporan · {timeLabel(row.published.publishedAt)}{" "}
                          WIB
                        </summary>
                        <Report fields={row.published} />
                      </details>
                    ) : (
                      "Belum ada laporan terkirim."
                    ),
                },
              ]}
            />
          </>
        )}
      </Card>
    </>
  );
}

function KolabSyncCard() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [sync, setSync] = useState<KolabSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const refresh = () => {
      void api("/kolab", kolabSyncStatusSchema)
        .then((data) => {
          if (live) {
            setSync(data);
            setError(null);
          }
        })
        .catch((failure) => {
          if (live) setError((failure as Error).message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      live = false;
      window.clearInterval(interval);
    };
  }, [attempt]);

  async function uploadSession(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (file.size > 80_000)
        throw new Error("File sesi Kolab harus berukuran maksimal 80 KB.");
      const payload: unknown = JSON.parse(await file.text());
      const data = await api("/kolab/session", kolabSyncStatusSchema, payload);
      setSync(data);
    } catch (failure) {
      setError(
        (failure as Error).message || "File sesi Kolab tidak dapat dibaca.",
      );
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      setBusy(false);
    }
  }

  async function act(path: "/kolab/disconnect" | "/kolab/retry") {
    setBusy(true);
    setError(null);
    try {
      const data = await api(path, kolabSyncStatusSchema, {});
      setSync(data);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canRetry = Boolean(
    sync?.deliveries.some(
      (delivery) =>
        delivery.status === "FAILED" || delivery.status === "NEEDS_REVIEW",
    ),
  );
  return (
    <Card title="Kirim standup ke Kolab" className="kolab-sync-card">
      <p>
        Laporan final akun ini dikirim ke akun Kolab yang terhubung setelah
        pukul 12.00 WIB. Draf tidak ikut dikirim.
      </p>
      {loading && <p role="status">Memuat status akun Kolab…</p>}
      {!loading && sync?.connectedAt && (
        <p role="status">
          Akun Kolab terhubung sejak {dateTimeLabel(sync.connectedAt)} WIB.
        </p>
      )}
      {!loading && sync && !sync.enabled && (
        <p className="standup-warning" role="status">
          Pengiriman Kolab belum diaktifkan di server OpSmart.
        </p>
      )}
      {!loading && sync?.enabled && (
        <>
          {!sync.connectedAt && (
            <p role="status">Akun Kolab belum terhubung.</p>
          )}
          <FormField id="kolab-session-file" label="File sesi Kolab (JSON)">
            <input
              ref={fileInput}
              id="kolab-session-file"
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(event) =>
                void uploadSession(event.currentTarget.files?.[0])
              }
            />
          </FormField>
          <p className="standup-note">
            Buat file melalui <code>npm run kolab:connect</code>, unggah hanya
            ke akun OpSmart Anda, lalu hapus file lokalnya. Password Kolab tidak
            disimpan.
          </p>
        </>
      )}
      {(sync?.enabled && canRetry) || sync?.connectedAt ? (
        <div className="kolab-sync-actions">
          {sync?.enabled && canRetry && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("/kolab/retry")}
            >
              Coba kirim ulang laporan bermasalah
            </button>
          )}
          {sync?.connectedAt && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Putuskan sesi Kolab yang tersimpan di akun OpSmart ini?",
                  )
                )
                  void act("/kolab/disconnect");
              }}
            >
              Putuskan akun Kolab
            </button>
          )}
        </div>
      ) : null}
      {busy && <p role="status">Memproses aksi akun Kolab…</p>}
      {sync && sync.deliveries.length > 0 && (
        <ul className="kolab-deliveries" aria-label="Status pengiriman Kolab">
          {sync.deliveries.slice(0, 5).map((delivery) => (
            <li key={delivery.date}>
              <span>{dateLabel(delivery.date)}</span>
              <span>
                {delivery.status === "PENDING" &&
                delivery.lastErrorCode === "NETWORK"
                  ? "Menunggu percobaan ulang"
                  : kolabStatusLabels[delivery.status]}
              </span>
              {delivery.lastErrorCode && (
                <span className="kolab-delivery-error">
                  {kolabErrorLabels[delivery.lastErrorCode] ??
                    "Perlu diperiksa."}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <StatePanel
          kind="error"
          title="Status Kolab belum dapat diperbarui"
          onRetry={() => setAttempt((value) => value + 1)}
        >
          {error}
        </StatePanel>
      )}
    </Card>
  );
}
