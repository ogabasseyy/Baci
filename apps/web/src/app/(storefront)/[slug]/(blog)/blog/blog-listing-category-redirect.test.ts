import { describe, expect, it } from 'vitest';
import {
  appendPreservedBlogCategoryRedirectParams,
  buildBlogListingCategoryRedirectHref,
  findPublicCategoryLabel,
} from './blog-listing-category-redirect';

describe('findPublicCategoryLabel', () => {
  it('matches a public category by case-insensitive name', () => {
    expect(findPublicCategoryLabel(['News', 'Guides'], 'news')).toBe('News');
    expect(findPublicCategoryLabel('news', ['News', 'Guides'])).toBe('News');
  });

  it('returns null when no public category matches', () => {
    expect(findPublicCategoryLabel(['News'], 'missing')).toBeNull();
    expect(findPublicCategoryLabel('missing', ['News'])).toBeNull();
  });

  it('resolves Ogabassey category aliases when identifier is an Ogabassey tenant', () => {
    const categories = ['Tech News', 'Reviews', 'Smartphones'];

    expect(findPublicCategoryLabel('News', categories, 'ogabassey')).toBe(
      'Tech News'
    );
    expect(findPublicCategoryLabel('news', categories, 'ogabassey.com')).toBe(
      'Tech News'
    );
    expect(findPublicCategoryLabel('Review', categories, 'ogabassey')).toBe(
      'Reviews'
    );
    expect(findPublicCategoryLabel('review', categories, 'ogabassey.com')).toBe(
      'Reviews'
    );
  });

  it('does not alias categories for non-Ogabassey tenants or missing identifier', () => {
    const categories = ['Tech News', 'Reviews', 'Smartphones'];

    expect(
      findPublicCategoryLabel('News', categories, 'other-store')
    ).toBeNull();
    expect(findPublicCategoryLabel('News', categories)).toBeNull();
    expect(
      findPublicCategoryLabel('Review', categories, 'other-store')
    ).toBeNull();
    expect(findPublicCategoryLabel('Review', categories)).toBeNull();
  });
});

describe('buildBlogListingCategoryRedirectHref', () => {
  const publicCategories = ['Tech News', 'Reviews', 'Smartphones'];

  it('redirects News to /blog/category/tech-news for Ogabassey tenants', () => {
    expect(
      buildBlogListingCategoryRedirectHref({
        basePath: '',
        category: 'News',
        publicCategories,
        identifier: 'ogabassey',
      })
    ).toBe('/blog/category/tech-news');

    expect(
      buildBlogListingCategoryRedirectHref({
        basePath: '',
        category: 'News',
        publicCategories,
        identifier: 'ogabassey.com',
      })
    ).toBe('/blog/category/tech-news');
  });

  it('redirects Review to /blog/category/reviews for Ogabassey tenants', () => {
    expect(
      buildBlogListingCategoryRedirectHref({
        basePath: '',
        category: 'Review',
        publicCategories,
        identifier: 'ogabassey',
      })
    ).toBe('/blog/category/reviews');

    expect(
      buildBlogListingCategoryRedirectHref({
        basePath: '',
        category: 'Review',
        publicCategories,
        identifier: 'ogabassey.com',
      })
    ).toBe('/blog/category/reviews');
  });

  it('does not alias categories for non-Ogabassey tenants', () => {
    expect(
      buildBlogListingCategoryRedirectHref({
        basePath: '',
        category: 'News',
        publicCategories,
        identifier: 'other-store',
      })
    ).toBeNull();

    expect(
      buildBlogListingCategoryRedirectHref({
        basePath: '',
        category: 'Review',
        publicCategories,
        identifier: 'other-store',
      })
    ).toBeNull();
  });

  it('returns null when page > 1', () => {
    expect(
      buildBlogListingCategoryRedirectHref({
        basePath: '',
        category: 'Smartphones',
        page: 2,
        publicCategories,
        identifier: 'ogabassey',
      })
    ).toBeNull();
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
