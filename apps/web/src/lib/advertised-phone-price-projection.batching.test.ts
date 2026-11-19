import { describe, expect, it, vi } from 'vitest';
import {
  type PublicAdvertisedVariantLoader,
  projectAdvertisedPhonePrices,
} from './advertised-phone-price-projection';

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

const variants = [
  {
    id: 'cellular',
    product_id: phone.id,
    attributes: { sim_type: 'Physical + eSIM', storage: '128GB' },
    price_override: 900000,
    condition: 'new',
    stock_quantity: 0,
  },
];

describe('advertised phone-price projection batching', () => {
  it('chunks phone-family reads at the 200 nested inventory RPC limit', async () => {
    const loader = vi
      .fn()
      .mockImplementation(async (_merchantId: string, ids: string[]) => {
        const result: Record<string, typeof variants> = {};
        for (const id of ids) {
          result[id] = variants.map((v) => ({ ...v, product_id: id }));
        }
        return result;
      });
    const phones = Array.from({ length: 250 }, (_, i) => ({
      ...phone,
      id: `phone-${i + 1}`,
      slug: `iphone-16-${i + 1}`,
    }));
    const projected = await projectAdvertisedPhonePrices(
      'merchant',
      phones,
      loader as unknown as PublicAdvertisedVariantLoader
    );
    expect(projected).toHaveLength(250);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenNthCalledWith(
      1,
      'merchant',
      phones.slice(0, 200).map((p) => p.id)
    );
    expect(loader).toHaveBeenNthCalledWith(
      2,
      'merchant',
      phones.slice(200, 250).map((p) => p.id)
    );
  });
});
