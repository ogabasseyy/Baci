/**
 * Price inputs (quotes, guarantees, offers) must be positive: a zero price
 * would zero the activation threshold so an unfunded plan reads activated,
 * and would price decisions at zero. Balances and contributions stay
 * nonnegative-only.
 *
 * Internal to the policy barrel: imported by sibling modules, not
 * re-exported publicly.
 */
export function assertPositiveKobo(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer kobo`);
  }
}
