export type User = { id: string; displayName: string; email: string };
export type AuthData = { user: User; csrfToken: string };
export class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}
export function isUnauthenticatedAuthError(error: unknown) {
  return error instanceof AuthRequestError && error.status === 401;
}
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}
export function getCsrfToken() {
  return csrfToken;
}
export async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(csrfToken && body !== undefined
          ? { "x-csrf-token": csrfToken }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Layanan akun belum tersedia. Coba lagi nanti.");
  }
  if (path === "login" && response.status === 401)
    throw new AuthRequestError(
      "Email atau kata sandi tidak cocok, atau akun sementara dibatasi.",
      response.status,
    );
  let result: { data?: T; error?: { message: string } };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw new AuthRequestError(
      "Layanan akun belum tersedia. Coba lagi nanti.",
      response.status,
    );
  }
  if (!response.ok || !result.data)
    throw new AuthRequestError(
      result.error?.message ?? "Permintaan gagal.",
      response.status,
    );
  return result.data;
}
