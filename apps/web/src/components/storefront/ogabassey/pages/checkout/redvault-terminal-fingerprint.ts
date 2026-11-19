import { checkoutFingerprintsMatch } from './checkout-fingerprints-match';

const prefix = 'uba_redvault:';

/** Compare current contact/delivery with a reviewed order after its cart closed. */
export function redvaultTerminalFingerprintMatches(
  reviewed: string,
  current: string
): boolean {
  if (!reviewed.startsWith(prefix) || !current.startsWith(prefix)) return false;
  try {
    const before: unknown = JSON.parse(reviewed.slice(prefix.length));
    const after: unknown = JSON.parse(current.slice(prefix.length));
    if (
      !before || typeof before !== 'object' || Array.isArray(before) ||
      !after || typeof after !== 'object' || Array.isArray(after)
    ) return false;
    const reviewedFields = before as Record<string, unknown>;
    const currentFields = after as Record<string, unknown>;
    if (
      !Array.isArray(reviewedFields.items) || reviewedFields.items.length === 0 ||
      !Array.isArray(currentFields.items) || currentFields.items.length !== 0
    ) return false;
    return checkoutFingerprintsMatch(
      JSON.stringify(reviewedFields),
      JSON.stringify({ ...currentFields, items: reviewedFields.items })
    );
  } catch {
    return false;
  }
}
