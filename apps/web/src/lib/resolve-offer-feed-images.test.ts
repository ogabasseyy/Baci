import { describe, expect, it } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import { resolveOfferFeedImages } from './resolve-offer-feed-images';

const entry: FeedImageManifestEntry = {
  source_url: 'https://cdn.example/source.avif',
  verified_url: 'https://cdn.example/image.jpg',
  status: 'verified',
  verified_format: 'jpeg',
  is_primary: true,
  position: 0,
};
describe('resolveOfferFeedImages', () => {
  it.each([
    undefined,
    null,
    [],
  ])('retains legacy fallback for absent images %s', (images) => {
    expect(resolveOfferFeedImages(images, [entry])?.imageUrl).toBe(
      entry.verified_url
    );
  });
  it('matches string and object URLs against verified derivatives and deduplicates images', () => {
    expect(
      resolveOfferFeedImages(
        [entry.source_url, { url: entry.verified_url }],
        [entry]
      )
    ).toEqual({ imageUrl: entry.verified_url, additionalImagesXml: '' });
  });
  it.each([
    'invalid',
    [{}],
    ['unknown'],
    [null],
  ])('rejects invalid explicit images %s', (images) => {
    expect(resolveOfferFeedImages(images, [entry])).toBeNull();
  });
  it('never exports a stale matching image', () => {
    expect(
      resolveOfferFeedImages(
        [entry.source_url],
        [{ ...entry, status: 'stale' }]
      )
    ).toBeNull();
  });
});
