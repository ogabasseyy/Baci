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
    ).toEqual({ id: 'm1', taxRate: 0.05 });
    expect(
      toChatwootCheckoutMerchant({
        id: 'm1',
        vat_registration_status: 'registered',
      })
    ).toEqual({ id: 'm1', taxRate: 0.075 });
    expect(
      toChatwootCheckoutMerchant({
        id: 'm1',
        vat_registration_status: 'not_registered',
        vat_rate: 7.5,
      })
    ).toEqual({ id: 'm1', taxRate: 0 });
  });

  it('is unavailable without a merchant', () => {
    expect(toChatwootCheckoutMerchant(null)).toBeNull();
  });
});
