import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBlogCssImport } = vi.hoisted(() => ({
  mockBlogCssImport: vi.fn(),
}));

vi.mock('@/app/(storefront)/storefront-core.css', () => ({}));
vi.mock('@/app/(storefront)/storefront-blog.css', () => {
  mockBlogCssImport();
  return {};
});

import StorefrontBlogCssLayout, { unstable_instant } from './layout';

describe('blog StorefrontBlogCssLayout', () => {
  beforeEach(() => {
    mockBlogCssImport.mockClear();
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it('opts blog routes out of instant static-shell validation', () => {
    expect(unstable_instant).toBe(false);
  });

  it('keeps the unfiltered static listing off a mobile LCP path until the first input', async () => {
    expect(mockBlogCssImport).not.toHaveBeenCalled();

    render(
      <StorefrontBlogCssLayout>
        <main>Blog content</main>
      </StorefrontBlogCssLayout>
    );

    expect(mockBlogCssImport).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));

    await waitFor(() => {
      expect(mockBlogCssImport).toHaveBeenCalledOnce();
    });
  });

  it('defers blog CSS for non-static tenants too', () => {
    render(
      <StorefrontBlogCssLayout>
        <main>Other blog</main>
      </StorefrontBlogCssLayout>
    );

    expect(screen.queryByTestId('eager-blog-css')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Other blog');
    expect(mockBlogCssImport).not.toHaveBeenCalled();
  });

  it('passes children through the blog css route group', () => {
    render(
      <StorefrontBlogCssLayout>
        <main>Blog content</main>
      </StorefrontBlogCssLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Blog content');
  });
});
