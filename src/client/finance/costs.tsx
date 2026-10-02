import { useEffect, useState, type FormEvent } from "react";
import type { CycleSummary } from "../../modules/farming/contracts.js";
import type {
  CostActivityOption,
  CostSummary,
} from "../../modules/finance/contracts.js";
import type { MovementSummary } from "../../modules/inventory/contracts.js";
import {
  Card,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "../components/primitives.js";
import { request, useFarms } from "../farms.js";

type Scope = "GENERAL" | "CYCLE" | "ACTIVITY" | "PURCHASE";
type Draft = {
  scope: Scope;
  treatment: CostSummary["treatment"];
  cycleId: string;
  activityId: string;
  movementId: string;
  sourceKey: string;
  category: string;
  amountMinor: string;
  costDate: string;
  notes: string;
  correctionReason: string;
};
function localDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
const blank = (): Draft => ({
  scope: "GENERAL",
  treatment: "UNCLASSIFIED",
  cycleId: "",
  activityId: "",
  movementId: "",
  sourceKey: "",
  category: "",
  amountMinor: "",
  costDate: localDate(),
  notes: "",
  correctionReason: "",
});
const money = (value: string) =>
  `Rp ${new Intl.NumberFormat("id-ID").format(BigInt(value))}`;
function sourceLabel(cost: CostSummary) {
  if (cost.movementType === "STOCK_IN") return "Pembelian persediaan";
  if (cost.movementType === "CONSUMPTION") return "Pemakaian terkait";
  if (cost.activityId) return "Biaya aktivitas";
  if (cost.cycleId) return "Biaya siklus";
  return "Biaya farm";
}
export function CostsPage({ state }: { state: ReturnType<typeof useFarms> }) {
  const farmId = state.activeId;
  const [costs, setCosts] = useState<CostSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [activities, setActivities] = useState<CostActivityOption[]>([]);
  const [movements, setMovements] = useState<MovementSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [correctionId, setCorrectionId] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelKey, setCancelKey] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!farmId || state.loading) {
      setCosts([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      request<{ costs: CostSummary[]; nextOffset: number | null }>(
        `/api/farms/${farmId}/costs?limit=50&offset=0`,
      ),
      request<CycleSummary[]>(`/api/farms/${farmId}/cycles`),
      request<CostActivityOption[]>(`/api/farms/${farmId}/cost-activities`),
      request<{ movements: MovementSummary[]; nextOffset: number | null }>(
        `/api/farms/${farmId}/movements?limit=100&offset=0`,
      ),
    ])
      .then(([costData, cycleData, activityData, movementData]) => {
        if (!current) return;
        setCosts(costData.costs);
        setNextOffset(costData.nextOffset);
        setCycles(cycleData);
        setActivities(activityData);
        setMovements(movementData.movements);
      })
      .catch((cause) => {
        if (current)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Biaya belum dapat dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, revision]);
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setKey(crypto.randomUUID());
    setError(null);
  }
  function changeScope(scope: Scope) {
    setDraft((current) => ({
      ...current,
      scope,
      treatment:
        scope === "PURCHASE"
          ? "INVENTORY_PURCHASE"
          : current.scope === "PURCHASE"
            ? "UNCLASSIFIED"
            : current.treatment,
      cycleId: "",
      activityId: "",
      movementId: "",
    }));
    setKey(crypto.randomUUID());
    setError(null);
  }
  function resetForm() {
    setDraft(blank());
    setCorrectionId(null);
    setKey(crypto.randomUUID());
  }
  function startCorrection(cost: CostSummary) {
    const scope: Scope =
      cost.movementType === "STOCK_IN"
        ? "PURCHASE"
        : cost.activityId
          ? "ACTIVITY"
          : cost.cycleId
            ? "CYCLE"
            : "GENERAL";
    setDraft({
      scope,
      treatment: cost.treatment,
      cycleId: cost.cycleId ?? "",
      activityId: cost.activityId ?? "",
      movementId: cost.inventoryMovementId ?? "",
      sourceKey: `${cost.sourceKey}-revisi`.slice(0, 200),
      category: cost.category,
      amountMinor: cost.amountMinor,
      costDate: cost.costDate,
      notes: cost.notes ?? "",
      correctionReason: "",
    });
    setCorrectionId(cost.id);
    setKey(crypto.randomUUID());
    setError(null);
    setMessage(null);
    document.getElementById("cost-form")?.scrollIntoView({ block: "start" });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        idempotencyKey: key,
        sourceKey: draft.sourceKey,
        category: draft.category,
        treatment: draft.treatment,
        amountMinor: draft.amountMinor,
        costDate: draft.costDate,
        notes: draft.notes || undefined,
        ...(correctionId ? { correctionReason: draft.correctionReason } : {}),
        cycleId:
          draft.scope === "CYCLE" || draft.scope === "ACTIVITY"
            ? draft.cycleId
            : undefined,
        activityId: draft.scope === "ACTIVITY" ? draft.activityId : undefined,
        inventoryMovementId:
          draft.scope === "PURCHASE" ||
          (draft.scope === "ACTIVITY" && draft.movementId)
            ? draft.movementId
            : undefined,
      };
      await request(
        `/api/farms/${farmId}/costs${correctionId ? `/${correctionId}/correct` : ""}`,
        "POST",
        payload,
      );
      resetForm();
      setRevision((value) => value + 1);
      setMessage(
        correctionId
          ? "Koreksi biaya tersimpan. Catatan asal tetap ada."
          : "Biaya mentah tercatat.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Biaya belum dapat dipastikan. Coba lagi dengan data yang sama.",
      );
    } finally {
      setPending(false);
    }
  }
  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || !cancelId || pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/farms/${farmId}/costs/${cancelId}/cancel`, "POST", {
        idempotencyKey: cancelKey,
        reason: cancelReason,
      });
      setCancelId(null);
      setCancelReason("");
      setCancelKey(crypto.randomUUID());
      setRevision((value) => value + 1);
      setMessage("Catatan biaya dibatalkan dengan alasan audit.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Pembatalan biaya gagal.",
      );
    } finally {
      setPending(false);
    }
  }
  async function loadMore() {
    if (!farmId || nextOffset === null || loading) return;
    setLoading(true);
    try {
      const result = await request<{
        costs: CostSummary[];
        nextOffset: number | null;
      }>(`/api/farms/${farmId}/costs?limit=50&offset=${nextOffset}`);
      setCosts((current) => [...current, ...result.costs]);
      setNextOffset(result.nextOffset);
    } catch (cause) {
      setLoadError(
        cause instanceof Error
          ? cause.message
          : "Halaman biaya berikutnya gagal dimuat.",
      );
    } finally {
      setLoading(false);
    }
  }
  const activeActivities = activities.filter(
    (activity) => activity.cycleId === draft.cycleId,
  );
  return (
    <>
      <PageHeader
        eyebrow="Keuangan"
        title="Biaya"
        description="Klasifikasikan biaya berdasarkan bukti. Hanya biaya produksi tertaut ke siklus yang masuk HPP."
        visual="farm"
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm untuk mencatat biaya.
        </StatePanel>
      )}
      {error && (
        <StatePanel kind="error" title="Perubahan biaya gagal">
          {error}
        </StatePanel>
      )}
      {message && (
        <StatePanel kind="success" title="Tersimpan">
          {message}
        </StatePanel>
      )}
      {farmId && (
        <div className="inventory-grid">
          <div className="inventory-main">
            {loading && costs.length === 0 && (
              <StatePanel kind="loading" title="Memuat biaya">
                Sedang mengambil catatan farm.
              </StatePanel>
            )}
            {loadError && (
              <StatePanel
                kind="error"
                title="Biaya belum dapat dimuat"
                onRetry={() => setRevision((value) => value + 1)}
              >
                {loadError}
              </StatePanel>
            )}
            <Card title="Catatan biaya" className="inventory-list-card">
              <p className="list-meta">
                Nominal mentah; HPP hanya memakai biaya produksi siklus yang
                lengkap.
              </p>
              <DataTable
                caption="Biaya farm"
                rows={costs}
                rowKey={(cost) => cost.id}
                emptyMessage="Belum ada biaya yang dicatat."
                columns={[
                  {
                    key: "date",
                    label: "Tanggal",
                    render: (cost) => cost.costDate,
                  },
                  {
                    key: "source",
                    label: "Bukti / sumber",
                    render: (cost) => (
                      <span>
                        <strong>{cost.sourceKey}</strong>
                        <small className="schedule-cell-meta">
                          {sourceLabel(cost)} · {cost.category}
                        </small>
                      </span>
                    ),
                  },
                  {
                    key: "amount",
                    label: "Nominal",
                    render: (cost) => (
                      <strong>{money(cost.amountMinor)}</strong>
                    ),
                  },
                  {
                    key: "status",
                    label: "Status",
                    render: (cost) =>
                      cost.status === "POSTED"
                        ? {
                            UNCLASSIFIED: "Belum diklasifikasi",
                            INVENTORY_PURCHASE: "Pembelian persediaan",
                            PRODUCTION: "Biaya produksi",
                            CAPITAL: "Modal/aset",
                          }[cost.treatment]
                        : "Dibatalkan",
                  },
                  {
                    key: "action",
                    label: "",
                    render: (cost) =>
                      cost.status === "POSTED" ? (
                        <div className="table-actions">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => startCorrection(cost)}
                          >
                            Koreksi
                          </button>
                          <button
                            type="button"
                            className="button-danger-text"
                            onClick={() => {
                              setCancelId(cost.id);
                              setCancelReason("");
                              setCancelKey(crypto.randomUUID());
                            }}
                          >
                            Batalkan
                          </button>
                        </div>
                      ) : cost.correctionOf ? (
                        `Koreksi dari ${cost.correctionOf.slice(0, 8)}`
                      ) : (
                        cost.cancelReason
                      ),
                  },
                ]}
              />
              {nextOffset !== null && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void loadMore()}
                >
                  {loading ? "Memuat…" : "Muat biaya berikutnya"}
                </button>
              )}
              {cancelId && (
                <form onSubmit={(event) => void cancel(event)}>
                  <p>Alasan pembatalan disimpan bersama waktu dan pengguna.</p>
                  <FormField id="cost-cancel-reason" label="Alasan pembatalan">
                    <input
                      id="cost-cancel-reason"
                      required
                      maxLength={500}
                      value={cancelReason}
                      onChange={(event) => {
                        setCancelReason(event.target.value);
                        setCancelKey(crypto.randomUUID());
                      }}
                    />
                  </FormField>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setCancelId(null)}
                    >
                      Batal
                    </button>
                    <button type="submit" disabled={pending}>
                      Konfirmasi pembatalan
                    </button>
                  </div>
                </form>
              )}
            </Card>
          </div>
          <Card
            title={correctionId ? "Koreksi biaya" : "Catat biaya"}
            className="form-card inventory-form-card"
          >
            <p id="cost-form">
              Setiap catatan butuh nomor bukti unik. Koreksi membuat catatan
              baru dan membatalkan versi sebelumnya.
            </p>
            <form onSubmit={(event) => void save(event)}>
              <FormField id="cost-scope" label="Sumber biaya">
                <select
                  id="cost-scope"
                  value={draft.scope}
                  onChange={(event) => changeScope(event.target.value as Scope)}
                >
                  <option value="GENERAL">Biaya farm umum</option>
                  <option value="CYCLE">Biaya terkait siklus</option>
                  <option value="ACTIVITY">Biaya terkait aktivitas</option>
                  <option value="PURCHASE">Pembelian persediaan</option>
                </select>
              </FormField>
              {(draft.scope === "CYCLE" || draft.scope === "ACTIVITY") && (
                <FormField id="cost-cycle" label="Siklus">
                  <select
                    id="cost-cycle"
                    required
                    value={draft.cycleId}
                    onChange={(event) => {
                      setDraft((current) => ({
                        ...current,
                        cycleId: event.target.value,
                        activityId: "",
                        movementId: "",
                      }));
                      setKey(crypto.randomUUID());
                    }}
                  >
                    <option value="">Pilih siklus</option>
                    {cycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
              {draft.scope === "ACTIVITY" && (
                <FormField id="cost-activity" label="Aktivitas">
                  <select
                    id="cost-activity"
                    required
                    value={draft.activityId}
                    onChange={(event) => {
                      change("activityId", event.target.value);
                      setDraft((current) => ({ ...current, movementId: "" }));
                    }}
                  >
                    <option value="">Pilih aktivitas</option>
                    {activeActivities.map((activity) => (
                      <option key={activity.id} value={activity.id}>
                        {activity.kind} ·{" "}
                        {new Date(activity.scheduledAt).toLocaleString(
                          "id-ID",
                          { dateStyle: "medium", timeStyle: "short" },
                        )}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
              <FormField id="cost-treatment" label="Perlakuan biaya">
                <select
                  id="cost-treatment"
                  value={draft.treatment}
                  onChange={(event) =>
                    change(
                      "treatment",
                      event.target.value as CostSummary["treatment"],
                    )
                  }
                >
                  <option value="UNCLASSIFIED">Belum diklasifikasikan</option>
                  <option value="PRODUCTION">Biaya produksi (HPP)</option>
                  <option value="INVENTORY_PURCHASE">
                    Pembelian persediaan
                  </option>
                  <option value="CAPITAL">Modal/aset</option>
                </select>
              </FormField>
              {draft.scope === "ACTIVITY" && (
                <FormField
                  id="cost-consumption-movement"
                  label="Pemakaian stok terkait (opsional)"
                >
                  <select
                    id="cost-consumption-movement"
                    value={draft.movementId}
                    onChange={(event) =>
                      change("movementId", event.target.value)
                    }
                  >
                    <option value="">Tanpa pergerakan stok</option>
                    {movements
                      .filter((movement) => movement.type === "CONSUMPTION")
                      .map((movement) => (
                        <option key={movement.id} value={movement.id}>
                          {movement.itemName} · {movement.lotLabel} ·{" "}
                          {movement.quantityDelta} {movement.unit}
                        </option>
                      ))}
                  </select>
                </FormField>
              )}
              {draft.scope === "PURCHASE" && (
                <FormField id="cost-movement" label="Pergerakan stok masuk">
                  <select
                    id="cost-movement"
                    required
                    value={draft.movementId}
                    onChange={(event) =>
                      change("movementId", event.target.value)
                    }
                  >
                    <option value="">Pilih stok masuk</option>
                    {movements.map((movement) => (
                      <option key={movement.id} value={movement.id}>
                        {movement.itemName} · {movement.lotLabel} ·{" "}
                        {movement.quantityDelta} {movement.unit}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
              <FormField id="cost-source" label="Nomor bukti / source key">
                <input
                  id="cost-source"
                  required
                  maxLength={200}
                  value={draft.sourceKey}
                  onChange={(event) => change("sourceKey", event.target.value)}
                />
              </FormField>
              <FormField id="cost-category" label="Kategori biaya">
                <input
                  id="cost-category"
                  required
                  maxLength={100}
                  placeholder="Contoh: Pakan, listrik, transport"
                  value={draft.category}
                  onChange={(event) => change("category", event.target.value)}
                />
              </FormField>
              <FormField id="cost-amount" label="Nominal (Rp)">
                <input
                  id="cost-amount"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={draft.amountMinor}
                  onChange={(event) =>
                    change("amountMinor", event.target.value)
                  }
                />
              </FormField>
              <FormField id="cost-date" label="Tanggal biaya">
                <input
                  id="cost-date"
                  type="date"
                  required
                  value={draft.costDate}
                  onChange={(event) => change("costDate", event.target.value)}
                />
              </FormField>
              <FormField id="cost-notes" label="Catatan (opsional)">
                <textarea
                  id="cost-notes"
                  rows={3}
                  maxLength={2000}
                  value={draft.notes}
                  onChange={(event) => change("notes", event.target.value)}
                />
              </FormField>
              {correctionId && (
                <FormField id="cost-correction-reason" label="Alasan koreksi">
                  <input
                    id="cost-correction-reason"
                    required
                    maxLength={500}
                    value={draft.correctionReason}
                    onChange={(event) =>
                      change("correctionReason", event.target.value)
                    }
                  />
                </FormField>
              )}
              <div className="actions">
                {correctionId && (
                  <button type="button" disabled={pending} onClick={resetForm}>
                    Batal koreksi
                  </button>
                )}
                <button type="submit" disabled={pending}>
                  {correctionId ? "Simpan koreksi" : "Catat biaya"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
