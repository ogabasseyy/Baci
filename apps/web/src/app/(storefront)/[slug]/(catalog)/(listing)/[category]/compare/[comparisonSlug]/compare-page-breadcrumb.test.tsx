import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ComparePageBreadcrumb } from './compare-page-breadcrumb';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('ComparePageBreadcrumb', () => {
  it('returns null when breadcrumbItems is absent or empty', () => {
    const { container: absentContainer } = render(
      <ComparePageBreadcrumb fallbackTerminalName="Fallback Title" />
    );
    expect(absentContainer).toBeEmptyDOMElement();

    const { container: emptyContainer } = render(
      <ComparePageBreadcrumb
        breadcrumbItems={[]}
        fallbackTerminalName="Fallback Title"
      />
    );
    expect(emptyContainer).toBeEmptyDOMElement();
  });

  it('renders WCAG breadcrumb navigation with links and aria-current="page" on the terminal item', () => {
    render(
      <ComparePageBreadcrumb
        breadcrumbItems={[
          { name: 'Ogabassey', url: 'https://ogabassey.com' },
          { name: 'Smartphones', url: 'https://ogabassey.com/smartphones' },
          {
            name: 'iPhone 17 Pro Max vs Samsung Galaxy Z TriFold',
            url: 'https://ogabassey.com/smartphones/compare/iphone-17-pro-max-vs-samsung-galaxy-z-trifold',
          },
        ]}
        fallbackTerminalName="Fallback Title"
      />
    );

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toBeInTheDocument();
    expect(within(nav).getByRole('list')).toBeInTheDocument();
    expect(within(nav).getAllByRole('listitem')).toHaveLength(3);
    expect(
      within(nav).getByRole('link', { name: 'Ogabassey' })
    ).toHaveAttribute('href', 'https://ogabassey.com');
    expect(
      within(nav).getByRole('link', { name: 'Smartphones' })
    ).toHaveAttribute('href', 'https://ogabassey.com/smartphones');
    expect(
      within(nav).getByText('iPhone 17 Pro Max vs Samsung Galaxy Z TriFold', {
        selector: '[aria-current="page"]',
      })
    ).toBeInTheDocument();
  });

  it('falls back to fallbackTerminalName when the terminal item name is empty', () => {
    render(
      <ComparePageBreadcrumb
        breadcrumbItems={[
          { name: 'Ogabassey', url: 'https://ogabassey.com' },
          {
            name: '',
            url: 'https://ogabassey.com/smartphones/compare/apple-vs-samsung',
          },
        ]}
        fallbackTerminalName="Apple vs Samsung"
      />
    );

    expect(
      screen.getByText('Apple vs Samsung', {
        selector: '[aria-current="page"]',
      })
    ).toBeInTheDocument();
  });
});
