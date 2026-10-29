import { describe, expect, it } from 'vitest';
import type { Product as StorefrontProduct } from '@/lib/products';
import { OGABASSEY_HOME_PRODUCT_FEED_LIMIT } from './config/products';
import { createOgabasseyHomeProductFeed } from './home-product-feed';

function createStorefrontProduct(
  overrides: Partial<StorefrontProduct>
): StorefrontProduct {
  return {
    id: 'product-1',
    name: 'Test Product',
    description: 'Test description',
    status: 'active',
    price: 100000,
    manage_stock: true,
    stock: 5,
    image: '/default.jpg',
    imageLarge: '/default-large.jpg',
    imageHint: 'Test product',
    brand: 'Baci',
    gtin: '',
    mpn: '',
    ...overrides,
  };
}

describe('createOgabasseyHomeProductFeed', () => {
  it('caps and maps the OgaBassey homepage feed to the compact card shape', () => {
    const products = Array.from(
      { length: OGABASSEY_HOME_PRODUCT_FEED_LIMIT + 3 },
      (_, index) =>
        createStorefrontProduct({
          id: `product-${index + 1}`,
          name: `Product ${index + 1}`,
          slug: `product-${index + 1}`,
          description: `Description ${index + 1}`,
          price: 100000 + index,
          image: `/product-${index + 1}.jpg`,
          imageLarge: `/large-product-${index + 1}.jpg`,
        })
    );

    const result = createOgabasseyHomeProductFeed(products);

    expect(result).toHaveLength(OGABASSEY_HOME_PRODUCT_FEED_LIMIT);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'product-1',
        name: 'Product 1',
        price: '₦100,000',
        image: '/product-1.jpg',
      })
    );
    expect(result[0]).not.toHaveProperty('imageLarge');
    expect(result[0]).not.toHaveProperty('product_categories');
    expect(result.at(-1)?.id).toBe(
      `product-${OGABASSEY_HOME_PRODUCT_FEED_LIMIT}`
    );
  });

  it('prioritizes smartphone products before applying the homepage feed limit', () => {
    const products = Array.from(
      { length: OGABASSEY_HOME_PRODUCT_FEED_LIMIT + 2 },
      (_, index) =>
        createStorefrontProduct({
          id: `accessory-${index + 1}`,
          name: `Accessory ${index + 1}`,
          slug: `accessory-${index + 1}`,
          category: 'Accessories',
        })
    );
    products.push(
      createStorefrontProduct({
        id: 'iphone-priority',
        name: 'iPhone Priority',
        slug: 'iphone-priority',
        category: 'Smartphones',
      })
    );

    const result = createOgabasseyHomeProductFeed(products);

    expect(result).toHaveLength(OGABASSEY_HOME_PRODUCT_FEED_LIMIT);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'iphone-priority',
        category: 'Smartphones',
      })
    );
    expect(result.some((product) => product.id === 'accessory-1')).toBe(true);
    expect(
      result.some((product) => product.id === `accessory-${products.length - 1}`)
    ).toBe(false);
  });

  it('prioritizes relation-backed smartphone categories before applying the homepage feed limit', () => {
    const products = Array.from(
      { length: OGABASSEY_HOME_PRODUCT_FEED_LIMIT + 2 },
      (_, index) =>
        createStorefrontProduct({
          id: `accessory-${index + 1}`,
          name: `Accessory ${index + 1}`,
          slug: `accessory-${index + 1}`,
          category: 'Accessories',
        })
    );
    products.push(
      createStorefrontProduct({
        id: 'iphone-relation-priority',
        name: 'iPhone Relation Priority',
        slug: 'iphone-relation-priority',
        category: undefined,
        category_slug: undefined,
        categories: {
          id: 'cat-phone',
          name: 'Smartphones',
          slug: 'smartphones',
        },
      })
    );

    const result = createOgabasseyHomeProductFeed(products);

    expect(result).toHaveLength(OGABASSEY_HOME_PRODUCT_FEED_LIMIT);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'iphone-relation-priority',
        category: 'Smartphones',
      })
    );
    expect(
      result.some((product) => product.id === `accessory-${products.length - 1}`)
    ).toBe(false);
  });

  it('returns an empty array when no homepage products are available', () => {
    expect(createOgabasseyHomeProductFeed([])).toEqual([]);
  });

  it('keeps every product when the feed is below the homepage limit', () => {
    const products = [
      createStorefrontProduct({
        id: 'product-1',
        name: 'Product 1',
        price: 100000,
        image: '/product-1.jpg',
      }),
      createStorefrontProduct({
        id: 'product-2',
        name: 'Product 2',
        price: 200000,
        image: '/product-2.jpg',
      }),
    ];

    const result = createOgabasseyHomeProductFeed(products);

    expect(result).toHaveLength(products.length);
    expect(result[1]).toEqual(
      expect.objectContaining({
        id: 'product-2',
        name: 'Product 2',
        price: '₦200,000',
        image: '/product-2.jpg',
      })
    );
    expect(result[1]).not.toHaveProperty('imageLarge');
    expect(result[1]).not.toHaveProperty('product_categories');
  });

  it('formats the homepage feed price in a non-NGN merchant currency when supplied', () => {
    const products = [
      createStorefrontProduct({
        id: 'product-1',
        name: 'Product 1',
        price: 999900,
        image: '/product-1.jpg',
      }),
    ];

    const result = createOgabasseyHomeProductFeed(products, {
      code: 'INR',
      symbol: '₹',
      locale: 'en-IN',
    });

    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'product-1',
        price: '₹9,99,900',
      })
    );
  });

  it('omits gallery images, image_payloads, and undefined optional fields from the homepage RSC feed while preserving primary image and image_alt', () => {
    const products = [
      createStorefrontProduct({
        id: 'product-rsc-slim',
        name: 'Samsung Galaxy S26 Ultra',
        slug: 'samsung-galaxy-s26-ultra',
        price: 1850000,
        image: '',
        brand: undefined,
        category_id: undefined,
        category_slug: undefined,
        colors: ['Titanium Black', 'Titanium Gray'],
        storage_options: undefined,
        images: [
          { url: '/s26-front.jpg', alt: 'Samsung Galaxy S26 Ultra', order: 0 },
          { url: '/s26-back.jpg', alt: 'Samsung Galaxy S26 Ultra', order: 1 },
          { url: '/s26-side.jpg', alt: 'Samsung Galaxy S26 Ultra', order: 2 },
        ],
      }),
    ];

    const result = createOgabasseyHomeProductFeed(products);

    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'product-rsc-slim',
        image: '/s26-front.jpg',
        image_alt: 'Samsung Galaxy S26 Ultra',
      })
    );
    expect(result[0]).not.toHaveProperty('images');
    expect(result[0]).not.toHaveProperty('image_payloads');
    expect(result[0]).not.toHaveProperty('brand');
    expect(result[0]).not.toHaveProperty('category_id');
    expect(result[0]).not.toHaveProperty('categorySlug');
    expect(result[0]).not.toHaveProperty('colors');
    expect(result[0]).not.toHaveProperty('storage');
  });
});
