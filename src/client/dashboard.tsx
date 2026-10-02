import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FarmingType } from "../modules/farming/contracts.js";
import type { DashboardSummary } from "../modules/analytics/contracts.js";
import { StatePanel } from "./components/primitives.js";
import { request, useFarms } from "./farms.js";
import { Icon, type IconName } from "./icons.js";
import { NotificationPreview } from "./notifications.js";

const unitCards: {
  type: FarmingType;
  label: string;
  description: string;
  path: string;
  icon: IconName;
}[] = [
  {
    type: "FISH",
    label: "Kolam",
    description: "Kelola unit ikan",
    path: "/farm/fish",
    icon: "fish",
  },
  {
    type: "CHICKEN",
    label: "Kandang",
    description: "Kelola unit ayam",
    path: "/farm/chicken",
    icon: "chicken",
  },
  {
    type: "CROP",
    label: "Area tanam",
    description: "Kelola unit tanaman",
    path: "/farm/crops",
    icon: "crop",
  },
];

const money = (value: string) =>
  `Rp ${new Intl.NumberFormat("id-ID").format(BigInt(value))}`;
const metricDisplay = (
  metric: DashboardSummary["finance"]["revenue"] | undefined,
  pending: boolean,
  error: boolean,
) =>
  pending
    ? "…"
    : error || !metric
      ? "—"
      : metric.status === "AVAILABLE"
        ? money(metric.value)
        : "Belum tersedia";
const activityLabel: Record<string, string> = {
  STOCKING: "Tebar bibit",
  PLANTING: "Tanam",
  FEEDING: "Pemberian pakan",
  WATERING: "Penyiraman",
  FERTILIZING: "Pemupukan",
  MAINTENANCE: "Perawatan",
  INSPECTION: "Pemeriksaan",
  TREATMENT: "Perlakuan",
  HARVESTING: "Panen",
};
const statusLabel: Record<string, string> = {
  SCHEDULED: "Terjadwal",
  IN_PROGRESS: "Berjalan",
  COMPLETED: "Selesai",
  MISSED: "Terlewat",
};

