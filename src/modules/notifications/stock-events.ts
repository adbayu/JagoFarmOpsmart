import { randomUUID } from "node:crypto";
import type { Sql } from "../../server/db.js";
import { scaled } from "../../shared/decimal.js";

type InventoryItem = {
  name: string;
  unit: string;
  minimum_stock: string;
  active: boolean;
};

type InventoryState = {
  is_low: boolean;
  episode_count: string;
};

/** Reconcile each distinct item after the full source command writes its movements. */
export async function recordInventoryLevelTransitions(
  tx: Sql,
  farmId: string,
  itemIds: string[],
): Promise<void> {
  for (const inventoryItemId of [...new Set(itemIds)].sort()) {
    const itemResult = await tx.query<InventoryItem>(
      `SELECT name,unit,minimum_stock::text AS minimum_stock,active
       FROM inventory_item WHERE farm_id=$1 AND id=$2 FOR UPDATE`,
      [farmId, inventoryItemId],
    );
    const item = itemResult.rows[0];
    if (!item) continue;

    await tx.query(
      `INSERT INTO inventory_notification_state(farm_id,inventory_item_id)
       VALUES($1,$2) ON CONFLICT(farm_id,inventory_item_id) DO NOTHING`,
      [farmId, inventoryItemId],
    );
    const stateResult = await tx.query<InventoryState>(
      `SELECT is_low,episode_count::text AS episode_count
       FROM inventory_notification_state
       WHERE farm_id=$1 AND inventory_item_id=$2 FOR UPDATE`,
      [farmId, inventoryItemId],
    );
    const state = stateResult.rows[0]!;
    const balanceResult = await tx.query<{ quantity: string }>(
      `SELECT COALESCE(sum(quantity_delta),0)::text AS quantity
       FROM inventory_movement WHERE farm_id=$1 AND inventory_item_id=$2`,
      [farmId, inventoryItemId],
    );
    const balance = scaled(balanceResult.rows[0]!.quantity);
    const isLow = item.active && balance <= scaled(item.minimum_stock);
    if (isLow === state.is_low) continue;

    if (isLow) {
      const episode = (BigInt(state.episode_count) + 1n).toString();
      const eventKey = `stock:${inventoryItemId}:${episode}`;
      await tx.query(
        `INSERT INTO notification_outbox
         (id,farm_id,event_key,event_type,source_id,payload)
         VALUES($1,$2,$3,'LOW_STOCK',$4,$5::jsonb)
         ON CONFLICT(farm_id,event_key) DO NOTHING`,
        [
          randomUUID(),
          farmId,
          eventKey,
          inventoryItemId,
          JSON.stringify({
            title: "Stok mencapai batas minimum",
            description: `${item.name}: ${balanceResult.rows[0]!.quantity} ${item.unit} (minimum ${item.minimum_stock} ${item.unit}).`,
            href: "/inventory",
            sourceLabel: item.name,
          }),
        ],
      );
      await tx.query(
        `UPDATE inventory_notification_state
         SET is_low=true,episode_count=$3,updated_at=now()
         WHERE farm_id=$1 AND inventory_item_id=$2`,
        [farmId, inventoryItemId, episode],
      );
      continue;
    }

    const episodeKey = `stock:${inventoryItemId}:${state.episode_count}`;
    const resolved = await tx.query<{ id: string }>(
      `UPDATE notification_outbox SET resolved_at=COALESCE(resolved_at,now())
       WHERE farm_id=$1 AND event_key=$2 AND event_type='LOW_STOCK'
       RETURNING id`,
      [farmId, episodeKey],
    );
    if (resolved.rows[0])
      await tx.query(
        `UPDATE farm_notification SET resolved_at=COALESCE(resolved_at,now())
         WHERE farm_id=$1 AND outbox_id=$2`,
        [farmId, resolved.rows[0].id],
      );
    await tx.query(
      `UPDATE inventory_notification_state
       SET is_low=false,updated_at=now()
       WHERE farm_id=$1 AND inventory_item_id=$2`,
      [farmId, inventoryItemId],
    );
  }
}
