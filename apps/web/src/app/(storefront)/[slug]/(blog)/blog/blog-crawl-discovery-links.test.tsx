import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/routes', () => ({ asRoute: (value: string) => value }));

import { BlogCrawlDiscoveryLinks } from './blog-crawl-discovery-links';

describe('BlogCrawlDiscoveryLinks', () => {
  it('renders direct page anchors for crawl discovery without prefetching them', () => {
    render(
      <BlogCrawlDiscoveryLinks
        buildHref={(page) => (page > 1 ? `/blog?page=${page}` : '/blog')}
        label="Browse blog archive pages"
        pageLabel="Blog page"
        currentPage={1}
        totalPages={36}
      />
    );

    expect(screen.getByText('Browse blog archive pages')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Blog page 1' })).toHaveAttribute(
      'href',
      '/blog'
    );
    const page20 = screen.getByRole('link', { name: 'Blog page 20' });
    expect(page20).toHaveAttribute('href', '/blog?page=20');
    expect(page20).not.toHaveAttribute('data-prefetch');
    expect(screen.getByRole('link', { name: 'Blog page 36' })).toHaveAttribute(
      'href',
      '/blog?page=36'
    );
  });

  it('renders nothing for single-page archives', () => {
    const { container } = render(
      <BlogCrawlDiscoveryLinks
        buildHref={(page) => `/blog?page=${page}`}
        label="Browse blog archive pages"
        pageLabel="Blog page"
        currentPage={1}
        totalPages={1}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
