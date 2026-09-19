/**
 * Shared input validators for the savings-policy modules. All money fields
 * are integer kobo. Price inputs (quotes, guarantees, offers) must be
 * positive; balances and contributions may be zero.
 *
 * Internal to the policy barrel: imported by sibling modules, not
 * re-exported publicly.
 */

export function assertKobo(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer kobo`);
  }
}

/**
 * Price inputs (quotes, guarantees, offers) must be positive: a zero price
 * would zero the activation threshold so an unfunded plan reads activated,
 * and would price decisions at zero. Balances and contributions stay
 * nonnegative-only.
 */
export function assertPositiveKobo(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer kobo`);
  }
}

export function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
}
