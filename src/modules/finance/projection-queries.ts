import type { Sql } from "../../server/db.js";
import type { Metric, MoneyMinor } from "../../shared/domain.js";
import { scaled } from "../../shared/decimal.js";
import { getCycleHppInTransaction } from "./hpp-queries.js";
import type { CycleHppProjection } from "./contracts.js";
import { financePolicyVersion } from "./policy.js";

export type FarmFinanceProjection = {
  revenue: Metric<MoneyMinor>;
  hpp: Metric<MoneyMinor>;
  profit: Metric<MoneyMinor>;
  sourcePaymentIds: string[];
  hppSourcePaymentIds: string[];
  sourceRefundIds: string[];
  sourceSaleIds: string[];
  sourceCostIds: string[];
  sourceHarvestIds: string[];
  sourceMovementIds: string[];
};

type PaymentRow = {
  id: string;
  sale_id: string;
  kind: "PAYMENT" | "REFUND";
  amount_minor: string;
  payment_date: string;
};
type SaleMovementRow = {
  sale_id: string;
  sale_total_minor: string;
  sale_status: "COMPLETED" | "CANCELLED";
  cancelled_date: string | null;
  movement_id: string | null;
  movement_quantity: string | null;
  movement_created_at: string | null;
  reversal_id: string | null;
  reversal_created_at: string | null;
  output_id: string | null;
  cycle_id: string | null;
};
type OutputRow = {
  cycle_id: string;
  output_id: string;
  quantity: string;
  weight_kg: string;
};

function roundedRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export async function getFarmFinanceProjection(
  tx: Sql,
  farmId: string,
  from?: string,
  toExclusive?: string,
): Promise<FarmFinanceProjection> {
  const clock = await tx.query<{ today: string }>(
    "SELECT CURRENT_DATE::text AS today",
  );
  const today = clock.rows[0]!.today;
  const paymentResult = await tx.query<PaymentRow>(
    `SELECT id,sale_id,kind,amount_minor::text AS amount_minor,payment_date::text AS payment_date
     FROM sale_payment WHERE farm_id=$1 AND status='POSTED' AND payment_date<CURRENT_DATE+1
     ORDER BY payment_date,id`,
    [farmId],
  );
  const payments = paymentResult.rows;
  const inPeriod = (date: string) =>
    date <= today &&
    (!from || date >= from) &&
    (!toExclusive || date < toExclusive);
  let revenueMinor = 0n;
  const sourcePaymentIds: string[] = [];
  const sourceRefundIds: string[] = [];
  for (const payment of payments) {
    if (!inPeriod(payment.payment_date)) continue;
    const amount = BigInt(payment.amount_minor);
    if (payment.kind === "PAYMENT") {
      revenueMinor += amount;
      sourcePaymentIds.push(payment.id);
    } else {
      revenueMinor -= amount;
      sourceRefundIds.push(payment.id);
    }
  }
  const grossBySale = new Map<string, bigint>();
  for (const payment of payments)
    if (payment.kind === "PAYMENT")
      grossBySale.set(
        payment.sale_id,
        (grossBySale.get(payment.sale_id) ?? 0n) + BigInt(payment.amount_minor),
      );

  const saleResult = await tx.query<SaleMovementRow>(
    `SELECT s.id AS sale_id,s.total_minor::text AS sale_total_minor,s.status AS sale_status,
       s.cancelled_at::date::text AS cancelled_date,
       m.id AS movement_id,m.quantity_delta::text AS movement_quantity,
       m.created_at::text AS movement_created_at,r.id AS reversal_id,
       r.created_at::text AS reversal_created_at,l.harvest_output_id AS output_id,h.cycle_id
     FROM sale s JOIN sale_item si ON si.farm_id=s.farm_id AND si.sale_id=s.id
     LEFT JOIN inventory_movement m ON m.farm_id=si.farm_id AND m.sale_item_id=si.id AND m.type='STOCK_OUT'
     LEFT JOIN inventory_movement r ON r.farm_id=m.farm_id AND r.reversal_of=m.id AND r.type='REVERSAL'
     LEFT JOIN inventory_lot l ON l.farm_id=m.farm_id AND l.id=m.lot_id
     LEFT JOIN harvest_output o ON o.farm_id=l.farm_id AND o.id=l.harvest_output_id
     LEFT JOIN harvest h ON h.farm_id=o.farm_id AND h.id=o.harvest_id AND h.status='POSTED'
     WHERE s.farm_id=$1 AND s.status IN ('COMPLETED','CANCELLED')
     ORDER BY m.created_at,m.id,si.id`,
    [farmId],
  );
  const allSaleRows = saleResult.rows;
  const relevantSaleIds = new Set(
    payments
      .filter(
        (payment) =>
          payment.kind === "PAYMENT" && inPeriod(payment.payment_date),
      )
      .map((payment) => payment.sale_id),
  );
  for (const row of allSaleRows)
    if (row.cancelled_date && inPeriod(row.cancelled_date))
      relevantSaleIds.add(row.sale_id);
  const saleRows = allSaleRows.filter(
    (row) =>
      relevantSaleIds.has(row.sale_id) &&
      (grossBySale.get(row.sale_id) ?? 0n) > 0n,
  );
  const cycleIds = [
    ...new Set(
      saleRows
        .map((row) => row.cycle_id)
        .filter((cycleId): cycleId is string => !!cycleId),
    ),
  ];
  const cycleHpp = new Map<string, CycleHppProjection>();
  for (const cycleId of cycleIds)
    cycleHpp.set(cycleId, await getCycleHppInTransaction(tx, farmId, cycleId));

  const outputsByCycle = new Map<string, OutputRow[]>();
  if (cycleIds.length) {
    const outputResult = await tx.query<OutputRow>(
      `SELECT h.cycle_id,o.id AS output_id,o.quantity::text AS quantity,o.weight_kg::text AS weight_kg
       FROM harvest_output o JOIN harvest h ON h.farm_id=o.farm_id AND h.id=o.harvest_id
       WHERE o.farm_id=$1 AND h.cycle_id=ANY($2::uuid[]) AND h.status='POSTED'
       ORDER BY h.cycle_id,h.harvest_date,h.id,o.id`,
      [farmId, cycleIds],
    );
    for (const output of outputResult.rows)
      outputsByCycle.set(output.cycle_id, [
        ...(outputsByCycle.get(output.cycle_id) ?? []),
        output,
      ]);
  }
  const outputCost = new Map<string, { amount: bigint; quantity: bigint }>();
  const sourceCostIds = new Set<string>();
  const sourceHarvestIds = new Set<string>();
  const hppSourcePaymentIds = new Set<string>();
  const sourceMovementIds = new Set<string>();
  let hppUnavailableReason: string | undefined;
  if (
    saleRows.some(
      (row) =>
        !row.movement_id ||
        !row.movement_quantity ||
        !row.movement_created_at ||
        !row.output_id ||
        !row.cycle_id,
    )
  )
    hppUnavailableReason =
      "Penjualan mencakup stok yang tidak tertaut ke output panen dengan HPP terukur.";
  for (const [cycleId, outputs] of outputsByCycle) {
    if (hppUnavailableReason) break;
    const projection = cycleHpp.get(cycleId)!;
    if (projection.hpp.status !== "AVAILABLE") {
      hppUnavailableReason = projection.hpp.reason;
      break;
    }
    const totalCost = BigInt(projection.hpp.value.totalProductionCostMinor);
    const totalWeight = scaled(projection.productionWeightKg);
    let allocated = 0n;
    for (const [index, output] of outputs.entries()) {
      const weight = scaled(output.weight_kg);
      const amount =
        index === outputs.length - 1
          ? totalCost - allocated
          : roundedRatio(totalCost * weight, totalWeight);
      allocated += amount;
      outputCost.set(output.output_id, {
        amount,
        quantity: scaled(output.quantity),
      });
    }
    for (const id of projection.hpp.value.sourceCostIds) sourceCostIds.add(id);
    for (const id of projection.hpp.value.sourceHarvestIds)
      sourceHarvestIds.add(id);
  }

  const soldQuantityByOutput = new Map<string, bigint>();
  const grossSaleCogs = new Map<string, bigint>();
  if (!hppUnavailableReason) {
    const outputIds = new Set(outputCost.keys());
    const movementEvents: {
      saleId: string;
      outputId: string;
      movementId: string;
      quantity: bigint;
      kind: "SALE" | "REVERSAL";
      createdAt: string;
    }[] = [];
    for (const row of allSaleRows) {
      if (!row.output_id || !outputIds.has(row.output_id)) continue;
      if (
        !row.movement_id ||
        !row.movement_quantity ||
        !row.movement_created_at
      ) {
        hppUnavailableReason =
          "Pergerakan stok penjualan tidak lengkap untuk mengalokasikan HPP.";
        break;
      }
      const quantity = scaled(
        row.movement_quantity.startsWith("-")
          ? row.movement_quantity.slice(1)
          : row.movement_quantity,
      );
      movementEvents.push({
        saleId: row.sale_id,
        outputId: row.output_id,
        movementId: row.movement_id,
        quantity,
        kind: "SALE",
        createdAt: row.movement_created_at,
      });
      if (row.reversal_id && row.reversal_created_at) {
        movementEvents.push({
          saleId: row.sale_id,
          outputId: row.output_id,
          movementId: row.reversal_id,
          quantity,
          kind: "REVERSAL",
          createdAt: row.reversal_created_at,
        });
        sourceMovementIds.add(row.reversal_id);
      } else if (row.sale_status === "CANCELLED") {
        hppUnavailableReason =
          "Pembatalan penjualan tidak memiliki reversal stok yang dapat ditelusuri.";
        break;
      }
      sourceMovementIds.add(row.movement_id);
    }
    movementEvents.sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        (a.kind === b.kind
          ? a.movementId.localeCompare(b.movementId)
          : a.kind === "SALE"
            ? -1
            : 1),
    );
    for (const event of movementEvents) {
      if (hppUnavailableReason) break;
      const output = outputCost.get(event.outputId)!;
      const currentSold = soldQuantityByOutput.get(event.outputId) ?? 0n;
      const nextSold =
        event.kind === "SALE"
          ? currentSold + event.quantity
          : currentSold - event.quantity;
      if (nextSold < 0n || nextSold > output.quantity) {
        hppUnavailableReason =
          "Kuantitas penjualan melebihi output panen yang dapat dialokasikan.";
        break;
      }
      const beforeCost = roundedRatio(
        output.amount * currentSold,
        output.quantity,
      );
      const afterCost = roundedRatio(output.amount * nextSold, output.quantity);
      soldQuantityByOutput.set(event.outputId, nextSold);
      if (event.kind === "SALE")
        grossSaleCogs.set(
          event.saleId,
          (grossSaleCogs.get(event.saleId) ?? 0n) + afterCost - beforeCost,
        );
    }
  }

  let cogsMinor = 0n;
  const sourceSaleIds = new Set<string>();
  if (!hppUnavailableReason) {
    const paymentsBySale = new Map<string, PaymentRow[]>();
    for (const payment of payments) {
      if (payment.kind !== "PAYMENT") continue;
      paymentsBySale.set(payment.sale_id, [
        ...(paymentsBySale.get(payment.sale_id) ?? []),
        payment,
      ]);
    }
    const saleTotals = new Map<string, bigint>();
    const saleStatus = new Map<string, SaleMovementRow["sale_status"]>();
    const cancelledDate = new Map<string, string>();
    for (const row of saleRows) {
      saleTotals.set(row.sale_id, BigInt(row.sale_total_minor));
      saleStatus.set(row.sale_id, row.sale_status);
      if (row.cancelled_date)
        cancelledDate.set(row.sale_id, row.cancelled_date);
    }
    for (const [saleId, saleCost] of grossSaleCogs) {
      const total = saleTotals.get(saleId) ?? 0n;
      if (total <= 0n) continue;
      let cumulativePaid = 0n;
      let cumulativeCogs = 0n;
      let cogsAtCancellation = 0n;
      const cancellationDate = cancelledDate.get(saleId);
      const gross = paymentsBySale.get(saleId) ?? [];
      for (const payment of gross) {
        const before = cumulativeCogs;
        cumulativePaid += BigInt(payment.amount_minor);
        const eligiblePaid = cumulativePaid > total ? total : cumulativePaid;
        cumulativeCogs = roundedRatio(saleCost * eligiblePaid, total);
        const eventCogs = cumulativeCogs - before;
        if (inPeriod(payment.payment_date)) cogsMinor += eventCogs;
        if (cancellationDate && payment.payment_date <= cancellationDate)
          cogsAtCancellation = cumulativeCogs;
      }
      const cancellationInPeriod =
        saleStatus.get(saleId) === "CANCELLED" &&
        !!cancellationDate &&
        inPeriod(cancellationDate);
      if (cancellationInPeriod) cogsMinor -= cogsAtCancellation;
      const hasPeriodPayment = gross.some((payment) =>
        inPeriod(payment.payment_date),
      );
      if (hasPeriodPayment || cancellationInPeriod) {
        for (const payment of gross)
          if (!cancellationDate || payment.payment_date <= cancellationDate)
            hppSourcePaymentIds.add(payment.id);
        sourceSaleIds.add(saleId);
      }
    }
  }

  const asOf = new Date().toISOString();
  const revenue: Metric<MoneyMinor> = {
    status: "AVAILABLE",
    value: revenueMinor.toString(),
    method: `cash-received:${financePolicyVersion}`,
    asOf,
  };
  const hpp: Metric<MoneyMinor> = hppUnavailableReason
    ? { status: "UNAVAILABLE", reason: hppUnavailableReason }
    : {
        status: "AVAILABLE",
        value: cogsMinor.toString(),
        method: `matched-cycle-cost:${financePolicyVersion}`,
        asOf,
      };
  const profit: Metric<MoneyMinor> =
    hpp.status === "AVAILABLE"
      ? {
          status: "AVAILABLE",
          value: (revenueMinor - BigInt(hpp.value)).toString(),
          method: `cash-revenue-less-matched-hpp:${financePolicyVersion}`,
          asOf,
        }
      : { status: "UNAVAILABLE", reason: hpp.reason };
  return {
    revenue,
    hpp,
    profit,
    sourcePaymentIds,
    hppSourcePaymentIds: [...hppSourcePaymentIds].sort(),
    sourceRefundIds,
    sourceSaleIds: [...sourceSaleIds].sort(),
    sourceCostIds: [...sourceCostIds].sort(),
    sourceHarvestIds: [...sourceHarvestIds].sort(),
    sourceMovementIds: [...sourceMovementIds].sort(),
  };
}
