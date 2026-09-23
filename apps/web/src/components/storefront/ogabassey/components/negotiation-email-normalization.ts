import { normalizeNegotiationCustomerEmail } from '@baci/shared/lib';

/**
 * Sole export: optional-customer-email normalization for negotiation
 * flows. Split from negotiation-contact-validation to honor the
 * one-export-per-file rule; the submit-time validator imports this.
 */
export function normalizeOptionalEmail(email?: string | null): string | null {
  return normalizeNegotiationCustomerEmail(email);
}
