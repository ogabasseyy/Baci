import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlogListingFallback } from './BlogListingFallback';

describe('BlogListingFallback', () => {
  it('renders a short visible loading status instead of a card grid', () => {
    const { container } = render(<BlogListingFallback />);

    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toHaveTextContent('Loading blog posts');
    expect(container.firstChild).not.toHaveClass('min-h-screen');
    expect(container.querySelectorAll('[class*="h-64"]').length).toBe(0);
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
    render(<BlogListingFallback includeFeaturedSkeleton />);

    expect(
      screen.getByRole('region', { name: 'Loading featured story' })
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-blog-featured-skeleton]')
    ).not.toBeNull();
  });
});
