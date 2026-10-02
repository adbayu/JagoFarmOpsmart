import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { FarmingType, UnitSummary } from "../modules/farming/contracts.js";
import {
  Card,
  ConfirmDialog,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";

export type Draft = {
  name: string;
  location: string;
  areaM2: string;
  depthM: string;
  media: string;
  capacity: string;
  condition: string;
};
export const blank = (): Draft => ({
  name: "",
  location: "",
  areaM2: "",
  depthM: "",
  media: "",
  capacity: "",
  condition: "",
});
export function formatDecimal(value: string): string {
  const [integer = "", decimal = ""] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = decimal.replace(/0+$/, "");
  return fraction ? `${grouped},${fraction}` : grouped;
}
function editableDecimal(value: string | null): string {
  return (value ?? "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
const labels: Record<
  FarmingType,
  { title: string; unit: string; capacity: string }
> = {
  FISH: { title: "Ikan", unit: "Kolam", capacity: "Kapasitas ikan (ekor)" },
  CHICKEN: {
    title: "Ayam",
    unit: "Kandang",
    capacity: "Kapasitas ayam (ekor)",
  },
  CROP: { title: "Tanaman", unit: "Area tanam", capacity: "Kapasitas tanaman" },
};
export function fromUnit(unit: UnitSummary): Draft {
  return {
    name: unit.name,
    location: unit.location ?? "",
    areaM2: editableDecimal(unit.areaM2),
    depthM: editableDecimal(unit.depthM),
    media: unit.media ?? "",
    capacity: String(unit.capacityPlants ?? unit.capacityHeads ?? ""),
    condition: unit.condition ?? "",
  };
}
export function payload(type: FarmingType, draft: Draft, edit: boolean) {
  const optional = (value: string) =>
    value === "" ? (edit ? null : undefined) : value;
  return {
    type,
    name: draft.name,
    location: optional(draft.location),
    areaM2: optional(draft.areaM2),
    ...(type === "FISH"
      ? {
          depthM: optional(draft.depthM),
          condition: optional(draft.condition),
        }
      : {}),
    ...(type === "CROP"
      ? {
          media: optional(draft.media),
          capacityPlants:
            draft.capacity === ""
              ? edit
                ? null
                : undefined
              : Number(draft.capacity),
        }
      : {
          capacityHeads:
            draft.capacity === ""
              ? edit
                ? null
                : undefined
              : Number(draft.capacity),
        }),
  };
}
export function Fields({
  type,
  draft,
  setDraft,
  prefix,
  onChange,
}: {
  type: FarmingType;
  draft: Draft;
  setDraft: (draft: Draft) => void;
  prefix: string;
  onChange: () => void;
}) {
  const change = (key: keyof Draft, value: string) => {
    setDraft({ ...draft, [key]: value });
    onChange();
  };
  return (
    <>
      <FormField
        id={`${prefix}-name`}
        label={`Nama ${labels[type].unit.toLowerCase()}`}
      >
        <input
          id={`${prefix}-name`}
          required
          maxLength={120}
          value={draft.name}
          onChange={(e) => change("name", e.target.value)}
        />
      </FormField>
      <FormField id={`${prefix}-location`} label="Lokasi (opsional)">
        <input
          id={`${prefix}-location`}
          maxLength={500}
          value={draft.location}
          onChange={(e) => change("location", e.target.value)}
        />
      </FormField>
      <FormField id={`${prefix}-area`} label="Luas (m², opsional)">
        <input
          id={`${prefix}-area`}
          type="number"
          min="0.001"
          max="999999999999.999"
          step="0.001"
          value={draft.areaM2}
          onChange={(e) => change("areaM2", e.target.value)}
        />
      </FormField>
      {type === "FISH" && (
        <>
          <FormField id={`${prefix}-depth`} label="Kedalaman (m, opsional)">
            <input
              id={`${prefix}-depth`}
              type="number"
              min="0.001"
              step="0.001"
              value={draft.depthM}
              onChange={(e) => change("depthM", e.target.value)}
            />
          </FormField>
          <FormField
            id={`${prefix}-condition`}
            label="Kondisi kolam (opsional)"
          >
            <textarea
              id={`${prefix}-condition`}
              maxLength={500}
              rows={3}
              value={draft.condition}
              onChange={(e) => change("condition", e.target.value)}
            />
          </FormField>
        </>
      )}
      {type === "CROP" && (
        <FormField id={`${prefix}-media`} label="Media tanam (opsional)">
          <input
            id={`${prefix}-media`}
            maxLength={200}
            value={draft.media}
            onChange={(e) => change("media", e.target.value)}
          />
        </FormField>
      )}
      <FormField
        id={`${prefix}-capacity`}
        label={`${labels[type].capacity} (opsional)`}
      >
        <input
          id={`${prefix}-capacity`}
          type="number"
          min="1"
          max="2147483647"
          step="1"
          value={draft.capacity}
          onChange={(e) => change("capacity", e.target.value)}
        />
      </FormField>
    </>
  );
}
export function UnitRegistry({
  state,
  type,
}: {
  state: ReturnType<typeof useFarms>;
  type: FarmingType;
}) {
  const farmId = state.activeId;
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createDraft, setCreateDraft] = useState<Draft>(blank);
  const [editDraft, setEditDraft] = useState<Draft>(blank);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [editKey, setEditKey] = useState(() => crypto.randomUUID());
  const [archiveKey, setArchiveKey] = useState(() => crypto.randomUUID());
  const [confirmArchive, setConfirmArchive] = useState(false);
  const selected = units.find((unit) => unit.id === selectedId);
  const visible = units.filter((unit) => unit.type === type);
  const reload = useCallback(async () => {
    if (!farmId) {
      setUnits([]);
      return;
    }
    setUnits([]);
    setLoading(true);
    try {
      setUnits(await request<UnitSummary[]>(`/api/farms/${farmId}/units`));
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Gagal memuat unit.",
      );
    } finally {
      setLoading(false);
    }
  }, [farmId]);
  useEffect(() => {
    void reload();
    setSelectedId(null);
    setCreateDraft(blank());
    setMessage(null);
    setActionError(null);
  }, [reload]);
  function select(unit: UnitSummary) {
    setSelectedId(unit.id);
    setEditDraft(fromUnit(unit));
    setEditKey(crypto.randomUUID());
    setArchiveKey(crypto.randomUUID());
    setActionError(null);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      await request(`/api/farms/${farmId}/units`, "POST", {
        idempotencyKey: createKey,
        ...payload(type, createDraft, false),
      });
      setCreateDraft(blank());
      setCreateKey(crypto.randomUUID());
      await reload();
      setMessage(`${labels[type].unit} berhasil dibuat.`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Gagal membuat unit.",
      );
    } finally {
      setPending(false);
    }
  }
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || !selected || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      await request(`/api/farms/${farmId}/units/${selected.id}`, "PATCH", {
        idempotencyKey: editKey,
        ...payload(type, editDraft, true),
      });
      setEditKey(crypto.randomUUID());
      await reload();
      setMessage("Perubahan unit tersimpan.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Gagal menyimpan unit.",
      );
    } finally {
      setPending(false);
    }
  }
  async function archive() {
    if (!farmId || !selected || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      await request(
        `/api/farms/${farmId}/units/${selected.id}/archive`,
        "POST",
        { idempotencyKey: archiveKey },
      );
      setSelectedId(null);
      setConfirmArchive(false);
      setArchiveKey(crypto.randomUUID());
      await reload();
      setMessage("Unit diarsipkan. Riwayat tetap tersimpan.");
    } catch (error) {
      setConfirmArchive(false);
      setActionError(
        error instanceof Error ? error.message : "Gagal mengarsipkan unit.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Farm"
        title={labels[type].title}
        description={`Kelola ${labels[type].unit.toLowerCase()} pada farm aktif. Pencatatan siklus dan kegiatan menyusul.`}
        visual={
          type === "FISH" ? "fish" : type === "CHICKEN" ? "chicken" : "crop"
        }
      />
      {state.loading && (
        <StatePanel kind="loading" title="Memuat farm">
          Mohon tunggu.
        </StatePanel>
      )}
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Buat atau pilih farm di <Link to="/farms">Kelola Farm</Link> terlebih
          dahulu.
        </StatePanel>
      )}
      {farmId && (
        <>
          {loading && (
            <StatePanel kind="loading" title="Memuat unit">
              Sedang mengambil daftar unit.
            </StatePanel>
          )}
          {loadError && (
            <StatePanel
              kind="error"
              title="Unit belum dapat dimuat"
              onRetry={() => void reload()}
            >
              {loadError}
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
          {!loadError && (
            <div className="unit-layout">
              <Card
                title={`Daftar ${labels[type].unit.toLowerCase()}`}
                className="unit-list-card"
              >
                <p className="list-meta">
                  {`${visible.length} ${labels[type].unit.toLowerCase()} aktif di farm ini`}
                </p>
                <DataTable
                  caption={`Daftar ${labels[type].unit.toLowerCase()} aktif`}
                  rows={visible}
                  rowKey={(unit) => unit.id}
                  emptyMessage={`Belum ada ${labels[type].unit.toLowerCase()} di farm ini. Gunakan formulir di samping untuk menambahkannya.`}
                  columns={[
                    {
                      key: "name",
                      label: "Nama",
                      render: (unit) => (
                        <>
                          <span className="table-primary">{unit.name}</span>
                          <small className="table-secondary">
                            {unit.location || "Lokasi belum diisi"}
                          </small>
                        </>
                      ),
                    },
                    {
                      key: "area",
                      label: "Luas",
                      render: (unit) =>
                        unit.areaM2 ? `${formatDecimal(unit.areaM2)} m²` : "—",
                    },
                    {
                      key: "action",
                      label: "Aksi",
                      render: (unit) => (
                        <div className="table-actions">
                          <Link
                            className="table-detail-link"
                            to={`/farm/${{ FISH: "fish", CHICKEN: "chicken", CROP: "crops" }[type]}/${unit.id}`}
                          >
                            Detail
                          </Link>
                          <button
                            type="button"
                            className="table-action"
                            onClick={() => select(unit)}
                          >
                            Ubah
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              </Card>
              {selected?.type === type ? (
                <Card
                  title={`Ubah ${labels[type].unit.toLowerCase()}`}
                  className="form-card unit-form-card"
                >
                  <p>Perubahan unit disimpan pada farm aktif.</p>
                  <form onSubmit={(e) => void update(e)}>
                    <Fields
                      type={type}
                      draft={editDraft}
                      setDraft={setEditDraft}
                      prefix={`edit-${type}`}
                      onChange={() => setEditKey(crypto.randomUUID())}
                    />
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
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSelectedId(null)}
                  >
                    Batal mengubah
                  </button>
                </Card>
              ) : (
                <Card
                  title={`Buat ${labels[type].unit.toLowerCase()}`}
                  className="form-card unit-form-card"
                >
                  <p>
                    Mulai dari nama unit. Ukuran dan kapasitas dapat dilengkapi
                    kemudian.
                  </p>
                  <form onSubmit={(e) => void create(e)}>
                    <Fields
                      type={type}
                      draft={createDraft}
                      setDraft={setCreateDraft}
                      prefix={`create-${type}`}
                      onChange={() => setCreateKey(crypto.randomUUID())}
                    />
                    <button type="submit" disabled={pending}>
                      Buat {labels[type].unit.toLowerCase()}
                    </button>
                  </form>
                </Card>
              )}
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmArchive}
        title={`Arsipkan ${labels[type].unit.toLowerCase()}?`}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
      >
        {selected?.name} akan hilang dari daftar aktif. Unit dengan siklus
        terencana atau aktif tidak bisa diarsipkan.
      </ConfirmDialog>
    </>
  );
}
