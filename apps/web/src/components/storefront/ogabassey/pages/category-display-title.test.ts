import { describe, expect, it } from 'vitest';
import { buildCategoryDisplayTitle } from './category-display-title';

describe('buildCategoryDisplayTitle', () => {
  it('returns All Products for the All route', () => {
    expect(buildCategoryDisplayTitle('All')).toBe('All Products');
  });

  it('humanizes a category slug', () => {
    expect(buildCategoryDisplayTitle('gaming-laptops')).toBe('Gaming Laptops');
  });
});
