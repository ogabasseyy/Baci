import { describe, expect, it } from 'vitest';
import { collectOfferClaimedImageUrls } from '@/lib/collect-offer-claimed-image-urls';

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
        {},
      ])
    ).toEqual(
      new Set(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'])
    );
  });

  it('ignores non-array image shapes that can never verify', () => {
    expect(
      collectOfferClaimedImageUrls([
        { images: 'https://cdn.example/c.jpg' },
        { images: { url: 'https://cdn.example/d.jpg' } },
      ])
    ).toEqual(new Set());
  });

  it('returns an empty set without offers', () => {
    expect(collectOfferClaimedImageUrls(undefined)).toEqual(new Set());
    expect(collectOfferClaimedImageUrls([])).toEqual(new Set());
  });
});
