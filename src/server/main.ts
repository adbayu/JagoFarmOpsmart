import pg from "pg";
import { createApp } from "./app.js";
import { postgresDatabase } from "./db.js";
import { createLocalAuth } from "./identity.js";
import { startNotificationWorker } from "../modules/notifications/worker.js";
import { startTelemetryRetentionWorker } from "../modules/iot/retention.js";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env");
const production = process.env.NODE_ENV === "production";
const origin =
  process.env.APP_ORIGIN ?? (production ? "" : "http://127.0.0.1:5173");
if (!origin || (production && !origin.startsWith("https://")))
  throw new Error(
    "Set APP_ORIGIN to the HTTPS application origin in production",
  );
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
const db = postgresDatabase(pool);
const auth = createLocalAuth(db, { origin, secureCookies: production });
const app = createApp(db, auth.resolveIdentity, auth);
const stopNotificationWorker = startNotificationWorker(db);
const stopTelemetryRetentionWorker = startTelemetryRetentionWorker(db);
const server = app.listen(Number(process.env.PORT ?? 3001), "127.0.0.1", () =>
  console.log("OpSmart API ready"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopNotificationWorker();
    stopTelemetryRetentionWorker();
    server.close(() => {
      void pool.end();
    });
  });
