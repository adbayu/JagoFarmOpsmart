import { DomainError } from "./errors.js";
import type { Unit } from "./domain.js";
/** Exact scale 3. Boundary schemas restrict sign/precision before this internal helper. */
export function scaled(value: string): bigint {
  if (!/^-?\d+(\.\d{1,3})?$/.test(value)) throw new DomainError("VALIDATION");
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return negative ? -result : result;
}
export function decimal(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${magnitude / 1000n}.${(magnitude % 1000n).toString().padStart(3, "0")}`;
}
export function validateUnitQuantity(value: bigint, unit: Unit): void {
  if (
    value <= 0n ||
    (["UNIT", "HEAD", "SEED"].includes(unit) && value % 1000n !== 0n)
  )
    throw new DomainError("VALIDATION");
}
/** Half up, once per sale line; values are nonnegative. */
export function lineTotal(quantityScaled: bigint, priceMinor: bigint): bigint {
  return (quantityScaled * priceMinor + 500n) / 1000n;
}
export function assertMoneyRange(value: bigint): void {
  if (value < 0n || value > 9_223_372_036_854_775_807n)
    throw new DomainError("VALIDATION");
}
