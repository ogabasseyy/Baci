import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryHubCardGrid } from './category-hub-card-grid';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('CategoryHubCardGrid', () => {
  it('renders crawlable card links and the optional compare CTA when both fields are present', () => {
    render(
      <CategoryHubCardGrid
        title="Best for"
        cards={[
          {
            title: 'Best for Photography',
            description: 'Strong camera options.',
            href: '/smartphones/apple-pro',
            eyebrow: 'Smartphones',
            secondaryHref: '/smartphones/compare/apple-pro-vs-samsung-ultra',
            secondaryLabel: 'Compare Apple Pro vs Samsung Ultra',
          },
        ]}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Best for' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Best for Photography' })
    ).toHaveAttribute('href', '/smartphones/apple-pro');
    expect(screen.getByText('Strong camera options.')).toBeInTheDocument();
    expect(screen.getByText('Smartphones')).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Compare Apple Pro vs Samsung Ultra',
      })
    ).toHaveAttribute(
      'href',
      '/smartphones/compare/apple-pro-vs-samsung-ultra'
    );
  });

  it('omits the compare CTA when only one secondary field is provided', () => {
    render(
      <CategoryHubCardGrid
        title="Popular brands"
        cards={[
          {
            title: 'Samsung',
            description: 'A broad selection of Samsung phones.',
            href: '/smartphones/samsung-galaxy-s24',
            secondaryHref: '/smartphones/compare/samsung-vs-apple',
          },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'Samsung' })).toHaveAttribute(
      'href',
      '/smartphones/samsung-galaxy-s24'
    );
    expect(
      screen.queryByRole('link', { name: /compare samsung/i })
    ).not.toBeInTheDocument();
  });

  it('does not depend on PDP-only semantic classes for category listing pages', () => {
    render(
      <CategoryHubCardGrid
        title="Best price bands"
        cards={[
          {
            title: 'Best Smartphones Under ₦500,000',
            description: 'Value picks in the first band.',
            href: '/smartphones/best-under/under-500k',
          },
        ]}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Best price bands' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Best Smartphones Under ₦500,000' })
    ).toHaveAttribute('href', '/smartphones/best-under/under-500k');
    expect(
      screen.queryByRole('link', { name: /compare/i })
    ).not.toBeInTheDocument();
  });

  it('expands model suffix plus signs into accessible aria-labels so S10 and S10+ links stay distinct', () => {
    render(
      <CategoryHubCardGrid
        title="More from Samsung"
        cards={[
          {
            title: 'Samsung Galaxy S10',
            description: 'Compact flagship.',
            href: '/smartphones/samsung-galaxy-s10',
          },
          {
            title: 'Samsung Galaxy S10+',
            description: 'Larger battery and display.',
            href: '/smartphones/samsung-galaxy-s10-plus',
            secondaryHref: '/smartphones/compare/samsung-galaxy-s10-plus-vs-s10',
            secondaryLabel: 'Compare S10 +.',
          },
        ]}
      />
    );

    const s10Link = screen.getByRole('link', { name: 'Samsung Galaxy S10' });
    const s10PlusLink = screen.getByRole('link', {
      name: 'Samsung Galaxy S10+ (Samsung Galaxy S10 Plus)',
    });
    const compareLink = screen.getByRole('link', {
      name: 'Compare S10 +. (Compare S10 Plus.)',
    });

    expect(s10Link).not.toHaveAttribute('aria-label');
    expect(s10PlusLink).toHaveAttribute(
      'aria-label',
      'Samsung Galaxy S10+ (Samsung Galaxy S10 Plus)'
    );
    expect(s10PlusLink).toHaveTextContent('Samsung Galaxy S10+');
    expect(compareLink).toHaveAttribute(
      'aria-label',
      'Compare S10 +. (Compare S10 Plus.)'
    );
  });
});
