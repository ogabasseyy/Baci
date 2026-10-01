import type { SupabaseClient } from '@supabase/supabase-js';
import { assertQuotePriceMatchesOrderFee } from '@/lib/shipping/assert-quote-price-matches-order-fee';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import {
  type OrderShipmentQuoteRecord,
  refreshOrderShipmentQuote,
} from '@/lib/shipping/refresh-order-shipment-quote';
import type {
  ShippingAddress,
  ShippingProviderCode,
} from '@/lib/shipping/types';

/**
 * Domestic bookings always use the registered merchant sender. If the stored
 * quote was priced for a different origin, refresh before booking so rate IDs
 * and metadata match the sender we actually ship from.
 */
export async function resolveBookingQuoteForSender(
  supabase: SupabaseClient,
  quote: OrderShipmentQuoteRecord,
  provider: ShippingProviderCode,
  options: {
    orderId: string;
    merchantSender?: ShippingAddress;
    usesStoredInternationalSender: boolean;
    expectedShippingFee?: number | string | null;
  }
): Promise<OrderShipmentQuoteRecord> {
  if (options.usesStoredInternationalSender) {
    return quote;
  }

  if (!options.merchantSender) {
    throw new OrderShipmentBookingError(
      'Registered merchant sender is required for domestic shipment booking.',
      400,
      'MERCHANT_SENDER_REQUIRED'
    );
  }

  const refreshedQuote = await refreshOrderShipmentQuote(
    supabase,
    quote,
    provider,
    options.merchantSender,
    {
      orderId: options.orderId,
      expectedShippingFee: options.expectedShippingFee,
    }
  );

  assertQuotePriceMatchesOrderFee(refreshedQuote, options.expectedShippingFee);

  return refreshedQuote;
}
