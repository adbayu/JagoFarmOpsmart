import { resolve } from "node:path";
import { createLocalPreview } from "./local-preview.js";
import { startNotificationWorker } from "../modules/notifications/worker.js";
import { startTelemetryRetentionWorker } from "../modules/iot/retention.js";
import { startKnowledgeRetentionWorker } from "../modules/knowledge/retention.js";

const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:5173";
const port = Number(process.env.PORT ?? 3001);
const preview = await createLocalPreview({
  dataDir: resolve(".pglite/preview"),
  origin,
});
const server = preview.app.listen(port, "127.0.0.1", () =>
  console.log(`OpSmart local preview API ready on 127.0.0.1:${port}`),
);
const stopNotificationWorker = startNotificationWorker(preview.db);
const stopTelemetryRetentionWorker = startTelemetryRetentionWorker(preview.db);
const stopKnowledgeRetentionWorker = startKnowledgeRetentionWorker(preview.db);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopNotificationWorker();
    stopTelemetryRetentionWorker();
    stopKnowledgeRetentionWorker();
    server.close(() => void preview.close());
  });
