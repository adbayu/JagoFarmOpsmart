import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  NotificationList,
  NotificationListItem,
} from "../modules/notifications/contracts.js";
import { PageHeader, StatePanel } from "./components/primitives.js";
import { request, useFarms } from "./farms.js";
import { Icon } from "./icons.js";

const pageSize = 25;

const eventLabels: Record<NotificationListItem["eventType"], string> = {
  SCHEDULE_REMINDER: "Pengingat jadwal",
  SCHEDULE_OVERDUE: "Jadwal terlewat",
  LOW_STOCK: "Batas stok minimum",
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function WorkerStatus({ lastSuccessAt }: { lastSuccessAt: string | null }) {
  const lastSuccessMs = lastSuccessAt ? new Date(lastSuccessAt).getTime() : NaN;
  const stale =
    !Number.isFinite(lastSuccessMs) || Date.now() - lastSuccessMs > 120_000;
  return (
    <p className={`notification-worker-state ${stale ? "is-stale" : ""}`}>
      <span aria-hidden="true" />
      {stale
        ? lastSuccessAt
          ? `Pemeriksaan alert terakhir ${formatTimestamp(lastSuccessAt)}.`
          : "Worker belum menjalankan pemeriksaan."
        : `Pemeriksaan alert aktif · terakhir ${formatTimestamp(lastSuccessAt ?? "")}.`}
    </p>
  );
}

export function NotificationPreview({ farmId }: { farmId: string | null }) {
  const [loaded, setLoaded] = useState<{
    farmId: string;
    data: NotificationList;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const data = loaded?.farmId === farmId ? loaded.data : null;

  useEffect(() => {
    if (!farmId) {
      setLoaded(null);
      setError(null);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    request<NotificationList>(
      `/api/farms/${farmId}/notifications?limit=4&offset=0`,
    )
      .then((result) => {
        if (current) setLoaded({ farmId, data: result });
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Gagal memuat notifikasi.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [farmId, reloadKey]);

  if (!farmId) return <p>Pilih atau buat farm untuk melihat notifikasi.</p>;
  if (error)
    return (
      <div className="notification-preview-error" role="alert">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          Coba lagi
        </button>
      </div>
    );
  if (loading || !data) return <p role="status">Memuat notifikasi…</p>;
  if (!data?.items.length)
    return (
      <>
        <WorkerStatus lastSuccessAt={data?.workerLastSuccessAt ?? null} />
        <p>Belum ada notifikasi untuk farm ini.</p>
      </>
    );
  return (
    <>
      <WorkerStatus lastSuccessAt={data.workerLastSuccessAt} />
      {data.items.map((item) => (
        <div className="notification-preview-row" key={item.id}>
          <Link to={item.payload.href}>
            <strong>{item.payload.title}</strong>
            <small>{item.payload.description}</small>
          </Link>
          {item.readAt === null && (
            <span
              className="notification-unread-mark"
              aria-label="Belum dibaca"
            />
          )}
        </div>
      ))}
    </>
  );
}

export function NotificationsPage({
  state,
}: {
  state: ReturnType<typeof useFarms>;
}) {
  const [loaded, setLoaded] = useState<{
    farmId: string;
    data: NotificationList;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const data = loaded?.farmId === state.activeId ? loaded.data : null;

  useEffect(() => {
    setOffset(0);
    setLoaded(null);
    setHasMore(false);
    setActionError(null);
  }, [state.activeId]);

  useEffect(() => {
    const farmId = state.activeId;
    if (!farmId) {
      setLoaded(null);
      setError(null);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(null);
    request<NotificationList>(
      `/api/farms/${farmId}/notifications?limit=${pageSize}&offset=${offset}`,
    )
      .then((result) => {
        if (!current) return;
        setLoaded((previous) => ({
          farmId,
          data: {
            ...result,
            items:
              offset === 0
                ? result.items
                : [
                    ...(previous?.farmId === farmId ? previous.data.items : []),
                    ...result.items,
                  ],
          },
        }));
        setHasMore(result.items.length === pageSize);
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Gagal memuat notifikasi.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [state.activeId, offset, reloadKey]);

  async function markRead(notificationId: string) {
    const farmId = state.activeId;
    if (!farmId || pendingId) return;
    setPendingId(notificationId);
    setActionError(null);
    try {
      const result = await request<{ readAt: string }>(
        `/api/farms/${farmId}/notifications/${notificationId}/read`,
        "POST",
      );
      setLoaded((previous) =>
        previous?.farmId === farmId
          ? {
              farmId,
              data: {
                ...previous.data,
                unreadCount: Math.max(0, previous.data.unreadCount - 1),
                items: previous.data.items.map((item) =>
                  item.id === notificationId
                    ? { ...item, readAt: result.readAt }
                    : item,
                ),
              },
            }
          : previous,
      );
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Gagal memperbarui notifikasi.",
      );
    } finally {
      setPendingId(null);
    }
  }

  function reload() {
    setOffset(0);
    setReloadKey((value) => value + 1);
  }

  return (
    <div className="notification-page">
      <PageHeader
        eyebrow="Ruang kerja"
        title="Notifikasi"
        description="Pengingat jadwal dan perubahan stok untuk farm aktif."
      />
      {state.error ? (
        <StatePanel
          kind="error"
          title="Farm tidak dapat dimuat"
          onRetry={() => void state.reload()}
        >
          {state.error}
        </StatePanel>
      ) : state.loading ? (
        <StatePanel kind="loading" title="Memuat farm aktif…" />
      ) : !state.activeId ? (
        <StatePanel kind="empty" title="Pilih farm untuk membuka inbox">
          <Link to="/farms">Buat atau pilih farm</Link>
        </StatePanel>
      ) : error ? (
        <StatePanel
          kind="error"
          title="Notifikasi belum dapat dimuat"
          onRetry={reload}
        >
          {error}
        </StatePanel>
      ) : (
        <>
          <section
            className="card notification-inbox"
            aria-labelledby="inbox-title"
          >
            <div className="notification-inbox-heading">
              <div>
                <p className="eyebrow">Inbox farm</p>
                <h2 id="inbox-title">Pembaruan terbaru</h2>
              </div>
              <span className="notification-count">
                {data?.unreadCount ?? 0} belum dibaca
              </span>
            </div>
            {data && <WorkerStatus lastSuccessAt={data.workerLastSuccessAt} />}
            {actionError && (
              <p className="notification-action-error" role="alert">
                {actionError}
              </p>
            )}
            {loading && !data ? (
              <StatePanel kind="loading" title="Memuat notifikasi…" />
            ) : data?.items.length ? (
              <ul className="notification-list">
                {data.items.map((item) => (
                  <li
                    className={`notification-row ${item.readAt ? "is-read" : "is-unread"}`}
                    key={item.id}
                  >
                    <span
                      className={`notification-icon ${item.eventType.toLowerCase()}`}
                    >
                      <Icon
                        name={
                          item.eventType === "LOW_STOCK"
                            ? "package"
                            : "calendar"
                        }
                        size={20}
                      />
                    </span>
                    <div className="notification-copy">
                      <p className="notification-kind">
                        {eventLabels[item.eventType]}
                      </p>
                      <h3>{item.payload.title}</h3>
                      <p>{item.payload.description}</p>
                      <div className="notification-meta">
                        <time dateTime={item.createdAt}>
                          {formatTimestamp(item.createdAt)}
                        </time>
                        <span>{item.payload.sourceLabel}</span>
                        {item.resolvedAt && (
                          <span className="resolved-label">Pulih</span>
                        )}
                      </div>
                    </div>
                    <div className="notification-actions">
                      <Link to={item.payload.href}>Buka sumber</Link>
                      {item.readAt ? (
                        <span className="read-label">Sudah dibaca</span>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingId !== null}
                          onClick={() => void markRead(item.id)}
                        >
                          {pendingId === item.id
                            ? "Menyimpan…"
                            : "Tandai dibaca"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <StatePanel kind="empty" title="Belum ada notifikasi">
                Pengingat jadwal dan alert stok akan muncul di sini.
              </StatePanel>
            )}
            {loading && data && <p role="status">Memuat notifikasi lainnya…</p>}
            {hasMore && !loading && (
              <button
                className="notification-load-more"
                type="button"
                onClick={() => setOffset((value) => value + pageSize)}
              >
                Muat notifikasi sebelumnya
              </button>
            )}
          </section>
          <div className="notification-footer-link">
            <Link to="/dashboard">Kembali ke dashboard</Link>
          </div>
        </>
      )}
    </div>
  );
}
