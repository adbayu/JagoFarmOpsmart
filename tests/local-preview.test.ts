import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLocalPreview } from "../src/server/local-preview.js";

test("local preview keeps a registered session after its PGlite database reopens", async () => {
  const root = await mkdtemp(join(tmpdir(), "opsmart-preview-"));
  const origin = "http://127.0.0.1:5173";
  let preview: Awaited<ReturnType<typeof createLocalPreview>> | undefined;
  let server: Server | undefined;

  async function start() {
    preview = await createLocalPreview({
      dataDir: join(root, "db"),
      origin,
    });
    server = preview.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return `http://127.0.0.1:${address.port}`;
  }

  async function stop() {
    if (server?.listening)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    await preview?.close();
    server = undefined;
    preview = undefined;
  }

  try {
    const url = await start();
    const registration = await fetch(`${url}/api/auth/register`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Pemilik Preview",
        email: "preview@example.test",
        password: "correct horse battery staple",
      }),
    });
    assert.equal(registration.status, 200);
    const cookie = registration.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    await stop();
    const reopenedUrl = await start();
    const session = await fetch(`${reopenedUrl}/api/auth/me`, {
      headers: { cookie: cookie! },
    });
    assert.equal(session.status, 200);
    assert.equal(
      (await session.json()).data.user.email,
      "preview@example.test",
    );
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
});
