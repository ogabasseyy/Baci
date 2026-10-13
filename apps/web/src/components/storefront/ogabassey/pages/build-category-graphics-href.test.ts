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

  it('mints a hub token for hub-originated transitions', () => {
    expect(
      buildCategoryGraphicsHref({
        graphics: ['NVIDIA RTX 4070'],
        pathname: '/store/gaming-laptops',
        resetPage: true,
        search: '?page=2',
        trustedHubSlug: 'rtx-4070',
      })
    ).toBe(
      '/store/gaming-laptops?graphics=NVIDIA+RTX+4070&graphicsHub=rtx-4070'
    );
  });

  it('drops a stale hub token on listing-originated transitions', () => {
    expect(
      buildCategoryGraphicsHref({
        graphics: ['NVIDIA RTX 4070'],
        pathname: '/store/gaming-laptops',
        search: '?graphicsHub=rtx-4070&graphics=Old',
      })
    ).toBe('/store/gaming-laptops?graphics=NVIDIA+RTX+4070');
  });
});
