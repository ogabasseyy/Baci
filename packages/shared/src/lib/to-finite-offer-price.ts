import { toFiniteNumber } from './to-finite-number';

/** Finite offer price, or null when the row carries none. */
export function toFiniteOfferPrice(value: unknown): number | null {
  return toFiniteNumber(value);
}
