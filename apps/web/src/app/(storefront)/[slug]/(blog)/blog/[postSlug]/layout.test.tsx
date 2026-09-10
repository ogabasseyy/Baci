import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockBlogPostCssImport } = vi.hoisted(() => ({
  mockBlogPostCssImport: vi.fn(),
}));

vi.mock('@/app/(storefront)/storefront-blog-post.css', () => {
  mockBlogPostCssImport();
  return {};
});

import StorefrontBlogPostCssLayout from './layout';

describe('blog post StorefrontBlogPostCssLayout', () => {
  it('loads the post stylesheet for blog post routes', () => {
    expect(mockBlogPostCssImport).toHaveBeenCalledOnce();
  });

  it('passes children through the blog post css route group', () => {
    render(
      <StorefrontBlogPostCssLayout>
        <main>Blog post content</main>
      </StorefrontBlogPostCssLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Blog post content');
  });
});
