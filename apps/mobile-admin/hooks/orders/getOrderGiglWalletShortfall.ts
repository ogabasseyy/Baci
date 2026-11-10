// Wallet funding state for a quote price against the merchant's balance.
export function getOrderGiglWalletShortfall(
  availableBalance: number,
  price: number
) {
  const shortfall = Math.max(0, price - availableBalance);
  return { availableBalance, canBook: price > 0 && shortfall === 0, shortfall };
}
