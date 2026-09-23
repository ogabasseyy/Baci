/** Parses a finite non-negative FOCUS billing quantity. */
export function finiteNonnegative(value: unknown, field: string) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  )
    throw new Error(`billing row has an invalid ${field}`);
  return value;
}
