/**
 * Duplicate-specific Monnify wording: a duplicate, a reference or vend
 * reference already used / existing / in use, an idempotency clash, or a
 * conflict. Such an answer means Monnify may already hold (and deliver)
 * this vend, so it is never handed to another provider. Ordinary refusals
 * that merely mention a reference (e.g. "Invalid customer reference") do
 * not match.
 */
const MONNIFY_DUPLICATE_REFERENCE_PATTERN =
  /duplicate|idempoten|conflict|(?:reference|transaction)\s+(?:has\s+)?(?:already|exists?|(?:is\s+)?in\s+use|been\s+used)|already\s+(?:been\s+)?(?:used|processed|submitted|exists?|vended|delivered|paid|dispatched|completed|fulfilled)/i;

/** Whether a Monnify message says the vend reference was already used. */
export function isMonnifyDuplicateReferenceText(
  text: string | null | undefined
): boolean {
  return !!text && MONNIFY_DUPLICATE_REFERENCE_PATTERN.test(text);
}
