import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthRequestError,
  authRequest,
  isUnauthenticatedAuthError,
} from "../src/client/auth-api.js";
import { request } from "../src/client/farms.js";

test("farm API hides transport errors behind a safe retry message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("private transport detail");
  };
  try {
    await assert.rejects(request("/api/farms"), {
      message: "Layanan farm belum tersedia. Coba lagi nanti.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("account API hides transport errors behind a safe retry message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("private transport detail");
  };
  try {
    await assert.rejects(authRequest("me"), {
      message: "Layanan akun belum tersedia. Coba lagi nanti.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("session API preserves 401 status so the app can treat it as signed out", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: "UNAUTHORIZED", message: "Sesi tidak valid." },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  try {
    await assert.rejects(
      authRequest("me"),
      (error: unknown) =>
        error instanceof Error && "status" in error && error.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("session API preserves server failure status as a retryable error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: "INTERNAL", message: "Layanan akun belum tersedia." },
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  try {
    await assert.rejects(
      authRequest("me"),
      (error: unknown) =>
        error instanceof Error && "status" in error && error.status === 503,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("session API preserves HTTP status when the error body is not JSON", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 503]) {
      globalThis.fetch = async () =>
        new Response("upstream failure", { status });
      await assert.rejects(
        authRequest("me"),
        (error: unknown) =>
          error instanceof Error &&
          "status" in error &&
          error.status === status,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only an authentication 401 means the user is signed out", () => {
  assert.equal(
    isUnauthenticatedAuthError(new AuthRequestError("expired", 401)),
    true,
  );
  assert.equal(
    isUnauthenticatedAuthError(new AuthRequestError("unavailable", 503)),
    false,
  );
  assert.equal(
    isUnauthenticatedAuthError(new Error("network unavailable")),
    false,
  );
});
