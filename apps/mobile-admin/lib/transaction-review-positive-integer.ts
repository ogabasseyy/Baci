import { toFiniteNumberOrNull } from './transaction-review-row-helpers';

export function toPositiveInteger(value: unknown): number | null {
  const numericValue = toFiniteNumberOrNull(value);
  return numericValue != null &&
    Number.isInteger(numericValue) &&
    numericValue > 0
    ? numericValue
    : null;
}
