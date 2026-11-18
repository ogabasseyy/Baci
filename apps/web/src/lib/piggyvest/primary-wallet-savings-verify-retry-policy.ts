// Production incident 2026-11-17: PiggyVest's verify record lagged its own
// outflow webhook by a few seconds, so the first re-query read pending, the
// webhook answered 503 and the customer's savings stayed pending until the
// ~2 minute redelivery. Three short extra tries cover that lag. Worst case
// (each try near its 10 s request timeout) stays near 20 s: no new try starts
// after budgetMs. The route sets no maxDuration, so the platform default
// applies, far above this.
export const SAVINGS_VERIFY_RETRY_POLICY = {
  // Wait before each extra try; its length is the number of extra tries.
  delaysMs: [1500, 2000, 2000],
  budgetMs: 8000,
} as const;
