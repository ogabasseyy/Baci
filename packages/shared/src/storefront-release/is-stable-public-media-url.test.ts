import { describe, expect, it } from 'vitest';
import { isStablePublicMediaUrl } from './is-stable-public-media-url';

describe('isStablePublicMediaUrl', () => {
  it('accepts content-addressed release media', () => {
    expect(
      isStablePublicMediaUrl(`/release-assets/${'a'.repeat(64)}.webp`)
    ).toBe(true);
  });

  it('rejects mutable, external, signed, and malformed media sources', () => {
    for (const value of [
      'https://cdn.example.com/logo.png',
      'https://cdn.example.com/logo.png?token=secret',
      '/api/events',
      '/checkout',
      '/media/logo.png',
      `/release-assets/${'a'.repeat(63)}.webp`,
      `/release-assets/${'a'.repeat(64)}.html`,
    ])
      expect(isStablePublicMediaUrl(value)).toBe(false);
  });
});