export function DashboardHome({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farm = state.farms.find((item) => item.id === state.activeId);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!state.activeId) {
      setSummary(null);
      setSummaryError(null);
      setLoadingSummary(false);
      return;
    }
    let current = true;
    setSummary(null);
    setLoadingSummary(true);
    setSummaryError(null);
    request<DashboardSummary>(`/api/farms/${state.activeId}/dashboard`)
      .then((records) => {
        if (current) setSummary(records);
      })
      .catch((error) => {
        if (current)
          setSummaryError(
            error instanceof Error ? error.message : "Gagal memuat ringkasan.",
          );
      })
      .finally(() => {
        if (current) setLoadingSummary(false);
      });
    return () => {
      current = false;
    };
  }, [state.activeId, reloadKey]);

  const pending = state.loading || loadingSummary;
  const error = state.error ?? summaryError;
  const countLabel = (type?: FarmingType) => {
    if (pending) return "…";
    if (error || !summary) return "—";
    return String(
      type
        ? summary.activeUnits[type]
        : Object.values(summary.activeUnits).reduce((a, b) => a + b, 0),
    );
  };
  const financeCards = [
    { label: "Pendapatan diterima", metric: summary?.finance.revenue },
    { label: "HPP / COGS", metric: summary?.finance.hpp },
    { label: "Laba kotor", metric: summary?.finance.profit },
  ];

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero" aria-labelledby="dashboard-title">
        <div className="dashboard-hero-copy">
          <p className="section-kicker">Ruang kerja</p>
          <h1 id="dashboard-title">Selamat datang di OpSmart</h1>
          <p>
            Kelola farm dan unitnya dengan lebih mudah. Mulai dari area yang
            sudah tersedia, lalu lanjutkan pekerjaan dari menu terkait.
          </p>
          <Link className="button-link" to="/farms">
            Kelola farm <Icon name="arrow" size={18} />
          </Link>
        </div>
        <Link className="dashboard-active-farm" to="/farms">
          <span className="dashboard-farm-label">Farm aktif</span>
          <span className="dashboard-farm-row">
            <span className="dashboard-farm-icon">
              <Icon name="farm" size={26} />
            </span>
            <span className="dashboard-farm-info">
              <strong>
                {state.loading
                  ? "Memuat farm…"
                  : (farm?.name ?? "Belum ada farm")}
              </strong>
              <small>
                {farm
                  ? "Kelola unit farm yang sudah tersedia."
                  : "Buat farm pertama untuk memulai."}
              </small>
            </span>
            <Icon name="arrow" size={19} />
          </span>
        </Link>
      </section>

      {error && (
        <StatePanel
          kind="error"
          title="Ringkasan belum dapat dimuat"
          onRetry={() =>
            state.error ? void state.reload() : setReloadKey((key) => key + 1)
          }
        >
          {error}
        </StatePanel>
      )}

      <section className="dashboard-stats" aria-label="Ringkasan operasional">
        <article className="dashboard-stat">
          <span className="stat-icon stat-green">
            <Icon name="units" size={25} />
          </span>
          <div>
            <p>Total Unit</p>
            <strong>{countLabel()}</strong>
            <small>
              {pending
                ? "Memuat unit farm"
                : error
                  ? "Data belum terbaca"
                  : "Unit aktif di farm ini"}
            </small>
          </div>
        </article>
        <article className="dashboard-stat">
          <span className="stat-icon stat-blue">
            <Icon name="cycle" size={25} />
          </span>
          <div>
            <p>Siklus Aktif</p>
            <strong>
              {pending ? "…" : error ? "—" : (summary?.activeCycles ?? 0)}
            </strong>
            <small>Siklus berstatus aktif</small>
          </div>
        </article>
        <article className="dashboard-stat">
          <span className="stat-icon stat-leaf">
            <Icon name="harvest" size={25} />
          </span>
          <div>
            <p>Aktivitas Mendatang</p>
            <strong>
              {pending
                ? "…"
                : error
                  ? "—"
                  : (summary?.upcomingActivityCount ?? 0)}
            </strong>
            <small>Dalam 14 hari ke depan</small>
          </div>
        </article>
        <article className="dashboard-stat">
          <span className="stat-icon stat-orange">
            <Icon name="wallet" size={25} />
          </span>
          <div>
            <p>Biaya Bulan Ini</p>
            <strong>
              {pending
                ? "…"
                : error
                  ? "—"
                  : money(summary?.monthlyRecordedCosts ?? "0")}
            </strong>
            <small>Biaya mentah tercatat, belum HPP</small>
          </div>
        </article>
      </section>

      <section className="dashboard-stats" aria-label="Ringkasan keuangan">
        {financeCards.map(({ label, metric }) => (
          <article className="dashboard-stat" key={label}>
            <span className="stat-icon stat-green">
              <Icon name="wallet" size={25} />
            </span>
            <div>
              <p>{label}</p>
              <strong>{metricDisplay(metric, pending, !!error)}</strong>
              <small>
                {!pending && !error && metric?.status === "UNAVAILABLE"
                  ? metric.reason
                  : "Sesuai ledger pembayaran dan kebijakan keuangan MVP"}
              </small>
            </div>
          </article>
        ))}
      </section>

      <section
        className="dashboard-unit-section"
        aria-labelledby="dashboard-units-title"
      >
        <div className="dashboard-section-heading">
          <div>
            <p className="section-kicker">Farm aktif</p>
            <h2 id="dashboard-units-title">Unit Farm</h2>
          </div>
          <Link to="/farm/fish">
            Lihat unit <Icon name="arrow" size={16} />
          </Link>
        </div>
        <div className="dashboard-unit-grid">
          {unitCards.map((card) => (
            <Link
              key={card.type}
              className={`dashboard-unit-card unit-${card.type.toLowerCase()}`}
              to={card.path}
            >
              <span className="unit-card-icon">
                <Icon name={card.icon} size={27} />
              </span>
              <span className="unit-card-copy">
                <strong>{card.label}</strong>
                <span className="unit-card-count">
                  {countLabel(card.type)} unit
                </span>
                <small>{card.description}</small>
              </span>
              <span className="unit-card-arrow">
                <Icon name="arrow" size={17} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="dashboard-panels" aria-label="Panel operasional">
        <article className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <Icon name="calendar" size={19} />
            <h2>Jadwal Hari Ini</h2>
          </div>
          <div className="dashboard-panel-data">
            {summary?.todayActivities.length ? (
              summary.todayActivities.map((activity) => (
                <div key={activity.id}>
                  <strong>
                    {activityLabel[activity.kind] ?? activity.kind}
                  </strong>
                  <small>
                    {activity.cycleName} ·{" "}
                    {statusLabel[activity.status] ?? activity.status}
                  </small>
                </div>
              ))
            ) : (
              <p>
                {pending ? "Memuat jadwal…" : "Tidak ada kegiatan hari ini."}
              </p>
            )}
          </div>
          <Link className="panel-link" to="/schedule">
            Lihat jadwal <Icon name="arrow" size={15} />
          </Link>
        </article>
        <article className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <Icon name="activity" size={19} />
            <h2>Aktivitas Terbaru</h2>
          </div>
          <div className="dashboard-panel-data">
            {summary?.recentActivities.length ? (
              summary.recentActivities.map((activity) => (
                <div key={activity.id}>
                  <strong>
                    {activityLabel[activity.kind] ?? activity.kind}
                  </strong>
                  <small>
                    {activity.cycleName} ·{" "}
                    {statusLabel[activity.status] ?? activity.status}
                  </small>
                </div>
              ))
            ) : (
              <p>
                {pending
                  ? "Memuat aktivitas…"
                  : "Belum ada aktivitas berjalan atau selesai."}
              </p>
            )}
          </div>
          <Link className="panel-link" to="/schedule">
            Lihat aktivitas <Icon name="arrow" size={15} />
          </Link>
        </article>
        <article className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <Icon name="bell" size={19} />
            <h2>Notifikasi & Alert</h2>
          </div>
          <div className="dashboard-panel-data notification-preview">
            <NotificationPreview farmId={state.activeId} />
          </div>
          <Link className="panel-link" to="/notifications">
            Lihat inbox <Icon name="arrow" size={15} />
          </Link>
        </article>
        <article className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <Icon name="chart" size={19} />
            <h2>Produksi Tercatat</h2>
          </div>
          <div className="dashboard-panel-data">
            {summary?.production.length ? (
              summary.production.map((point) => (
                <div key={`${point.commodityId}-${point.unit}`}>
                  <strong>{point.commodityName}</strong>
                  <small>
                    {point.quantity} {point.unit} · panen aktif
                  </small>
                </div>
              ))
            ) : (
              <p>{pending ? "Memuat panen…" : "Belum ada hasil panen."}</p>
            )}
          </div>
          <Link className="panel-link" to="/harvest">
            Lihat panen <Icon name="arrow" size={15} />
          </Link>
        </article>
      </section>
    </div>
  );
}
