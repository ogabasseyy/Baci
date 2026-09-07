import type { OrderShipmentQuoteRecord } from './refresh-order-shipment-quote';

const GIGL_PRICING_VERSION = 'gigl_platform_margin_v1';

function toNonNegativeNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '') return null;
  const parsed =
    typeof normalized === 'number' ? normalized : Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Resolve the internal economics snapshot without selecting restricted quote
 * columns from an authenticated PostgREST client. Refreshed quotes are
 * server-authored and carry their own economics; existing orders retain the
 * trigger-stamped snapshot used by customer and wallet bookings.
 */
export function resolveShipmentEconomics(
  provider: string,
  quote: OrderShipmentQuoteRecord,
  order: {
    shipping_provider_cost?: number | string | null;
    shipping_platform_margin?: number | string | null;
    shipping_pricing_version?: string | null;
  }
) {
  if (provider !== 'GIGL') {
    return { provider_cost: null, platform_margin: null };
  }

  const quoteProviderCost = toNonNegativeNumber(quote.provider_cost);
  const quotePlatformMargin = toNonNegativeNumber(quote.platform_margin);
  if (
    quote.pricing_version === GIGL_PRICING_VERSION &&
    quoteProviderCost !== null &&
    quotePlatformMargin !== null
  ) {
    return {
      provider_cost: quoteProviderCost,
      platform_margin: quotePlatformMargin,
    };
  }

  const orderProviderCost = toNonNegativeNumber(order.shipping_provider_cost);
  const orderPlatformMargin = toNonNegativeNumber(
    order.shipping_platform_margin
  );
  if (
    order.shipping_pricing_version === GIGL_PRICING_VERSION &&
    orderProviderCost !== null &&
    orderPlatformMargin !== null
  ) {
    return {
      provider_cost: orderProviderCost,
      platform_margin: orderPlatformMargin,
    };
  }

  return { provider_cost: null, platform_margin: null };
}
