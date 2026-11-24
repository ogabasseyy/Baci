import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveFeedMerchant = vi.fn();
const mockGenerateGoogleMerchantFeed = vi.fn();
const mockGetCachedGoogleMerchantFeedData = vi.fn();
const mockLoggerError = vi.fn();
const mockCacheLife = vi.fn();
const mockCacheTag = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: (...args: unknown[]) => mockCacheLife(...args),
  cacheTag: (...args: unknown[]) => mockCacheTag(...args),
}));

vi.mock('@/lib/feed-identifier', () => {
  class _MerchantNotFoundError extends Error {
    constructor(identifier: string) {
      super(`Merchant not found: ${identifier}`);
      this.name = 'MerchantNotFoundError';
    }
  }

  return {
    MerchantNotFoundError: _MerchantNotFoundError,
    resolveFeedMerchant: (...args: unknown[]) =>
      mockResolveFeedMerchant(...args),
  };
});

vi.mock('./feed-data', () => ({
  getCachedGoogleMerchantFeedData: (...args: unknown[]) =>
    mockGetCachedGoogleMerchantFeedData(...args),
}));

vi.mock('./feed-builder', () => ({
  generateGoogleMerchantFeed: (...args: unknown[]) =>
    mockGenerateGoogleMerchantFeed(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (payload: unknown) => mockLoggerError(payload),
  },
}));

import { MerchantNotFoundError } from '@/lib/feed-identifier';
import { generateGoogleMerchantFeedForIdentifier } from './feed-service';

beforeEach(() => {
  vi.clearAllMocks();

  mockResolveFeedMerchant.mockResolvedValue({
    id: 'merchant-1',
    business_name: 'Ogabassey',
    country: 'NG',
    payout_currency: 'NGN',
    slug: 'ogabassey',
  });

  mockGetCachedGoogleMerchantFeedData.mockResolvedValue({
    custom_domain: 'ogabassey.com',
    slug: 'ogabassey',
    products: [{ id: 'product-1', name: 'Phone' }],
    imageManifest: {},
  });

  mockGenerateGoogleMerchantFeed.mockReturnValue('<rss />');
});

describe('generateGoogleMerchantFeedForIdentifier', () => {
  it('generates feed XML for a resolved merchant identifier', async () => {
    const result = await generateGoogleMerchantFeedForIdentifier({
      identifier: 'ogabassey',
      isBySlug: true,
    });

    expect(result).toEqual({ success: true, xml: '<rss />' });
    expect(mockCacheLife).toHaveBeenCalledWith('products');
    expect(mockCacheTag).toHaveBeenCalledWith(
      'google-merchant-feed',
      'merchant-feed-merchant-1'
    );
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith('ogabassey', true);
    expect(mockGetCachedGoogleMerchantFeedData).toHaveBeenCalledWith(
      'merchant-1',
      'ogabassey'
    );
    expect(mockGenerateGoogleMerchantFeed).toHaveBeenCalledWith(
      [{ id: 'product-1', name: 'Phone' }],
      expect.objectContaining({
        id: 'merchant-1',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
      }),
      'https://ogabassey.com',
      {}
    );
  });

  it('falls back to a slug-based base URL when custom domain is missing', async () => {
    mockGetCachedGoogleMerchantFeedData.mockResolvedValue({
      custom_domain: null,
      slug: 'ogabassey',
      products: [{ id: 'product-1', name: 'Phone' }],
      imageManifest: {},
    });
    mockGenerateGoogleMerchantFeed.mockImplementation((...args: unknown[]) => {
      const baseUrl = String(args[2]);
      return `<rss><link>${baseUrl}/phone</link></rss>`;
    });

    const result = await generateGoogleMerchantFeedForIdentifier({
      identifier: 'ogabassey',
      isBySlug: true,
    });

    expect(result).toEqual({
      success: true,
      xml: '<rss><link>https://ogabassey.baci.app/phone</link></rss>',
    });
    expect(mockGenerateGoogleMerchantFeed).toHaveBeenCalledWith(
      [{ id: 'product-1', name: 'Phone' }],
      expect.objectContaining({
        slug: 'ogabassey',
        custom_domain: null,
      }),
      'https://ogabassey.baci.app',
      {}
    );
  });

  it('generates feed XML for a resolved merchant UUID', async () => {
    const result = await generateGoogleMerchantFeedForIdentifier({
      identifier: '00000000-0000-4000-8000-000000000001',
      isBySlug: false,
    });

    expect(result).toEqual({ success: true, xml: '<rss />' });
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      false
    );
    expect(mockGetCachedGoogleMerchantFeedData).toHaveBeenCalledWith(
      'merchant-1',
      'ogabassey'
    );
    expect(mockGenerateGoogleMerchantFeed).toHaveBeenCalledWith(
      [{ id: 'product-1', name: 'Phone' }],
      expect.objectContaining({
        id: 'merchant-1',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
      }),
      'https://ogabassey.com',
      {}
    );
  });

  it('returns a 404 service result when the merchant is not found', async () => {
    const error = new MerchantNotFoundError('missing');
    mockResolveFeedMerchant.mockRejectedValue(error);

    const result = await generateGoogleMerchantFeedForIdentifier({
      identifier: 'missing',
      isBySlug: true,
    });

    expect(result).toEqual({
      success: false,
      status: 404,
      error: 'Merchant not found',
      cause: error,
    });
    expect(mockGenerateGoogleMerchantFeed).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('returns a 500 service result when feed data loading fails', async () => {
    const error = new Error('feed data failed');
    mockGetCachedGoogleMerchantFeedData.mockRejectedValue(error);

    const result = await generateGoogleMerchantFeedForIdentifier({
      identifier: 'ogabassey',
      isBySlug: true,
    });

    expect(result).toEqual({
      success: false,
      status: 500,
      error: 'Failed to generate feed',
      cause: error,
    });
    expect(mockLoggerError).toHaveBeenCalledWith({
      message: 'Failed to generate Google Merchant feed',
      error,
      identifier: 'ogabassey',
      isBySlug: true,
    });
    expect(mockGenerateGoogleMerchantFeed).not.toHaveBeenCalled();
  });

  it('returns a 500 service result when feed XML generation fails', async () => {
    const error = new Error('feed builder failed');
    mockGenerateGoogleMerchantFeed.mockImplementation(() => {
      throw error;
    });

    const result = await generateGoogleMerchantFeedForIdentifier({
      identifier: 'ogabassey',
      isBySlug: true,
    });

    expect(result).toEqual({
      success: false,
      status: 500,
      error: 'Failed to generate feed',
      cause: error,
    });
    expect(mockLoggerError).toHaveBeenCalledWith({
      message: 'Failed to generate Google Merchant feed',
      error,
      identifier: 'ogabassey',
      isBySlug: true,
    });
    expect(mockGetCachedGoogleMerchantFeedData).toHaveBeenCalledWith(
      'merchant-1',
      'ogabassey'
    );
  });
});
