import type { ShippingQuote } from '@/types/shipping-quote';

export function formatShippingDeliveryTime(quote: ShippingQuote): string {
  const deliveryRange = quote.deliveryRange?.trim();
  if (deliveryRange) return deliveryRange;

  if (!Number.isFinite(quote.estimatedDays) || quote.estimatedDays <= 0) {
    return 'ETA unavailable';
  }

  if (
    quote.minDays !== undefined &&
    quote.maxDays !== undefined &&
    quote.minDays !== quote.maxDays
  ) {
    return `${quote.minDays}-${quote.maxDays} days`;
  }

  return `${quote.estimatedDays} day${quote.estimatedDays !== 1 ? 's' : ''}`;
}
