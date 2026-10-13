import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { enrichShippingAddressWithQuoteDestination } from '@/lib/shipping/order-quote-destination';
import { createSupabaseRpcMock } from '@/lib/shipping/test-helpers/create-supabase-rpc-mock';
import {
  readOptionalShippingFee,
  readReuseQuoteValidationContext,
} from './quote-validation-context';

describe('readReuseQuoteValidationContext', () => {
  it.each([
    true,
    false,
  ])('keeps reused order pin provenance for real quote validation (matching: %s)', async (matching) => {
    const address = {
      address: '12 Allen Avenue',
      city: 'Ikeja',
      state: 'Lagos',
      latitude: 6.5,
      longitude: 3.35,
    };
    const context = readReuseQuoteValidationContext({
      shipping_address: address,
    });
    const supabase = createSupabaseRpcMock({
      price: 1000,
      provider_rate_id: 'GIGL_1_2_3_1',
      quote_request: {
        merchantId: 'merchant-one',
        shipmentType: 'domestic',
        receiver: {
          ...address,
          latitude: matching ? 6.5 : 6.6,
          name: 'Buyer',
          phone: '08012345678',
        },
        items: [],
      },
    }) as unknown as SupabaseClient;
    const validation = enrichShippingAddressWithQuoteDestination(
      supabase,
      'quote-one',
      context?.shipping_address,
      {
        merchantId: 'merchant-one',
        shippingProvider: 'GIGL',
        shippingFee: 1000,
      }
    );
    if (matching) {
      await expect(validation).resolves.toMatchObject({
        latitude: 6.5,
        longitude: 3.35,
      });
    } else {
      await expect(validation).rejects.toThrow();
    }
  });

  it('preserves both stored destination coordinates including zero', () => {
    const context = readReuseQuoteValidationContext({
      shipping_address: {
        address: '12 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        latitude: 0,
        longitude: 3.35,
      },
    });
    expect(context?.shipping_address).toMatchObject({
      latitude: 0,
      longitude: 3.35,
    });
  });

  it.each([
    { latitude: 6.5 },
    { latitude: '6.5', longitude: 3.35 },
    { latitude: 91, longitude: 3.35 },
  ])('rejects malformed stored coordinate pairs rather than dropping them: %j', (pin) => {
    const context = readReuseQuoteValidationContext({
      shipping_address: {
        address: '12 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        ...pin,
      },
    });
    expect(context?.shipping_address).toBeUndefined();
  });

  it('preserves product shipping metadata from reusable order quote rows', () => {
    expect(
      readReuseQuoteValidationContext({
        selected_quote_id: 'quote-1',
        shipping_address: {
          address: '123 Queen Street West',
          city: 'Toronto',
          state: 'Ontario',
        },
        shipping_fee: '10000',
        shipping_provider: 'GIGL',
        order_items: [
          {
            name: 'Phone',
            price: '100000',
            quantity: 1,
            product: {
              weight_value: '500',
              weight_unit: 'g',
              dimensions: { length: 4, width: 3, height: 2, unit: 'in' },
              commodity_code: '851712',
            },
          },
        ],
      })
    ).toEqual({
      selected_quote_id: 'quote-1',
      shipping_address: {
        address: '123 Queen Street West',
        city: 'Toronto',
        country: undefined,
        countryCode: undefined,
        postalCode: undefined,
        state: 'Ontario',
      },
      shipping_fee: '10000',
      shipping_provider: 'GIGL',
      order_items: [
        {
          name: 'Phone',
          quantity: 1,
          value: 100_000,
          weight: 0.5,
          hsCode: '851712',
          length: 10.16,
          width: 7.62,
          height: 5.08,
        },
      ],
    });
  });
});

describe('readOptionalShippingFee', () => {
  it('keeps absent reusable order shipping fees non-comparable', () => {
    expect(Number.isNaN(readOptionalShippingFee(null))).toBe(true);
  });
});
