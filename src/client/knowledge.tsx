import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Card,
  ConfirmDialog,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { getCsrfToken } from "./auth-api.js";
import { request, useFarms } from "./farms.js";
import type { KnowledgeSourceSummary } from "../modules/knowledge/contracts.js";

const dateOnly = (date: Date) => date.toLocaleDateString("en-CA");
const today = () => dateOnly(new Date());
const reviewDefault = (after = today()) => {
  const date = new Date(`${after}T00:00:00.000Z`);
  date.setFullYear(date.getFullYear() + 1);
  return dateOnly(date);
};
const dayAfter = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const dateTime = (value: string) =>
  new Date(`${value}T00:00:00.000Z`).toISOString();
const prettyDate = (value: string) =>
  new Date(value).toLocaleDateString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
const prettyDateTime = (value: string) =>
  new Date(value).toLocaleString("id-ID", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const statusLabel = {
  PENDING_REVIEW: "Menunggu tinjauan",
  ACTIVE: "Disetujui",
  REVOKED: "Dicabut",
  EXPIRED: "Kedaluwarsa",
} as const;

async function uploadFile(
  farmId: string,
  sourceId: string,
  file: File,
  key: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `/api/farms/${farmId}/knowledge/sources/${sourceId}/file`,
      {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-csrf-token": getCsrfToken() ?? "",
          "idempotency-key": key,
          "x-source-file-name": encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
      },
    );
  } catch {
    throw new Error("Layanan farm belum tersedia. Coba lagi nanti.");
  }
  let result: { data?: KnowledgeSourceSummary; error?: { message: string } };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw new Error("Layanan farm belum tersedia. Coba lagi nanti.");
  }
  if (response.status === 401)
    window.dispatchEvent(new Event("opsmart-auth-expired"));
  if (!response.ok || result.error)
    throw new Error(result.error?.message ?? "Unggah dokumen gagal.");
}

type FarmsState = ReturnType<typeof useFarms>;

