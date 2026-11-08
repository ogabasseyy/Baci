import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/routes', () => ({ asRoute: (value: string) => value }));

import { BlogAuthorPagination } from './blog-author-pagination';

describe('BlogAuthorPagination', () => {
  it('renders prev/next and direct author archive page anchors', () => {
    render(
      <BlogAuthorPagination
        authorName="Bassey John"
        buildHref={(page) =>
          page > 1
            ? `/blog/author/bassey-john?page=${page}`
            : '/blog/author/bassey-john'
        }
        currentPage={2}
        totalPages={20}
      />
    );

    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/blog/author/bassey-john'
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/blog/author/bassey-john?page=3'
    );
    expect(screen.getByText('Page 2 of 20')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Bassey John articles page 20' })
    ).toHaveAttribute('href', '/blog/author/bassey-john?page=20');
  });

  it('renders nothing for single-page author archives', () => {
    const { container } = render(
      <BlogAuthorPagination
        authorName="Bassey John"
        buildHref={(page) => `/blog/author/bassey-john?page=${page}`}
        currentPage={1}
        totalPages={1}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
