import { describe, expect, it } from 'vitest';
import {
  hasAnyInstallmentOption,
  isCreditDirectEligible,
  isKlumpEligible,
  isPaymentMethodAvailable,
} from './payment-step-availability';

describe('payment-step availability helpers', () => {
  it('keeps Klump retired even when merchant settings enable it', () => {
    expect(isKlumpEligible({ featureSettings: { klump_enabled: true }, currency: 'NGN', orderAmount: 50000, payableAmount: 50000 })).toBe(false);
    expect(hasAnyInstallmentOption({ featureSettings: { klump_enabled: true }, currency: 'NGN', orderAmount: 50000, payableAmount: 50000 })).toBe(false);
  });

  it('checks selected payment method and installment availability', () => {
    const featureSettings = {
      credit_direct_enabled: true,
      klump_enabled: true,
    };

    expect(
      isPaymentMethodAvailable({
        paymentMethod: 'klump',
        paystackCheckoutAvailable: false,
        korapayCheckoutAvailable: false,
        bankTransferCheckoutAvailable: false,
        featureSettings,
        currency: 'NGN',
        orderAmount: 50_000,
        payableAmount: 50_000,
      }),
    ).toBe(false);
    expect(
      hasAnyInstallmentOption({
        featureSettings,
        currency: 'NGN',
        orderAmount: 50_000,
        payableAmount: 50_000,
      }),
    ).toBe(true);
  });

  it('hides the NGN-only flag rails (Juicyway, CredPal) on non-NGN checkouts', () => {
    const featureSettings = { juicyway_enabled: true, credpal_enabled: true };
    const base = {
      paystackCheckoutAvailable: false,
      korapayCheckoutAvailable: false,
      bankTransferCheckoutAvailable: false,
      featureSettings,
      orderAmount: 50_000,
      payableAmount: 50_000,
    };

    for (const paymentMethod of ['juicyway', 'credpal'] as const) {
      // Non-NGN checkout: never offered, even with the flag enabled.
      expect(
        isPaymentMethodAvailable({ ...base, paymentMethod, currency: 'GHS' }),
      ).toBe(false);
      // Missing currency fails closed (matches Klump/Credit Direct).
      expect(
        isPaymentMethodAvailable({ ...base, paymentMethod, currency: null }),
      ).toBe(false);
      // NGN checkout: unchanged.
      expect(
        isPaymentMethodAvailable({ ...base, paymentMethod, currency: 'NGN' }),
      ).toBe(paymentMethod === 'juicyway');
    }
  });

  it('reports no installment options when only retired CredPal is enabled', () => {
    const featureSettings = { credpal_enabled: true };

    expect(
      hasAnyInstallmentOption({
        featureSettings,
        currency: 'GHS',
        orderAmount: 50_000,
        payableAmount: 50_000,
      }),
    ).toBe(false);
    expect(
      hasAnyInstallmentOption({
        featureSettings,
        currency: 'NGN',
        orderAmount: 50_000,
        payableAmount: 50_000,
      }),
    ).toBe(false);
  });

  it('requires enabled NGN Credit Direct within its amount bounds', () => {
    expect(
      isCreditDirectEligible({
        featureSettings: { credit_direct_enabled: true },
        currency: 'NGN',
        orderAmount: 300_000,
        payableAmount: 300_000,
      }),
    ).toBe(true);
    // Disabled.
    expect(
      isCreditDirectEligible({
        featureSettings: { credit_direct_enabled: false },
        currency: 'NGN',
        orderAmount: 300_000,
        payableAmount: 300_000,
      }),
    ).toBe(false);
    // Non-NGN currency.
    expect(
      isCreditDirectEligible({
        featureSettings: { credit_direct_enabled: true },
        currency: null,
        orderAmount: 300_000,
        payableAmount: 300_000,
      }),
    ).toBe(false);
    // Credit Direct signs the server-derived residual after wallet credit.
    expect(
      isCreditDirectEligible({
        featureSettings: { credit_direct_enabled: true },
        currency: 'NGN',
        orderAmount: 300_000,
        payableAmount: 250_000,
      }),
    ).toBe(true);
    // Above the default ₦5,000,000 cap.
    expect(
      isCreditDirectEligible({
        featureSettings: { credit_direct_enabled: true },
        currency: 'NGN',
        orderAmount: 6_000_000,
        payableAmount: 6_000_000,
      }),
    ).toBe(false);
    // Below the default ₦5,000 floor.
    expect(
      isCreditDirectEligible({
        featureSettings: { credit_direct_enabled: true },
        currency: 'NGN',
        orderAmount: 1_000,
        payableAmount: 1_000,
      }),
    ).toBe(false);
  });

  it('falls back empty Credit Direct limits to the default eligibility bounds', () => {
    expect(
      isCreditDirectEligible({
        featureSettings: {
          credit_direct_enabled: true,
          credit_direct_min_amount: '',
          credit_direct_max_amount: '   ',
        },
        currency: 'ngn',
        orderAmount: 5_000_000,
        payableAmount: 5_000_000,
      }),
    ).toBe(true);
    expect(
      isCreditDirectEligible({
        featureSettings: {
          credit_direct_enabled: true,
          credit_direct_min_amount: '',
          credit_direct_max_amount: null,
        },
        currency: 'NGN',
        orderAmount: 5_000_001,
        payableAmount: 5_000_001,
      }),
    ).toBe(false);
  });

  it('honors configured Credit Direct min/max amounts as strings', () => {
    const featureSettings = {
      credit_direct_enabled: true,
      credit_direct_min_amount: '5000.00',
      credit_direct_max_amount: '5000000.00',
    };
    // At the configured maximum.
    expect(
      isCreditDirectEligible({
        featureSettings,
        currency: 'NGN',
        orderAmount: 5_000_000,
        payableAmount: 5_000_000,
      }),
    ).toBe(true);
    // Above the configured maximum.
    expect(
      isCreditDirectEligible({
        featureSettings,
        currency: 'NGN',
        orderAmount: 5_000_001,
        payableAmount: 5_000_001,
      }),
    ).toBe(false);
    // At the configured minimum.
    expect(
      isCreditDirectEligible({
        featureSettings,
        currency: 'NGN',
        orderAmount: 5_000,
        payableAmount: 5_000,
      }),
    ).toBe(true);
    // Below the configured minimum.
    expect(
      isCreditDirectEligible({
        featureSettings,
        currency: 'NGN',
        orderAmount: 4_999,
        payableAmount: 4_999,
      }),
    ).toBe(false);
  });

  it('hides Credit Direct via isPaymentMethodAvailable when the order exceeds its max', () => {
    const featureSettings = {
      credit_direct_enabled: true,
      credit_direct_max_amount: '5000000',
    };

    // In range -> offered.
    expect(
      isPaymentMethodAvailable({
        paymentMethod: 'credit_direct',
        paystackCheckoutAvailable: false,
        korapayCheckoutAvailable: false,
        bankTransferCheckoutAvailable: false,
        featureSettings,
        currency: 'NGN',
        orderAmount: 300_000,
        payableAmount: 300_000,
      }),
    ).toBe(true);

    // Over the ₦5,000,000 cap -> hidden (regression for the over-limit offer bug).
    expect(
      isPaymentMethodAvailable({
        paymentMethod: 'credit_direct',
        paystackCheckoutAvailable: false,
        korapayCheckoutAvailable: false,
        bankTransferCheckoutAvailable: false,
        featureSettings,
        currency: 'NGN',
        orderAmount: 6_237_523,
        payableAmount: 6_237_523,
      }),
    ).toBe(false);
  });
});

it.each(['oxygen', 'credit_direct'] as const)('offers %s for a valid residual and rejects invalid balances', (paymentMethod) => {
 const base = { paymentMethod, oxygenAllowed: true, featureSettings: { klump_enabled: true, credit_direct_enabled: true }, currency: 'NGN', orderAmount: 50000, paystackCheckoutAvailable: false, korapayCheckoutAvailable: false, bankTransferCheckoutAvailable: false };
 expect(isPaymentMethodAvailable({ ...base, payableAmount: 30000 })).toBe(true);
 for (const payableAmount of [0, -1, 50001, Number.NaN, Number.POSITIVE_INFINITY]) expect(isPaymentMethodAvailable({ ...base, payableAmount })).toBe(false);
});
