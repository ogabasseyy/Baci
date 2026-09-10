import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import BlogPage from './page';

vi.mock('./blog-listing-ogabassey-lcp-hero', () => ({
  BlogListingOgabasseyLcpHero: () => <article>Root featured story</article>,
}));

vi.mock('./blog-listing-query-content', () => ({
  BlogListingQueryContent: () => {
    throw new Promise(() => {});
  },
}));

describe('blog listing request fallback', () => {
  it('does not put the Ogabassey LCP hero in the listing searchParams fallback', () => {
    const ui = BlogPage({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
      searchParams: new Promise(() => {}),
    });
    const [, listingBoundary] = ui.props.children;

    const { container } = render(
      <Suspense fallback={listingBoundary.props.fallback}>
        {listingBoundary.props.children}
      </Suspense>
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('md:h-[420px]');
  });

  it('keeps a skeleton-only searchParams fallback for other merchants', () => {
    const ui = BlogPage({
      params: Promise.resolve({ slug: 'another-ogabassey-template-store' }),
      searchParams: new Promise(() => {}),
    });
    const [, listingBoundary] = ui.props.children;

    const { container } = render(
      <Suspense fallback={listingBoundary.props.fallback}>
        {listingBoundary.props.children}
      </Suspense>
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('md:h-[420px]');
  });
});
