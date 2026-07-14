import { describe, expect, it } from 'vitest';
import { buildCategoryGraphicsHref } from './build-category-graphics-href';

describe('buildCategoryGraphicsHref', () => {
  it('replaces graphics values, preserves unrelated params, and resets paging', () => {
    expect(
      buildCategoryGraphicsHref({
        graphics: ['Integrated Graphics', 'NVIDIA RTX 4070'],
        pathname: '/store/gaming-laptops',
        resetPage: true,
        search: '?page=3&sort=price&graphics=Old',
      })
    ).toBe(
      '/store/gaming-laptops?sort=price&graphics=Integrated+Graphics&graphics=NVIDIA+RTX+4070'
    );
  });

  it('returns the bare path when no query values remain', () => {
    expect(
      buildCategoryGraphicsHref({
        graphics: [],
        pathname: '/store/gaming-laptops',
      })
    ).toBe('/store/gaming-laptops');
  });
});
