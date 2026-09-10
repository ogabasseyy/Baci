import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Loading from './loading';

vi.mock('./blog-listing-ogabassey-lcp-hero', () => ({
  BlogListingOgabasseyLcpHero: () => <article>Root featured story</article>,
}));

describe('blog listing loading', () => {
  it('paints the featured hero in the leaf loading shell instead of storefront chrome', () => {
    const { container } = render(<Loading />);

    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('md:h-[420px]');
    expect(
      screen.queryByRole('status', { name: 'Loading storefront chrome' })
    ).not.toBeInTheDocument();
  });
});
