import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { BlogPostHeader } from './BlogPostHeader';

describe('BlogPostHeader', () => {
  it('renders the full author and metadata block', () => {
    render(
      <BlogPostHeader
        author_bio="Writes about phones"
        author_name="Ada"
        author_title="Editor"
        category="Smartphones"
        locale="en-GB"
        published_at="2026-03-01T00:00:00.000Z"
        reading_time_minutes={8}
        title="Pixel 9 Review"
      />
    );

    expect(screen.getByText('Smartphones')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pixel 9 Review' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pixel 9 Review' })
    ).toHaveAttribute('data-cwv-lcp-copy', 'blog-post');
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('(Editor)')).toBeInTheDocument();
    expect(screen.getByText(/1 March 2026/i)).toBeInTheDocument();
    expect(screen.getByText('8 min read')).toBeInTheDocument();
    expect(screen.getByText('Writes about phones')).toBeInTheDocument();
  });

  it('renders with minimal required props', () => {
    render(<BlogPostHeader author_name="Ada" title="Minimal Post" />);

    expect(
      screen.getByRole('heading', { name: 'Minimal Post' })
    ).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('omits optional metadata blocks when values are missing', () => {
    render(
      <BlogPostHeader
        author_bio={null}
        author_name={null}
        author_title="Editor"
        category={null}
        published_at={null}
        reading_time_minutes={null}
        title="Untitled Post"
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Untitled Post' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/min read/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    expect(screen.queryByText('(Editor)')).not.toBeInTheDocument();
  });

  it('links the byline to the author page when authorHref is provided', () => {
    render(
      <BlogPostHeader
        author_name="Bassey John"
        authorHref="/ogabassey/blog/author/bassey-john"
        title="Pixel 9 Review"
      />
    );

    expect(screen.getByRole('link', { name: 'Bassey John' })).toHaveAttribute(
      'href',
      '/ogabassey/blog/author/bassey-john'
    );
  });
});
