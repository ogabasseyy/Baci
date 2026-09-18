import { describe, expect, it } from 'vitest';
import {
  collectOfferClaimedImageUrls,
  type FeedImageManifestEntry,
  isOfferClaimedImage,
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';

// ---------- helpers ----------
function verifiedEntry(
  overrides: Partial<FeedImageManifestEntry> = {}
): FeedImageManifestEntry {
  return {
    verified_url:
      'https://cdn.ogabassey.com/core-assets/products/iphone-16-black.jpg',
    verified_format: 'jpeg',
    status: 'verified',
    is_primary: true,
    position: 0,
    ...overrides,
  };
}

// ---------- resolveGmcPrimaryImage ----------
describe('resolveGmcPrimaryImage', () => {
  it('returns verified JPG URL unchanged', () => {
    const entries = [
      verifiedEntry({
        verified_url:
          'https://cdn.ogabassey.com/core-assets/products/phone.jpg',
        verified_format: 'jpeg',
      }),
    ];
    expect(resolveGmcPrimaryImage(entries)).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.jpg'
    );
  });

  it('returns verified PNG URL unchanged', () => {
    const entries = [
      verifiedEntry({
        verified_url:
          'https://cdn.ogabassey.com/core-assets/products/phone.png',
        verified_format: 'png',
      }),
    ];
    expect(resolveGmcPrimaryImage(entries)).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.png'
    );
  });

  it('returns verified WebP URL unchanged (WebP is GMC-supported)', () => {
    const entries = [
      verifiedEntry({
        verified_url:
          'https://cdn.ogabassey.com/core-assets/products/phone.webp',
        verified_format: 'webp',
      }),
    ];
    expect(resolveGmcPrimaryImage(entries)).toBe(
      'https://cdn.ogabassey.com/core-assets/products/phone.webp'
    );
  });

  it('returns null when no entries exist', () => {
    expect(resolveGmcPrimaryImage([])).toBeNull();
  });

  it('returns null when no primary entry is marked verified', () => {
    const entries = [verifiedEntry({ status: 'missing', is_primary: true })];
    expect(resolveGmcPrimaryImage(entries)).toBeNull();
  });

  it('returns null when primary entry has status invalid', () => {
    const entries = [verifiedEntry({ status: 'invalid', is_primary: true })];
    expect(resolveGmcPrimaryImage(entries)).toBeNull();
  });

  it('returns null when primary entry has status stale', () => {
    const entries = [verifiedEntry({ status: 'stale', is_primary: true })];
    expect(resolveGmcPrimaryImage(entries)).toBeNull();
  });

  it('returns null when primary entry has missing status and no verified URL', () => {
    const entries = [
      verifiedEntry({
        status: 'missing',
        verified_url: null,
        verified_format: null,
        is_primary: true,
      }),
    ];
    expect(resolveGmcPrimaryImage(entries)).toBeNull();
  });

  it('ignores non-primary entries', () => {
    const entries = [verifiedEntry({ is_primary: false, position: 0 })];
    expect(resolveGmcPrimaryImage(entries)).toBeNull();
  });

  it('selects the primary entry when mixed with additional entries', () => {
    const entries = [
      verifiedEntry({
        is_primary: false,
        position: 0,
        verified_url:
          'https://cdn.ogabassey.com/core-assets/products/extra.jpg',
      }),
      verifiedEntry({
        is_primary: true,
        position: 0,
        verified_url: 'https://cdn.ogabassey.com/core-assets/products/main.jpg',
      }),
      verifiedEntry({
        is_primary: false,
        position: 1,
        verified_url:
          'https://cdn.ogabassey.com/core-assets/products/extra2.jpg',
      }),
    ];
    expect(resolveGmcPrimaryImage(entries)).toBe(
      'https://cdn.ogabassey.com/core-assets/products/main.jpg'
    );
  });

  it('returns null when verified_url is null even if status is verified', () => {
    const entries = [
      verifiedEntry({
        verified_url: null,
        status: 'verified',
        is_primary: true,
      }),
    ];
    expect(resolveGmcPrimaryImage(entries)).toBeNull();
  });

  it('returns null when verified_url is empty string', () => {
    const entries = [
      verifiedEntry({ verified_url: '', status: 'verified', is_primary: true }),
    ];
    expect(resolveGmcPrimaryImage(entries)).toBeNull();
  });
});

