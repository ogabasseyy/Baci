import { isValidEvidenceLink } from './negotiation-evidence-link';

/**
 * Client-independent evidence-form validation: every check that needs no
 * Supabase access (evidence presence/shape, offer range, merchant context).
 * Pure and synchronous, so the submit handler runs it BEFORE downloading the
 * lazily-loaded Supabase client — an immediately rejectable form gets
 * instant feedback even on a slow connection instead of stalling on the
 * client chunk. `submitNegotiationUpload` re-runs it as defense-in-depth for
 * direct callers. Returns the alert message, or null when valid.
 */
export function getUploadFormValidationError({
  currentPrice,
  merchantId,
  offer,
  uploadFile,
  uploadLink,
}: {
  currentPrice: number;
  merchantId: string;
  offer: string;
  uploadFile: File | null;
  uploadLink: string;
}): string | null {
  const trimmedLink = uploadLink.trim();
  if (trimmedLink && uploadFile) {
    return 'Use either a proof upload or a link, not both.';
  }
  if (!trimmedLink && !uploadFile) {
    return 'Upload proof or paste a link before sending your request.';
  }
  if (trimmedLink && !isValidEvidenceLink(trimmedLink)) {
    return 'Enter a valid http or https URL.';
  }
  const offeredPrice = Number(offer.trim());
  if (
    !Number.isFinite(offeredPrice) ||
    offeredPrice <= 0 ||
    offeredPrice > currentPrice
  ) {
    return 'Enter a valid offer amount before sending your request.';
  }
  if (!merchantId) {
    return 'Unable to submit request — merchant context unavailable.';
  }
  return null;
}
