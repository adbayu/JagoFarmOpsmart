import { useEffect, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  CommoditySummary,
  CycleDetail,
  CycleSummary,
  FarmingType,
  ObservationSummary,
  UnitSummary,
} from "../../modules/farming/contracts.js";
import type { CycleStatus } from "../../shared/domain.js";
import {
  Card,
  ConfirmDialog,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "../components/primitives.js";
import { request, useFarms } from "../farms.js";
import { Icon } from "../icons.js";
import { formatDecimal } from "../units.js";

const types: Record<FarmingType, string> = {
  FISH: "Ikan",
  CHICKEN: "Ayam",
  CROP: "Tanaman",
};
const statusLabels: Record<CycleStatus, string> = {
  PLANNED: "Terencana",
  ACTIVE: "Aktif",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};
const unitRoutes: Record<FarmingType, string> = {
  FISH: "fish",
  CHICKEN: "chicken",
  CROP: "crops",
};
function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
function displayDate(value: string | null) {
  return value || "Belum ditentukan";
}
function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
type CycleDraft = {
  name: string;
  startDate: string;
  targetHarvestDate: string;
  initialPopulation: string;
  seedSource: string;
  initialWeightG: string;
  strain: string;
  initialAgeDays: string;
  seedCount: string;
  variety: string;
  seedlingDate: string;
};
function blankCycle(): CycleDraft {
  return {
    name: "",
    startDate: localDateTime().slice(0, 10),
    targetHarvestDate: "",
    initialPopulation: "",
    seedSource: "",
    initialWeightG: "",
    strain: "",
    initialAgeDays: "",
    seedCount: "",
    variety: "",
    seedlingDate: "",
  };
}

export function CycleWorkspace({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const [searchParams] = useSearchParams();
  const preferredUnitId = searchParams.get("unitId");
  const navigate = useNavigate();
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [commodities, setCommodities] = useState<CommoditySummary[]>([]);
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [unitId, setUnitId] = useState("");
  const [commodityId, setCommodityId] = useState("");
  const [commodityName, setCommodityName] = useState("");
  const [draft, setDraft] = useState<CycleDraft>(blankCycle);
  const [commodityKey, setCommodityKey] = useState(() => crypto.randomUUID());
  const [cycleKey, setCycleKey] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const selectedUnit = units.find((unit) => unit.id === unitId);
  const availableCommodities = commodities.filter(
    (commodity) => commodity.type === selectedUnit?.type,
  );

  useEffect(() => {
    if (!farmId) {
      setUnits([]);
      setCycles([]);
      setCommodities([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      request<UnitSummary[]>(`/api/farms/${farmId}/units`),
      request<CommoditySummary[]>(`/api/farms/${farmId}/commodities`),
      request<CycleSummary[]>(`/api/farms/${farmId}/cycles`),
    ])
      .then(([loadedUnits, loadedCommodities, loadedCycles]) => {
        if (!current) return;
        setUnits(loadedUnits);
        setCommodities(loadedCommodities);
        setCycles(loadedCycles);
        setUnitId((previous) =>
          loadedUnits.some((unit) => unit.id === preferredUnitId)
            ? preferredUnitId!
            : loadedUnits.some((unit) => unit.id === previous)
              ? previous
              : (loadedUnits[0]?.id ?? ""),
        );
      })
      .catch((error) => {
        if (current)
          setLoadError(
            error instanceof Error ? error.message : "Gagal memuat siklus.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, preferredUnitId, revision]);

  function editDraft(key: keyof CycleDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setCycleKey(crypto.randomUUID());
  }
  async function addCommodity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || !selectedUnit || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      const created = await request<CommoditySummary>(
        `/api/farms/${farmId}/commodities`,
        "POST",
        {
          idempotencyKey: commodityKey,
          type: selectedUnit.type,
          name: commodityName,
        },
      );
      setCommodities((current) => [...current, created]);
      setCommodityId(created.id);
      setCommodityName("");
      setCommodityKey(crypto.randomUUID());
      setMessage(
        `Komoditas ${created.name} tersedia untuk ${types[created.type].toLowerCase()}.`,
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Gagal menambah komoditas.",
      );
    } finally {
      setPending(false);
    }
  }
  async function addCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || !selectedUnit || !commodityId || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    const common = {
      idempotencyKey: cycleKey,
      type: selectedUnit.type,
      unitId: selectedUnit.id,
      commodityId,
      name: draft.name,
      startDate: draft.startDate,
      targetHarvestDate: draft.targetHarvestDate || undefined,
    };
    const details =
      selectedUnit.type === "FISH"
        ? {
            initialPopulation: Number(draft.initialPopulation),
            seedSource: draft.seedSource || undefined,
            initialWeightG: draft.initialWeightG || undefined,
          }
        : selectedUnit.type === "CHICKEN"
          ? {
              initialPopulation: Number(draft.initialPopulation),
              strain: draft.strain || undefined,
              initialAgeDays:
                draft.initialAgeDays === ""
                  ? undefined
                  : Number(draft.initialAgeDays),
              seedSource: draft.seedSource || undefined,
            }
          : {
              seedCount: Number(draft.seedCount),
              variety: draft.variety || undefined,
              seedlingDate: draft.seedlingDate || undefined,
            };
    try {
      const created = await request<{ cycleId: string }>(
        `/api/farms/${farmId}/cycles`,
        "POST",
        { ...common, ...details },
      );
      setCycleKey(crypto.randomUUID());
      navigate(`/cycles/${created.cycleId}`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Gagal membuat siklus.",
      );
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Farm / Operasional"
        title="Siklus budidaya"
        description="Rencanakan siklus untuk unit ikan, ayam, dan tanaman. Catatan monitoring disimpan pada siklus aktif."
        visual="operations"
      />
      {state.loading && (
        <StatePanel kind="loading" title="Memuat farm">
          Mohon tunggu.
        </StatePanel>
      )}
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm di <Link to="/farms">Kelola Farm</Link> terlebih dahulu.
        </StatePanel>
      )}
      {farmId && loading && (
        <StatePanel kind="loading" title="Memuat siklus">
          Sedang mengambil unit, komoditas, dan siklus.
        </StatePanel>
      )}
      {farmId && loadError && (
        <StatePanel
          kind="error"
          title="Siklus belum dapat dimuat"
          onRetry={() => setRevision((value) => value + 1)}
        >
          {loadError}
        </StatePanel>
      )}
      {actionError && (
        <StatePanel kind="error" title="Perubahan belum tersimpan">
          {actionError}
        </StatePanel>
      )}
      {message && (
        <StatePanel kind="success" title="Tersimpan">
          {message}
        </StatePanel>
      )}
      {farmId && !loading && !loadError && (
        <>
          <Card title="Daftar siklus" className="cycle-list-card">
            <p className="list-meta">
              {cycles.length} siklus tercatat pada farm aktif
            </p>
            <DataTable
              caption="Daftar siklus farm"
              rows={cycles}
              rowKey={(cycle) => cycle.id}
              emptyMessage="Belum ada siklus. Pilih unit dan isi formulir untuk membuat siklus pertama."
              columns={[
                {
                  key: "name",
                  label: "Siklus",
                  render: (cycle) => (
                    <>
                      <span className="table-primary">{cycle.name}</span>
                      <small className="table-secondary">
                        {cycle.commodityName}
                      </small>
                    </>
                  ),
                },
                {
                  key: "unit",
                  label: "Unit",
                  render: (cycle) => `${cycle.unitName} · ${types[cycle.type]}`,
                },
                {
                  key: "status",
                  label: "Status",
                  render: (cycle) => (
                    <span
                      className={`cycle-badge cycle-${cycle.status.toLowerCase()}`}
                    >
                      {statusLabels[cycle.status]}
                    </span>
                  ),
                },
                {
                  key: "start",
                  label: "Mulai",
                  render: (cycle) => cycle.startDate,
                },
                {
                  key: "action",
                  label: "Aksi",
                  render: (cycle) => (
                    <Link
                      className="table-detail-link"
                      to={`/cycles/${cycle.id}`}
                    >
                      Detail
                    </Link>
                  ),
                },
              ]}
            />
          </Card>
          {units.length === 0 ? (
            <StatePanel kind="empty" title="Belum ada unit aktif">
              Buat kolam, kandang, atau area tanam terlebih dahulu dari menu
              Farm.
            </StatePanel>
          ) : (
            <div className="cycle-workspace-grid">
              <Card title="Buat siklus" className="form-card">
                <p>Semua siklus baru dimulai dengan status terencana.</p>
                <form onSubmit={(event) => void addCycle(event)}>
                  <FormField id="cycle-unit" label="Unit farm">
                    <select
                      id="cycle-unit"
                      required
                      value={unitId}
                      onChange={(event) => {
                        setUnitId(event.target.value);
                        setCommodityId("");
                        setDraft(blankCycle());
                        setCycleKey(crypto.randomUUID());
                      }}
                    >
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name} · {types[unit.type]}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField id="cycle-commodity" label="Komoditas">
                    <select
                      id="cycle-commodity"
                      required
                      value={commodityId}
                      onChange={(event) => {
                        setCommodityId(event.target.value);
                        setCycleKey(crypto.randomUUID());
                      }}
                    >
                      <option value="">Pilih komoditas</option>
                      {availableCommodities.map((commodity) => (
                        <option key={commodity.id} value={commodity.id}>
                          {commodity.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  {availableCommodities.length === 0 && (
                    <p className="list-meta">
                      Tambahkan komoditas untuk jenis unit ini di formulir
                      samping.
                    </p>
                  )}
                  <FormField id="cycle-name" label="Nama siklus">
                    <input
                      id="cycle-name"
                      required
                      maxLength={120}
                      value={draft.name}
                      onChange={(event) =>
                        editDraft("name", event.target.value)
                      }
                    />
                  </FormField>
                  <div className="cycle-form-grid">
                    <FormField id="cycle-start" label="Tanggal mulai">
                      <input
                        id="cycle-start"
                        type="date"
                        required
                        value={draft.startDate}
                        onChange={(event) =>
                          editDraft("startDate", event.target.value)
                        }
                      />
                    </FormField>
                    <FormField
                      id="cycle-harvest-target"
                      label="Target panen (opsional)"
                    >
                      <input
                        id="cycle-harvest-target"
                        type="date"
                        min={draft.startDate}
                        value={draft.targetHarvestDate}
                        onChange={(event) =>
                          editDraft("targetHarvestDate", event.target.value)
                        }
                      />
                    </FormField>
                  </div>
                  {(selectedUnit?.type === "FISH" ||
                    selectedUnit?.type === "CHICKEN") && (
                    <FormField
                      id="cycle-population"
                      label={`Populasi awal ${types[selectedUnit.type].toLowerCase()} (ekor)`}
                    >
                      <input
                        id="cycle-population"
                        type="number"
                        min="1"
                        max="2147483647"
                        step="1"
                        required
                        value={draft.initialPopulation}
                        onChange={(event) =>
                          editDraft("initialPopulation", event.target.value)
                        }
                      />
                    </FormField>
                  )}
                  {selectedUnit?.type === "FISH" && (
                    <>
                      <FormField
                        id="cycle-seed-source"
                        label="Sumber benih (opsional)"
                      >
                        <input
                          id="cycle-seed-source"
                          maxLength={200}
                          value={draft.seedSource}
                          onChange={(event) =>
                            editDraft("seedSource", event.target.value)
                          }
                        />
                      </FormField>
                      <FormField
                        id="cycle-initial-weight"
                        label="Bobot awal rata-rata (g, opsional)"
                      >
                        <input
                          id="cycle-initial-weight"
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={draft.initialWeightG}
                          onChange={(event) =>
                            editDraft("initialWeightG", event.target.value)
                          }
                        />
                      </FormField>
                    </>
                  )}
                  {selectedUnit?.type === "CHICKEN" && (
                    <>
                      <FormField id="cycle-strain" label="Strain (opsional)">
                        <input
                          id="cycle-strain"
                          maxLength={200}
                          value={draft.strain}
                          onChange={(event) =>
                            editDraft("strain", event.target.value)
                          }
                        />
                      </FormField>
                      <FormField
                        id="cycle-initial-age"
                        label="Usia awal (hari, opsional)"
                      >
                        <input
                          id="cycle-initial-age"
                          type="number"
                          min="0"
                          max="2147483647"
                          step="1"
                          value={draft.initialAgeDays}
                          onChange={(event) =>
                            editDraft("initialAgeDays", event.target.value)
                          }
                        />
                      </FormField>
                      <FormField
                        id="cycle-chicken-source"
                        label="Sumber bibit (opsional)"
                      >
                        <input
                          id="cycle-chicken-source"
                          maxLength={200}
                          value={draft.seedSource}
                          onChange={(event) =>
                            editDraft("seedSource", event.target.value)
                          }
                        />
                      </FormField>
                    </>
                  )}
                  {selectedUnit?.type === "CROP" && (
                    <>
                      <FormField
                        id="cycle-seed-count"
                        label="Jumlah bibit awal (tanaman)"
                      >
                        <input
                          id="cycle-seed-count"
                          type="number"
                          min="1"
                          max="2147483647"
                          step="1"
                          required
                          value={draft.seedCount}
                          onChange={(event) =>
                            editDraft("seedCount", event.target.value)
                          }
                        />
                      </FormField>
                      <FormField id="cycle-variety" label="Varietas (opsional)">
                        <input
                          id="cycle-variety"
                          maxLength={200}
                          value={draft.variety}
                          onChange={(event) =>
                            editDraft("variety", event.target.value)
                          }
                        />
                      </FormField>
                      <FormField
                        id="cycle-seedling-date"
                        label="Tanggal pembibitan (opsional)"
                      >
                        <input
                          id="cycle-seedling-date"
                          type="date"
                          value={draft.seedlingDate}
                          onChange={(event) =>
                            editDraft("seedlingDate", event.target.value)
                          }
                        />
                      </FormField>
                    </>
                  )}
                  <button type="submit" disabled={pending || !commodityId}>
                    Buat siklus terencana
                  </button>
                </form>
              </Card>
              <Card
                title="Komoditas"
                className="form-card cycle-commodity-card"
              >
                <p>
                  Komoditas mengikuti jenis unit yang dipilih. Nama yang sama
                  tidak dapat didaftarkan dua kali pada jenis yang sama.
                </p>
                <ul className="cycle-commodity-list">
                  {availableCommodities.length === 0 ? (
                    <li>
                      Belum ada komoditas{" "}
                      {selectedUnit
                        ? types[selectedUnit.type].toLowerCase()
                        : ""}
                      .
                    </li>
                  ) : (
                    availableCommodities.map((commodity) => (
                      <li key={commodity.id}>{commodity.name}</li>
                    ))
                  )}
                </ul>
                <form onSubmit={(event) => void addCommodity(event)}>
                  <FormField
                    id="new-commodity"
                    label={`Nama komoditas ${selectedUnit ? types[selectedUnit.type].toLowerCase() : ""}`}
                  >
                    <input
                      id="new-commodity"
                      required
                      maxLength={120}
                      value={commodityName}
                      onChange={(event) => {
                        setCommodityName(event.target.value);
                        setCommodityKey(crypto.randomUUID());
                      }}
                    />
                  </FormField>
                  <button type="submit" disabled={pending || !selectedUnit}>
                    Tambah komoditas
                  </button>
                </form>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}

type ObservationDraft = {
  observedAt: string;
  populationLoss: string;
  averageWeightG: string;
  conditionNotes: string;
};
function blankObservation(): ObservationDraft {
  return {
    observedAt: localDateTime(),
    populationLoss: "",
    averageWeightG: "",
    conditionNotes: "",
  };
}

export function CycleDetailPage({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const { cycleId } = useParams();
  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [observations, setObservations] = useState<ObservationSummary[]>([]);
  const [draft, setDraft] = useState<ObservationDraft>(blankObservation);
  const [observationKey, setObservationKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [transitionAttempt, setTransitionAttempt] = useState<{
    status: CycleStatus;
    key: string;
  } | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<CycleStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!farmId || !cycleId) {
      setCycle(null);
      setObservations([]);
      setLoading(false);
      return;
    }
    let current = true;
    setCycle(null);
    setObservations([]);
    setLoading(true);
    setLoadError(null);
    setActionError(null);
    setMessage(null);
    Promise.all([
      request<CycleDetail>(`/api/farms/${farmId}/cycles/${cycleId}`),
      request<ObservationSummary[]>(
        `/api/farms/${farmId}/cycles/${cycleId}/observations`,
      ),
    ])
      .then(([loadedCycle, loadedObservations]) => {
        if (!current) return;
        setCycle(loadedCycle);
        setObservations(loadedObservations);
      })
      .catch((error) => {
        if (current)
          setLoadError(
            error instanceof Error ? error.message : "Gagal memuat siklus.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, cycleId, revision]);

  async function transition(status: CycleStatus) {
    if (!farmId || !cycle || pending) return;
    const key =
      transitionAttempt?.status === status
        ? transitionAttempt.key
        : crypto.randomUUID();
    setTransitionAttempt({ status, key });
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      const updated = await request<CycleDetail>(
        `/api/farms/${farmId}/cycles/${cycle.id}/transition`,
        "POST",
        { idempotencyKey: key, expectedStatus: cycle.status, status },
      );
      setCycle(updated);
      setTransitionAttempt(null);
      setConfirmStatus(null);
      setMessage(`Siklus sekarang ${statusLabels[status].toLowerCase()}.`);
    } catch (error) {
      setConfirmStatus(null);
      setActionError(
        error instanceof Error
          ? error.message
          : "Gagal mengubah status siklus.",
      );
    } finally {
      setPending(false);
    }
  }
  async function addObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || !cycle || pending) return;
    if (
      !draft.populationLoss &&
      !draft.averageWeightG &&
      !draft.conditionNotes.trim()
    ) {
      setActionError("Isi setidaknya satu hasil pengamatan.");
      return;
    }
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      await request<{ observationId: string }>(
        `/api/farms/${farmId}/cycles/${cycle.id}/observations`,
        "POST",
        {
          idempotencyKey: observationKey,
          observedAt: new Date(draft.observedAt).toISOString(),
          populationLoss: draft.populationLoss
            ? Number(draft.populationLoss)
            : undefined,
          averageWeightG: draft.averageWeightG || undefined,
          conditionNotes: draft.conditionNotes.trim() || undefined,
        },
      );
      setObservations(
        await request<ObservationSummary[]>(
          `/api/farms/${farmId}/cycles/${cycle.id}/observations`,
        ),
      );
      setDraft(blankObservation());
      setObservationKey(crypto.randomUUID());
      setMessage("Observasi tersimpan pada siklus ini.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Gagal menyimpan observasi.",
      );
    } finally {
      setPending(false);
    }
  }
  const visual =
    cycle?.type === "FISH"
      ? "fish"
      : cycle?.type === "CHICKEN"
        ? "chicken"
        : cycle?.type === "CROP"
          ? "crop"
          : "farm";
  return (
    <>
      <PageHeader
        eyebrow="Farm / Siklus"
        title={cycle?.name ?? "Detail siklus"}
        description="Pantau status, data awal, dan observasi siklus budidaya."
        visual={visual}
      />
      <Link className="back-link" to="/cycles">
        ← Kembali ke daftar siklus
      </Link>
      {state.loading && (
        <StatePanel kind="loading" title="Memuat farm">
          Mohon tunggu.
        </StatePanel>
      )}
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm di <Link to="/farms">Kelola Farm</Link> terlebih dahulu.
        </StatePanel>
      )}
      {farmId && loading && (
        <StatePanel kind="loading" title="Memuat siklus">
          Sedang mengambil detail dan observasi.
        </StatePanel>
      )}
      {farmId && loadError && (
        <StatePanel
          kind="error"
          title="Siklus belum dapat dimuat"
          onRetry={() => setRevision((value) => value + 1)}
        >
          {loadError}
        </StatePanel>
      )}
      {actionError && (
        <StatePanel kind="error" title="Perubahan belum tersimpan">
          {actionError}
        </StatePanel>
      )}
      {message && (
        <StatePanel kind="success" title="Tersimpan">
          {message}
        </StatePanel>
      )}
      {cycle && !loading && (
        <>
          <section className="unit-facts" aria-label="Ringkasan siklus">
            <article>
              <Icon name="cycle" size={21} />
              <span>Status</span>
              <strong>{statusLabels[cycle.status]}</strong>
            </article>
            <article>
              <Icon name="farm" size={21} />
              <span>Unit</span>
              <strong>
                <Link to={`/farm/${unitRoutes[cycle.type]}/${cycle.unitId}`}>
                  {cycle.unitName}
                </Link>
              </strong>
            </article>
            <article>
              <Icon name="crop" size={21} />
              <span>Komoditas</span>
              <strong>{cycle.commodityName}</strong>
            </article>
            <article>
              <Icon name="calendar" size={21} />
              <span>Mulai / target panen</span>
              <strong>
                {cycle.startDate} / {displayDate(cycle.targetHarvestDate)}
              </strong>
            </article>
          </section>
          <p className="cycle-schedule-entry">
            <Link to={`/schedule?cycleId=${cycle.id}`}>
              Lihat jadwal aktivitas siklus →
            </Link>
          </p>
          <div className="cycle-detail-grid">
            <Card title="Data awal siklus" className="cycle-detail-card">
              <p>
                Catatan awal {types[cycle.type].toLowerCase()} tetap tersimpan
                saat siklus selesai.
              </p>
              <dl className="cycle-detail-list">
                {cycle.type === "FISH" && (
                  <>
                    <div>
                      <dt>Populasi awal</dt>
                      <dd>
                        {formatDecimal(String(cycle.initialPopulation))} ekor
                      </dd>
                    </div>
                    <div>
                      <dt>Sumber benih</dt>
                      <dd>{cycle.seedSource || "Belum diisi"}</dd>
                    </div>
                    <div>
                      <dt>Bobot awal rata-rata</dt>
                      <dd>
                        {cycle.initialWeightG
                          ? `${formatDecimal(cycle.initialWeightG)} g`
                          : "Belum diisi"}
                      </dd>
                    </div>
                  </>
                )}
                {cycle.type === "CHICKEN" && (
                  <>
                    <div>
                      <dt>Populasi awal</dt>
                      <dd>
                        {formatDecimal(String(cycle.initialPopulation))} ekor
                      </dd>
                    </div>
                    <div>
                      <dt>Strain</dt>
                      <dd>{cycle.strain || "Belum diisi"}</dd>
                    </div>
                    <div>
                      <dt>Usia awal</dt>
                      <dd>
                        {cycle.initialAgeDays === null
                          ? "Belum diisi"
                          : `${cycle.initialAgeDays} hari`}
                      </dd>
                    </div>
                    <div>
                      <dt>Sumber bibit</dt>
                      <dd>{cycle.seedSource || "Belum diisi"}</dd>
                    </div>
                  </>
                )}
                {cycle.type === "CROP" && (
                  <>
                    <div>
                      <dt>Jumlah bibit awal</dt>
                      <dd>{formatDecimal(String(cycle.seedCount))} tanaman</dd>
                    </div>
                    <div>
                      <dt>Varietas</dt>
                      <dd>{cycle.variety || "Belum diisi"}</dd>
                    </div>
                    <div>
                      <dt>Tanggal pembibitan</dt>
                      <dd>{displayDate(cycle.seedlingDate)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </Card>
            <Card title="Status siklus" className="cycle-detail-card">
              <p>
                Perubahan status menyimpan riwayat data. Siklus selesai atau
                dibatalkan tidak dapat dibuka kembali.
              </p>
              <span
                className={`cycle-badge cycle-${cycle.status.toLowerCase()}`}
              >
                {statusLabels[cycle.status]}
              </span>
              <div className="actions cycle-status-actions">
                {cycle.status === "PLANNED" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void transition("ACTIVE")}
                  >
                    Aktifkan siklus
                  </button>
                )}
                {cycle.status === "ACTIVE" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmStatus("COMPLETED")}
                  >
                    Selesaikan siklus
                  </button>
                )}
                {(cycle.status === "PLANNED" || cycle.status === "ACTIVE") && (
                  <button
                    type="button"
                    className="button-danger-text"
                    disabled={pending}
                    onClick={() => setConfirmStatus("CANCELLED")}
                  >
                    Batalkan siklus
                  </button>
                )}
              </div>
            </Card>
          </div>
          <div className="cycle-detail-grid">
            <Card title="Observasi" className="cycle-detail-card">
              <p>
                Angka kehilangan dan bobot dicatat secara eksplisit. Catatan
                kondisi tidak diubah menjadi metrik.
              </p>
              {observations.length === 0 ? (
                <p className="list-meta">
                  Belum ada observasi pada siklus ini.
                </p>
              ) : (
                <ul className="observation-list">
                  {observations.map((observation) => (
                    <li key={observation.id}>
                      <strong>{displayTime(observation.observedAt)}</strong>
                      {observation.populationLoss !== null && (
                        <span>
                          Kehilangan populasi:{" "}
                          {formatDecimal(String(observation.populationLoss))}
                        </span>
                      )}
                      {observation.averageWeightG !== null && (
                        <span>
                          Bobot rata-rata:{" "}
                          {formatDecimal(observation.averageWeightG)} g
                        </span>
                      )}
                      {observation.conditionNotes && (
                        <p>{observation.conditionNotes}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {cycle.status === "ACTIVE" && (
              <Card
                title="Catat observasi"
                className="form-card cycle-detail-card"
              >
                <p>Isi satu atau lebih hasil pengamatan untuk siklus aktif.</p>
                <form onSubmit={(event) => void addObservation(event)}>
                  <FormField id="observation-time" label="Waktu pengamatan">
                    <input
                      id="observation-time"
                      type="datetime-local"
                      required
                      value={draft.observedAt}
                      onChange={(event) => {
                        setDraft({ ...draft, observedAt: event.target.value });
                        setObservationKey(crypto.randomUUID());
                      }}
                    />
                  </FormField>
                  <FormField
                    id="observation-loss"
                    label={`Kehilangan populasi (${cycle.type === "CROP" ? "tanaman" : "ekor"}, opsional)`}
                  >
                    <input
                      id="observation-loss"
                      type="number"
                      min="1"
                      max="2147483647"
                      step="1"
                      value={draft.populationLoss}
                      onChange={(event) => {
                        setDraft({
                          ...draft,
                          populationLoss: event.target.value,
                        });
                        setObservationKey(crypto.randomUUID());
                      }}
                    />
                  </FormField>
                  <FormField
                    id="observation-weight"
                    label="Bobot rata-rata (g, opsional)"
                  >
                    <input
                      id="observation-weight"
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={draft.averageWeightG}
                      onChange={(event) => {
                        setDraft({
                          ...draft,
                          averageWeightG: event.target.value,
                        });
                        setObservationKey(crypto.randomUUID());
                      }}
                    />
                  </FormField>
                  <FormField
                    id="observation-notes"
                    label="Catatan kondisi (opsional)"
                  >
                    <textarea
                      id="observation-notes"
                      rows={3}
                      maxLength={2000}
                      value={draft.conditionNotes}
                      onChange={(event) => {
                        setDraft({
                          ...draft,
                          conditionNotes: event.target.value,
                        });
                        setObservationKey(crypto.randomUUID());
                      }}
                    />
                  </FormField>
                  <button type="submit" disabled={pending}>
                    Simpan observasi
                  </button>
                </form>
              </Card>
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirmStatus !== null}
        title={
          confirmStatus === "COMPLETED"
            ? "Selesaikan siklus?"
            : "Batalkan siklus?"
        }
        onClose={() => setConfirmStatus(null)}
        onConfirm={() => {
          if (confirmStatus) void transition(confirmStatus);
        }}
      >
        Data awal dan observasi tetap tersimpan. Status akhir tidak dapat dibuka
        kembali.
      </ConfirmDialog>
    </>
  );
}
