import { useEffect, useState, type FormEvent } from "react";
import type {
  WaterTransferSummary,
  WaterTransferUnitOption,
} from "../modules/circular/contracts.js";
import {
  Card,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";

type Draft = {
  sourceUnitId: string;
  targetUnitId: string;
  quantityLiters: string;
  transferDate: string;
  note: string;
};

const today = () => new Date().toLocaleDateString("en-CA");
const emptyDraft = (): Draft => ({
  sourceUnitId: "",
  targetUnitId: "",
  quantityLiters: "",
  transferDate: today(),
  note: "",
});

function localDateTime(value: string) {
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function WaterTransferPage({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const [fishUnits, setFishUnits] = useState<WaterTransferUnitOption[]>([]);
  const [cropUnits, setCropUnits] = useState<WaterTransferUnitOption[]>([]);
  const [transfers, setTransfers] = useState<WaterTransferSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [retryKey, setRetryKey] = useState<{
    signature: string;
    value: string;
  } | null>(null);

  useEffect(() => {
    if (state.loading) return;
    if (!farmId) {
      setFishUnits([]);
      setCropUnits([]);
      setTransfers([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let current = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      request<WaterTransferUnitOption[]>(
        `/api/farms/${farmId}/circular/water-transfer-units/fish`,
      ),
      request<WaterTransferUnitOption[]>(
        `/api/farms/${farmId}/circular/water-transfer-units/crop`,
      ),
      request<WaterTransferSummary[]>(
        `/api/farms/${farmId}/circular/water-transfers`,
      ),
    ])
      .then(([fish, crops, rows]) => {
        if (current) {
          setFishUnits(fish);
          setCropUnits(crops);
          setTransfers(rows);
          setDraft((previous) => ({
            ...previous,
            sourceUnitId: fish.some((unit) => unit.id === previous.sourceUnitId)
              ? previous.sourceUnitId
              : (fish[0]?.id ?? ""),
            targetUnitId: crops.some(
              (unit) => unit.id === previous.targetUnitId,
            )
              ? previous.targetUnitId
              : (crops[0]?.id ?? ""),
          }));
        }
      })
      .catch((cause) => {
        if (current)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Catatan transfer air gagal dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, revision]);

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || pending) return;
    const body = {
      sourceUnitId: draft.sourceUnitId,
      targetUnitId: draft.targetUnitId,
      quantityLiters: draft.quantityLiters,
      transferDate: draft.transferDate,
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    };
    const signature = JSON.stringify(body);
    const idempotencyKey =
      retryKey?.signature === signature ? retryKey.value : crypto.randomUUID();
    setRetryKey({ signature, value: idempotencyKey });
    setPending(true);
    setActionError(null);
    try {
      await request(`/api/farms/${farmId}/circular/water-transfers`, "POST", {
        ...body,
        idempotencyKey,
      });
      setRetryKey(null);
      setDraft({
        ...emptyDraft(),
        sourceUnitId: body.sourceUnitId,
        targetUnitId: body.targetUnitId,
      });
      setRevision((value) => value + 1);
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Transfer air belum berhasil dicatat.",
      );
    } finally {
      setPending(false);
    }
  }

  const hasUnits = fishUnits.length > 0 && cropUnits.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Operasional · Sirkular"
        title="Air kolam ke area tanam"
        visual="crop"
        description="Catat pemindahan air kolam ke area tanam berdasarkan jumlah liter yang Anda ukur."
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih atau buat farm untuk mulai mencatat transfer air.
        </StatePanel>
      )}
      {farmId && (
        <div className="water-transfer-layout">
          <Card title="Catat transfer" className="form-card">
            <p className="list-meta">
              Catatan ini hanya merekam perpindahan air secara manual. Jumlah
              persediaan dan biaya tidak berubah.
            </p>
            {actionError && (
              <StatePanel kind="error" title="Transfer belum tersimpan">
                {actionError} Isian dan kunci retry tetap tersedia.
              </StatePanel>
            )}
            {!loading && !loadError && !hasUnits && (
              <StatePanel
                kind="empty"
                title="Unit sumber atau tujuan belum tersedia"
              >
                Buat setidaknya satu kolam aktif di menu Ikan dan satu area
                tanam aktif di menu Tanaman.
              </StatePanel>
            )}
            <form className="water-transfer-form" onSubmit={createTransfer}>
              <FormField id="water-source" label="Kolam sumber">
                <select
                  id="water-source"
                  required
                  disabled={!hasUnits || pending}
                  value={draft.sourceUnitId}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      sourceUnitId: event.target.value,
                    }))
                  }
                >
                  {fishUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="water-target" label="Area tanam tujuan">
                <select
                  id="water-target"
                  required
                  disabled={!hasUnits || pending}
                  value={draft.targetUnitId}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      targetUnitId: event.target.value,
                    }))
                  }
                >
                  {cropUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="water-quantity" label="Jumlah air (liter)">
                <input
                  id="water-quantity"
                  type="number"
                  min="0.001"
                  step="0.001"
                  required
                  disabled={!hasUnits || pending}
                  value={draft.quantityLiters}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      quantityLiters: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField id="water-date" label="Tanggal transfer">
                <input
                  id="water-date"
                  type="date"
                  required
                  disabled={!hasUnits || pending}
                  value={draft.transferDate}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      transferDate: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField id="water-note" label="Catatan (opsional)">
                <textarea
                  id="water-note"
                  rows={3}
                  maxLength={500}
                  disabled={!hasUnits || pending}
                  value={draft.note}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      note: event.target.value,
                    }))
                  }
                />
              </FormField>
              <button type="submit" disabled={!hasUnits || pending || loading}>
                {pending ? "Menyimpan…" : "Catat transfer air"}
              </button>
            </form>
          </Card>

          <Card title="Riwayat transfer air">
            {loadError && (
              <StatePanel
                kind="error"
                title="Riwayat belum dapat dimuat"
                onRetry={() => setRevision((value) => value + 1)}
              >
                {loadError}
              </StatePanel>
            )}
            {loading && (
              <StatePanel kind="loading" title="Memuat riwayat">
                Mengambil catatan dari farm aktif.
              </StatePanel>
            )}
            {!loading && !loadError && (
              <DataTable
                caption="Transfer air yang tercatat, terbaru lebih dahulu"
                rows={transfers}
                rowKey={(row) => row.id}
                emptyMessage="Belum ada transfer air yang tercatat."
                columns={[
                  {
                    key: "transfer",
                    label: "Transfer",
                    render: (row) => (
                      <>
                        <strong>{row.sourceUnitName}</strong>
                        <span aria-hidden="true"> → </span>
                        <strong>{row.targetUnitName}</strong>
                        {row.note && (
                          <small className="water-transfer-note">
                            {row.note}
                          </small>
                        )}
                      </>
                    ),
                  },
                  {
                    key: "quantity",
                    label: "Jumlah",
                    render: (row) => `${row.quantityLiters} liter`,
                  },
                  {
                    key: "date",
                    label: "Tanggal",
                    render: (row) => row.transferDate,
                  },
                  {
                    key: "actor",
                    label: "Dicatat oleh",
                    render: (row) => (
                      <>
                        {row.createdByName}
                        <small className="water-transfer-note">
                          {localDateTime(row.createdAt)}
                        </small>
                      </>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}
    </>
  );
}
