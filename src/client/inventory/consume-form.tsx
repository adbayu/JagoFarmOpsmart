import { useEffect, useState, type FormEvent } from "react";
import type { ActivitySummary } from "../../modules/schedules/contracts.js";
import type {
  ConsumableOption,
  ConsumptionHistory,
} from "../../modules/inventory/contracts.js";
import {
  Card,
  DataTable,
  FormField,
  StatePanel,
} from "../components/primitives.js";
import { request } from "../farms.js";
import { formatDecimal } from "../units.js";

export function ConsumeForm({
  farmId,
  activity,
  cycleActive,
}: {
  farmId: string;
  activity: ActivitySummary;
  cycleActive: boolean;
}) {
  const [options, setOptions] = useState<ConsumableOption[]>([]);
  const [history, setHistory] = useState<ConsumptionHistory[]>([]);
  const [itemId, setItemId] = useState("");
  const [lotId, setLotId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const item = options.find((option) => option.itemId === itemId);
  const lot = item?.lots.find((option) => option.lotId === lotId);
  const canConsume =
    cycleActive && ["SCHEDULED", "IN_PROGRESS"].includes(activity.status);
  const step =
    item && ["UNIT", "HEAD", "SEED"].includes(item.unit) ? "1" : "0.001";
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      request<ConsumableOption[]>(`/api/farms/${farmId}/consumption-options`),
      request<ConsumptionHistory[]>(
        `/api/farms/${farmId}/activities/${activity.id}/consumptions`,
      ),
    ])
      .then(([items, records]) => {
        if (!current) return;
        setOptions(items);
        setHistory(records);
        setItemId((previous) =>
          items.some((option) => option.itemId === previous)
            ? previous
            : (items[0]?.itemId ?? ""),
        );
      })
      .catch((cause) => {
        if (current)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Data pemakaian belum dapat dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, activity.id, revision]);
  useEffect(() => {
    setLotId((previous) =>
      item?.lots.some((option) => option.lotId === previous)
        ? previous
        : (item?.lots[0]?.lotId ?? ""),
    );
  }, [itemId, options]);
  function changePayload() {
    setKey(crypto.randomUUID());
    setError(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !item || !lot || !canConsume) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/farms/${farmId}/consumptions`, "POST", {
        idempotencyKey: key,
        cycleId: activity.cycleId,
        activityId: activity.id,
        inventoryItemId: item.itemId,
        unit: item.unit,
        allocations: [{ lotId: lot.lotId, quantity }],
      });
      const [items, records] = await Promise.all([
        request<ConsumableOption[]>(`/api/farms/${farmId}/consumption-options`),
        request<ConsumptionHistory[]>(
          `/api/farms/${farmId}/activities/${activity.id}/consumptions`,
        ),
      ]);
      setOptions(items);
      setHistory(records);
      setQuantity("");
      setKey(crypto.randomUUID());
      setMessage("Pemakaian stok tercatat. Saldo dan riwayat diperbarui.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Pemakaian stok belum dapat dipastikan. Coba lagi dengan data yang sama.",
      );
      try {
        const latest = await request<ConsumableOption[]>(
          `/api/farms/${farmId}/consumption-options`,
        );
        if (latest.length) setOptions(latest);
      } catch {
        // Keep the original error and form for an idempotent retry.
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <Card title="Pemakaian stok" className="form-card schedule-detail-card">
      <p>
        Pemakaian terkait aktivitas ini. Penyelesaian aktivitas dilakukan
        terpisah melalui tombol status di atas.
      </p>
      {loadError && (
        <StatePanel
          kind="error"
          title="Data pemakaian gagal dimuat"
          onRetry={() => setRevision((value) => value + 1)}
        >
          {loadError}
        </StatePanel>
      )}
      {error && (
        <StatePanel kind="error" title="Pemakaian belum tersimpan">
          {error}
        </StatePanel>
      )}
      {message && (
        <StatePanel kind="success" title="Tersimpan">
          {message}
        </StatePanel>
      )}
      {!canConsume && (
        <StatePanel kind="empty" title="Pemakaian ditutup">
          Aktivitas harus terjadwal atau berjalan pada siklus aktif untuk
          mencatat pemakaian baru. Riwayat tetap tersedia.
        </StatePanel>
      )}
      {canConsume && options.length === 0 && !loading && !loadError && (
        <StatePanel kind="empty" title="Stok tersedia belum ada">
          Catat stok masuk pada halaman Persediaan terlebih dahulu.
        </StatePanel>
      )}
      {canConsume && options.length > 0 && (
        <form onSubmit={(event) => void submit(event)}>
          <div className="inventory-fields">
            <FormField id="consume-item" label="Item">
              <select
                id="consume-item"
                required
                value={itemId}
                onChange={(event) => {
                  setItemId(event.target.value);
                  setLotId("");
                  changePayload();
                }}
              >
                {options.map((option) => (
                  <option key={option.itemId} value={option.itemId}>
                    {option.itemName} · {option.unit}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="consume-lot" label="Lot sumber">
              <select
                id="consume-lot"
                required
                value={lotId}
                onChange={(event) => {
                  setLotId(event.target.value);
                  changePayload();
                }}
              >
                {item?.lots.map((option) => (
                  <option key={option.lotId} value={option.lotId}>
                    {option.lotLabel} · tersedia{" "}
                    {formatDecimal(option.quantity)} {item.unit}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              id="consume-quantity"
              label={`Jumlah ${item?.unit ?? ""}`}
            >
              <input
                id="consume-quantity"
                type="number"
                min={step}
                step={step}
                required
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  changePayload();
                }}
              />
            </FormField>
          </div>
          <button type="submit" disabled={pending || !item || !lot}>
            Catat pemakaian
          </button>
        </form>
      )}
      <h3 className="section-kicker">Riwayat pemakaian aktivitas</h3>
      <DataTable
        caption="Riwayat pemakaian pada aktivitas ini"
        rows={history}
        rowKey={(record) => record.movementId}
        emptyMessage={
          loading
            ? "Memuat riwayat…"
            : "Belum ada pemakaian stok pada aktivitas ini."
        }
        columns={[
          {
            key: "date",
            label: "Waktu",
            render: (record) =>
              new Date(record.createdAt).toLocaleString("id-ID"),
          },
          {
            key: "item",
            label: "Item / lot",
            render: (record) => (
              <span>
                <strong>{record.itemName}</strong>
                <small className="schedule-cell-meta">{record.lotLabel}</small>
              </span>
            ),
          },
          {
            key: "quantity",
            label: "Dipakai",
            render: (record) =>
              `${formatDecimal(record.quantity)} ${record.unit}`,
          },
        ]}
      />
    </Card>
  );
}
