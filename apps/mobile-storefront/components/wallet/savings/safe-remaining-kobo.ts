export function safeRemainingKobo(remainingAmount: number): number {
  if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) return 0;
  const remainingKobo = Math.round(remainingAmount * 100);
  return Number.isSafeInteger(remainingKobo) ? remainingKobo : 0;
}
