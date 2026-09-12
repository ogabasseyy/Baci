import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlogListingStaticShell } from './blog-listing-static-shell';

describe('BlogListingStaticShell', () => {
  it('keeps a tenant-neutral listing fallback without the OgaBassey snapshot', () => {
    const { container } = render(<BlogListingStaticShell />);

    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('ogabassey.com');
    expect(container.innerHTML).not.toContain('md:h-[420px]');
  });

  it('keeps the shell itself synchronous so the parent PPR slot can commit', () => {
    expect(BlogListingStaticShell.constructor.name).toBe('Function');
  });
});
