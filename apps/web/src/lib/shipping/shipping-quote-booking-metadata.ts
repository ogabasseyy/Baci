import type { SupabaseClient } from '@supabase/supabase-js';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';

function sanitizeBookingMetadata(
  value: unknown
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  if (typeof source.pricingTier === 'string') {
    metadata.pricingTier = source.pricingTier;
  }
  if (typeof source.serviceType === 'string') {
    metadata.serviceType = source.serviceType;
  }
  if (typeof source.cost === 'number' && Number.isFinite(source.cost)) {
    metadata.cost = source.cost;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

/**
 * Read only the provider metadata required to book a saved quote. The
 * shipping_quotes authenticated projection intentionally omits provider_metadata;
 * this RPC returns a sanitized Topship projection and NULL for GIGL.
 *
 * Some unit-test Supabase doubles do not implement rpc yet; those callers
 * receive null and should configure the sanitized projection explicitly.
 */
export async function getShippingQuoteBookingMetadata(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  quoteId: string
): Promise<unknown | null> {
  if (typeof supabase.rpc !== 'function') return null;
  const result = await supabase.rpc('get_shipping_quote_booking_metadata', {
    p_merchant_id: merchantId,
    p_order_id: orderId,
    p_quote_id: quoteId,
  });
  if (!result || typeof result !== 'object') return null;
  const typedResult = result as {
    data?: unknown;
    error?: { message?: string } | null;
  };
  if (typedResult.error) {
    throw new OrderShipmentBookingError(
      typedResult.error.message || 'Failed to resolve shipping quote metadata.',
      500,
      'QUOTE_METADATA_LOOKUP_FAILED'
    );
  }
  return sanitizeBookingMetadata(typedResult.data);
}
