import { describe, expect, it } from 'vitest';

import { safeJsonLdStringify } from './sanitize-json-ld';
import { generateProductSchema } from './seo-utils';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('generateProductSchema accepted payment methods', () => {
  it('adds configured accepted payment methods to product offers', () => {
    const schema = generateProductSchema(
      makeSeoProduct(),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        acceptedPaymentMethods: [
          'Bank transfer',
          'Debit and credit card',
          'USSD',
          'Bank transfer',
          ' ',
        ],
      }
    );

    expect(schema.offers).toMatchObject({
      '@type': 'Offer',
      acceptedPaymentMethod: [
        'https://schema.org/ByBankTransferInAdvance',
        'https://schema.org/CreditCard',
        'USSD',
      ],
    });
  });

  it('preserves accepted payment method text for JSON-LD serialization', () => {
    const schema = generateProductSchema(
      makeSeoProduct(),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        acceptedPaymentMethods: ['Pay by B&O card & wallet'],
      }
    );

    const offers = schema.offers as Record<string, unknown>;
    expect(offers.acceptedPaymentMethod).toEqual([
      'https://schema.org/CreditCard',
    ]);

    const parsed = JSON.parse(safeJsonLdStringify(schema)) as Record<
      string,
      unknown
    >;
    expect(
      (parsed.offers as Record<string, unknown>).acceptedPaymentMethod
    ).toEqual(['https://schema.org/CreditCard']);
  });

  it('attaches configured accepted payment methods once on the shared variant seller Organization', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        variants: [
          {
            id: 'v1',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: { storage: '128GB' },
            price_override: 90,
            stock_quantity: 5,
          },
          {
            id: 'v2',
            product_id: 'test-123',
            merchant_id: 'm1',
            attributes: { storage: '256GB' },
            price_override: 110,
            stock_quantity: 3,
          },
        ],
      }),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      undefined,
      {
        acceptedPaymentMethods: ['Pay on delivery'],
        merchantBaseUrl: 'https://teststore.usebaci.com',
        productUrl: 'https://teststore.usebaci.com/phones/test-product',
      }
    );

    const variants = schema.hasVariant as Record<string, unknown>[];
    const firstOffer = variants[0]?.offers as Record<string, unknown>;
    const secondOffer = variants[1]?.offers as Record<string, unknown>;

    expect(firstOffer).not.toHaveProperty('acceptedPaymentMethod');
    expect(secondOffer).not.toHaveProperty('acceptedPaymentMethod');
    expect(firstOffer.seller).toEqual({
      '@type': 'Organization',
      '@id': 'https://teststore.usebaci.com/#online-store',
      name: 'TestStore',
      acceptedPaymentMethod: ['https://schema.org/COD'],
    });
    expect(secondOffer.seller).toEqual({
      '@id': 'https://teststore.usebaci.com/#online-store',
    });
  });
});
