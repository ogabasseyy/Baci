/** Naira amount (number or numeric string) to whole kobo, or null if not a positive finite amount. */
export function toKobo(
  value: number | string | null | undefined
): number | null {
  const amount =
    typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : value;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return Math.round(amount * 100);
}
