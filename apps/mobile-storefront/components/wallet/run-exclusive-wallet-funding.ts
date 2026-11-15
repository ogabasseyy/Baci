const inFlight = new Set<string>();

/**
 * Runs one wallet funding at a time per merchant and account (Codex): a
 * double tap while the saved-funding check is still reading storage would
 * otherwise start two card checkouts. A second call while one runs is
 * dropped, not queued, since the first already opens the checkout.
 */
export async function runExclusiveWalletFunding(
  scopeKey: string,
  action: () => Promise<void>
): Promise<void> {
  if (inFlight.has(scopeKey)) return;
  inFlight.add(scopeKey);
  try {
    await action();
  } finally {
    inFlight.delete(scopeKey);
  }
}
