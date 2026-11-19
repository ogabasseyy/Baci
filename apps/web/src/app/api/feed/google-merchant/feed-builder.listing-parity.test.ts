import { describe, expect, it } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import { collectGoogleMerchantListings } from './collect-google-merchant-listings';
import { generateGoogleMerchantFeed } from './feed-builder';
import type { FeedMerchant, FeedProduct, ImageManifestMap } from './feed-types';

const merchant: FeedMerchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  slug: 'ogabassey',
  payout_currency: 'NGN',
};
const baseUrl = 'https://ogabassey.com';
const imageUrl = 'https://cdn.example.com/product.jpg';
const image: FeedImageManifestEntry = {
  verified_url: imageUrl,
  status: 'verified',
  verified_format: 'jpeg',
  is_primary: true,
  position: 0,
};
const baseProduct: FeedProduct = {
  id: 'product-1',
  name: 'Test Phone',
  slug: 'test-phone',
  description: 'Synthetic test product',
  condition: 'new',
  price: 100,
  stock: 3,
  manage_stock: true,
};
const family: FeedProduct = {
  ...baseProduct,
  id: 'family-1',
  variant_model: 'sku_matrix',
  variants: [
    {
      id: 'variant-no-image',
      condition: 'used',
      attributes: { color: 'Yellow' },
      price_override: 90,
      stock_quantity: 4,
    },
    {
      id: 'variant-1',
      condition: 'open_box',
      attributes: { color: 'Black' },
      price_override: 95,
      compare_at_price: 110,
      stock_quantity: 2,
    },
  ],
};
const manifest: ImageManifestMap = {
  [baseProduct.id]: [image],
  [family.id]: [{ ...image, variant_id: 'variant-1' }],
};

function googleIds(products: FeedProduct[], settings: FeedMerchant) {
  return Array.from(
    generateGoogleMerchantFeed(products, settings, baseUrl, manifest).matchAll(
      /<g:id>([^<]+)<\/g:id>/g
    ),
    ([, id]) => id
  );
}

describe('collectGoogleMerchantListings', () => {
  it('captures only Google-emitted base, grouped, offer and SKU listing IDs', () => {
    const offer = { id: 'offer-1', condition: 'uk_used', price: 80 } as const;
    const groupedProduct: FeedProduct = {
      ...baseProduct,
      offers: [
        offer,
        {
          id: 'offer-no-image',
          condition: 'open_box',
          price: 86,
          images: ['https://cdn.example.com/unverified.jpg'],
        },
      ],
    };
    expect(
      collectGoogleMerchantListings(
        [baseProduct],
        merchant,
        baseUrl,
        manifest
      ).map(({ id }) => id)
    ).toEqual(['product-1']);

    const products = [groupedProduct, family];
    const listings = collectGoogleMerchantListings(
      products,
      merchant,
      baseUrl,
      manifest
    );
    expect(listings.map(({ id }) => id)).toEqual(googleIds(products, merchant));
    expect(listings).toMatchObject([
      { id: 'product-1-new', product: groupedProduct, price: 100, imageUrl },
      { id: 'offer-1', product: groupedProduct, price: 80, offer, imageUrl },
      {
        id: 'variant-1',
        product: family,
        variant: { id: 'variant-1', condition: 'open_box' },
        price: 95,
        stock: 2,
        imageUrl,
      },
    ]);
    expect(new URL(listings[1].url).searchParams.get('condition')).toBe('used');
    expect(new URL(listings[2].url).searchParams.get('variantId')).toBe(
      'variant-1'
    );
  });

  it('uses the family ID and binds it to only the selected renderable variant', () => {
    const settings = { ...merchant, gmc_variants_enabled: false };
    const products = [family];
    const listings = collectGoogleMerchantListings(
      products,
      settings,
      baseUrl,
      manifest
    );
    expect(listings.map(({ id }) => id)).toEqual(googleIds(products, settings));
    expect(listings).toMatchObject([
      { id: 'family-1', variant: { id: 'variant-1' }, price: 95 },
    ]);
  });
});
