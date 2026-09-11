import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('hides the committed snapshot hero on paginated results without eager CSS', async () => {
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
    expect(screen.queryByTestId('eager-blog-css')).not.toBeInTheDocument();
  });

  it('marks filtered search listings without importing the eager blog sheet', async () => {
    render(
      await BlogListingQueryContent({
        children: <p>search results</p>,
        hero: <article>Root featured story</article>,
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ search: 'iphone' }),
      })
    );

    expect(screen.queryByTestId('eager-blog-css')).not.toBeInTheDocument();
    expect(screen.getByText('search results')).toBeInTheDocument();
    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
  });

  it('marks filtered category listings without importing the eager blog sheet', async () => {
    render(
      await BlogListingQueryContent({
        children: <p>category results</p>,
        hero: <article>Root featured story</article>,
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({ category: 'News' }),
      })
    );

    expect(screen.queryByTestId('eager-blog-css')).not.toBeInTheDocument();
    expect(screen.getByText('category results')).toBeInTheDocument();
  });
});
