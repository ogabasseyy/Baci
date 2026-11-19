import { describe, expect, it, vi } from 'vitest';
import * as xmlUtils from '@/lib/xml-utils';
import { collectGoogleMerchantListings } from './collect-google-merchant-listings';
import type { FeedMerchant, FeedProduct, ImageManifestMap } from './feed-types';

const merchant: FeedMerchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  payout_currency: 'NGN',
  gmc_variants_enabled: true,
};

const manifest: ImageManifestMap = {
  'prod-valid': [
    {
      verified_url: 'https://cdn.example.com/valid.jpg',
      status: 'verified',
      verified_format: 'jpeg',
      is_primary: true,
      position: 0,
    },
  ],
};

describe('collectGoogleMerchantListings', () => {
  it('returns only products eligible for Google Merchant feed emission', () => {
    const products: FeedProduct[] = [
      {
        id: 'prod-valid',
        name: 'Valid Phone',
        slug: 'valid-phone',
        description: 'Has verified image',
        condition: 'new',
        price: 50000,
        stock: 3,
        manage_stock: true,
      },
      {
        id: 'prod-no-image',
        name: 'Missing Image Phone',
        slug: 'missing-image',
        description: 'Should be skipped without verified image',
        condition: 'new',
        price: 50000,
        stock: 3,
        manage_stock: true,
      },
    ];

    const escapeXml = vi.spyOn(xmlUtils, 'escapeXml');
    try {
      const listings = collectGoogleMerchantListings(
        products,
        merchant,
        'https://ogabassey.com',
        manifest
      );

      expect(listings).toHaveLength(1);
      expect(listings[0].product.id).toBe('prod-valid');
      expect(escapeXml).not.toHaveBeenCalled();
    } finally {
      escapeXml.mockRestore();
    }
  });
});
