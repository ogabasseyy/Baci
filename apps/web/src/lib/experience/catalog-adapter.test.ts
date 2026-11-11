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
    canonicalPath: '/smartphones/phone',
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

it('keeps active products with nullable database images in the public catalog', () => {
  const catalog = projectExperienceCatalog(merchant, [
    { ...row, images: null },
    row,
  ]);
  expect(catalog.products).toHaveLength(2);
  expect(catalog.products[0].image).toBeNull();
});

it.each([
  { stock: 2, policy: 'off' },
  { stock: 0, policy: 'serialized_then_unlimited' },
])('keeps public RPC variants when anonymous RLS hides private metadata: $policy', async ({
  stock,
  policy,
}) => {
  const variant = {
    id: 'public-variant',
    product_id: 'p1',
    attributes: { Color: 'Black' },
    stock_quantity: stock,
    effective_policy: policy,
    available_units: stock,
    price_override: 13000,
  };
  const client = {
    from: (table: string) =>
      Object.assign(
        Promise.resolve({
          data:
            table === 'products'
              ? [{ ...row, has_variants: true, manage_stock: true }]
              : [],
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
    rpc: async (name: string) => ({
      data: name === 'get_storefront_product_variants' ? [variant] : [],
      error: null,
    }),
  };
  const result = await loadExperienceCatalog(client as never, merchant, {});
  expect(result?.products[0]).toMatchObject({
    available: true,
    requiresVariant: true,
    variants: [{ id: 'public-variant', available: true, price: 13000 }],
  });
});

it('derives canonical paths from live identity despite stale stored canonical URLs', () => {
  for (const identity of [
    { category: 'new', categories: { slug: 'new' } },
    { category: null, product_categories: [{ categories: { slug: 'new' } }] },
  ]) {
    const catalog = projectExperienceCatalog(merchant, [
      { ...row, slug: 'device', canonical_url: '/old/device', ...identity },
    ]);
    expect(catalog.products[0].canonicalPath).toBe('/new/device');
  }
});
