// Mirror calculate_loyalty_tier's threshold reading (migration 04): a
// threshold counts iff its text form is an integer literal, so digit
// strings coerce exactly like the SQL NUMERIC compare; anything else
// (null, decimals, non-numeric, unsafe magnitudes) falls to the 0 floor.
export function toLadderThreshold(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'string' &&
    /^-?[0-9]+$/.test(value) &&
    Number.isSafeInteger(Number(value))
  )
    return Number(value);
  return 0;
}
