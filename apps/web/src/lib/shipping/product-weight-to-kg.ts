/**
 * Convert product weight metadata into kilograms.
 * Returns null for missing/invalid values or unsupported units.
 */
export function productWeightToKg(
  value: unknown,
  unit: unknown
): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;

  const normalizedUnit = String(unit ?? 'kg')
    .trim()
    .toLowerCase();
  switch (normalizedUnit) {
    case 'kg':
    case 'kgs':
    case 'kilogram':
    case 'kilograms':
      return n;
    case 'g':
    case 'gram':
    case 'grams':
      return n * 0.001;
    case 'lb':
    case 'lbs':
    case 'pound':
    case 'pounds':
      return n * 0.45359237;
    case 'oz':
    case 'ounce':
    case 'ounces':
      return n * 0.028349523125;
    default:
      return null;
  }
}
