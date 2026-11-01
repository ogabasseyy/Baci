/** Oxygen accepts percentages to two decimals; calculate money in integer kobo. */
export function equityForPercentage(productAmount: number, percentage: number) {
  const total = BigInt(Math.round(productAmount * 100));
  return (
    Number((total * BigInt(Math.round(percentage * 100)) + 5000n) / 10000n) /
    100
  );
}
export function percentageForAmount(productAmount: number, text: string) {
  if (!Number.isFinite(productAmount) || productAmount <= 0) return null;
  const value = text.replaceAll(',', '').trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const amount = Number(value);
  if (
    !Number.isFinite(amount) ||
    amount < equityForPercentage(productAmount, 25) ||
    amount > equityForPercentage(productAmount, 90)
  )
    return null;
  return Math.max(
    25,
    Math.min(90, Math.round((amount / productAmount) * 10000) / 100)
  );
}
