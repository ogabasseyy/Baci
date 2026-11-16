import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { getMerchantByIdentifier } from '@/lib/cached-data';

describe('getMerchantByIdentifier subdomain resolution', () => {
  let harness: CachedDataTestHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    harness = buildCachedDataTestHarness();
    mockCreateClient.mockReturnValue({
      from: harness.mockFrom,
      rpc: harness.mockRpc,
      auth: { getUser: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves platform subdomain hosts by stripping the root domain', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedStorefrontMerchantRpcResult({ ...mockMerchant, slug: 'shop' })
    );

    const merchant = await getMerchantByIdentifier('shop.usebaci.com');

    expect(harness.mockRpc).toHaveBeenCalledWith(
      'resolve_storefront_public_snapshot_v2',
      { p_identifier: 'shop' },
      { get: true }
    );
    expect(merchant?.slug).toBe('shop');
  });

  it('resolves local subdomain hosts by stripping .localhost', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedStorefrontMerchantRpcResult({ ...mockMerchant, slug: 'shop' })
    );

    const merchant = await getMerchantByIdentifier('shop.localhost');

    expect(harness.mockRpc).toHaveBeenCalledWith(
      'resolve_storefront_public_snapshot_v2',
      { p_identifier: 'shop' },
      { get: true }
    );
    expect(merchant?.slug).toBe('shop');
  });

  it('keeps custom domains intact for domain-based lookup', async () => {
    harness.mockRpc.mockResolvedValueOnce(
      resolvedStorefrontMerchantRpcResult({
        ...mockMerchant,
        custom_domain: 'shop.example',
      })
    );

    await getMerchantByIdentifier('shop.example');

    expect(harness.mockRpc).toHaveBeenCalledWith(
      'resolve_storefront_public_snapshot_v2',
      { p_identifier: 'shop.example' },
      { get: true }
    );
  });
});
