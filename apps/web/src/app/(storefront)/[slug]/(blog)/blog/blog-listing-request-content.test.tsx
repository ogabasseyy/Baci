import { render, screen } from '@testing-library/react';
import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyV2Blog } from '@/components/storefront/ogabassey/pages/blog';
import type { BlogPageProps } from './blog-page-content';
import BlogPage from './page';

vi.mock('./blog-listing-metadata', () => ({
  buildBlogListingMetadata: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} />
  ),
  getImageProps: ({ src, alt }: { src: string; alt: string }) => ({
    props: { src, alt },
  }),
}));
vi.mock('@/components/storefront/ogabassey/pages/ad-unit', () => ({
  AdUnit: () => null,
}));
vi.mock('./blog-listing-ogabassey-lcp-hero', () => ({
  BlogListingOgabasseyLcpHero: () => <article>Root featured story</article>,
}));
vi.mock('./blog-page-content', () => ({
  BlogPageContent: ({ hideFeaturedStory }: BlogPageProps) => (
    <OgabasseyV2Blog
      hideFeaturedStory={hideFeaturedStory}
      posts={['Page two first post', 'Page two second post'].map(
        (title, index) => ({
          id: String(index),
          title,
          slug: `page-two-${index}`,
          excerpt: title,
          author_name: 'Editor',
          published_at: '2026-09-01',
          featured_image_url: '',
          category: 'News',
          reading_time_minutes: 2,
        })
      )}
    />
  ),
}));

// Resolve only async server slots; render the real template normally so its
// featured-story/grid exclusion behavior is covered by this route regression.
async function resolveServerSlots(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node))
    return Promise.all(Children.toArray(node).map(resolveServerSlots));
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  if (
    typeof node.type === 'function' &&
    node.type.constructor.name === 'AsyncFunction'
  ) {
    const component = node.type as (props: unknown) => Promise<ReactNode>;
    return resolveServerSlots(await component(node.props));
  }
  return node.props.children === undefined
    ? node
    : cloneElement(
        node,
        undefined,
        await resolveServerSlots(node.props.children)
      );
}

describe('BlogListingRequestContent request state regression', () => {
  it('renders the committed snapshot hero only on the unfiltered static root', async () => {
    render(
      await resolveServerSlots(
        BlogPage({
          params: Promise.resolve({ slug: 'ogabassey.com' }),
          searchParams: Promise.resolve({}),
        })
      )
    );
    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Page two first post' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Page two second post' })
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeInTheDocument();
  });

  it('still hides the template story when the listing hero is unused', async () => {
    render(
      await resolveServerSlots(
        BlogPage({
          params: Promise.resolve({ slug: 'ogabassey.com' }),
          searchParams: Promise.resolve({}),
        })
      )
    );
    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(screen.queryByText('Featured Story')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Page two first post' })
    ).toBeInTheDocument();
  });

  it('keeps the first result on page two instead of replacing it with page one', async () => {
    render(
      await resolveServerSlots(
        BlogPage({
          params: Promise.resolve({ slug: 'ogabassey.com' }),
          searchParams: Promise.resolve({ page: '2' }),
        })
      )
    );

    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Page two first post' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Page two second post' })
    ).toBeInTheDocument();
  });

  it.each([
    { search: 'iphone' },
    { category: 'News' },
    { page: '1' },
  ])('keeps the committed snapshot hero on query %j and marks the listing filtered', async (query) => {
    render(
      await resolveServerSlots(
        BlogPage({
          params: Promise.resolve({ slug: 'ogabassey.com' }),
          searchParams: Promise.resolve(query),
        })
      )
    );
    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-listing-filtered]')
    ).not.toBeNull();
  });

  it('retains a non-static merchant template story', async () => {
    render(
      await resolveServerSlots(
        BlogPage({
          params: Promise.resolve({ slug: 'another-ogabassey-template-store' }),
          searchParams: Promise.resolve({}),
        })
      )
    );
    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Page two first post' })
    ).toBeInTheDocument();
  });
});
