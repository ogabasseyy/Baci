import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  mockFrom,
  mockOperations,
  mockRpc,
  resetSandboxQueryMocks,
  setSandboxFixtureRows,
} from './sandbox-product-pages.test-utils';

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn() }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
jest.mock('./product-transform', () => ({
  transformProduct: (row: unknown) => row,
}));

import { fetchProductsPage } from './product-pages';

describe('pinned sandbox product condition aliases', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    resetSandboxQueryMocks();
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
  });

  afterEach(() => {
    for (const name of [
      'EXPO_PUBLIC_HOSTED_STOREFRONT',
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it.each([
    {
      filter: 'used' as const,
      expectedIds: ['used-scalar-alias', 'used-array-alias'],
      products: [
        {
          id: 'used-scalar-alias',
          condition: 'uk_used',
          available_conditions: [],
        },
        {
          id: 'used-array-alias',
          condition: 'new',
          available_conditions: ['uk_used'],
        },
        {
          id: 'new-only',
          condition: 'new',
          available_conditions: ['new'],
        },
      ],
    },
    {
      filter: 'open_box' as const,
      expectedIds: ['open-box-scalar-alias', 'open-box-array-alias'],
      products: [
        {
          id: 'open-box-scalar-alias',
          condition: 'refurbished',
          available_conditions: [],
        },
        {
          id: 'open-box-array-alias',
          condition: 'new',
          available_conditions: ['refurbished'],
        },
        {
          id: 'new-only',
          condition: 'new',
          available_conditions: ['new'],
        },
      ],
    },
  ])('matches any accepted $filter condition alias in the scalar or array column', async ({
    filter,
    expectedIds,
    products,
  }) => {
    const fixtureRows = products.map((product) => ({
      merchant_id: '10000000-0000-4000-8000-000000000001',
      name: 'Phone',
      status: 'active',
      has_variants: false,
      has_condition_offers: false,
      manage_stock: false,
      specifications: { Processor: 'Intel Core i7' },
      ...product,
    }));
    setSandboxFixtureRows(fixtureRows);

    const result = await fetchProductsPage(
      '10000000-0000-4000-8000-000000000001',
      { condition: filter, limit: 10 },
      0
    );

    expect(result.products.map((product) => product.id)).toEqual(expectedIds);
    expect(mockOperations).toContainEqual({
      method: 'or',
      args: [
        `condition.in.(${filter === 'used' ? 'used,uk_used' : 'open_box,refurbished'}),available_conditions.ov.{${filter === 'used' ? 'used,uk_used' : 'open_box,refurbished'}}`,
      ],
    });

    resetSandboxQueryMocks();
    setSandboxFixtureRows(fixtureRows);
    const processorResult = await fetchProductsPage(
      '10000000-0000-4000-8000-000000000001',
      {
        limit: 10,
        refinements: {
          brands: [],
          condition: filter,
          processor: 'Intel Core i7',
          sort: 'relevance',
        },
      },
      0
    );
    expect(
      processorResult.products.map((product) => product.id).sort()
    ).toEqual([...expectedIds].sort());
  });

  it('models PostgREST array containment as all values and overlap as any value', async () => {
    setSandboxFixtureRows([
      { id: 'one-alias', condition: 'new', available_conditions: ['uk_used'] },
      {
        id: 'both-aliases',
        condition: 'new',
        available_conditions: ['used', 'uk_used'],
      },
    ]);

    const contained = await mockFrom('products').or(
      'condition.in.(other),available_conditions.cs.{used,uk_used}'
    );
    const overlapping = await mockFrom('products').or(
      'condition.in.(other),available_conditions.ov.{used,uk_used}'
    );

    expect(contained.data?.map((row) => row.id)).toEqual(['both-aliases']);
    expect(overlapping.data?.map((row) => row.id)).toEqual([
      'one-alias',
      'both-aliases',
    ]);
  });
});
