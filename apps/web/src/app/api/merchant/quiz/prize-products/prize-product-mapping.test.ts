import { describe, expect, it } from 'vitest';
import type {
  QuizPrizeProductRow,
  QuizPrizeVariantRow,
} from '@/schemas/quiz-prize-product';
import { expandPrizeProduct, mapVariantProduct } from './prize-product-mapping';

const product: QuizPrizeProductRow = {
  condition: 'new',
  default_variant_id: null,
  has_variants: true,
  id: '55555555-5555-4555-8555-555555555555',
  images: [{ url: 'https://cdn.example.com/product.png' }],
  manage_stock: true,
  merchant_id: 'merchant-1',
  name: 'Phone',
  price: 100,
  stock: 4,
  stock_quantity: 4,
};

function variant(stockQuantity: number | string): QuizPrizeVariantRow {
  return {
    attributes: { color: 'Blue', storage: '256GB' },
    condition: 'open_box',
    id: '66666666-6666-4666-8666-666666666666',
    images: ['https://cdn.example.com/fallback.png'],
    merchant_id: 'merchant-1',
    price_override: 80,
    primary_image: 'https://cdn.example.com/variant.png',
    product_id: product.id,
    sku: 'PHONE-BLUE',
    stock_quantity: stockQuantity,
  };
}

describe('prize product mapping', () => {
  it('projects exact variant details and image precedence', () => {
    expect(mapVariantProduct(product, variant(3))).toMatchObject({
      available: true,
      condition: 'open_box',
      effectiveStock: 3,
      imageUrl: 'https://cdn.example.com/variant.png',
      price: 80,
      variantLabel: 'Blue / 256GB',
    });
  });

  it('normalizes malformed variant stock to zero instead of NaN', () => {
    const mapped = mapVariantProduct(product, variant('not-a-number'));

    expect(mapped.effectiveStock).toBe(0);
    expect(mapped.available).toBe(false);
  });

  it('expands variant parents by creation order with an id tie-break', () => {
    const later = {
      ...variant(2),
      created_at: '2026-08-01T10:00:00.000Z',
      id: '66666666-6666-4666-8666-666666666666',
    };
    const earlier = {
      ...variant(2),
      created_at: '2026-08-01T09:00:00.000Z',
      id: '77777777-7777-4777-8777-777777777777',
    };
    const tied = {
      ...variant(2),
      created_at: '2026-08-01T09:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
    };

    const expanded = expandPrizeProduct(product, [later, earlier, tied]);

    expect(expanded.map((row) => row.variantId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '77777777-7777-4777-8777-777777777777',
      '66666666-6666-4666-8666-666666666666',
    ]);
  });

  it('omits variant parents without inventory and passes simple products through', () => {
    expect(expandPrizeProduct(product, [])).toEqual([]);
    expect(
      expandPrizeProduct({ ...product, has_variants: false }, [])
    ).toHaveLength(1);
  });
});
