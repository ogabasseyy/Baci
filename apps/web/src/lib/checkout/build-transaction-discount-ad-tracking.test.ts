import { describe, expect, it } from 'vitest';
import { buildTransactionDiscountAdTracking } from './build-transaction-discount-ad-tracking';

describe('buildTransactionDiscountAdTracking', () => {
  it('strips client metadata and persists the server-authored line contract', () => {
    const result = buildTransactionDiscountAdTracking({
      adTracking: {
        fbclid: 'fb-1',
        baci_transaction_discount: { lineDiscounts: [], version: 1 },
      },
      clientIp: '203.0.113.10',
      clientUserAgent: 'test-agent',
      geoPrivacy: {
        country: 'NG',
        region: 'LA',
        shouldApplyLDU: false,
      },
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 20,
          productId: 'product-1',
          vatRelief: 1.5,
          variantId: null,
        },
      ],
      shouldApplyServerDerivedDiscount: true,
      transactionDiscountProof: {
        action: 'storefront_transaction_discount',
        payload: {
          lineDiscounts: [
            {
              lineId: 1,
              merchandiseDiscount: 20,
              productId: 'product-1',
              vatRelief: 1.5,
              variantId: null,
            },
          ],
          nonce: 'nonce-1',
          version: 3,
        },
        signature: 'signed-proof',
      },
      transactionDiscountNonce: 'nonce-1',
    });

    expect(result).toEqual({
      fbclid: 'fb-1',
      geoCountry: 'NG',
      geoRegion: 'LA',
      limitedDataUse: undefined,
      userAgent: 'test-agent',
      userIp: '203.0.113.10',
      baci_transaction_discount: {
        lineDiscounts: [
          {
            lineId: 1,
            merchandiseDiscount: 20,
            productId: 'product-1',
            vatRelief: 1.5,
            variantId: null,
          },
        ],
        nonce: 'nonce-1',
        proof: {
          action: 'storefront_transaction_discount',
          payload: {
            lineDiscounts: [
              {
                lineId: 1,
                merchandiseDiscount: 20,
                productId: 'product-1',
                vatRelief: 1.5,
                variantId: null,
              },
            ],
            nonce: 'nonce-1',
            version: 3,
          },
          signature: 'signed-proof',
        },
        version: 3,
      },
    });
  });

  it('returns no tracking payload when no source or privacy data exists', () => {
    expect(
      buildTransactionDiscountAdTracking({
        geoPrivacy: { shouldApplyLDU: false },
        shouldApplyServerDerivedDiscount: false,
      })
    ).toBeNull();
  });
});
