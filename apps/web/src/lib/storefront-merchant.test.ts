import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStorefrontMerchantFromRequest } from './storefront-merchant';

const mockGetMerchantByIdentifier = vi.hoisted(() => vi.fn());
const mockGetCurrentSlugForAlias = vi.hoisted(() => vi.fn());

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: (...args: unknown[]) =>
    mockGetCurrentSlugForAlias(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentSlugForAlias.mockResolvedValue(null);
});

describe('resolveStorefrontMerchantFromRequest', () => {
  it('resolves a storefront host to the first matching merchant candidate', async () => {
    mockGetMerchantByIdentifier.mockImplementation((identifier) => {
      if (identifier === 'ogabassey.com') {
        return Promise.resolve({
          id: 'merchant-1',
          slug: 'ogabassey',
          business_name: 'Ogabassey',
        });
      }

      return Promise.resolve(null);
    });
    const result = await resolveStorefrontMerchantFromRequest({
      request: new Request(
        'https://www.ogabassey.com/feeds/google-merchant.xml'
      ),
      rootDomain: 'usebaci.com',
      notFoundError: 'Storefront not found',
      lookupError: 'Lookup failed',
    });

    expect(result).toMatchObject({
      success: true,
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
      },
      identifier: 'ogabassey.com',
    });
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalledWith(
      'www.ogabassey.com'
    );
  });

  it('falls back to the exact www custom-domain candidate when non-www misses', async () => {
    mockGetMerchantByIdentifier.mockImplementation((identifier) => {
      if (identifier === 'www.ogabassey.com') {
        return Promise.resolve({
          id: 'merchant-1',
          slug: 'ogabassey',
          business_name: 'Ogabassey',
        });
      }

      return Promise.resolve(null);
    });
    const result = await resolveStorefrontMerchantFromRequest({
      request: new Request(
        'https://www.ogabassey.com/feeds/google-merchant.xml'
      ),
      rootDomain: 'usebaci.com',
      notFoundError: 'Storefront not found',
      lookupError: 'Lookup failed',
    });

    expect(result).toMatchObject({
      success: true,
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
      },
      identifier: 'www.ogabassey.com',
    });
    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(
      1,
      'ogabassey.com'
    );
    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(
      2,
      'www.ogabassey.com'
    );
  });

  it('continues to fallback candidates when a merchant lookup throws', async () => {
    const failure = new Error('normalized domain unavailable');
    mockGetMerchantByIdentifier.mockImplementation((identifier) => {
      if (identifier === 'ogabassey.com') {
        return Promise.reject(failure);
      }

      if (identifier === 'www.ogabassey.com') {
        return Promise.resolve({
          id: 'merchant-1',
          slug: 'ogabassey',
          business_name: 'Ogabassey',
        });
      }

      return Promise.resolve(null);
    });
    const result = await resolveStorefrontMerchantFromRequest({
      request: new Request(
        'https://www.ogabassey.com/feeds/google-merchant.xml'
      ),
      rootDomain: 'usebaci.com',
      notFoundError: 'Storefront not found',
      lookupError: 'Lookup failed',
    });

    expect(result).toMatchObject({
      success: true,
      merchant: {
        id: 'merchant-1',
        slug: 'ogabassey',
      },
      identifier: 'www.ogabassey.com',
    });
    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(
      1,
      'ogabassey.com'
    );
    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(
      2,
      'www.ogabassey.com'
    );
  });

  it('returns 404 when the request is not storefront-scoped', async () => {
    const result = await resolveStorefrontMerchantFromRequest({
      request: new Request('https://usebaci.com/feeds/google-merchant.xml'),
      rootDomain: 'usebaci.com',
      notFoundError: 'Storefront not found',
      lookupError: 'Lookup failed',
    });

    expect(result).toEqual({
      success: false,
      status: 404,
      error: 'Storefront not found',
    });
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
  });

  it('uses an explicit fallback identifier on the platform root host', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue({
      business_name: 'Ogabassey',
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    const result = await resolveStorefrontMerchantFromRequest({
      fallbackIdentifier: 'ogabassey',
      lookupError: 'Lookup failed',
      notFoundError: 'Storefront not found',
      request: new Request('https://usebaci.com/api/storefront/example'),
      rootDomain: 'usebaci.com',
    });

    expect(result).toMatchObject({
      identifier: 'ogabassey',
      merchant: { id: 'merchant-1', slug: 'ogabassey' },
      success: true,
    });
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey');
  });

  it.each([
    [
      'custom-domain',
      'https://ogabassey.com/api/storefront/example',
      'ogabassey.com',
    ],
    [
      'subdomain',
      'https://ogabassey.usebaci.com/api/storefront/example',
      'ogabassey',
    ],
  ])('keeps a %s host authoritative over a fallback identifier', async (_kind, url, expectedIdentifier) => {
    mockGetMerchantByIdentifier.mockImplementation((identifier) =>
      Promise.resolve(
        identifier === expectedIdentifier
          ? {
              business_name: 'Ogabassey',
              id: 'merchant-1',
              slug: 'ogabassey',
            }
          : null
      )
    );
    const result = await resolveStorefrontMerchantFromRequest({
      fallbackIdentifier: 'another-store',
      lookupError: 'Lookup failed',
      notFoundError: 'Storefront not found',
      request: new Request(url),
      rootDomain: 'usebaci.com',
    });

    expect(result).toMatchObject({
      identifier: expectedIdentifier,
      merchant: { id: 'merchant-1', slug: 'ogabassey' },
      success: true,
    });
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalledWith(
      'another-store'
    );
  });

  it('returns 404 when no merchant matches a storefront host', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue(null);
    const result = await resolveStorefrontMerchantFromRequest({
      request: new Request('https://ogabassey.com/feeds/google-merchant.xml'),
      rootDomain: 'usebaci.com',
      notFoundError: 'Storefront not found',
      lookupError: 'Lookup failed',
    });

    expect(result).toEqual({
      success: false,
      status: 404,
      error: 'Storefront not found',
    });
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
  });

  it('returns 400 when a storefront identifier fails route validation', async () => {
    const result = await resolveStorefrontMerchantFromRequest({
      request: new Request('https://usebaci.com/feeds/google-merchant.xml', {
        headers: { host: '<script>' },
      }),
      rootDomain: 'usebaci.com',
      notFoundError: 'Storefront not found',
      lookupError: 'Lookup failed',
    });

    expect(result).toEqual({
      success: false,
      status: 400,
      error: 'Invalid storefront host',
    });
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
  });

  it('returns 500 when merchant lookup throws', async () => {
    const failure = new Error('database unavailable');
    mockGetMerchantByIdentifier.mockRejectedValue(failure);
    const result = await resolveStorefrontMerchantFromRequest({
      request: new Request('https://ogabassey.com/feeds/google-merchant.xml'),
      rootDomain: 'usebaci.com',
      notFoundError: 'Storefront not found',
      lookupError: 'Lookup failed',
    });

    expect(result).toEqual({
      success: false,
      status: 500,
      error: 'Lookup failed',
      cause: failure,
    });
  });

  it('returns the last lookup error when all fallback lookups fail', async () => {
    const firstFailure = new Error('normalized domain unavailable');
    const lastFailure = new Error('exact domain unavailable');
    mockGetMerchantByIdentifier.mockImplementation((identifier) => {
      if (identifier === 'ogabassey.com') {
        return Promise.reject(firstFailure);
      }

      if (identifier === 'www.ogabassey.com') {
        return Promise.reject(lastFailure);
      }

      return Promise.resolve(null);
    });
    const result = await resolveStorefrontMerchantFromRequest({
      request: new Request(
        'https://www.ogabassey.com/feeds/google-merchant.xml'
      ),
      rootDomain: 'usebaci.com',
      notFoundError: 'Storefront not found',
      lookupError: 'Lookup failed',
    });

    expect(result).toEqual({
      success: false,
      status: 500,
      error: 'Lookup failed',
      cause: lastFailure,
    });
  });
});
