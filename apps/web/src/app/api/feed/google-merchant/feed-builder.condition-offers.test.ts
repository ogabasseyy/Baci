import { describe, expect, it } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import {
  type FeedMerchant,
  type FeedProduct,
  generateGoogleMerchantFeed,
} from './feed-builder';

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

function extractItemXml(xml: string, id: string) {
  const items = xml.match(/ {4}<item>\n[\s\S]*?\n {4}<\/item>/g) ?? [];
  const item = items.find((candidate) =>
    candidate.includes(`<g:id>${id}</g:id>`)
  );

  return item ?? '';
}

const defaultManifest: Record<string, FeedImageManifestEntry[]> = {
  'prod-1': [manifestEntry({ is_primary: true })],
};

describe('generateGoogleMerchantFeed — condition offers', () => {
  it('excludes offers that duplicate the parent condition', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          condition: 'new',
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-same',
              condition: 'new',
              price: 90000,
              stock_quantity: 3,
            },
          ],
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    // The storefront never selects a same-condition offer, so no row.
    expect(xml).not.toContain('<g:id>offer-same</g:id>');
    const itemCount = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(1);
  });

  it('ineligible offers cannot claim the base primary image', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-zero',
              condition: 'used',
              price: 0,
              stock_quantity: 1,
              images: ['https://cdn.example.com/products/test.jpg'],
            },
          ],
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    // Zero-price offers render no row and claim no imagery: the base
    // product survives with its verified primary.
    expect(xml).not.toContain('<g:id>offer-zero</g:id>');
    expect(xml).toContain('<g:id>prod-1</g:id>');
    expect(xml).toContain(
      '<g:image_link>https://cdn.example.com/products/test.jpg</g:image_link>'
    );
  });

  it('defaults a null parent condition to new for base and eligibility', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          condition: null,
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-new',
              condition: 'new',
              price: 90000,
              stock_quantity: 3,
            },
            {
              id: 'offer-used',
              condition: 'used',
              price: 80000,
              stock_quantity: 2,
            },
          ],
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    // Base row emits as new; the duplicate-condition new offer does not.
    expect(xml).toContain('<g:condition>new</g:condition>');
    expect(xml).not.toContain('<g:id>offer-new</g:id>');
    expect(xml).toContain('<g:id>offer-used</g:id>');
  });

  it('retains the valid offer row when the parent price is not positive', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 0,
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-1',
              condition: 'used',
              price: 710000,
              stock_quantity: 9999,
            },
          ],
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    // No base row (parent price invalid), but the eligible offer emits.
    expect(xml).toContain('<g:id>offer-1</g:id>');
    expect(xml).not.toContain('<g:id>prod-1</g:id>');
    const itemCount = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(1);
  });

  it('base item carries the family group id when offers are emitted', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-1',
              condition: 'used',
              price: 710000,
              stock_quantity: 9999,
            },
          ],
        }),
      ],
      merchant(),
      BASE_URL,
      defaultManifest
    );
    const baseItem = extractItemXml(xml, 'prod-1');
    expect(baseItem).toContain('<g:item_group_id>prod-1</g:item_group_id>');
  });
});
