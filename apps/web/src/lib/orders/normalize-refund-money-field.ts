/**
 * Claim-gate money comparison: legacy rows pad or re-case ISO codes
 * (`ngn`, ` NGN `), so every currency/gateway equality trims and
 * uppercases instead of comparing raw text.
 */
export function normalizeRefundMoneyField(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}
