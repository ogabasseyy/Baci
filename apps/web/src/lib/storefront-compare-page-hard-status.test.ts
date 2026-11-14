import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorefrontComparePageHardStatusResolver } from './storefront-compare-page-hard-status';

const { mockGetInternalApiSecret, mockResolveStorefrontComparePageStatus } =
  vi.hoisted(() => ({
    mockGetInternalApiSecret: vi.fn(() => 'test-internal-secret'),
    mockResolveStorefrontComparePageStatus: vi.fn(),
  }));

vi.mock('@/lib/internal-api-secret', () => ({
  getInternalApiSecret: () => mockGetInternalApiSecret(),
}));

vi.mock('@/lib/storefront-compare-page-status', () => ({
  storefrontComparePageStatus: {
    resolve: (...args: unknown[]) =>
      mockResolveStorefrontComparePageStatus(...args),
  },
}));

const mockIsEligibleForHardStatusPreflight = vi.fn();
const mockGetRouteType = vi.fn();
const mockGetStorefrontContentSegments = vi.fn();
const mockBuildHardStatusStorefrontResponse = vi.fn(
  () =>
    new NextResponse(null, {
      status: 404,
      headers: { 'X-Robots-Tag': 'noindex, follow' },
    })
);

const resolveComparePageHardStatus =
  createStorefrontComparePageHardStatusResolver({
    isEligibleForHardStatusPreflight: mockIsEligibleForHardStatusPreflight,
    getRouteType: mockGetRouteType,
    getStorefrontContentSegments: mockGetStorefrontContentSegments,
    nonCacheableStorefrontFirstSegments: new Set(['blog', 'checkout']),
    buildHardStatusStorefrontResponse: mockBuildHardStatusStorefrontResponse,
  });

function buildRequest(
  path = '/laptops/compare/left-vs-right',
  method: 'GET' | 'HEAD' = 'GET'
) {
  return new NextRequest(`https://usebaci.com${path}`, { method });
}

describe('createStorefrontComparePageHardStatusResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEligibleForHardStatusPreflight.mockReturnValue(true);
    mockGetRouteType.mockReturnValue('storefront');
    mockGetStorefrontContentSegments.mockReturnValue([
      'laptops',
      'compare',
      'left-vs-right',
    ]);
    mockResolveStorefrontComparePageStatus.mockResolvedValue({
      kind: 'missing',
    });
  });

  it('builds a hard response only for a confirmed missing canonical pair', async () => {
    const request = buildRequest();

    const response = await resolveComparePageHardStatus(
      request,
      request.nextUrl.pathname,
      'usebaci.com',
      'test-agent',
      'ogabassey'
    );

    expect(response?.status).toBe(404);
    expect(response?.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    expect(mockResolveStorefrontComparePageStatus).toHaveBeenCalledWith({
      origin: 'https://usebaci.com',
      identifier: 'ogabassey',
      categorySlug: 'laptops',
      comparisonSlug: 'left-vs-right',
      secret: 'test-internal-secret',
    });
    expect(mockBuildHardStatusStorefrontResponse).toHaveBeenCalledWith(
      404,
      request,
      '/laptops/compare/left-vs-right',
      'test-agent',
      'usebaci.com',
      '/'
    );
  });

  it.each([
    'GET',
    'HEAD',
  ] as const)('returns hard 404 with X-Robots-Tag: noindex, follow on %s for parameterized dead compare pages', async (method) => {
    const queryRequest = buildRequest(
      '/laptops/compare/left-vs-right?utm_source=email&sort=price',
      method
    );
    const response = await resolveComparePageHardStatus(
      queryRequest,
      queryRequest.nextUrl.pathname,
      'usebaci.com',
      'test-agent',
      'ogabassey'
    );

    expect(response?.status).toBe(404);
    expect(response?.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    expect(mockResolveStorefrontComparePageStatus).toHaveBeenCalledWith({
      origin: 'https://usebaci.com',
      identifier: 'ogabassey',
      categorySlug: 'laptops',
      comparisonSlug: 'left-vs-right',
      secret: 'test-internal-secret',
    });
    expect(mockBuildHardStatusStorefrontResponse).toHaveBeenCalledWith(
      404,
      queryRequest,
      '/laptops/compare/left-vs-right',
      'test-agent',
      'usebaci.com',
      '/'
    );
  });

  it('falls through uncertain status results', async () => {
    mockResolveStorefrontComparePageStatus.mockResolvedValueOnce({
      kind: 'renderable-or-unknown',
    });
    const canonicalRequest = buildRequest();
    await expect(
      resolveComparePageHardStatus(
        canonicalRequest,
        canonicalRequest.nextUrl.pathname,
        'usebaci.com',
        'test-agent',
        'ogabassey'
      )
    ).resolves.toBeNull();
    expect(mockBuildHardStatusStorefrontResponse).not.toHaveBeenCalled();
  });

  it('skips non-compare and non-cacheable category paths', async () => {
    mockGetStorefrontContentSegments.mockReturnValueOnce([
      'blog',
      'compare',
      'left-vs-right',
    ]);
    const request = buildRequest('/blog/compare/left-vs-right');

    await expect(
      resolveComparePageHardStatus(
        request,
        request.nextUrl.pathname,
        'usebaci.com',
        'test-agent',
        'ogabassey'
      )
    ).resolves.toBeNull();
    expect(mockResolveStorefrontComparePageStatus).not.toHaveBeenCalled();

    mockGetStorefrontContentSegments.mockReturnValueOnce([
      'laptops',
      'products',
      'left-vs-right',
    ]);
    await expect(
      resolveComparePageHardStatus(
        request,
        request.nextUrl.pathname,
        'usebaci.com',
        'test-agent',
        'ogabassey'
      )
    ).resolves.toBeNull();
  });
});
