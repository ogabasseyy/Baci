interface WalletFundedTotalInput {
  /** Canonical full order total carried by the route, when present. */
  orderTotal?: string | number | null;
  /** Completed funding intent target: the post-savings residual. */
  targetOrderAmount?: string | number | null;
  /** Shortfall collected after existing wallet balance. */
  amount?: string | number | null;
}

/**
 * Canonical value for a wallet-funded completion: the routed order
 * total wins (it carries the full order value), the intent target is
 * only the post-savings residual, and the shortfall is the last
 * resort. Restored or legacy links may omit the routed total — only
 * then does the chain fall back.
 */
export function resolveWalletFundedTotal({
  orderTotal,
  targetOrderAmount,
  amount,
}: WalletFundedTotalInput): number {
  const requestedTotal = Number(orderTotal);
  if (Number.isFinite(requestedTotal)) {
    return requestedTotal;
  }
  const intentTotal = Number(targetOrderAmount);
  if (Number.isFinite(intentTotal)) {
    return intentTotal;
  }
  const shortfall = Number(amount);
  return Number.isFinite(shortfall) ? shortfall : 0;
}
