export function normalizeStreetAddressForComparison(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/, '');
}
