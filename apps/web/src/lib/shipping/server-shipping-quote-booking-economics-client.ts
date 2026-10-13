import 'server-only';

import {
  createServiceClient,
  type ShippingQuoteBookingEconomicsServiceClient,
} from '@/lib/supabase/service';

/**
 * Owner-approved temporary shipping-quote booking-economics boundary
 * (2026-09-06, PR #3435). Only server booking/fulfillment helpers that already
 * authenticated the merchant may call this. Limited to
 * `get_shipping_quote_booking_economics`. Remove by 2026-09-16 or when a
 * restricted worker role exists.
 */
export function createShippingQuoteBookingEconomicsServiceClient(): ShippingQuoteBookingEconomicsServiceClient {
  return createServiceClient('shipping-quote-booking-economics');
}

export type { ShippingQuoteBookingEconomicsServiceClient } from '@/lib/supabase/service';
