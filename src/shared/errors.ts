export const errorMessages = {
  VALIDATION: "Data tidak valid.",
  UNAUTHORIZED: "Silakan masuk terlebih dahulu.",
  FORBIDDEN: "Anda tidak memiliki akses ke farm ini.",
  NOT_FOUND: "Data tidak ditemukan.",
  CONFLICT:
    "Data berubah atau permintaan bertentangan dengan catatan sebelumnya.",
  INSUFFICIENT_STOCK: "Stok tidak mencukupi.",
  RATE_LIMITED: "Terlalu banyak permintaan. Coba lagi sebentar.",
  PAYLOAD_TOO_LARGE: "Ukuran permintaan terlalu besar.",
  INTERNAL: "Permintaan gagal disimpan. Silakan coba lagi.",
} as const;
export type ErrorCode = keyof typeof errorMessages;
export class DomainError extends Error {
  constructor(public code: ErrorCode) {
    super(errorMessages[code]);
  }
}

export class RateLimitedError extends DomainError {
  constructor(public retryAfterSeconds: number) {
    super("RATE_LIMITED");
  }
}
export const httpStatus: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};
