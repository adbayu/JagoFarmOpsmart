import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { UnitSummary } from "../../modules/farming/contracts.js";
import {
  Card,
  ConfirmDialog,
  PageHeader,
  StatePanel,
} from "../components/primitives.js";
import { request, useFarms } from "../farms.js";
import { Icon } from "../icons.js";
import {
  blank,
  Fields,
  formatDecimal,
  fromUnit,
  payload,
  type Draft,
} from "../units.js";

export function CropUnitDetail({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const { unitId } = useParams();
  const navigate = useNavigate();
  const [unit, setUnit] = useState<UnitSummary | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editKey, setEditKey] = useState(() => crypto.randomUUID());
  const [archiveKey, setArchiveKey] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!farmId || !unitId) {
      setUnit(null);
      setLoading(false);
      return;
    }
    let current = true;
    setUnit(null);
    setLoading(true);
    setLoadError(null);
    setActionError(null);
    setMessage(null);
    request<UnitSummary>(`/api/farms/${farmId}/units/${unitId}`)
      .then((record) => {
        if (record.type !== "CROP" || !record.active)
          throw new Error("Area tanam tidak ditemukan di farm aktif.");
        if (!current) return;
        setUnit(record);
        setDraft(fromUnit(record));
        setEditKey(crypto.randomUUID());
        setArchiveKey(crypto.randomUUID());
      })
      .catch((error) => {
        if (current)
          setLoadError(
            error instanceof Error ? error.message : "Gagal memuat area tanam.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, unitId, revision]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || !unit || pending) return;
    setPending(true);
    setActionError(null);
    setMessage(null);
    try {
      const updated = await request<UnitSummary>(
        `/api/farms/${farmId}/units/${unit.id}`,
        "PATCH",
        { idempotencyKey: editKey, ...payload("CROP", draft, true) },
      );
      setUnit(updated);
      setDraft(fromUnit(updated));
      setEditKey(crypto.randomUUID());
      setMessage("Perubahan area tanam tersimpan.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Gagal menyimpan area tanam.",
      );
    } finally {
      setPending(false);
    }
  }

  async function archive() {
    if (!farmId || !unit || pending) return;
    setPending(true);
    setActionError(null);
    try {
      await request(`/api/farms/${farmId}/units/${unit.id}/archive`, "POST", {
        idempotencyKey: archiveKey,
      });
      navigate("/farm/crops");
    } catch (error) {
      setConfirmArchive(false);
      setActionError(
        error instanceof Error
          ? error.message
          : "Gagal mengarsipkan area tanam.",
      );
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Farm / Tanaman"
        title={unit?.name ?? "Detail area tanam"}
        description="Lihat media, luas, dan kapasitas area tanam, lalu perbarui data unitnya."
        visual="crop"
      />
      <Link className="back-link" to="/farm/crops">
        ← Kembali ke daftar area tanam
      </Link>
      {state.loading && (
        <StatePanel kind="loading" title="Memuat farm">
          Mohon tunggu.
        </StatePanel>
      )}
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm di <Link to="/farms">Kelola Farm</Link> terlebih dahulu.
        </StatePanel>
      )}
      {farmId && loading && (
        <StatePanel kind="loading" title="Memuat area tanam">
          Sedang mengambil detail area tanam.
        </StatePanel>
      )}
      {farmId && loadError && (
        <StatePanel
          kind="error"
          title="Area tanam belum dapat dimuat"
          onRetry={() => setRevision((value) => value + 1)}
        >
          {loadError}
        </StatePanel>
      )}
      {actionError && (
        <StatePanel kind="error" title="Perubahan belum tersimpan">
          {actionError}
        </StatePanel>
      )}
      {message && (
        <StatePanel kind="success" title="Tersimpan">
          {message}
        </StatePanel>
      )}
      {unit && !loading && (
        <>
          <section className="unit-facts" aria-label="Atribut area tanam">
            <article>
              <Icon name="farm" size={21} />
              <span>Lokasi</span>
              <strong>{unit.location || "Belum diisi"}</strong>
            </article>
            <article>
              <Icon name="crop" size={21} />
              <span>Media tanam</span>
              <strong>{unit.media || "Belum diisi"}</strong>
            </article>
            <article>
              <Icon name="crop" size={21} />
              <span>Luas</span>
              <strong>
                {unit.areaM2
                  ? `${formatDecimal(unit.areaM2)} m²`
                  : "Belum diisi"}
              </strong>
            </article>
            <article>
              <Icon name="units" size={21} />
              <span>Kapasitas tanaman</span>
              <strong>
                {unit.capacityPlants
                  ? `${formatDecimal(String(unit.capacityPlants))} tanaman`
                  : "Belum diisi"}
              </strong>
            </article>
          </section>
          <Link className="back-link" to={`/cycles?unitId=${unit.id}`}>
            Kelola siklus area tanam →
          </Link>
          <Card
            title="Ubah area tanam"
            className="form-card unit-detail-edit-card"
          >
            <p>Perubahan tersimpan pada farm aktif.</p>
            <form onSubmit={(event) => void save(event)}>
              <Fields
                type="CROP"
                draft={draft}
                setDraft={setDraft}
                prefix="crop-detail"
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
          </Card>
        </>
      )}
      <ConfirmDialog
        open={confirmArchive}
        title="Arsipkan area tanam?"
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
      >
        Area tanam akan hilang dari daftar aktif. Riwayat tetap tersimpan, dan
        area tanam dengan siklus terencana atau aktif tidak bisa diarsipkan.
      </ConfirmDialog>
    </>
  );
}
