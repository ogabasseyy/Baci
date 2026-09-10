import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockBlogCssImport = vi.fn();
const mockCoreCssImport = vi.fn();

vi.mock('@/app/(storefront)/storefront-blog.css', () => {
  mockBlogCssImport();
  return {};
});

vi.mock('@/app/(storefront)/storefront-core.css', () => {
  mockCoreCssImport();
  return {};
});

const { StorefrontEagerBlogCssLayout } = await import(
  './storefront-eager-blog-css-layout'
);

describe('StorefrontEagerBlogCssLayout', () => {
  it('statically imports blog CSS without waiting for first input', () => {
    expect(mockCoreCssImport).toHaveBeenCalled();
    expect(mockBlogCssImport).toHaveBeenCalled();

    render(
      <StorefrontEagerBlogCssLayout>
        <main>Author</main>
      </StorefrontEagerBlogCssLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Author');
  });
});
