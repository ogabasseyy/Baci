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

  it('excludes rows sharing the verified url of a claimed entry', () => {
    const claimed = new Set(['https://cdn.example/phone.avif']);
    const avifEntry = verifiedEntry({
      source_url: 'https://cdn.example/phone.avif',
      verified_url: 'https://cdn.example/phone.jpg',
      is_primary: false,
      position: 1,
    });
    const jpgSibling = verifiedEntry({
      source_url: 'https://cdn.example/phone.jpg',
      verified_url: 'https://cdn.example/phone.jpg',
      is_primary: true,
      position: 0,
    });
    const manifest = [avifEntry, jpgSibling];
    // The sibling row shares no raw spelling with the AVIF claim, but it
    // resolves to the same verified image the offer owns.
    expect(isOfferClaimedImage(jpgSibling, claimed, manifest)).toBe(true);
    expect(isOfferClaimedImage(verifiedEntry(), claimed, manifest)).toBe(false);
  });

  it('does not exclude shared verified urls without the manifest', () => {
    const claimed = new Set(['https://cdn.example/phone.avif']);
    expect(
      isOfferClaimedImage(
        verifiedEntry({
          source_url: 'https://cdn.example/phone.jpg',
          verified_url: 'https://cdn.example/phone.jpg',
        }),
        claimed
      )
    ).toBe(false);
  });
});
