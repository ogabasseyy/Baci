import { describe, expect, it } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import {
  type FeedMerchant,
  type FeedProduct,
  generateGoogleMerchantFeed,
} from './feed-builder';

// ---------- helpers ----------
function product(overrides: Partial<FeedProduct> = {}): FeedProduct {
  return {
    id: 'prod-1',
    name: 'Test Product',
    description: 'A test product',
    slug: 'test-product',
    price: 100,
    stock: 10,
    manage_stock: true,
    condition: 'new',
    ...overrides,
  };
}

function merchant(overrides: Partial<FeedMerchant> = {}): FeedMerchant {
  return {
    id: 'merchant-1',
    business_name: 'Test Store',
    slug: 'test-store',
    payout_currency: 'NGN',
    ...overrides,
  };
}

function manifestEntry(
  overrides: Partial<FeedImageManifestEntry> = {}
): FeedImageManifestEntry {
  return {
    verified_url: 'https://cdn.example.com/products/test.jpg',
    verified_format: 'jpeg',
    status: 'verified',
    is_primary: true,
    position: 0,
    ...overrides,
  };
}

const BASE_URL = 'https://ogabassey.com';

describe('generateGoogleMerchantFeed identifiers', () => {
  it('omits whitespace-only parent GTIN/MPN from simple-product rows', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product({ gtin: '   ', mpn: '\t ', brand: 'Samsung' })],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).not.toContain('<g:gtin>');
    expect(xml).not.toContain('<g:mpn>');
    expect(xml).not.toContain('<g:identifier_exists>yes</g:identifier_exists>');
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
  });

  it('trims padded parent GTIN/MPN in simple-product rows', () => {
    const imageManifest: Record<string, FeedImageManifestEntry[]> = {
      'prod-1': [manifestEntry({ is_primary: true })],
    };
    const xml = generateGoogleMerchantFeed(
      [product({ gtin: '  0123456789012  ', mpn: '  MPN-123  ' })],
      merchant(),
      BASE_URL,
      imageManifest
    );
    expect(xml).toContain('<g:gtin>0123456789012</g:gtin>');
    expect(xml).toContain('<g:mpn>MPN-123</g:mpn>');
    expect(xml).toContain('<g:identifier_exists>yes</g:identifier_exists>');
  });
});
