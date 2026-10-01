import { describe, expect, it } from 'vitest';
import {
  type FeedImageManifestEntry,
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

describe('gmc offer-claim image resolution', () => {
  it('skips primary entries claimed by offers', () => {
    const entries = [
      verifiedEntry({ verified_url: 'https://cdn.example/offer-used.jpg' }),
    ];
    expect(
      resolveGmcPrimaryImage(
        entries,
        new Set(['https://cdn.example/offer-used.jpg'])
      )
    ).toBeNull();
    expect(resolveGmcPrimaryImage(entries, new Set())).toBe(
      'https://cdn.example/offer-used.jpg'
    );
  });
  it('promotes the lowest-position safe entry when no primary is available', () => {
    const entries = [
      verifiedEntry({
        is_primary: false,
        position: 2,
        verified_url: 'https://cdn.example/second.jpg',
      }),
      verifiedEntry({
        is_primary: false,
        position: 1,
        verified_url: 'https://cdn.example/first.jpg',
      }),
    ];
    expect(resolveGmcPrimaryImage(entries)).toBe(
      'https://cdn.example/first.jpg'
    );
  });

  it('promotes a safe entry when the primary is claimed by offers', () => {
    const entries = [
      verifiedEntry({ verified_url: 'https://cdn.example/offer-used.jpg' }),
      verifiedEntry({
        is_primary: false,
        position: 1,
        verified_url: 'https://cdn.example/safe.jpg',
      }),
    ];
    expect(
      resolveGmcPrimaryImage(
        entries,
        new Set(['https://cdn.example/offer-used.jpg'])
      )
    ).toBe('https://cdn.example/safe.jpg');
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
