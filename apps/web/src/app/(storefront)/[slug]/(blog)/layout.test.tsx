import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBlogCssImport } = vi.hoisted(() => ({
  mockBlogCssImport: vi.fn(),
}));

vi.mock('@/app/(storefront)/storefront-blog.css', () => {
  mockBlogCssImport();
  return {};
});

vi.mock('@/app/(storefront)/storefront-eager-blog-css-layout', () => ({
  StorefrontEagerBlogCssLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="eager-blog-css">{children}</div>
  ),
}));

import StorefrontBlogCssLayout, { unstable_instant } from './layout';

describe('blog StorefrontBlogCssLayout', () => {
  beforeEach(() => {
    mockBlogCssImport.mockClear();
  });

  it('opts blog routes out of instant static-shell validation', () => {
    expect(unstable_instant).toBe(false);
  });

  it('keeps the blog stylesheet off a mobile LCP path until the first input for static tenants', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    expect(mockBlogCssImport).not.toHaveBeenCalled();

    render(
      await StorefrontBlogCssLayout({
        children: <main>Blog content</main>,
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.queryByTestId('eager-blog-css')).not.toBeInTheDocument();
    expect(mockBlogCssImport).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));

    await waitFor(() => {
      expect(mockBlogCssImport).toHaveBeenCalledOnce();
    });
  });

  it('eagerly styles blog listings for non-static tenants', async () => {
    render(
      await StorefrontBlogCssLayout({
        children: <main>Other blog</main>,
        params: Promise.resolve({ slug: 'other-shop' }),
      })
    );

    expect(screen.getByTestId('eager-blog-css')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Other blog');
  });

  it('passes children through the blog css route group', async () => {
    render(
      await StorefrontBlogCssLayout({
        children: <main>Blog content</main>,
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByRole('main')).toHaveTextContent('Blog content');
  });
});
