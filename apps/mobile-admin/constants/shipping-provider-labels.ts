import type { OrderGiglQuote } from '@/lib/order-gigl-shipping';

/**
 * Short merchant-facing names for the "Ship with …" option and its badge,
 * keyed by the provider code the quote API returns. These are deliberately the
 * short form; the long display names live in `formatShippingProviderName`
 * (`lib/order-shipment.ts`). Typing the keys by the quote's provider code makes
 * the compiler flag a new provider that has no short label here.
 */
export const SHIPPING_PROVIDER_LABELS: Record<
  OrderGiglQuote['provider'],
  string
> = {
  GIGL: 'GIG',
};
