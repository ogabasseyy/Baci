import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderShipmentQuoteRecord } from './refresh-order-shipment-quote';
import { getShippingQuoteBookingMetadata } from './shipping-quote-booking-metadata';

export async function attachBookingQuoteMetadata(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  quote: OrderShipmentQuoteRecord
): Promise<OrderShipmentQuoteRecord> {
  const bookingMetadata = await getShippingQuoteBookingMetadata(
    supabase,
    merchantId,
    orderId,
    quote.id
  );
  return {
    ...quote,
    provider_metadata: bookingMetadata,
  };
}
