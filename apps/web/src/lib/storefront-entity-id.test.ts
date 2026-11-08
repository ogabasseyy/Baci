import { describe, expect, it } from 'vitest';
import {
  buildCollectionPageEntityIdentity,
  buildOfferSellerEntity,
  buildProductSchemaEntityIdentity,
  buildStorefrontEntityId,
  normalizeStorefrontBaseUrl,
  tryParseUrl,
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

  describe('tryParseUrl and entity schema helpers', () => {
    it('parses valid HTTP/HTTPS URLs and rejects invalid or empty inputs', () => {
      expect(tryParseUrl('https://ogabassey.com')?.toString()).toBe(
        'https://ogabassey.com/'
      );
      expect(tryParseUrl('')).toBeUndefined();
      expect(tryParseUrl('javascript:alert(1)')).toBeUndefined();
      expect(tryParseUrl('not a url')).toBeUndefined();
    });

    it('builds product and collection entity identities and tenant-scoped seller objects', () => {
      expect(
        buildProductSchemaEntityIdentity(
          tryParseUrl('https://ogabassey.com/smartphones/iphone-16/')
        )
      ).toEqual({
        '@id': 'https://ogabassey.com/smartphones/iphone-16#product',
        url: 'https://ogabassey.com/smartphones/iphone-16/',
      });
      expect(buildProductSchemaEntityIdentity(undefined)).toEqual({});

      expect(
        buildCollectionPageEntityIdentity('https://ogabassey.com/smartphones/')
      ).toEqual({
        '@id': 'https://ogabassey.com/smartphones#collection',
        url: 'https://ogabassey.com/smartphones/',
      });
      expect(buildCollectionPageEntityIdentity('')).toEqual({});

      expect(
        buildOfferSellerEntity('Ogabassey', 'https://ogabassey.com/')
      ).toEqual({
        '@type': 'Organization',
        '@id': 'https://ogabassey.com/#online-store',
        name: 'Ogabassey',
      });
      expect(buildOfferSellerEntity('Ogabassey')).toEqual({
        '@type': 'Organization',
        name: 'Ogabassey',
      });
    });
  });
});
