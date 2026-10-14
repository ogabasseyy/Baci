import { describe, expect, it } from 'vitest';
import { SHIPPING_PROVIDER_CODES } from '@/lib/shipping/types';
import type { OrderIdempotencyPayloadInput } from './order-idempotency';
import { resolveEffectiveCheckoutShippingProvider } from './resolve-effective-checkout-shipping-provider';

const basePayload = {
  shipping_provider: null,
} as unknown as OrderIdempotencyPayloadInput;

describe('resolveEffectiveCheckoutShippingProvider', () => {
  it('nulls the provider for merchant-rate orders without alternates', () => {
    expect(
      resolveEffectiveCheckoutShippingProvider({
        idempotencyPayload: basePayload,
        isMerchantRateOrder: true,
        requestedShippingProvider: 'TOPSHIP',
        resolvedSelectedQuoteId: 'quote-1',
        resolvedShippingProvider: 'TOPSHIP',
        validatedQuoteProvider: 'TOPSHIP',
      })
    ).toEqual({
      alternatePayloads: undefined,
      effectiveShippingProvider: null,
      omittedProviderUnresolved: false,
    });
  });

  it('prefers the explicit body provider', () => {
    expect(
      resolveEffectiveCheckoutShippingProvider({
        idempotencyPayload: basePayload,
        isMerchantRateOrder: false,
        requestedShippingProvider: 'GIGL',
        resolvedSelectedQuoteId: 'quote-1',
        resolvedShippingProvider: 'TOPSHIP',
        validatedQuoteProvider: 'TOPSHIP',
      })
    ).toEqual({
      alternatePayloads: undefined,
      effectiveShippingProvider: 'GIGL',
      omittedProviderUnresolved: false,
    });
  });

  it('falls back to the reuse-resolved provider, then the validated quote carrier', () => {
    expect(
      resolveEffectiveCheckoutShippingProvider({
        idempotencyPayload: basePayload,
        isMerchantRateOrder: false,
        requestedShippingProvider: null,
        resolvedSelectedQuoteId: 'quote-1',
        resolvedShippingProvider: 'GIGL',
        validatedQuoteProvider: 'TOPSHIP',
      }).effectiveShippingProvider
    ).toBe('GIGL');
    expect(
      resolveEffectiveCheckoutShippingProvider({
        idempotencyPayload: basePayload,
        isMerchantRateOrder: false,
        requestedShippingProvider: null,
        resolvedSelectedQuoteId: 'quote-1',
        resolvedShippingProvider: null,
        validatedQuoteProvider: 'TOPSHIP',
      })
    ).toEqual({
      alternatePayloads: undefined,
      effectiveShippingProvider: 'TOPSHIP',
      omittedProviderUnresolved: false,
    });
  });

  it('probes per-provider alternates when an omitted provider is unresolvable', () => {
    const { alternatePayloads, effectiveShippingProvider } =
      resolveEffectiveCheckoutShippingProvider({
        idempotencyPayload: {
          ...basePayload,
          request_key: 'k',
        } as OrderIdempotencyPayloadInput,
        isMerchantRateOrder: false,
        requestedShippingProvider: null,
        // Quote id present but its row was cleaned up: the validated
        // carrier is null, so the retry must probe each provider hash.
        resolvedSelectedQuoteId: 'quote-1',
        resolvedShippingProvider: null,
        validatedQuoteProvider: null,
      });
    expect(effectiveShippingProvider).toBeNull();
    expect(
      alternatePayloads?.map((payload) => payload.shipping_provider)
    ).toEqual([...SHIPPING_PROVIDER_CODES]);
  });

  it('skips alternates without a keyed payload to probe', () => {
    for (const input of [
      {
        idempotencyPayload: null,
        requestedShippingProvider: null,
      },
      {
        idempotencyPayload: basePayload,
        requestedShippingProvider: 'TOPSHIP',
      },
    ]) {
      expect(
        resolveEffectiveCheckoutShippingProvider({
          idempotencyPayload: input.idempotencyPayload,
          isMerchantRateOrder: false,
          requestedShippingProvider: input.requestedShippingProvider,
          resolvedSelectedQuoteId: null,
          resolvedShippingProvider: null,
          validatedQuoteProvider: null,
        }).alternatePayloads
      ).toBeUndefined();
    }
  });
});
