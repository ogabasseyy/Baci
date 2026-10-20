import type { OrderIdempotencyPayloadInput } from '@/lib/checkout/order-idempotency';
import { SHIPPING_PROVIDER_CODES } from '@/lib/shipping/types';

/**
 * Resolves the carrier persisted for a checkout order. A quoted checkout may
 * omit the redundant provider: the merchant-scoped quote's validated carrier
 * (captured during destination enrichment) is authoritative. Otherwise the
 * stored order has a quote but no carrier and fulfillment rejects it.
 *
 * When the validated quote row was cleaned up before a confirmed retry, the
 * provider is unresolvable here; per-provider alternate payloads let the
 * idempotency replay probe the original hash instead of conflicting.
 */
export function resolveEffectiveCheckoutShippingProvider(args: {
  idempotencyPayload: OrderIdempotencyPayloadInput | null;
  isMerchantRateOrder: boolean;
  requestedShippingProvider?: string | null;
  resolvedSelectedQuoteId: string | null;
  resolvedShippingProvider: string | null;
  validatedQuoteProvider: string | null;
}): {
  alternatePayloads?: OrderIdempotencyPayloadInput[];
  effectiveShippingProvider: string | null;
  omittedProviderUnresolved: boolean;
} {
  const {
    idempotencyPayload,
    isMerchantRateOrder,
    requestedShippingProvider,
    resolvedSelectedQuoteId,
    resolvedShippingProvider,
    validatedQuoteProvider,
  } = args;
  // Merchant-rate orders null the provider (the rate id, not a carrier,
  // distinguishes them); a stray client-sent provider must not leak through.
  const effectiveShippingProvider = isMerchantRateOrder
    ? null
    : (requestedShippingProvider ??
      resolvedShippingProvider ??
      (resolvedSelectedQuoteId ? validatedQuoteProvider : null) ??
      null);
  const omittedProviderUnresolved =
    !isMerchantRateOrder &&
    !requestedShippingProvider &&
    Boolean(resolvedSelectedQuoteId) &&
    !validatedQuoteProvider;
  return {
    alternatePayloads:
      omittedProviderUnresolved && idempotencyPayload
        ? SHIPPING_PROVIDER_CODES.map((code) => ({
            ...idempotencyPayload,
            shipping_provider: code,
          }))
        : undefined,
    effectiveShippingProvider,
    omittedProviderUnresolved,
  };
}
