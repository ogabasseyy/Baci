import { describe, expect, it } from 'vitest';
import { isOgabasseyHomeIdentifier } from './is-ogabassey-home-identifier';

describe('isOgabasseyHomeIdentifier', () => {
  it('accepts both monitored OgaBassey home identifiers', () => {
    expect(isOgabasseyHomeIdentifier('ogabassey')).toBe(true);
    expect(isOgabasseyHomeIdentifier('ogabassey.com')).toBe(true);
    expect(isOgabasseyHomeIdentifier('OgaBassey.COM')).toBe(true);
  });

  it('rejects other storefront slugs', () => {
    expect(isOgabasseyHomeIdentifier('another-shop')).toBe(false);
    expect(isOgabasseyHomeIdentifier('ogabassey-store')).toBe(false);
  });
});
