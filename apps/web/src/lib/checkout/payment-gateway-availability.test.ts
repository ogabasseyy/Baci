import { describe, expect, it } from 'vitest';
import {
  getLaunchPaymentRequirement,
  hasLaunchablePaymentMethod,
  isBankTransferCheckoutAvailable,
  isKorapayCheckoutAvailable,
  isKorapayCheckoutCurrencySupported,
  isPayOnDeliveryCheckoutAvailable,
  isPaystackCheckoutAvailable,
} from '@/lib/checkout/payment-gateway-availability';

describe('payment-gateway-availability', () => {
  it('returns true when paystack is enabled and a subaccount exists', () => {
    const merchant = {
      country: 'NG',
      paystack_subaccount_code: 'ACCT_123',
      feature_settings: {},
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(true);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(false);
  });

  it('treats the snapshot paystack_subaccount_configured hint as subaccount presence', () => {
    // Public snapshot merchants carry a derived boolean instead of the raw
    // subaccount code, which never crosses the anonymous boundary.
    const merchant = {
      country: 'NG',
      paystack_subaccount_configured: true,
      feature_settings: {
        paystack_enabled: true,
        wallet_paystack_dva_enabled: true,
      },
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(true);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(true);
  });

  it('does not surface paystack when the hint is false and no raw code exists', () => {
    const merchant = {
      country: 'NG',
      paystack_subaccount_configured: false,
      feature_settings: { paystack_enabled: true },
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(false);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(false);
  });

  it('returns true for bank transfer only when Paystack DVA is explicitly enabled', () => {
    const merchant = {
      country: 'NG',
      paystack_subaccount_code: 'ACCT_123',
      feature_settings: {
        paystack_enabled: true,
        wallet_paystack_dva_enabled: true,
      },
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(true);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(true);
  });

  it('returns false for Paystack when the merchant country is explicitly unsupported', () => {
    const merchant = {
      country: 'IN',
      paystack_subaccount_code: 'ACCT_123',
      feature_settings: { paystack_enabled: true },
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(false);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(false);
  });

  it('returns false when paystack is explicitly disabled', () => {
    const merchant = {
      paystack_subaccount_code: 'ACCT_123',
      feature_settings: { paystack_enabled: false },
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(false);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(false);
  });

  it('normalizes embedded feature settings arrays before reading payment flags', () => {
    const merchant = {
      paystack_subaccount_code: 'ACCT_123',
      feature_settings: [
        {
          korapay_enabled: true,
          pay_on_delivery_enabled: true,
          paystack_enabled: false,
          wallet_paystack_dva_enabled: true,
        },
      ],
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(false);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(false);
    expect(isKorapayCheckoutAvailable(merchant)).toBe(true);
    expect(isPayOnDeliveryCheckoutAvailable(merchant)).toBe(true);
  });

  it('returns false when no paystack subaccount exists', () => {
    const merchant = {
      paystack_subaccount_code: null,
      feature_settings: { paystack_enabled: true },
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(false);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(false);
  });

  it('returns false when the paystack subaccount only contains whitespace', () => {
    const merchant = {
      paystack_subaccount_code: '   ',
      feature_settings: { paystack_enabled: true },
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(false);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(false);
  });

  it('returns false when the paystack subaccount is an empty string', () => {
    const merchant = {
      paystack_subaccount_code: '',
      feature_settings: { paystack_enabled: true },
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(false);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(false);
  });

  it('returns false when the paystack subaccount is undefined', () => {
    const merchant = {
      paystack_subaccount_code: undefined,
      feature_settings: { paystack_enabled: true },
    };

    expect(isPaystackCheckoutAvailable(merchant)).toBe(false);
    expect(isBankTransferCheckoutAvailable(merchant)).toBe(false);
  });

  it('returns false when merchant data is missing', () => {
    expect(isPaystackCheckoutAvailable(null)).toBe(false);
    expect(isPaystackCheckoutAvailable(undefined)).toBe(false);
    expect(isBankTransferCheckoutAvailable(null)).toBe(false);
    expect(isBankTransferCheckoutAvailable(undefined)).toBe(false);
    expect(isKorapayCheckoutAvailable(null)).toBe(false);
    expect(isKorapayCheckoutAvailable(undefined)).toBe(false);
  });

  it('returns false for Korapay when not explicitly enabled', () => {
    expect(
      isKorapayCheckoutAvailable({
        feature_settings: {},
      })
    ).toBe(false);
  });

  it('returns true for Korapay when explicitly enabled', () => {
    expect(
      isKorapayCheckoutAvailable({
        feature_settings: { korapay_enabled: true },
      })
    ).toBe(true);
  });

  it('returns false for Korapay when the checkout currency is unsupported', () => {
    expect(
      isKorapayCheckoutAvailable(
        {
          feature_settings: { korapay_enabled: true },
        },
        'INR'
      )
    ).toBe(false);
  });

  it('accepts Korapay checkout currencies case-insensitively', () => {
    expect(isKorapayCheckoutCurrencySupported(' ghs ')).toBe(true);
    expect(isKorapayCheckoutCurrencySupported('INR')).toBe(false);
    expect(isKorapayCheckoutCurrencySupported(null)).toBe(false);
  });

  it('returns false for Korapay when explicitly disabled', () => {
    expect(
      isKorapayCheckoutAvailable({
        feature_settings: { korapay_enabled: false },
      })
    ).toBe(false);
  });

  it('returns true for Pay on Delivery when explicitly enabled', () => {
    expect(
      isPayOnDeliveryCheckoutAvailable({
        feature_settings: { pay_on_delivery_enabled: true },
      })
    ).toBe(true);
  });

  it('returns false for Pay on Delivery when disabled or missing', () => {
    expect(
      isPayOnDeliveryCheckoutAvailable({
        feature_settings: { pay_on_delivery_enabled: false },
      })
    ).toBe(false);
    expect(isPayOnDeliveryCheckoutAvailable({})).toBe(false);
  });

  it('treats India Pay on Delivery as a launchable payment method without Paystack bank details', () => {
    expect(
      hasLaunchablePaymentMethod({
        country: 'IN',
        bank_account_number: null,
        bank_code: null,
        paystack_subaccount_code: null,
        feature_settings: {
          pay_on_delivery_enabled: true,
          paystack_enabled: false,
        },
      })
    ).toBe(true);
  });

  it('does not treat India as launchable when Pay on Delivery is disabled and Paystack details are missing', () => {
    expect(
      hasLaunchablePaymentMethod({
        country: 'IN',
        bank_account_number: null,
        bank_code: null,
        paystack_subaccount_code: null,
        feature_settings: {
          pay_on_delivery_enabled: false,
          paystack_enabled: false,
        },
      })
    ).toBe(false);
  });

  it.each([
    ['GHS', true],
    ['INR', false],
  ])('treats enabled Korapay as launchable only for supported payout currency %s', (payoutCurrency, completed) => {
    const merchant = {
      country: 'GH',
      payout_currency: payoutCurrency,
      feature_settings: {
        korapay_enabled: true,
        pay_on_delivery_enabled: false,
        paystack_enabled: false,
      },
    };

    expect(hasLaunchablePaymentMethod(merchant)).toBe(completed);
    expect(getLaunchPaymentRequirement(merchant)).toMatchObject({
      id: 'payment_method',
      completed,
    });
  });
});

it.each([
  { paystack_subaccount_code: 'ACCT_fixture' },
  { paystack_subaccount_configured: true },
])('uses enable-payment readiness wording for disabled Paystack with configuration %j', async (configuration) => {
  const { getReadinessLaunchPaymentRequirement } = await import(
    './payment-gateway-availability'
  );
  expect(
    getReadinessLaunchPaymentRequirement({
      country: 'NG',
      bank_account_number: 'configured',
      bank_code: 'configured',
      ...configuration,
      feature_settings: { paystack_enabled: false },
    })
  ).toMatchObject({
    id: 'payment_method',
    label: 'Enable a payment method',
    completed: false,
  });
});
