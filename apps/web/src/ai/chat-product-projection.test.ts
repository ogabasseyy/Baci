import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  resolveAgenticChatTenant: vi.fn(),
}));
vi.mock('@/lib/agentic/agentic-chat-tenant', () => ({
  resolveAgenticChatTenant: mocks.resolveAgenticChatTenant,
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: mocks.createPublicClient,
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: vi.fn(),
}));

import {
  handleGetProductDetails,
  handleGetRecommendations,
  handleSearchProducts,
} from './chat-tool-handlers';

const OGABASSEY_MERCHANT_ID = '3bc72679-c0f7-4db4-9054-6a4a4a95a498';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAgenticChatTenant.mockResolvedValue({
    agenticCheckoutEnabled: true,
    businessName: 'Ogabassey',
    currencyCode: 'NGN',
    merchantId: OGABASSEY_MERCHANT_ID,
    merchantSlug: 'ogabassey',
    priceNegotiationEnabled: true,
  });
});

it.each([
  'search',
  'details',
  'recommendations',
] as const)('%s fails safely on a resolved Supabase error', async (tool) => {
  const failure = { data: null, error: new Error('Database unavailable') };
  const query = Object.assign(Promise.resolve(failure), {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(failure),
    maybeSingle: vi.fn().mockResolvedValue(failure),
  });
  const from = vi.fn(() => query);
  mocks.createPublicClient.mockReturnValue({ from });
  if (tool === 'search') {
    await expect(handleSearchProducts({ query: '' })).rejects.toThrow(
      'Catalog search temporarily unavailable'
    );
  } else {
    const result =
      tool === 'details'
        ? await handleGetProductDetails({ productId: 'phone' })
        : await handleGetRecommendations({
            productId: 'phone',
            type: 'accessories',
          });
    expect(result).toEqual(tool === 'details' ? null : []);
  }
  expect(from).toHaveBeenCalledWith('products');
  expect(query.select).toHaveBeenCalled();
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
  mocks.createPublicClient.mockReturnValue({ from: () => query });

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
