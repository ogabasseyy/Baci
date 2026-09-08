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
    const { container } = render(
      <BlogListingFallback includeFeaturedSkeleton={false} />
    );

    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
    expect(container.querySelector('.rounded-4xl')).not.toBeInTheDocument();
  });
});
