import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderCategoryNotFoundContent } from './render-category-not-found-content';

describe('renderCategoryNotFoundContent', () => {
  it('returns merchants to the tenant root with the requested copy', () => {
    render(
      renderCategoryNotFoundContent({
        message: 'This page moved.',
        slug: 'demo-store',
        title: 'Category moved',
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Category moved' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /continue shopping/i })
    ).toHaveAttribute('href', '/demo-store');
  });
});
