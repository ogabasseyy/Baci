export function coerceWalletDatabaseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const amount = Number(value.trim());
  return Number.isFinite(amount) ? amount : null;
}
