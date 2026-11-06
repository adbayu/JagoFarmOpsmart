import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { CycleSummary } from "../modules/farming/contracts.js";
import type {
  AdvancedAnalytics,
  CycleComparison,
  ProductionAnalytics,
} from "../modules/analytics/contracts.js";
import type { Metric } from "../shared/domain.js";
import {
  Card,
  DataTable,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request, useFarms } from "./farms.js";

const isoDate = (date: Date) => date.toLocaleDateString("en-CA");
const beginning = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return isoDate(date);
};
const exclusiveEnd = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return isoDate(date);
};
const metricText = <T,>(metric?: Metric<T>) =>
  !metric
    ? "Belum dihitung."
    : metric.status === "UNAVAILABLE"
      ? metric.reason
      : `${String(metric.value)} (${metric.method})`;
const moneyMetricText = (metric?: Metric<string>) =>
  !metric
    ? "Belum dihitung."
    : metric.status === "UNAVAILABLE"
      ? metric.reason
      : `Rp ${new Intl.NumberFormat("id-ID").format(BigInt(metric.value))} (${metric.method})`;
const farmingTypeLabel = {
  FISH: "Ikan",
  CHICKEN: "Ayam",
  CROP: "Tanaman",
} as const;
function sourceDetails(ids: string[], label: string) {
  return (
    <details className="analytics-sources">
      <summary>
        {label} ({ids.length})
      </summary>
      <ul>
        {ids.map((id) => (
          <li key={id}>
            <code>{id}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}
export function AnalyticsPage({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const farmId = state.activeId;
  const [from, setFrom] = useState(beginning);
  const [toExclusive, setToExclusive] = useState(exclusiveEnd);
  const [cycleId, setCycleId] = useState("");
  const [comparisonCycleA, setComparisonCycleA] = useState("");
  const [comparisonCycleB, setComparisonCycleB] = useState("");
  const [query, setQuery] = useState(() => ({
    from: beginning(),
    toExclusive: exclusiveEnd(),
    cycleId: "",
    comparisonCycleA: "",
    comparisonCycleB: "",
  }));
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [summary, setSummary] = useState<ProductionAnalytics | null>(null);
  const [advanced, setAdvanced] = useState<AdvancedAnalytics | null>(null);
  const [comparison, setComparison] = useState<CycleComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!farmId || state.loading) {
      setSummary(null);
      setAdvanced(null);
      setComparison(null);
      setCycles([]);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    setSummary(null);
    setAdvanced(null);
    setComparison(null);
    const params = new URLSearchParams({
      from: query.from,
      toExclusive: query.toExclusive,
    });
    if (query.cycleId) params.set("cycleId", query.cycleId);
    const comparisonRequest =
      query.comparisonCycleA && query.comparisonCycleB
        ? request<CycleComparison>(
            `/api/farms/${farmId}/analytics/cycle-comparison?${new URLSearchParams(
              {
                cycleIdA: query.comparisonCycleA,
                cycleIdB: query.comparisonCycleB,
                from: query.from,
                toExclusive: query.toExclusive,
              },
            )}`,
          )
        : Promise.resolve(null);
    Promise.all([
      request<CycleSummary[]>(`/api/farms/${farmId}/cycles`),
      request<ProductionAnalytics>(
        `/api/farms/${farmId}/analytics/production?${params}`,
      ),
      request<AdvancedAnalytics>(
        `/api/farms/${farmId}/analytics/advanced?${new URLSearchParams({
          from: query.from,
          toExclusive: query.toExclusive,
        })}`,
      ),
      comparisonRequest,
    ])
      .then(([cycleRows, result, advancedResult, comparisonResult]) => {
        if (current) {
          setCycles(cycleRows);
          setSummary(result);
          setAdvanced(advancedResult);
          setComparison(comparisonResult);
        }
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Analitik gagal dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, query, revision]);
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (from >= toExclusive) {
      setError("Tanggal akhir harus setelah tanggal mulai.");
      return;
    }
    if (Boolean(comparisonCycleA) !== Boolean(comparisonCycleB)) {
      setError("Pilih dua siklus untuk dibandingkan.");
      return;
    }
    if (comparisonCycleA && comparisonCycleA === comparisonCycleB) {
      setError("Pilih dua siklus yang berbeda.");
      return;
    }
    setQuery({
      from,
      toExclusive,
      cycleId,
      comparisonCycleA,
      comparisonCycleB,
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="Ringkasan data"
        title="Analitik"
        visual="records"
        description="Bandingkan produksi bulanan dan biaya tercatat dari transaksi yang sudah diposting, dengan periode yang dapat diatur."
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm untuk melihat analitik.
        </StatePanel>
      )}
      {error && (
        <StatePanel
          kind="error"
          title="Analitik belum dapat dimuat"
          onRetry={() => setRevision((value) => value + 1)}
        >
          {error}
        </StatePanel>
      )}
      {farmId && (
        <div className="inventory-grid">
          <div className="inventory-main">
            {loading && (
              <StatePanel kind="loading" title="Memuat analitik">
                Menghitung data panen.
              </StatePanel>
            )}
            <Card title="Produksi per siklus" className="inventory-list-card">
              {summary && (
                <p>
                  Periode mulai {summary.from}, sebelum {summary.toExclusive}.
                  Data dihitung sampai{" "}
                  {new Date(summary.asOf).toLocaleString("id-ID")}.
                </p>
              )}
              <DataTable
                caption="Produksi yang diposting"
                rows={summary?.rows ?? []}
                rowKey={(row) => `${row.cycleId}-${row.unit}`}
                emptyMessage="Tidak ada panen yang diposting pada periode ini."
                columns={[
                  {
                    key: "cycle",
                    label: "Siklus",
                    render: (row) => (
                      <Link to={`/cycles/${row.cycleId}`}>{row.cycleName}</Link>
                    ),
                  },
                  {
                    key: "commodity",
                    label: "Komoditas",
                    render: (row) => row.commodityName,
                  },
                  {
                    key: "type",
                    label: "Cabang",
                    render: (row) =>
                      ({ FISH: "Ikan", CHICKEN: "Ayam", CROP: "Tanaman" })[
                        row.farmingType
                      ] ?? row.farmingType,
                  },
                  {
                    key: "quantity",
                    label: "Produksi",
                    render: (row) => (
                      <strong>
                        {row.quantity} {row.unit}
                      </strong>
                    ),
                  },
                  {
                    key: "harvests",
                    label: "Kejadian panen",
                    render: (row) => row.harvestCount,
                  },
                ]}
              />
            </Card>
            <Card title="Metrik lanjutan">
              <div className="analytics-unavailable">
                <p>
                  <strong>Tingkat hidup:</strong>{" "}
                  {metricText(summary?.survival)}
                </p>
                <p>
                  <strong>Pertumbuhan:</strong> {metricText(summary?.growth)}
                </p>
                <p>
                  <strong>Efisiensi pakan:</strong>{" "}
                  {metricText(summary?.feedEfficiency)}
                </p>
                <p>
                  <strong>Pendapatan diterima:</strong>{" "}
                  {moneyMetricText(summary?.revenue)}
                </p>
                <p>
                  <strong>HPP / COGS:</strong> {moneyMetricText(summary?.hpp)}
                </p>
                <p>
                  <strong>Laba kotor:</strong>{" "}
                  {moneyMetricText(summary?.profit)}
                </p>
                <p className="list-meta">
                  Filter siklus hanya membatasi tabel produksi per siklus; tren,
                  rincian biaya, dan metrik keuangan tetap mencakup seluruh farm
                  pada periode ini.
                </p>
              </div>
            </Card>
            <Card title="Tren produksi bulanan">
              <p className="list-meta">
                Jumlah dikelompokkan menurut komoditas dan satuan. Bulan di awal
                atau akhir periode dapat mencakup sebagian bulan.
              </p>
              <DataTable
                caption="Tren produksi per bulan"
                rows={advanced?.productionTrend ?? []}
                rowKey={(row) => `${row.period}-${row.commodityId}-${row.unit}`}
                emptyMessage="Belum ada panen yang diposting pada periode ini."
                columns={[
                  {
                    key: "period",
                    label: "Bulan",
                    render: (row) =>
                      new Date(`${row.period}T00:00:00`).toLocaleDateString(
                        "id-ID",
                        { month: "long", year: "numeric" },
                      ),
                  },
                  {
                    key: "commodity",
                    label: "Komoditas",
                    render: (row) => row.commodityName,
                  },
                  {
                    key: "production",
                    label: "Produksi",
                    render: (row) => (
                      <strong>
                        {row.quantity} {row.unit}
                      </strong>
                    ),
                  },
                  {
                    key: "harvests",
                    label: "Kejadian panen",
                    render: (row) => row.harvestCount,
                  },
                ]}
              />
            </Card>
            <Card title="Rincian biaya tercatat">
              <p className="list-meta">
                Menampilkan biaya POSTED menurut kategori input; nilai ini bukan
                HPP atau total biaya yang belum dicatat.
              </p>
              <DataTable
                caption="Biaya tercatat per kategori"
                rows={advanced?.recordedCostBreakdown ?? []}
                rowKey={(row) => `${row.category}-${row.treatment}`}
                emptyMessage="Belum ada biaya POSTED pada periode ini."
                columns={[
                  {
                    key: "category",
                    label: "Kategori",
                    render: (row) => row.category,
                  },
                  {
                    key: "treatment",
                    label: "Klasifikasi",
                    render: (row) => row.treatment,
                  },
                  {
                    key: "amount",
                    label: "Jumlah tercatat",
                    render: (row) => (
                      <strong>
                        Rp{" "}
                        {new Intl.NumberFormat("id-ID").format(
                          BigInt(row.amountMinor),
                        )}
                      </strong>
                    ),
                  },
                  {
                    key: "entries",
                    label: "Entri",
                    render: (row) => row.entryCount,
                  },
                ]}
              />
            </Card>
            <Card title="Transfer air tercatat">
              <p className="list-meta">
                Jumlah liter yang dicatat manual, dikelompokkan per bulan, kolam
                sumber, dan area tanam tujuan. Total adalah penjumlahan catatan
                transfer pada periode yang dipilih; angka ini bukan estimasi
                penghematan atau ukuran efisiensi. Snapshot data:{" "}
                {advanced
                  ? new Date(advanced.asOf).toLocaleString("id-ID")
                  : "menunggu data"}
                .
              </p>
              <DataTable
                caption="Volume transfer air per bulan dan pasangan unit"
                rows={advanced?.recordedWaterTransfers ?? []}
                rowKey={(row) =>
                  `${row.period}-${row.sourceUnitId}-${row.targetUnitId}`
                }
                emptyMessage="Belum ada transfer air yang tercatat pada periode ini."
                columns={[
                  {
                    key: "period",
                    label: "Bulan",
                    render: (row) =>
                      new Date(`${row.period}T00:00:00`).toLocaleDateString(
                        "id-ID",
                        { month: "long", year: "numeric" },
                      ),
                  },
                  {
                    key: "units",
                    label: "Unit",
                    render: (row) => (
                      <>
                        {row.sourceUnitName} → {row.targetUnitName}
                        <small className="water-transfer-note">
                          {row.sourceUnitId} → {row.targetUnitId}
                        </small>
                      </>
                    ),
                  },
                  {
                    key: "volume",
                    label: "Volume tercatat",
                    render: (row) => (
                      <strong>{row.quantityLiters} liter</strong>
                    ),
                  },
                  {
                    key: "count",
                    label: "Catatan",
                    render: (row) => row.transferCount,
                  },
                  {
                    key: "sources",
                    label: "Sumber",
                    render: (row) =>
                      sourceDetails(row.transferIds, "ID transfer"),
                  },
                ]}
              />
            </Card>
            <Card title="Limbah masuk batch maggot">
              <p className="list-meta">
                Jumlah limbah yang dicatat sebagai input batch, dikelompokkan
                menurut bulan UTC dan satuan. Ini adalah jumlah input tercatat,
                bukan rasio pemanfaatan atau efisiensi.
              </p>
              <DataTable
                caption="Input limbah batch maggot per bulan dan satuan"
                rows={advanced?.maggotWasteInputs ?? []}
                rowKey={(row) => `${row.period}-${row.unit}`}
                emptyMessage="Belum ada limbah yang dicatat sebagai input batch pada periode ini."
                columns={[
                  {
                    key: "period",
                    label: "Bulan (UTC)",
                    render: (row) =>
                      new Date(`${row.period}T00:00:00`).toLocaleDateString(
                        "id-ID",
                        { month: "long", year: "numeric", timeZone: "UTC" },
                      ),
                  },
                  {
                    key: "quantity",
                    label: "Input tercatat",
                    render: (row) => (
                      <strong>
                        {row.quantity} {row.unit}
                      </strong>
                    ),
                  },
                  {
                    key: "count",
                    label: "Catatan input",
                    render: (row) => row.inputCount,
                  },
                  {
                    key: "sources",
                    label: "Sumber",
                    render: (row) => (
                      <>
                        {sourceDetails(row.inputIds, "ID input")}
                        {sourceDetails(row.wasteIds, "ID limbah")}
                        {sourceDetails(row.batchIds, "ID batch")}
                      </>
                    ),
                  },
                ]}
              />
            </Card>
            <Card title="Hasil maggot tercatat">
              <p className="list-meta">
                Jumlah hasil panen maggot yang dicatat, dikelompokkan menurut
                bulan UTC dan satuan. Angka ini tidak menyatakan hasil yang
                sudah dipakai atau diposting sebagai stok.
              </p>
              <DataTable
                caption="Hasil maggot per bulan dan satuan"
                rows={advanced?.maggotOutputs ?? []}
                rowKey={(row) => `${row.period}-${row.unit}`}
                emptyMessage="Belum ada hasil maggot yang dicatat pada periode ini."
                columns={[
                  {
                    key: "period",
                    label: "Bulan (UTC)",
                    render: (row) =>
                      new Date(`${row.period}T00:00:00`).toLocaleDateString(
                        "id-ID",
                        { month: "long", year: "numeric", timeZone: "UTC" },
                      ),
                  },
                  {
                    key: "quantity",
                    label: "Hasil tercatat",
                    render: (row) => (
                      <strong>
                        {row.quantity} {row.unit}
                      </strong>
                    ),
                  },
                  {
                    key: "count",
                    label: "Catatan hasil",
                    render: (row) => row.outputCount,
                  },
                  {
                    key: "sources",
                    label: "Sumber",
                    render: (row) => (
                      <>
                        {sourceDetails(row.outputIds, "ID hasil")}
                        {sourceDetails(row.batchIds, "ID batch")}
                      </>
                    ),
                  },
                ]}
              />
            </Card>
            <Card title="Perbandingan siklus">
              {!comparison ? (
                <p className="list-meta">
                  Pilih dua siklus pada panel filter untuk membandingkan hasil
                  panen dan biaya yang tercatat.
                </p>
              ) : (
                <>
                  <p className="list-meta">
                    Periode {comparison.from} sampai sebelum{" "}
                    {comparison.toExclusive}. Snapshot{" "}
                    {new Date(comparison.asOf).toLocaleString("id-ID")}.
                    Produksi adalah jumlah panen POSTED menurut komoditas dan
                    satuan. Biaya adalah jumlah entri POSTED yang tertaut
                    langsung ke siklus; biaya farm-wide tidak dialokasikan.
                  </p>
                  <div className="analytics-comparison-grid">
                    {comparison.cycles.map((cycle) => (
                      <section
                        className="analytics-cycle-column"
                        key={cycle.cycleId}
                      >
                        <h3>{cycle.name}</h3>
                        <p className="list-meta">
                          {cycle.commodityName} ·{" "}
                          {farmingTypeLabel[cycle.farmingType]} · {cycle.status}{" "}
                          · mulai {cycle.startDate}
                        </p>
                        <DataTable
                          caption={`Produksi ${cycle.name}`}
                          rows={cycle.production}
                          rowKey={(row) => `${row.commodityId}-${row.unit}`}
                          emptyMessage="Belum ada panen POSTED pada periode ini."
                          columns={[
                            {
                              key: "commodity",
                              label: "Komoditas",
                              render: (row) => row.commodityName,
                            },
                            {
                              key: "quantity",
                              label: "Produksi",
                              render: (row) => `${row.quantity} ${row.unit}`,
                            },
                            {
                              key: "harvests",
                              label: "Panen",
                              render: (row) => row.harvestCount,
                            },
                            {
                              key: "sources",
                              label: "Sumber",
                              render: (row) =>
                                sourceDetails(row.harvestIds, "ID panen"),
                            },
                          ]}
                        />
                        <DataTable
                          caption={`Biaya POSTED ${cycle.name}`}
                          rows={cycle.costs}
                          rowKey={(row) => `${row.category}-${row.treatment}`}
                          emptyMessage="Belum ada biaya POSTED yang tertaut langsung pada periode ini."
                          columns={[
                            {
                              key: "category",
                              label: "Kategori / klasifikasi",
                              render: (row) =>
                                `${row.category} · ${row.treatment}`,
                            },
                            {
                              key: "amount",
                              label: "Jumlah tercatat",
                              render: (row) =>
                                `Rp ${new Intl.NumberFormat("id-ID").format(BigInt(row.amountMinor))}`,
                            },
                            {
                              key: "entries",
                              label: "Entri",
                              render: (row) => row.entryCount,
                            },
                            {
                              key: "sources",
                              label: "Sumber",
                              render: (row) =>
                                sourceDetails(row.costIds, "ID biaya"),
                            },
                          ]}
                        />
                      </section>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>
          <Card
            title="Filter periode"
            className="form-card inventory-form-card"
          >
            <form onSubmit={apply}>
              <FormField id="analytics-from" label="Mulai (termasuk)">
                <input
                  id="analytics-from"
                  type="date"
                  required
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </FormField>
              <FormField
                id="analytics-to"
                label="Sebelum tanggal (tidak termasuk)"
              >
                <input
                  id="analytics-to"
                  type="date"
                  required
                  value={toExclusive}
                  onChange={(event) => setToExclusive(event.target.value)}
                />
              </FormField>
              <FormField id="analytics-cycle" label="Siklus (opsional)">
                <select
                  id="analytics-cycle"
                  value={cycleId}
                  onChange={(event) => setCycleId(event.target.value)}
                >
                  <option value="">Semua siklus</option>
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.name} · {cycle.commodityName}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="analytics-comparison-a" label="Siklus A">
                <select
                  id="analytics-comparison-a"
                  value={comparisonCycleA}
                  onChange={(event) => setComparisonCycleA(event.target.value)}
                >
                  <option value="">Pilih siklus A</option>
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.name} · {cycle.commodityName}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="analytics-comparison-b" label="Siklus B">
                <select
                  id="analytics-comparison-b"
                  value={comparisonCycleB}
                  onChange={(event) => setComparisonCycleB(event.target.value)}
                >
                  <option value="">Pilih siklus B</option>
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.name} · {cycle.commodityName}
                    </option>
                  ))}
                </select>
              </FormField>
              <p className="list-meta">
                Perbandingan hanya menampilkan data terukur dan tidak
                menjumlahkan satuan berbeda.
              </p>
              <div className="actions">
                <button type="submit">Terapkan filter</button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
