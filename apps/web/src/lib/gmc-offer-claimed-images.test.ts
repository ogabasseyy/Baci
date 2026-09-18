import { describe, expect, it } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import {
  collectOfferClaimedImageUrls,
  isOfferClaimedImage,
} from '@/lib/gmc-offer-claimed-images';

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
