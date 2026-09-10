import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlogListingStaticShell } from './blog-listing-static-shell';

vi.mock('./blog-listing-ogabassey-lcp-hero', () => ({
  BlogListingOgabasseyLcpHero: () => <article>Root featured story</article>,
}));

describe('BlogListingStaticShell', () => {
  it('paints the unfiltered featured hero without a featured skeleton', () => {
    const { container } = render(<BlogListingStaticShell />);

    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('md:h-[420px]');
  });

  it('keeps the shell itself synchronous so the parent PPR slot can commit', () => {
    expect(BlogListingStaticShell.constructor.name).toBe('Function');
  });
});
