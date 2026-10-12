// Mirror calculate_loyalty_tier's threshold reading (migration 04): a
// threshold counts iff it is an integer in range, exactly like the SQL
// ^-?[0-9]+$ NUMERIC compare (digit strings coerce; decimals, unsafe
// magnitudes, and non-numeric values fall to the 0 floor).
export function toLadderThreshold(value: unknown): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value)
  )
    return value;
  if (
    typeof value === 'string' &&
    /^-?[0-9]+$/.test(value) &&
    Number.isSafeInteger(Number(value))
  )
    return Number(value);
  return 0;
}
