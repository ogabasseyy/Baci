import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CompareIndexPageContent } from './compare-index-page-content';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('CompareIndexPageContent', () => {
  it('renders category comparison links as crawlable anchors', () => {
    render(
      <CompareIndexPageContent
        categoryName="Smartphones"
        categoryHref="/smartphones"
        merchantName="Demo Store"
        pathPrefix=""
        compareLinks={[
          {
            href: '/smartphones/compare/google-pixel-8-vs-xiaomi-13t',
            label: 'Compare Google Pixel 8 with Xiaomi 13T',
            description: 'Compare price, specs, condition, and buying fit.',
            categorySlug: 'smartphones',
            comparisonSlug: 'google-pixel-8-vs-xiaomi-13t',
            productSlugs: ['google-pixel-8', 'xiaomi-13t'],
            productNames: ['Google Pixel 8', 'Xiaomi 13T'],
            score: 12,
          },
        ]}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Smartphones comparisons' })
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass(
      'bg-store-background',
      'text-store-background-text'
    );
    expect(screen.getByText(/available from Demo Store/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Compare Google Pixel 8 with Xiaomi 13T',
      })
    ).toHaveAttribute(
      'href',
      '/smartphones/compare/google-pixel-8-vs-xiaomi-13t'
    );
  });

  it('keeps empty category hubs useful without dead comparison links', () => {
    render(
      <CompareIndexPageContent
        categoryName="Printers"
        categoryHref="/printers"
        compareLinks={[]}
        merchantName="Printer Shop"
        pathPrefix=""
      />
    );

    expect(
      screen.getByText(/no comparison guides are ready/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Browse Printers' })
    ).toHaveAttribute('href', '/printers');
  });

  it('prefixes relative links for path-mode storefronts', () => {
    render(
      <CompareIndexPageContent
        categoryName="Smartphones"
        categoryHref="/smartphones"
        merchantName="Ogabassey"
        pathPrefix="/ogabassey"
        compareLinks={[
          {
            href: '/smartphones/compare/google-pixel-8-vs-xiaomi-13t',
            label: 'Compare Google Pixel 8 with Xiaomi 13T',
            description: 'Compare price, specs, condition, and buying fit.',
            categorySlug: 'smartphones',
            comparisonSlug: 'google-pixel-8-vs-xiaomi-13t',
            productSlugs: ['google-pixel-8', 'xiaomi-13t'],
            productNames: ['Google Pixel 8', 'Xiaomi 13T'],
            score: 12,
          },
        ]}
      />
    );

    expect(
      screen.getByRole('link', {
        name: 'Compare Google Pixel 8 with Xiaomi 13T',
      })
    ).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/compare/google-pixel-8-vs-xiaomi-13t'
    );
  });
});
