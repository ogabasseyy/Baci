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

  it('adds configured accepted payment methods to variant offers', () => {
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
        ],
      }),
      'TestStore',
      'NGN',
      'NG',
      undefined,
      undefined,
      { acceptedPaymentMethods: ['Pay on delivery'] }
    );

    const variants = schema.hasVariant as Record<string, unknown>[];
    const offer = variants[0]?.offers as Record<string, unknown>;

    expect(offer.acceptedPaymentMethod).toEqual(['https://schema.org/COD']);
  });
});
