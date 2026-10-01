import { describe, expect, it } from 'vitest';
import {
  buildUcpCatalogProductResponse,
  filterActiveUcpCatalogProductRows,
  mapStorefrontProductToUcpCatalogProduct,
  mapUcpCatalogProductRow,
  UCP_CATALOG_LOOKUP_CAPABILITY,
} from './ucp-catalog-adapters';

function expectMappedProduct(
  product: ReturnType<typeof mapUcpCatalogProductRow>
) {
  expect(product).not.toBeNull();
  if (!product) {
    throw new Error('Expected a mapped UCP catalog product');
  }
  return product;
}

describe('ucp catalog adapters', () => {
  it('maps a storefront product into a UCP catalog product', () => {
    const product = mapStorefrontProductToUcpCatalogProduct({
      currency: 'NGN',
      description: 'A flagship phone',
      id: 'product-1',
      image_url: 'https://cdn.example/p.jpg',
      in_stock: true,
      name: 'iPhone 15',
      price: 1_200_000,
      product_url: 'https://ogabassey.com/ogabassey/products/iphone-15',
    });

    expect(product).toMatchObject({
      id: 'product-1',
      title: 'iPhone 15',
      description: { plain: 'A flagship phone' },
      price_range: {
        min: { amount: 1_200_000, currency: 'NGN' },
        max: { amount: 1_200_000, currency: 'NGN' },
      },
      url: 'https://ogabassey.com/ogabassey/products/iphone-15',
      variants: [
        expect.objectContaining({
          id: 'product-1',
          inputs: [{ id: 'product-1', match: 'featured' }],
          price: { amount: 1_200_000, currency: 'NGN' },
          availability: { available: true },
        }),
      ],
    });
  });

  it('maps product rows with storefront URLs, images, and stock semantics', () => {
    const product = mapUcpCatalogProductRow({
      baseUrl: 'https://ogabassey.com',
      currency: 'ngn',
      row: {
        description: 'Laptop',
        id: 'product-2',
        images: [{ url: 'https://cdn.example/laptop.jpg' }],
        manage_stock: true,
        merchant_id: 'merchant-1',
        name: 'MacBook Pro',
        price: '2500000.00',
        slug: 'macbook-pro',
        status: 'active',
        stock: 0,
        stock_quantity: 3,
      },
    });

    expect(expectMappedProduct(product)).toMatchObject({
      id: 'product-2',
      media: [
        {
          alt_text: 'MacBook Pro',
          type: 'image',
          url: 'https://cdn.example/laptop.jpg',
        },
      ],
      price_range: {
        min: { amount: 2_500_000, currency: 'NGN' },
      },
      url: expect.stringContaining('macbook-pro'),
      variants: [
        expect.objectContaining({
          availability: { available: true },
        }),
      ],
    });
  });

  it('uses the product canonical and joined category slug for UCP product URLs', () => {
    const product = mapUcpCatalogProductRow({
      baseUrl: 'https://ogabassey.com',
      currency: 'NGN',
      row: {
        canonical_url: '/smartphones/pixel-10',
        categories: { slug: 'smartphones' },
        id: 'product-canonical',
        merchant_id: 'merchant-1',
        name: 'Pixel 10',
        price: 900_000,
        slug: 'pixel-10',
        status: 'active',
      },
    });

    expect(expectMappedProduct(product).url).toBe(
      'https://ogabassey.com/smartphones/pixel-10'
    );
  });

  it('uses a junction category for legacy rows with no direct category', () => {
    const product = mapUcpCatalogProductRow({
      baseUrl: 'https://ogabassey.com',
      currency: 'NGN',
      row: {
        canonical_url: '/laptops/legacy-laptop',
        categories: null,
        id: 'legacy-product-category',
        merchant_id: 'merchant-1',
        name: 'Legacy Laptop',
        price: 900_000,
        product_categories: [{ categories: { slug: 'laptops' } }],
        slug: 'legacy-laptop',
        status: 'active',
      },
    });

    expect(expectMappedProduct(product).url).toBe(
      'https://ogabassey.com/laptops/legacy-laptop'
    );
  });

  it('keeps an active junction category ahead of legacy text without a direct join', () => {
    const product = mapUcpCatalogProductRow({
      baseUrl: 'https://ogabassey.com',
      currency: 'NGN',
      row: {
        canonical_url: null,
        category: 'Laptops',
        categories: null,
        id: 'legacy-text-category',
        merchant_id: 'merchant-1',
        name: 'Legacy Category Laptop',
        price: 900_000,
        product_categories: [{ categories: { slug: 'featured-laptops' } }],
        slug: 'legacy-category-laptop',
        status: 'active',
      },
    });

    expect(expectMappedProduct(product).url).toBe(
      'https://ogabassey.com/featured-laptops/legacy-category-laptop'
    );
  });

  it('uses the lowest active junction category id for the UCP URL', () => {
    const product = mapUcpCatalogProductRow({
      baseUrl: 'https://ogabassey.com',
      currency: 'NGN',
      row: {
        canonical_url: null,
        categories: { is_active: false, slug: 'retired' },
        id: 'multi-category-product',
        merchant_id: 'merchant-1',
        name: 'Multi-category product',
        price: 900_000,
        product_categories: [
          {
            category_id: 'category-z',
            categories: { is_active: true, slug: 'z-category' },
          },
          {
            category_id: 'category-a',
            categories: { is_active: true, slug: 'a-category' },
          },
        ],
        slug: 'multi-category-product',
        status: 'active',
      },
    });

    expect(expectMappedProduct(product).url).toBe(
      'https://ogabassey.com/a-category/multi-category-product'
    );
  });

  it('keeps unmanaged inventory available and filters inactive rows', () => {
    const rows = filterActiveUcpCatalogProductRows([
      {
        id: 'draft-product',
        merchant_id: 'merchant-1',
        name: 'Draft',
        price: 100,
        status: 'draft',
      },
      {
        id: 'product-1',
        manage_stock: false,
        merchant_id: 'merchant-1',
        name: 'Live',
        price: 200,
        status: 'active',
      },
    ]);

    const product = mapUcpCatalogProductRow({
      baseUrl: 'https://ogabassey.com',
      currency: 'NGN',
      row: rows[0],
    });

    expect(rows).toHaveLength(1);
    expect(expectMappedProduct(product).variants[0]?.availability).toEqual({
      available: true,
    });
  });

  it('builds a UCP capability envelope for product detail responses', () => {
    const product = mapStorefrontProductToUcpCatalogProduct({
      currency: 'NGN',
      id: 'product-1',
      in_stock: true,
      name: 'iPhone',
      price: 1_200_000,
      product_url: 'https://ogabassey.com/products/iphone',
    });

    expect(buildUcpCatalogProductResponse(product)).toMatchObject({
      product,
      messages: [],
      ucp: {
        status: 'success',
        capabilities: {
          [UCP_CATALOG_LOOKUP_CAPABILITY]: [{ version: '2026-04-08' }],
        },
      },
    });
  });
});
