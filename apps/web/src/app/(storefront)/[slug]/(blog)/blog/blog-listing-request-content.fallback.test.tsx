import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlogListingRequestContent } from './blog-listing-request-content';

vi.mock('./blog-listing-static-hero', () => ({
  BlogListingStaticHero: vi.fn(async () => (
    <article>Root featured story</article>
  )),
}));

vi.mock('./blog-listing-query-content', () => ({
  BlogListingQueryContent: () => {
    throw new Promise(() => {});
  },
}));

describe('BlogListingRequestContent', () => {
  it('does not put the Ogabassey LCP hero in the listing searchParams fallback', async () => {
    const ui = await BlogListingRequestContent({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
      searchParams: new Promise(() => {}),
    });

    const { container } = render(
      <Suspense fallback={ui.props.fallback}>{ui.props.children}</Suspense>
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('md:h-[420px]');
  });

  it('paints the resolved featured hero in the searchParams fallback for other merchants', async () => {
    const ui = await BlogListingRequestContent({
      params: Promise.resolve({ slug: 'another-ogabassey-template-store' }),
      searchParams: new Promise(() => {}),
    });

    const { container } = render(
      <Suspense fallback={ui.props.fallback}>{ui.props.children}</Suspense>
    );

    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('md:h-[420px]');
  });
});
