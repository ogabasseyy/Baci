import type { SupabaseClient } from '@supabase/supabase-js';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import { createShippingQuoteBookingEconomicsServiceClient } from '@/lib/shipping/server-shipping-quote-booking-economics-client';

export type ShippingQuoteBookingEconomics = {
  provider_cost: number | null;
  platform_margin: number | null;
  platform_margin_bps: number | null;
  pricing_version: string | null;
  shipping_provider_cost: number | null;
  shipping_platform_margin: number | null;
  shipping_pricing_version: string | null;
  shipping_platform_retained_amount: number | null;
};

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function sanitizeBookingEconomics(
  value: unknown
): ShippingQuoteBookingEconomics | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  return {
    provider_cost: toNullableNumber(source.provider_cost),
    platform_margin: toNullableNumber(source.platform_margin),
    platform_margin_bps: toNullableNumber(source.platform_margin_bps),
    pricing_version: toNullableString(source.pricing_version),
    shipping_provider_cost: toNullableNumber(source.shipping_provider_cost),
    shipping_platform_margin: toNullableNumber(source.shipping_platform_margin),
    shipping_pricing_version: toNullableString(source.shipping_pricing_version),
    shipping_platform_retained_amount: toNullableNumber(
      source.shipping_platform_retained_amount
    ),
  };
}

/**
 * Read quote and order economics required for booking and refresh checks via
 * the server-only branded projection. Callers must already authorize the
 * merchant; authenticated PostgREST clients cannot execute this RPC.
 *
 * Vitest doubles may still inject an `rpc` client; production always uses the
 * branded service-role boundary.
 */
export async function getShippingQuoteBookingEconomics(
  supabase: SupabaseClient,
  merchantId: string,
  orderId: string,
  quoteId: string
): Promise<ShippingQuoteBookingEconomics | null> {
  const client =
    process.env.VITEST === 'true'
      ? supabase
      : createShippingQuoteBookingEconomicsServiceClient();
  if (typeof client.rpc !== 'function') return null;
  const result = await client.rpc('get_shipping_quote_booking_economics', {
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
      typedResult.error.message ||
        'Failed to resolve shipping quote economics.',
      500,
      'QUOTE_ECONOMICS_LOOKUP_FAILED'
    );
  }
  return sanitizeBookingEconomics(typedResult.data);
}

export function applyShippingQuoteBookingEconomicsToQuote<T extends object>(
  quote: T,
  economics: ShippingQuoteBookingEconomics | null
): T & {
  provider_cost?: number | null;
  platform_margin?: number | null;
  platform_margin_bps?: number | null;
  pricing_version?: string | null;
} {
  if (!economics) return quote;
  return {
    ...quote,
    provider_cost: economics.provider_cost,
    platform_margin: economics.platform_margin,
    platform_margin_bps: economics.platform_margin_bps,
    pricing_version: economics.pricing_version,
  };
}

export function applyShippingQuoteBookingEconomicsToOrder<T extends object>(
  order: T,
  economics: ShippingQuoteBookingEconomics | null
): T & {
  shipping_provider_cost?: number | string | null;
  shipping_platform_margin?: number | string | null;
  shipping_pricing_version?: string | null;
  shipping_platform_retained_amount?: number | string | null;
} {
  if (!economics) return order;
  return {
    ...order,
    shipping_provider_cost: economics.shipping_provider_cost,
    shipping_platform_margin: economics.shipping_platform_margin,
    shipping_pricing_version: economics.shipping_pricing_version,
    shipping_platform_retained_amount:
      economics.shipping_platform_retained_amount,
  };
}
