import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import type {
  DeviceList,
  DeviceMetricSummary,
  DeviceSummary,
} from "../modules/iot/contracts.js";
import type { UnitSummary } from "../modules/farming/contracts.js";
import {
  ConfirmDialog,
  FormField,
  PageHeader,
  StatePanel,
} from "./components/primitives.js";
import { request } from "./farms.js";

type FarmState = {
  activeId: string | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

type MetricDraft = DeviceMetricSummary;
type DeviceCommandResult = {
  deviceId: string;
  name: string;
  farmUnitId: string;
  status: "ACTIVE" | "REVOKED";
  token: string | null;
  secretIssued: boolean;
};

function idempotencyHeader(key: string) {
  return { "Idempotency-Key": key };
}

function formatReceivedAt(value: string | null): string {
  if (!value) return "Belum ada bacaan";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function DeviceCard({
  device,
  farmId,
  onChanged,
  onSecret,
}: {
  device: DeviceSummary;
  farmId: string;
  onChanged: () => Promise<void>;
  onSecret: (
    result: DeviceCommandResult,
    action: "created" | "rotated",
  ) => void;
}) {
  const [name, setName] = useState(device.name);
  const [metrics, setMetrics] = useState<MetricDraft[]>(device.metrics);
  const [renameKey, setRenameKey] = useState(() => crypto.randomUUID());
  const [metricsKey, setMetricsKey] = useState(() => crypto.randomUUID());
  const [rotateKey, setRotateKey] = useState(() => crypto.randomUUID());
  const [revokeKey, setRevokeKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => setName(device.name), [device.name]);
  useEffect(() => setMetrics(device.metrics), [device.metrics]);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending("name");
    setError(null);
    setMessage(null);
    try {
      await request(
        `/api/farms/${farmId}/devices/${device.id}`,
        "PATCH",
        { name },
        idempotencyHeader(renameKey),
      );
      setRenameKey(crypto.randomUUID());
      setMessage("Nama perangkat diperbarui.");
      await onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Gagal mengubah nama perangkat.",
      );
    } finally {
      setPending(null);
    }
  }

  async function saveMetrics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending("metrics");
    setError(null);
    setMessage(null);
    try {
      await request(
        `/api/farms/${farmId}/devices/${device.id}/metrics`,
        "PUT",
        { metrics },
        idempotencyHeader(metricsKey),
      );
      setMetricsKey(crypto.randomUUID());
      setMessage("Konfigurasi metric diperbarui.");
      await onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Gagal menyimpan metric.",
      );
    } finally {
      setPending(null);
    }
  }

  async function rotateToken() {
    if (pending || device.status !== "ACTIVE") return;
    setPending("rotate");
    setError(null);
    setMessage(null);
    try {
      const result = await request<DeviceCommandResult>(
        `/api/farms/${farmId}/devices/${device.id}/token/rotate`,
        "POST",
        undefined,
        idempotencyHeader(rotateKey),
      );
      setRotateKey(crypto.randomUUID());
      onSecret(result, "rotated");
      setMessage("Token perangkat dirotasi.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Gagal merotasi token.",
      );
    } finally {
      setPending(null);
    }
  }

  async function revoke() {
    if (pending || device.status !== "ACTIVE") return;
    setPending("revoke");
    setError(null);
    setMessage(null);
    try {
      await request(
        `/api/farms/${farmId}/devices/${device.id}/revoke`,
        "POST",
        undefined,
        idempotencyHeader(revokeKey),
      );
      setRevokeKey(crypto.randomUUID());
      setConfirmRevoke(false);
      setMessage("Perangkat dicabut. Token lama tidak dapat digunakan lagi.");
      await onChanged();
    } catch (cause) {
      setConfirmRevoke(false);
      setError(
        cause instanceof Error ? cause.message : "Gagal mencabut perangkat.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <article className="device-card">
      <header className="device-card-header">
        <div>
          <h2>{device.name}</h2>
          <p>{device.farmUnitName}</p>
        </div>
        <span
          className={`device-status ${device.status === "ACTIVE" ? "is-active" : "is-revoked"}`}
        >
          {device.status === "ACTIVE" ? "Aktif" : "Dicabut"}
        </span>
      </header>
      <p className="device-last-seen">
        Bacaan terakhir{" "}
        <time dateTime={device.lastReceivedAt ?? undefined}>
          {formatReceivedAt(device.lastReceivedAt)}
        </time>
      </p>
      <ul className="device-metric-list" aria-label={`Metric ${device.name}`}>
        {device.metrics.length === 0 ? (
          <li>Belum ada metric yang didaftarkan.</li>
        ) : (
          device.metrics.map((metric) => (
            <li key={`${metric.metric}:${metric.unit}`}>
              <span>
                <code>{metric.metric}</code> · {metric.unit}
              </span>
              <span
                className={
                  metric.active ? "metric-state is-active" : "metric-state"
                }
              >
                {metric.active ? "Aktif" : "Nonaktif"}
              </span>
            </li>
          ))
        )}
      </ul>
      {error && (
        <p className="device-feedback error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="device-feedback success" role="status">
          {message}
        </p>
      )}
      <details className="device-settings">
        <summary>Pengaturan perangkat</summary>
        <div className="device-settings-content">
          <form className="device-form" onSubmit={saveName}>
            <FormField id={`device-${device.id}-name`} label="Nama perangkat">
              <input
                id={`device-${device.id}-name`}
                value={name}
                maxLength={120}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <button
              type="submit"
              disabled={pending !== null || name === device.name}
            >
              {pending === "name" ? "Menyimpan…" : "Simpan nama"}
            </button>
          </form>
          <form className="device-form" onSubmit={saveMetrics}>
            <fieldset className="device-metric-editor">
              <legend>Metric dan satuan</legend>
              {metrics.map((metric, index) => (
                <div className="device-metric-input" key={index}>
                  <FormField
                    id={`device-${device.id}-metric-${index}`}
                    label="Metric"
                  >
                    <input
                      id={`device-${device.id}-metric-${index}`}
                      value={metric.metric}
                      pattern="[a-z][a-z0-9_]{0,63}"
                      title="Gunakan huruf kecil, angka, dan garis bawah."
                      required
                      onChange={(event) =>
                        setMetrics((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, metric: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <FormField
                    id={`device-${device.id}-unit-${index}`}
                    label="Satuan"
                  >
                    <input
                      id={`device-${device.id}-unit-${index}`}
                      value={metric.unit}
                      pattern="[A-Za-z0-9][A-Za-z0-9._/%-]{0,31}"
                      title="Gunakan huruf, angka, titik, garis bawah, garis miring, persen, atau tanda hubung."
                      required
                      onChange={(event) =>
                        setMetrics((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, unit: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <label className="device-metric-toggle">
                    <input
                      type="checkbox"
                      checked={metric.active}
                      onChange={(event) =>
                        setMetrics((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, active: event.target.checked }
                              : item,
                          ),
                        )
                      }
                    />
                    Terima bacaan
                  </label>
                  {metrics.length > 1 && (
                    <button
                      type="button"
                      className="button-danger-text"
                      onClick={() =>
                        setMetrics((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Hapus baris
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setMetrics((current) => [
                    ...current,
                    { metric: "", unit: "", active: true },
                  ])
                }
              >
                Tambah metric
              </button>
            </fieldset>
            <button type="submit" disabled={pending !== null}>
              {pending === "metrics" ? "Menyimpan…" : "Simpan metric"}
            </button>
          </form>
          <div className="device-actions">
            <button
              type="button"
              disabled={pending !== null || device.status !== "ACTIVE"}
              onClick={() => void rotateToken()}
            >
              {pending === "rotate" ? "Merotasi token…" : "Rotasi token"}
            </button>
            <button
              type="button"
              className="button-danger"
              disabled={pending !== null || device.status !== "ACTIVE"}
              onClick={() => setConfirmRevoke(true)}
            >
              Cabut perangkat
            </button>
          </div>
        </div>
      </details>
      <ConfirmDialog
        open={confirmRevoke}
        title="Cabut perangkat?"
        busy={pending === "revoke"}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={() => void revoke()}
      >
        <p>
          Token perangkat akan langsung tidak berlaku dan perangkat tidak dapat
          diaktifkan kembali.
        </p>
      </ConfirmDialog>
    </article>
  );
}

export function DevicesPage({ state }: { state: FarmState }) {
  const farmId = state.activeId;
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [farmUnitId, setFarmUnitId] = useState("");
  const [newMetrics, setNewMetrics] = useState([
    { metric: "water_temperature", unit: "degC" },
  ]);
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [secretResult, setSecretResult] = useState<{
    result: DeviceCommandResult;
    action: "created" | "rotated";
  } | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const unitSequence = useRef(0);
  const secretDialog = useRef<HTMLDialogElement>(null);
  const activeUnits = units.filter((unit) => unit.active);

  const reload = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!farmId) {
      setDevices([]);
      setNextCursor(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await request<DeviceList>(
        `/api/farms/${farmId}/devices?limit=50`,
      );
      if (sequence !== requestSequence.current) return;
      setDevices(page.items);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (sequence === requestSequence.current)
        setError(
          cause instanceof Error ? cause.message : "Gagal memuat perangkat.",
        );
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    setDevices([]);
    setNextCursor(null);
    setLoadingMore(false);
    setMoreError(null);
    void reload();
    return () => {
      requestSequence.current += 1;
    };
  }, [reload]);

  const loadUnits = useCallback(async () => {
    const sequence = ++unitSequence.current;
    if (!farmId) {
      setUnits([]);
      return;
    }
    setUnitsLoading(true);
    setUnitsError(null);
    try {
      const result = await request<UnitSummary[]>(`/api/farms/${farmId}/units`);
      if (sequence === unitSequence.current) setUnits(result);
    } catch (cause) {
      if (sequence === unitSequence.current)
        setUnitsError(
          cause instanceof Error ? cause.message : "Gagal memuat unit farm.",
        );
    } finally {
      if (sequence === unitSequence.current) setUnitsLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    setUnits([]);
    void loadUnits();
    return () => {
      unitSequence.current += 1;
    };
  }, [loadUnits]);

  useEffect(() => {
    const dialog = secretDialog.current;
    if (secretResult && dialog && !dialog.open) dialog.showModal();
    if (!secretResult && dialog?.open) dialog.close();
  }, [secretResult]);

  async function loadMore() {
    if (!farmId || !nextCursor || loadingMore) return;
    const sequence = requestSequence.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await request<DeviceList>(
        `/api/farms/${farmId}/devices?limit=50&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (sequence !== requestSequence.current) return;
      setDevices((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (sequence === requestSequence.current)
        setMoreError(
          cause instanceof Error
            ? cause.message
            : "Gagal memuat perangkat berikutnya.",
        );
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false);
    }
  }

  async function createDevice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!farmId || creating) return;
    setCreating(true);
    setCreateError(null);
    setCreateMessage(null);
    try {
      const result = await request<DeviceCommandResult>(
        `/api/farms/${farmId}/devices`,
        "POST",
        { name, farmUnitId, metrics: newMetrics },
        idempotencyHeader(createKey),
      );
      setCreateKey(crypto.randomUUID());
      setName("");
      setFarmUnitId("");
      setNewMetrics([{ metric: "water_temperature", unit: "degC" }]);
      setCreateMessage("Perangkat berhasil didaftarkan.");
      setSecretResult({ result, action: "created" });
      setCopyMessage(null);
      await reload();
    } catch (cause) {
      setCreateError(
        cause instanceof Error
          ? cause.message
          : "Gagal mendaftarkan perangkat.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function copyToken() {
    const token = secretResult?.result.token;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopyMessage("Token disalin. Simpan di tempat aman sekarang.");
    } catch {
      setCopyMessage(
        "Penyalinan otomatis gagal. Pilih lalu salin token secara manual.",
      );
    }
  }

  function closeSecret() {
    setSecretResult(null);
    setCopyMessage(null);
  }

  return (
    <>
      <PageHeader
        eyebrow="Operasional farm"
        title="Perangkat sensor"
        description="Daftarkan perangkat, atur bacaan yang diterima, dan kelola token koneksinya."
        visual="module"
      />
      {state.loading ? (
        <StatePanel kind="loading" title="Memuat farm">
          Sedang mengambil daftar farm Anda.
        </StatePanel>
      ) : state.error ? (
        <StatePanel
          kind="error"
          title="Farm belum dapat dimuat"
          onRetry={() => void state.reload()}
        >
          {state.error}
        </StatePanel>
      ) : !farmId ? (
        <StatePanel kind="empty" title="Pilih atau buat farm">
          Perangkat terhubung ke satu farm. <Link to="/farms">Kelola farm</Link>{" "}
          untuk melanjutkan.
        </StatePanel>
      ) : (
        <div className="devices-page">
          <section
            className="card device-create-card"
            aria-labelledby="device-create-title"
          >
            <div className="device-section-heading">
              <div>
                <p className="section-kicker">Registry farm</p>
                <h2 id="device-create-title">Daftarkan perangkat</h2>
              </div>
              <p>
                Token dibuat sekali dan hanya ditampilkan saat pendaftaran atau
                rotasi.
              </p>
            </div>
            {unitsError && (
              <div className="device-inline-error" role="alert">
                <span>{unitsError}</span>
                <button type="button" onClick={() => void loadUnits()}>
                  Coba muat unit lagi
                </button>
              </div>
            )}
            {activeUnits.length === 0 && !unitsLoading && !unitsError ? (
              <p className="device-help">
                Tambahkan unit farm terlebih dahulu:{" "}
                <Link to="/farm/fish">Ikan</Link>,{" "}
                <Link to="/farm/chicken">Ayam</Link>, atau{" "}
                <Link to="/farm/crops">Tanaman</Link>.
              </p>
            ) : (
              <form className="device-create-form" onSubmit={createDevice}>
                <FormField id="new-device-name" label="Nama perangkat">
                  <input
                    id="new-device-name"
                    value={name}
                    maxLength={120}
                    required
                    onChange={(event) => setName(event.target.value)}
                  />
                </FormField>
                <FormField id="new-device-unit" label="Unit farm">
                  <select
                    id="new-device-unit"
                    value={farmUnitId}
                    required
                    disabled={unitsLoading || activeUnits.length === 0}
                    onChange={(event) => setFarmUnitId(event.target.value)}
                  >
                    <option value="">Pilih unit farm</option>
                    {activeUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <fieldset className="device-metric-editor device-create-metrics">
                  <legend>Metric yang diterima</legend>
                  {newMetrics.map((metric, index) => (
                    <div className="device-metric-input" key={index}>
                      <FormField
                        id={`new-device-metric-${index}`}
                        label="Metric"
                      >
                        <input
                          id={`new-device-metric-${index}`}
                          value={metric.metric}
                          pattern="[a-z][a-z0-9_]{0,63}"
                          title="Gunakan huruf kecil, angka, dan garis bawah."
                          required
                          onChange={(event) =>
                            setNewMetrics((current) =>
                              current.map((item, i) =>
                                i === index
                                  ? { ...item, metric: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </FormField>
                      <FormField id={`new-device-unit-${index}`} label="Satuan">
                        <input
                          id={`new-device-unit-${index}`}
                          value={metric.unit}
                          pattern="[A-Za-z0-9][A-Za-z0-9._/%-]{0,31}"
                          title="Contoh: degC, %, atau mg/L."
                          required
                          onChange={(event) =>
                            setNewMetrics((current) =>
                              current.map((item, i) =>
                                i === index
                                  ? { ...item, unit: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </FormField>
                      {newMetrics.length > 1 && (
                        <button
                          type="button"
                          className="button-danger-text"
                          onClick={() =>
                            setNewMetrics((current) =>
                              current.filter((_, i) => i !== index),
                            )
                          }
                        >
                          Hapus baris
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setNewMetrics((current) => [
                        ...current,
                        { metric: "", unit: "" },
                      ])
                    }
                  >
                    Tambah metric
                  </button>
                </fieldset>
                <p className="device-help">
                  Gunakan nama metric huruf kecil seperti{" "}
                  <code>water_temperature</code> dan satuan seperti{" "}
                  <code>degC</code>. Perangkat ini hanya menerima bacaan, tidak
                  mengendalikan sensor.
                </p>
                {createError && (
                  <p className="device-feedback error" role="alert">
                    {createError}
                  </p>
                )}
                {createMessage && (
                  <p className="device-feedback success" role="status">
                    {createMessage}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={
                    creating || unitsLoading || activeUnits.length === 0
                  }
                >
                  {creating ? "Mendaftarkan…" : "Daftarkan perangkat"}
                </button>
              </form>
            )}
          </section>

          <section
            className="device-registry"
            aria-labelledby="device-list-title"
          >
            <div className="device-section-heading">
              <div>
                <p className="section-kicker">Farm aktif</p>
                <h2 id="device-list-title">Perangkat terdaftar</h2>
              </div>
              {!loading && !error && (
                <span>{devices.length} perangkat ditampilkan</span>
              )}
            </div>
            {loading ? (
              <StatePanel kind="loading" title="Memuat perangkat">
                Sedang mengambil registry farm.
              </StatePanel>
            ) : error ? (
              <StatePanel
                kind="error"
                title="Perangkat belum dapat dimuat"
                onRetry={() => void reload()}
              >
                {error}
              </StatePanel>
            ) : devices.length === 0 ? (
              <StatePanel kind="empty" title="Belum ada perangkat terdaftar">
                Daftarkan perangkat di atas untuk mulai menerima telemetry.
              </StatePanel>
            ) : (
              <>
                <div className="device-list">
                  {devices.map((device) => (
                    <DeviceCard
                      key={device.id}
                      device={device}
                      farmId={farmId}
                      onChanged={reload}
                      onSecret={(result, action) => {
                        setSecretResult({ result, action });
                        setCopyMessage(null);
                      }}
                    />
                  ))}
                </div>
                {moreError && (
                  <p className="device-feedback error" role="alert">
                    {moreError}
                  </p>
                )}
                {nextCursor && (
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {loadingMore
                      ? "Memuat…"
                      : moreError
                        ? "Coba muat lagi"
                        : "Muat perangkat berikutnya"}
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      )}
      <dialog
        ref={secretDialog}
        className="device-secret-dialog"
        aria-labelledby="device-secret-title"
        onCancel={(event) => {
          event.preventDefault();
          closeSecret();
        }}
      >
        <h2 id="device-secret-title">
          {secretResult?.action === "rotated"
            ? "Token baru perangkat"
            : "Token perangkat"}
        </h2>
        {secretResult?.result.secretIssued && secretResult.result.token ? (
          <>
            <p>
              Salin sekarang dan simpan di tempat aman. Token ini tidak akan
              ditampilkan lagi.
            </p>
            <label
              className="device-secret-label"
              htmlFor="device-secret-token"
            >
              Token untuk {secretResult.result.name}
            </label>
            <textarea
              id="device-secret-token"
              readOnly
              rows={3}
              value={secretResult.result.token}
              onFocus={(event) => event.currentTarget.select()}
            />
            {copyMessage && <p role="status">{copyMessage}</p>}
            <div className="device-actions">
              <button type="button" onClick={() => void copyToken()}>
                Salin token
              </button>
              <button type="button" onClick={closeSecret}>
                Selesai
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              Permintaan ini merupakan pengulangan. Token lama tidak dapat
              ditampilkan lagi.
            </p>
            <p>
              Gunakan “Rotasi token” untuk membuat token baru, lalu salin saat
              dialog terbuka.
            </p>
            <button type="button" onClick={closeSecret}>
              Tutup
            </button>
          </>
        )}
      </dialog>
    </>
  );
}