// ---------- resolveGmcAdditionalImages ----------
describe('resolveGmcAdditionalImages', () => {
  it('returns verified non-primary entries ordered by position', () => {
    const entries = [
      verifiedEntry({
        is_primary: true,
        position: 0,
        verified_url: 'https://cdn.ogabassey.com/core-assets/products/main.jpg',
      }),
      verifiedEntry({
        is_primary: false,
        position: 2,
        verified_url: 'https://cdn.ogabassey.com/core-assets/products/c.jpg',
      }),
      verifiedEntry({
        is_primary: false,
        position: 0,
        verified_url: 'https://cdn.ogabassey.com/core-assets/products/a.jpg',
      }),
      verifiedEntry({
        is_primary: false,
        position: 1,
        verified_url: 'https://cdn.ogabassey.com/core-assets/products/b.jpg',
      }),
    ];
    expect(resolveGmcAdditionalImages(entries)).toEqual([
      'https://cdn.ogabassey.com/core-assets/products/a.jpg',
      'https://cdn.ogabassey.com/core-assets/products/b.jpg',
      'https://cdn.ogabassey.com/core-assets/products/c.jpg',
    ]);
  });

  it('returns empty array when no additional entries exist', () => {
    const entries = [verifiedEntry({ is_primary: true })];
    expect(resolveGmcAdditionalImages(entries)).toEqual([]);
  });

  it('excludes non-verified additional entries', () => {
    const entries = [
      verifiedEntry({
        is_primary: false,
        position: 0,
        status: 'missing',
        verified_url: null,
      }),
      verifiedEntry({
        is_primary: false,
        position: 1,
        verified_url: 'https://cdn.ogabassey.com/core-assets/products/good.jpg',
      }),
      verifiedEntry({
        is_primary: false,
        position: 2,
        status: 'invalid',
        verified_url: null,
      }),
    ];
    expect(resolveGmcAdditionalImages(entries)).toEqual([
      'https://cdn.ogabassey.com/core-assets/products/good.jpg',
    ]);
  });

  it('limits to 10 additional images max', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      verifiedEntry({
        is_primary: false,
        position: i,
        verified_url: `https://cdn.ogabassey.com/core-assets/products/img-${i}.jpg`,
      })
    );
    const result = resolveGmcAdditionalImages(entries);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe(
      'https://cdn.ogabassey.com/core-assets/products/img-0.jpg'
    );
    expect(result[9]).toBe(
      'https://cdn.ogabassey.com/core-assets/products/img-9.jpg'
    );
  });

  it('preserves WebP URLs in additional images', () => {
    const entries = [
      verifiedEntry({
        is_primary: false,
        position: 0,
        verified_url:
          'https://cdn.ogabassey.com/core-assets/products/photo.webp',
        verified_format: 'webp',
      }),
    ];
    expect(resolveGmcAdditionalImages(entries)).toEqual([
      'https://cdn.ogabassey.com/core-assets/products/photo.webp',
    ]);
  });

  it('excludes entries with null verified_url even if status is verified', () => {
    const entries = [
      verifiedEntry({
        is_primary: false,
        position: 0,
        verified_url: null,
        status: 'verified',
      }),
    ];
    expect(resolveGmcAdditionalImages(entries)).toEqual([]);
  });

  it('excludes entries with empty string verified_url', () => {
    const entries = [
      verifiedEntry({
        is_primary: false,
        position: 0,
        verified_url: '',
        status: 'verified',
      }),
    ];
    expect(resolveGmcAdditionalImages(entries)).toEqual([]);
  });

  it('excludes offer-claimed urls from parent-level lists', () => {
    const entries = [
      verifiedEntry({
        is_primary: false,
        position: 0,
        source_url: 'https://cdn.example/product-extra.jpg',
        verified_url: 'https://cdn.example/product-extra.jpg',
      }),
      verifiedEntry({
        is_primary: false,
        position: 1,
        source_url: 'https://cdn.example/offer-used.jpg',
        verified_url: 'https://cdn.example/offer-used.jpg',
      }),
    ];
    expect(
      resolveGmcAdditionalImages(
        entries,
        new Set(['https://cdn.example/offer-used.jpg'])
      )
    ).toEqual(['https://cdn.example/product-extra.jpg']);
  });
});

describe('collectOfferClaimedImageUrls', () => {
  it('normalizes string and object image shapes', () => {
    expect(
      collectOfferClaimedImageUrls([
        {
          images: [
            ' https://cdn.example/a.jpg ',
            { url: 'https://cdn.example/b.jpg' },
          ],
        },
        { images: 'https://cdn.example/c.jpg' },
        {},
      ])
    ).toEqual(
      new Set([
        'https://cdn.example/a.jpg',
        'https://cdn.example/b.jpg',
        'https://cdn.example/c.jpg',
      ])
    );
  });

  it('returns an empty set without offers', () => {
    expect(collectOfferClaimedImageUrls(undefined)).toEqual(new Set());
    expect(collectOfferClaimedImageUrls([])).toEqual(new Set());
  });
});

describe('isOfferClaimedImage', () => {
  it('matches source or verified urls', () => {
    const claimed = new Set(['https://cdn.example/offer.jpg']);
    expect(
      isOfferClaimedImage(
        verifiedEntry({ source_url: 'https://cdn.example/offer.jpg' }),
        claimed
      )
    ).toBe(true);
    expect(
      isOfferClaimedImage(
        verifiedEntry({ verified_url: 'https://cdn.example/offer.jpg' }),
        claimed
      )
    ).toBe(true);
    expect(isOfferClaimedImage(verifiedEntry(), claimed)).toBe(false);
    expect(isOfferClaimedImage(verifiedEntry(), new Set())).toBe(false);
  });
});
