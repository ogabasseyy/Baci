import { describe, expect, it, vi } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import { buildGoogleVariantFeedItems } from './build-google-variant-feed-items';
import type {
  FeedProduct,
  FeedVariant,
  GoogleMerchantListing,
} from './feed-types';

const baseProduct: FeedProduct = {
  id: 'family-1',
  name: 'Phone Pro',
  slug: 'phone-pro',
  description: 'Flagship phone',
  condition: 'new',
  price: 1000,
  stock: 2,
  manage_stock: true,
  variant_model: 'sku_matrix',
};

const manifest: FeedImageManifestEntry[] = [
  {
    verified_url: 'https://cdn.example.com/phone-used.jpg',
    status: 'verified',
    verified_format: 'jpeg',
    is_primary: true,
    position: 0,
    variant_id: 'variant-used',
  },
];

const variants: FeedVariant[] = [
  {
    id: 'variant-no-image',
    condition: 'new',
    attributes: { color: 'Silver' },
    price_override: 1100,
    stock_quantity: 3,
  },
  {
    id: 'variant-used',
    condition: 'used',
    attributes: { color: 'Black' },
    price_override: 900,
    stock_quantity: 2,
  },
];

describe('buildGoogleVariantFeedItems', () => {
  it('renders only the winning renderable SKU and collects that single listing in familyRow mode', () => {
    const collected: GoogleMerchantListing[] = [];
    const xml = buildGoogleVariantFeedItems({
      product: baseProduct,
      variants,
      manifest,
      productUrl: 'https://ogabassey.com/products/phone-pro',
      currency: 'NGN',
      brand: 'Ogabassey',
      familyRow: true,
      collectListing: (row) => collected.push(row),
    });

    expect(xml).toContain('<g:id>family-1</g:id>');
    expect(xml).not.toContain('variant-no-image');
    expect(collected).toHaveLength(1);
    expect(collected[0].variant?.id).toBe('variant-used');
  });

  it('returns empty string and emits no listing when no family variant is renderable', () => {
    const collectListing = vi.fn();
    const xml = buildGoogleVariantFeedItems({
      product: baseProduct,
      variants: [variants[0]],
      manifest,
      productUrl: 'https://ogabassey.com/products/phone-pro',
      currency: 'NGN',
      brand: 'Ogabassey',
      familyRow: true,
      collectListing,
    });

    expect(xml).toBe('');
    expect(collectListing).not.toHaveBeenCalled();
  });

  it('passes through all renderable variants when familyRow is false', () => {
    const xml = buildGoogleVariantFeedItems({
      product: baseProduct,
      variants,
      manifest,
      productUrl: 'https://ogabassey.com/products/phone-pro',
      currency: 'NGN',
      brand: 'Ogabassey',
      familyRow: false,
    });

    expect(xml).toContain('variant-used');
  });
});
