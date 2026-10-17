import { describe, expect, it } from 'vitest';
import { resolveKudaFallbackCreditCorrection } from './vtu-fallback-credit-correction';

describe('resolveKudaFallbackCreditCorrection', () => {
  const rowBase = {
    amount: 1000,
    customer_cashback: 12.5,
    customer_id: 'customer-1',
    merchant_commission: 12.5,
    network_provider: '9MOBILE',
    type: 'airtime',
  };
  const metadataBase = {
    customerCashbackEnabled: true,
    customerCashbackRate: 50,
    originalMerchantCommission: 25,
    providerFallback: 'monnify_airtime_to_kuda',
  };

  it('recomputes merchant, cashback, and platform shares on Kuda rates', () => {
    // ₦1000 9MOBILE at an inferred 50% split: Kuda total ₦45 →
    // merchant earning ₦22.5, cashback half of that, platform the
    // Kuda total minus the merchant earning.
    expect(
      resolveKudaFallbackCreditCorrection({
        metadata: { ...metadataBase },
        row: { ...rowBase },
      })
    ).toEqual({
      customerCashback: 11.25,
      merchantCommission: 11.25,
      originalMerchantCommission: 22.5,
      platformCommission: 22.5,
    });
  });

  it('gives the merchant the full earning when no customer can take cashback', () => {
    expect(
      resolveKudaFallbackCreditCorrection({
        metadata: { ...metadataBase, customerCashbackEnabled: false },
        row: { ...rowBase, customer_cashback: 0, customer_id: null },
      })
    ).toMatchObject({
      customerCashback: 0,
      merchantCommission: 22.5,
      platformCommission: 22.5,
    });
  });

  it('returns null for rows outside the fallback correction', () => {
    expect(
      resolveKudaFallbackCreditCorrection({
        metadata: { ...metadataBase },
        row: { ...rowBase, type: 'electricity' },
      })
    ).toBeNull();
    expect(
      resolveKudaFallbackCreditCorrection({
        metadata: {},
        row: { ...rowBase },
      })
    ).toBeNull();
    expect(
      resolveKudaFallbackCreditCorrection({
        metadata: { ...metadataBase },
        row: { ...rowBase, amount: 0 },
      })
    ).toBeNull();
  });
});
