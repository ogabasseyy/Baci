// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  loadExperienceCatalog,
  projectExperienceCatalog,
} from './catalog-adapter';
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

it('marks a managed variant parent purchasable when an unlimited serialized variant is available', () => {
  const value = projectExperienceCatalog(merchant, [
    {
      ...row,
      manage_stock: true,
      has_variants: true,
      product_variants: [
        {
          id: 'unlimited',
          attributes: { Size: '128GB' },
          stock_quantity: 0,
          effective_policy: 'serialized_then_unlimited',
          available_units: 0,
        },
      ],
    },
  ]);
  expect(value.products[0]).toMatchObject({
    available: true,
    variants: [{ id: 'unlimited', available: true }],
  });
});

it('retains mapped product image IDs and alt text through the normal RLS loader', async () => {
  const client = {
    from: (table: string) =>
      Object.assign(
        Promise.resolve({
          data: table === 'products' ? [row] : [],
          error: null,
        }),
        {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          returns: vi.fn().mockReturnThis(),
          maybeSingle: async () => ({ data: { generation: 1 }, error: null }),
        }
      ),
    rpc: async () => ({ data: [], error: null }),
  };
  const images = new Map([
    [
      'p1',
      { assetId: 'synthetic-product-image', alt: 'Synthetic phone front' },
    ],
  ]);
  expect(
    (await loadExperienceCatalog(client as never, merchant, {}, images))
      ?.products[0].image
  ).toEqual(images.get('p1'));
});
