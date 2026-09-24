import type {
  SavingsSelection,
  WalletSelection,
} from '@/lib/wallet-payment-helpers';
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
  it('does not disable eligible Klump orders', () => {
    expect(getKlumpDisabledReason(settings, 120000)).toBeUndefined();
  });

  it('disables Klump when wallet credit is active', () => {
    const walletSelection: WalletSelection = { use: true, amount: 5000 };

    expect(getKlumpDisabledReason(settings, 120000, walletSelection)).toBe(
      'Wallet credit cannot be combined with Klump'
    );
  });

  it('disables Klump when savings plan credit is active', () => {
    const savingsSelection: SavingsSelection = {
      amount: 5000,
      goalId: 'goal-1',
      use: true,
    };

    expect(
      getKlumpDisabledReason(settings, 120000, undefined, savingsSelection)
    ).toBe('Savings plan cannot be combined with Klump');
  });

  it('uses merchant configured amount boundaries for disabled reasons', () => {
    expect(getKlumpDisabledReason(settings, 9000)).toBe(
      'Minimum order: ₦10,000'
    );
    expect(getKlumpDisabledReason(settings, 600000)).toBe(
      'Maximum order: ₦500,000'
    );
  });

  it('uses a one million naira default maximum when merchant limits are missing', () => {
    expect(
      getKlumpDisabledReason(
        {
          klump_enabled: true,
          klump_min_amount: undefined,
          klump_max_amount: undefined,
        },
        1_000_000
      )
    ).toBeUndefined();
  });

  it('disables Klump above the one million naira default maximum', () => {
    expect(
      getKlumpDisabledReason(
        {
          klump_enabled: true,
          klump_min_amount: undefined,
          klump_max_amount: undefined,
        },
        1_000_001
      )
    ).toBe('Maximum order: ₦1,000,000');
  });

  it('hides Klump only when the order exceeds the numeric maximum', () => {
    expect(shouldHideKlumpPaymentMethod(undefined, 1_000_001)).toBe(false);
    expect(shouldHideKlumpPaymentMethod(null, 1_000_001)).toBe(false);
    expect(
      shouldHideKlumpPaymentMethod(
        {
          klump_enabled: false,
          klump_min_amount: undefined,
          klump_max_amount: undefined,
        },
        1_000_001
      )
    ).toBe(false);
    expect(
      shouldHideKlumpPaymentMethod(
        {
          klump_enabled: true,
          klump_min_amount: undefined,
          klump_max_amount: undefined,
        },
        Number.NaN
      )
    ).toBe(false);
    expect(
      shouldHideKlumpPaymentMethod(
        {
          klump_enabled: true,
          klump_min_amount: undefined,
          klump_max_amount: undefined,
        },
        Number.POSITIVE_INFINITY
      )
    ).toBe(false);
    expect(
      shouldHideKlumpPaymentMethod(
        {
          klump_enabled: true,
          klump_min_amount: undefined,
          klump_max_amount: undefined,
        },
        1_000_001
      )
    ).toBe(true);
    expect(
      shouldHideKlumpPaymentMethod(
        {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 750_000,
        },
        750_000
      )
    ).toBe(false);
    expect(
      shouldHideKlumpPaymentMethod(
        {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 750_000,
        },
        750_001
      )
    ).toBe(true);
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
