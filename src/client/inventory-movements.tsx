import { useEffect, useState, type FormEvent } from "react";
import type {
  InventoryItemSummary,
  InventoryLotSummary,
  MovementSummary,
} from "../modules/inventory/contracts.js";
import {
  Card,
  DataTable,
  FormField,
  StatePanel,
} from "./components/primitives.js";
import { request } from "./farms.js";
import { formatDecimal } from "./units.js";

type Action = "stock-in" | "adjust" | "transfer" | "dispose";
const actionLabels: Record<Action, string> = {
  "stock-in": "Stok masuk",
  adjust: "Penyesuaian",
  transfer: "Transfer antar lot",
  dispose: "Rusak / kedaluwarsa",
};
const movementLabels: Record<MovementSummary["type"], string> = {
  STOCK_IN: "Stok masuk",
  STOCK_OUT: "Stok keluar",
  ADJUSTMENT: "Penyesuaian",
  TRANSFER: "Transfer",
  CONSUMPTION: "Pemakaian",
  EXPIRED: "Kedaluwarsa",
  DAMAGED: "Rusak",
  REVERSAL: "Pembalikan",
};
export function InventoryMovements({
  farmId,
  item,
  lots,
  onChanged,
}: {
  farmId: string;
  item: InventoryItemSummary;
  lots: InventoryLotSummary[];
  onChanged: () => Promise<void>;
}) {
  const [action, setAction] = useState<Action>("stock-in");
  const [lotId, setLotId] = useState("");
  const [toLotId, setToLotId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [disposalType, setDisposalType] = useState<"DAMAGED" | "EXPIRED">(
    "DAMAGED",
  );
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [reverseTarget, setReverseTarget] = useState<MovementSummary | null>(
    null,
  );
  const [reverseReason, setReverseReason] = useState("");
  const [reverseKey, setReverseKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [movements, setMovements] = useState<MovementSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const step = ["UNIT", "HEAD", "SEED"].includes(item.unit) ? "1" : "0.001";
  useEffect(() => {
    setLotId(lots[0]?.id ?? "");
    setToLotId(lots[1]?.id ?? "");
  }, [item.id, lots.length]);
  useEffect(() => {
    if (item.category === "HARVEST_PRODUCT") setAction("adjust");
  }, [item.id, item.category]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setHistoryError(null);
    request<{ movements: MovementSummary[]; nextOffset: number | null }>(
      `/api/farms/${farmId}/movements?itemId=${item.id}&limit=50&offset=0`,
    )
      .then((result) => {
        if (!current) return;
        setMovements(result.movements);
        setNextOffset(result.nextOffset);
      })
      .catch((cause) => {
        if (current)
          setHistoryError(
            cause instanceof Error
              ? cause.message
              : "Riwayat belum dapat dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, item.id, revision]);
  function changed() {
    setKey(crypto.randomUUID());
    setError(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !lotId) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const base = { idempotencyKey: key, reason };
      const body =
        action === "stock-in"
          ? { ...base, lotId, quantity }
          : action === "adjust"
            ? { ...base, lotId, quantityDelta: quantity }
            : action === "transfer"
              ? { ...base, fromLotId: lotId, toLotId, quantity }
              : { ...base, lotId, quantity, type: disposalType };
      await request(`/api/farms/${farmId}/movements/${action}`, "POST", body);
      await onChanged();
      setRevision((value) => value + 1);
      setKey(crypto.randomUUID());
      setQuantity("");
      setReason("");
      setMessage("Pergerakan stok tersimpan.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Pergerakan stok gagal disimpan.",
      );
    } finally {
      setPending(false);
    }
  }
  async function reverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !reverseTarget || !reverseReason.trim()) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/farms/${farmId}/movements/reverse`, "POST", {
        idempotencyKey: reverseKey,
        movementId: reverseTarget.id,
        reason: reverseReason.trim(),
      });
      await onChanged();
      setRevision((value) => value + 1);
      setReverseTarget(null);
      setReverseReason("");
      setReverseKey(crypto.randomUUID());
      setMessage("Pergerakan dibalik dan saldo diperbarui.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pembalikan gagal.");
    } finally {
      setPending(false);
    }
  }
  function selectReverse(movement: MovementSummary) {
    setReverseTarget(movement);
    setReverseReason("");
    setReverseKey(crypto.randomUUID());
    setError(null);
    setMessage(null);
  }
  async function loadMore() {
    if (nextOffset === null || loading) return;
    setLoading(true);
    try {
      const result = await request<{
        movements: MovementSummary[];
        nextOffset: number | null;
      }>(
        `/api/farms/${farmId}/movements?itemId=${item.id}&limit=50&offset=${nextOffset}`,
      );
      setMovements((current) => [...current, ...result.movements]);
      setNextOffset(result.nextOffset);
    } catch (cause) {
      setHistoryError(
        cause instanceof Error
          ? cause.message
          : "Riwayat berikutnya gagal dimuat.",
      );
    } finally {
      setLoading(false);
    }
  }
  const reversed = new Set(
    movements.map((movement) => movement.reversalOf).filter(Boolean),
  );
  return (
    <div className="inventory-movements">
      <Card title="Catat pergerakan stok" className="form-card">
        <p>
          Setiap perubahan saldo tersimpan sebagai catatan baru. Alasan wajib
          diisi.
        </p>
        {error && (
          <StatePanel kind="error" title="Pergerakan gagal">
            {error}
          </StatePanel>
        )}
        {message && (
          <StatePanel kind="success" title="Tersimpan">
            {message}
          </StatePanel>
        )}
        {lots.length === 0 ? (
          <StatePanel kind="empty" title="Belum ada lot">
            Buat lot untuk mencatat stok.
          </StatePanel>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <div className="inventory-fields">
              <FormField id="movement-action" label="Jenis tindakan">
                <select
                  id="movement-action"
                  value={action}
                  onChange={(event) => {
                    setAction(event.target.value as Action);
                    changed();
                  }}
                >
                  {(Object.keys(actionLabels) as Action[])
                    .filter(
                      (value) =>
                        item.category !== "HARVEST_PRODUCT" ||
                        (value !== "stock-in" && value !== "transfer"),
                    )
                    .map((value) => (
                      <option key={value} value={value}>
                        {actionLabels[value]}
                      </option>
                    ))}
                </select>
              </FormField>
              <FormField
                id="movement-lot"
                label={action === "transfer" ? "Dari lot" : "Lot"}
              >
                <select
                  id="movement-lot"
                  value={lotId}
                  required
                  onChange={(event) => {
                    setLotId(event.target.value);
                    setToLotId(
                      lots.find((lot) => lot.id !== event.target.value)?.id ??
                        "",
                    );
                    changed();
                  }}
                >
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.label} · {formatDecimal(lot.quantity)} {item.unit}
                    </option>
                  ))}
                </select>
              </FormField>
              {action === "transfer" && (
                <FormField id="movement-to-lot" label="Ke lot">
                  <select
                    id="movement-to-lot"
                    value={toLotId}
                    required
                    onChange={(event) => {
                      setToLotId(event.target.value);
                      changed();
                    }}
                  >
                    <option value="">Pilih lot tujuan</option>
                    {lots
                      .filter((lot) => lot.id !== lotId)
                      .map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.label}
                        </option>
                      ))}
                  </select>
                </FormField>
              )}
              {action === "dispose" && (
                <FormField id="movement-disposal" label="Kondisi">
                  <select
                    id="movement-disposal"
                    value={disposalType}
                    onChange={(event) => {
                      setDisposalType(
                        event.target.value as "DAMAGED" | "EXPIRED",
                      );
                      changed();
                    }}
                  >
                    <option value="DAMAGED">Rusak</option>
                    <option value="EXPIRED">Kedaluwarsa</option>
                  </select>
                </FormField>
              )}
              <FormField
                id="movement-quantity"
                label={`${action === "adjust" ? "Perubahan (+/-)" : "Jumlah"} (${item.unit})`}
              >
                <input
                  id="movement-quantity"
                  type="number"
                  step={step}
                  min={action === "adjust" ? undefined : step}
                  required
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    changed();
                  }}
                />
              </FormField>
              <FormField id="movement-reason" label="Alasan">
                <input
                  id="movement-reason"
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    changed();
                  }}
                />
              </FormField>
            </div>
            <button
              type="submit"
              disabled={
                pending ||
                !item.active ||
                (action === "transfer" && lots.length < 2)
              }
            >
              Simpan pergerakan
            </button>
          </form>
        )}
      </Card>
      <Card title="Riwayat pergerakan" className="inventory-list-card">
        {historyError && (
          <StatePanel
            kind="error"
            title="Riwayat gagal dimuat"
            onRetry={() => setRevision((value) => value + 1)}
          >
            {historyError}
          </StatePanel>
        )}
        <DataTable
          caption="Riwayat stok item"
          rows={movements}
          rowKey={(movement) => movement.id}
          emptyMessage={
            loading ? "Memuat riwayat…" : "Belum ada pergerakan stok."
          }
          columns={[
            {
              key: "date",
              label: "Waktu",
              render: (movement) =>
                new Date(movement.createdAt).toLocaleString("id-ID"),
            },
            {
              key: "type",
              label: "Jenis",
              render: (movement) => (
                <span>
                  <strong>{movementLabels[movement.type]}</strong>
                  <small className="schedule-cell-meta">
                    {movement.lotLabel}
                  </small>
                </span>
              ),
            },
            {
              key: "quantity",
              label: "Perubahan",
              render: (movement) => (
                <strong>
                  {formatDecimal(movement.quantityDelta)} {movement.unit}
                </strong>
              ),
            },
            {
              key: "reason",
              label: "Alasan",
              render: (movement) => movement.reason,
            },
            {
              key: "action",
              label: "",
              render: (movement) =>
                movement.type !== "REVERSAL" &&
                !["CONSUMPTION", "STOCK_OUT"].includes(movement.type) &&
                !reversed.has(movement.id) &&
                (item.category !== "HARVEST_PRODUCT" ||
                  movement.type !== "STOCK_IN") ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={pending}
                    onClick={() => selectReverse(movement)}
                  >
                    Balikkan
                  </button>
                ) : null,
            },
          ]}
        />
        {reverseTarget && (
          <form onSubmit={(event) => void reverse(event)}>
            <p>
              Balikkan {movementLabels[reverseTarget.type].toLowerCase()} pada
              lot {reverseTarget.lotLabel}. Catatan asal tetap tersimpan.
            </p>
            <FormField id="reverse-reason" label="Alasan pembalikan">
              <input
                id="reverse-reason"
                required
                maxLength={500}
                value={reverseReason}
                onChange={(event) => {
                  setReverseReason(event.target.value);
                  setReverseKey(crypto.randomUUID());
                }}
              />
            </FormField>
            <div className="actions">
              <button
                type="button"
                disabled={pending}
                onClick={() => setReverseTarget(null)}
              >
                Batal
              </button>
              <button type="submit" disabled={pending}>
                Simpan pembalikan
              </button>
            </div>
          </form>
        )}
        {nextOffset !== null && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading ? "Memuat…" : "Muat riwayat berikutnya"}
          </button>
        )}
      </Card>
    </div>
  );
}
