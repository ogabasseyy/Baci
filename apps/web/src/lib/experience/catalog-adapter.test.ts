// @vitest-environment node
import { expect, it } from 'vitest';
import { projectExperienceCatalog } from './catalog-adapter';
import { readConsistentCatalog } from './catalog-revision';

const merchant = { id: 'merchant-a', currency: 'NGN', is_published: true };
const row = {
  id: 'p1',
  merchant_id: 'merchant-a',
  slug: 'phone',
  name: 'Synthetic phone',
  price: 12500,
  status: 'active',
  manage_stock: false,
  stock: 0,
  stock_quantity: 0,
  images: [],
  category: 'Phones',
  cost_price: 1,
  product_variants: [],
};
it('projects explicit public fields, unlimited stock and missing media without private values', () => {
  const value = projectExperienceCatalog(merchant, [
    row,
    { ...row, id: 'p2', status: 'draft' },
    { ...row, id: 'p3', merchant_id: 'merchant-b' },
  ]);
  expect(value.products).toHaveLength(1);
  expect(value.products[0]).toMatchObject({
    available: true,
    image: null,
    currency: 'NGN',
    canonicalPath: '/phones/phone',
  });
  expect(JSON.stringify(value)).not.toMatch(
    /cost_price|merchant_id|stock_quantity/
  );
  expect(
    projectExperienceCatalog({ ...merchant, is_published: false }, [row])
      .products
  ).toEqual([]);
});
it('never presents a mixed catalog generation as fresh', async () => {
  let generation = 1;
  let reads = 0;
  const result = await readConsistentCatalog({
    generation: async () => String(generation),
    read: async () => {
      reads++;
      generation++;
      return { products: [] };
    },
  });
  expect(result).toBeNull();
  expect(reads).toBe(2);
});
it('uses the existing serialized/unlimited variant policy before parent management', () => {
  const value = projectExperienceCatalog(merchant, [
    {
      ...row,
      product_variants: [
        {
          id: 'strict',
          attributes: { Size: '128GB' },
          effective_policy: 'serialized_strict',
          available_units: 0,
          stock_quantity: 0,
        },
        {
          id: 'unlimited',
          effective_policy: 'serialized_then_unlimited',
          available_units: 0,
          stock_quantity: 0,
        },
      ],
    },
  ]);
  expect(value.products[0].variants.map((v) => v.available)).toEqual([
    false,
    true,
  ]);
});
it('preserves relation-derived canonical paths and does not sell an empty variant selection as a simple product', () => {
  const product = projectExperienceCatalog(merchant, [
    {
      ...row,
      category: null,
      product_categories: [{ categories: { name: 'Audio', slug: 'audio' } }],
      has_variants: true,
    },
  ]).products[0];
  expect(product).toMatchObject({
    canonicalPath: '/audio/phone',
    requiresVariant: true,
    available: false,
  });
});
