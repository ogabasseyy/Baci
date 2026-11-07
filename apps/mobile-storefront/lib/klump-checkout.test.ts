import {
  buildKlumpBnplRouteParams,
  buildKlumpInitializePayload,
  getKlumpDisabledReason,
  shouldHideKlumpPaymentMethod,
} from './klump-checkout';

const settings = {
  klump_enabled: true,
  klump_max_amount: 500000,
  klump_min_amount: 10000,
};

describe('klump checkout helpers', () => {
  it('rejects and hides retired Klump regardless of saved settings, credit or amount', () => {
    for (const amount of [5000, 120000, 1000001, Number.NaN]) {
      for (const staleSettings of [undefined, null, settings]) {
        expect(getKlumpDisabledReason(staleSettings, amount)).toBe(
          'Klump is no longer available. Choose another payment method.'
        );
        expect(
          getKlumpDisabledReason(staleSettings, amount, {
            use: true,
            amount: 5000,
          })
        ).toBe('Klump is no longer available. Choose another payment method.');
        expect(shouldHideKlumpPaymentMethod(staleSettings, amount)).toBe(true);
      }
    }
  });

  it('builds the initialize payload without trusting a client amount', () => {
    expect(
      buildKlumpInitializePayload({
        customerEmail: 'customer@example.com',
        customerName: 'Ada Customer',
        customerPhone: '08012345678',
        merchantId: 'merchant-123',
        orderId: 'order-123',
      })
    ).toEqual({
      currency: 'NGN',
      customer_email: 'customer@example.com',
      customer_name: 'Ada Customer',
      customer_phone: '08012345678',
      gateway: 'klump',
      merchant_id: 'merchant-123',
      order_id: 'order-123',
    });
  });

  it('builds BNPL route params with authorization URL, reference, and tracking token', () => {
    expect(
      buildKlumpBnplRouteParams({
        amount: 120000,
        authorizationUrl:
          'https://ogabassey.usebaci.com/checkout/bnpl?gateway=klump',
        customerEmail: 'customer@example.com',
        customerName: 'Ada Customer',
        customerPhone: '08012345678',
        orderId: 'order-123',
        reference: 'BAC-ABCD12345678',
        merchantDomain: 'ogabassey.com',
        merchantSlug: 'ogabassey',
        trackingToken: 'track-token-123',
      })
    ).toEqual({
      amount: '120000.00',
      authorizationUrl:
        'https://ogabassey.usebaci.com/checkout/bnpl?gateway=klump',
      customerEmail: 'customer@example.com',
      customerName: 'Ada Customer',
      customerPhone: '08012345678',
      gateway: 'klump',
      orderId: 'order-123',
      reference: 'BAC-ABCD12345678',
      merchantDomain: 'ogabassey.com',
      merchantSlug: 'ogabassey',
      trackingToken: 'track-token-123',
    });
  });
});
