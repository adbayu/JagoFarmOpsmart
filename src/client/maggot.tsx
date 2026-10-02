import { useEffect, useState, type FormEvent } from "react";
import type {
  MaggotBatchDetail,
  MaggotBatchSummary,
} from "../modules/maggot/contracts.js";
import type { CircularFeedLotOption } from "../modules/circular/contracts.js";
import type { WasteSummary } from "../modules/waste/contracts.js";
import { units, type Unit } from "../shared/domain.js";
import {
  Card,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";

type BatchDraft = { startedOn: string; media: string; notes: string };
type InputDraft = { wasteId: string; quantity: string };
type ObservationDraft = { observedAt: string; observation: string };
type OutputDraft = {
  harvestedAt: string;
  quantity: string;
  unit: Unit;
  notes: string;
};
type UseDraft = { quantity: string; purpose: string };
type PostingDraft = { lotId: string; quantity: string; reason: string };
type KeyEntry = { signature: string; value: string };

const today = () => new Date().toLocaleDateString("en-CA");
const localDateTime = () => {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};
const asUtc = (value: string) => new Date(value).toISOString();

export function MaggotPage({ state }: { state: ReturnType<typeof useFarms> }) {
  const farmId = state.activeId;
  const [batches, setBatches] = useState<MaggotBatchDetail[]>([]);
  const [wastes, setWastes] = useState<WasteSummary[]>([]);
  const [feedLots, setFeedLots] = useState<CircularFeedLotOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [keys, setKeys] = useState<Record<string, KeyEntry>>({});
  const [batchDraft, setBatchDraft] = useState<BatchDraft>({
    startedOn: today(),
    media: "",
    notes: "",
  });
  const [inputDrafts, setInputDrafts] = useState<Record<string, InputDraft>>(
    {},
  );
  const [observationDrafts, setObservationDrafts] = useState<
    Record<string, ObservationDraft>
  >({});
  const [outputDrafts, setOutputDrafts] = useState<Record<string, OutputDraft>>(
    {},
  );
  const [useDrafts, setUseDrafts] = useState<Record<string, UseDraft>>({});
  const [postingDrafts, setPostingDrafts] = useState<
    Record<string, PostingDraft>
  >({});
  const [completionNotes, setCompletionNotes] = useState<
    Record<string, string>
  >({});
  const [nowLocal] = useState(localDateTime);

  useEffect(() => {
    if (state.loading) return;
    if (!farmId) {
      setBatches([]);
      setWastes([]);
      setFeedLots([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let current = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      request<MaggotBatchSummary[]>(`/api/farms/${farmId}/maggot/batches`),
      request<WasteSummary[]>(`/api/farms/${farmId}/waste`),
      request<CircularFeedLotOption[]>(
        `/api/farms/${farmId}/circular/feed-lots`,
      ),
    ])
      .then(async ([summaries, wasteRecords, availableFeedLots]) => {
        const details = await Promise.all(
          summaries.map((batch) =>
            request<MaggotBatchDetail>(
              `/api/farms/${farmId}/maggot/batches/${batch.id}`,
            ),
          ),
        );
        if (current) {
          setBatches(details);
          setWastes(wasteRecords);
          setFeedLots(availableFeedLots);
        }
      })
      .catch((cause) => {
        if (current)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Data batch maggot gagal dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, revision]);

  async function mutate(
    actionId: string,
    path: string,
    body: Record<string, string>,
  ): Promise<boolean> {
    if (!farmId || pending) return false;
    const signature = JSON.stringify(body);
    const existing = keys[actionId];
    const idempotencyKey =
      existing?.signature === signature ? existing.value : crypto.randomUUID();
    setKeys((previous) => ({
      ...previous,
      [actionId]: { signature, value: idempotencyKey },
    }));
    setPending(true);
    setActionError(null);
    try {
      await request(path, "POST", { ...body, idempotencyKey });
      setKeys((previous) => {
        const next = { ...previous };
        delete next[actionId];
        return next;
      });
      setRevision((value) => value + 1);
      return true;
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Perubahan batch maggot gagal disimpan.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId) return;
    const created = await mutate(
      "batch:create",
      `/api/farms/${farmId}/maggot/batches`,
      {
        startedOn: batchDraft.startedOn,
        media: batchDraft.media,
        ...(batchDraft.notes.trim() ? { notes: batchDraft.notes } : {}),
      },
    );
    if (created) {
      setBatchDraft({ startedOn: today(), media: "", notes: "" });
    }
  }

  const usableWaste = wastes.filter(
    (waste) => waste.status !== "REUSED" && waste.status !== "DISPOSED",
  );

  return (
    <>
      <PageHeader
        eyebrow="Operasional"
        title="Batch maggot"
        visual="crop"
        description="Telusuri input limbah, observasi, hasil panen, pemakaian, dan sisa per batch."
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih atau buat farm untuk mulai mencatat batch maggot.
        </StatePanel>
      )}
      {farmId && (
        <>
          {loadError && (
            <StatePanel
              kind="error"
              title="Data batch belum dapat dimuat"
              onRetry={() => setRevision((value) => value + 1)}
            >
              {loadError}
            </StatePanel>
          )}
          {actionError && (
            <StatePanel kind="error" title="Perubahan belum tersimpan">
              {actionError} Isian dan kunci retry tetap dipertahankan.
            </StatePanel>
          )}
          <div className="maggot-layout">
            <div className="maggot-batch-list">
              <Card title="Batch tercatat">
                <p className="list-meta">
                  Hasil batch tetap terpisah dari stok sampai diposting secara
                  eksplisit ke lot pakan dengan satuan yang sama.
                </p>
                {loading && (
                  <StatePanel kind="loading" title="Memuat batch maggot">
                    Mengambil catatan dari farm aktif.
                  </StatePanel>
                )}
                {!loading && !loadError && batches.length === 0 && (
                  <StatePanel kind="empty" title="Belum ada batch maggot">
                    Buat batch untuk mulai mencatat input dan hasil.
                  </StatePanel>
                )}
                <div className="maggot-batches" aria-busy={loading}>
                  {batches.map((batch) => (
                    <article className="maggot-batch" key={batch.id}>
                      <header className="maggot-batch-heading">
                        <div>
                          <h3>{batch.media}</h3>
                          <p>Mulai {batch.startedOn}</p>
                        </div>
                        <span
                          className={`maggot-status ${batch.status.toLowerCase()}`}
                        >
                          {batch.status === "OPEN" ? "Berjalan" : "Selesai"}
                        </span>
                      </header>
                      {batch.notes && <p>{batch.notes}</p>}
                      <section className="maggot-record-section">
                        <h4>Input limbah</h4>
                        {batch.inputs.length === 0 ? (
                          <p>Belum ada input tercatat.</p>
                        ) : (
                          <ul>
                            {batch.inputs.map((input) => (
                              <li key={input.id}>
                                {input.source}: {input.quantity} {input.unit};
                                sisa sumber {input.remainingQuantity}{" "}
                                {input.unit}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                      <section className="maggot-record-section">
                        <h4>Observasi</h4>
                        {batch.observations.length === 0 ? (
                          <p>Belum ada observasi.</p>
                        ) : (
                          <ul>
                            {batch.observations.map((item) => (
                              <li key={item.id}>
                                <time dateTime={item.observedAt}>
                                  {new Date(item.observedAt).toLocaleString(
                                    "id-ID",
                                  )}
                                </time>
                                : {item.observation}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                      <section className="maggot-record-section">
                        <h4>Hasil dan pemakaian</h4>
                        {batch.outputs.length === 0 ? (
                          <p>Belum ada hasil panen tercatat.</p>
                        ) : (
                          <div className="maggot-output-list">
                            {batch.outputs.map((output) => (
                              <div className="maggot-output" key={output.id}>
                                <div>
                                  <strong>
                                    {output.quantity} {output.unit}
                                  </strong>
                                  <span>
                                    Sisa {output.remainingQuantity}{" "}
                                    {output.unit}
                                  </span>
                                </div>
                                {output.notes && <p>{output.notes}</p>}
                                {output.uses.length > 0 && (
                                  <ul>
                                    {output.uses.map((use) => (
                                      <li key={use.id}>
                                        {use.quantity} {output.unit} —{" "}
                                        {use.purpose}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {output.postings.length > 0 && (
                                  <ul>
                                    {output.postings.map((posting) => (
                                      <li key={posting.id}>
                                        Diposting {posting.quantity}{" "}
                                        {posting.unit} ke {posting.itemName} ·{" "}
                                        {posting.lotLabel}: {posting.reason}{" "}
                                        (pergerakan {posting.movementId})
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {batch.status === "OPEN" && (
                                  <form
                                    className="maggot-inline-form"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      const draft = useDrafts[output.id] ?? {
                                        quantity: "",
                                        purpose: "",
                                      };
                                      void mutate(
                                        `use:${output.id}`,
                                        `/api/farms/${farmId}/maggot/batches/${batch.id}/outputs/${output.id}/uses`,
                                        draft,
                                      );
                                    }}
                                  >
                                    <FormField
                                      id={`maggot-use-quantity-${output.id}`}
                                      label={`Jumlah dipakai (${output.unit})`}
                                    >
                                      <input
                                        id={`maggot-use-quantity-${output.id}`}
                                        type="number"
                                        min="0.001"
                                        step="0.001"
                                        required
                                        value={
                                          useDrafts[output.id]?.quantity ?? ""
                                        }
                                        onChange={(event) =>
                                          setUseDrafts((previous) => ({
                                            ...previous,
                                            [output.id]: {
                                              quantity: event.target.value,
                                              purpose:
                                                previous[output.id]?.purpose ??
                                                "",
                                            },
                                          }))
                                        }
                                      />
                                    </FormField>
                                    <FormField
                                      id={`maggot-use-purpose-${output.id}`}
                                      label="Tujuan pemakaian"
                                    >
                                      <input
                                        id={`maggot-use-purpose-${output.id}`}
                                        required
                                        maxLength={300}
                                        value={
                                          useDrafts[output.id]?.purpose ?? ""
                                        }
                                        onChange={(event) =>
                                          setUseDrafts((previous) => ({
                                            ...previous,
                                            [output.id]: {
                                              quantity:
                                                previous[output.id]?.quantity ??
                                                "",
                                              purpose: event.target.value,
                                            },
                                          }))
                                        }
                                      />
                                    </FormField>
                                    <button type="submit" disabled={pending}>
                                      Catat pemakaian
                                    </button>
                                  </form>
                                )}
                                {batch.status === "COMPLETED" &&
                                  Number(output.remainingQuantity) > 0 &&
                                  (feedLots.filter(
                                    (lot) => lot.unit === output.unit,
                                  ).length === 0 ? (
                                    <p>
                                      Belum ada lot persediaan kategori Pakan
                                      dengan satuan {output.unit}. Buat item dan
                                      lot pakan di menu Persediaan terlebih
                                      dahulu.
                                    </p>
                                  ) : (
                                    <form
                                      className="maggot-inline-form"
                                      onSubmit={(event) => {
                                        event.preventDefault();
                                        const draft = postingDrafts[
                                          output.id
                                        ] ?? {
                                          lotId:
                                            feedLots.find(
                                              (lot) => lot.unit === output.unit,
                                            )?.lotId ?? "",
                                          quantity: "",
                                          reason: "",
                                        };
                                        void mutate(
                                          `posting:${output.id}`,
                                          `/api/farms/${farmId}/circular/maggot-postings`,
                                          {
                                            batchId: batch.id,
                                            outputId: output.id,
                                            ...draft,
                                          },
                                        );
                                      }}
                                    >
                                      <FormField
                                        id={`maggot-post-lot-${output.id}`}
                                        label="Lot pakan tujuan"
                                      >
                                        <select
                                          id={`maggot-post-lot-${output.id}`}
                                          required
                                          value={
                                            postingDrafts[output.id]?.lotId ??
                                            feedLots.find(
                                              (lot) => lot.unit === output.unit,
                                            )?.lotId ??
                                            ""
                                          }
                                          onChange={(event) =>
                                            setPostingDrafts((previous) => ({
                                              ...previous,
                                              [output.id]: {
                                                lotId: event.target.value,
                                                quantity:
                                                  previous[output.id]
                                                    ?.quantity ?? "",
                                                reason:
                                                  previous[output.id]?.reason ??
                                                  "",
                                              },
                                            }))
                                          }
                                        >
                                          {feedLots
                                            .filter(
                                              (lot) => lot.unit === output.unit,
                                            )
                                            .map((lot) => (
                                              <option
                                                key={lot.lotId}
                                                value={lot.lotId}
                                              >
                                                {lot.itemName} · {lot.label} (
                                                {lot.quantity} {lot.unit}{" "}
                                                tersedia)
                                              </option>
                                            ))}
                                        </select>
                                      </FormField>
                                      <FormField
                                        id={`maggot-post-quantity-${output.id}`}
                                        label={`Jumlah posting (${output.unit})`}
                                      >
                                        <input
                                          id={`maggot-post-quantity-${output.id}`}
                                          type="number"
                                          min="0.001"
                                          step="0.001"
                                          required
                                          value={
                                            postingDrafts[output.id]
                                              ?.quantity ?? ""
                                          }
                                          onChange={(event) =>
                                            setPostingDrafts((previous) => ({
                                              ...previous,
                                              [output.id]: {
                                                lotId:
                                                  previous[output.id]?.lotId ??
                                                  feedLots.find(
                                                    (lot) =>
                                                      lot.unit === output.unit,
                                                  )?.lotId ??
                                                  "",
                                                quantity: event.target.value,
                                                reason:
                                                  previous[output.id]?.reason ??
                                                  "",
                                              },
                                            }))
                                          }
                                        />
                                      </FormField>
                                      <FormField
                                        id={`maggot-post-reason-${output.id}`}
                                        label="Alasan posting"
                                      >
                                        <input
                                          id={`maggot-post-reason-${output.id}`}
                                          required
                                          maxLength={500}
                                          value={
                                            postingDrafts[output.id]?.reason ??
                                            ""
                                          }
                                          onChange={(event) =>
                                            setPostingDrafts((previous) => ({
                                              ...previous,
                                              [output.id]: {
                                                lotId:
                                                  previous[output.id]?.lotId ??
                                                  feedLots.find(
                                                    (lot) =>
                                                      lot.unit === output.unit,
                                                  )?.lotId ??
                                                  "",
                                                quantity:
                                                  previous[output.id]
                                                    ?.quantity ?? "",
                                                reason: event.target.value,
                                              },
                                            }))
                                          }
                                        />
                                      </FormField>
                                      <button type="submit" disabled={pending}>
                                        Posting ke stok pakan
                                      </button>
                                    </form>
                                  ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                      {batch.completionNote && (
                        <p className="maggot-completion">
                          Catatan penyelesaian: {batch.completionNote}
                        </p>
                      )}
                      {batch.status === "OPEN" && (
                        <div className="maggot-forms-grid">
                          <form
                            className="maggot-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const draft = inputDrafts[batch.id] ?? {
                                wasteId: usableWaste[0]?.id ?? "",
                                quantity: "",
                              };
                              void mutate(
                                `input:${batch.id}`,
                                `/api/farms/${farmId}/maggot/batches/${batch.id}/inputs`,
                                draft,
                              );
                            }}
                          >
                            <h4>Tambah input limbah</h4>
                            <FormField
                              id={`maggot-waste-${batch.id}`}
                              label="Catatan sumber"
                            >
                              <select
                                id={`maggot-waste-${batch.id}`}
                                required
                                value={
                                  inputDrafts[batch.id]?.wasteId ??
                                  usableWaste[0]?.id ??
                                  ""
                                }
                                onChange={(event) =>
                                  setInputDrafts((previous) => ({
                                    ...previous,
                                    [batch.id]: {
                                      wasteId: event.target.value,
                                      quantity:
                                        previous[batch.id]?.quantity ?? "",
                                    },
                                  }))
                                }
                              >
                                <option value="" disabled>
                                  Pilih catatan limbah
                                </option>
                                {usableWaste.map((waste) => (
                                  <option key={waste.id} value={waste.id}>
                                    {waste.source} — {waste.quantity}{" "}
                                    {waste.unit} ({waste.status})
                                  </option>
                                ))}
                              </select>
                            </FormField>
                            <FormField
                              id={`maggot-input-quantity-${batch.id}`}
                              label="Jumlah input"
                            >
                              <input
                                id={`maggot-input-quantity-${batch.id}`}
                                type="number"
                                min="0.001"
                                step="0.001"
                                required
                                value={inputDrafts[batch.id]?.quantity ?? ""}
                                onChange={(event) =>
                                  setInputDrafts((previous) => ({
                                    ...previous,
                                    [batch.id]: {
                                      wasteId:
                                        previous[batch.id]?.wasteId ??
                                        usableWaste[0]?.id ??
                                        "",
                                      quantity: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </FormField>
                            <p className="list-meta">
                              Satuan mengikuti catatan limbah; konversi tidak
                              dilakukan.
                            </p>
                            <button
                              type="submit"
                              disabled={pending || usableWaste.length === 0}
                            >
                              Tambah input
                            </button>
                          </form>
                          <form
                            className="maggot-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const draft = observationDrafts[batch.id] ?? {
                                observedAt: nowLocal,
                                observation: "",
                              };
                              void mutate(
                                `observation:${batch.id}`,
                                `/api/farms/${farmId}/maggot/batches/${batch.id}/observations`,
                                {
                                  ...draft,
                                  observedAt: asUtc(draft.observedAt),
                                },
                              );
                            }}
                          >
                            <h4>Catat observasi pertumbuhan</h4>
                            <FormField
                              id={`maggot-observed-at-${batch.id}`}
                              label="Waktu pengamatan"
                            >
                              <input
                                id={`maggot-observed-at-${batch.id}`}
                                type="datetime-local"
                                required
                                value={
                                  observationDrafts[batch.id]?.observedAt ??
                                  nowLocal
                                }
                                onChange={(event) =>
                                  setObservationDrafts((previous) => ({
                                    ...previous,
                                    [batch.id]: {
                                      observedAt: event.target.value,
                                      observation:
                                        previous[batch.id]?.observation ?? "",
                                    },
                                  }))
                                }
                              />
                            </FormField>
                            <FormField
                              id={`maggot-observation-${batch.id}`}
                              label="Catatan pertumbuhan"
                            >
                              <textarea
                                id={`maggot-observation-${batch.id}`}
                                required
                                maxLength={1000}
                                rows={2}
                                value={
                                  observationDrafts[batch.id]?.observation ?? ""
                                }
                                onChange={(event) =>
                                  setObservationDrafts((previous) => ({
                                    ...previous,
                                    [batch.id]: {
                                      observedAt:
                                        previous[batch.id]?.observedAt ??
                                        nowLocal,
                                      observation: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </FormField>
                            <button type="submit" disabled={pending}>
                              Simpan observasi
                            </button>
                          </form>
                          <form
                            className="maggot-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const draft = outputDrafts[batch.id] ?? {
                                harvestedAt: nowLocal,
                                quantity: "",
                                unit: "KG" as Unit,
                                notes: "",
                              };
                              void mutate(
                                `output:${batch.id}`,
                                `/api/farms/${farmId}/maggot/batches/${batch.id}/outputs`,
                                {
                                  harvestedAt: asUtc(draft.harvestedAt),
                                  quantity: draft.quantity,
                                  unit: draft.unit,
                                  ...(draft.notes.trim()
                                    ? { notes: draft.notes }
                                    : {}),
                                },
                              );
                            }}
                          >
                            <h4>Catat hasil panen</h4>
                            <FormField
                              id={`maggot-harvested-at-${batch.id}`}
                              label="Waktu panen"
                            >
                              <input
                                id={`maggot-harvested-at-${batch.id}`}
                                type="datetime-local"
                                required
                                value={
                                  outputDrafts[batch.id]?.harvestedAt ??
                                  nowLocal
                                }
                                onChange={(event) =>
                                  setOutputDrafts((previous) => ({
                                    ...previous,
                                    [batch.id]: {
                                      harvestedAt: event.target.value,
                                      quantity:
                                        previous[batch.id]?.quantity ?? "",
                                      unit: previous[batch.id]?.unit ?? "KG",
                                      notes: previous[batch.id]?.notes ?? "",
                                    },
                                  }))
                                }
                              />
                            </FormField>
                            <div className="inventory-fields">
                              <FormField
                                id={`maggot-output-quantity-${batch.id}`}
                                label="Jumlah"
                              >
                                <input
                                  id={`maggot-output-quantity-${batch.id}`}
                                  type="number"
                                  min="0.001"
                                  step="0.001"
                                  required
                                  value={outputDrafts[batch.id]?.quantity ?? ""}
                                  onChange={(event) =>
                                    setOutputDrafts((previous) => ({
                                      ...previous,
                                      [batch.id]: {
                                        harvestedAt:
                                          previous[batch.id]?.harvestedAt ??
                                          nowLocal,
                                        quantity: event.target.value,
                                        unit: previous[batch.id]?.unit ?? "KG",
                                        notes: previous[batch.id]?.notes ?? "",
                                      },
                                    }))
                                  }
                                />
                              </FormField>
                              <FormField
                                id={`maggot-output-unit-${batch.id}`}
                                label="Satuan hasil"
                              >
                                <select
                                  id={`maggot-output-unit-${batch.id}`}
                                  value={outputDrafts[batch.id]?.unit ?? "KG"}
                                  onChange={(event) =>
                                    setOutputDrafts((previous) => ({
                                      ...previous,
                                      [batch.id]: {
                                        harvestedAt:
                                          previous[batch.id]?.harvestedAt ??
                                          nowLocal,
                                        quantity:
                                          previous[batch.id]?.quantity ?? "",
                                        unit: event.target.value as Unit,
                                        notes: previous[batch.id]?.notes ?? "",
                                      },
                                    }))
                                  }
                                >
                                  {units.map((unit) => (
                                    <option key={unit}>{unit}</option>
                                  ))}
                                </select>
                              </FormField>
                            </div>
                            <FormField
                              id={`maggot-output-notes-${batch.id}`}
                              label="Catatan hasil (opsional)"
                            >
                              <input
                                id={`maggot-output-notes-${batch.id}`}
                                maxLength={1000}
                                value={outputDrafts[batch.id]?.notes ?? ""}
                                onChange={(event) =>
                                  setOutputDrafts((previous) => ({
                                    ...previous,
                                    [batch.id]: {
                                      harvestedAt:
                                        previous[batch.id]?.harvestedAt ??
                                        nowLocal,
                                      quantity:
                                        previous[batch.id]?.quantity ?? "",
                                      unit: previous[batch.id]?.unit ?? "KG",
                                      notes: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </FormField>
                            <button type="submit" disabled={pending}>
                              Simpan hasil
                            </button>
                          </form>
                          <form
                            className="maggot-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const completionNote =
                                completionNotes[batch.id] ?? "";
                              void mutate(
                                `complete:${batch.id}`,
                                `/api/farms/${farmId}/maggot/batches/${batch.id}/complete`,
                                { expectedStatus: "OPEN", completionNote },
                              );
                            }}
                          >
                            <h4>Tutup batch</h4>
                            <FormField
                              id={`maggot-completion-note-${batch.id}`}
                              label="Catatan penyelesaian"
                            >
                              <textarea
                                id={`maggot-completion-note-${batch.id}`}
                                required
                                maxLength={1000}
                                rows={2}
                                value={completionNotes[batch.id] ?? ""}
                                onChange={(event) =>
                                  setCompletionNotes((previous) => ({
                                    ...previous,
                                    [batch.id]: event.target.value,
                                  }))
                                }
                              />
                            </FormField>
                            <button
                              type="submit"
                              className="button-secondary"
                              disabled={pending || batch.inputs.length === 0}
                            >
                              Selesaikan batch
                            </button>
                          </form>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </Card>
            </div>
            <Card title="Buat batch" className="form-card">
              <form
                onSubmit={(event) => {
                  void createBatch(event);
                }}
              >
                <FormField id="maggot-started-on" label="Tanggal mulai">
                  <input
                    id="maggot-started-on"
                    type="date"
                    required
                    value={batchDraft.startedOn}
                    onChange={(event) =>
                      setBatchDraft((previous) => ({
                        ...previous,
                        startedOn: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField id="maggot-media" label="Media">
                  <input
                    id="maggot-media"
                    required
                    maxLength={200}
                    value={batchDraft.media}
                    onChange={(event) =>
                      setBatchDraft((previous) => ({
                        ...previous,
                        media: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField id="maggot-notes" label="Catatan (opsional)">
                  <textarea
                    id="maggot-notes"
                    rows={3}
                    maxLength={2000}
                    value={batchDraft.notes}
                    onChange={(event) =>
                      setBatchDraft((previous) => ({
                        ...previous,
                        notes: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Buat batch"}
                </button>
              </form>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
