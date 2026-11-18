import { describe, expect, it } from 'vitest';
import { resolveTrackOrderMerchantSlug } from './resolve-track-order-merchant-slug';

describe('resolveTrackOrderMerchantSlug', () => {
  it('prefers the resolved merchant slug when available', () => {
    expect(resolveTrackOrderMerchantSlug('ogabassey', 'ogabassey.com')).toBe(
      'ogabassey'
    );
  });

  it('normalizes platform and localhost subdomains when merchant context is absent', () => {
    expect(resolveTrackOrderMerchantSlug(undefined, 'shop.localhost')).toBe(
      'shop'
    );
    expect(resolveTrackOrderMerchantSlug(null, ['shop.usebaci.com'])).toBe(
      'shop'
    );
  });

  it('preserves plain slugs and handles missing params', () => {
    expect(resolveTrackOrderMerchantSlug(undefined, 'ogabassey')).toBe(
      'ogabassey'
    );
    expect(resolveTrackOrderMerchantSlug(undefined, undefined)).toBeUndefined();
  });
});
