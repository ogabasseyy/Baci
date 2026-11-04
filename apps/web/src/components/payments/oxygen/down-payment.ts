/** Oxygen accepts percentages to two decimals; calculate money in integer kobo. */
export function equityForPercentage(productAmount: number, percentage: number) {
  const total = BigInt(Math.round(productAmount * 100));
  return (
    Number((total * BigInt(Math.round(percentage * 100)) + 5000n) / 10000n) /
    100
  );
}
export function percentageForAmount(
  productAmount: number,
  text: string,
  min = 25,
  max = 90
) {
  if (!Number.isFinite(productAmount) || productAmount <= 0) return null;
  const value = text.replaceAll(',', '').trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const amount = Number(value);
  if (
    !Number.isFinite(amount) ||
    amount < equityForPercentage(productAmount, min) ||
    amount > equityForPercentage(productAmount, max)
  )
    return null;
  return Math.max(
    min,
    Math.min(max, Math.round((amount / productAmount) * 10000) / 100)
  );
}
