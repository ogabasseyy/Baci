import { describe, expect, it } from 'vitest';
import { hasDuplicateCarouselSlideTitle } from './has-duplicate-carousel-slide-title';

describe('hasDuplicateCarouselSlideTitle', () => {
  it('finds the same title on a different carousel slide', () => {
    expect(
      hasDuplicateCarouselSlideTitle(
        [{ title: 'Sale' }, { title: 'New arrivals' }],
        1,
        'Sale'
      )
    ).toBe(true);
  });

  it('ignores the edited slide and non-string titles', () => {
    expect(hasDuplicateCarouselSlideTitle([{ title: 'Sale' }], 0, 'Sale')).toBe(
      false
    );
    expect(
      hasDuplicateCarouselSlideTitle([{ title: 'Sale' }], 0, undefined)
    ).toBe(false);
  });
});
