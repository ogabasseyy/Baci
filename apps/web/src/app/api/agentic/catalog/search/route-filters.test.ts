import { describe, expect, it, vi } from 'vitest';
import { applyUcpCatalogSearchFilters } from './route-filters';

describe('applyUcpCatalogSearchFilters', () => {
  it('applies category, identity, price, and rating filters', () => {
    const query = {
      eq: vi.fn(() => query),
      gte: vi.fn(() => query),
      lte: vi.fn(() => query),
      order: vi.fn(() => query),
      or: vi.fn(() => query),
      range: vi.fn(),
    };

    applyUcpCatalogSearchFilters(query, {
      category: 'phones',
      brand: 'Acme',
      condition: 'new',
      min_price: 100,
      max_price: '500',
      min_rating: 4,
    });

    expect(query.or).toHaveBeenCalledWith(
      'category.eq.phones,categories.slug.eq.phones'
    );
    expect(query.eq).toHaveBeenCalledWith('brand', 'Acme');
    expect(query.eq).toHaveBeenCalledWith('condition', 'new');
    expect(query.gte).toHaveBeenCalledWith('price', 100);
    expect(query.lte).toHaveBeenCalledWith('price', 500);
    expect(query.gte).toHaveBeenCalledWith('average_rating', 4);
  });
});
