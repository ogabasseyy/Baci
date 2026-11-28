import { describe, expect, it } from 'vitest';
import type { CachedMerchant } from '@/lib/cached-data';
import { mockMerchant } from '@/lib/cached-data.test-utils';
import { buildStorefrontMerchantMetadata } from './build-storefront-merchant-metadata';

const merchant: CachedMerchant = {
  ...mockMerchant,
  business_name: 'Ogabassey',
  site_title: 'Ogabassey | Gadgets in Nigeria',
  slug: 'ogabassey',
  logo_url: 'https://cdn.example.com/logo.png',
  favicon_svg_url: undefined,
  favicon_png_32_url: undefined,
  favicon_apple_touch_url: undefined,
  feature_settings: { google_site_verification: 'verify-123' },
  published_config: null,
  country: 'NG',
  is_published: true,
};

describe('buildStorefrontMerchantMetadata', () => {
  it('brands relative child titles with the merchant instead of the platform', () => {
    const metadata = buildStorefrontMerchantMetadata(merchant, 'ogabassey');

    expect(metadata.title).toEqual({
      absolute: 'Ogabassey | Gadgets in Nigeria',
      template: '%s | Ogabassey',
    });
  });

  it('falls back to the business name when no site title is authored', () => {
    const metadata = buildStorefrontMerchantMetadata(
      { ...merchant, site_title: '' },
      'ogabassey'
    );

    expect(metadata.title).toEqual({
      absolute: 'Ogabassey',
      template: '%s | Ogabassey',
    });
  });

  it('preserves the AdSense ownership meta on Ogabassey while isolating third-party stores', () => {
    const ogabasseyMetadata = buildStorefrontMerchantMetadata(
      merchant,
      'ogabassey'
    );

    expect(ogabasseyMetadata.alternates).toBeNull();
    expect(ogabasseyMetadata.manifest).toBeNull();
    expect(ogabasseyMetadata.applicationName).toBe('Ogabassey');
    expect(ogabasseyMetadata.verification).toEqual({
      google: 'verify-123',
      other: {
        'google-adsense-account': 'ca-pub-9332275663101466',
      },
    });
    expect(ogabasseyMetadata.icons).toEqual({
      icon: [{ url: 'https://cdn.example.com/logo.png' }],
      apple: [{ url: 'https://cdn.example.com/logo.png' }],
    });

    const thirdPartyMetadata = buildStorefrontMerchantMetadata(
      { ...merchant, business_name: 'Other Store', slug: 'other-store' },
      'other-store'
    );
    expect(thirdPartyMetadata.verification).toEqual({ google: 'verify-123' });
  });
});
