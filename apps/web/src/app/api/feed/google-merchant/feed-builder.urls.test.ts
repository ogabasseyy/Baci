import { describe, expect, it } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import { generateGoogleMerchantFeed } from './feed-builder';

const BASE_URL = 'https://ogabassey.com/';

function manifestEntry(): FeedImageManifestEntry {
  return {
    verified_url: 'https://cdn.example.com/products/test.jpg',
    verified_format: 'jpeg',
    status: 'verified',
    is_primary: true,
    position: 0,
  };
}

describe('generateGoogleMerchantFeed canonical URLs', () => {
  it('uses category-based storefront URLs when category text is present', () => {
    const xml = generateGoogleMerchantFeed(
      [
        {
          id: 'prod-1',
          condition: 'refurbished',
          name: 'iPhone XR',
          description: 'Refurbished iPhone XR',
          slug: 'iphone-xr',
          category: 'Smartphones',
          price: 100,
          stock: 10,
        },
      ],
      {
        id: 'merchant-1',
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        payout_currency: 'NGN',
      },
      BASE_URL,
      {
        'prod-1': [manifestEntry()],
      }
    );

    expect(xml).toContain(
      '<g:link>https://ogabassey.com/smartphones/iphone-xr</g:link>'
    );
    expect(xml).not.toContain(
      '<g:link>https://ogabassey.com/products/iphone-xr</g:link>'
    );
  });

  it('falls back to /products/ paths when category data is absent', () => {
    const xml = generateGoogleMerchantFeed(
      [
        {
          id: 'prod-2',
          condition: 'new',
          name: 'Generic Widget',
          description: 'A widget without category',
          slug: 'generic-widget',
          price: 50,
          stock: 5,
        },
      ],
      {
        id: 'merchant-1',
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        payout_currency: 'NGN',
      },
      BASE_URL,
      {
        'prod-2': [manifestEntry()],
      }
    );

    expect(xml).toContain(
      '<g:link>https://ogabassey.com/products/generic-widget</g:link>'
    );
    expect(xml).not.toContain('<g:link>https://ogabassey.com//');
  });

  it('falls back to the category-derived path when a stored canonical URL is stale', () => {
    const xml = generateGoogleMerchantFeed(
      [
        {
          id: 'prod-3',
          condition: 'new',
          name: 'Nintendo eShop Card',
          description: 'Gift card',
          slug: 'nintendo-e-shop-card',
          category: 'Nintendo Switch',
          canonical_url: '/gift-cards/nintendo-e-shop-card',
          price: 50,
          stock: 5,
        },
      ],
      {
        id: 'merchant-1',
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        payout_currency: 'NGN',
      },
      BASE_URL,
      {
        'prod-3': [manifestEntry()],
      }
    );

    expect(xml).toContain(
      '<g:link>https://ogabassey.com/nintendo-switch/nintendo-e-shop-card</g:link>'
    );
    expect(xml).not.toContain(
      '<g:link>https://ogabassey.com/gift-cards/nintendo-e-shop-card</g:link>'
    );
  });

  it('encodes product URL path segments with the agent feed URL builder', () => {
    const xml = generateGoogleMerchantFeed(
      [
        {
          id: 'prod-4',
          condition: 'new',
          name: 'Watch Pro GPS',
          description: 'Smart watch with GPS',
          slug: 'watch pro + gps',
          category: 'Smart Watches',
          price: 100,
          stock: 5,
        },
      ],
      {
        id: 'merchant-1',
        business_name: 'Ogabassey',
        slug: 'ogabassey',
        payout_currency: 'NGN',
      },
      BASE_URL,
      {
        'prod-4': [manifestEntry()],
      }
    );

    expect(xml).toContain(
      '<g:link>https://ogabassey.com/smart-watches/watch%20pro%20%2B%20gps</g:link>'
    );
  });
});
