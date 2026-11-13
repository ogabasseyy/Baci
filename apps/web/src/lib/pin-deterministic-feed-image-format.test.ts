import { describe, expect, it } from 'vitest';
import { getImageMimeType } from './get-blog-feed-image-mime-type';
import { pinDeterministicFeedImageFormat } from './pin-deterministic-feed-image-format';

describe('pinDeterministicFeedImageFormat', () => {
  it('pins path-based format=auto to jpeg for .jpg URLs', () => {
    const pinned = pinDeterministicFeedImageFormat(
      'https://cdn.example.com/cdn-cgi/image/width=800,format=auto/photo.jpg'
    );
    expect(pinned).toBe(
      'https://cdn.example.com/cdn-cgi/image/width=800,format=jpeg/photo.jpg'
    );
    expect(getImageMimeType(pinned)).toBe('image/jpeg');
  });

  it('pins query-based f=auto to webp for .avif URLs to avoid non-deterministic fallback', () => {
    const pinned = pinDeterministicFeedImageFormat(
      'https://cdn.example.com/hero.avif?f=auto'
    );
    expect(pinned).toBe('https://cdn.example.com/hero.avif?f=webp');
    expect(getImageMimeType(pinned)).toBe('image/webp');
  });

  it('leaves extension-less format=auto URLs unchanged', () => {
    const url =
      'https://cdn.example.com/cdn-cgi/image/width=800,format=auto/cell';
    expect(pinDeterministicFeedImageFormat(url)).toBe(url);
    expect(getImageMimeType(url)).toBeUndefined();
  });

  it('returns invalid URLs unchanged', () => {
    expect(pinDeterministicFeedImageFormat('not a valid url')).toBe(
      'not a valid url'
    );
  });
});
