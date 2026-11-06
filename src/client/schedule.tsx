import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { CycleSummary } from "../modules/farming/contracts.js";
import type { ActivitySummary } from "../modules/schedules/contracts.js";
import type { ActivityStatus, FarmingType } from "../shared/domain.js";
import {
  Card,
  ConfirmDialog,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";
import { ConsumeForm } from "./inventory/consume-form.js";

const kinds = {
  STOCKING: "Tebar bibit",
  PLANTING: "Penanaman",
  FEEDING: "Pemberian pakan",
  WATERING: "Penyiraman",
  FERTILIZING: "Pemupukan",
  MAINTENANCE: "Perawatan",
  INSPECTION: "Pemeriksaan",
  TREATMENT: "Penanganan",
  HARVESTING: "Panen",
} as const;
const typeKinds: Record<FarmingType, (keyof typeof kinds)[]> = {
  FISH: [
    "STOCKING",
    "FEEDING",
    "MAINTENANCE",
    "INSPECTION",
    "TREATMENT",
    "HARVESTING",
  ],
  CHICKEN: [
    "STOCKING",
    "FEEDING",
    "MAINTENANCE",
    "INSPECTION",
    "TREATMENT",
    "HARVESTING",
  ],
  CROP: [
    "PLANTING",
    "WATERING",
    "FERTILIZING",
    "MAINTENANCE",
    "INSPECTION",
    "TREATMENT",
    "HARVESTING",
  ],
};
const statuses: Record<ActivityStatus, string> = {
  SCHEDULED: "Terjadwal",
  IN_PROGRESS: "Berjalan",
  COMPLETED: "Selesai",
  MISSED: "Terlewat",
  CANCELLED: "Dibatalkan",
};
const typeLabels: Record<FarmingType, string> = {
  FISH: "Ikan",
  CHICKEN: "Ayam",
  CROP: "Tanaman",
};
const next: Record<
  ActivityStatus,
  { status: ActivityStatus; label: string }[]
> = {
  SCHEDULED: [
    { status: "IN_PROGRESS", label: "Mulai" },
    { status: "COMPLETED", label: "Selesaikan" },
    { status: "MISSED", label: "Tandai terlewat" },
    { status: "CANCELLED", label: "Batalkan" },
  ],
  IN_PROGRESS: [
    { status: "COMPLETED", label: "Selesaikan" },
    { status: "CANCELLED", label: "Batalkan" },
  ],
  MISSED: [
    { status: "IN_PROGRESS", label: "Mulai terlambat" },
    { status: "CANCELLED", label: "Batalkan" },
  ],
  COMPLETED: [],
  CANCELLED: [],
};
function localDateTime(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
function monthBounds(date = new Date()) {
  return {
    from: localDateTime(new Date(date.getFullYear(), date.getMonth(), 1)).slice(
      0,
      10,
    ),
    to: localDateTime(
      new Date(date.getFullYear(), date.getMonth() + 1, 1),
    ).slice(0, 10),
  };
}
function displayTime(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
type Action = { activity: ActivitySummary; status: ActivityStatus };
export function SchedulePage({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const [searchParams] = useSearchParams();
  const preferredCycleId = searchParams.get("cycleId");
  const [range, setRange] = useState(monthBounds);
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [filterCycleId, setFilterCycleId] = useState("");
  const [kind, setKind] = useState<keyof typeof kinds>("FEEDING");
  const [scheduledAt, setScheduledAt] = useState(() =>
    localDateTime(new Date(Date.now() + 3_600_000)),
  );
  const [notes, setNotes] = useState("");
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<Action | null>(null);
  const actionKeys = useRef(new Map<string, string>());
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const activeCycles = cycles.filter((cycle) => cycle.status === "ACTIVE");
  const selectedCycle = activeCycles.find((cycle) => cycle.id === cycleId);
  const shown = activities.filter(
    (activity) => !filterCycleId || activity.cycleId === filterCycleId,
  );
  const selected = shown.find((activity) => activity.id === selectedId);

  useEffect(() => {
    if (preferredCycleId) setFilterCycleId(preferredCycleId);
  }, [preferredCycleId]);

  useEffect(() => {
    if (!farmId || state.loading) {
      setCycles([]);
      setActivities([]);
      setLoading(false);
      return;
    }
    let current = true;
    const from = new Date(`${range.from}T00:00:00`);
    const to = new Date(`${range.to}T00:00:00`);
    if (!range.from || !range.to || !(from < to)) {
      setLoadError("Tanggal akhir harus setelah tanggal awal.");
      setActivities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    Promise.all([
      request<CycleSummary[]>(`/api/farms/${farmId}/cycles`),
      request<ActivitySummary[]>(
        `/api/farms/${farmId}/activities?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      ),
    ])
      .then(([loadedCycles, loadedActivities]) => {
        if (!current) return;
        setCycles(loadedCycles);
        setActivities(loadedActivities);
        const usable = loadedCycles.filter(
          (cycle) => cycle.status === "ACTIVE",
        );
        setCycleId((previous) =>
          usable.some((cycle) => cycle.id === preferredCycleId)
            ? preferredCycleId!
            : usable.some((cycle) => cycle.id === previous)
              ? previous
              : (usable[0]?.id ?? ""),
        );
        setFilterCycleId((previous) =>
          loadedCycles.some((cycle) => cycle.id === previous) ? previous : "",
        );
      })
      .catch((error) => {
        if (current)
          setLoadError(
            error instanceof Error ? error.message : "Gagal memuat jadwal.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, preferredCycleId, range.from, range.to, revision]);

  useEffect(() => {
    if (selectedCycle && !typeKinds[selectedCycle.type].includes(kind)) {
      setKind(typeKinds[selectedCycle.type][0] ?? "INSPECTION");
      setCreateKey(crypto.randomUUID());
    }
  }, [selectedCycle, kind]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || !selectedCycle || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      const result = await request<{ activityId: string }>(
        `/api/farms/${farmId}/activities`,
        "POST",
        {
          idempotencyKey: createKey,
          cycleId,
          kind,
          scheduledAt: new Date(scheduledAt).toISOString(),
          notes: notes || undefined,
        },
      );
      setCreateKey(crypto.randomUUID());
      setNotes("");
      setSelectedId(result.activityId);
      setFilterCycleId(cycleId);
      const scheduledDate = new Date(scheduledAt);
      const bounds = monthBounds(scheduledDate);
      if (
        scheduledDate < new Date(`${range.from}T00:00:00`) ||
        scheduledDate >= new Date(`${range.to}T00:00:00`)
      )
        setRange(bounds);
      else setRevision((value) => value + 1);
      setMessage("Aktivitas berhasil dijadwalkan.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Gagal membuat aktivitas.",
      );
    } finally {
      setPending(false);
    }
  }
  async function transition(action: Action) {
    if (!farmId || pending) return;
    const key = `${action.activity.id}:${action.activity.status}:${action.status}`;
    const idempotencyKey = actionKeys.current.get(key) ?? crypto.randomUUID();
    actionKeys.current.set(key, idempotencyKey);
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      const updated = await request<ActivitySummary>(
        `/api/farms/${farmId}/activities/transition`,
        "POST",
        {
          idempotencyKey,
          activityId: action.activity.id,
          expectedStatus: action.activity.status,
          status: action.status,
        },
      );
      actionKeys.current.delete(key);
      setActivities((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setConfirmAction(null);
      setMessage(
        `Status aktivitas menjadi ${statuses[updated.status].toLowerCase()}.`,
      );
    } catch (error) {
      setConfirmAction(null);
      setActionError(
        error instanceof Error ? error.message : "Gagal mengubah status.",
      );
      setRevision((value) => value + 1);
    } finally {
      setPending(false);
    }
  }
  function chooseAction(activity: ActivitySummary, status: ActivityStatus) {
    const action = { activity, status };
    if (status === "CANCELLED" || status === "COMPLETED")
      setConfirmAction(action);
    else void transition(action);
  }
  return (
    <>
      <PageHeader
        eyebrow="Operasional"
        title="Jadwal aktivitas"
        description="Rencanakan kegiatan satu kali untuk siklus aktif, lalu catat progresnya secara jelas."
        visual="operations"
      />
      <div className="registry-summary" aria-label="Ringkasan jadwal">
        <span>
          <strong>{shown.length}</strong> aktivitas dalam rentang
        </span>
        <span>
          <strong>
            {shown.filter((item) => item.status === "SCHEDULED").length}
          </strong>{" "}
          terjadwal
        </span>
        <span>
          <strong>
            {shown.filter((item) => item.status === "IN_PROGRESS").length}
          </strong>{" "}
          berjalan
        </span>
        <span>
          <strong>
            {shown.filter((item) => item.status === "MISSED").length}
          </strong>{" "}
          terlewat
        </span>
      </div>
      {message && (
        <StatePanel kind="success" title="Tersimpan">
          {message}
        </StatePanel>
      )}
      {actionError && (
        <StatePanel kind="error" title="Perubahan belum tersimpan">
          {actionError}
        </StatePanel>
      )}
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih atau buat farm untuk mengatur jadwal.
        </StatePanel>
      )}
      {farmId && (
        <div className="schedule-grid">
          <div className="schedule-main">
            <Card title="Rentang jadwal" className="schedule-filter-card">
              <div className="schedule-filter-fields">
                <FormField id="schedule-from" label="Dari tanggal">
                  <input
                    id="schedule-from"
                    type="date"
                    value={range.from}
                    onChange={(event) =>
                      setRange((value) => ({
                        ...value,
                        from: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField id="schedule-to" label="Sebelum tanggal">
                  <input
                    id="schedule-to"
                    type="date"
                    value={range.to}
                    onChange={(event) =>
                      setRange((value) => ({
                        ...value,
                        to: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField id="schedule-cycle-filter" label="Siklus">
                  <select
                    id="schedule-cycle-filter"
                    value={filterCycleId}
                    onChange={(event) => {
                      setFilterCycleId(event.target.value);
                      setSelectedId(null);
                    }}
                  >
                    <option value="">Semua siklus</option>
                    {cycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
              <p className="schedule-filter-note">
                Tanggal akhir tidak termasuk dalam hasil. Waktu mengikuti zona
                lokal perangkat Anda.
              </p>
            </Card>
            {loading && (
              <StatePanel kind="loading" title="Memuat jadwal">
                Sedang mengambil aktivitas farm.
              </StatePanel>
            )}
            {loadError && (
              <StatePanel
                kind="error"
                title="Jadwal belum dapat dimuat"
                onRetry={() => setRevision((value) => value + 1)}
              >
                {loadError}
              </StatePanel>
            )}
            {!loading && !loadError && (
              <Card title="Aktivitas" className="schedule-list-card">
                <DataTable
                  caption="Aktivitas dalam rentang tanggal terpilih"
                  rows={shown}
                  rowKey={(row) => row.id}
                  emptyMessage="Belum ada aktivitas dalam rentang ini. Buat jadwal di formulir sebelah."
                  columns={[
                    {
                      key: "time",
                      label: "Waktu",
                      render: (row) => (
                        <strong>{displayTime(row.scheduledAt)}</strong>
                      ),
                    },
                    {
                      key: "kind",
                      label: "Kegiatan",
                      render: (row) => (
                        <span>
                          {kinds[row.kind]}
                          <small className="schedule-cell-meta">
                            {typeLabels[row.type]} · {row.cycleName}
                          </small>
                        </span>
                      ),
                    },
                    {
                      key: "status",
                      label: "Status",
                      render: (row) => (
                        <span
                          className={`cycle-badge activity-${row.status.toLowerCase()}`}
                        >
                          {statuses[row.status]}
                        </span>
                      ),
                    },
                    {
                      key: "action",
                      label: "",
                      render: (row) => (
                        <button
                          type="button"
                          className="text-button schedule-detail-button"
                          onClick={() => setSelectedId(row.id)}
                        >
                          Detail
                        </button>
                      ),
                    },
                  ]}
                />
              </Card>
            )}
            {selected && (
              <Card title="Detail aktivitas" className="schedule-detail-card">
                <div className="schedule-detail-head">
                  <div>
                    <p className="section-kicker">
                      {typeLabels[selected.type]} · {selected.cycleName}
                    </p>
                    <h3>{kinds[selected.kind]}</h3>
                  </div>
                  <span
                    className={`cycle-badge activity-${selected.status.toLowerCase()}`}
                  >
                    {statuses[selected.status]}
                  </span>
                </div>
                <dl className="cycle-detail-list">
                  <div>
                    <dt>Jadwal</dt>
                    <dd>{displayTime(selected.scheduledAt)}</dd>
                  </div>
                  {selected.completedAt && (
                    <div>
                      <dt>Selesai</dt>
                      <dd>{displayTime(selected.completedAt)}</dd>
                    </div>
                  )}
                  {selected.cancelledAt && (
                    <div>
                      <dt>Dibatalkan</dt>
                      <dd>{displayTime(selected.cancelledAt)}</dd>
                    </div>
                  )}
                </dl>
                {selected.notes && (
                  <p className="schedule-notes">{selected.notes}</p>
                )}
                <div className="actions cycle-status-actions">
                  {next[selected.status].map((action) => (
                    <button
                      key={action.status}
                      type="button"
                      disabled={pending}
                      className={
                        action.status === "CANCELLED"
                          ? "button-danger-text"
                          : ""
                      }
                      onClick={() => chooseAction(selected, action.status)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                {next[selected.status].length === 0 && (
                  <p className="schedule-filter-note">
                    Status akhir. Aktivitas ini tidak dapat diubah lagi.
                  </p>
                )}
                <Link
                  className="schedule-cycle-link"
                  to={`/cycles/${selected.cycleId}`}
                >
                  Lihat siklus terkait →
                </Link>
              </Card>
            )}
            {selected && farmId && (
              <ConsumeForm
                key={selected.id}
                farmId={farmId}
                activity={selected}
                cycleActive={cycles.some(
                  (cycle) =>
                    cycle.id === selected.cycleId && cycle.status === "ACTIVE",
                )}
              />
            )}
          </div>
          <Card title="Buat jadwal" className="form-card schedule-create-card">
            <p>
              Setiap jadwal adalah satu kegiatan pada satu waktu. Siklus harus
              aktif.
            </p>
            {activeCycles.length === 0 ? (
              <StatePanel kind="empty" title="Belum ada siklus aktif">
                Aktifkan siklus terlebih dahulu di halaman{" "}
                <Link to="/cycles">Siklus</Link>.
              </StatePanel>
            ) : (
              <form onSubmit={(event) => void create(event)}>
                <FormField id="schedule-cycle" label="Siklus aktif">
                  <select
                    id="schedule-cycle"
                    required
                    value={cycleId}
                    onChange={(event) => {
                      setCycleId(event.target.value);
                      setCreateKey(crypto.randomUUID());
                    }}
                  >
                    {activeCycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.name} · {typeLabels[cycle.type]}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField id="schedule-kind" label="Kegiatan">
                  <select
                    id="schedule-kind"
                    required
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value as keyof typeof kinds);
                      setCreateKey(crypto.randomUUID());
                    }}
                  >
                    {(selectedCycle ? typeKinds[selectedCycle.type] : []).map(
                      (value) => (
                        <option key={value} value={value}>
                          {kinds[value]}
                        </option>
                      ),
                    )}
                  </select>
                </FormField>
                <FormField id="schedule-time" label="Waktu kegiatan">
                  <input
                    id="schedule-time"
                    type="datetime-local"
                    required
                    value={scheduledAt}
                    onChange={(event) => {
                      setScheduledAt(event.target.value);
                      setCreateKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                <FormField id="schedule-notes" label="Catatan (opsional)">
                  <textarea
                    id="schedule-notes"
                    rows={4}
                    maxLength={2000}
                    value={notes}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      setCreateKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                <button type="submit" disabled={pending || !selectedCycle}>
                  Simpan jadwal
                </button>
              </form>
            )}
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction?.status === "COMPLETED"
            ? "Selesaikan aktivitas?"
            : "Batalkan aktivitas?"
        }
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction) void transition(confirmAction);
        }}
      >
        Status akhir menyimpan waktu perubahan dan tidak dapat dibuka kembali.
      </ConfirmDialog>
    </>
  );
}
