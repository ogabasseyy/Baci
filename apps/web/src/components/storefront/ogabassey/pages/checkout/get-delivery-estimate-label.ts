import type { ShippingQuote } from './types';

/**
 * Delivery-estimate line for a quote, or `null` when it should be omitted.
 * Merchant rates without configured days carry `estimatedDays === 0` (an
 * "unknown estimate" sentinel) — callers must not render "0 days".
 */
export function getDeliveryEstimateLabel(quote: ShippingQuote): string | null {
  if (quote.deliveryRange) return quote.deliveryRange;
  if (quote.estimatedDays > 0) return `${quote.estimatedDays} days`;
  return null;
}
