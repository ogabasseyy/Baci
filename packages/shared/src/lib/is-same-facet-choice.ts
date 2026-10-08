/**
 * Facet identity is trimmed, case-insensitive matching: the SQL brand
 * filter folds case, so choice lists and checkbox state must too, or a
 * `brand=apple` URL beside an `Apple` facet renders duplicates that
 * cannot be toggled consistently.
 */
export function isSameFacetChoice(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
