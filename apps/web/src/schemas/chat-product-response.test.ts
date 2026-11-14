import { describe, expect, it } from 'vitest';
import { chatProductResponseSchema } from './chat-product-response';

const validResponse = {
  product: {
    id: 'product-1',
    name: 'P'.repeat(2048),
    description: '',
    status: 'active',
    price: 100,
    currency: { code: 'NGN', locale: 'en-NG', symbol: '₦' },
    manage_stock: true,
    stock: 1,
    image: '',
    imageLarge: '',
    imageHint: '',
    brand: '',
    gtin: '',
    mpn: '',
    variants: [
      {
        id: 'variant-1',
        product_id: 'product-1',
        merchant_id: 'merchant-1',
        attributes: { storage: '128GB' },
        stock_quantity: 1,
      },
    ],
  },
};

describe('chatProductResponseSchema', () => {
  it('accepts valid values at the string boundary', () => {
    expect(chatProductResponseSchema.safeParse(validResponse).success).toBe(
      true
    );
  });

  it('rejects private extra fields and values beyond schema bounds', () => {
    expect(
      chatProductResponseSchema.safeParse({
        product: { ...validResponse.product, sku: 'private-sku' },
      }).success
    ).toBe(false);
    expect(
      chatProductResponseSchema.safeParse({
        product: { ...validResponse.product, name: 'P'.repeat(2049) },
      }).success
    ).toBe(false);
    expect(
      chatProductResponseSchema.safeParse({
        product: {
          ...validResponse.product,
          variants: Array.from({ length: 129 }, (_, index) => ({
            id: `variant-${index}`,
            product_id: 'product-1',
            merchant_id: 'merchant-1',
            attributes: {},
            stock_quantity: 1,
          })),
        },
      }).success
    ).toBe(false);
  });

  it('rejects variants with more than ten attribute entries', () => {
    expect(
      chatProductResponseSchema.safeParse({
        product: {
          ...validResponse.product,
          variants: [
            {
              id: 'variant-1',
              product_id: 'product-1',
              merchant_id: 'merchant-1',
              attributes: Object.fromEntries(
                Array.from({ length: 11 }, (_, index) => [
                  `attribute-${index}`,
                  `value-${index}`,
                ])
              ),
              stock_quantity: 1,
            },
          ],
        },
      }).success
    ).toBe(false);
  });
});
