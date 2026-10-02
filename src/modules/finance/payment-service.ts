import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext } from "../../shared/domain.js";
import { assertMoneyRange } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { uuid } from "../../shared/validation.js";
import {
  cancelPaymentInput,
  recordPaymentInput,
  recordRefundInput,
} from "./payment-contracts.js";

async function netReceived(
  tx: Sql,
  farmId: string,
  saleId: string,
): Promise<bigint> {
  const result = await tx.query<{ net: string }>(
    `SELECT COALESCE(sum(CASE WHEN kind='PAYMENT' THEN amount_minor ELSE -amount_minor END),0)::text AS net
     FROM sale_payment WHERE farm_id=$1 AND sale_id=$2 AND status='POSTED'`,
    [farmId, saleId],
  );
  return BigInt(result.rows[0]!.net);
}
async function updateStatus(
  tx: Sql,
  farmId: string,
  saleId: string,
  total: bigint,
) {
  const net = await netReceived(tx, farmId, saleId);
  if (net < 0n || net > total) throw new DomainError("CONFLICT");
  const status = net === 0n ? "UNPAID" : net === total ? "PAID" : "PARTIAL";
  await tx.query(
    "UPDATE sale SET payment_status=$3::payment_status,updated_at=now() WHERE farm_id=$1 AND id=$2",
    [farmId, saleId, status],
  );
  return { netReceivedMinor: net.toString(), status };
}
async function post(
  db: Database,
  context: CommandContext,
  saleId: string,
  raw: unknown,
  kind: "PAYMENT" | "REFUND",
) {
  uuid.parse(saleId);
  const input =
    kind === "PAYMENT"
      ? recordPaymentInput.parse(raw)
      : recordRefundInput.parse(raw);
  const amount = BigInt(input.amountMinor);
  assertMoneyRange(amount);
  return command(
    db,
    context,
    kind === "PAYMENT" ? "payments.record" : "payments.refund",
    input.idempotencyKey,
    { saleId, ...input },
    async (tx) => {
      const result = await tx.query<{ total_minor: string; status: string }>(
        "SELECT total_minor::text AS total_minor,status FROM sale WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, saleId],
      );
      const sale = result.rows[0];
      if (!sale) throw new DomainError("NOT_FOUND");
      if (sale.status !== "COMPLETED") throw new DomainError("CONFLICT");
      const current = await netReceived(tx, context.farmId, saleId);
      const total = BigInt(sale.total_minor);
      if (kind === "PAYMENT" ? current + amount > total : amount > current)
        throw new DomainError("CONFLICT");
      const id = randomUUID();
      await tx.query(
        `INSERT INTO sale_payment(id,farm_id,sale_id,kind,amount_minor,payment_date,source_key,notes,reason,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          context.farmId,
          saleId,
          kind,
          input.amountMinor,
          input.paymentDate,
          input.sourceKey,
          input.notes ?? null,
          "reason" in input ? input.reason : null,
          context.actorId,
        ],
      );
      const balance = await updateStatus(tx, context.farmId, saleId, total);
      return { paymentId: id, ...balance };
    },
  );
}
export const recordPayment = (
  db: Database,
  context: CommandContext,
  saleId: string,
  raw: unknown,
) => post(db, context, saleId, raw, "PAYMENT");
export const recordRefund = (
  db: Database,
  context: CommandContext,
  saleId: string,
  raw: unknown,
) => post(db, context, saleId, raw, "REFUND");
export async function cancelPayment(
  db: Database,
  context: CommandContext,
  paymentId: string,
  raw: unknown,
) {
  uuid.parse(paymentId);
  const input = cancelPaymentInput.parse(raw);
  return command(
    db,
    context,
    "payments.cancel",
    input.idempotencyKey,
    { paymentId, ...input },
    async (tx) => {
      const result = await tx.query<{ sale_id: string; status: string }>(
        "SELECT sale_id,status FROM sale_payment WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, paymentId],
      );
      const payment = result.rows[0];
      if (!payment) throw new DomainError("NOT_FOUND");
      if (payment.status !== "POSTED") throw new DomainError("CONFLICT");
      const sale = await tx.query<{ total_minor: string; status: string }>(
        "SELECT total_minor::text AS total_minor,status FROM sale WHERE farm_id=$1 AND id=$2 FOR UPDATE",
        [context.farmId, payment.sale_id],
      );
      if (!sale.rows[0] || sale.rows[0].status !== "COMPLETED")
        throw new DomainError("CONFLICT");
      await tx.query(
        "UPDATE sale_payment SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,cancel_reason=$4 WHERE farm_id=$1 AND id=$2",
        [context.farmId, paymentId, context.actorId, input.reason],
      );
      const balance = await updateStatus(
        tx,
        context.farmId,
        payment.sale_id,
        BigInt(sale.rows[0].total_minor),
      );
      return { paymentId, ...balance };
    },
  );
}
