import { describe, expect, it } from 'vitest';
import {
  buildClusterFeaturedProducts,
  type ClusterFeaturedInventoryProduct,
} from './build-cluster-featured-products';

const baseProducts: ClusterFeaturedInventoryProduct[] = [
  {
    slug: 'iphone-11',
    name: 'iPhone 11',
    brand: 'Apple',
    price: 210_000,
    category_slug: 'smartphones',
    stock: 4,
    manage_stock: true,
  },
  {
    slug: 'iphone-13',
    name: 'iPhone 13',
    brand: 'Apple',
    price: 420_000,
    category_slug: 'smartphones',
    stock: 3,
    manage_stock: true,
  },
  {
    slug: 'iphone-13-pro-max',
    name: 'iPhone 13 Pro Max',
    brand: 'Apple',
    price: 680_000,
    category_slug: 'smartphones',
    stock: 2,
    manage_stock: true,
  },
  {
    slug: 'iphone-x',
    name: 'iPhone X',
    brand: 'Apple',
    price: 165_000,
    category_slug: 'smartphones',
    stock: 2,
    manage_stock: true,
  },
  {
    slug: 'google-pixel-9',
    name: 'Google Pixel 9',
    brand: 'Google',
    price: 790_000,
    category_slug: 'smartphones',
    stock: 5,
    manage_stock: true,
  },
  {
    slug: 'google-pixel-7a',
    name: 'Google Pixel 7a',
    brand: 'Google',
    price: 380_000,
    category_slug: 'smartphones',
    stock: 5,
    manage_stock: true,
  },
];

describe('buildClusterFeaturedProducts', () => {
  it('returns an empty list when the inventory pool is empty', () => {
    expect(
      buildClusterFeaturedProducts(
        'https://ogabassey.com',
        'smartphones',
        ['apple'],
        []
      )
    ).toEqual([]);
  });

  it('filters out unavailable products and stays on-brand when brands are inferred', () => {
    const products: ClusterFeaturedInventoryProduct[] = [
      {
        slug: 'out-of-stock-iphone',
        name: 'iPhone 15',
        brand: 'Apple',
        price: 500_000,
        category_slug: 'smartphones',
        stock: 0,
        manage_stock: true,
      },
      {
        slug: 'cheaper-other-brand',
        name: 'Galaxy A16',
        brand: 'Samsung',
        price: 180_000,
        category_slug: 'smartphones',
        stock: 5,
        manage_stock: true,
      },
    ];

    expect(
      buildClusterFeaturedProducts(
        'https://ogabassey.com',
        'smartphones',
        ['apple'],
        products
      )
    ).toEqual([]);
  });

  it('matches single-token base models like iPhone 13 and ranks exact base model ahead of Pro Max', () => {
    const featured = buildClusterFeaturedProducts(
      'https://ogabassey.com',
      'smartphones',
      ['apple'],
      baseProducts,
      'NG',
      'iPhone 13 Price in Nigeria iphone-13-price-in-nigeria'
    );

    expect(featured.map((item) => item.href)).toEqual([
      'https://ogabassey.com/smartphones/iphone-13',
      'https://ogabassey.com/smartphones/iphone-13-pro-max',
    ]);
  });

  it('matches single-character model identifiers like Pixel 9 and iPhone X', () => {
    const pixelFeatured = buildClusterFeaturedProducts(
      'https://ogabassey.com',
      'smartphones',
      ['google'],
      baseProducts,
      'NG',
      'Google Pixel 9 Review in Nigeria google-pixel-9-review'
    );
    const iphoneXFeatured = buildClusterFeaturedProducts(
      'https://ogabassey.com',
      'smartphones',
      ['apple'],
      baseProducts,
      'NG',
      'iPhone X Buying Guide iphone-x-buying-guide'
    );

    expect(pixelFeatured[0]?.href).toBe(
      'https://ogabassey.com/smartphones/google-pixel-9'
    );
    expect(iphoneXFeatured[0]?.href).toBe(
      'https://ogabassey.com/smartphones/iphone-x'
    );
  });

  it('breaks affinity ties by lowest price then slug order and falls back to /products when category_slug is absent', () => {
    const tiedProducts: ClusterFeaturedInventoryProduct[] = [
      {
        slug: 'galaxy-s24-plus',
        name: 'Galaxy S24',
        brand: 'Samsung',
        price: 620_000,
        category_slug: null,
        stock: 3,
      },
      {
        slug: 'galaxy-s24-base',
        name: 'Galaxy S24',
        brand: 'Samsung',
        price: 620_000,
        category_slug: null,
        stock: 3,
      },
    ];

    const featured = buildClusterFeaturedProducts(
      'https://ogabassey.com',
      'smartphones',
      ['samsung'],
      tiedProducts,
      'NG',
      'Samsung Galaxy S24 Guide'
    );

    expect(featured.map((item) => item.href)).toEqual([
      'https://ogabassey.com/products/galaxy-s24-base',
      'https://ogabassey.com/products/galaxy-s24-plus',
    ]);
  });

  it('prioritizes primary model-number matches over tier-modifier matches like Ultra', () => {
    const products: ClusterFeaturedInventoryProduct[] = [
      {
        slug: 'galaxy-s23-ultra',
        name: 'Galaxy S23 Ultra',
        brand: 'Samsung',
        price: 750_000,
        category_slug: 'smartphones',
        stock: 3,
      },
      {
        slug: 'galaxy-s24-256gb-black',
        name: 'Galaxy S24 256GB Black',
        brand: 'Samsung',
        price: 680_000,
        category_slug: 'smartphones',
        stock: 3,
      },
    ];

    const featured = buildClusterFeaturedProducts(
      'https://ogabassey.com',
      'smartphones',
      ['samsung'],
      products,
      'NG',
      'Samsung Galaxy S24 Ultra Price in Nigeria'
    );

    expect(featured[0]?.href).toBe(
      'https://ogabassey.com/smartphones/galaxy-s24-256gb-black'
    );
  });

  it('ranks model and tier matches ahead of a capacity match on a base model', () => {
    const products: ClusterFeaturedInventoryProduct[] = [
      {
        slug: 'iphone-13-256gb',
        name: 'iPhone 13 256GB',
        brand: 'Apple',
        price: 450_000,
        category_slug: 'smartphones',
        stock: 3,
      },
      {
        slug: 'iphone-13-pro-max-128gb',
        name: 'iPhone 13 Pro Max 128GB',
        brand: 'Apple',
        price: 680_000,
        category_slug: 'smartphones',
        stock: 3,
      },
    ];

    const featured = buildClusterFeaturedProducts(
      'https://ogabassey.com',
      'smartphones',
      ['apple'],
      products,
      'NG',
      'iPhone 13 Pro Max 256GB Price in Nigeria'
    );

    expect(featured.map((item) => item.href)).toEqual([
      'https://ogabassey.com/smartphones/iphone-13-pro-max-128gb',
      'https://ogabassey.com/smartphones/iphone-13-256gb',
    ]);
  });
});
