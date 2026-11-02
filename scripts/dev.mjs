import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const viteCli = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);
const tsxCli = fileURLToPath(
  new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
);
const database = {
  name: process.env.POSTGRES_DB ?? "opsmart",
  user: process.env.POSTGRES_USER ?? "opsmart",
  password: process.env.POSTGRES_PASSWORD ?? "local-development-only",
  port: process.env.POSTGRES_PORT ?? "5432",
};
const databaseUrl = new URL(
  `postgresql://${encodeURIComponent(database.user)}:${encodeURIComponent(database.password)}@127.0.0.1:${database.port}/${encodeURIComponent(database.name)}`,
).toString();
const devEnv = {
  ...process.env,
  APP_ORIGIN: "http://127.0.0.1:5173",
  DATABASE_URL: databaseUrl,
  MIGRATION_DATABASE_URL: databaseUrl,
  NODE_ENV: "development",
  PORT: "3001",
};

const children = new Set();
let stopping = false;

function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

function runOnce(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    children.add(child);
    let settled = false;
    const finish = (code) => {
      children.delete(child);
      if (settled) return;
      settled = true;
      resolve(code);
    };

    child.once("error", (error) => {
      console.error(`Could not start ${command}:`, error.message);
      finish(1);
    });
    child.once("exit", (code, signal) => finish(code ?? (signal ? 1 : 0)));
  });
}

function startService(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  children.add(child);
  child.once("error", (error) => {
    console.error(`Could not start ${command}:`, error.message);
    stopAll(1);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) stopAll(code ?? (signal ? 1 : 0));
  });
}

async function waitForApi() {
  const deadline = Date.now() + 30_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:3001/api/health", {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return true;
    } catch {
      // The API may need a moment to bind its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!stopping) {
    console.error("API did not become ready at http://127.0.0.1:3001.");
    stopAll(1);
  }
  return false;
}

process.on("SIGINT", () => stopAll(130));
process.on("SIGTERM", () => stopAll(143));

console.log("Starting PostgreSQL in Docker...");
const databaseExit = await runOnce("docker", [
  "compose",
  "up",
  "-d",
  "--wait",
  "postgres",
]);
if (stopping || databaseExit !== 0) {
  if (!stopping) stopAll(databaseExit || 1);
} else {
  console.log("Applying database migrations...");
  const migrationExit = await runOnce(
    process.execPath,
    [tsxCli, "scripts/migrate.ts"],
    devEnv,
  );
  if (stopping || migrationExit !== 0) {
    if (!stopping) stopAll(migrationExit || 1);
  } else {
    console.log("Starting API...");
    startService(process.execPath, [tsxCli, "src/server/main.ts"], devEnv);
    if (await waitForApi()) {
      console.log("Starting frontend...");
      startService(
        process.execPath,
        [
          viteCli,
          "--configLoader",
          "runner",
          "--host",
          "127.0.0.1",
          "--strictPort",
        ],
        devEnv,
      );
    }
  }
}
