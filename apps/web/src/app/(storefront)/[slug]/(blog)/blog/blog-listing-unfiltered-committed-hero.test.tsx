import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./blog-listing-ogabassey-lcp-hero', () => ({
  BlogListingOgabasseyLcpHero: () => <article>Root featured story</article>,
}));

const { BlogListingUnfilteredCommittedHero } = await import('./page');

describe('BlogListingUnfilteredCommittedHero', () => {
  it('renders the snapshot hero for the unfiltered static root', async () => {
    render(
      await BlogListingUnfilteredCommittedHero({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeInTheDocument();
  });

  it.each([
    { search: 'iphone' },
    { page: '2' },
    { category: 'News' },
  ])('omits the snapshot hero and marks filtered query %j', async (query) => {
    render(
      await BlogListingUnfilteredCommittedHero({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve(query),
      })
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeNull();
  });

  it('does not emit the OgaBassey snapshot for other merchants', async () => {
    render(
      await BlogListingUnfilteredCommittedHero({
        params: Promise.resolve({ slug: 'another-ogabassey-template-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeInTheDocument();
  });
});
