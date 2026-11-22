export function normalizeStreetAddressForComparison(value: string): string {
  // Only normalize separators that cannot change an address token. Keep unit
  // and house-number punctuation intact so substantive edits require review.
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/, '');
}
