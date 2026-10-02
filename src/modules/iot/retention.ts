import type { Database } from "../../server/db.js";

const MAX_BATCH_SIZE = 1000;
const BACKLOG_RETRY_MS = 60_000;
const IDLE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function runTelemetryRetentionTick(
  db: Database,
  batchSize = MAX_BATCH_SIZE,
): Promise<number> {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new RangeError("Telemetry retention batch size must be 1–1000");
  }
  const result = await db.transaction((tx) =>
    tx.query<{ deleted: number | string }>(
      "SELECT purge_expired_telemetry($1) AS deleted",
      [batchSize],
    ),
  );
  const deleted = Number(result.rows[0]?.deleted);
  if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > batchSize) {
    throw new Error("Telemetry retention returned an invalid deletion count");
  }
  return deleted;
}

export function startTelemetryRetentionWorker(
  db: Database,
  batchSize = MAX_BATCH_SIZE,
): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    let nextDelay = BACKLOG_RETRY_MS;
    try {
      const deleted = await runTelemetryRetentionTick(db, batchSize);
      if (deleted < batchSize) nextDelay = IDLE_INTERVAL_MS;
    } catch {
      console.error("Telemetry retention tick failed");
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void run(), nextDelay);
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
