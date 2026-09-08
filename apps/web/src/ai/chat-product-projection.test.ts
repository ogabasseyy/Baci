import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: mocks.createClient,
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: vi.fn(),
}));

import {
  handleGetProductDetails,
  handleGetRecommendations,
  handleSearchProducts,
} from './chat-tool-handlers';

beforeEach(() => vi.clearAllMocks());

it.each([
  'search',
  'details',
  'recommendations',
] as const)('%s fails safely on a resolved Supabase error', async (tool) => {
  const failure = { data: null, error: new Error('Database unavailable') };
  const query = Object.assign(Promise.resolve(failure), {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(failure),
    maybeSingle: vi.fn().mockResolvedValue(failure),
  });
  const from = vi.fn(() => query);
  mocks.createClient.mockReturnValue({ from });
  const result =
    tool === 'search'
      ? await handleSearchProducts({ query: '' })
      : tool === 'details'
        ? await handleGetProductDetails({ productId: 'phone' })
        : await handleGetRecommendations({
            productId: 'phone',
            type: 'accessories',
          });
  expect(from).toHaveBeenCalledWith('products');
  expect(query.select).toHaveBeenCalled();
  expect(result).toEqual(
    tool === 'search'
      ? { products: [], total: 0 }
      : tool === 'details'
        ? null
        : []
  );
});

it.each([
  'search',
  'details',
  'recommendations',
] as const)('%s requests canonical inventory and selection fields from the database', async (tool) => {
  const row = {
    id: 'phone',
    name: 'Phone',
    price: 100,
    brand: null,
    category: 'Phones',
    description: null,
    images: [],
    status: 'active',
    stock: 0,
    stock_quantity: 4,
    has_variants: false,
    manage_stock: true,
    has_condition_offers: true,
    variant_model: 'sku_matrix',
    available_conditions: ['New', 'Used'],
    slug: 'phone',
  };
  const query = Object.assign(Promise.resolve({ data: [row], error: null }), {
    select: vi.fn<(columns: string) => unknown>().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  });
  mocks.createClient.mockReturnValue({ from: () => query });

  if (tool === 'search') await handleSearchProducts({ query: '' });
  else if (tool === 'details')
    await handleGetProductDetails({ productId: 'phone' });
  else
    await handleGetRecommendations({ productId: 'phone', type: 'accessories' });

  const projection = query.select.mock.calls.at(-1)?.[0] ?? '';
  expect(projection.split(',').map((column) => column.trim())).toEqual(
    expect.arrayContaining([
      'stock_quantity',
      'condition',
      'has_condition_offers',
      'variant_model',
      'available_conditions',
    ])
  );
  expect(projection.split(',').map((column) => column.trim())).not.toContain(
    'minimum_order_quantity'
  );
});
