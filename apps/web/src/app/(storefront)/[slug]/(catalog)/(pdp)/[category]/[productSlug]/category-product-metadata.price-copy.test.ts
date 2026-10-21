import { describe, expect, it } from 'vitest';
import { buildCategoryProductMetadata } from './category-product-metadata';

type Input = Parameters<typeof buildCategoryProductMetadata>[0];

function input(product: Partial<Input['product']>): Input {
  return {
    baseUrl: 'https://ogabassey.com',
    storeSlug: 'ogabassey',
    merchant: {
      business_name: 'Ogabassey',
      country: 'NG',
      slug: 'ogabassey',
      is_published: true,
    } as Input['merchant'],
    product: {
      id: 'iphone-13-product',
      brand: 'Apple',
      gtin: '',
      mpn: '',
      image: '',
      imageHint: '',
      imageLarge: '',
      stock: 0,
      name: 'iPhone 13',
      slug: 'iphone-13',
      description:
        'An A15 Bionic iPhone with a 6.1-inch OLED display and dual rear cameras.',
      price: 390_500,
      min_variant_price: 390_500,
      max_variant_price: 500_000,
      manage_stock: false,
      has_variants: true,
      status: 'active',
      category: 'Smartphones',
      categories: { name: 'Smartphones', slug: 'smartphones' },
      ...product,
    },
  };
}

describe('categorized PDP search copy uses current price data', () => {
  it('does not let the imported iPhone 13 boilerplate hide the current price range', () => {
    const metadata = buildCategoryProductMetadata(
      input({
        meta_description:
          'Buy iPhone 13 in Nigeria from Ogabassey. Confirm specs, condition, variants and availability.',
      })
    );

    expect(metadata.description).toContain('₦390,500');
    expect(metadata.description).not.toContain(
      'Confirm specs, condition, variants and availability'
    );
    expect(metadata.openGraph?.description).toBe(metadata.description);
    expect(metadata.twitter?.description).toBe(metadata.description);
  });

  it('replaces the stale iPhone 14 Pro Max price claims instead of rebinding them to the wrong SKU', () => {
    const metadata = buildCategoryProductMetadata(
      input({
        name: 'iPhone 14 Pro Max',
        slug: 'iphone-14-pro-max',
        price: 820_000,
        min_variant_price: 820_000,
        max_variant_price: 1_500_000,
        meta_title: 'iPhone 14 Pro Max Price – From ₦875,000',
        meta_description:
          'Used iPhone 14 Pro Max 256GB physical SIM + eSIM starts at ₦875,000. Open-box options start at ₦1,000,000. Compare storage and SIM types.',
      })
    );

    expect(metadata.title).toEqual({
      absolute: 'iPhone 14 Pro Max Price in Nigeria | Ogabassey',
    });
    expect(metadata.description).toContain('₦820,000');
    expect(metadata.description).not.toMatch(
      /875,000|1,000,000|256GB physical SIM/
    );
    expect(metadata.openGraph?.description).toBe(metadata.description);
  });

  it('preserves useful merchant-authored descriptions without fixed price claims', () => {
    const description =
      'Compare iPhone 13 storage and condition options, A15 Bionic performance and its 6.1-inch OLED display before choosing your device.';
    const metadata = buildCategoryProductMetadata(
      input({ meta_description: description })
    );

    expect(metadata.description).toBe(description);
  });

  it('does not advertise an old price when all managed variants are unavailable', () => {
    const metadata = buildCategoryProductMetadata(
      input({
        manage_stock: true,
        stock_quantity: 0,
        min_variant_price: undefined,
        max_variant_price: undefined,
        variants: [
          {
            id: 'iphone-13-variant',
            product_id: 'iphone-13-product',
            merchant_id: 'ogabassey-merchant',
            attributes: { storage: '128GB' },
            price_override: 390_500,
            stock_quantity: 0,
          },
        ],
        description:
          'Buy this iPhone 13 for ₦350,000. A15 Bionic and 128GB storage.',
        meta_title: 'iPhone 13 Price – From ₦350,000',
        meta_description:
          'Buy iPhone 13 from ₦350,000. Confirm selected storage and condition.',
      })
    );

    expect(metadata.title).toEqual({
      absolute: 'iPhone 13 Price in Nigeria | Ogabassey',
    });
    expect(metadata.description).not.toMatch(/350,000|390,500/);
  });

  it('preserves a gift-card denomination that is part of the product identity', () => {
    const metadata = buildCategoryProductMetadata(
      input({
        name: 'PSN Gift Card £50 GBP',
        slug: 'psn-gift-card-50-gbp',
        meta_title: 'PSN Gift Card £50 GBP Price in Nigeria',
        meta_description:
          'PSN Gift Card £50 GBP for a UK PlayStation account. Compare the current price and confirm your account region before checkout.',
      })
    );

    expect(metadata.title).toEqual({
      absolute: 'PSN Gift Card £50 GBP Price in Nigeria | Ogabassey',
    });
    expect(metadata.description).toContain('UK PlayStation account');
  });
});
