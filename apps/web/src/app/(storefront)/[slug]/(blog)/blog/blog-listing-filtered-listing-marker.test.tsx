import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./blog-listing-ogabassey-lcp-hero', () => ({
  BlogListingOgabasseyLcpHero: () => <article>Root featured story</article>,
}));

const { BlogListingFilteredListingMarker } = await import('./page');

describe('BlogListingFilteredListingMarker', () => {
  it('stays empty for the unfiltered static root so the sibling snapshot can own LCP', async () => {
    render(
      await BlogListingFilteredListingMarker({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeInTheDocument();
  });

  it.each([
    { search: 'iphone' },
    { page: '2' },
    { category: 'News' },
  ])('marks filtered query %j so first-paint CSS can hide the snapshot', async (query) => {
    render(
      await BlogListingFilteredListingMarker({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve(query),
      })
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeNull();
  });

  it('does not mark other merchants as filtered OgaBassey listings', async () => {
    render(
      await BlogListingFilteredListingMarker({
        params: Promise.resolve({ slug: 'another-ogabassey-template-store' }),
        searchParams: Promise.resolve({ search: 'iphone' }),
      })
    );

    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeInTheDocument();
  });
});
