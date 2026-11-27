import { describe, expect, it, vi } from 'vitest';
import {
  hasDisallowedCompareSlugChars,
  MAX_SAFE_COMPARE_SLUG_ENCODED_LENGTH,
  prevalidateCompareRequest,
} from './prevalidate-compare-request';

describe('hasDisallowedCompareSlugChars', () => {
  it('flags whitespace, path traversal, query/hash, percent, and control chars', () => {
    expect(hasDisallowedCompareSlugChars('iphone 16')).toBe(true);
    expect(hasDisallowedCompareSlugChars('../etc')).toBe(true);
    expect(hasDisallowedCompareSlugChars('a/b')).toBe(true);
    expect(hasDisallowedCompareSlugChars('a?b=1')).toBe(true);
    expect(hasDisallowedCompareSlugChars('a%20b')).toBe(true);
    expect(hasDisallowedCompareSlugChars('a\x00b')).toBe(true);
    expect(hasDisallowedCompareSlugChars('iphone-16-pro')).toBe(false);
  });
});

describe('prevalidateCompareRequest', () => {
  it('returns parsed slug for valid product comparison requests', () => {
    const onMiss = vi.fn();
    expect(
      prevalidateCompareRequest(
        {
          merchantSlug: 'ogabassey.com',
          categorySlug: 'smartphones',
          comparisonSlug: 'iphone-16-pro-vs-samsung-galaxy-s25',
        },
        onMiss
      )
    ).toEqual({
      canonicalSlug: 'iphone-16-pro-vs-samsung-galaxy-s25',
      leftKey: 'iphone-16-pro',
      rightKey: 'samsung-galaxy-s25',
    });
    expect(onMiss).not.toHaveBeenCalled();
  });

  it('rejects invalid merchant identifiers without logging a miss', () => {
    const onMiss = vi.fn();
    expect(
      prevalidateCompareRequest(
        {
          merchantSlug: '../bad-merchant',
          categorySlug: 'smartphones',
          comparisonSlug: 'iphone-16-vs-galaxy-s25',
        },
        onMiss
      )
    ).toBeNull();
    expect(onMiss).not.toHaveBeenCalled();
  });

  it('rejects unsafe category slugs with unsafe_slug reason', () => {
    const onMiss = vi.fn();
    expect(
      prevalidateCompareRequest(
        {
          merchantSlug: 'ogabassey.com',
          categorySlug: '../smartphones',
          comparisonSlug: 'iphone-16-vs-galaxy-s25',
        },
        onMiss
      )
    ).toBeNull();
    expect(onMiss).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unsafe_slug' })
    );
  });

  it('rejects overly long comparison slugs with unsafe_compare_key reason', () => {
    const onMiss = vi.fn();
    expect(
      prevalidateCompareRequest(
        {
          merchantSlug: 'ogabassey.com',
          categorySlug: 'smartphones',
          comparisonSlug: 'a'.repeat(MAX_SAFE_COMPARE_SLUG_ENCODED_LENGTH + 1),
        },
        onMiss
      )
    ).toBeNull();
    expect(onMiss).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unsafe_compare_key' })
    );
  });

  it('rejects malformed and duplicate self-compare slugs', () => {
    const onMiss = vi.fn();
    expect(
      prevalidateCompareRequest(
        {
          merchantSlug: 'ogabassey.com',
          categorySlug: 'smartphones',
          comparisonSlug: 'not-a-comparison',
        },
        onMiss
      )
    ).toBeNull();
    expect(onMiss).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'invalid_compare_slug' })
    );

    expect(
      prevalidateCompareRequest(
        {
          merchantSlug: 'ogabassey.com',
          categorySlug: 'smartphones',
          comparisonSlug: 'iphone-16-vs-iphone-16',
        },
        onMiss
      )
    ).toBeNull();
    expect(onMiss).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'self_compare_pair' })
    );
  });
});
