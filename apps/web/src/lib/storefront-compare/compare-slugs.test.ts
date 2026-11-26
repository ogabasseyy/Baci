import { describe, expect, it } from 'vitest';
import {
  buildCanonicalBrandCompareSlug,
  buildCanonicalProductCompareSlug,
  parseCompareSlug,
} from './compare-slugs';

describe('compare slug canonicalization', () => {
  it('orders product pairs deterministically', () => {
    expect(
      buildCanonicalProductCompareSlug(
        'iphone-17-pro-max',
        'samsung-galaxy-z-trifold'
      )
    ).toBe('iphone-17-pro-max-vs-samsung-galaxy-z-trifold');
  });

  it('orders brand pairs alphabetically', () => {
    expect(buildCanonicalBrandCompareSlug('Samsung', 'Apple')).toBe(
      'apple-vs-samsung'
    );
  });

  it('parses compare slugs into canonical compare keys', () => {
    expect(parseCompareSlug('apple-vs-samsung')).toMatchObject({
      leftKey: 'apple',
      rightKey: 'samsung',
      canonicalSlug: 'apple-vs-samsung',
    });
  });

  it('escapes product keys that already contain the compare delimiter', () => {
    const slug = buildCanonicalProductCompareSlug(
      'galaxy-vs-ultra',
      'iphone-17-pro-max'
    );

    expect(slug).toBe('~67616c6178792d76732d756c747261-vs-iphone-17-pro-max');
    expect(parseCompareSlug(slug)).toEqual({
      leftKey: 'galaxy-vs-ultra',
      rightKey: 'iphone-17-pro-max',
      canonicalSlug: slug,
    });
  });

  it('returns null for invalid compare slugs', () => {
    expect(parseCompareSlug('apple')).toBeNull();
  });

  it('returns null for unnecessary tilde hex-encoded compare keys', () => {
    expect(parseCompareSlug('~6170706c65-vs-samsung')).toBeNull();
  });
});
