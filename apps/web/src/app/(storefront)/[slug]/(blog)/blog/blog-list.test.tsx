import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BlogList } from './blog-list';

vi.mock('next/image', () => ({
  default: ({
    alt,
    fetchPriority,
    loading,
    preload,
  }: {
    alt: string;
    fetchPriority?: string;
    loading?: string;
    preload?: boolean;
  }) => (
    <span
      aria-label={alt}
      data-fetch-priority={fetchPriority}
      data-loading={loading}
      data-preload={preload ? 'true' : undefined}
      role="img"
    />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const blogPost = {
  id: 'post-1',
  title: 'Best Phones in Nigeria',
  slug: 'best-phones-in-nigeria',
  excerpt: 'A practical buying guide.',
  featured_image_url: 'https://cdn.example.com/blog/phones.jpg',
  featured_image_alt: 'Phones on a table',
  category: 'Guides',
  tags: ['phones'],
  author_name: 'Ogabassey',
  published_at: '2026-03-28T23:30:00.000Z',
  reading_time_minutes: 4,
  view_count: 10,
};

describe('BlogList', () => {
  it('renders published dates with deterministic server/client text', () => {
    render(
      <BlogList
        initialPosts={[blogPost]}
        totalPosts={1}
        basePath="/ogabassey"
      />
    );

    expect(screen.getByText('28 Mar 2026')).toBeInTheDocument();
    expect(screen.getByText('28 Mar 2026').closest('time')).toHaveAttribute(
      'datetime',
      blogPost.published_at
    );
  });

  it('omits invalid published dates without hiding the post card media', () => {
    render(
      <BlogList
        initialPosts={[{ ...blogPost, published_at: 'not-a-date' }]}
        totalPosts={1}
        basePath="/ogabassey"
      />
    );

    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
    expect(screen.queryByText('not-a-date')).not.toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Phones on a table' })
    ).toBeInTheDocument();
  });

  it('keeps later listing card images off the Slow-4G LCP path', () => {
    render(
      <BlogList
        initialPosts={[
          blogPost,
          {
            ...blogPost,
            id: 'post-2',
            slug: 'second-post',
            title: 'Second post',
          },
        ]}
        totalPosts={2}
        basePath="/ogabassey"
      />
    );

    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute('data-loading', 'eager');
    expect(images[0]).toHaveAttribute('data-fetch-priority', 'high');
    expect(images[1]).not.toHaveAttribute('data-preload');
    expect(images[1]).toHaveAttribute('data-loading', 'lazy');
    expect(images[1]).toHaveAttribute('data-fetch-priority', 'low');
  });

  it('treats the first usable card image as the listing LCP image', () => {
    render(
      <BlogList
        initialPosts={[
          {
            ...blogPost,
            id: 'post-without-image',
            slug: 'intro-post',
            title: 'Intro post',
            featured_image_url: null,
            featured_image_alt: null,
          },
          {
            ...blogPost,
            id: 'post-with-image',
            slug: 'image-post',
            title: 'Image post',
            featured_image_url: 'https://cdn.example.com/blog/image-post.jpg',
            featured_image_alt: 'Image post hero',
          },
        ]}
        totalPosts={2}
        basePath="/ogabassey"
      />
    );

    const image = screen.getByRole('img', { name: 'Image post hero' });
    expect(image).toHaveAttribute('data-loading', 'eager');
    expect(image).toHaveAttribute('data-fetch-priority', 'high');
  });

  it('renders crawlable pagination controls instead of auto-fetching with IntersectionObserver', () => {
    render(
      <BlogList
        initialPosts={[blogPost]}
        totalPosts={48}
        basePath="/ogabassey"
      />
    );

    expect(screen.getByText('Showing 1 of 48 articles')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/ogabassey/blog?page=2'
    );
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute(
      'href',
      '/ogabassey/blog?page=2'
    );
    expect(
      screen.queryByText("You've reached the end")
    ).not.toBeInTheDocument();
  });

  it('renders current-page pagination controls when rendering a later crawl page', () => {
    render(
      <BlogList
        initialPosts={[blogPost]}
        initialPage={3}
        totalPosts={48}
        basePath="/ogabassey"
      />
    );

    expect(screen.getByText('Showing 25 of 48 articles')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/ogabassey/blog?page=2'
    );
    expect(screen.getByRole('link', { name: '4' })).toHaveAttribute(
      'href',
      '/ogabassey/blog?page=4'
    );
    expect(screen.getByRole('link', { name: '3' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('preserves search and category params in pagination links', () => {
    render(
      <BlogList
        initialPosts={[blogPost]}
        totalPosts={48}
        category="Buying Guides"
        searchQuery="iphone 17"
        basePath="/ogabassey"
      />
    );

    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/ogabassey/blog?category=Buying+Guides&search=iphone+17&page=2'
    );
  });
});
