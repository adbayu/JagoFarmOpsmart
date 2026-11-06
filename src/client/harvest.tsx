import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { CycleSummary } from "../modules/farming/contracts.js";
import type { HarvestSummary } from "../modules/harvest/contracts.js";
import type { ProductSummary } from "../modules/products/contracts.js";
import {
  Card,
  ConfirmDialog,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";

type OutputDraft = {
  id: string;
  productId: string;
  quantity: string;
  weightKg: string;
  lotLabel: string;
};
const blankOutput = (): OutputDraft => ({
  id: crypto.randomUUID(),
  productId: "",
  quantity: "",
  weightKg: "",
  lotLabel: "",
});
export function HarvestPage({ state }: { state: ReturnType<typeof useFarms> }) {
  const farmId = state.activeId;
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [harvests, setHarvests] = useState<HarvestSummary[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA"),
  );
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [outputs, setOutputs] = useState<OutputDraft[]>([blankOutput()]);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelKey, setCancelKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!farmId || state.loading) {
      setCycles([]);
      setProducts([]);
      setHarvests([]);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    Promise.all([
      request<CycleSummary[]>(`/api/farms/${farmId}/cycles`),
      request<ProductSummary[]>(`/api/farms/${farmId}/products`),
      request<HarvestSummary[]>(`/api/farms/${farmId}/harvests`),
    ])
      .then(([cycleRows, productRows, harvestRows]) => {
        if (!current) return;
        setCycles(cycleRows);
        setProducts(productRows);
        setHarvests(harvestRows);
        setCycleId((old) =>
          cycleRows.some(
            (cycle) => cycle.id === old && cycle.status === "ACTIVE",
          )
            ? old
            : (cycleRows.find((cycle) => cycle.status === "ACTIVE")?.id ?? ""),
        );
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Data panen gagal dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, revision]);
  const cycle = cycles.find((value) => value.id === cycleId);
  const availableProducts = products.filter(
    (value) =>
      value.status === "ACTIVE" && value.commodityId === cycle?.commodityId,
  );
  function changeOutput(
    id: string,
    field: keyof Omit<OutputDraft, "id">,
    value: string,
  ) {
    setOutputs((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
    setKey(crypto.randomUUID());
    setError(null);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/farms/${farmId}/harvests`, "POST", {
        idempotencyKey: key,
        cycleId,
        harvestDate: date,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
        outputs: outputs.map(({ productId, quantity, weightKg, lotLabel }) => ({
          productId,
          quantity,
          weightKg: weightKg || undefined,
          lotLabel,
        })),
      });
      setOutputs([blankOutput()]);
      setLocation("");
      setNotes("");
      setKey(crypto.randomUUID());
      setMessage(
        "Panen diposting. Lot dan stok hasil panen sudah tersedia untuk penjualan.",
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Panen gagal diposting.",
      );
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    if (!farmId || !cancelId || pending) return;
    if (!cancelReason.trim()) {
      setCancelError("Alasan pembatalan wajib diisi.");
      return;
    }
    setPending(true);
    setCancelError(null);
    setMessage(null);
    try {
      await request(
        `/api/farms/${farmId}/harvests/${cancelId}/cancel`,
        "POST",
        {
          idempotencyKey: cancelKey,
          reason: cancelReason.trim(),
        },
      );
      setCancelId(null);
      setCancelReason("");
      setCancelKey(crypto.randomUUID());
      setMessage("Panen dibatalkan dan stok hasilnya dibalik.");
      setRevision((value) => value + 1);
    } catch (cause) {
      setCancelError(
        cause instanceof Error ? cause.message : "Panen gagal dibatalkan.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Operasional"
        title="Panen"
        visual="harvest"
        description="Catat hasil siklus per produk dan grade. Setiap baris membentuk lot dengan asal panen yang dapat ditelusuri."
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm untuk mencatat panen.
        </StatePanel>
      )}
      {error && (
        <StatePanel
          kind="error"
          title="Panen belum dapat diproses"
          onRetry={() => setRevision((value) => value + 1)}
        >
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
            {loading && (
              <StatePanel kind="loading" title="Memuat panen">
                Mengambil catatan farm.
              </StatePanel>
            )}
            <Card title="Riwayat panen" className="inventory-list-card">
              {harvests.length === 0 && !loading && (
                <StatePanel kind="empty" title="Belum ada panen">
                  Hasil dari siklus aktif akan muncul di sini.
                </StatePanel>
              )}
              {harvests.map((harvest) => (
                <article key={harvest.id} className="harvest-entry">
                  <div className="harvest-entry-head">
                    <div>
                      <strong>{harvest.cycleName}</strong>
                      <small className="schedule-cell-meta">
                        {harvest.harvestDate} ·{" "}
                        {harvest.location || "Lokasi tidak dicatat"} ·{" "}
                        {harvest.status === "POSTED" ? "Aktif" : "Dibatalkan"}
                      </small>
                    </div>
                    {harvest.status === "POSTED" && (
                      <button
                        type="button"
                        className="button-danger-text"
                        disabled={pending}
                        onClick={() => {
                          setCancelId(harvest.id);
                          setCancelReason("");
                          setCancelError(null);
                          setCancelKey(crypto.randomUUID());
                        }}
                      >
                        Batalkan
                      </button>
                    )}
                  </div>
                  <div className="table-scroll">
                    <table>
                      <caption>Output panen {harvest.cycleName}</caption>
                      <thead>
                        <tr>
                          <th>Produk / lot</th>
                          <th>Hasil</th>
                          <th>Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {harvest.outputs.map((output) => (
                          <tr key={output.id}>
                            <td>
                              <strong>{output.productName}</strong>
                              <small className="schedule-cell-meta">
                                {output.grade || "Tanpa grade"} ·{" "}
                                {output.lotLabel}
                              </small>
                            </td>
                            <td>
                              {output.quantity} {output.unit}
                              {output.weightKg
                                ? ` · ${output.weightKg} kg`
                                : ""}
                            </td>
                            <td>
                              {output.balance} {output.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {harvest.notes && <p>{harvest.notes}</p>}
                </article>
              ))}
            </Card>
          </div>
          <Card title="Posting panen" className="form-card inventory-form-card">
            <p>
              Panen parsial dapat dicatat beberapa kali pada siklus yang sama.
              Siklus tetap aktif setelah posting.
            </p>
            {cycles.every((value) => value.status !== "ACTIVE") && (
              <StatePanel kind="empty" title="Belum ada siklus aktif">
                Buat atau aktifkan siklus di <Link to="/cycles">Siklus</Link>.
              </StatePanel>
            )}
            {cycle && availableProducts.length === 0 && (
              <StatePanel kind="empty" title="Produk komoditas belum tersedia">
                Buat produk untuk {cycle.commodityName} di{" "}
                <Link to="/products">Produk</Link>.
              </StatePanel>
            )}
            {cycle && availableProducts.length > 0 && (
              <form onSubmit={(event) => void save(event)}>
                <FormField id="harvest-cycle" label="Siklus aktif">
                  <select
                    id="harvest-cycle"
                    required
                    value={cycleId}
                    onChange={(event) => {
                      setCycleId(event.target.value);
                      setOutputs([blankOutput()]);
                      setKey(crypto.randomUUID());
                    }}
                  >
                    {cycles
                      .filter((value) => value.status === "ACTIVE")
                      .map((value) => (
                        <option key={value.id} value={value.id}>
                          {value.name} · {value.commodityName}
                        </option>
                      ))}
                  </select>
                </FormField>
                <FormField id="harvest-date" label="Tanggal panen">
                  <input
                    id="harvest-date"
                    type="date"
                    required
                    min={cycle.startDate}
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                <FormField id="harvest-location" label="Lokasi (opsional)">
                  <input
                    id="harvest-location"
                    maxLength={300}
                    value={location}
                    onChange={(event) => {
                      setLocation(event.target.value);
                      setKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                <FormField id="harvest-notes" label="Catatan (opsional)">
                  <textarea
                    id="harvest-notes"
                    maxLength={2000}
                    value={notes}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      setKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                <h3>Output per produk / grade</h3>
                {outputs.map((output, index) => (
                  <fieldset key={output.id} className="harvest-output">
                    <legend>Output {index + 1}</legend>
                    <FormField
                      id={`harvest-product-${output.id}`}
                      label="Produk"
                    >
                      <select
                        id={`harvest-product-${output.id}`}
                        required
                        value={output.productId}
                        onChange={(event) =>
                          changeOutput(
                            output.id,
                            "productId",
                            event.target.value,
                          )
                        }
                      >
                        <option value="">Pilih produk</option>
                        {availableProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} · {product.grade || "Tanpa grade"} ·{" "}
                            {product.unit}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField
                      id={`harvest-quantity-${output.id}`}
                      label={`Kuantitas ${products.find((product) => product.id === output.productId)?.unit ?? ""}`}
                    >
                      <input
                        id={`harvest-quantity-${output.id}`}
                        type="number"
                        min="0.001"
                        step={
                          ["HEAD", "UNIT", "SEED"].includes(
                            products.find(
                              (product) => product.id === output.productId,
                            )?.unit ?? "",
                          )
                            ? "1"
                            : "0.001"
                        }
                        required
                        value={output.quantity}
                        onChange={(event) =>
                          changeOutput(
                            output.id,
                            "quantity",
                            event.target.value,
                          )
                        }
                      />
                    </FormField>
                    <FormField
                      id={`harvest-weight-${output.id}`}
                      label="Berat tambahan (kg, opsional)"
                    >
                      <input
                        id={`harvest-weight-${output.id}`}
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={output.weightKg}
                        onChange={(event) =>
                          changeOutput(
                            output.id,
                            "weightKg",
                            event.target.value,
                          )
                        }
                      />
                    </FormField>
                    <FormField
                      id={`harvest-lot-${output.id}`}
                      label="Label lot"
                    >
                      <input
                        id={`harvest-lot-${output.id}`}
                        required
                        maxLength={120}
                        value={output.lotLabel}
                        onChange={(event) =>
                          changeOutput(
                            output.id,
                            "lotLabel",
                            event.target.value,
                          )
                        }
                      />
                    </FormField>
                    {outputs.length > 1 && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setOutputs((rows) =>
                            rows.filter((row) => row.id !== output.id),
                          );
                          setKey(crypto.randomUUID());
                        }}
                      >
                        Hapus output
                      </button>
                    )}
                  </fieldset>
                ))}
                <div className="actions">
                  <button
                    type="button"
                    disabled={outputs.length >= 100}
                    onClick={() => {
                      setOutputs((rows) => [...rows, blankOutput()]);
                      setKey(crypto.randomUUID());
                    }}
                  >
                    Tambah output
                  </button>
                  <button type="submit" disabled={pending}>
                    Posting panen
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={cancelId !== null}
        title="Batalkan panen?"
        busy={pending}
        onClose={() => {
          setCancelId(null);
          setCancelError(null);
        }}
        onConfirm={() => void cancel()}
      >
        <p>
          Pembatalan hanya berhasil jika seluruh stok dari panen ini masih
          tersedia.
        </p>
        <FormField
          id="harvest-cancel-reason"
          label="Alasan pembatalan"
          error={cancelError ?? undefined}
        >
          <input
            id="harvest-cancel-reason"
            required
            maxLength={500}
            value={cancelReason}
            onChange={(event) => {
              setCancelReason(event.target.value);
              setCancelError(null);
              setCancelKey(crypto.randomUUID());
            }}
          />
        </FormField>
      </ConfirmDialog>
    </>
  );
}
