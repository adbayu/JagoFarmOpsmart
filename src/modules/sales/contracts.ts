export { saleInput } from "../../shared/validation.js";
export type SaleReceipt = { saleId: string; totalMinor: string };
import { z } from "zod";
import { uuid } from "../../shared/validation.js";
export const cancelSaleInput = z.strictObject({
  idempotencyKey: uuid,
  reason: z.string().trim().min(1).max(500),
});
export type SaleLotOption = {
  lotId: string;
  lotLabel: string;
  productId: string;
  productName: string;
  unit: string;
  balance: string;
  harvestId: string;
  cycleId: string;
  cycleName: string;
};
export type SaleSummary = {
  id: string;
  buyer: string;
  saleDate: string;
  status: "COMPLETED" | "CANCELLED";
  totalMinor: string;
  items: {
    id: string;
    productId: string;
    productName: string;
    quantity: string;
    unit: string;
    unitPriceMinor: string;
    totalMinor: string;
    allocations: {
      movementId: string;
      lotId: string;
      lotLabel: string;
      quantity: string;
      harvestId: string;
      cycleId: string;
      cycleName: string;
    }[];
  }[];
};
