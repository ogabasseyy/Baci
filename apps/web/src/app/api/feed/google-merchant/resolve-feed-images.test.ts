import { describe, expect, it } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import { resolveFeedImages } from './resolve-feed-images';

function entry(
  overrides: Partial<FeedImageManifestEntry> = {}
): FeedImageManifestEntry {
  return {
    verified_url: 'https://cdn.example.com/primary.jpg',
    verified_format: 'jpeg',
    status: 'verified',
    is_primary: true,
    position: 0,
    ...overrides,
  };
}

describe('resolveFeedImages', () => {
  it('returns null when no primary image resolves', () => {
    expect(resolveFeedImages([])).toBeNull();
    expect(
      resolveFeedImages([entry({ status: 'missing', verified_url: null })])
    ).toBeNull();
  });

  it('promotes the lowest-position safe entry when the primary is claimed', () => {
    const entries = [
      entry({
        source_url: 'https://cdn.example/offer.jpg',
        verified_url: 'https://cdn.example/offer.jpg',
        is_primary: true,
        position: 0,
      }),
      entry({
        verified_url: 'https://cdn.example/safe.jpg',
        is_primary: false,
        position: 1,
      }),
    ];
    const resolved = resolveFeedImages(
      entries,
      new Set(['https://cdn.example/offer.jpg'])
    );
    expect(resolved?.primaryImageUrl).toBe('https://cdn.example/safe.jpg');
  });

  it('removes the promoted primary from the additional-image xml', () => {
    const entries = [
      entry({
        source_url: 'https://cdn.example/offer.jpg',
        verified_url: 'https://cdn.example/offer.jpg',
        is_primary: true,
        position: 0,
      }),
      entry({
        verified_url: 'https://cdn.example/safe.jpg',
        is_primary: false,
        position: 1,
      }),
      entry({
        verified_url: 'https://cdn.example/extra.jpg',
        is_primary: false,
        position: 2,
      }),
    ];
    const resolved = resolveFeedImages(
      entries,
      new Set(['https://cdn.example/offer.jpg'])
    );
    expect(resolved?.primaryImageUrl).toBe('https://cdn.example/safe.jpg');
    expect(resolved?.additionalImagesXml).not.toContain(
      'https://cdn.example/safe.jpg'
    );
    expect(resolved?.additionalImagesXml).toContain(
      'https://cdn.example/extra.jpg'
    );
  });
});
