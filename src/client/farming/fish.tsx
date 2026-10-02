import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  FishCycleSummary,
  UnitSummary,
} from "../../modules/farming/contracts.js";
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

const cycleStatus: Record<FishCycleSummary["status"], string> = {
  PLANNED: "Terencana",
  ACTIVE: "Aktif",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

export function FishUnitDetail({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const { unitId } = useParams();
  const navigate = useNavigate();
  const [unit, setUnit] = useState<UnitSummary | null>(null);
  const [cycles, setCycles] = useState<FishCycleSummary[]>([]);
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
      setCycles([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setUnit(null);
    setCycles([]);
    setLoadError(null);
    setActionError(null);
    setMessage(null);
    (async () => {
      const record = await request<UnitSummary>(
        `/api/farms/${farmId}/units/${unitId}`,
      );
      if (record.type !== "FISH" || !record.active)
        throw new Error("Kolam tidak ditemukan di farm aktif.");
      const related = await request<FishCycleSummary[]>(
        `/api/farms/${farmId}/units/${unitId}/cycles`,
      );
      if (!current) return;
      setUnit(record);
      setCycles(related);
      setDraft(fromUnit(record));
      setEditKey(crypto.randomUUID());
      setArchiveKey(crypto.randomUUID());
    })()
      .catch((error) => {
        if (current)
          setLoadError(
            error instanceof Error ? error.message : "Gagal memuat kolam.",
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
        { idempotencyKey: editKey, ...payload("FISH", draft, true) },
      );
      setUnit(updated);
      setDraft(fromUnit(updated));
      setEditKey(crypto.randomUUID());
      setMessage("Perubahan kolam tersimpan.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Gagal menyimpan kolam.",
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
      navigate("/farm/fish");
    } catch (error) {
      setConfirmArchive(false);
      setActionError(
        error instanceof Error ? error.message : "Gagal mengarsipkan kolam.",
      );
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Farm / Ikan"
        title={unit?.name ?? "Detail kolam"}
        description="Lihat kondisi kolam, perbarui atributnya, dan baca siklus yang terkait."
        visual="fish"
      />
      <Link className="back-link" to="/farm/fish">
        ← Kembali ke daftar kolam
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
        <StatePanel kind="loading" title="Memuat kolam">
          Sedang mengambil detail dan siklus terkait.
        </StatePanel>
      )}
      {farmId && loadError && (
        <StatePanel
          kind="error"
          title="Kolam belum dapat dimuat"
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
          <section className="unit-facts" aria-label="Atribut kolam">
            <article>
              <Icon name="fish" size={21} />
              <span>Luas</span>
              <strong>
                {unit.areaM2
                  ? `${formatDecimal(unit.areaM2)} m²`
                  : "Belum diisi"}
              </strong>
            </article>
            <article>
              <Icon name="fish" size={21} />
              <span>Kedalaman</span>
              <strong>
                {unit.depthM
                  ? `${formatDecimal(unit.depthM)} m`
                  : "Belum diisi"}
              </strong>
            </article>
            <article>
              <Icon name="units" size={21} />
              <span>Kapasitas ikan</span>
              <strong>
                {unit.capacityHeads
                  ? `${formatDecimal(String(unit.capacityHeads))} ekor`
                  : "Belum diisi"}
              </strong>
            </article>
            <article>
              <Icon name="activity" size={21} />
              <span>Kondisi kolam</span>
              <strong>{unit.condition || "Belum dicatat"}</strong>
            </article>
          </section>
          <Link className="back-link" to={`/cycles?unitId=${unit.id}`}>
            Kelola siklus kolam →
          </Link>
          <div className="fish-detail-layout">
            <Card title="Siklus terkait" className="fish-cycle-card">
              <p>Riwayat siklus yang terhubung dengan kolam ini.</p>
              {cycles.length === 0 ? (
                <div className="fish-cycle-empty">
                  <span>
                    <Icon name="cycle" size={27} />
                  </span>
                  <strong>Belum ada siklus</strong>
                  <p>Buat siklus pertama dari halaman Siklus.</p>
                </div>
              ) : (
                <ul className="fish-cycle-list">
                  {cycles.map((cycle) => (
                    <li key={cycle.id}>
                      <div>
                        <strong>
                          <Link to={`/cycles/${cycle.id}`}>{cycle.name}</Link>
                        </strong>
                        <small>
                          {cycle.commodityName} · Mulai {cycle.startDate}
                        </small>
                        {cycle.targetHarvestDate && (
                          <small>Target panen {cycle.targetHarvestDate}</small>
                        )}
                      </div>
                      <span
                        className={`cycle-badge cycle-${cycle.status.toLowerCase()}`}
                      >
                        {cycleStatus[cycle.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Ubah kolam" className="form-card fish-edit-card">
              <p>Perubahan tersimpan pada farm aktif.</p>
              <form onSubmit={(event) => void save(event)}>
                <Fields
                  type="FISH"
                  draft={draft}
                  setDraft={setDraft}
                  prefix="fish-detail"
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
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirmArchive}
        title="Arsipkan kolam?"
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
      >
        Kolam akan hilang dari daftar aktif. Riwayat siklus tetap tersimpan, dan
        kolam dengan siklus terencana atau aktif tidak bisa diarsipkan.
      </ConfirmDialog>
    </>
  );
}
