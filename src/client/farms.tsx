import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Card,
  ConfirmDialog,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import type { FarmSummary } from "../modules/farms/contracts.js";
import { getCsrfToken } from "./auth-api.js";

const storageKey = "opsmart-active-farm-v1";
type ApiResult<T> = { data: T } | { error: { code: string; message: string } };
export async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(method === "GET" ? {} : { "x-csrf-token": getCsrfToken() ?? "" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Layanan farm belum tersedia. Coba lagi nanti.");
  }
  let result: ApiResult<T>;
  try {
    result = (await response.json()) as ApiResult<T>;
  } catch {
    throw new Error("Layanan farm belum tersedia. Coba lagi nanti.");
  }
  if (response.status === 401)
    window.dispatchEvent(new Event("opsmart-auth-expired"));
  if (!response.ok || "error" in result)
    throw new Error(
      "error" in result ? result.error.message : "Permintaan gagal.",
    );
  return result.data;
}
export function useFarms() {
  const [farms, setFarms] = useState<FarmSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() =>
    localStorage.getItem(storageKey),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const records = await request<FarmSummary[]>("/api/farms");
      setFarms(records);
      setActiveId(
        (current) =>
          records.find((f) => f.id === current)?.id ?? records[0]?.id ?? null,
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memuat farm.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (activeId) localStorage.setItem(storageKey, activeId);
    else localStorage.removeItem(storageKey);
  }, [activeId]);
  return { farms, setFarms, activeId, setActiveId, loading, error, reload };
}
type FarmsState = ReturnType<typeof useFarms>;
export function FarmRegistry({ state }: { state: FarmsState }) {
  const { farms, setFarms, activeId, setActiveId, loading, error, reload } =
    state;
  const active = farms.find((f) => f.id === activeId);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editKey, setEditKey] = useState(() => crypto.randomUUID());
  const [archiveKey, setArchiveKey] = useState(() => crypto.randomUUID());
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    setEditName(active?.name ?? "");
    setEditLocation(active?.location ?? "");
    setEditKey(crypto.randomUUID());
    setArchiveKey(crypto.randomUUID());
    setActionError(null);
  }, [activeId, active?.name, active?.location]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      const farm = await request<FarmSummary>("/api/farms", "POST", {
        idempotencyKey: createKey,
        name,
        location,
      });
      setFarms((previous) => [
        farm,
        ...previous.filter((item) => item.id !== farm.id),
      ]);
      setActiveId(farm.id);
      setName("");
      setLocation("");
      setCreateKey(crypto.randomUUID());
      setMessage("Farm berhasil dibuat.");
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Gagal membuat farm.",
      );
    } finally {
      setPending(false);
    }
  }
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !active) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      const farm = await request<FarmSummary>(
        `/api/farms/${active.id}`,
        "PATCH",
        { idempotencyKey: editKey, name: editName, location: editLocation },
      );
      setFarms((previous) =>
        previous.map((item) => (item.id === farm.id ? farm : item)),
      );
      setEditKey(crypto.randomUUID());
      setMessage("Perubahan farm tersimpan.");
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Gagal menyimpan farm.",
      );
    } finally {
      setPending(false);
    }
  }
  async function archive() {
    if (pending || !active) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      await request<FarmSummary>(`/api/farms/${active.id}/archive`, "POST", {
        idempotencyKey: archiveKey,
      });
      const remaining = farms.filter((item) => item.id !== active.id);
      setFarms(remaining);
      setActiveId(remaining[0]?.id ?? null);
      setConfirmArchive(false);
      setArchiveKey(crypto.randomUUID());
      setMessage("Farm diarsipkan.");
    } catch (cause) {
      setConfirmArchive(false);
      setActionError(
        cause instanceof Error ? cause.message : "Gagal mengarsipkan farm.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Pengaturan farm"
        title="Farm"
        description="Kelola farm yang Anda miliki dan pilih farm aktif untuk pekerjaan sehari-hari."
        visual="farm"
      />
      {!loading && !error && farms.length > 0 && (
        <div className="registry-summary" aria-label="Ringkasan farm">
          <span>
            <strong>{farms.length}</strong> farm aktif
          </span>
          <span>
            Dipilih: <strong>{active?.name ?? "Belum dipilih"}</strong>
          </span>
        </div>
      )}
      {loading && (
        <StatePanel kind="loading" title="Memuat farm">
          Sedang mengambil daftar farm Anda.
        </StatePanel>
      )}
      {error && (
        <StatePanel
          kind="error"
          title="Farm belum dapat dimuat"
          onRetry={() => void reload()}
        >
          {error}
        </StatePanel>
      )}
      {!loading && !error && farms.length === 0 && (
        <StatePanel kind="empty" title="Belum ada farm">
          Buat farm pertama Anda untuk mulai mencatat kegiatan.
        </StatePanel>
      )}
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
      {!error && (
        <div className="grid farm-grid">
          <Card title="Buat farm" className="form-card">
            <p>Tambahkan lokasi kerja baru ke akun Anda.</p>
            <form onSubmit={(e) => void create(e)}>
              <FormField id="farm-name" label="Nama farm">
                <input
                  id="farm-name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setCreateKey(crypto.randomUUID());
                  }}
                />
              </FormField>
              <FormField id="farm-location" label="Lokasi (opsional)">
                <input
                  id="farm-location"
                  maxLength={500}
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    setCreateKey(crypto.randomUUID());
                  }}
                />
              </FormField>
              <button type="submit" disabled={pending}>
                Buat farm
              </button>
            </form>
          </Card>
          {active && (
            <Card title="Farm aktif" className="detail-card">
              <p>Perbarui identitas farm yang sedang dipilih.</p>
              <form onSubmit={(e) => void update(e)}>
                <FormField id="farm-edit-name" label="Nama farm">
                  <input
                    id="farm-edit-name"
                    required
                    maxLength={120}
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                      setEditKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                <FormField id="farm-edit-location" label="Lokasi">
                  <input
                    id="farm-edit-location"
                    maxLength={500}
                    value={editLocation}
                    onChange={(e) => {
                      setEditLocation(e.target.value);
                      setEditKey(crypto.randomUUID());
                    }}
                  />
                </FormField>
                <div className="actions">
                  <button
                    type="button"
                    className="button-danger-text"
                    disabled={pending}
                    onClick={() => setConfirmArchive(true)}
                  >
                    Arsipkan
                  </button>
                  <button type="submit" disabled={pending}>
                    Simpan perubahan
                  </button>
                </div>
              </form>
            </Card>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmArchive}
        title="Arsipkan farm?"
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
      >
        {active?.name} akan hilang dari pilihan farm aktif. Catatan
        operasionalnya tetap tersimpan.
      </ConfirmDialog>
    </>
  );
}
