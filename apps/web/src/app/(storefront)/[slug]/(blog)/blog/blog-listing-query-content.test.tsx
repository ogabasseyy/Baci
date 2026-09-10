import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlogListingQueryContent } from './blog-listing-query-content';
import type { BlogPageProps } from './blog-page-content';

vi.mock('./blog-page-content', () => ({
  BlogPageContent: ({ hideFeaturedStory }: BlogPageProps) => (
    <p>{hideFeaturedStory ? 'hidden featured' : 'template featured'}</p>
  ),
}));

describe('BlogListingQueryContent', () => {
  it('hides the template featured on the unfiltered root even without a resolved hero', async () => {
    render(
      await BlogListingQueryContent({
        hero: null,
        params: Promise.resolve({ slug: 'ogabassey.com' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(screen.getByText('hidden featured')).toBeInTheDocument();
  });

  it('keeps the resolved hero on the unfiltered root listing', async () => {
    render(
      await BlogListingQueryContent({
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
  });

  it('hides the committed snapshot hero on paginated results', async () => {
    render(
      await BlogListingQueryContent({
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
  });
});
