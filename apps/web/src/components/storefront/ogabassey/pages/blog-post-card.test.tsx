import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { BlogPostData } from '@/templates/registry';
import { BlogPostCard } from './blog-post-card';

vi.mock('next/image', () => ({
  default: ({
    alt,
    fetchPriority,
    loading,
    src,
  }: {
    alt: string;
    fetchPriority?: string;
    loading?: string;
    src: string;
  }) => (
    <img
      src={src}
      alt={alt}
      data-loading={loading}
      data-fetchpriority={fetchPriority}
    />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a
      href={href}
      data-prefetch={prefetch === undefined ? undefined : String(prefetch)}
      {...props}
    >
      {children}
    </a>
  ),
}));

describe('BlogPostCard', () => {
  const post: BlogPostData = {
    id: 'post-2',
    title: 'Regular Post',
    slug: 'regular-post',
    excerpt: 'Helpful review summary.',
    category: 'Reviews',
    author_name: '',
    published_at: '2026-03-27T00:00:00.000Z',
    reading_time_minutes: 4,
    featured_image_url: 'https://cdn.example.com/regular.jpg',
  };

  it('uses a non-prefetching stretched link on the h2 title instead of wrapping the article', () => {
    render(
      <BlogPostCard
        href="/test-store/blog/regular-post"
        imageSrc="https://cdn.example.com/regular.jpg"
        post={post}
        publishedDateLabel="Mar 27, 2026"
      />
    );

    const cardLink = screen.getByRole('link', { name: 'Regular Post' });
    expect(cardLink).toHaveAttribute('href', '/test-store/blog/regular-post');
    expect(cardLink).toHaveAttribute('data-prefetch', 'false');
    expect(cardLink.closest('h2')).toBeInTheDocument();
    expect(cardLink.closest('article')).toBeInTheDocument();
    expect(cardLink.querySelector('img')).not.toBeInTheDocument();

    const image = screen.getByRole('img', { name: 'Regular Post' });
    expect(image).toHaveAttribute('data-loading', 'lazy');
    expect(image).toHaveAttribute('data-fetchpriority', 'low');
    expect(screen.getByText('Ogabassey Team')).toBeInTheDocument();
    expect(screen.getByText('4 MIN READ')).toBeInTheDocument();
  });
});
