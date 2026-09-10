import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlogListingFallback } from './BlogListingFallback';

describe('BlogListingFallback', () => {
  it('renders a blog-shaped loading skeleton', () => {
    const { container } = render(<BlogListingFallback />);

    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('min-h-screen', 'bg-background');
  });

  it('omits the featured-story skeleton when the listing hero is painted separately', () => {
    render(<BlogListingFallback includeFeaturedSkeleton={false} />);

    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Loading featured story' })
    ).not.toBeInTheDocument();
  });

  it('exposes the featured-story skeleton through an accessible name', () => {
    render(<BlogListingFallback />);

    expect(
      screen.getByRole('region', { name: 'Loading featured story' })
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-featured-skeleton]')
    ).not.toBeNull();
  });
});
