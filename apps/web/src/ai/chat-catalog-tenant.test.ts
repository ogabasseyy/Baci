import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  resolve: vi.fn(),
  headers: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: mocks.client,
}));
vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: mocks.resolve,
}));
vi.mock('@/lib/storefront-search', () => ({
  searchStorefrontProducts: vi.fn(),
}));

import { handleSearchProducts } from './chat-tool-handlers';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers({ host: 'ogabassey.com' }));
  mocks.resolve.mockResolvedValue({
    success: true,
    merchant: { id: '6b5cb8a4-5575-456c-b936-8cdfae30db74', slug: 'ogabassey' },
  });
});

it('scopes product reads to the resolved merchant rather than a stale merchant ID', async () => {
  // Arrange
  const query = Object.assign(Promise.resolve({ data: [], error: null }), {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  });
  mocks.client.mockReturnValue({ from: () => query });
  // Act
  await handleSearchProducts({ query: '' });
  // Assert
  expect(query.eq).toHaveBeenCalledWith(
    'merchant_id',
    '6b5cb8a4-5575-456c-b936-8cdfae30db74'
  );
});

it.each([
  { success: false, status: 404 },
  { success: true, merchant: { id: 'other-store', slug: 'other' } },
])('fails closed without catalog reads for an unresolved or different storefront', async (context) => {
  // Arrange
  mocks.resolve.mockResolvedValue(context);
  // Act / Assert
  await expect(handleSearchProducts({ query: '' })).rejects.toThrow();
  expect(mocks.client).not.toHaveBeenCalled();
});

it('does not turn a database failure into a successful empty search', async () => {
  // Arrange
  const query = Object.assign(
    Promise.resolve({ data: null, error: { message: 'database unavailable' } }),
    {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    }
  );
  mocks.client.mockReturnValue({ from: () => query });
  // Act / Assert
  await expect(handleSearchProducts({ query: '' })).rejects.toThrow(
    'Catalog search temporarily unavailable'
  );
});
