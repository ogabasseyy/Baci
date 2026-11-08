import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { comparePageModel } from './compare-page-content.test-fixtures';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockLoadComparePage = vi.fn();

vi.mock('@/lib/storefront-compare/load-compare-page', () => ({
  loadComparePage: (...args: unknown[]) => mockLoadComparePage(...args),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (value: unknown) => JSON.stringify(value),
}));

vi.mock('./compare-related-links', () => ({
  CompareRelatedLinks: () => null,
}));

describe('ComparePageContent JSON-LD schemas', () => {
  beforeEach(() => {
    mockLoadComparePage.mockReset();
    mockLoadComparePage.mockResolvedValue(comparePageModel);
  });

  it('renders breadcrumb and product ItemList JSON-LD scripts while suppressing compare FAQPage markup', async () => {
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(2);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[1]?.textContent).toContain('"@type":"ItemList"');
    expect(schemaScripts[1]?.textContent).toContain('"@type":"Product"');
    expect(schemaScripts[1]?.textContent).not.toContain('"@type":"FAQPage"');
  });

  it('uses the resolved merchant currency in product ItemList JSON-LD offers', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      merchant: {
        ...comparePageModel.merchant,
        payout_currency: 'KES',
        country: 'KE',
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const itemListSchema = JSON.parse(schemaScripts[1]?.textContent ?? '{}');

    expect(itemListSchema.itemListElement[0].item.offers.priceCurrency).toBe(
      'KES'
    );
  });

  it('falls back to NGN in product ItemList JSON-LD when the merchant has no payout currency', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      merchant: {
        ...comparePageModel.merchant,
        payout_currency: null,
        country: null,
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const itemListSchema = JSON.parse(schemaScripts[1]?.textContent ?? '{}');

    expect(itemListSchema.itemListElement[0].item.offers.priceCurrency).toBe(
      'NGN'
    );
  });

  it('keeps string-encoded prices in product ItemList JSON-LD', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      rightProduct: {
        ...comparePageModel.rightProduct,
        price: '2300000',
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const itemListSchema = JSON.parse(schemaScripts[1]?.textContent ?? '{}');

    expect(itemListSchema.itemListElement[1].item.offers.price).toBe(2_300_000);
  });

  it('resolves relative product images in product ItemList JSON-LD', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      rightProduct: {
        ...comparePageModel.rightProduct,
        image: '/media/samsung-galaxy-z-trifold.avif',
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const itemListSchema = JSON.parse(schemaScripts[1]?.textContent ?? '{}');

    expect(itemListSchema.itemListElement[1].item.image).toEqual([
      'https://ogabassey.com/media/samsung-galaxy-z-trifold.avif',
    ]);
  });

  it('suppresses product ItemList JSON-LD when a compared product has no image', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      rightProduct: {
        ...comparePageModel.rightProduct,
        image: null,
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(1);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[0]?.textContent).not.toContain('"@type":"ItemList"');
  });

  it('suppresses product ItemList JSON-LD when a compared product only has a local placeholder image', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      rightProduct: {
        ...comparePageModel.rightProduct,
        image: '/placeholder.svg',
      },
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(1);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[0]?.textContent).not.toContain('"@type":"ItemList"');
  });

  it('keeps product ItemList JSON-LD when visible FAQ items are absent', async () => {
    mockLoadComparePage.mockResolvedValueOnce({
      ...comparePageModel,
      faqItems: [],
    });
    const { ComparePageContent } = await import('./compare-page-content');

    const { container } = render(
      (await ComparePageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          comparisonSlug: 'iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(2);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[1]?.textContent).toContain('"@type":"ItemList"');
    expect(schemaScripts[1]?.textContent).not.toContain('"@type":"FAQPage"');
  });
});
