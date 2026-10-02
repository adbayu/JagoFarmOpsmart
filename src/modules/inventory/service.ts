import { randomUUID } from "node:crypto";
import type { Database } from "../../server/db.js";
import { command } from "../../server/command.js";
import type { CommandContext } from "../../shared/domain.js";
import { consumeInput } from "../../shared/validation.js";
import { decimal, scaled } from "../../shared/decimal.js";
import { DomainError } from "../../shared/errors.js";
import { deduct } from "./ledger.js";
import { recordInventoryLevelTransitions } from "../notifications/stock-events.js";

export async function consume(
  db: Database,
  context: CommandContext,
  raw: unknown,
): Promise<{ consumptionId: string; quantity: string }> {
  const input = consumeInput.parse(raw);
  return command(
    db,
    context,
    "inventory.consume",
    input.idempotencyKey,
    input,
    async (tx) => {
      const activity = await tx.query(
        `SELECT a.id FROM activity a JOIN farming_cycle c ON c.farm_id=a.farm_id AND c.id=a.cycle_id
      WHERE a.farm_id=$1 AND a.id=$2 AND a.cycle_id=$3 AND c.status='ACTIVE' AND a.status IN ('SCHEDULED','IN_PROGRESS')`,
        [context.farmId, input.activityId, input.cycleId],
      );
      if (!activity.rows.length) throw new DomainError("CONFLICT");
      const quantity = decimal(
        input.allocations.reduce((sum, a) => sum + scaled(a.quantity), 0n),
      );
      const consumptionId = randomUUID();
      await tx.query(
        "INSERT INTO consumption(id,farm_id,cycle_id,activity_id,inventory_item_id,quantity,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          consumptionId,
          context.farmId,
          input.cycleId,
          input.activityId,
          input.inventoryItemId,
          quantity,
          context.actorId,
        ],
      );
      await deduct(
        tx,
        context,
        input.inventoryItemId,
        input.unit,
        input.allocations,
        { consumptionId },
      );
      await recordInventoryLevelTransitions(tx, context.farmId, [
        input.inventoryItemId,
      ]);
      return { consumptionId, quantity };
    },
  );
}
