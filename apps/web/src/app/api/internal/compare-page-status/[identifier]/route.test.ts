import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveComparePageStatus } from '@/lib/storefront-compare/resolve-compare-page-status';
import { GET } from './route';

const { mockGetInternalApiSecret } = vi.hoisted(() => ({
  mockGetInternalApiSecret: vi.fn(() => 'test-internal-secret'),
}));

vi.mock('@/env', () => ({
  getInternalApiSecret: () => mockGetInternalApiSecret(),
}));

vi.mock('@/lib/storefront-compare/resolve-compare-page-status', () => ({
  resolveComparePageStatus: vi.fn(),
}));

function buildRequest(
  query: string,
  headers: Record<string, string> = {
    'x-baci-internal-auth': 'test-internal-secret',
  }
) {
  const request = new NextRequest(
    `https://usebaci.com/api/internal/compare-page-status/ogabassey?${query}`
  );
  for (const [name, value] of Object.entries(headers)) {
    request.headers.set(name, value);
  }
  return request;
}

function context(identifier = 'ogabassey') {
  return { params: Promise.resolve({ identifier }) };
}

describe('GET /api/internal/compare-page-status/[identifier]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue('test-internal-secret');
    vi.mocked(resolveComparePageStatus).mockResolvedValue({
      kind: 'renderable',
      merchantId: 'merchant-1',
    });
  });

  it('returns 500 when the internal secret is not configured', async () => {
    mockGetInternalApiSecret.mockReturnValue('');

    const response = await GET(
      buildRequest('category=laptops&comparison=left-laptop-vs-right-laptop'),
      context()
    );

    expect(response.status).toBe(500);
    expect(resolveComparePageStatus).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before resolving status', async () => {
    const response = await GET(
      buildRequest('category=laptops&comparison=left-laptop-vs-right-laptop', {
        'x-baci-internal-auth': 'wrong',
      }),
      context()
    );

    expect(response.status).toBe(401);
    expect(resolveComparePageStatus).not.toHaveBeenCalled();
  });

  it('rejects invalid query input', async () => {
    const response = await GET(buildRequest('category=laptops'), context());

    expect(response.status).toBe(400);
    expect(resolveComparePageStatus).not.toHaveBeenCalled();
  });

  it('edge-caches a confirmed renderable verdict under custom-header auth', async () => {
    const response = await GET(
      buildRequest('category=laptops&comparison=left-laptop-vs-right-laptop'),
      context()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hasError: false,
      present: true,
    });
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=300');
    expect(response.headers.get('Vary')).toBe('x-baci-internal-auth');
    expect(response.headers.get('Vercel-Cache-Tag')).toBe(
      'product-slug-set-merchant-1,categories-merchant-1'
    );
    expect(resolveComparePageStatus).toHaveBeenCalledWith({
      merchantSlug: 'ogabassey',
      categorySlug: 'laptops',
      comparisonSlug: 'left-laptop-vs-right-laptop',
    });
  });

  it('keeps renderable verdicts no-store under legacy bearer auth', async () => {
    const response = await GET(
      buildRequest('category=laptops&comparison=left-laptop-vs-right-laptop', {
        Authorization: 'Bearer test-internal-secret',
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('keeps missing and unknown verdicts no-store', async () => {
    vi.mocked(resolveComparePageStatus).mockResolvedValueOnce({
      kind: 'missing',
    });
    const missing = await GET(
      buildRequest('category=laptops&comparison=left-laptop-vs-right-laptop'),
      context()
    );
    await expect(missing.json()).resolves.toEqual({
      hasError: false,
      present: false,
    });
    expect(missing.headers.get('Cache-Control')).toBe('no-store');

    vi.mocked(resolveComparePageStatus).mockResolvedValueOnce({
      kind: 'unknown',
    });
    const unknown = await GET(
      buildRequest('category=laptops&comparison=left-laptop-vs-right-laptop'),
      context()
    );
    await expect(unknown.json()).resolves.toEqual({
      hasError: true,
      present: false,
    });
    expect(unknown.headers.get('Cache-Control')).toBe('no-store');
  });

  it('converts resolver failures to a fail-open 200 verdict', async () => {
    vi.mocked(resolveComparePageStatus).mockRejectedValueOnce(
      new Error('inventory query failed')
    );

    const response = await GET(
      buildRequest('category=laptops&comparison=left-laptop-vs-right-laptop'),
      context()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hasError: true,
      present: false,
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
