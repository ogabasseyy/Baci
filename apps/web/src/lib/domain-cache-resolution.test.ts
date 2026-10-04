import { describe, expect, it } from 'vitest';
import { cacheableDomainResolution } from './domain-cache-resolution';

describe('public domain result cache eligibility', () => {
  it('preserves a resolved public mapping', () => {
    expect(
      cacheableDomainResolution({ outcome: 'resolved', value: 'shop.example' })
    ).toBe('shop.example');
  });
  it('allows authoritative absence to be negatively cached', () => {
    expect(cacheableDomainResolution({ outcome: 'not-found' })).toBeNull();
  });
  it('does not turn an unavailable resolver into a cacheable negative', () => {
    expect(
      cacheableDomainResolution({ outcome: 'unavailable' })
    ).toBeUndefined();
  });
});
