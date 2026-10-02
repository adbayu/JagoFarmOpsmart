import { useEffect, useState } from "react";
import type { CycleSummary } from "../../modules/farming/contracts.js";
import type { CycleHppProjection } from "../../modules/finance/contracts.js";
import {
  Card,
  FormField,
  PageHeader,
  StatePanel,
} from "../components/primitives.js";
import { request, useFarms } from "../farms.js";

const money = (value: string) =>
  `Rp ${new Intl.NumberFormat("id-ID").format(BigInt(value))}`;
const moneyPerKg = (value: string) => {
  const [whole, fraction = "000000"] = value.split(".");
  const micros = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  const cents = (micros + 5_000n) / 10_000n;
  return `Rp ${new Intl.NumberFormat("id-ID").format(cents / 100n)},${(cents % 100n).toString().padStart(2, "0")} / kg`;
};

export function HppPage({ state }: { state: ReturnType<typeof useFarms> }) {
  const farmId = state.activeId;
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [projection, setProjection] = useState<CycleHppProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );

  useEffect(() => {
    if (!farmId || state.loading) {
      setCycles([]);
      setCycleId("");
      setProjection(null);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    setProjection(null);
    request<CycleSummary[]>(`/api/farms/${farmId}/cycles`)
      .then((rows) => {
        if (!current) return;
        setCycles(rows);
        setCycleId((selected) =>
          rows.some((cycle) => cycle.id === selected)
            ? selected
            : (rows[0]?.id ?? ""),
        );
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Siklus gagal dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, state.loading, revision]);

  useEffect(() => {
    if (!farmId || !cycleId || state.loading) {
      setProjection(null);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    request<CycleHppProjection>(`/api/farms/${farmId}/finance/hpp/${cycleId}`)
      .then((result) => {
        if (current) setProjection(result);
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "HPP gagal dimuat.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, cycleId, state.loading, revision]);

  async function markComplete() {
    if (!farmId || !cycleId || pending) return;
    setPending(true);
    setError(null);
    try {
      await request(
        `/api/farms/${farmId}/finance/hpp/${cycleId}/cost-complete`,
        "POST",
        { idempotencyKey },
      );
      setIdempotencyKey(crypto.randomUUID());
      setRevision((current) => current + 1);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Konfirmasi belum dapat dipastikan. Coba lagi dengan data yang sama.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Keuangan"
        title="HPP"
        visual="farm"
        description="Hitung biaya produksi per kilogram dari biaya siklus dan panen yang dapat ditelusuri."
      />
      {!state.loading && !farmId && (
        <StatePanel kind="empty" title="Belum ada farm aktif">
          Pilih farm untuk melihat HPP.
        </StatePanel>
      )}
      {error && (
        <StatePanel
          kind="error"
          title="Data HPP belum dapat dimuat"
          onRetry={() => setRevision((current) => current + 1)}
        >
          {error}
        </StatePanel>
      )}
      {farmId && (
        <div className="inventory-grid">
          <div className="inventory-main">
            {loading && (
              <StatePanel kind="loading" title="Menghitung HPP">
                Mengambil biaya, konsumsi, dan output panen siklus.
              </StatePanel>
            )}
            {!loading && cycles.length === 0 && (
              <StatePanel kind="empty" title="Belum ada siklus">
                Buat siklus dan catat panen sebelum menghitung HPP.
              </StatePanel>
            )}
            {projection && (
              <Card title={`Hasil · ${projection.cycleName}`}>
                {projection.hpp.status === "AVAILABLE" ? (
                  <>
                    <p>
                      <strong>HPP produksi:</strong>{" "}
                      {moneyPerKg(projection.hpp.value.costPerUnitMinor)}
                    </p>
                    <p>
                      {money(projection.hpp.value.totalProductionCostMinor)}{" "}
                      biaya produksi untuk {projection.productionWeightKg} kg
                      panen.
                    </p>
                    <p className="list-meta">
                      Metode {projection.hpp.method}; versi kebijakan{" "}
                      {projection.hpp.method.split(":").at(-1)}. Sumber:{" "}
                      {projection.hpp.value.sourceCostIds.length} catatan biaya,{" "}
                      {projection.hpp.value.sourceHarvestIds.length} panen.
                    </p>
                  </>
                ) : (
                  <StatePanel kind="empty" title="HPP belum tersedia">
                    {projection.hpp.reason}
                  </StatePanel>
                )}
                <p>
                  Konfirmasi lengkap berarti semua biaya produksi siklus sudah
                  dicatat. Biaya atau konsumsi baru akan membuat konfirmasi
                  usang.
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void markComplete()}
                >
                  {pending ? "Menyimpan…" : "Tandai biaya siklus lengkap"}
                </button>
                <p className="list-meta">
                  COGS hanya diakui untuk panen yang sudah dialokasikan ke
                  penjualan.
                </p>
              </Card>
            )}
          </div>
          <Card title="Pilih siklus" className="form-card inventory-form-card">
            <FormField id="hpp-cycle" label="Siklus">
              <select
                id="hpp-cycle"
                value={cycleId}
                onChange={(event) => setCycleId(event.target.value)}
              >
                {cycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name} · {cycle.commodityName}
                  </option>
                ))}
              </select>
            </FormField>
            <p className="list-meta">
              HPP menunggu biaya bertreatment produksi dan berat untuk semua
              panen yang diposting.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
