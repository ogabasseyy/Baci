import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidateTag = vi.fn();

vi.mock('next/cache', () => ({
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

import { expireProductBlogCacheReliable } from './expire-product-blog-cache-reliable';

describe('expireProductBlogCacheReliable', () => {
  beforeEach(() => {
    mockRevalidateTag.mockReset();
  });

  it('uses the request-context tag expiry without a remote request', async () => {
    // Arrange
    const fetchImpl = vi.fn();

    // Act
    const result = await expireProductBlogCacheReliable('merchant-1', {
      fetchImpl,
      baseUrl: 'https://app.usebaci.com',
      secret: 'internal-secret',
    });

    // Assert
    expect(result).toBe(true);
    expect(mockRevalidateTag).toHaveBeenCalledWith('products-merchant-1', {
      expire: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the authenticated internal route outside a request context', async () => {
    // Arrange
    mockRevalidateTag.mockImplementationOnce(() => {
      throw new Error('missing Next request context');
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    // Act
    const result = await expireProductBlogCacheReliable('merchant-1', {
      fetchImpl,
      baseUrl: 'https://app.usebaci.com',
      secret: 'internal-secret',
    });

    // Assert
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, request] = fetchImpl.mock.calls[0] ?? [];
    expect(fetchImpl.mock.calls[0]?.[0]?.toString()).toBe(
      'https://app.usebaci.com/api/internal/revalidate-products'
    );
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({
      Authorization: 'Bearer internal-secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(request?.body as string)).toEqual({
      merchantId: 'merchant-1',
      expireProductBlogCache: true,
    });
  });

  it('fails open when the internal route is unavailable', async () => {
    // Arrange
    mockRevalidateTag.mockImplementationOnce(() => {
      throw new Error('missing Next request context');
    });
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

    // Act
    const result = await expireProductBlogCacheReliable('merchant-1', {
      fetchImpl,
      baseUrl: 'https://app.usebaci.com',
      secret: 'internal-secret',
    });

    // Assert
    expect(result).toBe(false);
  });
});
