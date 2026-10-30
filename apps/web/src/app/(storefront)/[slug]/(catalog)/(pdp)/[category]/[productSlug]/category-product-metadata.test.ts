import { describe, expect, it, vi } from 'vitest';
import { buildCategoryProductMetadata } from './category-product-metadata';

vi.mock('@/lib/seo-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo-utils')>();
  return {
    ...actual,
    getIndexableRobotsMetadata: () => ({
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-snippet': 42,
      },
    }),
  };
});

describe('buildCategoryProductMetadata', () => {
  it('keeps the existing canonical product metadata shape', () => {
    const metadata = buildCategoryProductMetadata({
      baseUrl: 'https://zorvexa.usebaci.com',
      merchant: {
        business_name: 'Zorvexa',
        country: 'NG',
        is_published: true,
        slug: 'zorvexa',
      } as never,
      product: {
        name: 'Linen Shirt',
        slug: 'linen-shirt',
        description: 'A breathable linen shirt for warm days.',
        meta_description: null,
        meta_title: null,
        category: 'Fashion',
        categories: { name: 'Fashion', slug: 'fashion' },
        price: 12_000,
        status: 'active',
        images: ['https://cdn.example.com/linen-shirt.jpg'],
      } as never,
      storeSlug: 'zorvexa',
    });

    expect(metadata).toMatchObject({
      alternates: {
        canonical: 'https://zorvexa.usebaci.com/fashion/linen-shirt',
      },
      robots: {
        index: true,
        follow: true,
        googleBot: { index: true, 'max-snippet': 42 },
      },
      openGraph: {
        url: 'https://zorvexa.usebaci.com/fashion/linen-shirt',
      },
    });
    expect(metadata.openGraph?.images).toMatchObject([
      { url: 'https://cdn.example.com/linen-shirt.jpg' },
    ]);
    expect(metadata.twitter?.images).toEqual([
      'https://cdn.example.com/linen-shirt.jpg',
    ]);
  });

  it('emits noindex for an unpublished resolved categorized product', () => {
    const metadata = buildCategoryProductMetadata({
      baseUrl: 'https://zorvexa.usebaci.com',
      merchant: {
        business_name: 'Zorvexa',
        slug: 'zorvexa',
        is_published: false,
      } as never,
      product: {
        name: 'Linen Shirt',
        slug: 'linen-shirt',
        status: 'active',
        category: 'Fashion',
        categories: { name: 'Fashion', slug: 'fashion' },
        description: 'A breathable linen shirt.',
        images: [],
      } as never,
      storeSlug: 'zorvexa',
    });

    expect(metadata.robots).toMatchObject({
      index: false,
      follow: true,
      googleBot: { index: false, follow: true, 'max-snippet': 42 },
    });
  });

  it('keeps a long product title whole instead of cutting "Price in Nigeria" mid-word', () => {
    const metadata = buildCategoryProductMetadata({
      baseUrl: 'https://ogabassey.com',
      merchant: {
        business_name: 'Ogabassey',
        country: 'NG',
        is_published: true,
        slug: 'ogabassey',
      } as never,
      product: {
        name: 'Sony Alpha a7S III Mirrorless Camera Body',
        slug: 'sony-alpha-a7s-iii-mirrorless-camera-body',
        description: 'Full-frame mirrorless camera body.',
        meta_description: null,
        meta_title:
          'Sony Alpha a7S III Mirrorless Camera Body Price in Nigeria',
        category: 'Cameras',
        categories: { name: 'Cameras', slug: 'cameras' },
        price: 2_500_000,
        status: 'active',
        images: ['https://cdn.example.com/a7s3.jpg'],
      } as never,
      storeSlug: 'ogabassey.com',
    });

    expect(metadata.title).toEqual({
      absolute: 'Sony Alpha a7S III Mirrorless Camera Body Price in Nigeria',
    });
  });
});
