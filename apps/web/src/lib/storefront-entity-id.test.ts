import { describe, expect, it } from 'vitest';
import {
  buildStorefrontEntityId,
  normalizeStorefrontBaseUrl,
} from './storefront-entity-id';

describe('storefront-entity-id', () => {
  describe('normalizeStorefrontBaseUrl', () => {
    it('strips trailing slashes and trims whitespace', () => {
      expect(normalizeStorefrontBaseUrl('https://ogabassey.com/')).toBe(
        'https://ogabassey.com'
      );
      expect(normalizeStorefrontBaseUrl('https://ogabassey.com///')).toBe(
        'https://ogabassey.com'
      );
      expect(normalizeStorefrontBaseUrl('  https://ogabassey.com/  ')).toBe(
        'https://ogabassey.com'
      );
      expect(normalizeStorefrontBaseUrl('https://usebaci.com/store-a/')).toBe(
        'https://usebaci.com/store-a'
      );
    });
  });

  describe('buildStorefrontEntityId', () => {
    it('produces identical deterministic entity IDs with or without trailing slash on apex domain', () => {
      const withSlash = 'https://ogabassey.com/';
      const withoutSlash = 'https://ogabassey.com';

      expect(buildStorefrontEntityId(withSlash, 'homepage')).toBe(
        'https://ogabassey.com/#homepage'
      );
      expect(buildStorefrontEntityId(withoutSlash, 'homepage')).toBe(
        'https://ogabassey.com/#homepage'
      );
      expect(buildStorefrontEntityId(withSlash, 'website')).toBe(
        'https://ogabassey.com/#website'
      );
      expect(buildStorefrontEntityId(withoutSlash, 'website')).toBe(
        'https://ogabassey.com/#website'
      );
      expect(buildStorefrontEntityId(withSlash, 'online-store')).toBe(
        'https://ogabassey.com/#online-store'
      );
      expect(buildStorefrontEntityId(withoutSlash, 'online-store')).toBe(
        'https://ogabassey.com/#online-store'
      );
    });

    it('preserves path prefixes for multi-tenant path-based stores', () => {
      expect(
        buildStorefrontEntityId('https://usebaci.com/store-a/', 'online-store')
      ).toBe('https://usebaci.com/store-a/#online-store');
      expect(
        buildStorefrontEntityId('https://usebaci.com/store-a', 'online-store')
      ).toBe('https://usebaci.com/store-a/#online-store');
    });

    it('normalizes fragments by stripping leading hash characters', () => {
      expect(
        buildStorefrontEntityId('https://ogabassey.com', '#online-store')
      ).toBe('https://ogabassey.com/#online-store');
      expect(
        buildStorefrontEntityId('https://ogabassey.com', '###online-store')
      ).toBe('https://ogabassey.com/#online-store');
    });
  });
});
