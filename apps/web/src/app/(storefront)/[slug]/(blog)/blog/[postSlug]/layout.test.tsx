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

vi.mock('@/app/(storefront)/storefront-blog-post.css', () => ({}));

const { default: StorefrontBlogPostCssLayout } = await import('./layout');

describe('blog post layout', () => {
  it('eagerly imports blog CSS so posts are not waiting on first input', () => {
    expect(mockCoreCssImport).toHaveBeenCalled();
    expect(mockBlogCssImport).toHaveBeenCalled();

    render(
      <StorefrontBlogPostCssLayout>
        <main>Post</main>
      </StorefrontBlogPostCssLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Post');
  });
});
