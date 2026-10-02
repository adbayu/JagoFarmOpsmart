import { z } from "zod";
import { dateOnly, moneyMinor, uuid } from "../../shared/validation.js";
export const recordPaymentInput = z.strictObject({
  idempotencyKey: uuid,
  sourceKey: z.string().trim().min(1).max(200),
  amountMinor: moneyMinor.refine((value) => value !== "0"),
  paymentDate: dateOnly,
  notes: z.string().trim().max(2000).optional(),
});
export const recordRefundInput = recordPaymentInput.safeExtend({
  reason: z.string().trim().min(1).max(500),
});
export const cancelPaymentInput = z.strictObject({
  idempotencyKey: uuid,
  reason: z.string().trim().min(1).max(500),
});
export type PaymentSummary = {
  id: string;
  saleId: string;
  kind: "PAYMENT" | "REFUND";
  amountMinor: string;
  paymentDate: string;
  sourceKey: string;
  notes: string | null;
  reason: string | null;
  status: "POSTED" | "CANCELLED";
  cancelReason: string | null;
  createdAt: string;
};
export type PaymentBalance = {
  saleId: string;
  saleTotalMinor: string;
  netReceivedMinor: string;
  status: "UNPAID" | "PARTIAL" | "PAID";
  payments: PaymentSummary[];
};
