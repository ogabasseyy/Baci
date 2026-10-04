import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchPageBreadcrumb } from './search-page-breadcrumb';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('search breadcrumb', () => {
  it.each([
    ['', '/'],
    ['/shop', '/shop'],
  ])('links Home within the storefront %s', (pathPrefix, href) => {
    render(<SearchPageBreadcrumb pathPrefix={pathPrefix} />);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      href
    );
    expect(screen.getByText('Search')).toBeInTheDocument();
  });
});
