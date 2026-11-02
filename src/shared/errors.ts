export const errorMessages = {
  VALIDATION: "Data tidak valid.",
  UNAUTHORIZED: "Silakan masuk terlebih dahulu.",
  FORBIDDEN: "Anda tidak memiliki akses ke farm ini.",
  NOT_FOUND: "Data tidak ditemukan.",
  CONFLICT:
    "Data berubah atau permintaan bertentangan dengan catatan sebelumnya.",
  INSUFFICIENT_STOCK: "Stok tidak mencukupi.",
  STANDUP_CLOSED:
    "Pengisian standup ditutup. Laporan hanya dapat diubah pada hari kerja sebelum pukul 12.00 WIB.",
  INTERNAL: "Permintaan gagal disimpan. Silakan coba lagi.",
} as const;
export type ErrorCode = keyof typeof errorMessages;
export class DomainError extends Error {
  constructor(public code: ErrorCode) {
    super(errorMessages[code]);
  }
}

export const httpStatus: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  STANDUP_CLOSED: 409,
  INTERNAL: 500,
};
