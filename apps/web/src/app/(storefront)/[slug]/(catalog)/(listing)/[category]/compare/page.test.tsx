import { render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadCategoryCompareHubData = vi.fn();

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
}));

vi.mock('next/navigation', () => ({
  permanentRedirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('@/lib/seo-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/seo-utils')>();

  return {
    ...actual,
    getIndexableRobotsMetadata: () => ({ index: true, follow: true }),
  };
});

vi.mock('./load-category-compare-hub-data', () => ({
  loadCategoryCompareHubData: (...args: unknown[]) =>
    mockLoadCategoryCompareHubData(...args),
}));

const {
  default: CategoryCompareIndexPage,
  CategoryCompareIndexRuntime,
  generateMetadata,
} = await import('./page');

describe('CategoryCompareIndexPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCategoryCompareHubData.mockResolvedValue({
      categoryName: 'Smartphones',
      categorySlug: 'smartphones',
      merchant: {
        business_name: 'Ogabassey',
        slug: 'ogabassey',
      },
      storeUrl: 'https://ogabassey.com',
      products: [
        {
          slug: 'xiaomi-13t',
          name: 'Xiaomi 13T',
          brand: 'Xiaomi',
          price: 450_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Dimensity 8200 Ultra',
            ram_gb: 8,
            storage_gb: 256,
          },
        },
        {
          slug: 'google-pixel-8',
          name: 'Google Pixel 8',
          brand: 'Google',
          price: 620_000,
          category_slug: 'smartphones',
          product_key_specs: {
            chipset: 'Tensor G3',
            ram_gb: 12,
            storage_gb: 128,
          },
        },
      ],
    });
  });

  it('wraps CategoryCompareIndexRuntime in a local Suspense loading boundary', () => {
    const { container } = render(
      CategoryCompareIndexPage({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
        }),
      })
    );

    expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  });

  it('renders a category compare hub with crawlable comparison links', async () => {
    const { container } = render(
      (await CategoryCompareIndexRuntime({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
        }),
      })) as React.ReactElement
    );

    expect(
      screen.getByRole('heading', { name: 'Smartphones comparisons' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Compare Google Pixel 8 with Xiaomi 13T',
      })
    ).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/compare/google-pixel-8-vs-xiaomi-13t'
    );
    expect(
      container.querySelectorAll('script[type="application/ld+json"]')
    ).toHaveLength(2);
    expect(container.textContent).toContain('"@type":"ItemList"');
  });

  it('renders crawlable child-category comparison links on parent hubs', async () => {
    mockLoadCategoryCompareHubData.mockResolvedValueOnce({
      categoryName: 'Laptops',
      categorySlug: 'laptops',
      merchant: {
        business_name: 'Ogabassey',
        slug: 'ogabassey',
      },
      productGroups: [
        {
          categoryName: 'Business Laptops',
          categorySlug: 'business-laptops',
          products: [
            {
              slug: 'dell-latitude-7400',
              name: 'Dell Latitude 7400',
              brand: 'Dell',
              price: 480_000,
              category_slug: 'business-laptops',
              product_key_specs: {
                chipset: 'Intel Core i5-8365U',
                display_size_inches: 14.5,
                ram_gb: 16,
                storage_gb: 512,
              },
            },
            {
              slug: 'lenovo-thinkpad-x1-carbon-gen-7',
              name: 'Lenovo ThinkPad X1 Carbon Gen 7',
              brand: 'Lenovo',
              price: 540_000,
              category_slug: 'business-laptops',
              product_key_specs: {
                chipset: 'Intel Core i7-8665U',
                display_size_inches: 14,
                ram_gb: 16,
                storage_gb: 256,
              },
            },
          ],
        },
      ],
      products: [],
      storeUrl: 'https://ogabassey.com',
    });

    render(
      (await CategoryCompareIndexRuntime({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'laptops',
        }),
      })) as React.ReactElement
    );

    expect(
      screen.getByRole('link', {
        name: 'Compare Dell Latitude 7400 with Lenovo ThinkPad X1 Carbon Gen 7',
      })
    ).toHaveAttribute(
      'href',
      '/ogabassey/business-laptops/compare/dell-latitude-7400-vs-lenovo-thinkpad-x1-carbon-gen-7'
    );
  });

  it('noindexes parameterized compare hubs while preserving the canonical hub URL', async () => {
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: 'ogabassey', category: 'smartphones' }),
        searchParams: Promise.resolve({ brand: 'Apple' }),
      })
    ).resolves.toMatchObject({
      alternates: {
        canonical: 'https://ogabassey.com/smartphones/compare',
      },
      robots: { index: false, follow: true },
    });
  });

  it('ignores the internal metadata cache bucket when deciding hub robots', async () => {
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: 'ogabassey', category: 'smartphones' }),
        searchParams: Promise.resolve({
          __baci_metadata_cache_bucket: 'metadata-blocking',
        }),
      })
    ).resolves.toMatchObject({
      alternates: {
        canonical: 'https://ogabassey.com/smartphones/compare',
      },
      robots: { index: true, follow: true },
    });
  });

  it('noindexes non-canonical category hub casing', async () => {
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: 'ogabassey', category: 'Smartphones' }),
      })
    ).resolves.toMatchObject({
      alternates: {
        canonical: 'https://ogabassey.com/smartphones/compare',
      },
      robots: { index: false, follow: true },
    });
  });

  it('redirects non-canonical category hub casing to the canonical path', async () => {
    await expect(
      CategoryCompareIndexRuntime({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'Smartphones',
        }),
      })
    ).rejects.toThrow('NEXT_REDIRECT:/ogabassey/smartphones/compare');
  });
});
