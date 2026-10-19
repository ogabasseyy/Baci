import { describe, expect, it } from 'vitest';
import type { ShippingQuote } from '@/types/shipping-quote';
import { buildCheckoutShippingSelectionPayload } from './checkout-order-shipping-payload';

const merchantQuote: ShippingQuote = {
  id: 'mrate_9f1b2c3d-0000-4000-8000-000000000001',
  provider: 'MERCHANT',
  serviceTier: 'standard',
  carrierName: 'Standard Delivery',
  displayName: 'Standard Delivery',
  estimatedDays: 3,
  price: 1500,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: false,
};

const carrierQuote: ShippingQuote = {
  id: '9f1b2c3d-0000-4000-8000-000000000002',
  provider: 'GIGL',
  serviceTier: 'express',
  carrierName: 'GIG Logistics',
  displayName: 'Express Delivery',
  estimatedDays: 1,
  price: 5000,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: true,
};

describe('buildCheckoutShippingSelectionPayload', () => {
  it('threads merchant rates as a bare shipping_rate_id with no carrier quote', () => {
    expect(
      buildCheckoutShippingSelectionPayload(merchantQuote, 'session-merchant')
    ).toEqual({
      selected_quote_id: null,
      shipping_carrier: 'Standard Delivery',
      shipping_provider: null,
      shipping_rate_id: '9f1b2c3d-0000-4000-8000-000000000001',
      shipping_service_tier: 'standard',
      shipping_session_id: 'session-merchant',
    });
  });

  it('threads UUIDv7 merchant rates as a bare shipping_rate_id', () => {
    expect(
      buildCheckoutShippingSelectionPayload(
        {
          ...merchantQuote,
          id: 'mrate_01989d89-5b1d-7000-8000-000000000001',
        },
        'session-merchant-v7'
      )
    ).toEqual(
      expect.objectContaining({
        selected_quote_id: null,
        shipping_provider: null,
        shipping_rate_id: '01989d89-5b1d-7000-8000-000000000001',
      })
    );
  });

  it('keeps persisted carrier quote identifiers intact', () => {
    expect(
      buildCheckoutShippingSelectionPayload(carrierQuote, 'session-carrier')
    ).toEqual({
      selected_quote_id: '9f1b2c3d-0000-4000-8000-000000000002',
      shipping_carrier: 'GIG Logistics',
      shipping_provider: 'GIGL',
      shipping_service_tier: 'express',
      shipping_session_id: 'session-carrier',
    });
  });

  it('rejects malformed merchant quote ids before order submission', () => {
    expect(() =>
      buildCheckoutShippingSelectionPayload(
        { ...merchantQuote, id: 'mrate_not-a-uuid' },
        'session-invalid'
      )
    ).toThrow('selected merchant delivery option is invalid');
  });
});
