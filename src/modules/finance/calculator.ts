import { scaled } from "../../shared/decimal.js";
import type { HppInputs, HppResult } from "./contracts.js";

/** Pure projection; the caller must prepare classified, complete inputs under an approved policy. */
export function calculateHpp(input: HppInputs): HppResult {
  if (!input.policyVersion || !input.costsComplete)
    return {
      status: "UNAVAILABLE",
      reason:
        input.unavailableReason ??
        "Pencatatan biaya produksi siklus belum dinyatakan lengkap.",
    };
  if (!input.sourceHarvestIds.length)
    return {
      status: "UNAVAILABLE",
      reason: "Sumber output panen belum lengkap.",
    };
  const quantity = scaled(input.outputQuantity);
  if (quantity <= 0n)
    return {
      status: "UNAVAILABLE",
      reason: "Total output harus lebih dari nol.",
    };
  if (
    (input.unit === "HEAD" || input.unit === "UNIT") &&
    quantity % 1000n !== 0n
  )
    return {
      status: "UNAVAILABLE",
      reason: "Satuan hitung harus bilangan bulat.",
    };
  const cost = BigInt(input.productionCostMinor);
  if (cost < 0n) return { status: "UNAVAILABLE", reason: "Biaya tidak valid." };
  if (cost > 0n && !input.sourceCostIds.length)
    return {
      status: "UNAVAILABLE",
      reason: "Sumber biaya produksi belum lengkap.",
    };
  // One unit price in minor currency units, rounded half-up to six decimal places.
  const millionths = (cost * 1_000_000_000n + quantity / 2n) / quantity;
  const costPerUnitMinor = `${millionths / 1_000_000n}.${(millionths % 1_000_000n).toString().padStart(6, "0")}`;
  return {
    status: "AVAILABLE",
    value: {
      costPerUnitMinor,
      totalProductionCostMinor: cost.toString(),
      sourceCostIds: input.sourceCostIds,
      sourceHarvestIds: input.sourceHarvestIds,
    },
    method: `direct-cycle-allocation:${input.policyVersion}`,
    asOf: input.asOf,
  };
}
