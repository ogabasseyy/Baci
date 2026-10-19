import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreatePublicClient = vi.fn();
vi.mock('./supabase/public', () => ({
  createPublicClient: (...args: unknown[]) => mockCreatePublicClient(...args),
}));

import { fetchCustomDomain, fetchSlugForDomain } from './domain-cache-database';

function createPublicClientResult(result: unknown) {
  return {
    rpc: vi.fn(() => Promise.resolve(result)),
  };
}

describe('public domain cache resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the public custom-domain RPC and returns its scalar mapping', async () => {
    const client = createPublicClientResult({
      data: 'shop.example.com',
      error: null,
    });
    mockCreatePublicClient.mockReturnValue(client);

    await expect(fetchCustomDomain('shop')).resolves.toEqual({
      outcome: 'resolved',
      value: 'shop.example.com',
    });
    expect(mockCreatePublicClient).toHaveBeenCalledWith({
      clientInfo: 'baci-domain-cache-resolver',
    });
    expect(client.rpc).toHaveBeenCalledWith(
      'resolve_storefront_custom_domain',
      { p_slug: 'shop' }
    );
  });

  it('uses the public domain-slug RPC and preserves an authoritative miss', async () => {
    const client = createPublicClientResult({ data: null, error: null });
    mockCreatePublicClient.mockReturnValue(client);

    await expect(fetchSlugForDomain('missing.example.com')).resolves.toEqual({
      outcome: 'not-found',
    });
    expect(client.rpc).toHaveBeenCalledWith('resolve_storefront_domain_slug', {
      p_domain: 'missing.example.com',
    });
  });

  it.each([
    [{ data: null, error: { code: '42501', message: 'denied' } }],
    [{ data: { slug: 'not-a-scalar' }, error: null }],
    [{ data: '', error: null }],
  ])('does not turn an RPC error or malformed payload into a cacheable miss', async (result) => {
    mockCreatePublicClient.mockReturnValue(createPublicClientResult(result));

    await expect(fetchSlugForDomain('shop.example.com')).resolves.toEqual({
      outcome: 'unavailable',
    });
  });

  it('fails open when public client configuration is absent', async () => {
    mockCreatePublicClient.mockImplementation(() => {
      throw new Error('Public Supabase configuration is missing');
    });

    await expect(fetchCustomDomain('shop')).resolves.toEqual({
      outcome: 'unavailable',
    });
  });
});
