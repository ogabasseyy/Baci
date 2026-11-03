import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  return { query, from: vi.fn(), rpc: vi.fn(), ranked: vi.fn() };
});
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: mocks.ranked,
}));

import { loadFastCatalogProducts } from './fast-catalog-data';

const row = {
  id: 'p1',
  merchant_id: 'merchant-1',
  category_id: 'phones',
  name: 'Phone',
  slug: 'phone',
  price: 200_000,
  description: null,
  brand: 'Example',
  category: 'Smartphones',
  images: [],
  stock: 1,
  stock_quantity: 1,
  manage_stock: true,
  has_variants: false,
  has_condition_offers: false,
  variant_model: 'legacy',
  available_conditions: ['new'],
  condition: 'new',
  status: 'active',
};
const intent = {
  kind: 'search' as const,
  categoryId: 'phones',
  query: '',
  preference: 'gaming',
  wifiOnly: false,
  isPhoneCategory: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ['select', 'eq', 'in', 'order'] as const)
    mocks.query[name].mockReturnValue(mocks.query);
  mocks.from.mockReturnValue(mocks.query);
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});

it.each([
  'Gamers',
  'gamer',
  'premium gaming',
])('accepts the gaming catalog tag %s', async (tag) => {
  mocks.query.limit.mockResolvedValue({
    data: [{ ...row, product_key_specs: { recommended_for: [tag] } }],
    error: null,
  });
  expect(
    (await loadFastCatalogProducts('merchant-1', intent)).map((p) => p.id)
  ).toEqual(['p1']);
});

it.each([
  'ungamers',
  'not for gamers',
  'no gaming',
  'non-gaming',
  'photographers',
])('does not recommend from unrelated or negated tags: %s', async (tag) => {
  mocks.query.limit.mockResolvedValue({
    data: [{ ...row, product_key_specs: { recommended_for: [tag] } }],
    error: null,
  });
  expect(await loadFastCatalogProducts('merchant-1', intent)).toEqual([]);
});

it('recognizes photographers as camera evidence without assuming heavy users means battery', async () => {
  mocks.query.limit.mockResolvedValue({
    data: [
      {
        ...row,
        product_key_specs: {
          recommended_for: ['photographers', 'heavy_users'],
        },
      },
    ],
    error: null,
  });
  expect(
    await loadFastCatalogProducts('merchant-1', {
      ...intent,
      preference: 'camera',
    })
  ).toHaveLength(1);
  expect(
    await loadFastCatalogProducts('merchant-1', {
      ...intent,
      preference: 'battery',
    })
  ).toEqual([]);
});

it.each([
  'photos',
  'portrait photos',
  'dual rear cameras',
])('recognizes a camera recommendation tag: %s', async (tag) => {
  mocks.query.limit.mockResolvedValue({
    data: [{ ...row, product_key_specs: { recommended_for: [tag] } }],
    error: null,
  });
  expect(
    await loadFastCatalogProducts('merchant-1', {
      ...intent,
      preference: 'camera',
    })
  ).toHaveLength(1);
});

it('does not recommend a camera from a negated photo tag', async () => {
  mocks.query.limit.mockResolvedValue({
    data: [
      { ...row, product_key_specs: { recommended_for: ['not for photos'] } },
    ],
    error: null,
  });
  expect(
    await loadFastCatalogProducts('merchant-1', {
      ...intent,
      preference: 'camera',
    })
  ).toEqual([]);
});
