import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { makeSeoProduct } from '@/lib/seo-utils-product-schema-test-helper';
import { toOgabasseyProduct } from './ogabassey-product';

const ghanaianCurrency = resolveMerchantCurrencyConfig({
  country: 'GH',
  payout_currency: 'GHS',
});

describe('toOgabasseyProduct', () => {
  it('formats display prices in merchant currency while preserving numeric prices', () => {
    const result = toOgabasseyProduct(
      makeSeoProduct({ price: 999 }),
      ghanaianCurrency
    );

    expect(result.price).toBe('GH₵999');
    expect(result.rawPrice).toBe(999);
  });

  it.each([
    {
      label: 'legacy object-map attributes',
      variantAttributes: {
        Platform: ['EU', 'US'],
        RAM: ['8GB', '16GB'],
        Storage: ['128GB', '256GB'],
      },
      expectedAttributes: {
        platform: ['EU', 'US'],
        ram: ['8GB', '16GB'],
        storage: ['128GB', '256GB'],
      },
    },
    {
      label: 'array attributes',
      variantAttributes: [
        { param: 'Platform', options: ['EU', 'US'] },
        { param: 'RAM', options: ['8GB', '16GB'] },
        { param: 'Storage', options: ['128GB', '256GB'] },
      ],
      expectedAttributes: {
        platform: ['EU', 'US'],
        ram: ['8GB', '16GB'],
        storage: ['128GB', '256GB'],
      },
    },
  ])('normalizes $label into selector options and axes', ({
    variantAttributes,
    expectedAttributes,
  }) => {
    const product = Object.assign(makeSeoProduct({ storage_options: [] }), {
      variant_attributes: variantAttributes,
    }) as Product;

    const result = toOgabasseyProduct(product, ghanaianCurrency);

    expect(result.variant_attributes).toEqual(expectedAttributes);
    expect(result.storage).toEqual(['128GB', '256GB']);
    expect(result.attributeAxes).toEqual(['storage', 'ram', 'platform']);
  });

  it('preserves product stock and maps variant images, stock, and condition', () => {
    const productImage = 'https://cdn.example.com/product-main.webp';
    const galleryImage = 'https://cdn.example.com/product-gallery.webp';
    const variantImage = 'https://cdn.example.com/variant-main.webp';
    const variantGalleryImage = 'https://cdn.example.com/variant-gallery.webp';
    const product = makeSeoProduct({
      condition: 'used',
      image: 'https://cdn.example.com/product-fallback.webp',
      imageLarge: productImage,
      images: [
        {
          alt: 'Product gallery',
          order: 0,
          url: galleryImage,
        },
      ],
      manage_stock: false,
      stock: 0,
      variants: [
        {
          id: 'used-128',
          product_id: 'test-123',
          merchant_id: 'merchant-123',
          attributes: { ram: '8GB', storage: '128GB' },
          condition: 'open_box',
          images: [variantGalleryImage],
          primary_image: variantImage,
          price_override: 700,
          stock_quantity: 0,
        },
      ],
    });

    const result = toOgabasseyProduct(product, ghanaianCurrency);

    expect(result).toMatchObject({
      condition: 'used',
      image: productImage,
      images: [galleryImage],
      manage_stock: false,
      stock: 0,
      variants: [
        {
          condition: 'open_box',
          images: [variantGalleryImage],
          name: '128GB 8GB',
          primary_image: variantImage,
          stock: 0,
          stock_quantity: 0,
        },
      ],
    });
  });

  it('formats condition offers and keeps their raw prices and stock', () => {
    const product = makeSeoProduct({
      has_condition_offers: true,
      offers: [
        {
          id: 'used-offer',
          condition: 'used',
          price: 800,
          stock_quantity: 0,
          images: ['https://cdn.example.com/used.webp'],
        },
      ],
    });

    const result = toOgabasseyProduct(product, ghanaianCurrency);

    expect(result.has_condition_offers).toBe(true);
    expect(result.offers).toEqual([
      {
        condition: 'used',
        id: 'used-offer',
        images: ['https://cdn.example.com/used.webp'],
        price: 'GH₵800',
        rawPrice: 800,
        stock: 0,
      },
    ]);
  });
});
