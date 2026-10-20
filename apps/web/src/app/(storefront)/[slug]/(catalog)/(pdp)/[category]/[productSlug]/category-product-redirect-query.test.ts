import { describe, expect, it } from 'vitest';
import { serializeRedirectSearchParams } from './category-product-redirect-query';

describe('serializeRedirectSearchParams', () => {
  it('serializes scalar params', () => {
    expect(
      serializeRedirectSearchParams({
        variant_id: 'v1',
        match_base: '1',
      })
    ).toBe('variant_id=v1&match_base=1');
  });

  it('appends array values individually and drops undefined', () => {
    expect(
      serializeRedirectSearchParams({
        tag: ['a', 'b'],
        missing: undefined,
      })
    ).toBe('tag=a&tag=b');
  });

  it('returns an empty string when nothing survives', () => {
    expect(serializeRedirectSearchParams({ missing: undefined })).toBe('');
    expect(serializeRedirectSearchParams({})).toBe('');
  });

  it('encodes reserved characters', () => {
    expect(serializeRedirectSearchParams({ q: 'a b&c' })).toBe('q=a+b%26c');
  });
});
