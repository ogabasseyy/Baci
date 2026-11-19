export function numericStock(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const stock = Number(value);
  return Number.isFinite(stock) ? stock : null;
}
