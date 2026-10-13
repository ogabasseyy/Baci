import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { enrichShippingAddressWithQuoteDestination } from './order-quote-destination';
import { createSupabaseRpcMock } from './test-helpers/create-supabase-rpc-mock';

const shippingAddress = {
  address: '123 Queen Street West',
  city: 'Toronto',
  country: 'Canada',
  countryCode: 'CA',
  postalCode: 'M5V 3L9',
  state: 'Ontario',
};
const checkoutPhoneItem = {
  condition: undefined,
  name: 'Phone',
  price: 100_000,
  productName: undefined,
  product_id: 'product-1',
  quantity: 1,
};

describe('enrichShippingAddressWithQuoteDestination', () => {
  it('persists international destination fields from the saved quote request', async () => {
    const result = await enrichShippingAddressWithQuoteDestination(
      createSupabaseRpcMock({
        provider_rate_id: 'GIGL_INTL_1_2_3_1',
        quote_request: {
          merchantId: 'merchant-current',
          sessionId: 'session-1',
          shipmentType: 'international',
          receiver: {
            name: 'Jane Receiver',
            phone: '',
            address: '123 Queen Street West',
            city: 'Toronto',
            state: 'Ontario',
            country: 'Canada',
            countryCode: 'CA',
            postalCode: 'M5V 3L9',
          },
          items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
        },
      }) as unknown as SupabaseClient,
      'quote-1',
      shippingAddress,
      { merchantId: 'merchant-current', shippingProvider: 'GIGL' }
    );

    expect(result).toEqual({
      ...shippingAddress,
      country: 'Canada',
      countryCode: 'CA',
      postalCode: 'M5V 3L9',
    });
  });

  it('keeps the original address for non-GIGL quotes', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          provider: 'TOPSHIP',
          provider_rate_id: 'topship:express:1',
          quote_request: null,
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress
      )
    ).resolves.toEqual(shippingAddress);
  });

  it('rejects expired domestic GIGL quotes before checkout', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          expires_at: new Date(Date.now() - 60_000).toISOString(),
          price: 2500,
          provider_rate_id: 'gigl:service-centre:5',
          quote_request: {
            merchantId: 'merchant-current',
            sessionId: 'session-1',
            shipmentType: 'domestic',
            receiver: {
              name: 'Jane Receiver',
              phone: '',
              address: '123 Queen Street West',
              city: 'Lagos',
              state: 'Lagos',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        {
          address: '123 Queen Street West',
          city: 'Lagos',
          state: 'Lagos',
          country: undefined,
          countryCode: undefined,
          postalCode: undefined,
        },
        {
          merchantId: 'merchant-current',
          items: [checkoutPhoneItem],
          shippingFee: 2500,
          shippingProvider: 'GIGL',
        }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_EXPIRED',
      status: 400,
    });
  });

  it('accepts domestic GIGL quotes when checkout stores a composed street, city, state address', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          price: 2500,
          provider_rate_id: 'gigl:door-delivery:5',
          quote_request: {
            merchantId: 'merchant-current',
            sessionId: 'session-1',
            shipmentType: 'domestic',
            receiver: {
              name: 'Jane Receiver',
              phone: '',
              address: '12 Admiralty Way',
              city: 'Lagos',
              state: 'Lagos',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        {
          address: '12 Admiralty Way, Lagos, Lagos',
          city: 'Lagos',
          state: 'Lagos',
          country: undefined,
          countryCode: undefined,
          postalCode: undefined,
        },
        {
          merchantId: 'merchant-current',
          items: [checkoutPhoneItem],
          shippingFee: 2500,
          shippingProvider: 'GIGL',
        }
      )
    ).resolves.toMatchObject({
      address: '12 Admiralty Way, Lagos, Lagos',
      city: 'Lagos',
      state: 'Lagos',
    });
  });

  it('rejects domestic GIGL quote destinations that do not match checkout address', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          price: 2500,
          provider_rate_id: 'gigl:service-centre:5',
          quote_request: {
            merchantId: 'merchant-current',
            sessionId: 'session-1',
            shipmentType: 'domestic',
            receiver: {
              name: 'Jane Receiver',
              phone: '',
              address: '123 Queen Street West',
              city: 'Abuja',
              state: 'FCT',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        {
          address: '123 Queen Street West',
          city: 'Lagos',
          state: 'Lagos',
          country: undefined,
          countryCode: undefined,
          postalCode: undefined,
        },
        {
          merchantId: 'merchant-current',
          items: [checkoutPhoneItem],
          shippingFee: 2500,
          shippingProvider: 'GIGL',
        }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_DESTINATION_MISMATCH',
      status: 400,
    });
  });

  it('rejects domestic GIGL quotes when the checkout shipping fee changes', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          price: 2500,
          provider_rate_id: 'gigl:service-centre:5',
          quote_request: {
            merchantId: 'merchant-current',
            sessionId: 'session-1',
            shipmentType: 'domestic',
            receiver: {
              name: 'Jane Receiver',
              phone: '',
              address: '123 Queen Street West',
              city: 'Lagos',
              state: 'Lagos',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        {
          address: '123 Queen Street West',
          city: 'Lagos',
          state: 'Lagos',
          country: undefined,
          countryCode: undefined,
          postalCode: undefined,
        },
        {
          merchantId: 'merchant-current',
          items: [checkoutPhoneItem],
          shippingFee: 1,
          shippingProvider: 'GIGL',
        }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      status: 400,
    });
  });

  it('rejects saved international quote destinations that do not match checkout address', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          provider_rate_id: 'GIGL_INTL_1_2_3_1',
          quote_request: {
            merchantId: 'merchant-current',
            sessionId: 'session-1',
            shipmentType: 'international',
            receiver: {
              name: 'Jane Receiver',
              phone: '',
              address: '123 Queen Street West',
              city: 'Toronto',
              state: 'Ontario',
              country: 'United States',
              countryCode: 'US',
              postalCode: '10001',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        {
          ...shippingAddress,
          country: 'Canada',
          countryCode: 'CA',
          postalCode: 'M5V 3L9',
        },
        { merchantId: 'merchant-current', shippingProvider: 'GIGL' }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_DESTINATION_MISMATCH',
      status: 400,
    });
  });

  it('rejects saved international quotes from another merchant before checkout', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          provider_rate_id: 'GIGL_INTL_1_2_3_1',
          quote_request: {
            merchantId: 'merchant-other',
            sessionId: 'session-1',
            shipmentType: 'international',
            receiver: {
              name: 'Jane Receiver',
              phone: '',
              address: '123 Queen Street West',
              city: 'Toronto',
              state: 'Ontario',
              country: 'Canada',
              countryCode: 'CA',
              postalCode: 'M5V 3L9',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        {
          merchantId: 'merchant-current',
          items: [checkoutPhoneItem],
          shippingFee: 10_000,
          shippingProvider: 'GIGL',
        }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_MERCHANT_MISMATCH',
      status: 400,
    });
  });

  it('rejects saved international quotes that no longer match checkout items or price', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          price: 10_000,
          provider_rate_id: 'GIGL_INTL_1_2_3_1',
          quote_request: {
            merchantId: 'merchant-current',
            sessionId: 'session-1',
            shipmentType: 'international',
            receiver: {
              name: 'Jane Receiver',
              phone: '',
              address: '123 Queen Street West',
              city: 'Toronto',
              state: 'Ontario',
              country: 'Canada',
              countryCode: 'CA',
              postalCode: 'M5V 3L9',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        {
          merchantId: 'merchant-current',
          items: [{ ...checkoutPhoneItem, name: 'Laptop' }],
          shippingFee: 10_000,
          shippingProvider: 'GIGL',
        }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      status: 400,
    });
  });

  it('rejects saved international quotes when the checkout shipping fee changes', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          price: 10_000,
          provider_rate_id: 'GIGL_INTL_1_2_3_1',
          quote_request: {
            merchantId: 'merchant-current',
            sessionId: 'session-1',
            shipmentType: 'international',
            receiver: {
              name: 'Jane Receiver',
              phone: '',
              address: '123 Queen Street West',
              city: 'Toronto',
              state: 'Ontario',
              country: 'Canada',
              countryCode: 'CA',
              postalCode: 'M5V 3L9',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        {
          merchantId: 'merchant-current',
          items: [checkoutPhoneItem],
          shippingFee: 1,
          shippingProvider: 'GIGL',
        }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      status: 400,
    });
  });

  it('rejects changed checkout shipping fees when stored quote price is a string', async () => {
    await expect(
      enrichShippingAddressWithQuoteDestination(
        createSupabaseRpcMock({
          price: '10000',
          provider_rate_id: 'GIGL_INTL_1_2_3_1',
          quote_request: {
            merchantId: 'merchant-current',
            sessionId: 'session-1',
            shipmentType: 'international',
            receiver: {
              name: 'Jane Receiver',
              phone: '',
              address: '123 Queen Street West',
              city: 'Toronto',
              state: 'Ontario',
              country: 'Canada',
              countryCode: 'CA',
              postalCode: 'M5V 3L9',
            },
            items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
          },
        }) as unknown as SupabaseClient,
        'quote-1',
        shippingAddress,
        {
          merchantId: 'merchant-current',
          items: [checkoutPhoneItem],
          shippingFee: 1,
          shippingProvider: 'GIGL',
        }
      )
    ).rejects.toMatchObject({
      code: 'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      status: 400,
    });
  });
});
