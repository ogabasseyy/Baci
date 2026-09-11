import { render, screen } from '@testing-library/react';
import { Fragment, Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlogListingFallback } from './BlogListingFallback';
import { BlogListingCommittedLcpHero } from './blog-listing-committed-lcp-hero';
import './blog-page-content.test-utils';
import BlogPage, {
  BlogListingResolved,
  BlogListingUnfilteredCommittedHero,
  generateStaticParams,
} from './page';

vi.mock('./blog-listing-ogabassey-lcp-hero', () => ({
  BlogListingOgabasseyLcpHero: () => <article>Root featured story</article>,
}));

describe('blog page shell', () => {
  it('generates static params for both monitored tenant identifiers', () => {
    expect(generateStaticParams()).toEqual([
      { slug: 'ogabassey.com' },
      { slug: 'ogabassey' },
    ]);
  });

  it('does not await searchParams in the page — children behind Suspense do', () => {
    const then = vi.fn(() => {
      throw new Error('request read outside boundary');
    });
    const params = { then } as unknown as Promise<{ slug: string }>;
    const searchParams = { then } as unknown as Promise<Record<string, never>>;
    const ui = BlogPage({ params, searchParams });
    expect(ui.type).toBe(Fragment);
    const [heroBoundary, listingBoundary] = ui.props.children;
    expect(heroBoundary.type).toBe(Suspense);
    expect(heroBoundary.props.fallback.type).toBe(BlogListingCommittedLcpHero);
    expect(heroBoundary.props.children.type).toBe(
      BlogListingUnfilteredCommittedHero
    );
    expect(heroBoundary.props.children.props.searchParams).toBe(searchParams);
    expect(listingBoundary.type).toBe(Suspense);
    expect(listingBoundary.props.fallback.type).toBe(BlogListingFallback);
    expect(listingBoundary.props.children.type).toBe(BlogListingResolved);
    expect(listingBoundary.props.children.props.searchParams).toBe(
      searchParams
    );
    expect(then).not.toHaveBeenCalled();
  });

  it('bugfix: pending searchParams paint the featured hero while the listing fallback still reserves space', async () => {
    const { unmount } = render(<BlogListingFallback />);
    expect(
      screen.getByRole('region', { name: 'Loading featured story' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    unmount();

    const params = Promise.resolve({ slug: 'ogabassey.com' });
    const searchParams = new Promise<Record<string, never>>(() => {});
    const ui = BlogPage({ params, searchParams });
    const [heroBoundary, listingBoundary] = ui.props.children;
    expect(heroBoundary.props.fallback.type).toBe(BlogListingCommittedLcpHero);
    expect(listingBoundary.props.children.type).toBe(BlogListingResolved);
    expect(listingBoundary.props.children.props.searchParams).toBe(
      searchParams
    );
    const committedHero = await BlogListingCommittedLcpHero({ params });
    render(
      <>
        {committedHero}
        <Suspense fallback={listingBoundary.props.fallback}>
          {listingBoundary.props.children}
        </Suspense>
      </>
    );

    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Loading featured story' })
    ).toBeInTheDocument();
  });

  it('reserves featured-story space when the committed hero is not emitted', async () => {
    const params = Promise.resolve({ slug: 'other-store' });
    const committedHero = await BlogListingCommittedLcpHero({ params });
    expect(committedHero).toBeNull();

    const ui = BlogPage({
      params,
      searchParams: Promise.resolve({}),
    });
    const listingBoundary = ui.props.children[1];
    render(listingBoundary.props.fallback);

    expect(
      screen.getByRole('region', { name: 'Loading featured story' })
    ).toBeInTheDocument();
  });
});
