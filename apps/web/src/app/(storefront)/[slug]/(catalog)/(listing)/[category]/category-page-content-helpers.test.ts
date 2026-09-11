import { describe, expect, it } from 'vitest';
import type { getCachedCategoryPageData } from '@/lib/cached-data';
import type { RawDbProduct } from '@/lib/normalize-product';
import {
  buildCategoryPageHubModel,
  getCategoryPageProductSlots,
  isCategoryPageProductSlot,
  normalizeCategoryPageProducts,
} from './category-page-content-helpers';

type CategoryPageData = Awaited<ReturnType<typeof getCachedCategoryPageData>>;

const slotProduct = {
  id: 'slot-product',
  name: 'Slot Product',
} as RawDbProduct;

const fallbackProduct = {
  id: 'fallback-product',
  name: 'Fallback Product',
} as RawDbProduct;

function categoryDataStub(data: Partial<CategoryPageData>): CategoryPageData {
  return {
    isCollection: true,
    category: null,
    products: [],
    ...data,
  } as CategoryPageData;
}

describe('getCategoryPageProductSlots', () => {
  it('returns explicit productSlots when present', () => {
    expect(
      getCategoryPageProductSlots(
        categoryDataStub({
          products: [fallbackProduct],
          productSlots: [slotProduct, null],
        })
      )
    ).toEqual([slotProduct, null]);
  });

  it('falls back to products when productSlots are missing', () => {
    expect(
      getCategoryPageProductSlots(
        categoryDataStub({ products: [fallbackProduct] })
      )
    ).toEqual([fallbackProduct]);
  });

  it('handles an empty products array fallback', () => {
    expect(
      getCategoryPageProductSlots(categoryDataStub({ products: [] }))
    ).toEqual([]);
  });
});

describe('isCategoryPageProductSlot', () => {
  it('filters out null slots while keeping product rows', () => {
    expect([slotProduct, null].filter(isCategoryPageProductSlot)).toEqual([
      slotProduct,
    ]);
  });
});

describe('normalizeCategoryPageProducts', () => {
  it('uses the route category slug for multi-category products', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-1',
          name: 'Galaxy Z Fold',
          slug: 'galaxy-z-fold',
          description: 'Foldable phone',
          price: 1200000,
          condition: 'new',
          stock: 4,
          images: ['https://cdn.example.com/fold.png'],
          categories: [
            {
              name: 'Featured',
              slug: 'featured',
            },
            {
              name: 'Smartphones',
              slug: 'smartphones',
            },
          ],
          product_key_specs: {
            ram_gb: 12,
            storage_gb: 512,
          },
        },
      ],
      'smartphones'
    );

    expect(result.category).toBe('Smartphones');
    expect(result.category_slug).toBe('smartphones');
  });

  it('keeps the first category when it already matches the route category', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-2',
          name: 'iPhone 16',
          slug: 'iphone-16',
          description: 'Flagship phone',
          price: 1500000,
          condition: 'new',
          stock: 8,
          images: ['https://cdn.example.com/iphone-16.png'],
          categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        },
      ],
      'smartphones'
    );

    expect(result.category).toBe('Smartphones');
    expect(result.category_slug).toBe('smartphones');
  });

  it('falls back to the first available category when the route category is absent', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-3',
          name: 'Galaxy Book',
          slug: 'galaxy-book',
          description: 'Windows laptop',
          price: 1750000,
          condition: 'new',
          stock: 5,
          images: ['https://cdn.example.com/galaxy-book.png'],
          categories: [
            { name: 'Laptops', slug: 'laptops' },
            { name: 'Featured', slug: 'featured' },
          ],
        },
      ],
      'smartphones'
    );

    expect(result.category).toBe('Laptops');
    expect(result.category_slug).toBe('laptops');
  });

  it('returns an empty array when there are no products to normalize', () => {
    expect(normalizeCategoryPageProducts([], 'smartphones')).toEqual([]);
  });

  it('formats normalized product prices with the storefront country currency', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-4',
          name: 'Kurta Set',
          slug: 'kurta-set',
          description: 'Festive wear',
          price: 2500,
          condition: 'new',
          stock: 7,
          images: ['https://cdn.example.com/kurta.png'],
          categories: [{ name: 'Fashion', slug: 'fashion' }],
        },
      ],
      'fashion',
      'IN'
    );

    expect(result.price).toMatch(/₹|INR/);
    expect(result.price).not.toContain('₦');
  });

  it('falls back to NGN when no storefront country is provided', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-5',
          name: 'Classic Tote',
          slug: 'classic-tote',
          description: 'Everyday bag',
          price: 2500,
          condition: 'new',
          stock: 3,
          images: ['https://cdn.example.com/tote.png'],
          categories: [{ name: 'Fashion', slug: 'fashion' }],
        },
      ],
      'fashion'
    );

    expect(result.price).toContain('₦');
    expect(result.price).not.toMatch(/₹|INR/);
  });

  it('falls back to NGN when the storefront country is null', () => {
    const [result] = normalizeCategoryPageProducts(
      [
        {
          id: 'prod-6',
          name: 'Travel Backpack',
          slug: 'travel-backpack',
          description: 'Carry-on friendly backpack',
          price: 4500,
          condition: 'new',
          stock: 6,
          images: ['https://cdn.example.com/backpack.png'],
          categories: [{ name: 'Bags', slug: 'bags' }],
        },
      ],
      'bags',
      null
    );

    expect(result.price).toContain('₦');
    expect(result.price).not.toContain('$');
  });
});

describe('buildCategoryPageHubModel', () => {
  it('uses maintained comparison links when category rendering provides them', () => {
    const model = buildCategoryPageHubModel({
      data: categoryDataStub({
        isCollection: false,
        category: {
          description: null,
          id: 'cat-1',
          is_active: true,
          name: 'Smartphones',
          slug: 'smartphones',
          seo_heading: null,
          seo_description: null,
          seo_features: [],
          seo_faq: [],
          image_url: null,
          parent: null,
        },
      }),
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantBusinessName: 'Ogabassey',
      storeUrl: 'https://ogabassey.com',
      products: [],
      comparisonLinks: [
        {
          href: 'https://ogabassey.com/smartphones/compare',
          label: 'View all smartphones comparisons',
        },
        {
          href: 'https://ogabassey.com/smartphones/compare/alpha-vs-beta',
          label: 'Compare Alpha with Beta',
        },
      ],
    });

    expect(model.comparisonLinks).toEqual([
      {
        href: 'https://ogabassey.com/smartphones/compare',
        label: 'View all smartphones comparisons',
      },
      {
        href: 'https://ogabassey.com/smartphones/compare/alpha-vs-beta',
        label: 'Compare Alpha with Beta',
      },
    ]);
  });
});
