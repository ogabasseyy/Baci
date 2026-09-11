import { describe, expect, it } from 'vitest';
import {
  appendPreservedBlogCategoryRedirectParams,
  findPublicCategoryLabel,
} from './blog-listing-category-redirect';

describe('findPublicCategoryLabel', () => {
  it('matches a public category by case-insensitive name', () => {
    expect(findPublicCategoryLabel(['News', 'Guides'], 'news')).toBe('News');
  });

  it('returns null when no public category matches', () => {
    expect(findPublicCategoryLabel(['News'], 'missing')).toBeNull();
  });
});

describe('appendPreservedBlogCategoryRedirectParams', () => {
  it('returns the href when only listing filters are present', () => {
    expect(
      appendPreservedBlogCategoryRedirectParams('/blog/news', {
        category: 'news',
        page: '2',
        search: 'iphone',
      })
    ).toBe('/blog/news');
  });

  it('keeps non-listing query params on the category redirect', () => {
    expect(
      appendPreservedBlogCategoryRedirectParams('/blog/news', {
        category: 'news',
        utm_source: 'newsletter',
      })
    ).toBe('/blog/news?utm_source=newsletter');
  });
});
