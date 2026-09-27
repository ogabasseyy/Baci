import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlogLegacyContent } from './BlogLegacyContent';

describe('BlogLegacyContent', () => {
  it('removes the repeated hero but preserves other inline images', () => {
    render(
      <BlogLegacyContent
        featuredImageUrl="https://example.com/hero.jpg"
        html={
          '<img src="https://example.com/hero.jpg" alt="Hero"><p>Article body</p><img src="https://example.com/detail.jpg" alt="Detail">'
        }
      />
    );

    expect(screen.queryByRole('img', { name: 'Hero' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Detail' })).toBeInTheDocument();
    expect(screen.getByText('Article body')).toBeInTheDocument();
    expect(screen.getByTestId('blog-post-legacy-content')).toHaveClass(
      'prose-baci'
    );
  });
});
