import { describe, expect, it } from 'vitest';
import { toChatwootCheckoutMerchant } from './chatwoot-checkout-merchant';

describe('toChatwootCheckoutMerchant', () => {
  it('charges the merchant VAT rate only when registered', () => {
    expect(
      toChatwootCheckoutMerchant({
        id: 'm1',
        vat_registration_status: 'registered',
        vat_rate: 5,
      })
    ).toMatchObject({ id: 'm1', taxRate: 0.05 });
    expect(
      toChatwootCheckoutMerchant({
        id: 'm1',
        vat_registration_status: 'registered',
      })
    ).toMatchObject({ id: 'm1', taxRate: 0.075 });
    expect(
      toChatwootCheckoutMerchant({
        id: 'm1',
        vat_registration_status: 'not_registered',
        vat_rate: 7.5,
      })
    ).toMatchObject({ id: 'm1', taxRate: 0 });
  });

  it('is unavailable without a merchant', () => {
    expect(toChatwootCheckoutMerchant(null)).toBeNull();
  });

  it('offers bank transfer only when the store checkout gate does', () => {
    const base = {
      id: 'm1',
      country: 'NG',
      paystack_subaccount_configured: true,
    };
    const available = {
      ...base,
      feature_settings: { wallet_paystack_dva_enabled: true },
    };

    expect(toChatwootCheckoutMerchant(available)?.bankTransferAvailable).toBe(
      true
    );
    expect(toChatwootCheckoutMerchant(base)?.bankTransferAvailable).toBe(false);
    expect(
      toChatwootCheckoutMerchant({
        ...available,
        paystack_subaccount_configured: false,
      })?.bankTransferAvailable
    ).toBe(false);
    expect(
      toChatwootCheckoutMerchant({
        ...available,
        feature_settings: {
          wallet_paystack_dva_enabled: true,
          paystack_enabled: false,
        },
      })?.bankTransferAvailable
    ).toBe(false);
    expect(
      toChatwootCheckoutMerchant({ ...available, country: 'GH' })
        ?.bankTransferAvailable
    ).toBe(false);
  });
});
