import { describe, expect, it, vi } from 'vitest';
import {
  type PublicAdvertisedVariantLoader,
  projectAdvertisedPhonePrices,
} from './advertised-phone-price-projection';
import { normalizeProduct } from './normalize-product';

const phone = {
  id: 'iphone16',
  name: 'iPhone 16',
  price: 600000,
  category: 'Smartphones',
  slug: 'iphone-16',
  condition: 'used',
  has_variants: true,
  variant_model: 'sku_matrix' as const,
  manage_stock: false,
  stock: 0,
};

const makeVariant = (
  id: string,
  price: number,
  condition: string,
  sim = 'Physical + eSIM',
  storage = '128GB'
) => ({
  id,
  product_id: phone.id,
  attributes: { sim_type: sim, storage },
  price_override: price,
  condition,
  stock_quantity: 0,
});

describe('advertised phone price condition and availability projection', () => {
  it('selects an eligible non-default cellular variant that satisfies the condition filter', async () => {
    const mixedConditionVariants = [
      makeVariant('restricted', 600000, 'used', 'Wi-Fi Only'),
      makeVariant('cellular-used', 900000, 'used'),
      makeVariant('cellular-new', 1100000, 'new'),
    ];
    const loader = vi
      .fn()
      .mockResolvedValue({ [phone.id]: mixedConditionVariants });
    const [projected] = await projectAdvertisedPhonePrices(
      'merchant',
      [phone],
      loader as unknown as PublicAdvertisedVariantLoader,
      { condition: 'new' }
    );
    expect(projected).toMatchObject({
      advertised_price: 1100000,
      advertised_condition: 'new',
    });
  });

  it('projects variant availability for managed phone with zero parent stock', async () => {
    const managedPhone = {
      ...phone,
      manage_stock: true,
      stock: 0,
    };
    const inStockVariants = [
      {
        ...makeVariant('cellular', 900000, 'new'),
        stock_quantity: 5,
      },
    ];
    const loader = vi.fn().mockResolvedValue({ [phone.id]: inStockVariants });
    const [projected] = await projectAdvertisedPhonePrices(
      'merchant',
      [managedPhone],
      loader as unknown as PublicAdvertisedVariantLoader
    );
    expect(projected).toMatchObject({
      stock: 0,
      manage_stock: true,
      advertised_price: 900000,
      availability: 'InStock',
    });
    const normalized = normalizeProduct(projected as never);
    expect(normalized.availability).toBe('InStock');
    expect(normalized.stock).toBeGreaterThanOrEqual(1);
  });
});
