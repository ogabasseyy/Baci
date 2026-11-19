import { render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategoryHubModel } from '@/lib/storefront-category/category-hub-types';
import { CategoryHubSections } from './category-hub-sections';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ui/accordion', () => ({
  Accordion: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AccordionContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AccordionItem: ({ children }: { children: ReactNode }) => {
    const [initialChildren] = useState(children);
    return <div>{initialChildren}</div>;
  },
  AccordionTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const richModel: CategoryHubModel = {
  intro: {
    heading: 'Buy Smartphones in Nigeria',
    description: 'Compare current picks by battery, camera, and price.',
    source: 'curated',
  },
  trustFeatures: ['Warranty-backed picks', 'Fast nationwide delivery'],
  bestForCards: [
    {
      title: 'Best for Photography',
      description: 'Phones with stronger cameras.',
      href: '/smartphones/apple-pro',
    },
  ],
  brandCards: [
    {
      title: 'Samsung',
      description: 'Popular Samsung devices in stock.',
      href: '/smartphones/samsung-galaxy-s24',
      eyebrow: 'Popular brands',
      secondaryHref: '/smartphones/compare/samsung-vs-apple',
      secondaryLabel: 'Compare Samsung vs Apple',
    },
  ],
  priceBandCards: [
    {
      title: 'Under ₦500,000',
      description: 'Value picks in the first band.',
      href: '/smartphones/best-under/under-500k',
    },
  ],
  comparisonLinks: [
    {
      href: '/smartphones/compare/apple-pro-vs-samsung-ultra',
      label: 'Apple Pro vs Samsung Ultra',
    },
  ],
  guideLinks: [
    {
      href: '/blog/best-phones-in-nigeria',
      title: 'Best Phones in Nigeria',
      description: 'Budget and flagship picks.',
      kind: 'best-in-nigeria',
    },
  ],
  faqItems: [
    {
      question: 'What matters most?',
      answer: '<p>Battery, camera, and storage.</p>',
    },
  ],
};

describe('CategoryHubSections', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders each populated hub section', () => {
    render(<CategoryHubSections hub={richModel} />);

    expect(
      screen.getByRole('heading', { name: 'Buy Smartphones in Nigeria' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Why shop here' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Best for Photography' })
    ).toHaveAttribute('href', '/smartphones/apple-pro');
    expect(screen.getByRole('link', { name: 'Samsung' })).toHaveAttribute(
      'href',
      '/smartphones/samsung-galaxy-s24'
    );
    expect(
      screen.getByRole('link', { name: 'Under ₦500,000' })
    ).toHaveAttribute('href', '/smartphones/best-under/under-500k');
    expect(
      screen.getByRole('link', {
        name: 'Apple Pro vs Samsung Ultra',
      })
    ).toHaveAttribute(
      'href',
      '/smartphones/compare/apple-pro-vs-samsung-ultra'
    );
    expect(
      screen.getByRole('link', { name: 'Best Phones in Nigeria' })
    ).toHaveAttribute('href', '/blog/best-phones-in-nigeria');
    expect(
      screen.getByText('Battery, camera, and storage.')
    ).toBeInTheDocument();
  });

  it('omits empty hub sections', () => {
    render(
      <CategoryHubSections
        hub={{
          intro: {
            heading: 'Accessories',
            description: '',
            source: 'fallback',
          },
          trustFeatures: [],
          bestForCards: [],
          brandCards: [],
          priceBandCards: [],
          comparisonLinks: [],
          guideLinks: [],
          faqItems: [],
        }}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Accessories' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Why shop here' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Best for' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Popular brands' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Best price bands' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Compare and Buying Guides' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Frequently Asked Questions' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Buyer guides and support articles',
      })
    ).not.toBeInTheDocument();
  });

  it('allows a second comparison section to use distinct heading text and ids', () => {
    const comparisonOnlyHub = {
      ...richModel,
      intro: {
        heading: '',
        description: '',
        source: 'fallback' as const,
      },
      trustFeatures: [],
      bestForCards: [],
      brandCards: [],
      priceBandCards: [],
      guideLinks: [],
      faqItems: [],
    };

    const { container } = render(
      <>
        <CategoryHubSections hub={comparisonOnlyHub} />
        <CategoryHubSections
          hub={comparisonOnlyHub}
          headingIdPrefix="maintained-category-comparisons"
          comparisonHeading="More product comparisons"
        />
      </>
    );

    expect(
      screen.getByRole('heading', { name: 'Compare and Buying Guides' })
    ).toHaveAttribute('id', 'compare-and-buying-guides');
    expect(
      screen.getByRole('heading', { name: 'More product comparisons' })
    ).toHaveAttribute(
      'id',
      'maintained-category-comparisons-more-product-comparisons'
    );

    const ids = Array.from(container.querySelectorAll('[id]')).map(
      (element) => element.id
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      container.querySelectorAll(
        'section[aria-labelledby="compare-and-buying-guides"]'
      )
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(
        'section[aria-labelledby="maintained-category-comparisons-more-product-comparisons"]'
      )
    ).toHaveLength(1);
  });

  it('reorders duplicate-question faq items without stale accordion state', () => {
    const { rerender } = render(
      <CategoryHubSections
        hub={{
          ...richModel,
          faqItems: [
            {
              question: 'What matters most?',
              answer: '<p>Battery.</p>',
            },
            {
              question: 'What matters most?',
              answer: '<p>Camera.</p>',
            },
          ],
        }}
      />
    );

    expect(screen.getByText('Battery.')).toBeInTheDocument();
    expect(screen.getByText('Camera.')).toBeInTheDocument();

    rerender(
      <CategoryHubSections
        hub={{
          ...richModel,
          faqItems: [
            {
              question: 'What matters most?',
              answer: '<p>Camera.</p>',
            },
            {
              question: 'What matters most?',
              answer: '<p>Battery.</p>',
            },
          ],
        }}
      />
    );

    expect(
      screen.getAllByText(/Battery\.|Camera\./).map((node) => node.textContent)
    ).toEqual(['Camera.', 'Battery.']);
  });

  it('gives comparison and buyer guide links 44px minimum touch target height', () => {
    render(<CategoryHubSections hub={richModel} />);

    expect(
      screen.getByRole('link', { name: 'Apple Pro vs Samsung Ultra' })
    ).toHaveClass('min-h-11', 'inline-flex', 'items-center');
    expect(
      screen.getByRole('link', { name: 'Best Phones in Nigeria' })
    ).toHaveClass('min-h-11', 'inline-flex', 'items-center');
  });
});
