import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { enrichShippingAddressWithQuoteDestination } from './order-quote-destination';

function createSupabase({
  error = null,
  quote,
}: {
  error?: unknown;
  quote: unknown;
}) {
  return {
    rpc: vi.fn().mockResolvedValue({
      data: quote ? [quote] : [],
      error,
    }),
  };
}

const receiver = {
  name: 'Jane Receiver',
  phone: '',
  address: '123 Queen Street West',
  city: 'Toronto',
  state: 'Ontario',
  country: 'Canada',
  countryCode: 'CA',
  postalCode: 'M5V 3L9',
};

const internationalQuote = {
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  price: 10_000,
  provider: 'GIGL',
  provider_rate_id: 'GIGL_INTL_1_2_3_1',
  quote_request: {
    merchantId: 'merchant-current',
    receiver,
    sessionId: 'session-1',
    shipmentType: 'international',
    items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
  },
};

const shippingAddress = {
  address: receiver.address,
  city: receiver.city,
  country: receiver.country,
  countryCode: receiver.countryCode,
  postalCode: receiver.postalCode,
  state: receiver.state,
};

const checkoutContext = {
  merchantId: 'merchant-current',
  shippingFee: 10_000,
  shippingProvider: 'GIGL',
  items: [{ name: 'Phone', price: 100_000, quantity: 1, weight: 1 }],
};

describe('enrichShippingAddressWithQuoteDestination validation', () => {
  it('rejects saved international quotes selected with a different provider', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabase({
          quote: internationalQuote,
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        { ...checkoutContext, shippingProvider: 'TOPSHIP' }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_PROVIDER_MISMATCH',
      status: 400,
    });
  });

  it('rejects expired saved international quotes before checkout', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabase({
          quote: {
            ...internationalQuote,
            expires_at: new Date(Date.now() - 60_000).toISOString(),
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        checkoutContext
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_EXPIRED',
      status: 400,
    });
  });

  it('rejects saved international quotes when checkout omits the provider', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabase({
          quote: internationalQuote,
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        { ...checkoutContext, shippingProvider: undefined }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_PROVIDER_MISMATCH',
      status: 400,
    });
  });

  it('rejects saved international quotes when checkout omits the address', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabase({
          quote: internationalQuote,
        }) as unknown as SupabaseClient,
        'quote-1',
        undefined,
        checkoutContext
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_DESTINATION_MISMATCH',
      status: 400,
    });
  });

  it('rejects unreadable saved international quote requests before checkout', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabase({
          quote: { ...internationalQuote, quote_request: null },
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        checkoutContext
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_REQUEST_MISSING',
      status: 400,
    });
  });

  it('fails closed when the saved quote lookup errors', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabase({
          error: { message: 'database unavailable' },
          quote: null,
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        checkoutContext
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_LOOKUP_FAILED',
      status: 500,
    });
  });

  it('rejects selected quotes that are not scoped to the checkout merchant', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabase({
          quote: null,
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        checkoutContext
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      status: 400,
    });
  });

  it('allows a confirmed replay context when the selected quote was cleaned up', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabase({
          quote: null,
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        {
          merchantId: 'merchant-current',
          items: [{ name: 'Phone', price: 100_000, quantity: 1, weight: 1 }],
          shippingFee: undefined,
          shippingProvider: null,
        }
      )
    ).resolves.toEqual(shippingAddress);
  });

  it('enriches checkout addresses missing optional quote destination fields', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabase({
          quote: internationalQuote,
        }) as unknown as SupabaseClient,
        'quote-1',
        {
          address: shippingAddress.address,
          city: shippingAddress.city,
          country: undefined,
          countryCode: undefined,
          postalCode: undefined,
          state: shippingAddress.state,
        },
        checkoutContext
      )
    ).resolves.toMatchObject({
      country: 'Canada',
      countryCode: 'CA',
      postalCode: 'M5V 3L9',
    });
  });
});
