import { describe, expect, it, vi } from 'vitest';
import { requestPiggyvestStagingJson } from './staging-json-request';

const configuration = {
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'synthetic-business',
  timeoutMs: 20,
};
const options = {
  configuration,
  path: '/api/v1/wallet/synthetic-wallet',
  method: 'GET' as const,
};

describe('requestPiggyvestStagingJson', () => {
  it.each([
    '/api/v1/wallet/synthetic-wallet',
    '/api/v1/wallet/synthetic-wallet/accounts',
    `/api/v1/wallet/${encodeURIComponent('opaque/東京 ?#id')}/accounts`,
  ])('reads only the staging path %s with redirects and caching disabled', async (path) => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ status: true })
    );
    await expect(
      requestPiggyvestStagingJson({ ...options, path, fetchImplementation })
    ).resolves.toEqual({ status: true });
    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(
      `https://staging.piggyvest.business${path}`,
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
      })
    );
  });

  it.each([
    '/api/v1/customers',
    '/api/v1/wallet/sub-account',
  ])('posts JSON exactly once to %s', async (path) => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ status: true })
    );
    await requestPiggyvestStagingJson({
      ...options,
      path,
      method: 'POST',
      body: '{"name":"synthetic"}',
      fetchImplementation,
    });
    expect(fetchImplementation).toHaveBeenCalledExactlyOnceWith(
      `https://staging.piggyvest.business${path}`,
      expect.objectContaining({
        method: 'POST',
        body: '{"name":"synthetic"}',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer synthetic-secret',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  it.each([
    'https://attacker.test/api/v1/customers',
    '//attacker.test/api/v1/customers',
    '/api/v1/wallet',
    '/api/v1/customers',
    '/api/v1/wallet/id/transfers',
    '/api/v1/wallet/id/accounts/extra',
    '/api/v1/wallet/id?secret=value',
    '/api/v1/wallet/id#fragment',
    '/api/v1/wallet/../customers',
    '/api/v1/wallet/%2E%2E',
    '/api/v1/wallet/%252e%252e',
    '/api/v1/wallet/a%2F..%2Fb',
    '/api/v1/wallet/a%5C..%5Cb',
    '/api/v1/wallet/%0A',
    '/api/v1/wallet/%',
    '/api/v1/wallet/%ED%A0%80',
    '/api/v1/wallet/id/',
    '/api/v1/wallet/id/accounts\n',
    `/api/v1/wallet/${'a'.repeat(513)}`,
  ])('rejects an unsupported GET path %s before network', async (path) => {
    const fetchImplementation = vi.fn();
    await expect(
      requestPiggyvestStagingJson({ ...options, path, fetchImplementation })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    '/api/v1/customers/',
    '/api/v1/wallet/id',
    '/api/v1/wallet/id/accounts',
    '/api/v1/wallet/sub-account?x=1',
  ])('rejects an unsupported POST path %s', async (path) => {
    const fetchImplementation = vi.fn();
    await expect(
      requestPiggyvestStagingJson({
        ...options,
        path,
        method: 'POST',
        fetchImplementation,
      })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    {
      apiSecret: 'synthetic',
      expectedBusinessId: 'business',
      apiBaseUrl: 'https://api.piggyvest.business',
    },
    { ...configuration, timeoutMs: 10_001 },
    { ...configuration, maxResponseBytes: 65_537 },
    { ...configuration, apiSecret: '' },
    { ...configuration, unexpected: true },
    null,
  ])('rejects invalid configuration without exposing values', async (invalidConfiguration) => {
    const fetchImplementation = vi.fn();
    await expect(
      requestPiggyvestStagingJson({
        ...options,
        configuration: invalidConfiguration,
        fetchImplementation,
      })
    ).rejects.toMatchObject({
      message: 'PiggyVest staging request failed: INVALID_CONFIGURATION.',
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects a missing injected fetch without falling back to global fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(
        requestPiggyvestStagingJson({
          ...options,
          fetchImplementation: undefined as unknown as typeof fetch,
        })
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalFetch.mockRestore();
    }
  });

  it.each(['', '{}'])('rejects any GET body, including %j', async (body) => {
    const fetchImplementation = vi.fn();
    await expect(
      requestPiggyvestStagingJson({ ...options, body, fetchImplementation })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    'x',
    `"${'x'.repeat(65_535)}"`,
    `"${'é'.repeat(32_768)}"`,
    123,
  ])('rejects malformed or oversized runtime JSON bodies', async (body) => {
    const fetchImplementation = vi.fn();
    await expect(
      requestPiggyvestStagingJson({
        ...options,
        path: '/api/v1/customers',
        method: 'POST',
        body: body as string,
        fetchImplementation,
      })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('accepts exactly 64KiB of UTF8 request JSON', async () => {
    const body = `"${'é'.repeat(32_767)}"`;
    const fetchImplementation = vi.fn(async () => Response.json(null));
    await expect(
      requestPiggyvestStagingJson({
        ...options,
        path: '/api/v1/customers',
        method: 'POST',
        body,
        fetchImplementation,
      })
    ).resolves.toBeNull();
  });
});
