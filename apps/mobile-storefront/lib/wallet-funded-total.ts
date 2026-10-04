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
/**
 * Null/blank-safe coercion: restored or legacy links may carry an
 * explicitly null total, and Number(null) is a finite zero — without
 * this guard a null total reports zero revenue instead of falling
 * back to the intent target or transfer shortfall.
 */
function toFiniteAmount(
  value: string | number | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : null;
}

export function resolveWalletFundedTotal({
  orderTotal,
  targetOrderAmount,
  amount,
}: WalletFundedTotalInput): number {
  return (
    toFiniteAmount(orderTotal) ??
    toFiniteAmount(targetOrderAmount) ??
    toFiniteAmount(amount) ??
    0
  );
}
