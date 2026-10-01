import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Loading from './loading';

describe('blog listing loading', () => {
  it('keeps a tenant-neutral listing fallback instead of storefront chrome or the OgaBassey snapshot', () => {
    const { container } = render(<Loading />);

    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('ogabassey.com');
    expect(container.innerHTML).not.toContain('md:h-[420px]');
    expect(
      screen.queryByRole('status', { name: 'Loading storefront chrome' })
    ).not.toBeInTheDocument();
  });
});
