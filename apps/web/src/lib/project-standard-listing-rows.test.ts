import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectStandardListingRows } from './project-standard-listing-rows';

const loader = vi.hoisted(() => vi.fn());
vi.mock('./cached-data', () => ({
  getPublicProductVariantsByProductIds: loader,
}));
const parent = {
  id: 'phone',
  name: 'iPhone 16',
  category: 'Smartphones',
  price: 600000,
  condition: 'used',
  manage_stock: false,
  has_variants: true,
};
beforeEach(() => {
  loader.mockReset();
  loader.mockResolvedValue({
    phone: [
      {
        id: 'restricted',
        product_id: 'phone',
        attributes: { sim_type: 'Wi-Fi Only' },
        condition: 'used',
        price_override: 600000,
      },
      {
        id: 'cellular',
        product_id: 'phone',
        attributes: { sim_type: 'Physical + eSIM' },
        condition: 'new',
        price_override: 900000,
      },
    ],
  });
});

describe('standard listing public-price boundary', () => {
  it.each([
    {
      name: 'iPhone 16',
      category: 'Smartphones',
      price: 600000,
      has_variants: true,
    },
    { ...parent, price: 'not-a-price' },
  ])('rejects malformed selected rows before the public RPC: %j', async (row) => {
    await expect(projectStandardListingRows('merchant', [row])).rejects.toThrow(
      'Invalid public listing product projection'
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it('retains extra selected source fields while applying validated scalar display facts', async () => {
    const row = {
      ...parent,
      product_key_specs: [{ ram_gb: 8 }],
      categoryMetadata: { publicLabel: 'Phones' },
    };
    const [projected] = await projectStandardListingRows('merchant', [row]);
    expect(projected.product_key_specs).toEqual(row.product_key_specs);
    expect(projected.categoryMetadata).toEqual(row.categoryMetadata);
    expect(projected.price).toBe(600000);
    expect(loader).toHaveBeenCalledExactlyOnceWith('merchant', ['phone']);
  });
  it('uses the cached public loader with the scoped merchant and selected IDs while preserving raw parent facts', async () => {
    const snapshot = { ...parent };
    const rows = await projectStandardListingRows('merchant', [parent]);
    expect(loader).toHaveBeenCalledExactlyOnceWith('merchant', ['phone']);
    expect(rows[0]).toMatchObject({
      price: 600000,
      condition: 'used',
      advertised_price: 900000,
      advertised_condition: 'new',
      has_variants: true,
    });
    expect(rows[0]).not.toHaveProperty('variants');
    expect(rows[0]).not.toHaveProperty('product_variants');
    expect(parent).toEqual(snapshot);
  });

  it('forwards request constraints instead of advertising the changed default outside a budget', async () => {
    expect(
      await projectStandardListingRows('merchant', [parent], {
        maxPrice: 700000,
      })
    ).toEqual([]);
  });

  it('propagates a failed public loader rather than manufacturing a fallback parent price', async () => {
    loader.mockRejectedValue(new Error('Public variant read failed'));
    await expect(
      projectStandardListingRows('merchant', [parent])
    ).rejects.toThrow('Public variant read failed');
  });
});
