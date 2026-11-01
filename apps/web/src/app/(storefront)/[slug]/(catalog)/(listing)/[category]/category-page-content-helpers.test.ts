import { describe, expect, it } from 'vitest';
import type { getCachedCategoryPageData } from '@/lib/cached-data';
import type { RawDbProduct } from '@/lib/normalize-product';
import {
  buildCategoryPageHubModel,
  getCategoryPageProductSlots,
  isCategoryPageProductSlot,
  resolveFirstUsableCategoryProductImage,
  toClientCategoryPageProducts,
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

  it('produces Photography, Battery, and laptop recommendations from product_key_specs', () => {
    const smartphoneModel = buildCategoryPageHubModel({
      data: categoryDataStub({ isCollection: false, category: null }),
      categorySlug: 'smartphones',
      categoryName: 'Smartphones',
      merchantBusinessName: 'Ogabassey',
      storeUrl: 'https://ogabassey.com',
      products: [
        {
          id: 'phone-cam',
          name: 'Pro Camera Phone',
          slug: 'pro-camera-phone',
          description: 'Top camera',
          price: '₦1,200,000',
          rawPrice: 1_200_000,
          category: 'Smartphones',
          category_slug: 'smartphones',
          brand: 'BrandA',
          condition: 'New',
          image: 'https://cdn.example.com/phone-cam.jpg',
          product_key_specs: {
            main_camera_mp: 200,
            battery_mah: 4500,
          },
        },
        {
          id: 'phone-bat',
          name: 'Max Battery Phone',
          slug: 'max-battery-phone',
          description: 'Long battery',
          price: '₦800,000',
          rawPrice: 800_000,
          category: 'Smartphones',
          category_slug: 'smartphones',
          brand: 'BrandB',
          condition: 'New',
          image: 'https://cdn.example.com/phone-bat.jpg',
          product_key_specs: {
            main_camera_mp: 50,
            battery_mah: 6500,
          },
        },
      ],
    });

    const bestForTitles = smartphoneModel.bestForCards.map(
      (card) => card.title
    );
    expect(bestForTitles).toContain('Best for Photography');
    expect(bestForTitles).toContain('Best for Battery Life');

    const laptopModel = buildCategoryPageHubModel({
      data: categoryDataStub({ isCollection: false, category: null }),
      categorySlug: 'laptops',
      categoryName: 'Laptops',
      merchantBusinessName: 'Ogabassey',
      storeUrl: 'https://ogabassey.com',
      products: [
        {
          id: 'laptop-work',
          name: 'Power Laptop',
          slug: 'power-laptop',
          description: 'Fast laptop',
          price: '₦1,500,000',
          rawPrice: 1_500_000,
          category: 'Laptops',
          category_slug: 'laptops',
          brand: 'LaptopBrand',
          condition: 'New',
          image: 'https://cdn.example.com/laptop-work.jpg',
          product_key_specs: {
            ram_gb: 32,
            storage_gb: 1024,
            gpu: 'RTX 4080',
          },
        },
      ],
    });

    const laptopBestForTitles = laptopModel.bestForCards.map(
      (card) => card.title
    );
    expect(laptopBestForTitles).toContain('Best for Work and School');
  });
});

describe('resolveFirstUsableCategoryProductImage', () => {
  it('skips placeholder images and finds the first usable candidate', () => {
    const usable = resolveFirstUsableCategoryProductImage({
      image: '/placeholder.svg',
      images: ['/placeholder.png', 'https://cdn.ogabassey.com/real.avif'],
    });

    expect(usable).toBe('https://cdn.ogabassey.com/real.avif');
  });

  it('skips external placeholder URLs', () => {
    const usable = resolveFirstUsableCategoryProductImage({
      image: 'https://via.placeholder.com/300',
      images: ['https://cdn.ogabassey.com/gallery.avif'],
    });

    expect(usable).toBe('https://cdn.ogabassey.com/gallery.avif');
  });
});

describe('toClientCategoryPageProducts', () => {
  it('preserves images when main image is a placeholder, strips product_key_specs, and truncates description', () => {
    const longDescription = 'A'.repeat(250);
    const clientProducts = toClientCategoryPageProducts([
      {
        id: 'prod-1',
        name: 'Test Device',
        slug: 'test-device',
        description: longDescription,
        price: '₦500,000',
        rawPrice: 500_000,
        category: 'Smartphones',
        category_slug: 'smartphones',
        condition: 'New',
        image: '/placeholder.svg',
        images: [
          '/placeholder.svg',
          'https://cdn.ogabassey.com/gallery-2.avif',
        ],
        product_key_specs: { ram_gb: 12 },
        graphics: 'Adreno',
      },
      {
        id: 'prod-2',
        name: 'Device With Good Image',
        slug: 'good-image-device',
        description: 'Short description',
        price: '₦300,000',
        rawPrice: 300_000,
        category: 'Smartphones',
        category_slug: 'smartphones',
        condition: 'New',
        image: 'https://cdn.ogabassey.com/main.avif',
        images: [
          'https://cdn.ogabassey.com/main.avif',
          'https://cdn.ogabassey.com/extra.avif',
        ],
        product_key_specs: { ram_gb: 8 },
      },
    ]);

    expect(clientProducts[0]?.images).toEqual([
      'https://cdn.ogabassey.com/gallery-2.avif',
    ]);
    expect(clientProducts[0]?.product_key_specs).toBeUndefined();
    expect(clientProducts[0]?.description.length).toBeLessThanOrEqual(150);
    expect(clientProducts[0]?.description.endsWith('...')).toBe(true);

    expect(clientProducts[1]?.images).toBeUndefined();
    expect(clientProducts[1]?.product_key_specs).toBeUndefined();
  });
});
