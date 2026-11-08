import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { BlogListingPagination } from './blog-listing-pagination';

describe('BlogListingPagination', () => {
  it('renders nothing when there is only one page', () => {
    const { container } = render(
      <BlogListingPagination storeBasePath="" currentPage={1} totalPages={1} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders crawlable prev/next/page links with correct hrefs', () => {
    render(
      <BlogListingPagination storeBasePath="" currentPage={3} totalPages={36} />
    );

    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/blog?page=2'
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/blog?page=4'
    );
    // Page 1 stays param-free to match the canonical /blog URL.
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/blog'
    );
    expect(screen.getByRole('link', { name: '36' })).toHaveAttribute(
      'href',
      '/blog?page=36'
    );
    // Current page is marked, not a duplicate-priority link target.
    expect(screen.getByRole('link', { name: '3' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('renders direct crawl discovery links for every blog archive page', () => {
    render(
      <BlogListingPagination storeBasePath="" currentPage={1} totalPages={36} />
    );

    expect(screen.getByText('Browse blog archive pages')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Blog page 20' })).toHaveAttribute(
      'href',
      '/blog?page=20'
    );
    expect(screen.getByRole('link', { name: 'Blog page 36' })).toHaveAttribute(
      'href',
      '/blog?page=36'
    );
  });

  it('omits Previous on the first page and Next on the last page', () => {
    const { rerender } = render(
      <BlogListingPagination storeBasePath="" currentPage={1} totalPages={10} />
    );
    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Next' })).toBeInTheDocument();

    rerender(
      <BlogListingPagination
        storeBasePath=""
        currentPage={10}
        totalPages={10}
      />
    );
    expect(screen.getByRole('link', { name: 'Previous' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
  });

  it('clamps out-of-range current pages when rendering navigation', () => {
    render(
      <BlogListingPagination
        storeBasePath=""
        currentPage={999}
        totalPages={5}
      />
    );

    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/blog?page=4'
    );
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('link', { name: '5' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('preserves the active category/search filter and the slug base path', () => {
    render(
      <BlogListingPagination
        storeBasePath="/acme"
        currentPage={2}
        totalPages={5}
        category="phones"
        search="pixel"
      />
    );

    const next = screen.getByRole('link', { name: 'Next' });
    expect(next.getAttribute('href')).toContain('/acme/blog?');
    expect(next.getAttribute('href')).toContain('category=phones');
    expect(next.getAttribute('href')).toContain('search=pixel');
    expect(next.getAttribute('href')).toContain('page=3');

    const discoveryLink = screen.getByRole('link', { name: 'Blog page 5' });
    expect(discoveryLink.getAttribute('href')).toContain('/acme/blog?');
    expect(discoveryLink.getAttribute('href')).toContain('category=phones');
    expect(discoveryLink.getAttribute('href')).toContain('search=pixel');
    expect(discoveryLink.getAttribute('href')).toContain('page=5');
  });
});
