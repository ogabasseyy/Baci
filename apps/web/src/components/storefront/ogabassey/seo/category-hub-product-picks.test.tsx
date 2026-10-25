import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildCategoryHubBrandCards } from '@/lib/storefront-category/category-hub-brand-cards';
import { CategoryHubCardGrid } from './category-hub-card-grid';

describe('laptop product picks', () => {
  it.each([
    { name: 'HP EliteBook', slug: 'elitebook', count: 2 },
    { name: 'HP EliteBook G2', slug: 'elitebook-g2', count: 1 },
  ])('renders a crawlable named product and page-scoped count for $name', ({
    name,
    slug,
    count,
  }) => {
    const cards = buildCategoryHubBrandCards({
      categorySlug: 'laptops',
      storeUrl: 'https://shop.test',
      products: Array.from({ length: count }, (_, index) => ({
        slug: index === 0 ? slug : `${slug}-alternate`,
        name: index === 0 ? name : 'HP ProBook',
        brand: 'HP',
        price: 300_000 + index,
      })),
    });
    const ui = (
      <CategoryHubCardGrid title="Brands and product picks" cards={cards} />
    );
    expect(renderToStaticMarkup(ui)).toContain(
      `href="https://shop.test/laptops/${slug}"`
    );
    render(ui);
    expect(screen.getByRole('link', { name })).toHaveAttribute(
      'href',
      `https://shop.test/laptops/${slug}`
    );
    expect(
      screen.getByText(
        `${count} HP ${count === 1 ? 'product' : 'products'} on this page.`
      )
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'HP' })).not.toBeInTheDocument();
  });
});
