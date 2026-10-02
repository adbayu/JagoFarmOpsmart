import type { Database } from "../../server/db.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import type { PaymentBalance, PaymentSummary } from "./payment-contracts.js";

type Row = {
  id: string;
  sale_id: string;
  kind: PaymentSummary["kind"];
  amount_minor: string;
  payment_date: string;
  source_key: string;
  notes: string | null;
  reason: string | null;
  status: PaymentSummary["status"];
  cancel_reason: string | null;
  created_at: string;
};
export async function getPaymentBalance(
  db: Database,
  actorId: string,
  farmId: string,
  saleId: string,
): Promise<PaymentBalance> {
  uuid.parse(actorId);
  uuid.parse(farmId);
  uuid.parse(saleId);
  return db.transaction(async (tx) => {
    const owner = await tx.query<{ id: string }>(
      "SELECT f.id FROM farm f JOIN farm_membership m ON m.farm_id=f.id AND m.user_id=$2 WHERE f.id=$1 AND f.archived_at IS NULL",
      [farmId, actorId],
    );
    if (!owner.rows[0]) throw new DomainError("FORBIDDEN");
    const sale = await tx.query<{ total_minor: string }>(
      "SELECT total_minor::text AS total_minor FROM sale WHERE farm_id=$1 AND id=$2",
      [farmId, saleId],
    );
    if (!sale.rows[0]) throw new DomainError("NOT_FOUND");
    const rows = await tx.query<Row>(
      `SELECT id,sale_id,kind,amount_minor::text AS amount_minor,payment_date::text AS payment_date,
       source_key,notes,reason,status,cancel_reason,created_at::text AS created_at
       FROM sale_payment WHERE farm_id=$1 AND sale_id=$2 ORDER BY created_at,id`,
      [farmId, saleId],
    );
    const payments: PaymentSummary[] = rows.rows.map((row) => ({
      id: row.id,
      saleId: row.sale_id,
      kind: row.kind,
      amountMinor: row.amount_minor,
      paymentDate: row.payment_date,
      sourceKey: row.source_key,
      notes: row.notes,
      reason: row.reason,
      status: row.status,
      cancelReason: row.cancel_reason,
      createdAt: row.created_at,
    }));
    const net = rows.rows
      .filter((row) => row.status === "POSTED")
      .reduce(
        (total, row) =>
          total +
          (row.kind === "PAYMENT"
            ? BigInt(row.amount_minor)
            : -BigInt(row.amount_minor)),
        0n,
      );
    const total = BigInt(sale.rows[0].total_minor);
    if (net < 0n || net > total) throw new DomainError("CONFLICT");
    return {
      saleId,
      saleTotalMinor: total.toString(),
      netReceivedMinor: net.toString(),
      status: net === 0n ? "UNPAID" : net === total ? "PAID" : "PARTIAL",
      payments,
    };
  });
}
