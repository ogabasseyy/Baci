// Numeric expectation parser for the pilot effective-settings gate.
// Rejects non-numeric, blank, NaN, and out-of-range CLI flag values at
// parse time so NaN comparisons never pass a geometry or network check.
export function parseNumberExpectation(
  value,
  name,
  { allowZero = false, integer = false } = {}
) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`bad --${name}: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`bad --${name}: ${value}`);
  }
  if (integer && (!Number.isInteger(parsed) || parsed < 1)) {
    throw new Error(`bad --${name}: ${value}`);
  }
  if (allowZero ? parsed < 0 : parsed <= 0) {
    throw new Error(`bad --${name}: ${value}`);
  }
  return parsed;
}
