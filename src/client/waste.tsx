import { useEffect, useState, type FormEvent } from "react";
import type {
  WasteDetail,
  WasteStatus,
  WasteSummary,
} from "../modules/waste/contracts.js";
import { units } from "../shared/domain.js";
import {
  Card,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";

const today = () => new Date().toLocaleDateString("en-CA");
const statusLabel: Record<WasteStatus, string> = {
  RECORDED: "Tercatat",
  PROCESSING: "Sedang diproses",
  PROCESSED: "Selesai diproses",
  REUSED: "Digunakan kembali",
  DISPOSED: "Dibuang",
};
const formatHistoryTime = (value: string) =>
  new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function WastePage({ state }: { state: ReturnType<typeof useFarms> }) {
  const farmId = state.activeId;
  const [records, setRecords] = useState<WasteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<(typeof units)[number]>("KG");
  const [wasteDate, setWasteDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [usage, setUsage] = useState<Record<string, string>>({});
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [actionKeys, setActionKeys] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, WasteDetail>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>(
    {},
  );
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setHistory({});
    setHistoryLoading({});
    setHistoryErrors({});
    setExpandedHistoryId(null);
  }, [farmId]);

  useEffect(() => {
    if (state.loading) return;
    if (!farmId) {
      setRecords([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let current = true;
    setLoading(true);
    setLoadError(null);
    request<WasteSummary[]>(`/api/farms/${farmId}/waste`)
      .then((result) => {
        if (current) setRecords(result);
      })
      .catch((cause) => {
        if (current)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Catatan limbah gagal dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, revision]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || pending) return;
    setPending(true);
    setActionError(null);
    try {
      await request<{ wasteId: string }>(`/api/farms/${farmId}/waste`, "POST", {
        idempotencyKey: createKey,
        source,
        quantity,
        unit,
        wasteDate,
        ...(notes.trim() ? { notes } : {}),
      });
      setSource("");
      setQuantity("");
      setNotes("");
      setCreateKey(crypto.randomUUID());
      setRevision((value) => value + 1);
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Catatan limbah gagal disimpan.",
      );
    } finally {
      setPending(false);
    }
  }

  async function transition(record: WasteSummary, status: WasteStatus) {
    if (!farmId || pending) return;
    const keyName = `${record.id}:${status}`;
    const idempotencyKey = actionKeys[keyName] ?? crypto.randomUUID();
    setActionKeys((previous) => ({ ...previous, [keyName]: idempotencyKey }));
    setPending(true);
    setActionError(null);
    try {
      const detail = await request<WasteDetail>(
        `/api/farms/${farmId}/waste/${record.id}/transition`,
        "POST",
        {
          idempotencyKey,
          expectedStatus: record.status,
          status,
          ...(status === "REUSED" ? { usage: usage[record.id]?.trim() } : {}),
        },
      );
      setRecords((previous) =>
        previous.map((item) => (item.id === detail.id ? detail : item)),
      );
      setHistory((previous) => ({ ...previous, [record.id]: detail }));
      setActionKeys((previous) => ({
        ...previous,
        [keyName]: crypto.randomUUID(),
      }));
      setUsage((previous) => ({ ...previous, [record.id]: "" }));
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Status limbah gagal diperbarui.",
      );
    } finally {
      setPending(false);
    }
  }

  async function loadHistory(recordId: string) {
    if (!farmId || historyLoading[recordId]) return;
    setHistoryLoading((previous) => ({ ...previous, [recordId]: true }));
    setHistoryErrors((previous) => {
      const next = { ...previous };
      delete next[recordId];
      return next;
    });
    try {
      const detail = await request<WasteDetail>(
        `/api/farms/${farmId}/waste/${recordId}`,
      );
      setHistory((previous) => ({ ...previous, [recordId]: detail }));
    } catch (cause) {
      setHistoryErrors((previous) => ({
        ...previous,
        [recordId]:
          cause instanceof Error
            ? cause.message
            : "Riwayat limbah gagal dimuat.",
      }));
    } finally {
      setHistoryLoading((previous) => ({ ...previous, [recordId]: false }));
    }
  }

  function toggleHistory(recordId: string) {
    if (expandedHistoryId === recordId) {
      setExpandedHistoryId(null);
      return;
    }
    setExpandedHistoryId(recordId);
    if (!history[recordId] && !historyLoading[recordId])
      void loadHistory(recordId);
  }

  return (
    <>
      <PageHeader
        eyebrow="Operasional"
        title="Limbah organik"
        visual="circular"
        description="Catat sumber, jumlah, dan proses pemanfaatan limbah organik farm."
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih atau buat farm untuk mulai mencatat limbah.
        </StatePanel>
      )}
      {farmId && (
        <div className="inventory-grid">
          <div className="inventory-main">
            {loadError && (
              <StatePanel
                kind="error"
                title="Catatan limbah belum dapat dimuat"
                onRetry={() => setRevision((value) => value + 1)}
              >
                {loadError}
              </StatePanel>
            )}
            {actionError && (
              <StatePanel kind="error" title="Perubahan belum tersimpan">
                {actionError} Draft dan kunci retry tetap dipertahankan.
              </StatePanel>
            )}
            {loading && (
              <StatePanel kind="loading" title="Memuat catatan limbah">
                Mengambil catatan dari farm aktif.
              </StatePanel>
            )}
            <Card title="Catatan limbah">
              <p className="list-meta">
                Status menjelaskan proses pencatatan. Catatan ini tidak mengubah
                persediaan atau biaya secara otomatis.
              </p>
              {!loading && !loadError && records.length === 0 && (
                <StatePanel kind="empty" title="Belum ada catatan limbah">
                  Catat sumber dan jumlah limbah untuk mulai menelusuri
                  prosesnya.
                </StatePanel>
              )}
              <div className="waste-list" aria-busy={loading}>
                {records.map((record) => (
                  <article className="waste-record" key={record.id}>
                    <div className="waste-record-head">
                      <div>
                        <h3>{record.source}</h3>
                        <p>
                          <strong>
                            {record.quantity} {record.unit}
                          </strong>
                          <span>Dicatat {record.wasteDate}</span>
                        </p>
                      </div>
                      <span className="waste-status">
                        {statusLabel[record.status]}
                      </span>
                    </div>
                    {record.notes && (
                      <p className="waste-notes">{record.notes}</p>
                    )}
                    {record.usage && (
                      <p className="waste-notes">
                        Tujuan penggunaan: <strong>{record.usage}</strong>
                      </p>
                    )}
                    <div className="waste-history">
                      <button
                        type="button"
                        className="waste-history-toggle"
                        aria-expanded={expandedHistoryId === record.id}
                        aria-controls={`waste-history-${record.id}`}
                        onClick={() => toggleHistory(record.id)}
                      >
                        {expandedHistoryId === record.id
                          ? "Sembunyikan riwayat"
                          : "Lihat riwayat"}
                      </button>
                      {expandedHistoryId === record.id && (
                        <div
                          id={`waste-history-${record.id}`}
                          className="waste-history-panel"
                          aria-busy={Boolean(historyLoading[record.id])}
                        >
                          {historyLoading[record.id] && (
                            <p role="status">Memuat riwayat perubahan…</p>
                          )}
                          {historyErrors[record.id] && (
                            <div role="alert">
                              <p>
                                Riwayat belum dapat dimuat:{" "}
                                {historyErrors[record.id]}
                              </p>
                              <button
                                type="button"
                                disabled={Boolean(historyLoading[record.id])}
                                onClick={() => void loadHistory(record.id)}
                              >
                                Coba lagi
                              </button>
                            </div>
                          )}
                          {history[record.id] && (
                            <>
                              <p className="waste-history-creator">
                                Dicatat oleh {history[record.id]?.createdByName}
                              </p>
                              <ol className="waste-history-list">
                                {history[record.id]?.history.map(
                                  (entry, index) => (
                                    <li
                                      key={`${entry.toStatus}-${entry.changedAt}-${index}`}
                                    >
                                      <time dateTime={entry.changedAt}>
                                        {formatHistoryTime(entry.changedAt)}
                                      </time>
                                      <strong>
                                        {entry.fromStatus
                                          ? `${statusLabel[entry.fromStatus]} → ${statusLabel[entry.toStatus]}`
                                          : `Catatan dibuat · ${statusLabel[entry.toStatus]}`}
                                      </strong>
                                      <span className="waste-history-actor">
                                        oleh {entry.changedByName}
                                      </span>
                                      {entry.reason && (
                                        <small>Tujuan: {entry.reason}</small>
                                      )}
                                    </li>
                                  ),
                                )}
                              </ol>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="waste-actions">
                      {record.status === "RECORDED" && (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void transition(record, "PROCESSING")
                            }
                          >
                            Mulai proses
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void transition(record, "PROCESSED")}
                          >
                            Tandai diproses
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void transition(record, "DISPOSED")}
                          >
                            Tandai dibuang
                          </button>
                        </>
                      )}
                      {record.status === "PROCESSING" && (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void transition(record, "PROCESSED")}
                          >
                            Selesaikan proses
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void transition(record, "DISPOSED")}
                          >
                            Tandai dibuang
                          </button>
                        </>
                      )}
                      {record.status === "PROCESSED" && (
                        <>
                          <FormField
                            id={`waste-usage-${record.id}`}
                            label="Tujuan penggunaan kembali"
                          >
                            <input
                              id={`waste-usage-${record.id}`}
                              value={usage[record.id] ?? ""}
                              maxLength={300}
                              onChange={(event) => {
                                setUsage((previous) => ({
                                  ...previous,
                                  [record.id]: event.target.value,
                                }));
                                setActionKeys((previous) => ({
                                  ...previous,
                                  [`${record.id}:REUSED`]: crypto.randomUUID(),
                                }));
                              }}
                            />
                          </FormField>
                          <button
                            type="button"
                            disabled={pending || !usage[record.id]?.trim()}
                            onClick={() => void transition(record, "REUSED")}
                          >
                            Catat digunakan kembali
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => void transition(record, "DISPOSED")}
                          >
                            Tandai dibuang
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </Card>
          </div>
          <Card title="Catat limbah" className="form-card">
            <form onSubmit={create}>
              <FormField id="waste-source" label="Sumber limbah">
                <input
                  id="waste-source"
                  required
                  maxLength={200}
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value);
                    setCreateKey(crypto.randomUUID());
                  }}
                />
              </FormField>
              <div className="inventory-fields">
                <FormField id="waste-quantity" label="Jumlah">
                  <input
                    id="waste-quantity"
                    type="number"
                    min="0.001"
                    step="0.001"
                    required
                    value={quantity}
                    onChange={(event) => {
                      setQuantity(event.target.value);
                      setCreateKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                <FormField id="waste-unit" label="Satuan">
                  <select
                    id="waste-unit"
                    value={unit}
                    onChange={(event) => {
                      setUnit(event.target.value as (typeof units)[number]);
                      setCreateKey(crypto.randomUUID());
                    }}
                  >
                    {units.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </FormField>
              </div>
              <FormField id="waste-date" label="Tanggal">
                <input
                  id="waste-date"
                  type="date"
                  required
                  value={wasteDate}
                  onChange={(event) => {
                    setWasteDate(event.target.value);
                    setCreateKey(crypto.randomUUID());
                  }}
                />
              </FormField>
              <FormField id="waste-notes" label="Catatan (opsional)">
                <textarea
                  id="waste-notes"
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    setCreateKey(crypto.randomUUID());
                  }}
                />
              </FormField>
              <div className="actions">
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Simpan catatan"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
