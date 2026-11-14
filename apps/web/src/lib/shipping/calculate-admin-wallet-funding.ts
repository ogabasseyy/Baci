export function calculateAdminWalletFunding(price: number, balance: number) {
  const availableBalance = Math.max(0, Number.isFinite(balance) ? balance : 0);
  const shortfall = Math.max(0, price - availableBalance);
  return { availableBalance, shortfall, canBook: shortfall === 0 };
}
