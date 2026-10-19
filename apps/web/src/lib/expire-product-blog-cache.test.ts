import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRevalidateTag } = vi.hoisted(() => ({
  mockRevalidateTag: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidateTag: mockRevalidateTag }));

import { expireProductBlogCache } from './expire-product-blog-cache';

describe('expireProductBlogCache', () => {
  beforeEach(() => {
    mockRevalidateTag.mockReset();
  });

  it('hard-expires the merchant product-enrichment tag before edge purge', () => {
    expireProductBlogCache('merchant-1');

    expect(mockRevalidateTag).toHaveBeenCalledExactlyOnceWith(
      'products-merchant-1',
      { expire: 0 }
    );
    expect(mockRevalidateTag).not.toHaveBeenCalledWith(
      'merchant-id-merchant-1',
      { expire: 0 }
    );
  });

  it('does not throw when a cache tag cannot be invalidated', () => {
    mockRevalidateTag.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });

    expect(() => expireProductBlogCache('merchant-1')).not.toThrow();
    expect(mockRevalidateTag).toHaveBeenCalledExactlyOnceWith(
      'products-merchant-1',
      { expire: 0 }
    );
  });

  it('skips blank merchant identifiers', () => {
    expireProductBlogCache('   ');

    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});