export function KnowledgePage({ state }: { state: FarmsState }) {
  const farmId = state.activeId;
  const [sources, setSources] = useState<KnowledgeSourceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [scope, setScope] = useState<"SHARED" | "FARM">("FARM");
  const [title, setTitle] = useState("");
  const [publisher, setPublisher] = useState("");
  const [rightsEvidence, setRightsEvidence] = useState("");
  const [applicability, setApplicability] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [originalReference, setOriginalReference] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(today);
  const [reviewAt, setReviewAt] = useState(reviewDefault);
  const [file, setFile] = useState<File | null>(null);
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [fileKey, setFileKey] = useState(() => crypto.randomUUID());
  const [draftSourceId, setDraftSourceId] = useState<string | null>(null);
  const [actionKeys, setActionKeys] = useState<Record<string, string>>({});
  const [retryFiles, setRetryFiles] = useState<Record<string, File | undefined>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const reviewMin = dayAfter(effectiveAt > today() ? effectiveAt : today());

  const reload = useCallback(async () => {
    if (!farmId) {
      setSources([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await request<KnowledgeSourceSummary[]>(
        `/api/farms/${farmId}/knowledge/sources`,
      );
      setSources(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memuat sumber.");
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);

  const resetDraft = () => {
    setTitle("");
    setPublisher("");
    setRightsEvidence("");
    setApplicability("");
    setVersionLabel("");
    setOriginalReference("");
    setEffectiveAt(today());
    setReviewAt(reviewDefault());
    setFile(null);
    setDraftSourceId(null);
    setCreateKey(crypto.randomUUID());
    setFileKey(crypto.randomUUID());
  };

  const createSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!farmId || !file) {
      setActionError("Pilih farm dan lampirkan file PDF, Markdown, atau TXT.");
      return;
    }
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      let sourceId = draftSourceId;
      if (!sourceId) {
        const created = await request<KnowledgeSourceSummary>(
          `/api/farms/${farmId}/knowledge/sources`,
          "POST",
          {
            idempotencyKey: createKey,
            scope,
            title,
            publisher,
            rightsEvidence,
            applicability,
            versionLabel,
            originalReference,
            effectiveAt: dateTime(effectiveAt),
            reviewAt: dateTime(reviewAt),
          },
        );
        sourceId = created.id;
        setDraftSourceId(sourceId);
      }
      await uploadFile(farmId, sourceId, file, fileKey);
      setMessage("Sumber tersimpan sebagai menunggu tinjauan. Belum dipakai untuk jawaban AI.");
      resetDraft();
      setRevision((value) => value + 1);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Sumber belum berhasil disimpan.",
      );
    } finally {
      setPending(false);
    }
  };

  const runAction = async (
    sourceId: string,
    action: "approve" | "revoke",
  ) => {
    if (!farmId) return;
    const keyName = `${action}:${sourceId}`;
    const key = actionKeys[keyName] ?? crypto.randomUUID();
    setActionKeys((current) => ({ ...current, [keyName]: key }));
    setPending(true);
    setActionError(null);
    try {
      await request(
        `/api/farms/${farmId}/knowledge/sources/${sourceId}/${action}`,
        "POST",
        { idempotencyKey: key },
      );
      setActionKeys((current) => {
        const next = { ...current };
        delete next[keyName];
        return next;
      });
      setRevokeId(null);
      setMessage(
        action === "approve"
          ? "Persetujuan dicatat. Sumber masih belum diindeks atau dipakai untuk jawaban."
          : "Sumber dicabut dan langsung dikeluarkan dari penggunaan.",
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Perubahan belum berhasil disimpan.",
      );
    } finally {
      setPending(false);
    }
  };

  const retryFileUpload = async (sourceId: string) => {
    if (!farmId || !retryFiles[sourceId]) return;
    const keyName = `file:${sourceId}`;
    const key = actionKeys[keyName] ?? crypto.randomUUID();
    setActionKeys((current) => ({ ...current, [keyName]: key }));
    setPending(true);
    setActionError(null);
    try {
      await uploadFile(farmId, sourceId, retryFiles[sourceId]!, key);
      setActionKeys((current) => {
        const next = { ...current };
        delete next[keyName];
        return next;
      });
      setRetryFiles((current) => ({ ...current, [sourceId]: undefined }));
      setMessage("File tersimpan lokal. Sumber tetap menunggu tinjauan.");
      setRevision((value) => value + 1);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unggah dokumen gagal.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="RAG · SUMBER TERKURASI"
        title="Pusat Pengetahuan"
        description="Simpan SOP dan panduan dengan bukti hak pakai, cakupan, versi, serta masa tinjau yang jelas."
      />
      <div className="knowledge-gate" role="note">
        <span aria-hidden="true">i</span>
        <p>
          Dokumen disimpan di database OpSmart dan tidak dikirim ke provider
          eksternal. Anggota lain perlu meninjau dan menyetujui sumber yang
          diunggah. Persetujuan belum menyalakan ekstraksi, pencarian,
          indeks vektor, atau assistant.
        </p>
      </div>

      <div className="knowledge-layout">
        <Card title="Daftarkan sumber">
          <form className="knowledge-form" onSubmit={createSource}>
            <fieldset disabled={pending || !!draftSourceId || !farmId}>
              <FormField id="knowledge-scope" label="Cakupan sumber">
                <select
                  id="knowledge-scope"
                  value={scope}
                  onChange={(event) =>
                    setScope(event.target.value as "SHARED" | "FARM")
                  }
                >
                  <option value="FARM">Farm aktif saja</option>
                  <option value="SHARED">Dibagikan ke semua farm</option>
                </select>
              </FormField>
              <FormField id="knowledge-title" label="Judul dokumen">
                <input
                  id="knowledge-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  required
                />
              </FormField>
              <FormField id="knowledge-publisher" label="Pemilik atau penerbit">
                <input
                  id="knowledge-publisher"
                  value={publisher}
                  onChange={(event) => setPublisher(event.target.value)}
                  maxLength={200}
                  required
                />
              </FormField>
              <FormField id="knowledge-rights" label="Bukti hak pakai">
                <textarea
                  id="knowledge-rights"
                  value={rightsEvidence}
                  onChange={(event) => setRightsEvidence(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  required
                />
              </FormField>
              <FormField id="knowledge-applicability" label="Komoditas dan sistem yang berlaku">
                <textarea
                  id="knowledge-applicability"
                  value={applicability}
                  onChange={(event) => setApplicability(event.target.value)}
                  maxLength={1000}
                  rows={2}
                  required
                />
              </FormField>
              <div className="knowledge-fields-two">
                <FormField id="knowledge-version" label="Versi dokumen">
                  <input
                    id="knowledge-version"
                    value={versionLabel}
                    onChange={(event) => setVersionLabel(event.target.value)}
                    maxLength={100}
                    required
                  />
                </FormField>
                <FormField id="knowledge-effective" label="Mulai berlaku">
                  <input
                    id="knowledge-effective"
                    type="date"
                    value={effectiveAt}
                    onChange={(event) => {
                      setEffectiveAt(event.target.value);
                      setReviewAt(reviewDefault(event.target.value));
                    }}
                    required
                  />
                </FormField>
              </div>
              <FormField id="knowledge-reference" label="Lokasi atau referensi asli">
                <input
                  id="knowledge-reference"
                  value={originalReference}
                  onChange={(event) => setOriginalReference(event.target.value)}
                  maxLength={1000}
                  required
                />
              </FormField>
              <FormField id="knowledge-review" label="Tinjau atau kedaluwarsa pada">
                <input
                  id="knowledge-review"
                  type="date"
                  value={reviewAt}
                  min={reviewMin}
                  onChange={(event) => setReviewAt(event.target.value)}
                  required
                />
              </FormField>
              <FormField id="knowledge-file" label="File PDF, Markdown, atau TXT · maks. 5 MiB">
                <input
                  id="knowledge-file"
                  type="file"
                  accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setFileKey(crypto.randomUUID());
                  }}
                  required
                />
              </FormField>
            </fieldset>
            {draftSourceId && (
              <p className="knowledge-draft-note">
                Metadata sudah tersimpan. Gunakan file yang sama untuk mencoba
                ulang unggahan, atau cabut sumber yang belum lengkap.
              </p>
            )}
            {actionError && <p className="form-error" role="alert">{actionError}</p>}
            {message && <p className="form-success" role="status">{message}</p>}
            <button className="button-primary" type="submit" disabled={pending || !farmId || !file}>
              {pending ? "Menyimpan…" : draftSourceId ? "Coba ulang unggahan" : "Simpan sebagai menunggu tinjauan"}
            </button>
          </form>
        </Card>

        <Card title="Sumber terdaftar">
          {!farmId ? (
            <StatePanel kind="empty" title="Pilih farm terlebih dahulu">
              Pilih farm aktif di bagian atas untuk melihat sumber yang dibagikan
              ke semua farm dan sumber farm tersebut.
            </StatePanel>
          ) : loading ? (
            <StatePanel kind="loading" title="Memuat sumber…" />
          ) : error ? (
            <StatePanel kind="error" title="Sumber belum dapat dimuat" onRetry={() => void reload()}>
              {error}
            </StatePanel>
          ) : sources.length === 0 ? (
            <StatePanel kind="empty" title="Belum ada dokumen terdaftar">
              Tambahkan SOP internal yang hak pakainya jelas. Belum ada dokumen
              yang aktif untuk assistant atau rekomendasi.
            </StatePanel>
          ) : (
            <div className="knowledge-list">
              {sources.map((source) => (
                <article className="knowledge-source" key={source.id}>
                  <div className="knowledge-source-heading">
                    <div>
                      <p className="section-kicker">
                        {source.scope === "SHARED" ? "Semua farm" : "Farm aktif"} · v{source.versionLabel}
                      </p>
                      <h3>{source.title}</h3>
                      <p>{source.publisher} · berlaku {prettyDate(source.effectiveAt)}</p>
                    </div>
                    <span className={`knowledge-status ${source.status.toLowerCase()}`}>
                      {statusLabel[source.status]}
                    </span>
                  </div>
                  <dl className="knowledge-details">
                    <div><dt>Hak pakai</dt><dd>{source.rightsEvidence}</dd></div>
                    <div><dt>Berlaku untuk</dt><dd>{source.applicability}</dd></div>
                    <div><dt>Tinjau sebelum</dt><dd>{prettyDate(source.reviewAt)}</dd></div>
                    <div><dt>File</dt><dd>{source.fileName ?? "Belum diunggah"}</dd></div>
                  </dl>
                  <div className="knowledge-audit" aria-label="Riwayat sumber">
                    <p>
                      <strong>Dicatat</strong> {prettyDateTime(source.createdAt)} oleh {source.createdByName}
                    </p>
                    {source.approvedAt && (
                      <p>
                        <strong>Disetujui</strong> {prettyDateTime(source.approvedAt)} oleh {source.approvedByName ?? "Anggota tidak tersedia"}
                      </p>
                    )}
                    {source.revokedAt && (
                      <p>
                        <strong>Dicabut</strong> {prettyDateTime(source.revokedAt)} oleh {source.revokedByName ?? "Anggota tidak tersedia"}
                      </p>
                    )}
                  </div>
                  {source.fileName && farmId && (
                    <a
                      className="knowledge-download"
                      href={`/api/farms/${farmId}/knowledge/sources/${source.id}/file`}
                    >
                      Unduh file sumber
                    </a>
                  )}
                  {source.status === "PENDING_REVIEW" && !source.hasFile && (
                    <div className="knowledge-retry-upload">
                      <label htmlFor={`source-file-${source.id}`}>
                        Lampirkan file untuk sumber ini
                      </label>
                      <input
                        id={`source-file-${source.id}`}
                        type="file"
                        accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
                        disabled={pending}
                        onChange={(event) =>
                          setRetryFiles((current) => ({
                            ...current,
                            [source.id]: event.target.files?.[0],
                          }))
                        }
                      />
                      <button
                        type="button"
                        disabled={pending || !retryFiles[source.id]}
                        onClick={() => void retryFileUpload(source.id)}
                      >
                        Unggah file
                      </button>
                    </div>
                  )}
                  <div className="actions knowledge-actions">
                    {source.status === "PENDING_REVIEW" && source.hasFile && (
                      <button
                        type="button"
                        className="button-primary"
                        disabled={pending}
                        onClick={() => void runAction(source.id, "approve")}
                      >
                        Setujui hak pakai
                      </button>
                    )}
                    {(source.status === "PENDING_REVIEW" || source.status === "ACTIVE") && (
                      <button
                        type="button"
                        className="button-danger"
                        disabled={pending}
                        onClick={() => setRevokeId(source.id)}
                      >
                        Cabut sumber
                      </button>
                    )}
                  </div>
                  {source.contentSha256 && (
                    <p className="knowledge-hash">
                      SHA-256 <code>{source.contentSha256}</code>
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
      <p className="knowledge-footnote">
        Persetujuan hanya mencatat hak pakai dan masa tinjau. Ekstraksi/chunk,
        vector store, retrieval, dan jawaban bersitasi belum aktif.
      </p>
      <ConfirmDialog
        open={revokeId !== null}
        title="Cabut sumber ini?"
        onClose={() => setRevokeId(null)}
        onConfirm={() => revokeId && void runAction(revokeId, "revoke")}
        busy={pending}
      >
        Sumber langsung dikeluarkan dari penggunaan. File lokalnya akan dihapus
        dalam 24 jam; catatan audit disimpan selama 90 hari.
      </ConfirmDialog>
    </>
  );
}
