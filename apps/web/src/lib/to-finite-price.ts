/** Normalize a numeric database value to a finite non-negative price. */
export function toFinitePrice(value: unknown): number | null {
  const price =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : null;
  return typeof price === 'number' && Number.isFinite(price) && price >= 0
    ? price
    : null;
}
