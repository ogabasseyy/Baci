import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();
const mockPurgeCloudflareUrls = vi.fn();
const mockAfter = vi.fn((callback: () => unknown) => {
  callback();
});

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => mockAfter(callback),
}));
vi.mock('@/lib/cloudflare-purge', () => ({
  purgeCloudflareUrls: (...args: unknown[]) => mockPurgeCloudflareUrls(...args),
}));

import {
  revalidateDomains,
  revalidateMerchant,
  revalidateMerchantSlugLookup,
  revalidatePageConfig,
  revalidateRepairsCatalog,
} from './cache-revalidation';
import {
  getDomainCacheTag,
  getMerchantIdentifierCacheTag,
  PLATFORM_SITEMAP_MERCHANTS_CACHE_TAG,
} from './tenant-cache-tags';

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('tenant-scoped cache revalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('revalidateMerchant', () => {
    it('revalidates merchant-id and dashboard tags without global merchants tag', () => {
      revalidateMerchant(MERCHANT_ID);

      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'merchants',
        expect.anything()
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('revalidates slug tags when slug provided', () => {
      revalidateMerchant(MERCHANT_ID, 'Test-Store');

      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'merchants',
        expect.anything()
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-test-store',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-slug-test-store',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(4);
    });

    it('skips invalid blank merchant IDs with warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        // Expected warning for blank merchant ID.
      });

      revalidateMerchant('   ');

      expect(mockRevalidateTag).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  describe('revalidateMerchantSlugLookup', () => {
    it('revalidates per-slug lookup and platform-sitemap tags without busting global merchant/merchants tags', () => {
      revalidateMerchantSlugLookup('Ogabassey');

      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'merchant',
        expect.anything()
      );
      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'merchants',
        expect.anything()
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-slug-ogabassey',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-ogabassey',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        PLATFORM_SITEMAP_MERCHANTS_CACHE_TAG,
        'merchant'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/sitemap.xml');
      expect(mockRevalidateTag).toHaveBeenCalledTimes(3);
    });

    it('falls back to global merchant tag only when slug is omitted or empty', () => {
      revalidateMerchantSlugLookup();
      revalidateMerchantSlugLookup('');

      expect(mockRevalidateTag).toHaveBeenCalledWith('merchant', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        PLATFORM_SITEMAP_MERCHANTS_CACHE_TAG,
        'merchant'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/sitemap.xml');
      expect(mockRevalidateTag).toHaveBeenCalledTimes(4);
    });

    it('routes domain-shaped identifiers to domain, merchant, and platform-sitemap tags', () => {
      revalidateMerchantSlugLookup('Shop.Example.COM');

      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'merchant',
        expect.anything()
      );
      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'domains',
        expect.anything()
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'domain-shop.example.com',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-shop.example.com',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        PLATFORM_SITEMAP_MERCHANTS_CACHE_TAG,
        'merchant'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/sitemap.xml');
      expect(mockRevalidateTag).toHaveBeenCalledTimes(3);
    });

    it('skips invalid slug values with a warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        // Expected warning for invalid slug.
      });

      revalidateMerchantSlugLookup('../evil');

      expect(mockRevalidateTag).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  describe('revalidatePageConfig', () => {
    it('revalidates merchant-scoped page config without global page-config tag', () => {
      revalidatePageConfig(MERCHANT_ID);

      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'page-config',
        expect.anything()
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `page-config-${MERCHANT_ID}`,
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    });

    it('revalidates merchant and page-slug tags when pageSlug is provided', () => {
      revalidatePageConfig(MERCHANT_ID, 'about-us');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `page-config-${MERCHANT_ID}`,
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `page-config-${MERCHANT_ID}-about-us`,
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('skips blank merchant IDs with a warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        // Expected warning for blank merchant ID.
      });

      revalidatePageConfig('   ', 'about-us');

      expect(mockRevalidateTag).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  describe('revalidateRepairsCatalog', () => {
    it('revalidates only the merchant-scoped repairs feed tag', () => {
      revalidateRepairsCatalog(MERCHANT_ID);

      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'repairs-catalog-feed',
        expect.anything()
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `repairs-feed-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    });

    it('skips revalidation for a blank merchant id', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
        // Expected warning for blank merchant ID.
      });

      revalidateRepairsCatalog('   ');

      expect(mockRevalidateTag).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('revalidateDomains', () => {
    it('falls back to global domains tag only when domain is omitted or empty', () => {
      revalidateDomains();
      revalidateDomains('');

      expect(mockRevalidateTag).toHaveBeenNthCalledWith(
        1,
        'domains',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenNthCalledWith(
        2,
        'domains',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('revalidates domain and merchant domain tags without busting global domains', () => {
      revalidateDomains(' Shop.Example.COM ');

      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'domains',
        expect.anything()
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'domain-shop.example.com',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'merchant-shop.example.com',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledTimes(2);
    });

    it('bounds long custom-domain tags to 256 bytes matching tenant-cache-tags helpers', () => {
      const longDomain = `${'a'.repeat(240)}.example.com`;
      revalidateDomains(longDomain);

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getDomainCacheTag(longDomain),
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getMerchantIdentifierCacheTag(longDomain),
        'merchant'
      );
      for (const [tag] of mockRevalidateTag.mock.calls) {
        expect(Buffer.byteLength(String(tag), 'utf8')).toBeLessThanOrEqual(256);
      }
    });
  });
});
