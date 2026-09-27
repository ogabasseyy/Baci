/**
 * Nonnegative safe-integer kobo assertion for the savings-policy modules.
 * Balances and contributions may be zero.
 *
 * Internal to the policy barrel: imported by sibling modules, not
 * re-exported publicly.
 */
export function assertKobo(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer kobo`);
  }
}
