import { describe, expect, it } from 'vitest';
import {
  buildEligibleHubDestinationsManifest,
  resolveEligibleCategoryHubDestinations,
  validateEligibleDestinationHref,
} from './eligible-hub-destinations';

describe('eligible-hub-destinations', () => {
  const merchantId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const merchantSlug = 'ogabassey';
  const canonicalHost = 'https://ogabassey.com';

  describe('resolveEligibleCategoryHubDestinations', () => {
    it('resolves both brand and family hubs when parent brand meets 5-product minimum and family meets 3-product minimum', () => {
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: 10 },
        { name: 'iPhone 15 Pro', brand: 'Apple', stock: 5 },
        { name: 'iPhone 15', brand: 'Apple', stock: 3 },
        { name: 'iPhone 14', brand: 'Apple', stock: 2 },
        { name: 'iPhone 13', brand: 'Apple', stock: 1 },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        products,
      });

      expect(result.brandHubs).toHaveLength(1);
      expect(result.brandHubs[0]?.href).toBe(
        'https://ogabassey.com/smartphones/brands/apple'
      );
      expect(result.brandHubs[0]?.brand_key).toBe('apple');

      expect(result.familyHubs).toHaveLength(1);
      expect(result.familyHubs[0]?.href).toBe(
        'https://ogabassey.com/smartphones/brands/apple/families/iphone-15'
      );
      expect(result.familyHubs[0]?.family_key).toBe('iphone-15');
    });

    it('enforces parent-brand gating: excludes family hub even if family meets minimum when parent brand has < 5 products', () => {
      // 4 iPhone 15 products - family threshold (3) is met, but parent brand Apple threshold (5) is NOT met
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: 10 },
        { name: 'iPhone 15 Pro', brand: 'Apple', stock: 5 },
        { name: 'iPhone 15 Plus', brand: 'Apple', stock: 3 },
        { name: 'iPhone 15', brand: 'Apple', stock: 1 },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        products,
      });

      // Apple brand hub not eligible (4 < 5)
      expect(result.brandHubs).toHaveLength(0);
      // Gated by parent brand: family hub must NOT be included!
      expect(result.familyHubs).toHaveLength(0);
    });

    it('excludes model family hub when parent brand is eligible but family has < 3 products', () => {
      // 5 Apple products (meets 5 threshold), but only 2 iPhone 15 products (threshold is 3)
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: 10 },
        { name: 'iPhone 15', brand: 'Apple', stock: 5 },
        { name: 'iPhone 14 Pro', brand: 'Apple', stock: 4 },
        { name: 'iPhone 13', brand: 'Apple', stock: 3 },
        { name: 'iPhone 12', brand: 'Apple', stock: 2 },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        products,
      });

      expect(result.brandHubs).toHaveLength(1);
      expect(result.brandHubs[0]?.brand_key).toBe('apple');
      // iPhone 15 only has 2 products in stock (needs 3), so familyHubs is empty
      expect(result.familyHubs).toHaveLength(0);
    });

    it('filters out products that are out of stock (stock: 0)', () => {
      // 5 Apple products listed, but 2 are out of stock (stock: 0)
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: 10 },
        { name: 'iPhone 15 Pro', brand: 'Apple', stock: 0 },
        { name: 'iPhone 15', brand: 'Apple', stock: 0 },
        { name: 'iPhone 14', brand: 'Apple', stock: 5 },
        { name: 'iPhone 13', brand: 'Apple', stock: 2 },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        storeUrl: 'https://ogabassey.com',
        categorySlug: 'smartphones',
        products,
      });

      // In-stock products = 3, so Apple is not eligible (< 5)
      expect(result.brandHubs).toHaveLength(0);
      expect(result.familyHubs).toHaveLength(0);
    });

    it('treats stock: null as available in stock', () => {
      const products = [
        { name: 'iPhone 15 Pro Max', brand: 'Apple', stock: null },
        { name: 'iPhone 15 Pro', brand: 'Apple', stock: null },
        { name: 'iPhone 15', brand: 'Apple', stock: null },
        { name: 'iPhone 14', brand: 'Apple', stock: null },
        { name: 'iPhone 13', brand: 'Apple', stock: null },
      ];

      const result = resolveEligibleCategoryHubDestinations({
        categorySlug: 'smartphones',
        products,
      });

      expect(result.brandHubs).toHaveLength(1);
      expect(result.brandHubs[0]?.href).toBe('/smartphones/brands/apple');
      expect(result.familyHubs).toHaveLength(1);
      expect(result.familyHubs[0]?.href).toBe(
        '/smartphones/brands/apple/families/iphone-15'
      );
    });
  });

  describe('buildEligibleHubDestinationsManifest', () => {
    it('creates a validated manifest conforming to the versioned contract', () => {
      const manifest = buildEligibleHubDestinationsManifest({
        merchantId,
        merchantSlug,
        canonicalHost,
        taxonomyVersion: '2026-10-25',
        ttlSeconds: 3600,
        destinations: {
          brand_hubs: [
            {
              href: 'https://ogabassey.com/smartphones/brands/apple',
              label: 'Explore Apple iPhone',
              brand_key: 'apple',
              category_slug: 'smartphones',
            },
          ],
          family_hubs: [
            {
              href: 'https://ogabassey.com/smartphones/brands/apple/families/iphone-15',
              label: 'Explore iPhone 15 Series',
              brand_key: 'apple',
              family_key: 'iphone-15',
              category_slug: 'smartphones',
            },
          ],
        },
      });

      expect(manifest.schema_version).toBe(1);
      expect(manifest.taxonomy_version).toBe('2026-10-25');
      expect(manifest.merchant_id).toBe(merchantId);
      expect(manifest.merchant_slug).toBe(merchantSlug);
      expect(manifest.canonical_host).toBe(canonicalHost);
      expect(manifest.destinations.brand_hubs).toHaveLength(1);
      expect(manifest.destinations.family_hubs).toHaveLength(1);
      expect(manifest.destinations.compare_hubs).toEqual([]);
      expect(manifest.destinations.price_band_hubs).toEqual([]);
    });

    it('rejects invalid inputs when building manifest', () => {
      expect(() =>
        buildEligibleHubDestinationsManifest({
          merchantId: 'not-a-uuid',
          merchantSlug: '',
          canonicalHost: 'not-a-url',
        })
      ).toThrow();
    });
  });

  describe('validateEligibleDestinationHref', () => {
    const baseManifest = buildEligibleHubDestinationsManifest({
      merchantId,
      merchantSlug,
      canonicalHost,
      generatedAt: '2026-10-25T10:00:00.000Z',
      expiresAt: '2026-10-26T10:00:00.000Z',
      destinations: {
        brand_hubs: [
          {
            href: 'https://ogabassey.com/smartphones/brands/apple',
            label: 'Explore Apple iPhone',
          },
        ],
        family_hubs: [
          {
            href: 'https://ogabassey.com/smartphones/brands/apple/families/iphone-15',
            label: 'Explore iPhone 15 Series',
          },
        ],
      },
    });

    it('validates matching brand and family hub destinations', () => {
      const now = new Date('2026-10-25T12:00:00.000Z');

      expect(
        validateEligibleDestinationHref(
          baseManifest,
          'https://ogabassey.com/smartphones/brands/apple',
          now
        )
      ).toBe(true);

      // Matches relative path
      expect(
        validateEligibleDestinationHref(
          baseManifest,
          '/smartphones/brands/apple',
          now
        )
      ).toBe(true);

      // Matches family hub
      expect(
        validateEligibleDestinationHref(
          baseManifest,
          '/smartphones/brands/apple/families/iphone-15',
          now
        )
      ).toBe(true);
    });

    it('fails closed when manifest is expired (now > expires_at)', () => {
      const expiredNow = new Date('2026-10-27T00:00:00.000Z');

      expect(
        validateEligibleDestinationHref(
          baseManifest,
          'https://ogabassey.com/smartphones/brands/apple',
          expiredNow
        )
      ).toBe(false);
    });

    it('fails closed when manifest is invalid', () => {
      const invalidManifest = {
        ...baseManifest,
        schema_version: 2, // invalid schema version
      };

      expect(
        validateEligibleDestinationHref(
          invalidManifest,
          'https://ogabassey.com/smartphones/brands/apple'
        )
      ).toBe(false);
    });

    it('returns false when href is not in eligible hubs', () => {
      const now = new Date('2026-10-25T12:00:00.000Z');

      expect(
        validateEligibleDestinationHref(
          baseManifest,
          '/smartphones/brands/samsung',
          now
        )
      ).toBe(false);
      expect(
        validateEligibleDestinationHref(
          baseManifest,
          '/smartphones/brands/apple/families/iphone-16',
          now
        )
      ).toBe(false);
    });

    it('fails closed when absolute href origin does not match canonical_host', () => {
      const now = new Date('2026-10-25T12:00:00.000Z');

      expect(
        validateEligibleDestinationHref(
          baseManifest,
          'https://usebaci.com/smartphones/brands/apple',
          now
        )
      ).toBe(false);
    });
  });
});
