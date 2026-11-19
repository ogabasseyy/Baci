import { normaliseMonnifyWording } from './monnify-text-normalise';

/**
 * Duplicate-specific Monnify wording: a duplicate, a reference or vend
 * reference already used / existing / in use, an idempotency clash, or a
 * conflict about a reference, request, transaction or vend (a bare
 * "conflict" elsewhere is not enough; HTTP 409 is caught by its status). Such an answer means Monnify may already hold (and deliver)
 * this vend, so it is never handed to another provider. Ordinary refusals
 * that merely mention a reference (e.g. "Invalid customer reference") do
 * not match.
 */
const MONNIFY_DUPLICATE_REFERENCE_PATTERN =
  /duplicate|idempoten|(?:reference|ref|request|transaction|vend)\w*[\s_-]+(?:\w+[\s_-]+)?conflict|conflict\w*[\s_-]+(?:\w+[\s_-]+){0,2}?(?:reference|ref|request|transaction|vend)|(?:reference|transaction)\s+(?:(?:has|is)\s+)?(?:already|exists?|(?:is\s+)?in\s+use|been\s+used)|previously\s+(?:been\s+)?(?:used|processed|submitted|vended)|already\s+(?:been\s+)?(?:used|processed|submitted|exists?|vended|delivered|paid|dispatched|completed|fulfilled)/i;

/** Whether a Monnify message says the vend reference was already used. */
export function isMonnifyDuplicateReferenceText(
  text: string | null | undefined
): boolean {
  // "_" and "-" read as spaces, so machine-style states such as
  // REFERENCE_ALREADY_EXISTS or TRANSACTION-ALREADY-PROCESSED match.
  return (
    !!text &&
    MONNIFY_DUPLICATE_REFERENCE_PATTERN.test(normaliseMonnifyWording(text))
  );
}
