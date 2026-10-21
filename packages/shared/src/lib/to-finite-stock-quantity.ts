import { toFiniteNumber } from './to-finite-number';

/** Finite stock scalar (floored, clamped at zero), or null when absent. */
export function toFiniteStockQuantity(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed === null ? null : Math.max(0, Math.floor(parsed));
}
