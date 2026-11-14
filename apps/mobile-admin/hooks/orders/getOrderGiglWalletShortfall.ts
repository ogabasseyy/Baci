// Wallet funding state for a quote price against the merchant's balance.
export function getOrderGiglWalletShortfall(rawBalance: number, price: number) {
  // A non-finite or negative balance counts as empty, never as NaN.
  const availableBalance = Number.isFinite(rawBalance)
    ? Math.max(0, rawBalance)
    : 0;
  const shortfall = Math.max(0, price - availableBalance);
  return { availableBalance, canBook: price > 0 && shortfall === 0, shortfall };
}
