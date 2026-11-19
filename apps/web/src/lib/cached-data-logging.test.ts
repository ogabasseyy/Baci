import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCachedDataTestHarness,
  type CachedDataTestHarness,
  mockMerchant,
  resolvedStorefrontMerchantRpcResult,
} from '@/lib/cached-data.test-utils';

const mockCreateClient = vi.fn();

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'test-service-role-key'),
}));

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/merchant-lookup-backoff', () => ({
  waitForMerchantLookupRetryBackoff: vi.fn(() => Promise.resolve()),
}));
vi.mock('react', () => ({ cache: vi.fn((fn: unknown) => fn) }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';

describe('cached merchant lookup logging', () => {
  let harness: CachedDataTestHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  it('does not call console.log in getCachedMerchant', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    harness.mockRpc.mockResolvedValueOnce(
      resolvedStorefrontMerchantRpcResult({
        ...mockMerchant,
        slug: 'ogabassey',
        business_type: 'fashion',
      })
    );

    const merchant = await getCachedMerchant('ogabassey');

    expect(logSpy).not.toHaveBeenCalled();
    expect(merchant?.business_type).toBe('electronics');
    logSpy.mockRestore();
  });

  it('does not call console.log in getCachedMerchantByDomain', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    harness.mockRpc.mockResolvedValueOnce({
      data: [
        {
          resolution_status: 'found',
          custom_domain: 'ogabassey.com',
          feature_settings: null,
          merchant_data: {
            ...mockMerchant,
            slug: 'ogabassey',
            business_type: 'fashion',
          },
        },
      ],
      error: null,
    });

    const merchant = await getCachedMerchantByDomain('ogabassey.com');

    expect(logSpy).not.toHaveBeenCalled();
    expect(merchant?.business_type).toBe('electronics');
    logSpy.mockRestore();
  });
});
