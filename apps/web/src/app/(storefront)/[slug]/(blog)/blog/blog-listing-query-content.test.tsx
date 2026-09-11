import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(storefront)/storefront-eager-blog-css-layout', () => ({
  StorefrontEagerBlogCssLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="eager-blog-css">{children}</div>
  ),
}));

import { BlogListingQueryContent } from './blog-listing-query-content';

describe('BlogListingQueryContent', () => {
  it('hides the template featured on the unfiltered root even without a resolved hero', async () => {
    render(
      await BlogListingQueryContent({
        children: <p>listing body</p>,
        hero: null,
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(screen.getByText('listing body')).toBeInTheDocument();
    expect(screen.queryByTestId('eager-blog-css')).not.toBeInTheDocument();
  });

  it('keeps the resolved hero on the unfiltered root listing', async () => {
    render(
      await BlogListingQueryContent({
        children: <p>hidden featured</p>,
        hero: <article>Root featured story</article>,
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(screen.getByText('hidden featured')).toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('eager-blog-css')).not.toBeInTheDocument();
  });

  it('hides the committed snapshot hero on paginated results', async () => {
    render(
      await BlogListingQueryContent({
        children: <p>template featured</p>,
        hero: <article>Root featured story</article>,
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(screen.getByText('template featured')).toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeNull();
    expect(screen.getByTestId('eager-blog-css')).toBeInTheDocument();
  });

  it('eagerly styles filtered search listings for static tenants', async () => {
    render(
      await BlogListingQueryContent({
        children: <p>search results</p>,
        hero: <article>Root featured story</article>,
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ search: 'iphone' }),
      })
    );

    expect(screen.getByTestId('eager-blog-css')).toBeInTheDocument();
    expect(screen.getByText('search results')).toBeInTheDocument();
    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
  });

  it('eagerly styles filtered category listings for static tenants', async () => {
    render(
      await BlogListingQueryContent({
        children: <p>category results</p>,
        hero: <article>Root featured story</article>,
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({ category: 'News' }),
      })
    );

    expect(screen.getByTestId('eager-blog-css')).toBeInTheDocument();
    expect(screen.getByText('category results')).toBeInTheDocument();
  });
});
