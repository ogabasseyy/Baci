import { describe, expect, it } from 'vitest';
import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import {
  type FeedMerchant,
  type FeedProduct,
  generateGoogleMerchantFeed,
} from './feed-builder';

// Grouped offer-driven scenarios moved out of feed-builder.test.ts so the
// PR 3461 changes live in a focused module under the 300-line cap.
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

function extractItemXml(xml: string, id: string) {
  const items = xml.match(/ {4}<item>\n[\s\S]*?\n {4}<\/item>/g) ?? [];
  const item = items.find((candidate) =>
    candidate.includes(`<g:id>${id}</g:id>`)
  );

  return item ?? '';
}

// ---------- image_link guarantees ----------

describe('generateGoogleMerchantFeed — grouped offers', () => {
  const defaultManifest: Record<string, FeedImageManifestEntry[]> = {
    'prod-1': [manifestEntry({ is_primary: true })],
  };

  it('emits both base item and offer item for products with offers', () => {
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
    // Grouped base item uses a qualified id distinct from the group
    expect(xml).toContain('<g:id>prod-1-new</g:id>');
    // Offer item uses offer id
    expect(xml).toContain('<g:id>offer-1</g:id>');
    // Two <item> blocks total
    const itemCount = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(2);
  });

  it('emits structured product_detail fields for variant-level specs', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          color: 'Black',
          price: 700000,
          product_key_specs: {
            screen_size_inches: 6.8,
            display_resolution: '3200 x 1440 (QHD+)',
            ram_gb: 12,
            storage_gb: 256,
            main_camera_mp: 108,
            front_camera_mp: 40,
            weight_g: 229,
          },
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-black-512',
              condition: 'used',
              price_override: 650000,
              stock_quantity: 3,
              attributes: {
                color: 'Phantom Black',
                ram: '12GB',
                storage: '512GB',
              },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      { 'prod-1': [manifestEntry({ variant_id: 'variant-black-512' })] }
    );
    const itemXml = extractItemXml(xml, 'variant-black-512');

    expect(itemXml).toContain('<g:color>Phantom Black</g:color>');
    expect(itemXml).toContain('<g:product_detail>');
    expect(itemXml).toContain(
      '<g:attribute_name>Screen resolution</g:attribute_name>'
    );
    expect(itemXml).toContain(
      '<g:attribute_value>3200 x 1440 (QHD+)</g:attribute_value>'
    );
    expect(itemXml).toContain(
      '<g:attribute_name>Storage capacity</g:attribute_name>'
    );
    expect(itemXml).toContain('<g:attribute_value>512GB</g:attribute_value>');
    expect(itemXml).toContain(
      '<g:attribute_name>Front camera resolution</g:attribute_name>'
    );
    expect(itemXml).toContain('<g:attribute_value>40MP</g:attribute_value>');
    expect(itemXml).not.toContain(
      '<g:attribute_value>256GB</g:attribute_value>'
    );
  });

  it('does not substitute an unscoped image for a colour variant', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-green-128',
              condition: 'new',
              price_override: 550000,
              stock_quantity: 4,
              attributes: { color: 'Green', storage: '128GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );
    const itemXml = extractItemXml(xml, 'variant-green-128');

    expect(itemXml).toBe('');
  });

  it('emits sale pricing for conditioned variants when compare_at_price is present', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          compare_at_price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-open-box-sale',
              compare_at_price: 700000,
              condition: 'open_box',
              price_override: 640000,
              stock_quantity: 1,
              attributes: { storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );

    expect(xml).toContain('<g:price>700000.00 NGN</g:price>');
    expect(xml).toContain('<g:sale_price>640000.00 NGN</g:sale_price>');
  });

  it('skips zero-priced conditioned variants without inventing a purchasable family row', () => {
    const xml = generateGoogleMerchantFeed(
      [
        product({
          price: 700000,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: 'variant-zero-priced',
              condition: 'used',
              price_override: 0,
              stock_quantity: 1,
              attributes: { storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: true }),
      BASE_URL,
      defaultManifest
    );

    expect((xml.match(/<item>/g) || []).length).toBe(0);
    expect(xml).not.toContain('<g:id>prod-1</g:id>');
    expect(xml).not.toContain('<g:id>variant-zero-priced</g:id>');
    expect(xml).not.toContain('<g:price>700000.00 NGN</g:price>');
  });

  it('does not apply the sku_matrix fallback to legacy offer-driven products', () => {
    const xml = generateGoogleMerchantFeed(
      [
        // Edge/migration state: both offers and variants exist, but legacy
        // offer-driven emission must still win when variant_model is legacy
        // and gmc_variants_enabled is disabled.
        product({
          has_condition_offers: true,
          offers: [
            {
              id: 'offer-used',
              condition: 'used',
              price: 610000,
              stock_quantity: 2,
            },
          ],
          variant_model: 'legacy',
          variants: [
            {
              id: 'variant-used-256',
              condition: 'used',
              price_override: 610000,
              stock_quantity: 2,
              attributes: { storage: '256GB' },
            },
          ],
        }),
      ],
      merchant({ gmc_variants_enabled: false }),
      BASE_URL,
      defaultManifest
    );

    expect((xml.match(/<item>/g) || []).length).toBe(2);
    expect(xml).toContain('<g:id>prod-1-new</g:id>');
    expect(xml).toContain('<g:id>offer-used</g:id>');
  });
});
