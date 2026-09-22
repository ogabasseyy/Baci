import { describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'test-service-role-key'),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('react', () => ({ cache: vi.fn((fn) => fn) }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  })),
}));

const { mockGetShell } = vi.hoisted(() => ({ mockGetShell: vi.fn() }));

vi.mock('@/lib/get-category-page-shell-data', () => ({
  getCategoryPageShellData: (...args: unknown[]) => mockGetShell(...args),
}));

import { getCachedCategoryPageGraphicsOptionsStrict } from '@/lib/cached-data';

describe('getCachedCategoryPageGraphicsOptionsStrict', () => {
  it('propagates a shell outage instead of returning an empty facet', async () => {
    mockGetShell.mockResolvedValue({
      categoryQueryFailed: true,
      productScope: { kind: 'none' },
    });

    // Routing treats [] as "no inventory" (hub 404s), so the outage must
    // reach the error boundary as a rejection.
    await expect(
      getCachedCategoryPageGraphicsOptionsStrict('merchant-1', 'gaming-laptops')
    ).rejects.toThrow('Category graphics facet shell query failed');
  });
});
