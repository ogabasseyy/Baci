import { describe, expect, it } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import { isOfferClaimedImage } from '@/lib/is-offer-claimed-image';

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

  it('matches a relative offer claim against the same absolute path', () => {
    const claimed = new Set(['/images/used.jpg']);
    expect(
      isOfferClaimedImage(
        verifiedEntry({
          source_url: 'https://cdn.example/images/used.jpg',
          verified_url: 'https://cdn.example/images/used.jpg',
        }),
        claimed
      )
    ).toBe(true);
    expect(
      isOfferClaimedImage(
        verifiedEntry({
          source_url: 'https://cdn.example/images/other.jpg',
          verified_url: 'https://cdn.example/images/other.jpg',
        }),
        claimed
      )
    ).toBe(false);
  });

  it('does not match an absolute claim from another host by path alone', () => {
    const claimed = new Set(['https://other.example/images/used.jpg']);
    expect(
      isOfferClaimedImage(
        verifiedEntry({
          source_url: 'https://cdn.example/images/used.jpg',
          verified_url: 'https://cdn.example/images/used.jpg',
        }),
        claimed
      )
    ).toBe(false);
  });
});
